package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"sld-editor/pkg/configuration"
)

func TestValidateBindings(t *testing.T) {
	valid := func() Bindings {
		var b Bindings
		b.Provider = ProviderRSDU
		b.RSDU.Driver = DriverOracle
		b.RSDU.DSN = DSN{Host: "db", Port: 1521, User: "u", Sid: "S"}
		return b
	}
	cases := []struct {
		name string
		edit func(b *Bindings)
		want string
	}{
		{"off", func(b *Bindings) { *b = Bindings{} }, ""},
		{"off ignores rsdu section", func(b *Bindings) { b.Provider = ""; b.RSDU.Driver = "x" }, ""},
		{"valid oracle", func(b *Bindings) {}, ""},
		{"valid postgres with export", func(b *Bindings) {
			b.RSDU.Driver = DriverPostgres
			b.RSDU.DSN = DSN{Engine: DriverPostgres, Host: "db", Port: 5432, User: "u", Database: "rsdu"}
			b.RSDU.Export = true
		}, ""},
		{"unknown provider", func(b *Bindings) { b.Provider = "cim" }, `unknown provider "cim"`},
		{"missing driver", func(b *Bindings) { b.RSDU.Driver = "" }, "bindings.rsdu.driver"},
		{"bad driver", func(b *Bindings) { b.RSDU.Driver = "mysql" }, `"mysql"`},
		{"missing dsn", func(b *Bindings) { b.RSDU.DSN = DSN{} }, "bindings.rsdu.dsn: required"},
		{"dsn without host", func(b *Bindings) { b.RSDU.DSN.Host = "" }, "dsn: host is required"},
		{"dsn without port", func(b *Bindings) { b.RSDU.DSN.Port = 0 }, "dsn: port is required"},
		{"dsn without user", func(b *Bindings) { b.RSDU.DSN.User = "" }, "dsn: user is required"},
		{"dsn without database or sid", func(b *Bindings) { b.RSDU.DSN.Sid = "" }, "database or sid"},
		{"engine differs", func(b *Bindings) { b.RSDU.DSN.Engine = "_oracle" }, `engine "_oracle" differs`},
		{"encrypted password", func(b *Bindings) { b.RSDU.DSN.PasswordEncrypted = true }, "password_encrypted"},
		{"negative scheme type", func(b *Bindings) { b.RSDU.SchemeType = -1 }, "scheme_type"},
		{"wire types", func(b *Bindings) { b.RSDU.WireTypes = map[string]int64{"BusWork": 1489} }, ""},
		{"unknown wire kind", func(b *Bindings) { b.RSDU.WireTypes = map[string]int64{"Rope": 1} }, `"Rope" is not a wire kind`},
		{"bad wire type", func(b *Bindings) { b.RSDU.WireTypes = map[string]int64{"CableLine": 0} }, "wire_types.CableLine"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cfg := &Config{Bindings: valid()}
			c.edit(&cfg.Bindings)
			err := cfg.ValidateBindings()
			if c.want == "" {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Errorf("got %v, want %q", err, c.want)
			}
		})
	}
}

func TestBindingsCredentialsFromDotEnv(t *testing.T) {
	dir := t.TempDir()
	yml := filepath.Join(dir, "sld-editor.yaml")
	env := filepath.Join(dir, ".env")
	if err := os.WriteFile(yml, []byte("bindings:\n  provider: rsdu\n  rsdu:\n    driver: postgres\n    dsn:\n      host: db\n      port: 5432\n      database: rsdu\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(env, []byte("BINDINGS_RSDU_DSN_USER=reader\nBINDINGS_RSDU_DSN_PASSWORD='p#1'\nBINDINGS_RSDU_DSN_PORT=5433\nBINDINGS_RSDU_EXPORT=true\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	saved := configuration.EnvFile
	configuration.EnvFile = env
	t.Cleanup(func() { configuration.EnvFile = saved })

	var cfg Config
	if err := configuration.Read(yml, &cfg); err != nil {
		t.Fatal(err)
	}
	r := cfg.Bindings.RSDU
	if r.DSN.User != "reader" || r.DSN.Password != "p#1" || r.DSN.Port != 5433 || r.DSN.Host != "db" || !r.Export {
		t.Errorf("rsdu = %+v", r)
	}
	if err := cfg.ValidateBindings(); err != nil {
		t.Errorf("ValidateBindings: %v", err)
	}
}

func TestBindingsLegacyConnections(t *testing.T) {
	yml := filepath.Join(t.TempDir(), "sld-editor.yaml")
	if err := os.WriteFile(yml, []byte("bindings:\n  provider: rsdu\n  rsdu:\n    driver: oracle\n    read:\n      host: db\n      port: 1521\n      user: u\n      sid: S\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	saved := configuration.EnvFile
	configuration.EnvFile = ""
	t.Cleanup(func() { configuration.EnvFile = saved })
	var cfg Config
	if err := configuration.Read(yml, &cfg); err != nil {
		t.Fatal(err)
	}
	if err := cfg.ValidateBindings(); err == nil || !strings.Contains(err.Error(), "bindings.rsdu.dsn") {
		t.Errorf("read: section: %v", err)
	}
}

func TestBindingsMinio(t *testing.T) {
	c := &Config{}
	c.Bindings.Provider = ProviderRSDU
	c.Bindings.RSDU.Driver = DriverPostgres
	c.Bindings.RSDU.DSN = DSN{Host: "h", Port: 5432, User: "u", Database: "d"}
	svg := &c.Bindings.RSDU.SVG
	svg.UseObjectStorage = "n"
	if err := c.ValidateBindings(); err != nil {
		t.Errorf("off: %v", err)
	}
	svg.UseObjectStorage = "s3"
	if err := c.ValidateBindings(); err == nil {
		t.Error("an unknown object storage passed")
	}
	svg.UseObjectStorage = "minio"
	svg.ObjectStorage.Minio = Minio{Username: "u", Endpoint: []Endpoint{{Host: "h", Port: 9090}}}
	if err := c.ValidateBindings(); err == nil || !strings.Contains(err.Error(), "bucket.sld") {
		t.Errorf("no bucket: %v", err)
	}
	svg.ObjectStorage.Minio.Bucket = map[string]string{"sld": "sld"}
	if err := c.ValidateBindings(); err != nil {
		t.Error(err)
	}
	if m := svg.ObjectStorage.Minio; m.Address() != "h:9090" || m.AccessKey() != "u" || !c.Bindings.RSDU.UsesMinio() {
		t.Errorf("%+v", m)
	}
}

// TestMinioCtrlroomYAML reads ctrlroom's object storage lines as they are in its configuration.
func TestMinioCtrlroomYAML(t *testing.T) {
	var r RSDUBindings
	err := yaml.Unmarshal([]byte(`
svg:
  use_object_storage: minio
  object_storage:
    minio:
      secure: n
      username: admin
      bucket:
        sld: sld
        avatar: avatar
      endpoint:
        - host: 10.0.0.1
          port: 9080
        - host: 10.0.0.2
          port: 9080
`), &r)
	m := r.SVG.ObjectStorage.Minio
	if err != nil || !r.UsesMinio() || bool(m.Secure) || m.AccessKey() != "admin" || m.SLDBucket() != "sld" || m.Address() != "10.0.0.1:9080" {
		t.Errorf("%+v, %v", m, err)
	}
	var f struct{ S Flag }
	if err := yaml.Unmarshal([]byte("s: maybe"), &f); err == nil {
		t.Error("secure: maybe passed")
	}
}

func TestWireType(t *testing.T) {
	var r RSDUBindings
	if id, ok := r.WireType("CableLine"); !ok || id != 115 {
		t.Errorf("default CableLine: %d %v", id, ok)
	}
	r.WireTypes = map[string]int64{"BusWork": 7}
	if id, ok := r.WireType("BusWork"); !ok || id != 7 {
		t.Errorf("configured BusWork: %d %v", id, ok)
	}
	if _, ok := r.WireType("CableLine"); ok {
		t.Error("a configured map replaces the defaults")
	}
}
