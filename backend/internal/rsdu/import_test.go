package rsdu

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
	"sld-editor/internal/config"
)

// importDB is a scheme 10 with components of items 3, 5, 7, 8 and one whose name is not an id.
func importDB() *fakeDB {
	tables := map[int64][]any{
		33:   {"PSWT_LIST_V_LST", "PSWT_LIST_V", "LST", int64(30), "SYS_PTYP"},
		43:   {"VS_FORM_LST", "VS_FORM", "LST", int64(0), nil},
		1024: {"OBJ_TREE_DIR", "OBJ_TREE", "DIR", int64(0), "SYS_OTYP"},
	}
	objects := map[string][][]any{
		"PSWT_LIST_V": {{int64(20), "Switch 20", nil, "TS"}, {int64(21), "Switch 21", nil, "TS"}, {int64(22), "Power", nil, "TI"}, {int64(23), "Switch 23", nil, "TS"}},
		"VS_FORM":     {{int64(2000), "Other scheme", nil, nil}},
		"OBJ_TREE":    {{int64(10), "Bay", "a59748a5-2c5f-4f44-9f7c-3d2da6522858", "BAY"}, {int64(11), "Line", nil, "LINE"}},
	}
	tune := func(comp int64, regim string, table, param int64, option string, scale int64) []any {
		return []any{comp, regim, table, param, option, scale}
	}
	return &fakeDB{
		cols: map[string][]string{
			"PSWT_LIST_V": {"ID", "NAME", "ID_TYPE", "GUID"}, "SYS_PTYP": {"ID", "DEFINE_ALIAS"},
			"VS_FORM": {"ID", "NAME"}, "OBJ_TREE": {"ID", "NAME", "ID_TYPE", "GUID"}, "SYS_OTYP": {"ID", "DEFINE_ALIAS"},
		},
		rows: func(q string, args []any) [][]any {
			switch {
			case strings.Contains(q, "FROM rsduadmin.VS_FORM f"):
				return [][]any{{int64(10), int64(2), int64(518), "Sub", nil, "MODUS", `a\sub.xsde`, nil}}
			case strings.HasPrefix(q, "SELECT ID, ALIAS, DEFINE_ALIAS FROM rsduadmin.VS_REGIM"):
				return [][]any{{int64(1), "Equipment", "EQUIPMENT"}, {int64(2), "Parameters", "ADJUST_REGIM"}, {int64(3), "Additional", "ADJUST_ADDITIONAL"}, {int64(4), "Topology", "ADJUST_TOPOLOGY"}}
			case strings.Contains(q, "FROM rsduadmin.SYS_GTOPT o JOIN"):
				return [][]any{{int64(8), "Bool", optionBool, "B", "Bools"}, {int64(30), "Complex", optionComplex, "O", "Objects"}}
			case strings.Contains(q, "FROM rsduadmin.VS_COMP_FEATURE"):
				return [][]any{{int64(1), "One", "F1"}, {int64(2), "Two", "F2"}, {int64(4), "Four", "F4"}}
			case strings.Contains(q, "FROM rsduadmin.VS_COMP c LEFT JOIN"):
				return [][]any{
					{int64(501), "3", int64(2), int64(5), int64(41)},
					{int64(502), " 5 ", nil, nil, int64(134)},
					{int64(503), "x1", nil, nil, nil},
					{int64(504), "7", nil, nil, int64(41)},
					{int64(505), "8", nil, nil, nil},
				}
			case strings.Contains(q, "FROM rsduadmin.VS_REGIM_TUNE t"):
				return [][]any{
					tune(501, "EQUIPMENT", 1024, 10, optionComplex, 1),
					tune(501, "ADJUST_REGIM", 33, 20, optionBool, -1),
					tune(501, "ADJUST_REGIM", 43, 2000, optionComplex, 1),
					tune(501, "ADJUST_ADDITIONAL", 33, 21, optionBool, 1),
					tune(502, "ADJUST_REGIM", 33, 22, optionAnalog, 1),
					tune(502, "ADJUST_ADDITIONAL", 33, 99, optionBool, 1),
					tune(503, "ADJUST_REGIM", 33, 20, optionBool, 1),
					tune(504, "ADJUST_TOPOLOGY", 33, 20, optionBool, 1),
					tune(504, "ADJUST_REGIM", 33, 23, optionBool, 1),
					tune(504, "ADJUST_REGIM", 116, 5, optionBool, 1),
					tune(505, "ADJUST_REGIM", 1024, 11, optionComplex, 1),
				}
			case strings.Contains(q, "FROM rsduadmin.VS_OBJ_TUNE"):
				return [][]any{{int64(1024), int64(10)}}
			case strings.Contains(q, "FROM rsduadmin.SYS_TBLLST tbl"):
				if row, ok := tables[args[0].(int64)]; ok {
					return [][]any{row}
				}
				return nil
			case strings.Contains(q, "WHERE o.ID IN"):
				for name, rows := range objects {
					if strings.Contains(q, "FROM rsduadmin."+name+" o") {
						var out [][]any
						for _, r := range rows {
							if slices.Contains(args, r[0]) {
								out = append(out, r)
							}
						}
						return out
					}
				}
			}
			return nil
		},
	}
}

func bindingText(b slddoc.Binding) string {
	return fmt.Sprintf("%s %s %s %d %q %s %s", b.Kind, b.Ref, b.Option, b.Scale, b.Name, b.Type, b.UID)
}

func TestSchemeBindings(t *testing.T) {
	for _, driver := range []string{config.DriverPostgres, config.DriverOracle} {
		t.Run(driver, func(t *testing.T) {
			d, err := NewDialect(driver, "")
			if err != nil {
				t.Fatal(err)
			}
			db := importDB()
			p := newProvider(config.RSDUBindings{}, d, db)
			res, err := p.SchemeBindings(context.Background(), "10")
			if err != nil {
				t.Fatal(err)
			}
			if res.Scheme.Ref != "10" || res.Object == nil || bindingText(*res.Object) != bindingText(slddoc.Binding{Kind: slddoc.BindingEquipment, Ref: "1024:10", Option: optionComplex, Name: "Bay", Type: "BAY", UID: "a59748a5-2c5f-4f44-9f7c-3d2da6522858"}) {
				t.Errorf("scheme %+v, object %+v", res.Scheme, res.Object)
			}
			var items []int
			for _, c := range res.Components {
				items = append(items, c.Item)
			}
			if !slices.Equal(items, []int{3, 5, 7, 8}) {
				t.Fatalf("items %v", items)
			}
			c := res.Components[0]
			if c.Shape != "41" || c.Precision != 2 || c.Features != "F1,F4" {
				t.Errorf("component 3: %+v", c)
			}
			var got []string
			for _, b := range c.Bindings {
				if b.Source != config.ProviderRSDU {
					t.Errorf("source %q", b.Source)
				}
				got = append(got, bindingText(b))
			}
			want := []string{
				`equipment 1024:10 GLT_OBJECT_OPT_COMPLEX 0 "Bay" BAY a59748a5-2c5f-4f44-9f7c-3d2da6522858`,
				`meas1 33:20 GLT_BOOL_OPT_INSTANT -1 "Switch 20" TS `,
				`meas2 33:21 GLT_BOOL_OPT_INSTANT 0 "Switch 21" TS `,
				`jump 43:2000 GLT_OBJECT_OPT_COMPLEX 0 "Other scheme"  `,
			}
			if !slices.Equal(got, want) {
				t.Errorf("component 3 bindings\n got %q\nwant %q", got, want)
			}
			if c := res.Components[1]; c.Shape != "134" || len(c.Bindings) != 2 || c.Bindings[1].Name != "" || c.Features != "" {
				t.Errorf("component 5: %+v", c)
			}
			if c := res.Components[2]; len(c.Bindings) != 1 || c.Bindings[0].Ref != "33:23" {
				t.Errorf("component 7: %+v", c)
			}
			// A complex parameter binding is a jump only to a scheme, frame, panel or report.
			if c := res.Components[3]; c.Shape != "" || len(c.Bindings) != 1 || c.Bindings[0].Kind != slddoc.BindingMeas1 || c.Bindings[0].Name != "Line" {
				t.Errorf("component 8: %+v", c)
			}
			var issues []string
			for _, i := range res.Issues {
				issues = append(issues, fmt.Sprintf("%s:%d:%s", i.Code, i.Item, i.Detail))
			}
			slices.Sort(issues)
			wantIssues := []string{"badComponent:0:x1", "duplicate:7:meas1 116:5", "missingObject:5:33:99", "unknownKind:7:ADJUST_TOPOLOGY"}
			if !slices.Equal(issues, wantIssues) {
				t.Errorf("issues\n got %v\nwant %v", issues, wantIssues)
			}
		})
	}

	p := newProvider(config.RSDUBindings{}, mustDialect(t), importDB())
	p.read = &fakeDB{rows: func(string, []any) [][]any { return nil }}
	if _, err := p.SchemeBindings(context.Background(), "10"); err == nil || !strings.Contains(err.Error(), binding.ErrNotFound.Error()) {
		t.Errorf("missing scheme: %v", err)
	}
}
