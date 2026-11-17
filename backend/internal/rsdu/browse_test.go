package rsdu

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"sld-editor/internal/binding"
	"sld-editor/internal/config"
)

// fakeDB answers the column dictionary from cols and every other query from rows.
type fakeDB struct {
	cols    map[string][]string
	rows    func(q string, args []any) [][]any
	queries []string
}

func (f *fakeDB) Query(_ context.Context, q string, args ...any) (Rows, error) {
	f.queries = append(f.queries, q)
	if strings.Contains(q, "ALL_TAB_COLUMNS") || strings.Contains(q, "information_schema.columns") {
		var out [][]any
		for _, c := range f.cols[strings.ToUpper(args[1].(string))] {
			out = append(out, []any{c})
		}
		return &fakeRows{rows: out, i: -1}, nil
	}
	return &fakeRows{rows: f.rows(q, args), i: -1}, nil
}

// query returns the first recorded query containing all parts.
func (f *fakeDB) query(parts ...string) string {
	for _, q := range f.queries {
		if !slices.ContainsFunc(parts, func(p string) bool { return !strings.Contains(q, p) }) {
			return q
		}
	}
	return ""
}

func newFakeProvider(t *testing.T, f *fakeDB) *Provider {
	t.Helper()
	d, err := NewDialect(config.DriverPostgres, "")
	if err != nil {
		t.Fatal(err)
	}
	return newProvider(config.RSDUBindings{}, d, f)
}

func TestForest(t *testing.T) {
	ids := []int64{1, 2, 3, 4, 5, 6, 7}
	parents := []int64{0, 1, 1, 99, 6, 5, 0}
	names := []string{"root", "b", "A", "orphan", "cycle-x", "cycle-y", "Another"}
	top, children := forest(ids, parents, names)
	got := walk(top, children, func(i int, kids []string) string {
		return names[i] + "(" + strings.Join(kids, ",") + ")"
	})
	want := []string{"Another()", "orphan()", "root(A(),b())", "cycle-x(cycle-y())"}
	if !slices.Equal(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestSections(t *testing.T) {
	f := &fakeDB{rows: func(q string, args []any) [][]any {
		switch {
		case strings.Contains(q, "SYS_TBLLST WHERE TABLE_NAME"):
			if args[0] != "SYS_TREE21" {
				t.Errorf("table id of %v", args[0])
			}
			return [][]any{{int64(28)}}
		case strings.Contains(q, "SYS_TREE21"):
			return [][]any{
				{int64(1), int64(0), int64(0), "Root", int64(159)},
				{int64(5), int64(1), int64(0), "Tech", int64(28)},
				{int64(31), int64(5), int64(29), "Electrical", int64(27)},
				{int64(3), int64(1), int64(7), "Apps", int64(4)},
				{int64(77), int64(500), int64(1), "Orphan", int64(0)},
				{int64(88), int64(0), int64(0), "Other root", int64(0)},
			}
		}
		t.Fatalf("unexpected query %q", q)
		return nil
	}}
	got, err := newFakeProvider(t, f).Sections(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := []binding.Section{{
		ID: "1", Name: "Root", Icon: 159, Ref: "28:1", Children: []binding.Section{
			{ID: "3", Name: "Apps", Icon: 4, Section: "7", Ref: "28:3"},
			{ID: "5", Name: "Tech", Icon: 28, Ref: "28:5", Children: []binding.Section{
				{ID: "31", Name: "Electrical", Icon: 27, Section: "29", Ref: "28:31"},
			}},
		},
	}}
	if !sectionsEqual(got, want) {
		t.Errorf("got %+v", got)
	}
}

func sectionsEqual(a, b []binding.Section) bool {
	return slices.EqualFunc(a, b, func(x, y binding.Section) bool {
		return x.ID == y.ID && x.Name == y.Name && x.Icon == y.Icon && x.Section == y.Section && x.Ref == y.Ref &&
			sectionsEqual(x.Children, y.Children)
	})
}

// sectionRows answers the SYS_TABL_V lookup of section 29 with lst, DIR id 1012 and dir/tdir.
func sectionRows(q string, args []any, lst, dir, tdir any) ([][]any, bool) {
	if !strings.Contains(q, "SYS_TABL_V") {
		return nil, false
	}
	if args[0] != int64(29) {
		return [][]any{}, true
	}
	return [][]any{{lst, int64(1012), dir, tdir}}, true
}

func TestCatalog(t *testing.T) {
	for _, withAlias := range []bool{true, false} {
		dirCols := []string{"ID", "ID_PARENT", "NAME", "ID_TYPE"}
		if withAlias {
			dirCols = append(dirCols, "ALIAS")
		}
		f := &fakeDB{cols: map[string][]string{"ELREG_DIR_V": dirCols, "ELREG_TDIR_V": {"ID", "NAME", "ID_ICON"}}}
		f.rows = func(q string, args []any) [][]any {
			if r, ok := sectionRows(q, args, "ELREG_LIST_V", "ELREG_DIR_V", "ELREG_TDIR_V"); ok {
				return r
			}
			alias := func(s string) any {
				if withAlias {
					return s
				}
				return nil
			}
			return [][]any{
				{int64(10), int64(0), "Substation", "PS", int64(5), alias("ps1 ")},
				{int64(0), int64(0), "bad", "x", int64(0), nil},
				{int64(12), int64(10), "Bay 2", "Bay", int64(6), alias("")},
				{int64(11), int64(10), "Bay 1", "Bay", int64(6), alias("b1")},
				{int64(13), int64(404), "Lost", nil, int64(0), nil},
			}
		}
		got, err := newFakeProvider(t, f).Catalog(context.Background(), "29")
		if err != nil {
			t.Fatal(err)
		}
		q := f.query("FROM rsduadmin.ELREG_DIR_V a JOIN rsduadmin.ELREG_TDIR_V b ON a.ID_TYPE = b.ID")
		if q == "" || strings.Contains(q, "a.ALIAS") != withAlias {
			t.Errorf("alias %v: catalog query %q", withAlias, q)
		}
		if len(got) != 2 || got[0].Name != "Lost" || got[1].Ref != "1012:10" || got[1].TypeName != "PS" || got[1].Icon != 5 {
			t.Fatalf("alias %v: top = %+v", withAlias, got)
		}
		kids := got[1].Children
		if len(kids) != 2 || kids[0].Name != "Bay 1" || kids[1].Ref != "1012:12" {
			t.Errorf("children = %+v", kids)
		}
		if wantAlias := map[bool]string{true: "ps1", false: ""}[withAlias]; got[1].Alias != wantAlias {
			t.Errorf("alias = %q, want %q", got[1].Alias, wantAlias)
		}
	}
}

func TestCatalogErrors(t *testing.T) {
	cases := []struct {
		name, section string
		dir           any
		want          error
		wantText      string
	}{
		{"bad id", "x", "D", binding.ErrInvalid, ""},
		{"unknown section", "30", "D", binding.ErrNotFound, ""},
		{"no catalog", "29", nil, binding.ErrNotFound, ""},
		{"injected table name", "29", "D; DROP TABLE X", nil, "plain identifier"},
		{"missing table", "29", "NO_SUCH", nil, "does not exist"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := &fakeDB{rows: func(q string, args []any) [][]any {
				r, _ := sectionRows(q, args, "L", c.dir, "T")
				return r
			}}
			_, err := newFakeProvider(t, f).Catalog(context.Background(), c.section)
			if err == nil || (c.want != nil && !errors.Is(err, c.want)) || !strings.Contains(err.Error(), c.wantText) {
				t.Errorf("got %v", err)
			}
			if slices.ContainsFunc(f.queries, func(q string) bool { return strings.Contains(q, "DROP") }) {
				t.Error("injected name reached SQL")
			}
		})
	}
}

func TestList(t *testing.T) {
	scale := 0.5
	cases := []struct {
		name, lst string
		lstCols   []string
		tblref    string // SYS_TBLREF ID_LINK = 4 types table; "" none
		wantFrom  []string
		wantNull  int // NULL placeholders in the select list
		da        bool
	}{
		{"types by tblref, class", "ELREG_LIST_V", []string{"ID", "NAME", "ID_NODE", "ID_TYPE", "ID_UCLASS"}, "ELREG_TLIST_V",
			[]string{"LEFT JOIN rsduadmin.ELREG_TLIST_V b ON b.ID = a.ID_TYPE", "LEFT JOIN rsduadmin.SYS_UCLS c ON c.ID = a.ID_UCLASS"}, 2, false},
		{"layout list falls back to meas types", "LO_LIST", []string{"ID", "NAME", "ID_NODE", "ID_TYPE"}, "",
			[]string{"LEFT JOIN rsduadmin.SYS_MEAS_TYPES b"}, 3, false},
		{"DA list falls back to dtyp, with DA columns", "DA_V_LST_1", []string{"ID", "NAME", "ID_NODE", "ID_TYPE", "ID_UCLASS"}, "",
			[]string{"LEFT JOIN rsduadmin.SYS_DTYP b", "LEFT JOIN rsduadmin.DA_PARAM e ON e.ID = a.ID LEFT JOIN rsduadmin.DA_DEV_DESC d ON d.ID = e.ID_POINT"}, 0, true},
		{"other list falls back to otyp", "PSWT_LIST_V", []string{"ID", "NAME", "ID_NODE", "ID_TYPE"}, "",
			[]string{"LEFT JOIN rsduadmin.SYS_OTYP b"}, 3, false},
		{"no type, no class", "AD_LIST", []string{"ID", "NAME", "ID_NODE"}, "",
			[]string{"FROM rsduadmin.AD_LIST a WHERE a.ID_NODE = $1"}, 4, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := &fakeDB{cols: map[string][]string{
				c.lst: c.lstCols, "ELREG_TLIST_V": {"ID", "ALIAS"}, "SYS_MEAS_TYPES": {"ID", "ALIAS"},
				"SYS_DTYP": {"ID", "ALIAS"}, "SYS_OTYP": {"ID", "ALIAS"}, "SYS_UCLS": {"ID", "NAME"},
				"DA_PARAM": {"ID", "ID_POINT", "SCALE"}, "DA_DEV_DESC": {"ID", "CVALIF"},
			}}
			f.rows = func(q string, args []any) [][]any {
				if r, ok := sectionRows(q, args, c.lst, "DIR", "TDIR"); ok {
					return r
				}
				if strings.Contains(q, "SYS_TBLREF") {
					if c.tblref == "" {
						return nil
					}
					return [][]any{{c.tblref}}
				}
				if args[0] != int64(7) {
					t.Errorf("node = %v", args[0])
				}
				return [][]any{
					{int64(2), "U phase B", "TI ", nil, nil, nil},
					{int64(1), "I phase A", "TI", "Feeder", int64(3), scale},
				}
			}
			got, err := newFakeProvider(t, f).List(context.Background(), "29", "7")
			if err != nil {
				t.Fatal(err)
			}
			q := f.query("SELECT DISTINCT a.ID, a.NAME")
			for _, w := range c.wantFrom {
				if !strings.Contains(q, w) {
					t.Errorf("query %q lacks %q", q, w)
				}
			}
			if n := strings.Count(q, "NULL"); n != c.wantNull {
				t.Errorf("query %q has %d NULLs, want %d", q, n, c.wantNull)
			}
			if len(got) != 2 || got[0].Name != "I phase A" || got[0].Ref != "29:1" || got[1].TypeAlias != "TI" || got[0].Class != "Feeder" {
				t.Fatalf("objects = %+v", got)
			}
			if c.da != (got[0].Cvalif != nil && *got[0].Cvalif == 3 && got[0].Scale != nil && *got[0].Scale == 0.5) || got[1].Cvalif != nil {
				t.Errorf("DA columns = %v %v", got[0].Cvalif, got[0].Scale)
			}
		})
	}
}

func TestListErrors(t *testing.T) {
	f := &fakeDB{cols: map[string][]string{"L": {"ID", "NAME"}}, rows: func(q string, args []any) [][]any {
		r, _ := sectionRows(q, args, "L", "D", "T")
		return r
	}}
	p := newFakeProvider(t, f)
	if _, err := p.List(context.Background(), "29", "0"); !errors.Is(err, binding.ErrInvalid) {
		t.Errorf("node 0: %v", err)
	}
	if _, err := p.List(context.Background(), "29", "7"); !errors.Is(err, binding.ErrNotFound) {
		t.Errorf("list without ID_NODE: %v", err)
	}
}

func TestLikePattern(t *testing.T) {
	if got := likePattern(`Ячейка 10%_a\b`); got != `%ячейка 10\%\_a\\b%` {
		t.Errorf("got %q", got)
	}
}

func TestSearch(t *testing.T) {
	newDB := func(dirHits, lstHits int) *fakeDB {
		f := &fakeDB{cols: map[string][]string{"D": {"ID", "NAME", "ID_PARENT"}, "L": {"ID", "NAME", "ID_NODE"}}}
		f.rows = func(q string, args []any) [][]any {
			if r, ok := sectionRows(q, args, "L", "D", "T"); ok {
				return r
			}
			n, parent := dirHits, int64(1)
			if strings.Contains(q, "rsduadmin.L a") {
				n, parent = lstHits, int64(10)
			}
			var out [][]any
			for i := range n {
				out = append(out, []any{int64(100 + i), parent, "Feeder"})
			}
			return out
		}
		return f
	}
	f := newDB(5, 5)
	res, err := newFakeProvider(t, f).Search(context.Background(), "29", " fe%ed ", 4)
	if err != nil {
		t.Fatal(err)
	}
	if q := f.query("rsduadmin.D a"); !strings.Contains(q, `LOWER(a.NAME) LIKE $1 ESCAPE '\'`) || !strings.Contains(q, "FETCH FIRST 5 ROWS ONLY") {
		t.Errorf("catalog search %q", q)
	}
	if q := f.query("rsduadmin.L a"); !strings.Contains(q, "COALESCE(a.ID_NODE, 0)") || !strings.Contains(q, "FETCH FIRST 5 ROWS ONLY") {
		t.Errorf("list search %q", q)
	}
	want := []binding.Hit{
		{Ref: "1012:100", Name: "Feeder", Kind: binding.HitCatalog, Node: "100"},
		{Ref: "1012:101", Name: "Feeder", Kind: binding.HitCatalog, Node: "101"},
		{Ref: "29:100", Name: "Feeder", Kind: binding.HitList, Node: "10"},
		{Ref: "29:101", Name: "Feeder", Kind: binding.HitList, Node: "10"},
	}
	if !slices.Equal(res.Hits, want) || !res.Truncated {
		t.Errorf("result = %+v", res)
	}
	for _, c := range []struct{ dir, lst, wantCat, wantLst int }{{4, 0, 4, 0}, {1, 3, 1, 3}, {0, 5, 0, 4}, {1, 5, 1, 3}, {5, 1, 3, 1}} {
		res, err = newFakeProvider(t, newDB(c.dir, c.lst)).Search(context.Background(), "29", "fe", 4)
		if err != nil {
			t.Fatal(err)
		}
		nc := len(slices.DeleteFunc(slices.Clone(res.Hits), func(h binding.Hit) bool { return h.Kind != binding.HitCatalog }))
		if nc != c.wantCat || len(res.Hits)-nc != c.wantLst || res.Truncated != (c.dir+c.lst > 4) {
			t.Errorf("%v: %d catalog, %d list, truncated %v", c, nc, len(res.Hits)-nc, res.Truncated)
		}
	}
	if _, err := newFakeProvider(t, newDB(0, 0)).Search(context.Background(), "29", " я ", 0); !errors.Is(err, binding.ErrInvalid) {
		t.Errorf("one-letter query: %v", err)
	}
}
