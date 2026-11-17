package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"sld-editor/pkg/configuration"
)

func TestValidateBindings(t *testing.T) {
	valid := func() Bindings {
		var b Bindings
		b.Provider = ProviderRSDU
		b.RSDU.Driver = DriverOracle
		b.RSDU.Read = DSN{Host: "db", Port: 1521, User: "u", Sid: "S"}
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
		{"valid postgres with write", func(b *Bindings) {
			b.RSDU.Driver = DriverPostgres
			b.RSDU.Read = DSN{Engine: DriverPostgres, Host: "db", Port: 5432, User: "u", Database: "rsdu"}
			b.RSDU.Write = b.RSDU.Read
		}, ""},
		{"unknown provider", func(b *Bindings) { b.Provider = "cim" }, `unknown provider "cim"`},
		{"missing driver", func(b *Bindings) { b.RSDU.Driver = "" }, "bindings.rsdu.driver"},
		{"bad driver", func(b *Bindings) { b.RSDU.Driver = "mysql" }, `"mysql"`},
		{"missing read", func(b *Bindings) { b.RSDU.Read = DSN{} }, "bindings.rsdu.read: required"},
		{"read without host", func(b *Bindings) { b.RSDU.Read.Host = "" }, "read: host is required"},
		{"read without port", func(b *Bindings) { b.RSDU.Read.Port = 0 }, "read: port is required"},
		{"read without user", func(b *Bindings) { b.RSDU.Read.User = "" }, "read: user is required"},
		{"read without database or sid", func(b *Bindings) { b.RSDU.Read.Sid = "" }, "database or sid"},
		{"engine differs", func(b *Bindings) { b.RSDU.Read.Engine = "_oracle" }, `engine "_oracle" differs`},
		{"encrypted password", func(b *Bindings) { b.RSDU.Read.PasswordEncrypted = true }, "password_encrypted"},
		{"incomplete write", func(b *Bindings) { b.RSDU.Write = DSN{Host: "db"} }, "bindings.rsdu.write: port"},
		{"negative scheme type", func(b *Bindings) { b.RSDU.SchemeType = -1 }, "scheme_type"},
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
	if err := os.WriteFile(yml, []byte("bindings:\n  provider: rsdu\n  rsdu:\n    driver: postgres\n    read:\n      host: db\n      port: 5432\n      database: rsdu\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(env, []byte("BINDINGS_RSDU_READ_USER=reader\nBINDINGS_RSDU_READ_PASSWORD='p#1'\nBINDINGS_RSDU_WRITE_HOST=db\nBINDINGS_RSDU_WRITE_PORT=5432\nBINDINGS_RSDU_WRITE_DATABASE=rsdu\nBINDINGS_RSDU_WRITE_USER=writer\n"), 0o600); err != nil {
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
	if r.Read.User != "reader" || r.Read.Password != "p#1" || r.Write.User != "writer" || r.Write.Port != 5432 {
		t.Errorf("rsdu = %+v", r)
	}
	if err := cfg.ValidateBindings(); err != nil {
		t.Errorf("ValidateBindings: %v", err)
	}
}
