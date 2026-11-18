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
	if !strings.Contains(q, "NEXTVAL") && !strings.Contains(q, "nextval") {
		return &fakeRows{rows: t.db.rows(q, args), i: -1}, nil
	}
	n := 1
	if i := strings.LastIndexAny(q, "= ,"); i >= 0 {
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

// statements returns the recorded statements reduced to their verb and table, e.g. "INSERT VS_COMP", "READ VS_COMP"
// or "NEXT VS_COMP_S".
func statements(f *txDB) []string {
	var out []string
	for _, q := range f.execs {
		w := strings.Fields(q)
		switch {
		case strings.Contains(strings.ToUpper(q), "NEXTVAL"):
			out = append(out, "NEXT "+map[bool]string{true: "VS_FORM_S", false: "VS_COMP_S"}[strings.Contains(strings.ToUpper(q), "VS_FORM_S")])
		case w[0] == "SELECT":
			i := slices.Index(w, "FROM")
			out = append(out, "READ "+strings.TrimPrefix(w[i+1], "rsduadmin."))
		case w[0] == "INSERT" && w[1] == "ALL":
			out = append(out, "INSERT "+strings.TrimPrefix(w[3], "rsduadmin."))
		case w[0] == "INSERT", w[0] == "DELETE":
			out = append(out, w[0]+" "+strings.TrimPrefix(w[2], "rsduadmin."))
		case w[0] == "UPDATE":
			out = append(out, "UPDATE "+strings.TrimPrefix(w[1], "rsduadmin."))
		}
	}
	return out
}

// written returns the rows the recorded statements starting with prefix carried, each of size values.
func written(f *txDB, prefix string, size int) [][]any {
	var out [][]any
	for i, q := range f.execs {
		if strings.HasPrefix(q, prefix) {
			for row := range slices.Chunk(f.args[i], size) {
				out = append(out, row)
			}
		}
	}
	return out
}

// stored makes f answer the export's reads of scheme 10 with comps (VS_COMP rows: ID, NAME, ID_TCTRL, FEATURE,
// PRECISION), tunes (VS_REGIM_TUNE rows: ID_OWNLST, ID_REGIM, ID_TABLE, ID_PARAM, ID_GTOPT, SCALE) and obj (VS_OBJ_TUNE
// rows); the scheme's alias is its name. A read naming components gets only theirs.
func stored(f *txDB, comps, tunes, obj [][]any) {
	rows := f.rows
	f.rows = func(q string, args []any) [][]any {
		named := func(name any) bool {
			return len(args) == 1 || slices.Contains(args[1:], name)
		}
		switch {
		case strings.Contains(q, "FROM rsduadmin.VS_FORM f"):
			out := rows(q, args)
			for _, r := range out {
				if r[0] == int64(10) {
					r[4] = r[3]
				}
			}
			return out
		case strings.Contains(q, "FROM rsduadmin.VS_COMP WHERE ID_FORM"):
			var out [][]any
			for _, c := range comps {
				if named(c[1]) {
					out = append(out, c)
				}
			}
			return out
		case strings.HasPrefix(q, "SELECT t.ID_OWNLST"):
			var out [][]any
			for _, t := range tunes {
				for _, c := range comps {
					if c[0] == t[0] && named(c[1]) {
						out = append(out, t)
					}
				}
			}
			return out
		case strings.Contains(q, "FROM rsduadmin.VS_OBJ_TUNE"):
			return obj
		}
		return rows(q, args)
	}
}

func codesOf(issues []binding.ExportIssue) []string {
	var out []string
	for _, i := range issues {
		out = append(out, fmt.Sprintf("%s:%d", i.Code, i.Item))
	}
	return out
}

// TestExportInserts: registering inserts everything, a batch per table, on both databases.
func TestExportInserts(t *testing.T) {
	for _, driver := range []string{config.DriverPostgres, config.DriverOracle} {
		t.Run(driver, func(t *testing.T) {
			f := newTxDB()
			p := exportProvider(t, f, driver)
			d := exportDiagram()
			d.Scheme = nil
			res, err := p.Export(context.Background(), "region/sub", d, binding.ExportRequest{Register: true, Name: "New", Group: "3"})
			if err != nil {
				t.Fatal(err)
			}
			want := []string{"NEXT VS_FORM_S", "INSERT VS_FORM", "INSERT VS_OBJ_TUNE", "NEXT VS_COMP_S", "INSERT VS_COMP", "INSERT VS_REGIM_TUNE"}
			if got := statements(f); !slices.Equal(got, want) {
				t.Fatalf("statements\n got %v\nwant %v", got, want)
			}
			if !f.committed || f.rolledBack {
				t.Errorf("committed %v, rolled back %v", f.committed, f.rolledBack)
			}
			prefix := map[bool]string{true: "INSERT ALL INTO rsduadmin.", false: "INSERT INTO rsduadmin."}[driver == config.DriverOracle]
			comps := written(f, prefix+"VS_COMP ", 7)
			if len(comps) != 3 || fmt.Sprint(comps[0]) != fmt.Sprint([]any{int64(1002), int64(1001), int64(6), "1", int64(5), int64(3), nil}) {
				t.Errorf("component rows %v", comps)
			}
			tunes := written(f, prefix+"VS_REGIM_TUNE ", 6)
			// equipment: complex; meas1: bool, scale -1; jump: ADJUST_REGIM, complex whatever the option.
			for i, w := range [][]any{
				{int64(1002), int64(1), int64(1024), int64(5), int64(10), int64(1)},
				{int64(1002), int64(2), int64(33), int64(7), int64(11), int64(-1)},
				{int64(1002), int64(2), int64(50), int64(9), int64(10), int64(1)},
				{int64(1003), int64(2), int64(33), int64(8), int64(11), int64(1)},
				{int64(1004), int64(2), int64(33), int64(11), int64(11), int64(1)},
			} {
				if i >= len(tunes) || fmt.Sprint(tunes[i]) != fmt.Sprint(w) {
					t.Errorf("tune %d of %v, want %v", i, tunes, w)
				}
			}
			if !res.Registered || res.Components != 3 || res.Bindings != 5 || res.Changes != (binding.ExportChanges{Inserted: 10}) {
				t.Errorf("result %+v", res)
			}
			skipped := codesOf(res.Skipped)
			for _, s := range []string{"noComponentType:3", "otherSource:4", "badRef:1", "duplicate:2"} {
				if !slices.Contains(skipped, s) {
					t.Errorf("skipped %v lacks %s", skipped, s)
				}
			}
			next, ins := f.execs[3], f.execs[5]
			if driver == config.DriverOracle && (!strings.Contains(next, "rsduadmin.VS_COMP_S.NEXTVAL FROM DUAL CONNECT BY LEVEL <= 3") ||
				!strings.HasSuffix(ins, "SELECT 1 FROM DUAL") || !strings.Contains(ins, ":pr30")) {
				t.Errorf("oracle SQL: %s / %s", next, ins)
			}
			if driver == config.DriverPostgres && (!strings.Contains(next, "nextval('rsduadmin.vs_comp_s') FROM generate_series(1, 3)") ||
				!strings.Contains(ins, "($25, $26, $27, $28, $29, $30)")) {
				t.Errorf("postgres SQL: %s / %s", next, ins)
			}
		})
	}
}

// exportedRows are the rows RSDU has for exportDiagram's scheme 10 (component ids 1001–1003), its object included,
// plus component 1005 of an item the diagram doesn't have.
func exportedRows() (comps, tunes, obj [][]any) {
	comps = [][]any{
		{int64(1001), "1", int64(6), int64(5), int64(3)},
		{int64(1002), "2", int64(6), int64(0), int64(0)},
		{int64(1003), "5", int64(567), nil, nil},
		{int64(1005), "99", int64(6), int64(0), int64(0)},
	}
	tunes = [][]any{
		{int64(1001), int64(1), int64(1024), int64(5), int64(10), int64(1)},
		{int64(1001), int64(2), int64(33), int64(7), int64(11), int64(-1)},
		{int64(1001), int64(2), int64(50), int64(9), int64(10), nil},
		{int64(1002), int64(2), int64(33), int64(8), int64(11), int64(1)},
		{int64(1003), int64(2), int64(33), int64(11), int64(11), int64(1)},
		{int64(1005), int64(1), int64(1024), int64(99), int64(10), int64(1)},
	}
	return comps, tunes, [][]any{{int64(1024), int64(77)}}
}

// TestExportUnflagged: without statuses a linked export reads and writes nothing, whatever RSDU has (here a
// component the diagram has no item for); only a changed scheme name is written.
func TestExportUnflagged(t *testing.T) {
	f := newTxDB()
	comps, tunes, obj := exportedRows()
	stored(f, comps, tunes, obj)
	p := exportProvider(t, f, config.DriverPostgres)
	d := exportDiagram()
	d.Elements, d.DigitalDevices = nil, nil
	res, err := p.Export(context.Background(), "region/sub", d, binding.ExportRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(f.execs) != 0 || res.Changes != (binding.ExportChanges{}) || !f.committed {
		t.Errorf("statements %v, result %+v", statements(f), res)
	}
	res, err = p.Export(context.Background(), "region/sub", d, binding.ExportRequest{Name: "Renamed"})
	if err != nil {
		t.Fatal(err)
	}
	if got := statements(f); !slices.Equal(got, []string{"UPDATE VS_FORM"}) || res.Changes != (binding.ExportChanges{Updated: 1}) {
		t.Errorf("rename: %v, %+v", got, res)
	}
	at := res.Scheme.Exported.Unix()
	if got := fmt.Sprint(f.args[0]); got != fmt.Sprint([]any{int64(2), int64(518), "Renamed", "Sub", `region\sub.xsde`, at, int64(10)}) {
		t.Errorf("update args %s", got)
	}
}

// flaggedDiagram is exportDiagram with statuses: item 1's component and meas1 scale edited and its equipment's ref
// changed (deleted + new), item 2 a new equipment binding, device 5 deleted.
func flaggedDiagram() *slddoc.Diagram {
	d := exportDiagram()
	e1 := &d.Elements[0]
	e1.Precision, e1.ComponentEdited = 4, true
	e1.Bindings[0].Ref, e1.Bindings[0].Status = "1024:50", slddoc.BindingNew
	e1.Bindings[1].Scale, e1.Bindings[1].Status = 2, slddoc.BindingEdited
	e2 := &d.Elements[1]
	e2.Bindings = append(e2.Bindings, slddoc.Binding{Source: "rsdu", Kind: slddoc.BindingEquipment, Ref: "1024:8", Status: slddoc.BindingNew})
	d.DigitalDevices = nil
	d.DeletedBindings = []slddoc.DeletedBinding{
		{Item: 1, Source: "rsdu", Kind: slddoc.BindingEquipment, Ref: "1024:5"},
		{Item: 5, Source: "rsdu", Kind: slddoc.BindingMeas1, Ref: "33:11"},
	}
	return d
}

// TestExportStatuses: only what the statuses name is written: a deleted binding's row goes (and a component left
// with nothing), a deleted-and-new one is deleted and inserted, an edited one updated in place, an edited component
// updated, a new one inserted. Unflagged items aren't even read.
func TestExportStatuses(t *testing.T) {
	f := newTxDB()
	comps, tunes, obj := exportedRows()
	stored(f, comps, tunes, obj)
	p := exportProvider(t, f, config.DriverPostgres)
	res, err := p.Export(context.Background(), "region/sub", flaggedDiagram(), binding.ExportRequest{})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"READ VS_COMP", "READ VS_REGIM_TUNE", "UPDATE VS_FORM", "DELETE VS_REGIM_TUNE", "DELETE VS_COMP",
		"DELETE VS_REGIM_TUNE", "UPDATE VS_COMP", "UPDATE VS_REGIM_TUNE", "INSERT VS_REGIM_TUNE"}
	if got := statements(f); !slices.Equal(got, want) {
		t.Fatalf("statements\n got %v\nwant %v", got, want)
	}
	for i, w := range map[int][]any{
		0: {int64(10), "1", "2", "5"},
		3: {int64(1003)},
		4: {int64(1003)},
		5: {int64(1001), int64(1), int64(1024)},
		6: {int64(6), int64(5), int64(4), int64(1001)},
		7: {int64(7), int64(11), int64(2), int64(1001), int64(2), int64(33)},
		8: {int64(1001), int64(1), int64(1024), int64(50), int64(10), int64(1), int64(1002), int64(1), int64(1024), int64(8), int64(10), int64(1)},
	} {
		if got := fmt.Sprint(f.args[i]); got != fmt.Sprint(w) {
			t.Errorf("%s args %s, want %v", statements(f)[i], got, w)
		}
	}
	if res.Changes != (binding.ExportChanges{Inserted: 2, Updated: 3, Deleted: 3}) {
		t.Errorf("result %+v", res)
	}
}

// TestExportStatusesIdempotent: statuses whose rows RSDU already has as they are write nothing: a new binding that is
// there, an edited one equal to it, a deleted one that is gone.
func TestExportStatusesIdempotent(t *testing.T) {
	f := newTxDB()
	comps, tunes, obj := exportedRows()
	stored(f, comps, tunes, obj)
	p := exportProvider(t, f, config.DriverPostgres)
	d := exportDiagram()
	d.Elements[0].Bindings[0].Status = slddoc.BindingNew
	d.Elements[0].Bindings[1].Status = slddoc.BindingEdited
	d.DeletedBindings = []slddoc.DeletedBinding{{Item: 2, Source: "rsdu", Kind: slddoc.BindingEquipment, Ref: "1024:1"}}
	res, err := p.Export(context.Background(), "region/sub", d, binding.ExportRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if got := statements(f); !slices.Equal(got, []string{"READ VS_COMP", "READ VS_REGIM_TUNE"}) || res.Changes != (binding.ExportChanges{}) {
		t.Errorf("statements %v, result %+v", got, res)
	}
}

// TestExportObject: a new object replaces the scheme's when the former one is deleted, a deleted one goes.
func TestExportObject(t *testing.T) {
	f := newTxDB()
	comps, tunes, obj := exportedRows()
	stored(f, comps, tunes, obj)
	p := exportProvider(t, f, config.DriverPostgres)
	d := exportDiagram()
	d.Elements, d.DigitalDevices = nil, nil
	d.Object.Ref, d.Object.Status = "1024:78", slddoc.BindingNew
	d.DeletedBindings = []slddoc.DeletedBinding{{Item: 0, Source: "rsdu", Kind: slddoc.BindingEquipment, Ref: "1024:77"}}
	if _, err := p.Export(context.Background(), "region/sub", d, binding.ExportRequest{}); err != nil {
		t.Fatal(err)
	}
	if got := statements(f); !slices.Equal(got, []string{"READ VS_OBJ_TUNE", "UPDATE VS_FORM", "DELETE VS_OBJ_TUNE", "INSERT VS_OBJ_TUNE"}) {
		t.Errorf("replace: %v", got)
	}
	f.execs, f.args = nil, nil
	d.Object = nil
	if _, err := p.Export(context.Background(), "region/sub", d, binding.ExportRequest{}); err != nil {
		t.Fatal(err)
	}
	if got := statements(f); !slices.Equal(got, []string{"READ VS_OBJ_TUNE", "UPDATE VS_FORM", "DELETE VS_OBJ_TUNE"}) {
		t.Errorf("delete: %v", got)
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
	if got := statements(f); !slices.Equal(got, []string{"NEXT VS_FORM_S", "INSERT VS_FORM", "INSERT VS_OBJ_TUNE", "NEXT VS_COMP_S", "INSERT VS_COMP", "INSERT VS_REGIM_TUNE"}) {
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
	comps, tunes, obj := exportedRows()
	stored(f, comps, tunes, obj)
	p := exportProvider(t, f, config.DriverPostgres)
	if _, err := p.Export(context.Background(), "region/sub", flaggedDiagram(), binding.ExportRequest{}); err == nil {
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
	res, err := p.Export(context.Background(), "region/sub", d, binding.ExportRequest{Register: true, Name: "N", Group: "3"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Components != 2 || res.Bindings != 2 {
		t.Errorf("result %+v", res)
	}
	comps := written(f, "INSERT INTO rsduadmin.VS_COMP ", 7)
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
	if _, err := p.Export(context.Background(), "region/sub", d, binding.ExportRequest{Register: true, Name: "N", Group: "3"}); err != nil {
		t.Fatal(err)
	}
	var types []string
	for _, c := range written(f, "INSERT INTO rsduadmin.VS_COMP ", 7) {
		types = append(types, fmt.Sprint(c[3], ":", c[2]))
	}
	// The scheme type's MODUS_TYPE 41 wins over the configured 99.
	if want := []string{"1:2000023", "2:6", "3:2000023", "4:6"}; !slices.Equal(types, want) {
		t.Errorf("component types %v, want %v", types, want)
	}
}

// TestExportPreview: a preview counts exactly the rows the export then changes, reads but writes nothing (no sequence
// value either) and rolls back; registering is counted without reading.
func TestExportPreview(t *testing.T) {
	for name, c := range map[string]struct {
		d    func() *slddoc.Diagram
		req  binding.ExportRequest
		want binding.ExportChanges
	}{
		"unflagged": {exportDiagram, binding.ExportRequest{}, binding.ExportChanges{}},
		"statuses":  {flaggedDiagram, binding.ExportRequest{}, binding.ExportChanges{Inserted: 2, Updated: 3, Deleted: 3}},
		"rename":    {exportDiagram, binding.ExportRequest{Name: "Renamed"}, binding.ExportChanges{Updated: 1}},
		"register":  {exportDiagram, binding.ExportRequest{Register: true, Name: "N", Group: "3"}, binding.ExportChanges{Inserted: 10}},
	} {
		t.Run(name, func(t *testing.T) {
			f := newTxDB()
			comps, tunes, obj := exportedRows()
			stored(f, comps, tunes, obj)
			p := exportProvider(t, f, config.DriverPostgres)
			d := c.d()
			if c.req.Register {
				d.Scheme = nil
			}
			req := c.req
			req.Preview = true
			res, err := p.Export(context.Background(), "region/sub", d, req)
			if err != nil {
				t.Fatal(err)
			}
			for _, st := range statements(f) {
				if !strings.HasPrefix(st, "READ ") {
					t.Errorf("preview ran %s", st)
				}
			}
			if !res.Preview || res.Changes != c.want || f.committed || !f.rolledBack {
				t.Errorf("preview %+v, committed %v, rolled back %v", res.Changes, f.committed, f.rolledBack)
			}
			f.execs, f.args, f.rolledBack = nil, nil, false
			d = c.d()
			if c.req.Register {
				d.Scheme = nil
			}
			done, err := p.Export(context.Background(), "region/sub", d, c.req)
			if err != nil {
				t.Fatal(err)
			}
			if done.Preview || done.Changes != res.Changes {
				t.Errorf("export changed %+v, preview said %+v", done.Changes, res.Changes)
			}
		})
	}
}
