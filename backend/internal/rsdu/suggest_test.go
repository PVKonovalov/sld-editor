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
)

// suggestDB is an RSDU with the equipment tree OBJ_TREE (1024, its alias only OBJ_TREE_DIR, as in PostgreSQL), the
// switch states PSWT_LIST_V (33) and their archive ARC_PSWT_LIST_V (2002), the electrical mode ELREG_LIST_V (29),
// panels VP_PANEL (40) and data acquisition DA_V_LST_1 (54). Objects: power switch 100, withdrawable switch 200,
// transformer 300, report 400; measurements: 1001 state of 100, 2001 state and 2002 drawer of 200, 3001 voltage of
// 300; panel 40:7; parameter 54:9.
func suggestDB(t *testing.T) *fakeDB {
	tables := map[int64][]any{
		1024: {"OBJ_TREE_DIR", "OBJ_TREE", "DIR", int64(0), "SYS_OTYP"},
		33:   {"PSWT_LIST_V_LST", "PSWT_LIST_V", "LST", int64(34), "PSWT_TLIST_V"},
		2002: {"ARC_PSWT_LIST_V_LST", "ARC_PSWT_LIST_V", "LST", int64(34), "PSWT_TLIST_V"},
		29:   {"ELREG_LIST_V_LST", "ELREG_LIST_V", "LST", int64(1026), "ELREG_TLIST_V"},
		40:   {"VP_PANEL_LST", "VP_PANEL", "LST", int64(41), "SYS_OTYP"},
		54:   {"DA_V_LST_1_LST", "DA_V_LST_1", "LST", int64(55), "SYS_DTYP_V"},
	}
	objects := map[int64][]any{
		100: {"Q1", nil, int64(10), int64(3), "OTYP_POWER_SWITCH", "Breaker"},
		200: {"W1", nil, int64(10), int64(4), "OTYP_POWER_SWITCH_WITHDRAWABLE", "Withdrawable breaker"},
		300: {"T1", nil, int64(10), int64(5), "OTYP_TWO_WINDING_TRANSFORMER", "Transformer"},
		400: {"Daily", nil, int64(10), int64(7), "OTYP_REPORT", "Report"},
	}
	meas := map[int64][]any{
		1001: {"Q1 state", nil, int64(1), int64(1), "MEAS_SWITCH_STATE", "Position"},
		2001: {"W1 state", nil, int64(1), int64(1), "MEAS_SWITCH_STATE", "Position"},
		2002: {"W1 drawer", nil, int64(1), int64(2), "MEAS_SWITCH_STATE_DRAWER", "Drawer position"},
		3001: {"T1 U", nil, int64(1), int64(3), "MEAS_U", "Voltage"},
	}
	owners := map[int64]int64{1001: 100, 2001: 200, 2002: 200, 3001: 300}
	switchMeas := map[int64][]int64{100: {1001}, 200: {2001, 2002}}
	measGlobal := map[string]string{
		"MEAS_SWITCH_STATE": "GLOBAL_TYPE_ENUMERATION", "MEAS_SWITCH_STATE_DRAWER": "GLOBAL_TYPE_BOOL", "MEAS_U": "GLOBAL_TYPE_ANALOG",
	}
	one := func(m map[int64][]any, id any) [][]any {
		if row, ok := m[id.(int64)]; ok {
			return [][]any{row}
		}
		return nil
	}
	typeCols := []string{"ID", "NAME", "DEFINE_ALIAS"}
	listCols := []string{"ID", "NAME", "ID_NODE", "ID_TYPE"}
	return &fakeDB{
		cols: map[string][]string{
			"OBJ_TREE": {"ID", "NAME", "ID_PARENT", "ID_TYPE", "GUID"}, "SYS_OTYP": typeCols,
			"PSWT_LIST_V": listCols, "ARC_PSWT_LIST_V": listCols, "PSWT_TLIST_V": typeCols,
			"ELREG_LIST_V": listCols, "ELREG_TLIST_V": typeCols, "VP_PANEL": listCols,
			"DA_V_LST_1": listCols, "SYS_DTYP_V": typeCols, "MEAS_LIST": {"ID", "ID_OBJ", "ID_MEAS_TYPE", "NAME", "GUID"},
		},
		rows: func(q string, args []any) [][]any {
			switch {
			case strings.Contains(q, "FROM rsduadmin.SYS_TBLLST tbl"):
				return one(tables, args[0])
			case strings.Contains(q, "FROM rsduadmin.SYS_OTYP") && len(args) == 0:
				return [][]any{
					{int64(1), int64(0), "OTYP_EQUIPMENT"}, {int64(2), int64(1), "OTYP_SWITCH"},
					{int64(3), int64(2), "OTYP_POWER_SWITCH"}, {int64(4), int64(3), "OTYP_POWER_SWITCH_WITHDRAWABLE"},
					{int64(5), int64(1), "OTYP_TWO_WINDING_TRANSFORMER"}, {int64(6), int64(0), "OTYP_INFORMATION_VIEW"},
					{int64(7), int64(6), "OTYP_REPORT"}, {int64(8), int64(0), "OTYP_DEVICE_PANEL"},
				}
			case strings.Contains(q, "SYS_MEAS_TYPES m JOIN") && len(args) == 0:
				var out [][]any
				for k, v := range measGlobal {
					out = append(out, []any{k, v})
				}
				return out
			case strings.Contains(q, "SYS_MEAS_TYPES m JOIN"):
				if g, ok := measGlobal[args[0].(string)]; ok {
					return [][]any{{g}}
				}
				return nil
			case strings.Contains(q, "SYS_TBLREF WHERE ID_LINK"):
				if args[0] != measListLink || args[1] != measListGen {
					t.Errorf("measurement tables args %v", args)
				}
				return [][]any{{int64(29), "ELREG_LIST_V"}, {int64(33), "PSWT_LIST_V"}, {int64(2002), "ARC_PSWT_LIST_V"}}
			case strings.Contains(q, "OR UPPER(TABLE_NAME) ="):
				return [][]any{{int64(1024), "OBJ_TREE_DIR", "OBJ_TREE"}}
			case strings.Contains(q, "JOIN rsduadmin.MEAS_LIST meas ON meas.ID = v.ID"):
				// One UNION ALL over the tables in id order; switch measurements are in 33 and 2002.
				if !strings.Contains(q, "SELECT 29,") || !strings.Contains(q, " UNION ALL SELECT 33,") || !strings.HasSuffix(q, "ORDER BY 1, 2") {
					t.Errorf("switch measurements query %q", q)
				}
				var out [][]any
				for _, tid := range []int64{33, 2002} {
					for _, m := range switchMeas[args[0].(int64)] {
						row := meas[m]
						out = append(out, []any{tid, m, nil, row[0], row[4], row[5]})
					}
				}
				return out
			case strings.Contains(q, "FROM rsduadmin.OBJ_TREE obj"):
				o, ok := owners[args[0].(int64)]
				if !ok {
					return nil
				}
				row := objects[o]
				return [][]any{{o, nil, row[0], row[4], row[5]}}
			case strings.Contains(q, "FROM rsduadmin.OBJ_TREE o "):
				return one(objects, args[0])
			case strings.Contains(q, "PSWT_LIST_V o"), strings.Contains(q, "FROM rsduadmin.ELREG_LIST_V o"):
				return one(meas, args[0])
			case strings.Contains(q, "FROM rsduadmin.VP_PANEL o"):
				return [][]any{{"Overview panel", nil, int64(1), int64(8), "OTYP_DEVICE_PANEL", "Device panel"}}
			case strings.Contains(q, "FROM rsduadmin.DA_V_LST_1 o"):
				return [][]any{{"Ia", nil, int64(1), int64(405), nil, "Base analog"}}
			case strings.Contains(q, "SYS_DTYP d"):
				return [][]any{{"GLOBAL_TYPE_ANALOG"}}
			}
			t.Fatalf("unexpected query %q %v", q, args)
			return nil
		},
	}
}

// brief is "kind ref option name" per binding.
func brief(bs []slddoc.Binding) []string {
	out := make([]string, len(bs))
	for i, b := range bs {
		if b.Source != "rsdu" {
			out[i] = "source " + b.Source
			continue
		}
		out[i] = fmt.Sprintf("%s %s %s %s", b.Kind, b.Ref, b.Option, b.Name)
	}
	return out
}

func TestSuggest(t *testing.T) {
	cases := []struct {
		name, ref string
		want      []string
	}{
		{"power switch: equipment and its state", "1024:100", []string{
			"equipment 1024:100 GLT_OBJECT_OPT_COMPLEX Q1",
			"meas1 33:1001 GLT_BOOL_OPT_INSTANT Q1 state",
		}},
		{"withdrawable switch: equipment, state and drawer", "1024:200", []string{
			"equipment 1024:200 GLT_OBJECT_OPT_COMPLEX W1",
			"meas1 33:2001 GLT_BOOL_OPT_INSTANT W1 state",
			"meas2 33:2002 GLT_BOOL_OPT_INSTANT W1 drawer",
		}},
		{"plain object: equipment only", "1024:300", []string{"equipment 1024:300 GLT_OBJECT_OPT_COMPLEX T1"}},
		{"report (information view): jump", "1024:400", []string{"jump 1024:400 GLT_OBJECT_OPT_COMPLEX Daily"}},
		{"device panel: jump", "40:7", []string{"jump 40:7 GLT_OBJECT_OPT_COMPLEX Overview panel"}},
		{"switch state: itself and its owner", "33:1001", []string{
			"equipment 1024:100 GLT_OBJECT_OPT_COMPLEX Q1",
			"meas1 33:1001 GLT_BOOL_OPT_INSTANT Q1 state",
		}},
		{"switch state of a withdrawable: also the drawer", "2002:2001", []string{
			"equipment 1024:200 GLT_OBJECT_OPT_COMPLEX W1",
			"meas1 2002:2001 GLT_BOOL_OPT_INSTANT W1 state",
			"meas2 33:2002 GLT_BOOL_OPT_INSTANT W1 drawer",
		}},
		{"drawer: meas2, with the switch state as meas1", "33:2002", []string{
			"equipment 1024:200 GLT_OBJECT_OPT_COMPLEX W1",
			"meas1 33:2001 GLT_BOOL_OPT_INSTANT W1 state",
			"meas2 33:2002 GLT_BOOL_OPT_INSTANT W1 drawer",
		}},
		{"other measurement: itself only", "29:3001", []string{"meas1 29:3001 GLT_ANALOG_OPT_INSTANT T1 U"}},
		{"type without alias: nothing", "54:9", []string{}},
	}
	f := suggestDB(t)
	p := newFakeProvider(t, f)
	for _, c := range cases {
		got, err := p.Suggest(context.Background(), c.ref, binding.Element{Shape: "41", Class: "Breaker"})
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got == nil || !slices.Equal(brief(got), c.want) {
			t.Errorf("%s:\n got %q\nwant %q", c.name, brief(got), c.want)
		}
	}
	// The type model is read once.
	n := 0
	for _, q := range f.queries {
		if strings.Contains(q, "SYS_TBLREF WHERE ID_LINK") {
			n++
		}
	}
	if n != 1 {
		t.Errorf("measurement tables read %d times", n)
	}
	if q := f.query("JOIN rsduadmin.MEAS_LIST meas ON meas.ID = v.ID"); !strings.Contains(q, "meas.GUID") {
		t.Errorf("switch measurements query without GUID: %q", q)
	}
}

func TestSuggestErrors(t *testing.T) {
	p := newFakeProvider(t, suggestDB(t))
	if _, err := p.Suggest(context.Background(), "nope", binding.Element{}); !errors.Is(err, binding.ErrInvalid) {
		t.Errorf("bad ref: %v", err)
	}
	if _, err := p.Suggest(context.Background(), "999:1", binding.Element{}); !errors.Is(err, binding.ErrNotFound) {
		t.Errorf("unknown table: %v", err)
	}
}
