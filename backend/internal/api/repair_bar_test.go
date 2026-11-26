package api

import (
	"testing"

	"github.com/PVKonovalov/slddoc"
)

func TestDropDefaultBarColors(t *testing.T) {
	defaults := slddoc.BarColors{Track: "#3a3f47", Normal: "lawngreen", Warning: "#c9a800", Alarm: "red", Bad: "#808080"}
	b := slddoc.BarInstrument{Colors: &slddoc.BarColors{Track: "#3A3F47", Normal: "blue", Warning: "#c9a800", Alarm: "red", Bad: "#808080"}}
	dropDefaultBarColors(&b, defaults)
	if b.Colors == nil || *b.Colors != (slddoc.BarColors{Normal: "blue"}) {
		t.Errorf("got %+v, want only normal blue", b.Colors)
	}
	b.Colors.Normal = "LawnGreen"
	dropDefaultBarColors(&b, defaults)
	if b.Colors != nil {
		t.Errorf("all defaults: got %+v, want nil", b.Colors)
	}
}
