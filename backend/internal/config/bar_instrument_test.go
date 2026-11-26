package config

import (
	"slices"
	"testing"

	"sld-editor/pkg/configuration"
)

func TestValidateBarInstrument(t *testing.T) {
	var cfg Config
	cfg.BarInstrument.Thickness = 6
	cfg.BarInstrument.ShowZones = new(false)
	cfg.BarInstrument.Colors.Alarm = "#ff3030"
	if err := cfg.ValidateBarInstrument(); err != nil {
		t.Fatal(err)
	}
	b := cfg.BarInstrument
	if b.Length != 80 || b.Thickness != 6 || b.ValueSize != 12 || !*b.ShowValue || *b.ShowScale || *b.ShowZones || b.Colors.Alarm != "#ff3030" || b.Colors.Track != "#3a3f47" {
		t.Errorf("defaults not filled: %+v", b)
	}
	for name, edit := range map[string]func(*BarInstrument){
		"negative length":     func(b *BarInstrument) { b.Length = -1 },
		"negative thickness":  func(b *BarInstrument) { b.Thickness = -2 },
		"negative value size": func(b *BarInstrument) { b.ValueSize = -1 },
		"blank colour":        func(b *BarInstrument) { b.Colors.Normal = "  " },
		"separator":           func(b *BarInstrument) { b.Colors.Bad = "a;b" },
	} {
		var c Config
		edit(&c.BarInstrument)
		if err := c.ValidateBarInstrument(); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestShippedBarInstrument(t *testing.T) {
	var cfg Config
	if err := configuration.ReadConfigFromYMLFile("../../config/sld-editor.example.yaml", &cfg); err != nil {
		t.Fatal(err)
	}
	want := DefaultBarInstrument
	if err := cfg.ValidateBarInstrument(); err != nil || cfg.BarInstrument.Length != want.Length || cfg.BarInstrument.Colors != want.Colors ||
		*cfg.BarInstrument.ShowValue != *want.ShowValue || *cfg.BarInstrument.ShowScale != *want.ShowScale || *cfg.BarInstrument.ShowZones != *want.ShowZones {
		t.Errorf("shipped bar_instrument %+v (%v) differs from the defaults", cfg.BarInstrument, err)
	}
	inPalette := false
	for _, g := range cfg.Palette {
		inPalette = inPalette || g.Name == "Indicators" && slices.Contains(g.Items, "320008")
	}
	if !inPalette {
		t.Error("320008 is not in the Indicators palette group")
	}
}
