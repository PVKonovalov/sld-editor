package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAppendVoltageColors(t *testing.T) {
	const src = `# top
editor:
  grid_spacing: 10

# presets
voltage_colors:
  - name: "10 kV"
    color: "#962896"   # purple
  - name: "330 kV"
    color: "#d04040"

# after
voltage_color_tolerance: 60
`
	path := filepath.Join(t.TempDir(), "c.yaml")
	if err := os.WriteFile(path, []byte(src), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := AppendVoltageColors(path, []VoltageColor{{Name: "400 kV", Color: "#d04040"}}); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	want := strings.Replace(src, "    color: \"#d04040\"\n", "    color: \"#d04040\"\n  - name: \"400 kV\"\n    color: \"#d04040\"\n", 1)
	if string(got) != want {
		t.Errorf("got:\n%s\nwant:\n%s", got, want)
	}
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o640 {
		t.Errorf("mode = %v", info.Mode().Perm())
	}
}

func TestAppendVoltageColorsNoKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "c.yaml")
	if err := os.WriteFile(path, []byte("editor:\n  snap: true"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := AppendVoltageColors(path, []VoltageColor{{Name: "50 kV", Color: "#965000"}}); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if want := "editor:\n  snap: true\n\nvoltage_colors:\n  - name: \"50 kV\"\n    color: \"#965000\"\n"; string(got) != want {
		t.Errorf("got %q", got)
	}
}

func TestAppendVoltageColorsFlowList(t *testing.T) {
	path := filepath.Join(t.TempDir(), "c.yaml")
	const src = "voltage_colors: []\n"
	if err := os.WriteFile(path, []byte(src), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := AppendVoltageColors(path, []VoltageColor{{Name: "50 kV", Color: "#965000"}}); err == nil {
		t.Error("a flow list should be refused")
	}
	if got, _ := os.ReadFile(path); string(got) != src {
		t.Errorf("file changed: %q", got)
	}
}
