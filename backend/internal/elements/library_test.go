package elements

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"sld-editor/internal/config"

	"github.com/PVKonovalov/slddoc"
)

const baseFixture = `<symbols>
  <symbol shape="41" class="Breaker" name="Breaker">
    <terminals>
      <terminal x="0" y="-10"/>
      <terminal x="0" y="10"/>
    </terminals>
    <template><![CDATA[<path/>]]></template>
  </symbol>
  <symbol shape="7" class="JunctionPoint" name="Junction point">
    <template><![CDATA[<circle/>]]></template>
  </symbol>
</symbols>`

const overrideFixture = `<symbols>
  <symbol shape="41" class="Breaker" name="Custom breaker">
    <template><![CDATA[<rect/>]]></template>
  </symbol>
  <symbol shape="900" class="Recloser" name="Recloser">
    <template><![CDATA[<path/>]]></template>
  </symbol>
</symbols>`

func writeFixture(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadAll_MergesInOrder(t *testing.T) {
	base := writeFixture(t, "base.xml", baseFixture)
	custom := writeFixture(t, "custom.xml", overrideFixture)

	lib, err := LoadAll([]string{base, custom})
	if err != nil {
		t.Fatal(err)
	}
	if len(lib.Symbols) != 3 {
		t.Fatalf("Symbols = %+v, want 3 (41 overridden, 7 kept, 900 added)", lib.Symbols)
	}

	byShape := map[string]Symbol{}
	for _, s := range lib.Symbols {
		byShape[s.Shape] = s
	}
	if byShape["41"].Name != "Custom breaker" {
		t.Errorf("shape 41 = %+v, want the later library's definition to win", byShape["41"])
	}
	if _, ok := byShape["7"]; !ok {
		t.Errorf("shape 7 from the base library should still be present: %+v", lib.Symbols)
	}
	if _, ok := byShape["900"]; !ok {
		t.Errorf("shape 900 from the custom library should be present: %+v", lib.Symbols)
	}
}

func TestLoad_ParsesTerminals(t *testing.T) {
	lib, err := Load([]byte(baseFixture))
	if err != nil {
		t.Fatal(err)
	}
	var breaker Symbol
	for _, s := range lib.Symbols {
		if s.Shape == "41" {
			breaker = s
		}
	}
	want := []slddoc.Point{{X: 0, Y: -10}, {X: 0, Y: 10}}
	if len(breaker.Terminals) != len(want) || breaker.Terminals[0] != want[0] || breaker.Terminals[1] != want[1] {
		t.Errorf("Breaker.Terminals = %+v, want %+v", breaker.Terminals, want)
	}

	var junction Symbol
	for _, s := range lib.Symbols {
		if s.Shape == "7" {
			junction = s
		}
	}
	if len(junction.Terminals) != 0 {
		t.Errorf("a symbol with no <terminals> block should parse to none: %+v", junction.Terminals)
	}
}

func TestLoadAll_NoLibrariesConfigured(t *testing.T) {
	if _, err := LoadAll(nil); err == nil {
		t.Fatal("expected an error when no libraries are configured")
	}
}

func TestSymbolLibrary_RendersConfiguredShapes(t *testing.T) {
	lib := &Library{Symbols: []Symbol{
		{Shape: "24", Class: "BusBarSection", Name: "Busbar section", Template: ""},
		{Shape: "41", Class: "Breaker", Name: "Breaker", Template: `<path d="M 0 0" style="stroke:{color}"/>`},
	}}
	d := &slddoc.Diagram{
		Width: 10, Height: 10,
		Elements: []slddoc.Element{
			{ID: 1, Class: slddoc.ClassBreaker, Shape: "41", X: 1, Y: 1},
		},
	}
	var buf bytes.Buffer
	if err := slddoc.Render(d, lib.SymbolLibrary(), &buf, slddoc.Static, "", nil); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), `id="1"`) {
		t.Errorf("expected shape 41's template to render: %s", buf.String())
	}
}

func TestValidatePalette(t *testing.T) {
	lib := &Library{Symbols: []Symbol{{Shape: "41", Class: "Breaker", Name: "Breaker"}}}

	valid := []config.PaletteGroup{
		{Name: "Wires", Items: []string{"21", "22"}},
		{Name: "Text", Items: []string{"5", "134"}},
		{Name: "Switching devices", Items: []string{"41"}},
	}
	if err := lib.ValidatePalette(valid); err != nil {
		t.Errorf("ValidatePalette(valid) = %v, want nil", err)
	}

	cases := []struct {
		name   string
		groups []config.PaletteGroup
	}{
		{"unknown shape code", []config.PaletteGroup{{Name: "g", Items: []string{"999"}}}},
		{"non-numeric junk", []config.PaletteGroup{{Name: "g", Items: []string{"bogus"}}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := lib.ValidatePalette(c.groups); err == nil {
				t.Errorf("ValidatePalette(%s) = nil, want an error", c.name)
			}
		})
	}
}

func TestValidateHotKeys(t *testing.T) {
	palette := []config.PaletteGroup{
		{Name: "Wires", Items: []string{"21", "22"}},
		{Name: "Switching devices", Items: []string{"41", "162"}},
	}
	got, err := ValidateHotKeys(map[string]string{"C": "41", "w": "21", "7": "162"}, palette)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got["c"] != "41" || got["w"] != "21" || got["7"] != "162" {
		t.Errorf("hot keys = %v, want lower-cased c/w/7", got)
	}
	if got, err := ValidateHotKeys(nil, palette); err != nil || len(got) != 0 {
		t.Errorf("no hot keys: %v, %v", got, err)
	}
	for _, c := range []struct {
		name string
		keys map[string]string
		want string
	}{
		{"two characters", map[string]string{"ww": "21"}, "single letter or digit"},
		{"not a letter or digit", map[string]string{"-": "21"}, "single letter or digit"},
		{"reserved rotate", map[string]string{"r": "41"}, "reserved (rotate)"},
		{"reserved mirror", map[string]string{"M": "41"}, "reserved (mirror)"},
		{"same key in two cases", map[string]string{"c": "41", "C": "162"}, "given twice"},
		{"not in the palette", map[string]string{"x": "999"}, "not a palette item"},
	} {
		if _, err := ValidateHotKeys(c.keys, palette); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: err = %v, want %q", c.name, err, c.want)
		}
	}
}
