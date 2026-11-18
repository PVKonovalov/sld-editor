package api

import (
	"testing"

	"github.com/PVKonovalov/slddoc"
)

// TestRewriteImportedShapes extracts a 71, a 320006 between two wires and a 103 and checks they become a 162, a 162
// whose Span keeps its terminals on the wires, and a 102.
func TestRewriteImportedShapes(t *testing.T) {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
<g id="1" data-type="71" >
<path d="M 50 106 v -13" data-state="1" style="fill:none;stroke:white;stroke-width:1" data-voltage="white" />
<path d="M 46 91 h 8 m 0 18 h -8" style="fill:none;stroke:white;stroke-width:1" data-voltage="white" />
<path d="M 50 91 v -1 M 50 109 v 1" style="fill:none;stroke:white;stroke-width:1" data-voltage="white" />
</g>
<polyline points="100,60 100,79" style="fill:none;stroke:white;stroke-width:1 " data-type="21" id="10" data-voltage="white" />
<g id="2" data-type="320006" >
<path d="M 100 106 v -13" data-state="1" style="fill:none;stroke:white;stroke-width:1" data-voltage="white" />
<path d="M 96 91 h 8 m 0 18 h -8" style="fill:none;stroke:white;stroke-width:1" data-voltage="white" />
<path d="M 100 91 v -12 M 100 109 v 12" style="fill:none;stroke:white;stroke-width:1" data-voltage="white" />
</g>
<polyline points="100,121 100,140" style="fill:none;stroke:white;stroke-width:1 " data-type="21" id="11" data-voltage="white" />
<g id="3" data-type="103" data-voltage="lime" >
<rect x="200" y="10" width="90" height="30" style="fill:lime;stroke:black;stroke-width:1" />
<text x="245" y="27" style="fill:#000000;text-anchor:middle;dominant-baseline:middle;font-size:12px;font-family:Arial " >On</text>
</g>
</svg>`
	d, _, err := slddoc.Extract([]byte(svg), "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !rewriteImportedShapes(d) {
		t.Fatal("nothing rewritten")
	}
	byID := map[int]slddoc.Element{}
	for _, el := range d.Elements {
		byID[el.ID] = el
	}
	if el := byID[1]; el.Shape != "162" || el.Class != slddoc.ClassDisconnector || el.Span != 0 {
		t.Errorf("71 -> %s/%s span %v", el.Shape, el.Class, el.Span)
	}
	if el := byID[2]; el.Shape != "162" || el.Class != slddoc.ClassDisconnector || el.Span != 42 {
		t.Errorf("320006 -> %s/%s span %v, want 162 span 42", el.Shape, el.Class, el.Span)
	}
	if el := byID[3]; el.Shape != "102" || el.Class != slddoc.ClassDisplayPanel || el.FillOff != "lime" || el.Stroke != "black" || el.PropertyText != "On" {
		t.Errorf("103 -> %+v", el)
	}
	if rewriteImportedShapes(d) {
		t.Error("second pass changed the diagram")
	}
}
