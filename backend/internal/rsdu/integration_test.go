package rsdu

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
	"sld-editor/internal/config"
)

// testDSNs are the integration databases: env var → driver. A DSN is a URL,
// oracle://user:password@host:port/service?sid=SID&schema=rsduadmin or postgres://user:password@host:port/db.
var testDSNs = []struct{ env, driver string }{
	{"RSDU_TEST_ORACLE", config.DriverOracle},
	{"RSDU_TEST_POSTGRES", config.DriverPostgres},
}

// integrationProvider returns the provider of env's DSN; it skips the test when env is unset.
func integrationProvider(t *testing.T, env, driver string) *Provider {
	t.Helper()
	raw := os.Getenv(env)
	if raw == "" {
		t.Skipf("%s is not set", env)
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("%s: %v", env, err)
	}
	port, _ := strconv.Atoi(u.Port())
	pw, _ := u.User.Password()
	var cfg config.Bindings
	cfg.Provider = config.ProviderRSDU
	cfg.RSDU.Driver = driver
	cfg.RSDU.Schema = u.Query().Get("schema")
	cfg.RSDU.Read = config.DSN{
		Host: u.Hostname(), Port: port, User: u.User.Username(), Password: pw,
		Database: u.Path[min(1, len(u.Path)):], Sid: u.Query().Get("sid"),
	}
	c := &config.Config{Bindings: cfg}
	if err := c.ValidateBindings(); err != nil {
		t.Fatalf("%s: %v", env, err)
	}
	p, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { p.(*Provider).read.(*conn).Close() })
	return p.(*Provider)
}

func TestIntegrationDictionaries(t *testing.T) {
	got := map[string]*binding.Dictionaries{}
	for _, db := range testDSNs {
		t.Run(db.driver, func(t *testing.T) {
			p := integrationProvider(t, db.env, db.driver)
			ctx := context.Background()
			d, err := p.Dictionaries(ctx)
			if err != nil {
				t.Fatal(err)
			}
			var kinds []slddoc.BindingKind
			for _, k := range d.Kinds {
				kinds = append(kinds, k.Kind)
			}
			if !slices.Equal(kinds, kindOrder) {
				t.Errorf("kinds = %v", kinds)
			}
			if !slices.ContainsFunc(d.Options, func(o binding.Option) bool {
				return o.Alias == "GLT_BOOL_OPT_INSTANT" && o.Group == "GLOBAL_TYPE_BOOL" && o.Name != ""
			}) {
				t.Errorf("GLT_BOOL_OPT_INSTANT missing from %d options", len(d.Options))
			}
			if !slices.ContainsFunc(d.Features, func(f binding.Feature) bool { return f.Alias == "FEATURE_SIGN" && f.Mask == 1 }) {
				t.Errorf("FEATURE_SIGN missing: %+v", d.Features)
			}

			if tb, err := p.tables.Table(ctx, "VS_REGIM"); err != nil || tb != p.d.Schema+".VS_REGIM" {
				t.Errorf("Table(VS_REGIM) = %q, %v", tb, err)
			}
			if _, err := p.tables.Table(ctx, "NO_SUCH_TABLE_X"); err == nil {
				t.Error("Table(NO_SUCH_TABLE_X) accepted")
			}
			for _, col := range []string{"MODUS_TYPE", "ID_DTYP"} {
				if ok, err := p.tables.HasColumn(ctx, "VS_TCOMP", col); !ok || err != nil {
					t.Errorf("VS_TCOMP.%s: %v %v", col, ok, err)
				}
			}
			got[db.driver] = d
		})
	}
	if o, pg := got[config.DriverOracle], got[config.DriverPostgres]; o != nil && pg != nil && !reflect.DeepEqual(o, pg) {
		t.Errorf("dictionaries differ between Oracle and PostgreSQL:\noracle   %+v\npostgres %+v", o, pg)
	}
}

func findSection(ss []binding.Section, section string) *binding.Section {
	for i := range ss {
		if ss[i].Section == section {
			return &ss[i]
		}
		if s := findSection(ss[i].Children, section); s != nil {
			return s
		}
	}
	return nil
}

func countNodes(ns []binding.Node) int {
	n := len(ns)
	for _, c := range ns {
		n += countNodes(c.Children)
	}
	return n
}

// biggestNode returns the catalog node of list table with the most objects and their number.
func biggestNode(t *testing.T, p *Provider, table string) (string, int64) {
	t.Helper()
	var node, n int64
	err := each(context.Background(), p.read, p.d.SQL("SELECT ID_NODE, COUNT(*) FROM {s}."+table+
		" GROUP BY ID_NODE ORDER BY COUNT(*) DESC, ID_NODE FETCH FIRST 1 ROWS ONLY"), func(r Rows) error {
		return r.Scan(&node, &n)
	})
	if err != nil {
		t.Fatal(err)
	}
	return strconv.FormatInt(node, 10), n
}

func TestIntegrationBrowse(t *testing.T) {
	for _, db := range testDSNs {
		t.Run(db.driver, func(t *testing.T) {
			p := integrationProvider(t, db.env, db.driver)
			ctx := context.Background()

			sections, err := p.Sections(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if len(sections) != 1 || sections[0].ID != "1" || len(sections[0].Children) == 0 || !strings.HasSuffix(sections[0].Ref, ":1") {
				t.Fatalf("sections root = %+v", sections)
			}

			// Electrical mode (ELREG_LIST_V) and data acquisition segment 1 (DA_V_LST_1) of a standard RSDU.
			for _, c := range []struct{ section, table string }{{"29", "ELREG_LIST_V"}, {"54", "DA_V_LST_1"}} {
				if findSection(sections, c.section) == nil {
					t.Errorf("section %s not in the tree", c.section)
					continue
				}
				start := time.Now()
				cat, err := p.Catalog(ctx, c.section)
				if err != nil {
					t.Fatal(err)
				}
				js, _ := json.Marshal(cat)
				t.Logf("catalog %s: %d nodes, %d bytes, %v", c.section, countNodes(cat), len(js), time.Since(start))
				if len(cat) == 0 || cat[0].Ref == "" || cat[0].Name == "" {
					t.Errorf("catalog %s = %+v", c.section, cat)
				}

				node, n := biggestNode(t, p, c.table)
				start = time.Now()
				objs, err := p.List(ctx, c.section, node)
				if err != nil {
					t.Fatal(err)
				}
				js, _ = json.Marshal(objs)
				t.Logf("biggest list %s/%s: %d objects (%d rows), %d bytes, %v", c.section, node, len(objs), n, len(js), time.Since(start))
				if int64(len(objs)) > n || len(objs) == 0 {
					t.Errorf("biggest list: %d objects of %d rows", len(objs), n)
				}
				query := strings.ToLower(objs[len(objs)/2].Name)
				res, err := p.Search(ctx, c.section, query, 50)
				if err != nil {
					t.Fatal(err)
				}
				i := slices.IndexFunc(res.Hits, func(h binding.Hit) bool { return h.Kind == binding.HitList })
				if i < 0 {
					t.Errorf("search %s %q: no list hit in %d", c.section, query, len(res.Hits))
					continue
				}
				hit := res.Hits[i]
				if !strings.Contains(strings.ToLower(hit.Name), query) {
					t.Errorf("hit %+v does not contain %q", hit, query)
				}
				objs, err = p.List(ctx, c.section, hit.Node)
				if err != nil {
					t.Fatal(err)
				}
				j := slices.IndexFunc(objs, func(o binding.Object) bool { return o.Ref == hit.Ref })
				if j < 0 {
					t.Errorf("hit %+v not in its node's list of %d", hit, len(objs))
					continue
				}
				o := objs[j]
				if c.table == "DA_V_LST_1" && (o.Cvalif == nil || o.Scale == nil) {
					t.Errorf("DA object without cvalif/scale: %+v", o)
				}
				t.Logf("list %s/%s: %d objects, e.g. %s %q type %q class %q", c.section, hit.Node, len(objs), o.Ref, o.Name, o.TypeAlias, o.Class)
			}

			start := time.Now()
			cat, err := p.Catalog(ctx, "1231")
			if err != nil {
				t.Fatal(err)
			}
			js, _ := json.Marshal(cat)
			t.Logf("catalog 1231 (OBJ_TREE): %d nodes, %d bytes, %v", countNodes(cat), len(js), time.Since(start))

			if _, err := p.Catalog(ctx, "999999999"); !errors.Is(err, binding.ErrNotFound) {
				t.Errorf("unknown section: %v", err)
			}
		})
	}
}
