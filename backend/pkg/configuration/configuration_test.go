package configuration

import (
	"os"
	"path/filepath"
	"testing"
)

type testConfig struct {
	Api struct {
		Url  string `yaml:"url" env:"true"`
		Port int    `yaml:"port" env:"true"`
		Sync bool   `yaml:"sync" env:"true"`
		Name string `yaml:"name" env:"true"`
	} `yaml:"api"`
}

func writeFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func withEnvFile(t *testing.T, prefix, path string) {
	t.Helper()
	oldPrefix, oldFile := EnvVarPrefix, EnvFile
	EnvVarPrefix, EnvFile = prefix, path
	t.Cleanup(func() { EnvVarPrefix, EnvFile = oldPrefix, oldFile })
}

func TestRead_EachLevelOverridesPrevious(t *testing.T) {
	dir := t.TempDir()
	yml := writeFile(t, dir, "c.yaml", "api:\n  url: yaml-url\n  port: 1\n  sync: false\n  name: yaml-name\n")
	env := writeFile(t, dir, ".env", "T_API_URL=dotenv-url\nT_API_PORT=2\n")
	withEnvFile(t, "T_", env)
	t.Setenv("T_API_PORT", "3")

	var c testConfig
	if err := Read(yml, &c); err != nil {
		t.Fatal(err)
	}

	if c.Api.Name != "yaml-name" {
		t.Errorf("Name = %q, want yaml value", c.Api.Name)
	}
	if c.Api.Url != "dotenv-url" {
		t.Errorf("Url = %q, want .env value over yaml", c.Api.Url)
	}
	if c.Api.Port != 3 {
		t.Errorf("Port = %d, want os env value over .env", c.Api.Port)
	}
}

func TestRead_MissingEnvFileIsIgnored(t *testing.T) {
	dir := t.TempDir()
	yml := writeFile(t, dir, "c.yaml", "api:\n  url: yaml-url\n")
	withEnvFile(t, "T_", filepath.Join(dir, "missing.env"))

	var c testConfig
	if err := Read(yml, &c); err != nil {
		t.Fatal(err)
	}
	if c.Api.Url != "yaml-url" {
		t.Errorf("Url = %q, want yaml value", c.Api.Url)
	}
}

func TestRead_EmptyEnvFileDisablesDotEnv(t *testing.T) {
	dir := t.TempDir()
	yml := writeFile(t, dir, "c.yaml", "api:\n  url: yaml-url\n")
	writeFile(t, dir, ".env", "T_API_URL=dotenv-url\n")
	t.Chdir(dir)
	withEnvFile(t, "T_", "")

	var c testConfig
	if err := Read(yml, &c); err != nil {
		t.Fatal(err)
	}
	if c.Api.Url != "yaml-url" {
		t.Errorf("Url = %q, want yaml value", c.Api.Url)
	}
}

func TestReadEnvFile_Syntax(t *testing.T) {
	path := writeFile(t, t.TempDir(), ".env", `
# comment
export A=1
B = two words
C="quoted # not a comment"
D='single'
E=value # trailing comment
F=
G=a=b
`)
	got, err := ReadEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"A": "1",
		"B": "two words",
		"C": "quoted # not a comment",
		"D": "single",
		"E": "value",
		"F": "",
		"G": "a=b",
	}
	if len(got) != len(want) {
		t.Errorf("got %d vars %v, want %d", len(got), got, len(want))
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
}

func TestReadEnvFile_InvalidLine(t *testing.T) {
	path := writeFile(t, t.TempDir(), ".env", "NOT_A_PAIR\n")
	if _, err := ReadEnvFile(path); err == nil {
		t.Error("expected error for line without '='")
	}
}

func TestReadFromEnv_BoolAcceptsOne(t *testing.T) {
	withEnvFile(t, "T_", "")
	t.Setenv("T_API_SYNC", "1")

	var c testConfig
	if err := ReadFromEnv(&c); err != nil {
		t.Fatal(err)
	}
	if !c.Api.Sync {
		t.Error("Sync = false, want true for \"1\"")
	}
}
