package api

import (
	"math"

	"github.com/PVKonovalov/slddoc"
)

// importedShapeRewrites are the shapes an .svg/.xsde import turns into another one drawn alike: 71 and 320006 into
// Disconnector 162, Automation device 103 into Display panel 102. (12 needs none: Extract reads it as Picture 11.)
var importedShapeRewrites = map[string]struct {
	shape string
	class slddoc.Class
}{
	"71":     {"162", slddoc.ClassDisconnector},
	"320006": {"162", slddoc.ClassDisconnector},
	"103":    {"102", slddoc.ClassDisplayPanel},
}

// rewriteImportedShapes applies importedShapeRewrites to d, an extracted diagram. A rewritten 320006 keeps its
// terminals where its wires are (±21, farther apart than 162's) through Span, the distance of its port nodes.
// Returns whether anything changed.
func rewriteImportedShapes(d *slddoc.Diagram) bool {
	nodes := make(map[int]slddoc.Node, len(d.Nodes))
	for _, n := range d.Nodes {
		nodes[n.ID] = n
	}
	changed := false
	for i := range d.Elements {
		el := &d.Elements[i]
		to, ok := importedShapeRewrites[el.Shape]
		if !ok {
			continue
		}
		if el.Shape == "320006" && len(el.Ports) == 2 {
			a, okA := nodes[el.Ports[0].Node]
			b, okB := nodes[el.Ports[1].Node]
			if okA && okB {
				el.Span = math.Hypot(a.X-b.X, a.Y-b.Y)
			}
		}
		el.Shape, el.Class = to.shape, to.class
		changed = true
	}
	return changed
}
