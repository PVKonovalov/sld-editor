package rsdu

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
	"sld-editor/internal/config"
)

// txDB is exportDB with the dictionaries, plus transactions that record their statements and can fail on one.
type txDB struct {
	*fakeDB
	failOn     string
	execs      []string
	args       [][]any
	seq        int64
	committed  bool
	rolledBack bool
}

func (f *txDB) Begin(context.Context) (Tx, error) { return &fakeTx{db: f}, nil }

type fakeTx struct{ db *txDB }

func (t *fakeTx) Query(_ context.Context, q string, args ...any) (Rows, error) {
	t.db.execs = append(t.db.execs, q)
	t.db.args = append(t.db.args, args)
	n := 1
	if i := strings.LastIndexAny(q, "= ,"); strings.Contains(q, "NEXTVAL") || strings.Contains(q, "nextval") {
		fmt.Sscanf(strings.Trim(q[i+1:], " )"), "%d", &n)
	}
	var rows [][]any
	for range n {
		t.db.seq++
		rows = append(rows, []any{1000 + t.db.seq})
	}
	return &fakeRows{rows: rows, i: -1}, nil
}

func (t *fakeTx) Exec(_ context.Context, q string, args ...any) (int64, error) {
	t.db.execs = append(t.db.execs, q)
	t.db.args = append(t.db.args, args)
	if t.db.failOn != "" && strings.Contains(q, t.db.failOn) {
		return 0, errors.New("insert failed")
	}
	return 1, nil
}

func (t *fakeTx) Commit() error   { t.db.committed = true; return nil }
func (t *fakeTx) Rollback() error { t.db.rolledBack = true; return nil }

func newTxDB() *txDB {
	base := exportDB()
	check := base.rows
	base.rows = func(q string, args []any) [][]any {
		switch {
		case strings.Contains(q, "FROM rsduadmin.VS_REGIM "):
			return [][]any{{int64(1), "Equipment", "EQUIPMENT"}, {int64(2), "Parameters", "ADJUST_REGIM"}, {int64(3), "Additional", "ADJUST_ADDITIONAL"}}
		case strings.Contains(q, "FROM rsduadmin.SYS_GTOPT"):
			return [][]any{
				{int64(10), "Complex", optionComplex, "OBJ", "Objects"},
				{int64(11), "Bool", optionBool, "BOOL", "Bools"},
			}
		case strings.Contains(q, "FROM rsduadmin.VS_COMP_FEATURE"):
			return [][]any{{int64(1), "One", "F1"}, {int64(4), "Four", "F4"}}
		}
		return check(q, args)
	}
	return &txDB{fakeDB: base}
}

func exportProvider(t *testing.T, f *txDB, driver string) *Provider {
	t.Helper()
	d, err := NewDialect(driver, "")
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.RSDUBindings{SchemeType: 518}
	cfg.SVG.FullPath = true
	return newProvider(cfg, d, f)
}

func exportDiagram() *slddoc.Diagram {
	b := func(kind slddoc.BindingKind, ref, option string, scale int) slddoc.Binding {
		return slddoc.Binding{Source: "rsdu", Kind: kind, Ref: ref, Option: option, Scale: scale}
	}
	return &slddoc.Diagram{
		Scheme: &slddoc.SchemeRef{Source: "rsdu", Ref: "10"},
		Object: &slddoc.Binding{Source: "rsdu", Kind: slddoc.BindingEquipment, Ref: "1024:77"},
		Elements: []slddoc.Element{
			{ID: 1, Shape: "41", Precision: 3, Features: "F1, F4", Bindings: []slddoc.Binding{
				b(slddoc.BindingEquipment, "1024:5", "", 0),
				b(slddoc.BindingMeas1, "33:7", optionBool, -1),
				b(slddoc.BindingMeas2, "bad", "", 0),
				b(slddoc.BindingJump, "50:9", "anything", 0),
			}},
			{ID: 2, Shape: "41", Bindings: []slddoc.Binding{b(slddoc.BindingMeas1, "33:8", "", 0), b(slddoc.BindingJump, "33:9", "", 0)}},
			{ID: 3, Shape: "999", Bindings: []slddoc.Binding{b(slddoc.BindingEquipment, "1024:6", "", 0)}},
			{ID: 4, Shape: "41", Bindings: []slddoc.Binding{{Source: "other", Kind: slddoc.BindingEquipment, Ref: "x"}}},
		},
		DigitalDevices: []slddoc.DigitalDevice{{ID: 5, Bindings: []slddoc.Binding{b(slddoc.BindingMeas1, "33:11", optionBool, 0)}}},
	}
}

// statement returns the recorded statements reduced to their verb and table, e.g. "INSERT VS_COMP".
func statements(f *txDB) []string {
	var out []string
	for _, q := range f.execs {
		w := strings.Fields(q)
		switch w[0] {
		case "INSERT", "DELETE":
			out = append(out, w[0]+" "+strings.TrimPrefix(w[2], "rsduadmin."))
		case "UPDATE":
			out = append(out, "UPDATE "+strings.TrimPrefix(w[1], "rsduadmin."))
		default:
			out = append(out, "NEXT "+map[bool]string{true: "VS_FORM_S", false: "VS_COMP_S"}[strings.Contains(strings.ToUpper(q), "VS_FORM_S")])
		}
	}
	return out
}

func codesOf(issues []binding.ExportIssue) []string {
	var out []string
	for _, i := range issues {
		out = append(out, fmt.Sprintf("%s:%d", i.Code, i.Item))
	}
	return out
}

func TestExportLinked(t *testing.T) {
	for _, driver := range []string{config.DriverPostgres, config.DriverOracle} {
		t.Run(driver, func(t *testing.T) {
			f := newTxDB()
			p := exportProvider(t, f, driver)
			res, err := p.Export(context.Background(), "region/sub", exportDiagram(), binding.ExportRequest{Name: "Renamed"})
			if err != nil {
				t.Fatal(err)
			}
			want := []string{
				"UPDATE VS_FORM", "DELETE VS_OBJ_TUNE", "DELETE VS_REGIM_TUNE", "DELETE VS_COMP", "INSERT VS_OBJ_TUNE",
				"NEXT VS_COMP_S",
				"INSERT VS_COMP", "INSERT VS_REGIM_TUNE", "INSERT VS_REGIM_TUNE", "INSERT VS_REGIM_TUNE",
				"INSERT VS_COMP", "INSERT VS_REGIM_TUNE",
				"INSERT VS_COMP", "INSERT VS_REGIM_TUNE",
			}
			if got := statements(f); !slices.Equal(got, want) {
				t.Fatalf("statements\n got %v\nwant %v", got, want)
			}
			if !f.committed || f.rolledBack {
				t.Errorf("committed %v, rolled back %v", f.committed, f.rolledBack)
			}
			at := res.Scheme.Exported.Unix()
			if got := fmt.Sprint(f.args[0]); got != fmt.Sprint([]any{int64(2), int64(518), "Renamed", "Renamed", `region\sub.xsde`, at, int64(10)}) {
				t.Errorf("update args %s", got)
			}
			if got := fmt.Sprint(f.args[6]); got != fmt.Sprint([]any{int64(1001), int64(10), int64(6), "1", int64(5), int64(3), nil}) {
				t.Errorf("component args %s", got)
			}
			// equipment: complex; meas1: bool, scale -1; jump: ADJUST_REGIM, complex whatever the option.
			for i, w := range [][]any{
				{int64(1001), int64(1), int64(1024), int64(5), int64(10), int64(1)},
				{int64(1001), int64(2), int64(33), int64(7), int64(11), int64(-1)},
				{int64(1001), int64(2), int64(50), int64(9), int64(10), int64(1)},
			} {
				if got := fmt.Sprint(f.args[7+i]); got != fmt.Sprint(w) {
					t.Errorf("tune %d args %s, want %v", i, got, w)
				}
			}
			if got := fmt.Sprint(f.args[13]); got != fmt.Sprint([]any{int64(1003), int64(2), int64(33), int64(11), int64(11), int64(1)}) {
				t.Errorf("device tune args %s", got)
			}
			if res.Scheme.Ref != "10" || res.Registered || res.Scheme.Registered || res.Components != 3 || res.Bindings != 5 {
				t.Errorf("result %+v", res)
			}
			skipped := codesOf(res.Skipped)
			for _, s := range []string{"noComponentType:3", "otherSource:4", "badRef:1", "duplicate:2"} {
				if !slices.Contains(skipped, s) {
					t.Errorf("skipped %v lacks %s", skipped, s)
				}
			}
			next := f.execs[5]
			if driver == config.DriverOracle && (!strings.Contains(next, "rsduadmin.VS_COMP_S.NEXTVAL FROM DUAL CONNECT BY LEVEL <= 3") || !strings.Contains(f.execs[0], ":pr7")) {
				t.Errorf("oracle SQL: %s / %s", next, f.execs[0])
			}
			if driver == config.DriverPostgres && !strings.Contains(next, "nextval('rsduadmin.vs_comp_s') FROM generate_series(1, 3)") {
				t.Errorf("postgres SQL: %s", next)
			}
		})
	}
}

func TestExportRegister(t *testing.T) {
	f := newTxDB()
	p := exportProvider(t, f, config.DriverPostgres)
	d := exportDiagram()
	d.Scheme = nil
	if _, err := p.Export(context.Background(), "b/one", d, binding.ExportRequest{Register: true, Name: "One"}); !errors.Is(err, binding.ErrInvalid) {
		t.Errorf("no group: %v", err)
	}
	res, err := p.Export(context.Background(), "b/one", d, binding.ExportRequest{Register: true, Name: "One", Alias: "1", Group: "3"})
	if err != nil {
		t.Fatal(err)
	}
	if got := statements(f)[:3]; !slices.Equal(got, []string{"NEXT VS_FORM_S", "INSERT VS_FORM", "INSERT VS_OBJ_TUNE"}) {
		t.Errorf("statements %v", got)
	}
	if got := fmt.Sprint(f.args[1]); got != fmt.Sprint([]any{int64(1001), int64(3), int64(518), "One", "1", "b/one.svg", res.Scheme.Exported.Unix()}) {
		t.Errorf("insert args %s", got)
	}
	if res.Scheme.Ref != "1001" || !res.Registered || !res.Scheme.Registered {
		t.Errorf("result %+v", res)
	}

	// A scheme the editor registered follows the diagram's path; one linked from RSDU keeps its file name.
	f = newTxDB()
	p = exportProvider(t, f, config.DriverPostgres)
	d = exportDiagram()
	d.Scheme.Registered = true
	res, err = p.Export(context.Background(), "moved/sub", d, binding.ExportRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if got := f.args[0][4]; got != "moved/sub.svg" || !res.Scheme.Registered {
		t.Errorf("file name %v, result %+v", got, res)
	}
}

func TestExportRollsBack(t *testing.T) {
	f := newTxDB()
	f.failOn = "INSERT INTO rsduadmin.VS_REGIM_TUNE"
	p := exportProvider(t, f, config.DriverPostgres)
	if _, err := p.Export(context.Background(), "region/sub", exportDiagram(), binding.ExportRequest{}); err == nil {
		t.Fatal("no error")
	}
	if f.committed || !f.rolledBack {
		t.Errorf("committed %v, rolled back %v", f.committed, f.rolledBack)
	}
}

func TestExportRefused(t *testing.T) {
	f := newTxDB()
	p := exportProvider(t, f, config.DriverPostgres)
	p.cfg.SchemeType = 0
	var refused *binding.ErrExportRefused
	if _, err := p.Export(context.Background(), "region/sub", exportDiagram(), binding.ExportRequest{}); !errors.As(err, &refused) || refused.Check.OK {
		t.Errorf("err %v", err)
	}
	d := exportDiagram()
	d.Scheme.Ref = "99"
	if _, err := p.Export(context.Background(), "region/sub", d, binding.ExportRequest{}); !errors.As(err, &refused) {
		t.Errorf("missing scheme: %v", err)
	}
	if len(f.execs) != 0 || f.committed {
		t.Errorf("wrote %v", f.execs)
	}
}

// TestExportLabelsAndWires: a text label is exported as shape 5's component type, a wire as its kind's configured
// one; a wire kind without one is skipped.
func TestExportLabelsAndWires(t *testing.T) {
	f := newTxDB()
	rows := f.rows
	f.rows = func(q string, args []any) [][]any {
		if strings.Contains(q, "FROM rsduadmin.VS_TCOMP") {
			return [][]any{{int64(6), "Breaker", int64(41)}, {int64(7), "Label", int64(5)}}
		}
		return rows(q, args)
	}
	p := exportProvider(t, f, config.DriverPostgres)
	p.cfg.WireTypes = map[string]int64{string(slddoc.KindBusWork): 1489}
	jump := []slddoc.Binding{{Source: "rsdu", Kind: slddoc.BindingJump, Ref: "43:9"}}
	eq := []slddoc.Binding{{Source: "rsdu", Kind: slddoc.BindingEquipment, Ref: "1024:5"}}
	d := &slddoc.Diagram{
		Scheme: &slddoc.SchemeRef{Source: "rsdu", Ref: "10"},
		Labels: []slddoc.Label{{ID: 20, Text: "Panel", Precision: 2, Bindings: jump}, {ID: 23, Text: "free"}},
		Connectors: []slddoc.Connector{
			{ID: 21, Kind: slddoc.KindBusWork, Bindings: eq},
			{ID: 22, Kind: slddoc.KindOverheadLine, Bindings: eq},
		},
	}
	check, err := p.CheckExport(context.Background(), "region/sub", d, d.Scheme)
	if err != nil {
		t.Fatal(err)
	}
	if check.Bound != 3 || !slices.ContainsFunc(check.Issues, func(i binding.ExportIssue) bool {
		return i.Code == binding.IssueNoComponentType && i.Item == 22 && i.Kind == "wire" && i.Shape == "wire:OverheadLine"
	}) {
		t.Errorf("check: bound %d, issues %+v", check.Bound, check.Issues)
	}
	res, err := p.Export(context.Background(), "region/sub", d, binding.ExportRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Components != 2 || res.Bindings != 2 {
		t.Errorf("result %+v", res)
	}
	var comps [][]any
	for i, q := range f.execs {
		if strings.HasPrefix(q, "INSERT INTO rsduadmin.VS_COMP ") {
			comps = append(comps, f.args[i])
		}
	}
	if len(comps) != 2 || fmt.Sprint(comps[0][2:4]) != "[7 20]" || fmt.Sprint(comps[1][2:4]) != "[1489 21]" {
		t.Errorf("components %v", comps)
	}
}

// TestExportComponentTypes: an item's own component type wins when the scheme type has it; one it lacks is reported
// and the shape decides, by MODUS_TYPE or else bindings.rsdu.component_types.
func TestExportComponentTypes(t *testing.T) {
	f := newTxDB()
	p := exportProvider(t, f, config.DriverPostgres)
	p.cfg.ComponentTypes = map[string]int64{"385": 2000023, "41": 99}
	eq := func(ref string) []slddoc.Binding {
		return []slddoc.Binding{{Source: "rsdu", Kind: slddoc.BindingEquipment, Ref: ref}}
	}
	d := &slddoc.Diagram{
		Scheme: &slddoc.SchemeRef{Source: "rsdu", Ref: "10"},
		Elements: []slddoc.Element{
			{ID: 1, Shape: "999", ComponentType: "2000023", Bindings: eq("1024:1")},
			{ID: 2, Shape: "41", ComponentType: "12345", Bindings: eq("1024:2")},
			{ID: 3, Shape: "385", Bindings: eq("1024:3")},
			{ID: 4, Shape: "41", Bindings: eq("1024:4")},
		},
	}
	check, err := p.CheckExport(context.Background(), "region/sub", d, d.Scheme)
	if err != nil {
		t.Fatal(err)
	}
	if got := codesOf(check.Issues); !slices.Contains(got, "badComponentType:2") || slices.Contains(got, "noComponentType:1") ||
		slices.Contains(got, "noComponentType:2") || slices.Contains(got, "noComponentType:3") {
		t.Errorf("issues %v", got)
	}
	if _, err := p.Export(context.Background(), "region/sub", d, binding.ExportRequest{}); err != nil {
		t.Fatal(err)
	}
	var types []string
	for i, q := range f.execs {
		if strings.HasPrefix(q, "INSERT INTO rsduadmin.VS_COMP ") {
			types = append(types, fmt.Sprint(f.args[i][3], ":", f.args[i][2]))
		}
	}
	// The scheme type's MODUS_TYPE 41 wins over the configured 99.
	if want := []string{"1:2000023", "2:6", "3:2000023", "4:6"}; !slices.Equal(types, want) {
		t.Errorf("component types %v, want %v", types, want)
	}
}
