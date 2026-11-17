package rsdu

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
)

// resolveDB is an RSDU with a data acquisition list (table 54, types SYS_DTYP_V, catalog 55), an electrical mode list
// (29, types ELREG_TLIST_V, without GUID), an equipment list (1231, types SYS_OTYP), schemes (43, VS_FORM_LST), an
// electrical mode catalog (1026, DIR) and the object tree (28, GEN).
func resolveDB(t *testing.T) *fakeDB {
	tables := map[int64][]any{
		54:   {"DA_V_LST_1_LST", "DA_V_LST_1", "LST", int64(55), "SYS_DTYP_V"},
		29:   {"ELREG_LIST_V_LST", "ELREG_LIST_V", "LST", int64(1026), "ELREG_TLIST_V"},
		1231: {"OBJ_TREE_PIN_V_LST", "OBJ_TREE_PIN_V", "LST", int64(1024), "SYS_OTYP"},
		43:   {"VS_FORM_LST", "VS_FORM", "LST", int64(44), "SYS_OTYP"},
		1026: {"ELREG_TREE_DIR", "ELREG_TREE", "DIR", int64(0), "ELREG_TTREE"},
		28:   {"SYS_TREE21_SIM", "SYS_TREE21", "GEN", int64(0), nil},
	}
	guid := []byte{0x52, 0x19, 0x1b, 0x7b, 0x0d, 0x43, 0x50, 0xfa, 0xe0, 0x63, 0x29, 0xa5, 0x05, 0x0a, 0x91, 0x50}
	return &fakeDB{
		cols: map[string][]string{
			"DA_V_LST_1":     {"ID", "NAME", "ID_NODE", "ID_TYPE", "GUID"},
			"SYS_DTYP_V":     {"ID", "NAME", "DEFINE_ALIAS"},
			"ELREG_LIST_V":   {"ID", "NAME", "ID_NODE", "ID_TYPE"},
			"ELREG_TLIST_V":  {"ID", "NAME", "DEFINE_ALIAS"},
			"OBJ_TREE_PIN_V": {"ID", "NAME", "ID_NODE", "ID_TYPE", "GUID"},
			"SYS_OTYP":       {"ID", "NAME", "DEFINE_ALIAS"},
			"VS_FORM":        {"ID", "NAME", "ID_NODE", "ID_TYPE"},
			"ELREG_TREE":     {"ID", "NAME", "ID_PARENT"},
		},
		rows: func(q string, args []any) [][]any {
			switch {
			case strings.Contains(q, "FROM rsduadmin.SYS_TBLLST tbl"):
				if row, ok := tables[args[0].(int64)]; ok {
					return [][]any{row}
				}
				return nil
			case strings.Contains(q, "SYS_DTYP d"):
				if args[0] == int64(406) {
					return [][]any{{"GLOBAL_TYPE_BOOL"}}
				}
				return [][]any{{"GLOBAL_TYPE_ANALOG"}}
			case strings.Contains(q, "SYS_MEAS_TYPES"):
				if args[0] == "MEAS_SWITCH" {
					return [][]any{{"GLOBAL_TYPE_ENUMERATION"}}
				}
				return nil
			case strings.Contains(q, "FROM rsduadmin.DA_V_LST_1 o"):
				switch args[0] {
				case int64(10):
					return [][]any{{"Breaker state", guid, int64(7), int64(406), nil, "Base bool"}}
				case int64(11):
					return [][]any{{"Current", nil, int64(7), int64(405), nil, "Base analog"}}
				}
				return nil
			case strings.Contains(q, "FROM rsduadmin.ELREG_LIST_V o"):
				switch args[0] {
				case int64(20):
					return [][]any{{"Voltage", nil, int64(3), int64(13), "MEAS_U", "Voltage"}}
				case int64(21):
					return [][]any{{"Position", nil, int64(3), int64(14), "MEAS_SWITCH", "Switch position"}}
				}
				return nil
			case strings.Contains(q, "FROM rsduadmin.OBJ_TREE_PIN_V o"):
				return [][]any{{"Breaker Q1", guid, int64(0), int64(5), "OTYP_BREAKER", "Breaker"}}
			case strings.Contains(q, "FROM rsduadmin.VS_FORM o"):
				return [][]any{{"Overview", nil, int64(2), int64(9), "OTYP_MODUS_SCHEME", "Scheme"}}
			case strings.Contains(q, "FROM rsduadmin.ELREG_TREE o"):
				return [][]any{{"Substation", nil, int64(4), nil, nil, nil}}
			}
			t.Fatalf("unexpected query %q %v", q, args)
			return nil
		},
	}
}

func TestResolve(t *testing.T) {
	cases := []struct {
		ref  string
		want binding.Resolved
	}{
		{"54:10", binding.Resolved{Ref: "54:10", Name: "Breaker state", TypeName: "Base bool", UID: "52191b7b-0d43-50fa-e063-29a5050a9150",
			ParentRef: "55:7", Kind: slddoc.BindingMeas1, Option: optionBool}},
		{"54:11", binding.Resolved{Ref: "54:11", Name: "Current", TypeName: "Base analog", ParentRef: "55:7", Kind: slddoc.BindingMeas1, Option: optionAnalog}},
		{"29:20", binding.Resolved{Ref: "29:20", Name: "Voltage", Type: "MEAS_U", TypeName: "Voltage", ParentRef: "1026:3", Kind: slddoc.BindingMeas1, Option: optionAnalog}},
		{"29:21", binding.Resolved{Ref: "29:21", Name: "Position", Type: "MEAS_SWITCH", TypeName: "Switch position", ParentRef: "1026:3", Kind: slddoc.BindingMeas1, Option: optionBool}},
		{"1231:1", binding.Resolved{Ref: "1231:1", Name: "Breaker Q1", Type: "OTYP_BREAKER", TypeName: "Breaker", UID: "52191b7b-0d43-50fa-e063-29a5050a9150",
			Kind: slddoc.BindingEquipment, Option: optionComplex}},
		{" 43:5 ", binding.Resolved{Ref: "43:5", Name: "Overview", Type: "OTYP_MODUS_SCHEME", TypeName: "Scheme", ParentRef: "44:2", Kind: slddoc.BindingJump, Option: optionComplex}},
		{"1026:8", binding.Resolved{Ref: "1026:8", Name: "Substation", ParentRef: "1026:4", Kind: slddoc.BindingMeas1, Option: optionAnalog}},
	}
	f := resolveDB(t)
	p := newFakeProvider(t, f)
	for _, c := range cases {
		got, err := p.Resolve(context.Background(), c.ref)
		if err != nil {
			t.Fatalf("%s: %v", c.ref, err)
		}
		if *got != c.want {
			t.Errorf("%s:\n got %+v\nwant %+v", c.ref, *got, c.want)
		}
	}
	// The electrical mode list has no GUID column: it isn't selected.
	if q := f.query("FROM rsduadmin.ELREG_LIST_V o"); strings.Contains(q, "GUID") || !strings.Contains(q, "LEFT JOIN rsduadmin.ELREG_TLIST_V t") {
		t.Errorf("electrical mode query = %q", q)
	}
	// Table information is read once per table.
	n := 0
	for _, q := range f.queries {
		if strings.Contains(q, "FROM rsduadmin.SYS_TBLLST tbl") {
			n++
		}
	}
	if n != 5 {
		t.Errorf("table information read %d times, want 5", n)
	}
}

func TestResolveErrors(t *testing.T) {
	p := newFakeProvider(t, resolveDB(t))
	cases := []struct {
		ref  string
		want error
	}{
		{"", binding.ErrInvalid},
		{"54", binding.ErrInvalid},
		{"54:x", binding.ErrInvalid},
		{"0:5", binding.ErrInvalid},
		{"28:1", binding.ErrInvalid},
		{"999:1", binding.ErrNotFound},
		{"54:12", binding.ErrNotFound},
	}
	for _, c := range cases {
		if _, err := p.Resolve(context.Background(), c.ref); !errors.Is(err, c.want) {
			t.Errorf("%q: err = %v, want %v", c.ref, err, c.want)
		}
	}
}

func TestResolveAll(t *testing.T) {
	p := newFakeProvider(t, resolveDB(t))
	found, missing, err := binding.ResolveAll(context.Background(), p, []string{"54:10", "28:1", "54:10", "54:12", "29:20"})
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 2 || found["54:10"].Name != "Breaker state" || found["29:20"].Name != "Voltage" {
		t.Errorf("found = %v", found)
	}
	if strings.Join(missing, ",") != "28:1,54:12" {
		t.Errorf("missing = %v", missing)
	}

	down := newFakeProvider(t, &fakeDB{rows: func(string, []any) [][]any { return nil }})
	down.read = failingQuerier{}
	if _, _, err := binding.ResolveAll(context.Background(), down, []string{"54:10"}); err == nil || errors.Is(err, binding.ErrNotFound) {
		t.Errorf("data source down: err = %v", err)
	}
}

type failingQuerier struct{}

func (failingQuerier) Query(context.Context, string, ...any) (Rows, error) {
	return nil, errors.New("connection refused")
}
