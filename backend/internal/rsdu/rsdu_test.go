package rsdu

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"testing"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
	"sld-editor/internal/config"
)

// fakeQuerier answers queries from canned rows keyed by the exact SQL text and records what was asked.
type fakeQuerier struct {
	results map[string][][]any
	queries []string
	args    [][]any
}

func (f *fakeQuerier) Query(_ context.Context, q string, args ...any) (Rows, error) {
	f.queries = append(f.queries, q)
	f.args = append(f.args, args)
	rows, ok := f.results[q]
	if !ok {
		return nil, fmt.Errorf("unexpected query %q", q)
	}
	return &fakeRows{rows: rows, i: -1}, nil
}

type fakeRows struct {
	rows [][]any
	i    int
}

func (r *fakeRows) Next() bool   { r.i++; return r.i < len(r.rows) }
func (r *fakeRows) Close() error { return nil }
func (r *fakeRows) Err() error   { return nil }

func (r *fakeRows) Scan(dest ...any) error {
	row := r.rows[r.i]
	if len(dest) != len(row) {
		return fmt.Errorf("scan: %d columns, %d destinations", len(row), len(dest))
	}
	for i, d := range dest {
		switch d := d.(type) {
		case *int64:
			*d = row[i].(int64)
		case *string:
			*d = row[i].(string)
		case *any:
			*d = row[i]
		case sql.Scanner:
			if err := d.Scan(row[i]); err != nil {
				return err
			}
		default:
			return errors.New("scan: unsupported destination")
		}
	}
	return nil
}

func TestDialectSQL(t *testing.T) {
	q := "SELECT ID FROM {s}.VS_FORM WHERE ID = ? AND NAME = '?' AND ID_NODE = ?"
	cases := []struct {
		driver, schema, want string
	}{
		{config.DriverOracle, "", "SELECT ID FROM rsduadmin.VS_FORM WHERE ID = :pr1 AND NAME = '?' AND ID_NODE = :pr2"},
		{config.DriverPostgres, "scada", "SELECT ID FROM scada.VS_FORM WHERE ID = $1 AND NAME = '?' AND ID_NODE = $2"},
	}
	for _, c := range cases {
		d, err := NewDialect(c.driver, c.schema)
		if err != nil {
			t.Fatal(err)
		}
		if got := d.SQL(q); got != c.want {
			t.Errorf("%s: got %q, want %q", c.driver, got, c.want)
		}
	}
}

func TestDialectNextValAndColumns(t *testing.T) {
	ora, _ := NewDialect(config.DriverOracle, "")
	pg, _ := NewDialect(config.DriverPostgres, "")
	if got := ora.NextVal("VS_COMP_S"); got != "rsduadmin.VS_COMP_S.NEXTVAL" {
		t.Errorf("oracle nextval = %q", got)
	}
	if got := pg.NextVal("VS_COMP_S"); got != "nextval('rsduadmin.vs_comp_s')" {
		t.Errorf("postgres nextval = %q", got)
	}
	q, args := ora.ColumnsQuery("vs_form")
	if q != "SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER = :pr1 AND TABLE_NAME = :pr2" || !slices.Equal(args, []any{"RSDUADMIN", "VS_FORM"}) {
		t.Errorf("oracle columns = %q %v", q, args)
	}
	q, args = pg.ColumnsQuery("VS_FORM")
	if q != "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2" || !slices.Equal(args, []any{"rsduadmin", "vs_form"}) {
		t.Errorf("postgres columns = %q %v", q, args)
	}
}

func TestNewDialectRejects(t *testing.T) {
	if _, err := NewDialect(config.DriverOracle, "rsdu; drop"); err == nil {
		t.Error("schema with SQL accepted")
	}
	if _, err := NewDialect("mysql", ""); err == nil {
		t.Error("unknown driver accepted")
	}
}

func TestGUIDAndBool(t *testing.T) {
	raw := []byte{0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef}
	want := "12345678-9abc-def0-0123-456789abcdef"
	for _, v := range []any{raw, want, strings.ToUpper(want), []byte(want), "123456789ABCDEF00123456789ABCDEF"} {
		if got := GUID(v); got != want {
			t.Errorf("GUID(%v) = %q", v, got)
		}
	}
	for _, v := range []any{nil, "", "xyz", int64(5), []byte{1, 2}} {
		if got := GUID(v); got != "" {
			t.Errorf("GUID(%v) = %q, want empty", v, got)
		}
	}
	for v, want := range map[any]bool{true: true, false: false, int64(1): true, int64(0): false, "1": true, "0": false, "t": true, "f": false, nil: false} {
		if got := Bool(v); got != want {
			t.Errorf("Bool(%v) = %v", v, got)
		}
	}
}

func TestTableValidation(t *testing.T) {
	d, _ := NewDialect(config.DriverPostgres, "")
	colsQ, _ := d.ColumnsQuery("x")
	f := &fakeQuerier{results: map[string][][]any{colsQ: {}}}
	tb := newTables(f, d)
	for _, bad := range []string{"", "1ABC", "MEAS_LIST; DROP TABLE X", "A.B", "A B", `"X"`} {
		if _, err := tb.Table(context.Background(), bad); err == nil || !strings.Contains(err.Error(), "plain identifier") {
			t.Errorf("Table(%q) = %v", bad, err)
		}
	}
	if len(f.queries) != 0 {
		t.Errorf("invalid names reached the database: %v", f.queries)
	}
	if _, err := tb.Table(context.Background(), "NO_SUCH"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Errorf("missing table: %v", err)
	}

	f.results[colsQ] = [][]any{{"id"}, {"name"}}
	tb.reset()
	got, err := tb.Table(context.Background(), "MEAS_LIST$1")
	if err != nil || got != "rsduadmin.MEAS_LIST$1" {
		t.Errorf("Table = %q, %v", got, err)
	}
	if ok, _ := tb.HasColumn(context.Background(), "meas_list$1", "NAME"); !ok {
		t.Error("HasColumn(NAME) = false")
	}
	n := len(f.queries)
	_, _ = tb.Columns(context.Background(), "Meas_List$1")
	if len(f.queries) != n {
		t.Error("column dictionary not cached")
	}
}

func dictionaryResults(d Dialect) map[string][][]any {
	return map[string][][]any{
		d.SQL(sqlRegims): {
			{int64(1), "Equipment-db", "EQUIPMENT"},
			{int64(2), "Parameters-db", "ADJUST_REGIM"},
			{int64(3), "Additional-db", "ADJUST_ADDITIONAL"},
			{int64(4), "Topology-db", "ADJUST_TOPOLOGY"},
		},
		d.SQL(sqlOptions): {
			{int64(1), "Instant TI", "GLT_ANALOG_OPT_INSTANT", "GLOBAL_TYPE_ANALOG", "Analog"},
			{int64(8), "Instant TS", "GLT_BOOL_OPT_INSTANT", "GLOBAL_TYPE_BOOL", "Bool"},
			{int64(99), "No alias", nil, "GLOBAL_TYPE_BOOL", "Bool"},
		},
		d.SQL(sqlFeatures): {
			{int64(0), "General", "FEATURE_GENERAL"},
			{int64(1), "Sign", "FEATURE_SIGN"},
		},
	}
}

func TestDictionaries(t *testing.T) {
	for _, driver := range []string{config.DriverOracle, config.DriverPostgres} {
		t.Run(driver, func(t *testing.T) {
			d, _ := NewDialect(driver, "")
			f := &fakeQuerier{results: dictionaryResults(d)}
			p := newProvider(config.RSDUBindings{}, d, f)

			got, err := p.Dictionaries(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			wantKinds := []binding.KindInfo{
				{Kind: slddoc.BindingEquipment, Name: "Equipment-db", DefaultOption: optionComplex},
				{Kind: slddoc.BindingMeas1, Name: "Parameters-db", DefaultOption: optionBool},
				{Kind: slddoc.BindingMeas2, Name: "Additional-db", DefaultOption: optionBool},
				{Kind: slddoc.BindingJump, DefaultOption: optionComplex},
			}
			if !slices.Equal(got.Kinds, wantKinds) {
				t.Errorf("kinds = %+v", got.Kinds)
			}
			wantOptions := []binding.Option{
				{Alias: "GLT_ANALOG_OPT_INSTANT", Name: "Instant TI", Group: "GLOBAL_TYPE_ANALOG", GroupName: "Analog"},
				{Alias: "GLT_BOOL_OPT_INSTANT", Name: "Instant TS", Group: "GLOBAL_TYPE_BOOL", GroupName: "Bool"},
			}
			if !slices.Equal(got.Options, wantOptions) {
				t.Errorf("options = %+v", got.Options)
			}
			if !slices.Equal(got.Features, []binding.Feature{{Alias: "FEATURE_GENERAL", Name: "General"}, {Alias: "FEATURE_SIGN", Name: "Sign", Mask: 1}}) {
				t.Errorf("features = %+v", got.Features)
			}
			if p.dict.regimID[slddoc.BindingJump] != 2 || p.dict.regimID[slddoc.BindingMeas2] != 3 || p.dict.optionID["GLT_BOOL_OPT_INSTANT"] != 8 {
				t.Errorf("ids = %v %v", p.dict.regimID, p.dict.optionID)
			}

			n := len(f.queries)
			_, _ = p.Dictionaries(context.Background())
			if len(f.queries) != n {
				t.Error("dictionaries not cached")
			}
			p.Refresh()
			_, _ = p.Dictionaries(context.Background())
			if len(f.queries) != 2*n {
				t.Errorf("refresh did not re-read: %d queries", len(f.queries))
			}
		})
	}
}

func TestDictionariesError(t *testing.T) {
	d, _ := NewDialect(config.DriverPostgres, "")
	p := newProvider(config.RSDUBindings{}, d, &fakeQuerier{results: map[string][][]any{}})
	if _, err := p.Dictionaries(context.Background()); err == nil {
		t.Fatal("no error")
	}
	if p.dict != nil {
		t.Error("failed load cached")
	}
}

func TestPostgresURLDatabase(t *testing.T) {
	cases := []struct {
		name string
		dsn  config.DSN
		want string
	}{
		{"database", config.DSN{User: "u", Host: "h", Port: 5432, Database: "rsdu"}, "/rsdu"},
		{"sid when database is empty", config.DSN{User: "u", Host: "h", Port: 5432, Sid: "rsdu"}, "/rsdu"},
		{"database wins over sid", config.DSN{User: "u", Host: "h", Port: 5432, Database: "a", Sid: "b"}, "/a"},
	}
	for _, c := range cases {
		u, err := url.Parse(postgresURL(c.dsn))
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if u.Path != c.want {
			t.Errorf("%s: path %q, want %q", c.name, u.Path, c.want)
		}
	}
}
