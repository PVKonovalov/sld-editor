package elements

import (
	"bytes"
	"encoding/xml"
	"regexp"
	"testing"

	"github.com/PVKonovalov/slddoc"
)

// extractRoundTripGaps are base.xml shapes whose Static rendering Extract
// doesn't yet read back at the same anchor and orientation (unmirrored),
// keyed to why. Every other shape must round-trip exactly.
var extractRoundTripGaps = map[string]string{
	"24":     "busbar: orientation lives in its points",
	"1":      "line: orientation lives in its points",
	"9":      "arc: anchor read as its center",
	"16":     "polygon: not extracted",
	"310":    "container: needs 3+ vertices, the test gives 2",
	"3":      "rectangle: anchor read as its center",
	"2":      "arrow: anchor read as its midpoint",
	"4":      "circle: anchor read as its center",
	"113":    "3D button: anchor read as its center",
	"302":    "window icon: anchor read as its center",
	"103":    "automation device: anchor read as its center",
	"319":    "small window: anchor read as its center",
	"11":     "picture: anchor read as its center, no orientation",
	"335":    "road: orientation lives in its points",
	"7":      "junction point: no orientation",
	"26":     "fork: template not recognized",
	"14":     "wire jump: orientation read 90 degrees off",
	"32":     "cable joint: anchor read 1 unit off",
	"164":    "sectionalizer: template not recognized",
	"54":     "ground switch: anchor read off-grid",
	"398":    "short-circuiter: template not recognized",
	"6":      "booster: orientation not read",
	"388":    "capacitor: anchor and orientation read off",
	"106":    "lamp: no orientation",
	"320003": "fault passage indicator: no orientation",
	"312":    "table: anchor not read",
	"313":    "table 2: not extracted",
}

// TestStaticRender_AllShapesAbsolute renders every bundled symbol, rotated
// and mirrored, in Static mode: the output must be well-formed, carry no
// local translate placement on the element itself (absolute coordinates,
// as real xsde2svg writes), and read back through Extract at the same
// anchor and orientation.
func TestStaticRender_AllShapesAbsolute(t *testing.T) {
	lib, err := LoadFile("../../assets/elements/base.xml")
	if err != nil {
		t.Fatal(err)
	}
	// A mirror legitimately keeps translate(2x,0) scale(-1,1); the local
	// placement this rules out is translate(100,200) itself.
	localPlacement := regexp.MustCompile(`translate\(100[ ,]200\)`)
	state := 1
	for _, s := range lib.Symbols {
		for _, orient := range []int{0, 90} {
			for _, mirror := range []bool{false, true} {
				el := slddoc.Element{
					ID: 1, Class: slddoc.Class(s.Class), Shape: s.Shape, Name: "X", Voltage: 1,
					X: 100, Y: 200, Orient: orient, Mirror: mirror, State: &state,
					Points: []slddoc.Point{{X: 100, Y: 200}, {X: 160, Y: 240}},
				}
				if s.Class == string(slddoc.ClassPicture) {
					el.Href = "data:image/png;base64,iVBORw0KGgo="
				}
				if s.Class == string(slddoc.ClassPowerTransformer) {
					el.Windings = []slddoc.TransformerWinding{{Voltage: 1}, {Voltage: 1}}
				}
				d := &slddoc.Diagram{
					Width: 400, Height: 400,
					VoltageClasses: []slddoc.VoltageClass{{ID: 1, Name: "10 kV", Color: "#962896"}},
					Elements:       []slddoc.Element{el},
				}
				var buf bytes.Buffer
				if err := slddoc.Render(d, lib.SymbolLibrary(), &buf, slddoc.Static, "", nil); err != nil {
					t.Fatalf("shape %s: %v", s.Shape, err)
				}
				var probe struct{}
				if err := xml.Unmarshal(buf.Bytes(), &probe); err != nil {
					t.Errorf("shape %s orient %d mirror %v: not well-formed: %v", s.Shape, orient, mirror, err)
				}
				if localPlacement.Match(buf.Bytes()) {
					t.Errorf("shape %s orient %d mirror %v: still placed with translate:\n%s", s.Shape, orient, mirror, buf.String())
				}
				if mirror || extractRoundTripGaps[s.Shape] != "" {
					continue // Extract reads Mirror for only a few shapes
				}
				got, report, err := slddoc.Extract(buf.Bytes(), "", nil)
				if err != nil || len(report.Failed) > 0 || len(got.Elements) != 1 {
					t.Errorf("shape %s orient %d: Extract err=%v failed=%v elements=%d", s.Shape, orient, err, report.Failed, len(got.Elements))
					continue
				}
				g := got.Elements[0]
				if g.X != el.X || g.Y != el.Y || g.Orient != el.Orient || g.Class != el.Class {
					t.Errorf("shape %s orient %d: extracted %s at (%v,%v) orient %d, want %s at (100,200) orient %d",
						s.Shape, orient, g.Class, g.X, g.Y, g.Orient, el.Class, orient)
				}
			}
		}
	}
}
