package rsdu

import (
	"context"
	"net/url"
	"os"
	"reflect"
	"slices"
	"strconv"
	"testing"

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
