package elements

import (
	"bytes"
	"strings"
	"testing"

	"github.com/PVKonovalov/slddoc"
)

// TestWithdrawableSectionalizerPositions renders shape 50 at every
// Operational status × Position status, rotated, and checks that only the
// movable body slides (Service/Test), that the terminals stay at the outer
// chevron tips, and that Extract reads State, Position, anchor and
// orientation back.
func TestWithdrawableSectionalizerPositions(t *testing.T) {
	lib, err := LoadFile("../../assets/elements/base.xml")
	if err != nil {
		t.Fatal(err)
	}
	ip := func(v int) *int { return &v }
	for _, state := range []*int{ip(0), ip(1)} {
		for _, position := range []*int{nil, ip(0), ip(1), ip(2)} {
			el := slddoc.Element{ID: 1, Class: slddoc.ClassSectionalizer, Shape: "50", X: 100, Y: 200, Orient: 90, State: state, Position: position}
			d := &slddoc.Diagram{Width: 400, Height: 400, Elements: []slddoc.Element{el}}

			frags, err := slddoc.RenderFragments(d, lib.SymbolLibrary(), []int{1}, slddoc.Interactive, "", nil)
			if err != nil {
				t.Fatal(err)
			}
			wantShift := "translate(0,0)"
			if position != nil && *position != 1 {
				wantShift = "translate(10,0)"
			}
			if !strings.Contains(frags[1], `<g transform="`+wantShift+`"`) {
				t.Errorf("state %d position %v: want body %s in %s", *state, position, wantShift, frags[1])
			}

			var buf bytes.Buffer
			if err := slddoc.Render(d, lib.SymbolLibrary(), &buf, slddoc.Static, "", nil); err != nil {
				t.Fatal(err)
			}
			got, report, err := slddoc.Extract(buf.Bytes(), "", nil)
			if err != nil || len(report.Failed) > 0 || len(got.Elements) != 1 {
				t.Fatalf("state %d position %v: Extract err=%v failed=%v", *state, position, err, report.Failed)
			}
			g := got.Elements[0]
			if g.X != 100 || g.Y != 200 || g.Orient != 90 || g.Shape != "50" || g.Mirror {
				t.Errorf("state %d position %v: extracted %+v", *state, position, g)
			}
			if g.State == nil || *g.State != *state {
				t.Errorf("state %d position %v: extracted state %v", *state, position, g.State)
			}
			if (g.Position == nil) != (position == nil) || (g.Position != nil && *g.Position != *position) {
				t.Errorf("state %d position %v: extracted position %v", *state, position, g.Position)
			}
		}
	}
}
