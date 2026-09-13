package slddoc

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"regexp"
)

// BaseLayer is the implicit layer every element belongs to when a diagram
// carries no other layer for it. It is always present in a Diagram's Layers
// so "one element, exactly one layer" holds without exception.
const BaseLayer = 0

// Diagram is the root of the SLD document model.
type Diagram struct {
	XMLName xml.Name `xml:"diagram" json:"-"`

	Width  float64 `xml:"width,attr" json:"width"`
	Height float64 `xml:"height,attr" json:"height"`
	Source string  `xml:"source,attr,omitempty" json:"source,omitempty"`

	// LastID is the highest auto-assigned integer id this editor has ever
	// handed out for an Element/Node/Connector/VoltageClass in this diagram
	// (a single shared counter, not one per kind). The editor increments
	// and persists it here rather than deriving a fresh id from scratch
	// each time, so ids stay stable and never collide across a save/reopen
	// — see the frontend's diagramOps.ts, which is the only place that
	// actually assigns one. Every id is a positive integer (IdSequence
	// starts counting at 1), so 0 doubles as a safe "unset" sentinel for
	// every optional id-reference field below (Element.Voltage, Label.For,
	// ...) without needing a separate pointer/nullable type.
	LastID int `xml:"lastId,attr,omitempty" json:"lastId,omitempty"`

	// Editor holds this editor's own per-diagram preferences (grid
	// spacing/snap/background). Absent (nil) for a diagram that has never
	// been saved by this editor, or one produced by sld-svg's own tooling;
	// callers fall back to the server's configured defaults in that case.
	Editor *EditorSettings `xml:"editor,omitempty" json:"editor,omitempty"`

	Layers         []Layer        `xml:"layers>layer" json:"layers"`
	VoltageClasses []VoltageClass `xml:"voltageClasses>class" json:"voltageClasses"`
	Nodes          []Node         `xml:"nodes>node" json:"nodes"`
	Elements       []Element      `xml:"elements>element" json:"elements"`
	Connectors     []Connector    `xml:"connectors>connector" json:"connectors"`
	Labels         []Label        `xml:"labels>label" json:"labels"`
}

// EditorSettings is a diagram's own saved editing preferences. It has no
// effect on rendering an already-placed Element/Connector — only on the
// canvas UI (grid overlay, snapping, background).
type EditorSettings struct {
	GridSpacing float64 `xml:"gridSpacing,attr,omitempty" json:"gridSpacing,omitempty"`
	Snap        bool    `xml:"snap,attr,omitempty" json:"snap,omitempty"`
	Background  string  `xml:"background,attr,omitempty" json:"background,omitempty"`
}

// Layer is one entry of a diagram's visibility layers. A viewer toggles
// elements on and off by Layer.ID; every Element/Connector/Label carries
// exactly one Layer reference.
type Layer struct {
	ID   int    `xml:"id,attr" json:"id"`
	Name string `xml:"name,attr" json:"name"`
}

// VoltageClass maps a logical, real-world voltage level (e.g. "10 kV") to the
// color used to draw it in this diagram. Voltage is a logical attribute of
// an Element/Connector, not a color — VoltageClass is the only place a color
// is recorded, purely for rendering.
type VoltageClass struct {
	ID    int    `xml:"id,attr" json:"id"`
	Name  string `xml:"name,attr" json:"name"`
	Color string `xml:"color,attr" json:"color"`
}

// Node is an electrical junction: every Port and Connector endpoint that
// shares a Node.ID is electrically connected.
type Node struct {
	ID int     `xml:"id,attr" json:"id"`
	X  float64 `xml:"x,attr" json:"x"`
	Y  float64 `xml:"y,attr" json:"y"`
}

// Port is one electrical terminal of an Element, in the element's own local
// (pre-rotation) coordinate space, referencing the Node it resolves to.
type Port struct {
	Name string `xml:"name,attr" json:"name"`
	Node int    `xml:"node,attr" json:"node"`
}

// Class names an Element's real-world equipment kind, independent of the
// symbol library Shape code used to draw it.
type Class string

const (
	ClassBreaker               Class = "Breaker"
	ClassDisconnector          Class = "Disconnector"
	ClassLoadBreakSwitch       Class = "LoadBreakSwitch"
	ClassGroundSwitch          Class = "GroundSwitch"
	ClassGround                Class = "Ground"
	ClassPowerTransformer      Class = "PowerTransformer"
	ClassCurrentTransformer    Class = "CurrentTransformer"
	ClassChokeCoil             Class = "ChokeCoil"
	ClassSurgeArrester         Class = "SurgeArrester"
	ClassFuse                  Class = "Fuse"
	ClassCapacitor             Class = "Capacitor"
	ClassBusBarSection         Class = "BusBarSection"
	ClassJunctionPoint         Class = "JunctionPoint"
	ClassLamp                  Class = "Lamp"
	ClassFaultPassageIndicator Class = "FaultPassageIndicator"
)

// Element is one placed piece of equipment.
type Element struct {
	ID    int   `xml:"id,attr" json:"id"`
	Class Class `xml:"class,attr" json:"class"`
	// Shape keys the symbol library template used to draw this element
	// (see internal/elements). Two shapes can share the same electrical
	// Class (a fixed and a withdrawable breaker are both ClassBreaker) but
	// need different templates, so the renderer looks symbols up by Shape,
	// not by Class. Unlike every other id-shaped field here, Shape is a
	// symbol-library key, not a sequentially assigned identity, so it
	// stays a string.
	Shape string `xml:"shape,attr" json:"shape"`
	Name  string `xml:"name,attr,omitempty" json:"name,omitempty"`
	// Voltage references a VoltageClass.ID; 0 means unassigned.
	Voltage int `xml:"voltage,attr,omitempty" json:"voltage,omitempty"`
	// Layer references a Layer.ID; always set (defaults to BaseLayer).
	Layer int `xml:"layer,attr" json:"layer"`

	// X, Y is the element's anchor: its rotation center for a rotated
	// symbol, or the midpoint of its ports otherwise.
	X float64 `xml:"x,attr" json:"x"`
	Y float64 `xml:"y,attr" json:"y"`
	// Orient is the rotation applied to the symbol template around (X,Y),
	// in degrees (0, 90, 180, -90).
	Orient int `xml:"orient,attr,omitempty" json:"orient,omitempty"`
	// State carries an element's status (e.g. breaker open/closed), when
	// one applies to this class.
	State *int `xml:"state,attr,omitempty" json:"state,omitempty"`
	// FillOff/FillOn are a Lamp's (shape 106) two display colors, chosen by
	// State. Unlike the switch-like devices' state indicator (a fixed
	// red/lawngreen/yellow convention), a lamp's colors are chosen per
	// instance and carry real meaning, so they're recorded rather than
	// reduced to that convention.
	FillOff string `xml:"fillOff,attr,omitempty" json:"fillOff,omitempty"`
	FillOn  string `xml:"fillOn,attr,omitempty" json:"fillOn,omitempty"`
	// Radius is a Lamp's (shape 106) or FaultPassageIndicator's (shape
	// 320003) drawn circle radius; unlike other shapes' fixed template
	// geometry, these are meaningfully different per instance.
	Radius float64 `xml:"radius,attr,omitempty" json:"radius,omitempty"`

	Ports []Port `xml:"port,omitempty" json:"ports,omitempty"`
	// Points holds a BusBarSection's own drawn geometry (its two or more
	// vertices); unused by point-symbol classes.
	Points []Point `xml:"geometry>point,omitempty" json:"points,omitempty"`
}

// ConnectorKind names a Connector's real-world wire kind.
type ConnectorKind string

const (
	KindBusbarWire   ConnectorKind = "BusbarWire"
	KindOverheadLine ConnectorKind = "OverheadLine"
	KindCableLine    ConnectorKind = "CableLine"
	KindObjectLink   ConnectorKind = "ObjectLink"
)

// Connector is a drawn wire segment: a chain of points whose two ends
// resolve to electrical Nodes.
type Connector struct {
	ID      int           `xml:"id,attr" json:"id"`
	Kind    ConnectorKind `xml:"kind,attr" json:"kind"`
	Voltage int           `xml:"voltage,attr,omitempty" json:"voltage,omitempty"`
	Layer   int           `xml:"layer,attr" json:"layer"`
	Dashed  bool          `xml:"dashed,attr,omitempty" json:"dashed,omitempty"`
	From    int           `xml:"from,attr" json:"from"`
	To      int           `xml:"to,attr" json:"to"`

	Points []Point `xml:"point" json:"points"`
}

// Point is one X,Y coordinate in the diagram's own coordinate space.
type Point struct {
	X float64 `xml:"x,attr" json:"x"`
	Y float64 `xml:"y,attr" json:"y"`
}

// Label is a standalone text caption. For carries the id of the Element it
// annotates (0 means unset — a standalone label).
type Label struct {
	For    int     `xml:"for,attr,omitempty" json:"for,omitempty"`
	Layer  int     `xml:"layer,attr" json:"layer"`
	X      float64 `xml:"x,attr" json:"x"`
	Y      float64 `xml:"y,attr" json:"y"`
	Size   float64 `xml:"size,attr" json:"size"`
	Anchor string  `xml:"anchor,attr,omitempty" json:"anchor,omitempty"`
	Bold   bool    `xml:"bold,attr,omitempty" json:"bold,omitempty"`
	Text   string  `xml:",chardata" json:"text"`
}

// emptyElement matches a start tag immediately followed by its own end tag
// (encoding/xml never emits self-closing tags, even for elements with no
// content), so Save can collapse them into the shorter self-closing form.
var emptyElement = regexp.MustCompile(`<([A-Za-z][\w:.-]*)((?:\s+[A-Za-z_:][\w:.-]*="[^"]*")*)></([A-Za-z][\w:.-]*)>`)

// Save writes d as indented XML.
func (d *Diagram) Save(w io.Writer) error {
	if _, err := io.WriteString(w, xml.Header); err != nil {
		return err
	}
	var buf bytes.Buffer
	enc := xml.NewEncoder(&buf)
	enc.Indent("", "  ")
	if err := enc.Encode(d); err != nil {
		return fmt.Errorf("slddoc: encoding diagram: %w", err)
	}
	out := emptyElement.ReplaceAll(buf.Bytes(), []byte("<$1$2/>"))
	if _, err := w.Write(out); err != nil {
		return err
	}
	_, err := io.WriteString(w, "\n")
	return err
}

// Load reads a Diagram previously written by Save.
func Load(r io.Reader) (*Diagram, error) {
	var d Diagram
	if err := xml.NewDecoder(r).Decode(&d); err != nil {
		return nil, fmt.Errorf("slddoc: decoding diagram: %w", err)
	}
	return &d, nil
}
