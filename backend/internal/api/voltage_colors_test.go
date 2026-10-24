package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/PVKonovalov/slddoc"
	"sld-editor/internal/config"
)

func TestPresetFor(t *testing.T) {
	presets := []config.VoltageColor{{Name: "10 kV", Color: "a"}, {Name: "35 kV", Color: "b"}, {Name: "110 kV", Color: "c"},
		{Name: "330 kV", Color: "d"}, {Name: "Aux", Color: "e"}}
	for name, want := range map[string]struct {
		preset  string
		nearest bool
	}{
		"110 kV": {"110 kV", false}, "110kV": {"110 kV", false}, "aux": {"Aux", false},
		"400 kV": {"330 kV", true}, "17 kV": {"10 kV", true}, "50 kV": {"35 kV", true}, "135 kV": {"110 kV", true},
	} {
		p, nearest, ok := presetFor(presets, name)
		if !ok || p.Name != want.preset || nearest != want.nearest {
			t.Errorf("presetFor(%q) = %q, %v, %v; want %q, %v", name, p.Name, nearest, ok, want.preset, want.nearest)
		}
	}
	if _, _, ok := presetFor(presets, "#00a0f0"); ok {
		t.Error("a colour name has no preset")
	}
}

func TestAddVoltageColors(t *testing.T) {
	s := newTestServer(t)
	path := filepath.Join(t.TempDir(), "c.yaml")
	if err := os.WriteFile(path, []byte("voltage_colors:\n  - name: \"10 kV\"\n    color: \"#962896\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	rec := doJSON(t, s, http.MethodPost, "/api/config/voltage-colors", []config.VoltageColor{{Name: "11 kV", Color: "#962896"}})
	if rec.Code != http.StatusConflict {
		t.Fatalf("without a config file: status = %d", rec.Code)
	}

	s.SetConfigFile(path)
	rec = doJSON(t, s, http.MethodPost, "/api/config/voltage-colors", []config.VoltageColor{{Name: "bad", Color: "red"}})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("bad color: status = %d", rec.Code)
	}
	rec = doJSON(t, s, http.MethodPost, "/api/config/voltage-colors", []config.VoltageColor{
		{Name: "10kV", Color: "#000000"}, {Name: " 11 kV ", Color: "#9628A6"}, {Name: "11 kV", Color: "#111111"}})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out struct {
		VoltageColors []config.VoltageColor `json:"voltageColors"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	want := []config.VoltageColor{{Name: "10 kV", Color: "#962896"}, {Name: "11 kV", Color: "#9628a6"}}
	if len(out.VoltageColors) != 2 || out.VoltageColors[1] != want[1] {
		t.Errorf("voltageColors = %+v", out.VoltageColors)
	}
	if got := s.voltageColors(); len(got) != 2 || got[1] != want[1] {
		t.Errorf("server presets = %+v", got)
	}
	if data, _ := os.ReadFile(path); !strings.HasSuffix(string(data), "  - name: \"11 kV\"\n    color: \"#9628a6\"\n") {
		t.Errorf("file = %s", data)
	}
}

func TestApplyPresetVoltageColors(t *testing.T) {
	s := newTestServer(t)
	d := &slddoc.Diagram{VoltageClasses: []slddoc.VoltageClass{{ID: 1, Name: "10.0 kV"}, {ID: 2, Name: "17 kV"},
		{ID: 3, Name: "0 kV"}, {ID: 4, Name: "50 kV", Color: "#123456"}}}
	got := s.applyPresetVoltageColors(d)
	want := []unmatchedVoltage{{Name: "17 kV", Preset: "10 kV", Color: "#962896"}, {Name: "0 kV", Color: unmatchedVoltageColor}}
	if !slices.Equal(got, want) {
		t.Errorf("unmatched = %+v", got)
	}
	if vc := d.VoltageClasses; vc[0] != (slddoc.VoltageClass{ID: 1, Name: "10 kV", Color: "#962896"}) ||
		vc[1].Color != "#962896" || vc[3].Color != "#123456" {
		t.Errorf("classes = %+v", vc)
	}
}
