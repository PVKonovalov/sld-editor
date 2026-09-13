package slddoc

import (
	"fmt"
	"io"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// defaultBackground is used when a Diagram carries no Editor.Background.
const defaultBackground = "#12161d"

// RenderMode controls whether Render adds this editor's own
// interactivity-only markup on top of an otherwise xsde2svg-faithful
// rendering.
type RenderMode int

const (
	// Static renders a clean, xsde2svg-faithful document: no
	// data-editor-kind attribute, no invisible hit-target geometry. Use
	// this for anything written to disk or served as a downloadable
	// artifact (the saved .svg, GET /diagrams/:name/svg) — an id, when the
	// element/connector has one, is still present either way, since a real
	// xsde2svg document carries one too.
	Static RenderMode = iota
	// Interactive adds a data-editor-kind="element"|"connector" attribute
	// and a wider invisible hit target around small symbol geometry, so
	// the frontend's canvas can hit-test a click. Never written to disk —
	// use this only for the live in-app preview (POST /render).
	Interactive
)

var attrEscaper = strings.NewReplacer(`&`, "&amp;", `<`, "&lt;", `>`, "&gt;", `"`, "&quot;")

func esc(s string) string { return attrEscaper.Replace(s) }

func fmtNum(v float64) string {
	if v == math.Trunc(v) {
		return strconv.FormatInt(int64(v), 10)
	}
	return strconv.FormatFloat(v, 'g', -1, 64)
}

// StateColor is one entry of the install-wide Open/Close/Intermediate
// legend a switching device's state-driven {fill} and data-fill attribute
// are drawn from (see config.Config.StateColors) — supplied by the caller
// rather than fixed in this package, since it's a deployment's own choice
// of colors/labels, not part of the diagram or the symbol library.
type StateColor struct {
	State int
	Label string
	Color string
}

// stateColorSet is StateColors reshaped for fast per-element lookup plus
// the pre-built data-fill legend string, computed once per Render call
// rather than once per element.
type stateColorSet struct {
	colors   map[int]string
	fillAttr string
}

func newStateColorSet(colors []StateColor) stateColorSet {
	set := stateColorSet{colors: make(map[int]string, len(colors))}
	parts := make([]string, len(colors))
	for i, c := range colors {
		set.colors[c.State] = c.Color
		parts[i] = fmt.Sprintf("%d:%s", c.State, c.Color)
	}
	if len(parts) > 0 {
		set.fillAttr = fmt.Sprintf(` data-fill="%s"`, strings.Join(parts, ","))
	}
	return set
}

// fill resolves a switching device's current-state fill: the configured
// color for its State, or "none" when State was never recorded or doesn't
// match any configured entry.
func (s stateColorSet) fill(state *int) string {
	if state == nil {
		return "none"
	}
	if c, ok := s.colors[*state]; ok {
		return c
	}
	return "none"
}

// stateAttr is a real xsde2svg breaker/switch's data-state attribute on its
// state-indicator path: the element's own raw State value, or no attribute
// at all when State was never recorded (fill's "none" case has no
// analogous data-state — there is no value to publish).
func stateAttr(state *int) string {
	if state == nil {
		return ""
	}
	return fmt.Sprintf(` data-state="%d"`, *state)
}

// stateLineRe matches a template's {state:parallel|perpendicular|diagonal}
// placeholder: the switch-like devices' internal state indicator, drawn
// parallel to the device's own (locally-vertical) axis when closed (state
// 1), perpendicular when open (state 0), and at 45° for any other recorded
// state.
var stateLineRe = regexp.MustCompile(`\{state:([^|}]*)\|([^|}]*)\|([^}]*)\}`)

func applyStateLine(tmpl string, state *int) string {
	return stateLineRe.ReplaceAllStringFunc(tmpl, func(m string) string {
		g := stateLineRe.FindStringSubmatch(m)
		switch {
		case state == nil, *state == 1:
			return g[1]
		case *state == 0:
			return g[2]
		default:
			return g[3]
		}
	})
}

// lampColor picks a Lamp element's current display color: FillOn when
// State records 1 (lit), FillOff otherwise (including an unrecorded
// state).
func lampColor(e Element) string {
	color := e.FillOff
	if e.State != nil && *e.State == 1 {
		color = e.FillOn
	}
	if color == "" {
		color = "none"
	}
	return color
}

// shapeName gives the equipment name Render annotates a run of same-Shape
// elements with. Kept per-shape rather than per-Class since a fixed
// breaker and a withdrawable one, e.g., are both ClassBreaker but draw and
// are labeled differently.
var shapeName = map[string]string{
	"7":      "Junction point",
	"24":     "Busbar",
	"31":     "Ground terminal",
	"33":     "Choke coil",
	"34":     "Current transformer",
	"35":     "Surge arrester",
	"41":     "Breaker",
	"42":     "Load-break switch",
	"43":     "Breaker (withdrawable)",
	"47":     "Power transformer",
	"49":     "Disconnector (withdrawable)",
	"54":     "Ground switch",
	"71":     "Disconnector",
	"106":    "Lamp",
	"162":    "Disconnector",
	"203":    "Fuse",
	"388":    "Capacitor",
	"320003": "Fault passage indicator",
}

// connectorKindName gives the name Render annotates a run of same-Kind
// connectors with, the same way shapeName does for elements.
var connectorKindName = map[string]string{
	string(KindBusbarWire):   "Busbar wire",
	string(KindOverheadLine): "Overhead line",
	string(KindCableLine):    "Cable line",
	string(KindObjectLink):   "Buswork",
}

// connectorTypeCode gives a Connector's data-type, mirroring an Element's
// Shape-as-data-type: the xsde2svg type code for a generic object-to-object
// connection (this schema's ClassObjectLink/KindObjectLink — what
// diagramOps.connectElements creates) is 21. Only that one kind is mapped
// so far; a Kind absent from this map renders with no data-type, same as
// before this existed.
var connectorTypeCode = map[ConnectorKind]string{
	KindObjectLink: "21",
}

// typeComment writes a "<!-- Name:shape -->" line the first time shape is
// seen or whenever it changes from the previous call, so consecutive
// same-shape elements/connectors get one header rather than a redundant
// repeat for every instance. last is updated in place.
func typeComment(w io.Writer, names map[string]string, key, code string, last *string) {
	if key == "" || key == *last {
		return
	}
	*last = key
	name, ok := names[key]
	if !ok {
		name = key
	}
	label := name
	if code != "" {
		label += ":" + code
	}
	fmt.Fprintf(w, "<!-- %s -->\n", esc(label))
}

// elementZOrder ranks the handful of Element classes that must draw above
// connectors rather than in ordinary document order, instead of the default
// 0 (drawn in document order, before connectors): JunctionPoint and
// FaultPassageIndicator sit directly on top of a wire — unlike ordinary
// equipment, which only ever touches a connector at a port, so painting the
// wire afterward would cut through them — and Lamp is a decorative status
// indicator meant to read as foreground UI. Render draws every such class in
// ascending order of this value, each tier after the connectors loop.
var elementZOrder = map[Class]int{
	ClassJunctionPoint:         1,
	ClassLamp:                  1,
	ClassFaultPassageIndicator: 1,
}

// renderElement writes one Element's symbol (or, for a BusBarSection, its
// drawn polyline), recording its Shape in missing/seenMissing when lib has
// no template for it. lastShape tracks the running type-comment header, the
// same way across whichever pass of Render calls it.
func renderElement(w io.Writer, lib *SymbolLibrary, voltageColor map[int]string, stateColors stateColorSet, e Element, missing *[]string, seenMissing map[string]bool, lastShape *string, mode RenderMode) {
	typeComment(w, shapeName, e.Shape, e.Shape, lastShape)

	var color string
	if e.Class == ClassLamp {
		// A Lamp's colors are its own FillOff/FillOn pair, not a
		// VoltageClass — it isn't part of the electrical network.
		color = lampColor(e)
	} else if e.Class == ClassFaultPassageIndicator {
		// Every real instance draws the same fixed dark fill regardless
		// of state; it isn't part of the electrical network either.
		color = defaultBackground
	} else {
		color = voltageColor[e.Voltage]
		if color == "" {
			// A PowerTransformer's two windings can carry different
			// voltages that this schema doesn't record per-port; fall
			// back to a visible neutral color rather than emitting an
			// empty stroke.
			color = "gray"
		}
	}
	if e.Class == ClassBusBarSection {
		// A busbar's own data-name/data-voltage/data-type mirror what a
		// real xsde2svg-exported busbar polyline carries (data-voltage is
		// the resolved color, not a VoltageClass id — this schema has no
		// separate concept of one for a bare polyline); drawn at 4px, a
		// deliberately heavier stroke than an ordinary wire's 1px, since a
		// busbar reads as the diagram's backbone, not just another wire.
		dataAttrs := fmt.Sprintf(" data-name=\"%s\" data-voltage=\"%s\" data-type=\"%s\"", esc(e.Name), esc(color), esc(e.Shape))
		writePolyline(w, e.ID, "element", e.Points, color, false, 4, dataAttrs, mode)
		return
	}

	tmpl, ok := lib.templates[e.Shape]
	if !ok {
		if !seenMissing[e.Shape] {
			seenMissing[e.Shape] = true
			*missing = append(*missing, e.Shape)
		}
		return
	}
	body := applyStateLine(tmpl, e.State)
	body = strings.NewReplacer(
		"{color}", esc(color),
		"{fill}", stateColors.fill(e.State),
		"{radius}", fmtNum(e.Radius),
		"{fillAttr}", stateColors.fillAttr,
		"{stateAttr}", stateAttr(e.State),
	).Replace(body)
	// Most symbol templates are drawn quite small (a breaker's box is only
	// 14 local units per side) — in Interactive mode, an invisible,
	// generously sized circle gives the editor's click/tap selection a
	// realistic hit target without changing anything about how the symbol
	// itself renders, and a data-editor-kind attribute (this editor's own
	// addition, not part of the xsde2svg format) is what it hit-tests
	// against. data-voltage/data-type mirror a real xsde2svg element's
	// outer <g> either way; id itself is just the element's own bare id.
	editorAttr, hitTarget := "", ""
	if mode == Interactive {
		editorAttr = " data-editor-kind=\"element\""
		hitTarget = "<circle cx=\"0\" cy=\"0\" r=\"18\" fill=\"transparent\" />\n"
	}
	fmt.Fprintf(w, "<g id=\"%d\" data-name=\"%s\" data-voltage=\"%s\" data-type=\"%s\"%s transform=\"translate(%s,%s) rotate(%d)\">\n%s%s\n</g>\n",
		e.ID, esc(e.Name), esc(color), esc(e.Shape), editorAttr, fmtNum(e.X), fmtNum(e.Y), e.Orient, hitTarget, body)
}

// Render writes d as a fresh SVG document, using lib to place each
// Element's symbol. The output is a new, independently generated rendering
// of the diagram, not a byte-for-byte reproduction of any source file.
//
// Elements are drawn in three passes rather than strict document order: any
// Class absent from elementZOrder (the default, effectively 0) first, then
// connectors, then each elementZOrder tier in ascending order, and finally
// labels — see elementZOrder's doc comment for why.
//
// If d.Elements references a Shape absent from lib, Render still writes
// every other element and connector, then returns an error listing every
// missing shape once rendering is otherwise complete, so a single run
// surfaces the whole gap instead of stopping at the first one.
//
// mode controls whether this editor's own interactivity-only markup
// (data-editor-kind, wider hit targets) is added on top of the otherwise
// xsde2svg-faithful output — see RenderMode's doc comment.
//
// stateColorLegend is the install-wide Open/Close/Intermediate legend a
// switching device's state-driven fill is drawn from (see
// config.Config.StateColors) — omit it to render every such device with an
// unresolved ("none") fill and no data-fill attribute, e.g. from a caller
// that hasn't wired up a legend.
func Render(d *Diagram, lib *SymbolLibrary, w io.Writer, mode RenderMode, stateColorLegend ...StateColor) error {
	voltageColor := map[int]string{}
	for _, vc := range d.VoltageClasses {
		voltageColor[vc.ID] = vc.Color
	}
	stateColors := newStateColorSet(stateColorLegend)

	background := defaultBackground
	if d.Editor != nil && d.Editor.Background != "" {
		background = d.Editor.Background
	}

	fmt.Fprintf(w, "<?xml version=\"1.0\"?>\n<svg width=\"%s\" height=\"%s\" style=\"stroke-width: 0px; background-color: %s;\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n",
		fmtNum(d.Width), fmtNum(d.Height), esc(background))

	var missing []string
	seenMissing := map[string]bool{}

	elevated := map[int][]Element{}

	var lastShape string
	for _, e := range d.Elements {
		if z := elementZOrder[e.Class]; z > 0 {
			elevated[z] = append(elevated[z], e)
			continue
		}
		renderElement(w, lib, voltageColor, stateColors, e, &missing, seenMissing, &lastShape, mode)
	}

	var lastConnKind string
	for _, c := range d.Connectors {
		code, hasCode := connectorTypeCode[c.Kind]
		typeComment(w, connectorKindName, string(c.Kind), code, &lastConnKind)
		dataAttrs := ""
		if hasCode {
			dataAttrs = fmt.Sprintf(" data-type=\"%s\"", esc(code))
		}
		writePolyline(w, c.ID, "connector", c.Points, voltageColor[c.Voltage], c.Dashed, 1, dataAttrs, mode)
	}

	tiers := make([]int, 0, len(elevated))
	for z := range elevated {
		tiers = append(tiers, z)
	}
	sort.Ints(tiers)
	for _, z := range tiers {
		var lastTierShape string
		for _, e := range elevated[z] {
			renderElement(w, lib, voltageColor, stateColors, e, &missing, seenMissing, &lastTierShape, mode)
		}
	}

	for _, l := range d.Labels {
		writeLabel(w, l)
	}

	fmt.Fprint(w, "</svg>\n")

	if len(missing) > 0 {
		return fmt.Errorf("slddoc: symbol library missing shape(s): %s", strings.Join(missing, ", "))
	}
	return nil
}

// writePolyline draws a busbar's or connector's geometry as a single flat
// <polyline>, matching a real xsde2svg-exported busbar/wire exactly — no
// synthetic wrapping <g> and no duplicate hit-target line. dataAttrs, when
// non-empty, is inserted verbatim (its own leading space included) before
// id — e.g. a busbar's data-name/data-voltage/data-type, mirroring what a
// real xsde2svg busbar polyline carries. id, when non-zero (0 is never a
// real assigned id — see Diagram.LastID's doc comment), is always written,
// in both RenderModes, since a real xsde2svg polyline carries one too;
// data-editor-kind (this editor's own addition, "element" for a busbar
// since it's an Element, "connector" for a wire — not part of that format)
// is added only in Interactive mode, for the frontend to hit-test a click
// against.
func writePolyline(w io.Writer, id int, kind string, pts []Point, color string, dashed bool, strokeWidth float64, dataAttrs string, mode RenderMode) {
	if color == "" {
		color = "black"
	}
	var sb strings.Builder
	for i, p := range pts {
		if i > 0 {
			sb.WriteByte(' ')
		}
		sb.WriteString(fmtNum(p.X))
		sb.WriteByte(',')
		sb.WriteString(fmtNum(p.Y))
	}
	dash := ""
	if dashed {
		dash = "stroke-dasharray: 14,9;"
	}
	points := esc(sb.String())
	width := fmtNum(strokeWidth)
	idAttrs := ""
	if id != 0 {
		if mode == Interactive {
			idAttrs = fmt.Sprintf(" id=\"%d\" data-editor-kind=\"%s\"", id, kind)
		} else {
			idAttrs = fmt.Sprintf(" id=\"%d\"", id)
		}
	}
	fmt.Fprintf(w, "<polyline points=\"%s\" style=\"fill:none;stroke:%s;%sstroke-width:%s\"%s%s />\n",
		points, esc(color), dash, width, dataAttrs, idAttrs)
}

func writeLabel(w io.Writer, l Label) {
	anchor := l.Anchor
	if anchor == "" {
		anchor = "start"
	}
	weight := ""
	if l.Bold {
		weight = "font-weight: bold;"
	}
	style := fmt.Sprintf("fill:white;text-anchor:%s;font-size:%spx;font-family:Arial;%swhite-space: pre;",
		anchor, fmtNum(l.Size), weight)

	lines := strings.Split(l.Text, "\n")
	fmt.Fprintf(w, "<text x=\"%s\" y=\"%s\" style=\"%s\">%s", fmtNum(l.X), fmtNum(l.Y), esc(style), esc(lines[0]))
	for _, ln := range lines[1:] {
		fmt.Fprintf(w, "<tspan x=\"%s\" dy=\"%s\" style=\"%s\">%s</tspan>",
			fmtNum(l.X), fmtNum(l.Size*1.4), esc(style), esc(ln))
	}
	fmt.Fprint(w, "</text>\n")
}
