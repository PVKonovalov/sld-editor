package config

import (
	"fmt"
	"strings"

	"github.com/PVKonovalov/slddoc"
)

// BarInstrument is the bar_instrument section: how a new bar instrument looks, and the colours of one that sets none
// of its own. Every key is optional.
type BarInstrument struct {
	Length    float64          `yaml:"length" json:"length"`
	Thickness float64          `yaml:"thickness" json:"thickness"`
	ValueSize float64          `yaml:"value_size" json:"valueSize"`
	ShowValue *bool            `yaml:"show_value" json:"showValue"`
	ShowScale *bool            `yaml:"show_scale" json:"showScale"`
	ShowZones *bool            `yaml:"show_zones" json:"showZones"`
	Colors    BarInstrumentRGB `yaml:"colors" json:"colors"`
}

// BarInstrumentRGB are the bar instrument's colours: the track, and the bar and value text in each zone.
type BarInstrumentRGB struct {
	Track   string `yaml:"track" json:"track"`
	Normal  string `yaml:"normal" json:"normal"`
	Warning string `yaml:"warning" json:"warning"`
	Alarm   string `yaml:"alarm" json:"alarm"`
	Bad     string `yaml:"bad" json:"bad"`
}

// DefaultBarInstrument is what an absent bar_instrument key takes.
var DefaultBarInstrument = BarInstrument{
	Length: 80, Thickness: 4, ValueSize: 12, ShowValue: new(true), ShowScale: new(false), ShowZones: new(true),
	Colors: BarInstrumentRGB{Track: "#3a3f47", Normal: "lawngreen", Warning: "#c9a800", Alarm: "red", Bad: "#808080"},
}

// ValidateBarInstrument checks bar_instrument and fills its absent keys from DefaultBarInstrument. Returns an error for
// a length, thickness or value size that is given but not positive, or a colour that is only blanks.
func (c *Config) ValidateBarInstrument() error {
	b, d := &c.BarInstrument, DefaultBarInstrument
	if b.Length < 0 || b.Thickness < 0 || b.ValueSize < 0 {
		return fmt.Errorf("bar_instrument: length, thickness and value_size must be positive")
	}
	if b.ValueSize == 0 {
		b.ValueSize = d.ValueSize
	}
	if b.Length == 0 {
		b.Length = d.Length
	}
	if b.Thickness == 0 {
		b.Thickness = d.Thickness
	}
	for _, f := range []struct{ v, d **bool }{{&b.ShowValue, &d.ShowValue}, {&b.ShowScale, &d.ShowScale}, {&b.ShowZones, &d.ShowZones}} {
		if *f.v == nil {
			*f.v = new(**f.d)
		}
	}
	for _, f := range []struct {
		name string
		v    *string
		d    string
	}{{"track", &b.Colors.Track, d.Colors.Track}, {"normal", &b.Colors.Normal, d.Colors.Normal}, {"warning", &b.Colors.Warning, d.Colors.Warning}, {"alarm", &b.Colors.Alarm, d.Colors.Alarm}, {"bad", &b.Colors.Bad, d.Colors.Bad}} {
		if *f.v == "" {
			*f.v = f.d
		} else if strings.TrimSpace(*f.v) == "" {
			return fmt.Errorf("bar_instrument.colors.%s: empty colour", f.name)
		} else if strings.ContainsAny(*f.v, `;:"`) {
			return fmt.Errorf("bar_instrument.colors.%s %q: must not contain ';', ':' or '\"'", f.name, *f.v)
		}
	}
	return nil
}

// RenderDefaults is b as slddoc's renderer takes it; b has been validated.
func (b BarInstrument) RenderDefaults() slddoc.BarDefaults {
	on := func(v *bool) bool { return v != nil && *v }
	return slddoc.BarDefaults{
		Length: b.Length, Thickness: b.Thickness, ValueSize: b.ValueSize, ShowValue: on(b.ShowValue), ShowScale: on(b.ShowScale), ShowZones: on(b.ShowZones),
		Colors: slddoc.BarColors{Track: b.Colors.Track, Normal: b.Colors.Normal, Warning: b.Colors.Warning, Alarm: b.Colors.Alarm, Bad: b.Colors.Bad},
	}
}
