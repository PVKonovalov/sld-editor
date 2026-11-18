package elements

import (
	"bytes"
	"regexp"
	"strings"
	"testing"

	"github.com/PVKonovalov/slddoc"
)

// xsde2svg398 is how xsde2svg writes an open short-circuiter at (1660,648), rotated 90°: both states, only the current
// one visible.
const xsde2svg398 = `<g data-state="1" visibility="hidden" >
<path d="M 1660 659 l 0 -8" style="fill:none;stroke:#00A0F0;stroke-width:1" />
<path d="M 1664 642  v -6  l 8 3 z" style="fill:#00A0F0;stroke:#00A0F0;stroke-width:1" />
<path d="M 1660 651 h -5 m 5 0 h 5 M 1660 630 v -7 h -7 m 7 0 h 7 M 1660 620 h -5 M 1660 620 h 5 M 1660 617 h -3 M 1660 617 h 3" style="fill:none;stroke:#00A0F0;stroke-width:1" />
<path d="M 1660 632 v 16 M 1660 639 h 4 " style="fill:none;stroke:#00A0F0;stroke-width:1" />
</g>
<g data-state="0" visibility="visible" >
<path d="M 1660 659 l 0 -8" style="fill:none;stroke:#00A0F0;stroke-width:1" />
<path d="M 1659 642  v -6  l 8 3 z" style="fill:#00A0F0;stroke:#00A0F0;stroke-width:1" />
<path d="M 1660 651 h -5 m 5 0 h 5 M 1660 630 v -7 h -7 m 7 0 h 7 M 1660 620 h -5 M 1660 620 h 5 M 1660 617 h -3 M 1660 617 h 3" style="fill:none;stroke:#00A0F0;stroke-width:1" />
<path d="M 1658 630 a 2 2 0 1 1 4 0 a 2 2 0 1 1 -4 0 m 2 0 l -7 16 M 1656 639 h 3" style="fill:none;stroke:#00A0F0;stroke-width:1" />
</g>`

// TestShortCircuiterStatic: shape 398's saved SVG is xsde2svg's markup, and Extract reads it back (anchor, rotation,
// state, the port joined to a wire ending at the terminal) in both states, rotated and not.
func TestShortCircuiterStatic(t *testing.T) {
	lib, err := LoadFile("../../assets/elements/base.xml")
	if err != nil {
		t.Fatal(err)
	}
	ip := func(v int) *int { return &v }
	spaces := regexp.MustCompile(`\s+`)
	// Whitespace aside: the renderer writes no double spaces nor one before '>' or a closing quote.
	norm := func(s string) string {
		s = spaces.ReplaceAllString(strings.ToLower(s), " ")
		return strings.NewReplacer(` >`, `>`, ` "`, `"`).Replace(s)
	}
	for _, c := range []struct {
		orient, state int
		x, y          float64
	}{{90, 0, 1660, 648}, {90, 1, 1660, 648}, {0, 0, 200, 200}, {0, 1, 200, 200}, {180, 0, 300, 300}} {
		el := slddoc.Element{ID: 1, Class: slddoc.ClassShortCircuiter, Shape: "398", X: c.x, Y: c.y, Orient: c.orient, State: ip(c.state), Voltage: 2,
			Ports: []slddoc.Port{{Name: "1", Node: 10}}}
		end := slddoc.Point{X: c.x, Y: c.y + 10}
		switch c.orient {
		case 90:
			end = slddoc.Point{X: c.x - 10, Y: c.y}
		case 180:
			end = slddoc.Point{X: c.x, Y: c.y - 10}
		}
		d := &slddoc.Diagram{Width: 2000, Height: 1000, Elements: []slddoc.Element{el},
			VoltageClasses: []slddoc.VoltageClass{{ID: 2, Name: "110", Color: "#00A0F0"}},
			Nodes:          []slddoc.Node{{ID: 10, X: end.X, Y: end.Y}, {ID: 11, X: end.X, Y: end.Y + 40}},
			Connectors: []slddoc.Connector{{ID: 3, Kind: slddoc.KindBusWork, From: 10, To: 11, Voltage: 2,
				Points: []slddoc.Point{end, {X: end.X, Y: end.Y + 40}}}}}
		var buf bytes.Buffer
		if err := slddoc.Render(d, lib.SymbolLibrary(), &buf, slddoc.Static, "", nil); err != nil {
			t.Fatal(err)
		}
		if c.orient == 90 && c.state == 0 && !strings.Contains(norm(buf.String()), norm(xsde2svg398)) {
			t.Errorf("not xsde2svg's markup:\n%s", buf.String())
		}
		got, report, err := slddoc.Extract(buf.Bytes(), "", nil)
		if err != nil || len(report.Failed) > 0 || len(got.Elements) != 1 {
			t.Fatalf("%+v: Extract err=%v failed=%v", c, err, report.Failed)
		}
		g := got.Elements[0]
		if g.Shape != "398" || g.X != c.x || g.Y != c.y || g.Orient != c.orient || g.State == nil || *g.State != c.state || len(g.Ports) != 1 {
			t.Errorf("%+v: extracted %+v (state %v)", c, g, g.State)
			continue
		}
		joined := false
		for _, w := range got.Connectors {
			joined = joined || w.From == g.Ports[0].Node || w.To == g.Ports[0].Node
		}
		if !joined {
			t.Errorf("%+v: port not joined to the wire", c)
		}
	}
}
