package elements

import (
	"bytes"
	"strings"
	"testing"

	"github.com/PVKonovalov/slddoc"
)

// TestKnifeSwitchPositions renders Knife switch (44) and 3-position knife
// switch (175) at each blade position, rotated, and checks that the blade is
// drawn to the right contact and that Extract reads the position back.
func TestKnifeSwitchPositions(t *testing.T) {
	lib, err := LoadFile("../../assets/elements/base.xml")
	if err != nil {
		t.Fatal(err)
	}
	ip := func(v int) *int { return &v }
	cases := []struct {
		shape, class string
		state        *int
		blade        string // Interactive blade path, local coordinates
	}{
		{"44", "KnifeSwitch", nil, "M -10 -10 L 0 10"},
		{"44", "KnifeSwitch", ip(0), "M -10 -10 L 0 10"},
		{"44", "KnifeSwitch", ip(2), "M 10 -10 L 0 10"},
		{"175", "KnifeSwitch3", ip(0), "M -0.9 8.2 L -9.1 -8.2"},
		{"175", "KnifeSwitch3", ip(1), "M 0 8 V -8"},
		{"175", "KnifeSwitch3", ip(2), "M 0.9 8.2 L 9.1 -8.2"},
	}
	for _, c := range cases {
		el := slddoc.Element{ID: 1, Class: slddoc.Class(c.class), Shape: c.shape, X: 100, Y: 200, Orient: 90, State: c.state}
		d := &slddoc.Diagram{Width: 400, Height: 400, Elements: []slddoc.Element{el}}

		frags, err := slddoc.RenderFragments(d, lib.SymbolLibrary(), []int{1}, slddoc.Interactive, "", nil)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(frags[1], `d="`+c.blade+`"`) {
			t.Errorf("shape %s state %v: want blade %q in %s", c.shape, c.state, c.blade, frags[1])
		}

		var buf bytes.Buffer
		if err := slddoc.Render(d, lib.SymbolLibrary(), &buf, slddoc.Static, "", nil); err != nil {
			t.Fatal(err)
		}
		got, report, err := slddoc.Extract(buf.Bytes(), "", nil)
		if err != nil || len(report.Failed) > 0 || len(got.Elements) != 1 {
			t.Fatalf("shape %s state %v: Extract err=%v failed=%v", c.shape, c.state, err, report.Failed)
		}
		g := got.Elements[0]
		if (g.State == nil) != (c.state == nil) || (g.State != nil && *g.State != *c.state) {
			t.Errorf("shape %s: extracted state %v, want %v", c.shape, g.State, c.state)
		}
		if g.X != 100 || g.Y != 200 || g.Orient != 90 {
			t.Errorf("shape %s state %v: extracted (%v,%v) orient %d", c.shape, c.state, g.X, g.Y, g.Orient)
		}
	}
}
