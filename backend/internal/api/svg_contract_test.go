package api

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"strconv"
	"testing"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/elements"
	"sld-editor/internal/storage"
)

// componentShapes are the shapes RSDU has a component type for (VS_TCOMP.MODUS_TYPE of scheme type 518, the same on
// both test databases): the items an export writes as VS_COMP and ctrlroom shows values on.
var componentShapes = map[string]bool{"5": true, "41": true, "43": true, "51": true, "54": true, "106": true,
	"134": true, "162": true, "164": true, "398": true, "320001": true}

// noDataName are shapes xsde2svg writes without data-name; Static output keeps that (ctrlroom's context menu then has
// no heading).
var noDataName = map[string]bool{"292": true, "320001": true}

// TestSVGContract checks what ctrlroom reads from a saved .svg (its useSLD.ts and ContextMenu.vue): an element of each
// shape of the shipped library, a digital device and a label (shape 5) are rendered; an item of a component shape must be one SVG
// element whose id is its number (getElementById, VS_COMP.NAME), with data-type (its shape, the component's
// MODUS_TYPE) and data-name; any other item rendered with its id must carry its data-type.
func TestSVGContract(t *testing.T) {
	lib, err := elements.LoadAll([]string{"../../assets/elements/base.xml"})
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.New(t.TempDir(), lib.SymbolLibrary(), "", nil)
	if err != nil {
		t.Fatal(err)
	}
	d := &slddoc.Diagram{Width: 4000, Height: 4000, Layers: []slddoc.Layer{{ID: 1, Name: "L"}}}
	want := map[int]string{}
	for i, s := range lib.Symbols {
		id := 1000 + i
		x, y := float64(100+(i%20)*150), float64(100+(i/20)*150)
		d.Elements = append(d.Elements, slddoc.Element{ID: id, Class: slddoc.Class(s.Class), Shape: s.Shape, Name: "item " + strconv.Itoa(id), Layer: 1, X: x, Y: y})
		want[id] = s.Shape
	}
	d.DigitalDevices = []slddoc.DigitalDevice{{ID: 900, Layer: 1, X: 50, Y: 50, Size: 12}}
	want[900] = "134"
	d.Labels = []slddoc.Label{{ID: 901, Layer: 1, X: 50, Y: 20, Size: 12, Text: "label 901"}}
	want[901] = "5"
	if _, err := store.Save("contract", d); err != nil {
		t.Fatal(err)
	}
	svg, err := store.ReadSVG("contract")
	if err != nil {
		t.Fatal(err)
	}

	found := map[int]map[string]string{}
	dec := xml.NewDecoder(bytes.NewReader(svg))
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		se, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		attrs := map[string]string{}
		for _, a := range se.Attr {
			attrs[a.Name.Local] = a.Value
		}
		id, err := strconv.ParseUint(attrs["id"], 10, 64)
		if err != nil || want[int(id)] == "" {
			continue
		}
		if found[int(id)] != nil {
			t.Errorf("id %d is on more than one SVG element", id)
		}
		found[int(id)] = attrs
	}
	components := 0
	for id, shape := range want {
		a := found[id]
		if componentShapes[shape] {
			components++
		}
		switch {
		case a == nil:
			if componentShapes[shape] {
				t.Errorf("item %d (shape %s): no SVG element with its id", id, shape)
			}
		case a["data-type"] != shape:
			t.Errorf("item %d: data-type %q, want %q", id, a["data-type"], shape)
		case componentShapes[shape] && !noDataName[shape]:
			if _, ok := a["data-name"]; !ok {
				t.Errorf("item %d (shape %s): no data-name", id, shape)
			}
		}
	}
	if components != len(componentShapes) {
		t.Errorf("%d component shapes rendered, want %d: a shape is missing from the library", components, len(componentShapes))
	}
}
