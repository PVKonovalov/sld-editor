package config

import (
	"testing"

	"sld-editor/pkg/configuration"
)

func TestValidateLineHalos(t *testing.T) {
	for _, c := range []struct {
		name  string
		halos []LineHalo
		ok    bool
	}{
		{"valid", []LineHalo{{Style: "BadQuality", Color: "#f7d047"}, {Style: "linked", Color: "green", Gap: true}}, true},
		{"empty", nil, true},
		{"no color", []LineHalo{{Style: "linked"}}, false},
		{"no style", []LineHalo{{Color: "red"}}, false},
		{"separator", []LineHalo{{Style: "a,b", Color: "red"}}, false},
		{"twice", []LineHalo{{Style: "linked", Color: "red"}, {Style: "linked", Color: "blue"}}, false},
	} {
		cfg := Config{LineHalos: c.halos}
		if err := cfg.ValidateLineHalos(); (err == nil) != c.ok {
			t.Errorf("%s: err %v", c.name, err)
		}
	}
}

// TestShippedLineHalos checks the shipped configuration's line_halos load and validate.
func TestShippedLineHalos(t *testing.T) {
	var cfg Config
	if err := configuration.ReadConfigFromYMLFile("../../config/sld-editor.yaml", &cfg); err != nil {
		t.Fatal(err)
	}
	if err := cfg.ValidateLineHalos(); err != nil || len(cfg.LineHalos) != 6 || !cfg.LineHalos[5].Gap || cfg.LineHalos[0] != (LineHalo{Style: "BadQuality", Color: "#f7d047"}) {
		t.Errorf("line_halos = %+v, err %v", cfg.LineHalos, err)
	}
}
