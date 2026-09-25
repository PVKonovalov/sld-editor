import type {
  Diagram,
  DiagramElement,
  DiagramNode,
  Connector,
  ConnectorKind,
  VoltageClass,
  Layer,
  ElementClass,
  Point,
  ElementSymbol,
  EditorConfig,
  Label,
  DigitalDevice,
  TerminalDirection,
  TableCell,
} from '../types'
import { circularArcThrough, defaultArcBulge } from './arc'

// Element classes whose own geometry is a drawn Points array (two or more
// vertices) rather than a single x/y anchor+orient — BusBarSection (a real
// electrical busbar), Rectangle, Circle, Arrow, Button, Road, Line, and
// Table (the latter seven purely decorative annotations, no electrical
// meaning at all — see connectElements' own guard below). Shared by every
// place/move/paste/point-drag helper that needs to treat "drag two
// corners/vertices to draw or reshape" the same way regardless of which of
// the eight classes it actually is — including, for Rectangle/Circle/
// Arrow/Button/Road/Line/Table, the anchor (x/y) recomputed as the two
// Points' own midpoint on every move/paste/drag: harmless for an Arrow
// even though its own rendering (writeArrow) reads Points[0]/[1] directly
// rather than x/y, since x/y only ever matters here as a paste-target
// anchor, never for the real drawn geometry. Table2 is deliberately not
// here — its own geometry is anchor (x/y) plus rowHeights/columnWidths,
// not Points at all (see DiagramElement's own doc comment).
const POINTS_BASED_CLASSES: ReadonlySet<ElementClass> = new Set([
  'BusBarSection',
  'Rectangle',
  'Circle',
  'Arrow',
  'Button',
  'Road',
  'Line',
  'Polygon',
  'Arc',
  'Table',
])

// A voltage-class <select>'s option value is either an existing class's own
// id (as a string) or, for one of the server's default presets not yet
// added to this diagram, "preset:<name>" — resolveVoltageSelection turns
// either back into a real assignment, creating the class on the fly for
// the preset case. This lets Properties offer every server-default preset
// directly, without a separate "add it in Settings first" step.
const PRESET_PREFIX = 'preset:'

export interface VoltageOption {
  value: string
  label: string
}

/** Options for a voltage-class <select>: every voltage class already on
 * the diagram, plus any server-default preset not already present under
 * the same name (so an added-then-renamed preset doesn't show twice). */
export function voltageClassOptions(diagram: Diagram, config: EditorConfig | null): VoltageOption[] {
  const existingNames = new Set(diagram.voltageClasses.map(vc => vc.name))
  const own = diagram.voltageClasses.map(vc => ({ value: String(vc.id), label: vc.name }))
  const presets = (config?.voltageColors ?? [])
    .filter(v => !existingNames.has(v.name))
    .map(v => ({ value: PRESET_PREFIX + v.name, label: v.name }))
  return [...own, ...presets]
}

/** Resolves a voltageClassOptions <select>'s raw string value into a
 * voltage id to assign, creating the voltage class first if the user just
 * picked a preset that isn't on the diagram yet. Returns the (possibly
 * updated) diagram alongside the id so the caller can assign it to
 * whichever element/connector in one updateDiagram call. */
export function resolveVoltageSelection(
  diagram: Diagram,
  config: EditorConfig | null,
  rawValue: string,
): { diagram: Diagram; voltage: number | undefined } {
  if (!rawValue) return { diagram, voltage: undefined }
  if (!rawValue.startsWith(PRESET_PREFIX)) return { diagram, voltage: Number(rawValue) }

  const name = rawValue.slice(PRESET_PREFIX.length)
  const preset = config?.voltageColors.find(v => v.name === name)
  if (!preset) return { diagram, voltage: undefined }

  const withClass = addVoltageClass(diagram, preset.name, preset.color)
  const newClass = withClass.voltageClasses[withClass.voltageClasses.length - 1]
  return { diagram: withClass, voltage: newClass.id }
}

// Hands out sequential integer ids starting after diagram.lastId, the
// high-water mark the backend persists on Diagram (see
// backend/internal/slddoc's LastID doc comment). One shared counter across
// elements/nodes/connectors/voltage classes, not one per kind — simplest
// way to guarantee every id in a diagram is unique regardless of what it
// names. Callers must fold `.lastId` back into the diagram they return so
// the next Save persists the new high-water mark.
class IdSequence {
  private next: number

  constructor(diagram: Diagram) {
    this.next = (diagram.lastId ?? 0) + 1
  }

  take(): number {
    return this.next++
  }

  get lastId(): number {
    return this.next - 1
  }
}

// voltageUsage counts, per VoltageClass id, how many elements (each
// PowerTransformer winding counted separately, since each carries its own)
// and connectors reference it — not a mutator, an inspection helper like
// voltageClassOptions. Unset (0/absent) references aren't counted. Used by
// an .svg import to pick the diagram's default voltage (mostUsedVoltage)
// and by the import log dialog to show each extracted class's usage.
export function voltageUsage(diagram: Diagram): Map<number, number> {
  const counts = new Map<number, number>()
  const add = (v: number | undefined) => {
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  for (const el of diagram.elements) {
    add(el.voltage)
    el.windings?.forEach(w => add(w.voltage))
  }
  for (const c of diagram.connectors) add(c.voltage)
  return counts
}

// mostUsedVoltage is the VoltageClass id voltageUsage counts the most
// references to (ties broken by the lower id, for determinism), or
// undefined when nothing references any class at all.
export function mostUsedVoltage(diagram: Diagram): number | undefined {
  let best: number | undefined
  let bestCount = 0
  for (const [id, n] of voltageUsage(diagram)) {
    if (n > bestCount || (n === bestCount && best !== undefined && id < best)) {
      best = id
      bestCount = n
    }
  }
  return best
}

// needsDefaultVoltage reports whether a diagram has no usable
// editor.defaultVoltage of its own — unset/0, or referencing a voltage
// class no longer on the diagram — so opening it should ask for one
// (DefaultVoltageDialog).
export function needsDefaultVoltage(diagram: Diagram): boolean {
  const id = diagram.editor?.defaultVoltage
  return !id || !diagram.voltageClasses.some(vc => vc.id === id)
}

/** Backfills lastId for a diagram saved before this editor tracked one (or
 * one that has never had an id assigned by it), by scanning every existing
 * element/node/connector/voltage-class/label id for the highest value
 * already in use — so a freshly opened legacy diagram can't hand out an id
 * that collides with one already on disk. A no-op once a diagram has its
 * own lastId.
 *
 * Also backfills a fresh id for any Label still carrying id 0 — Label
 * didn't have its own id at all until this editor added one, so a diagram
 * saved before that has every one of its labels share id 0 (Go/JSON's
 * zero value for a missing attribute), which breaks per-label
 * select/drag/edit/delete (they'd all resolve to the same "id"). Unlike
 * the lastId backfill above, this always runs, even for a diagram whose
 * lastId is already set from its elements/connectors — the two gaps are
 * independent and can each exist without the other. */
export function ensureLastId(diagram: Diagram): Diagram {
  let d = diagram

  if (!d.lastId) {
    let max = 0
    const consider = (id: number) => {
      if (id > max) max = id
    }
    d.elements.forEach(e => consider(e.id))
    d.nodes.forEach(n => consider(n.id))
    d.connectors.forEach(c => consider(c.id))
    d.voltageClasses.forEach(vc => consider(vc.id))
    d.labels.forEach(l => consider(l.id))
    d.digitalDevices.forEach(dd => consider(dd.id))
    if (max > 0) d = { ...d, lastId: max }
  }

  if (d.labels.some(l => l.id === 0)) {
    const ids = new IdSequence(d)
    const labels = d.labels.map(l => (l.id === 0 ? { ...l, id: ids.take() } : l))
    d = { ...d, lastId: ids.lastId, labels }
  }

  return d
}

// Matches a rendered node's own data-editor-kind attribute (internal/
// slddoc's Render/RenderFragments) — "digitaldevice", not "digitalDevice",
// same lowercase-no-separator convention Canvas.tsx's own querySelector
// calls already use for one.
export type DataEditorKind = 'element' | 'connector' | 'label' | 'digitaldevice'

export type DiagramRenderDiff =
  | { kind: 'none' }
  | { kind: 'full' }
  | { kind: 'patch'; targets: { id: number; kind: DataEditorKind }[] }

// Diffs one of the four id-keyed arrays by reference — every diagramOps
// mutator does immutable, per-id updates (only the touched entry gets a
// new object; everything else keeps its old reference), so a plain `!==`
// per id is enough to find exactly what changed, no field-by-field
// comparison or mutator instrumentation needed. Returns whether anything
// was added or removed (an "structural" change, forcing a full render —
// see diffDiagramForRender), appending any in-place-changed id's own
// {id, kind} to targets as a side effect.
function diffArrayIds<T extends { id: number }>(
  previous: T[],
  next: T[],
  kind: DataEditorKind,
  targets: { id: number; kind: DataEditorKind }[],
): boolean {
  const previousById = new Map(previous.map(x => [x.id, x]))
  const nextIds = new Set(next.map(x => x.id))
  let structural = false
  for (const x of next) {
    const old = previousById.get(x.id)
    if (!old) {
      structural = true
      continue
    }
    if (old !== x) targets.push({ id: x.id, kind })
  }
  for (const id of previousById.keys()) {
    if (!nextIds.has(id)) structural = true
  }
  return structural
}

/** Diffs two versions of the same open diagram (the one behind Canvas.tsx's
 * own last successful render, and the current one) to decide how to
 * refresh the displayed SVG cheaply — see TODO.md's own "Reducing frontend/
 * backend traffic" section for the fuller rationale:
 * - 'none': nothing rendering-relevant changed at all (skip the network
 *   round trip entirely — e.g. a no-op updateDiagram call).
 * - 'patch': only a fixed set of already-existing elements/connectors/
 *   labels/digital devices changed in place — fetch just their own fresh
 *   markup (api.renderPreviewFragments) and patch those DOM nodes
 *   directly, instead of replacing the whole injected SVG.
 * - 'full': anything was added or removed, or width/height/voltageClasses/
 *   editor/layers changed by reference — each of those can repaint
 *   arbitrarily many ids at once (a VoltageClass's own color change, e.g.,
 *   isn't itself one of "the ids that changed"), or (add/remove) raises the
 *   question of *where* in the DOM a brand-new node belongs relative to
 *   elementZOrder's own tiers, which only exist as document order in a full
 *   Render — the existing api.renderPreview whole-document path stays
 *   exactly as it always has for this case. */
export function diffDiagramForRender(previous: Diagram, next: Diagram): DiagramRenderDiff {
  if (
    previous.width !== next.width ||
    previous.height !== next.height ||
    previous.voltageClasses !== next.voltageClasses ||
    previous.editor !== next.editor ||
    previous.layers !== next.layers
  ) {
    return { kind: 'full' }
  }

  const targets: { id: number; kind: DataEditorKind }[] = []
  let structural = false
  structural = diffArrayIds(previous.elements, next.elements, 'element', targets) || structural
  structural = diffArrayIds(previous.connectors, next.connectors, 'connector', targets) || structural
  structural = diffArrayIds(previous.labels, next.labels, 'label', targets) || structural
  structural =
    diffArrayIds(previous.digitalDevices, next.digitalDevices, 'digitaldevice', targets) || structural

  if (structural) return { kind: 'full' }
  if (targets.length === 0) return { kind: 'none' }
  return { kind: 'patch', targets }
}

function defaultLayer(diagram: Diagram): number {
  return diagram.layers[0]?.id ?? 0
}

/** Places a new instance of a palette symbol at point (its anchor, for
 * every class except BusBarSection). Defaults its name to "<type>-<id>"
 * (e.g. "Breaker-3") rather than the bare symbol name, so placing several
 * of the same type doesn't leave them all identically labeled — the user
 * can still rename it in Properties afterward. defaultVoltage, when given,
 * seeds the new element's voltage class from whichever one the user last
 * picked in Properties, so placing several elements in a row doesn't
 * require re-assigning the same voltage each time. */
// A Breaker/Disconnector/Sectionalizer/PowerCircuitBreaker/LoadBreakSwitch (either the fixed or
// withdrawable shape — both share the same Class) starts out placed in
// service, not open, so a freshly drawn one-line reads correctly without a
// separate trip to Properties for every single device: 1 is "Close" in the
// state->color legend (config.stateColors). GroundSwitch/ShortCircuiter
// get their own default below instead, since leaving it unset now has a
// different visual consequence (see GROUND_TYPE_DEFAULT_STATE's own
// comment).
const DEFAULT_CLOSED_CLASSES = new Set<ElementClass>(['Breaker', 'Disconnector', 'Sectionalizer', 'PowerCircuitBreaker', 'LoadBreakSwitch'])
const STATE_CLOSE = 1

// GroundSwitch/ShortCircuiter (base.xml shapes 54/398) both draw
// earth-plates-up/stub-down at orient 0 — confirmed against a real
// xsde2svg corpus export, which always places GroundSwitch pre-rotated
// (90/180, never 0), so their templates are left as-is. A freshly placed
// one defaults to 180 degrees instead of unset/0 so it already reads the
// conventional way (stub up toward whatever it's tapped off of, earth
// symbol dangling below) without a separate trip to Properties'
// Orientation field first.
const GROUND_TYPE_DEFAULT_ORIENT = 180

// GroundSwitch/ShortCircuiter's own blade is state-driven (base.xml's
// {state:...}, matching Breaker/Disconnector's own mechanism), and an
// unset State reads as Close (applyStateLine's own nil-maps-to-first-
// option rule) — so leaving it unset would make a freshly placed one
// default to the grounded/shorted look. 0 (Open) instead matches both the
// real corpus (~92% of a real substation export's own GroundSwitch
// elements are Open) and each template's own pre-{state:...} fixed
// appearance, so a freshly placed one still looks the same as it always
// has.
const GROUND_TYPE_DEFAULT_STATE = 0

// Breaker/Disconnector/Fuse (withdrawable) — shapes 43/49/154, keyed by
// Shape since each shares a Class with a non-withdrawable sibling (41/162,
// 203) — get their own Position default too: base.xml's {positionOffset}
// already treats nil the same as 1 (Normal, no offset), so this doesn't
// change how a freshly placed one renders, but it does mean Properties'
// Position status dropdown starts on a real, explicit value instead of
// "— none —", matching the racked-in/connected position every such device
// starts service in. Chassis (51) has no non-withdrawable sibling of its
// own — every real instance has this same mechanism — but is still keyed
// here by Shape for consistency with the other three.
const WITHDRAWABLE_SHAPES = new Set(['43', '49', '154', '51'])
const POSITION_NORMAL = 1

// A freshly placed Lamp starts unlit (state 0) with a real fillOff/fillOn/
// radius instead of all three left empty — unset radius renders as an
// invisible r="0" circle, so without this a new Lamp is blank until a trip
// to Properties.
const LAMP_DEFAULTS: Pick<DiagramElement, 'state' | 'fillOff' | 'fillOn' | 'radius'> = {
  state: 0,
  fillOff: 'none',
  fillOn: 'red',
  radius: 11,
}

// A freshly placed PostPole starts as a real, visible round marker —
// matching render.go's own unset-Fill/Stroke/Radius fallback
// ("none"/"gray"/10) explicitly, the same reason LAMP_DEFAULTS/
// RECTANGLE_DEFAULTS spell theirs out. square is left unset (round is the
// default variant either way).
const POLE_DEFAULTS: Pick<DiagramElement, 'fill' | 'stroke' | 'radius'> = {
  fill: 'none',
  stroke: '#808080',
  radius: 10,
}

// A freshly placed FaultPassageIndicator starts at State 0 (Open) — same
// reasoning as GroundSwitch's own default, since an unrecorded State would
// otherwise still read as Open here too (render.go's fpiColor defaults nil
// the same way), so this just gives Properties' own dropdown a real
// starting value — with a real radius instead of unset, which (like an
// unset Lamp radius) renders as an invisible r="0" circle; 10 also matches
// where base.xml's own <terminals> for this shape are fixed, and the
// default 10-unit grid (its own overlay text is sized down to fit inside a
// ring this small). propertyText is seeded from the server's own
// config.defaultFpiText (EditorConfig — see its own doc comment) when set,
// so a freshly placed instance's saved data already carries the
// admin-configured label explicitly rather than relying on Render's own
// "FPI" fallback silently; left unset when the server has none configured,
// same fallback either way.
function fpiDefaults(defaultFpiText?: string): Pick<DiagramElement, 'state' | 'radius' | 'propertyText'> {
  return {
    state: 0,
    radius: 10,
    ...(defaultFpiText ? { propertyText: defaultFpiText } : {}),
  }
}

// A freshly placed PowerflowIndicator starts with a real, visible black
// glyph color — matching render.go's own unset-TextColor fallback ("black")
// explicitly, the same reason POLE_DEFAULTS spells its own out as a real
// hex value (#000000, not the literal "black") so the color picker shows a
// real swatch directly. state is left unset — nil already renders the same
// "→" default writePowerflowIndicator falls back to.
const POWERFLOW_INDICATOR_DEFAULTS: Pick<DiagramElement, 'textColor'> = {
  textColor: '#000000',
}

// A freshly placed PowerTransformer starts as a plain 2-winding wye/wye
// unit — matching the palette icon's own static preview (base.xml's own
// shape-47 template, used only for that preview, not the real diagram
// render — see writePowerTransformer) — rather than a blank Windings
// list, which would render two circles with no connection glyph at all
// until a trip to Properties.
function powerTransformerDefaults(defaultVoltage?: number): Pick<DiagramElement, 'windings'> {
  return {
    windings: [
      { voltage: defaultVoltage, scheme: 'wye' },
      { voltage: defaultVoltage, scheme: 'wye' },
    ],
  }
}

export function placeElement(
  diagram: Diagram,
  symbol: ElementSymbol,
  point: Point,
  defaultVoltage?: number,
  defaultFpiText?: string,
): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const elementClass = symbol.class as ElementClass
  const element: DiagramElement = {
    id,
    class: elementClass,
    shape: symbol.shape,
    name: `${symbol.name}-${id}`,
    layer: defaultLayer(diagram),
    // A Lamp is a plain indicator, not something carrying its own primary
    // voltage — it reads its two fixed FillOff/FillOn colors, not a voltage
    // class color, so it shouldn't inherit whatever the user last picked in
    // Properties the way every other symbol does. A FaultPassageIndicator
    // isn't either — its own {color} is a fixed background fill, never a
    // voltage class color (see base.xml's own header comment). Neither is a
    // PostPole — a purely decorative structural marker, same non-electrical
    // status as Rectangle/Circle/Button/Road (see slddoc's own
    // ClassPostPole doc comment), just placed via this generic click-to-
    // place path instead of one of those four's own dedicated drag-to-draw
    // one, since its own geometry is a single anchor, not drawn Points.
    // Neither is a PowerflowIndicator — same non-electrical status, its own
    // color comes from textColor, not a voltage class. Neither is a
    // Table2 (313) — same non-electrical status as Table (312)/Rectangle/
    // Button, just click-to-place (a single anchor) instead of one of
    // those three's own dedicated drag-to-draw.
    ...(elementClass === 'Lamp' ||
    elementClass === 'FaultPassageIndicator' ||
    elementClass === 'PostPole' ||
    elementClass === 'PowerflowIndicator' ||
    elementClass === 'Table2'
      ? {}
      : { voltage: defaultVoltage }),
    x: point.x,
    y: point.y,
    ...(DEFAULT_CLOSED_CLASSES.has(elementClass) ? { state: STATE_CLOSE } : {}),
    ...(elementClass === 'Lamp' ? LAMP_DEFAULTS : {}),
    ...(elementClass === 'PostPole' ? POLE_DEFAULTS : {}),
    ...(elementClass === 'PowerflowIndicator' ? POWERFLOW_INDICATOR_DEFAULTS : {}),
    ...(elementClass === 'GroundSwitch' || elementClass === 'ShortCircuiter'
      ? { orient: GROUND_TYPE_DEFAULT_ORIENT, state: GROUND_TYPE_DEFAULT_STATE }
      : {}),
    ...(WITHDRAWABLE_SHAPES.has(symbol.shape) ? { position: POSITION_NORMAL } : {}),
    ...(elementClass === 'FaultPassageIndicator' ? fpiDefaults(defaultFpiText) : {}),
    ...(elementClass === 'PowerTransformer' ? powerTransformerDefaults(defaultVoltage) : {}),
    ...(elementClass === 'Table2' ? table2Defaults() : {}),
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

/** Places a new BusBarSection spanning start..end — busbars are drawn from
 * their own Points, not a single anchor, so placement is a drag rather
 * than a click. See placeElement for defaultVoltage. */
export function placeBusbar(diagram: Diagram, start: Point, end: Point, defaultVoltage?: number): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'BusBarSection',
    shape: '24',
    name: `Busbar-${id}`,
    layer: defaultLayer(diagram),
    voltage: defaultVoltage,
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    points: [start, end],
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

// A freshly placed Rectangle's own colors/border thickness — matching
// render.go's own unset-Fill/Stroke/StrokeWidth fallback
// ("none"/"white"/1) explicitly, the same reason LAMP_DEFAULTS spells out
// FillOff/FillOn rather than leaving them unset: so Properties' own color
// pickers and width field show a real value immediately instead of
// empty-string/swatchColor's own fallback guesswork.
const RECTANGLE_DEFAULTS = { fill: 'none', stroke: '#ffffff', strokeWidth: 1 }

/** Places a new Rectangle spanning start..end — a purely decorative
 * annotation box, not real electrical equipment (see slddoc's own
 * ClassRectangle doc comment): no Voltage, no Ports, never a valid
 * connectElements/routing target. Drawn from its own Points the same
 * drag-not-click way placeBusbar places a BusBarSection, and for the same
 * reason (its size varies per instance, there's no single "the" anchor to
 * click). */
export function placeRectangle(diagram: Diagram, start: Point, end: Point): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'Rectangle',
    shape: '3',
    name: `Rectangle-${id}`,
    layer: defaultLayer(diagram),
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    points: [start, end],
    ...RECTANGLE_DEFAULTS,
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

/** Places a new Circle spanning start..end (its own bounding-box corners,
 * order-independent) — same "purely decorative, not real electrical
 * equipment, drawn from its own Points" reasoning as placeRectangle,
 * which it otherwise mirrors exactly (same RECTANGLE_DEFAULTS — a
 * Circle's own Fill/Stroke/StrokeWidth model is identical). */
export function placeCircle(diagram: Diagram, start: Point, end: Point): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'Circle',
    shape: '4',
    name: `Circle-${id}`,
    layer: defaultLayer(diagram),
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    points: [start, end],
    ...RECTANGLE_DEFAULTS,
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

// A freshly placed Arrow's own color/width — same reasoning as
// RECTANGLE_DEFAULTS (no fill: an arrow has no interior).
const ARROW_DEFAULTS = { stroke: '#ffffff', strokeWidth: 1 }

/** Places a new Arrow from start to end — the arrowhead is always drawn at
 * end (see slddoc's own ClassArrow doc comment on why Points order
 * matters here, unlike a Rectangle's). Same "purely decorative, not real
 * electrical equipment, drawn from its own Points" reasoning as
 * placeRectangle. */
export function placeArrow(diagram: Diagram, start: Point, end: Point): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'Arrow',
    shape: '2',
    name: `Arrow-${id}`,
    layer: defaultLayer(diagram),
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    points: [start, end],
    ...ARROW_DEFAULTS,
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

// A freshly placed Button's own colors/text — matching render.go's own
// unset-Fill/Stroke/TextColor fallback ("none"/"white"/"white") explicitly,
// the same reason RECTANGLE_DEFAULTS/LAMP_DEFAULTS spell theirs out.
// propertyText defaults to a placeholder ("Button") rather than empty so a
// freshly placed one isn't blank until Properties' own Text field is filled
// in.
const BUTTON_DEFAULTS = { fill: 'none', stroke: '#ffffff', strokeWidth: 1, textColor: '#ffffff', bold: false }

/** Places a new Button spanning start..end — a purely decorative
 * annotation widget, not real electrical equipment (see slddoc's own
 * ClassButton doc comment): no Voltage, no Ports, never a valid
 * connectElements/routing target. Drawn from its own Points the same
 * drag-not-click way placeRectangle places a Rectangle, and for the same
 * reason (its size varies per instance, there's no single "the" anchor to
 * click). */
export function placeButton(diagram: Diagram, start: Point, end: Point): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'Button',
    shape: '113',
    name: `Button-${id}`,
    layer: defaultLayer(diagram),
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    points: [start, end],
    propertyText: 'Button',
    ...BUTTON_DEFAULTS,
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

// A freshly placed Table's own colors — matching render.go's own
// unset-Fill/Stroke/TextColor fallback ("none"/"white"/"black")
// explicitly, the same reason BUTTON_DEFAULTS spells its own out. Unlike
// Button, propertyText is left empty (no placeholder text) — a Table is
// often just a plain annotated box with no label at all, matching real
// corpus more often than Button's own always-labeled convention.
const TABLE_DEFAULTS = { fill: 'none', stroke: '#ffffff', strokeWidth: 1, textColor: '#000000' }

/** Places a new Table spanning start..end — a purely decorative
 * annotation box, not real electrical equipment (see slddoc's own
 * ClassTable doc comment): no Voltage, no Ports, never a valid
 * connectElements/routing target. Drawn from its own Points the same
 * drag-not-click way placeRectangle/placeButton place theirs. */
export function placeTable(diagram: Diagram, start: Point, end: Point): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'Table',
    shape: '312',
    name: `Table-${id}`,
    layer: defaultLayer(diagram),
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    points: [start, end],
    ...TABLE_DEFAULTS,
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

// A freshly placed Table2's own default grid — a plain 2x2 with no cell
// text, giving the user something real to immediately see/select/resize
// in Properties rather than an invisible zero-row/zero-column instance
// (writeTable2 draws nothing at all until rowHeights/columnWidths are both
// non-empty). Row/column sizes match the same default grid spacing most
// diagrams start with, so a freshly placed table already looks roughly
// on-grid. Called from placeElement's own dispatch below — Table2 is
// click-to-place (a single anchor point, like PostPole/Lamp), not
// drag-two-corners like Table (312)/Rectangle/Button, since its own real
// geometry (an N-row-by-M-column grid) isn't expressible as two dragged
// corners at all; it always starts as this fixed small default grid,
// resized afterward via Properties' own row/column count fields — the
// same "seed a real starting value via a small generator function" PowerTransformer's
// own powerTransformerDefaults already does for its own array field.
const TABLE2_ROWS = 2
const TABLE2_COLS = 2
const TABLE2_ROW_HEIGHT = 20
const TABLE2_COL_WIDTH = 60

function table2Defaults(): Pick<DiagramElement, 'rowHeights' | 'columnWidths' | 'cells' | 'stroke' | 'strokeWidth' | 'fill'> {
  const cells: TableCell[] = []
  for (let row = 0; row < TABLE2_ROWS; row++) {
    for (let col = 0; col < TABLE2_COLS; col++) {
      cells.push({ row, col })
    }
  }
  return {
    rowHeights: Array(TABLE2_ROWS).fill(TABLE2_ROW_HEIGHT),
    columnWidths: Array(TABLE2_COLS).fill(TABLE2_COL_WIDTH),
    cells,
    stroke: '#ffffff',
    strokeWidth: 1,
    fill: 'none',
  }
}

/** Resizes a Table2's own grid to exactly rows x cols (each clamped to at
 * least 1 — a table with zero rows or columns draws nothing at all, see
 * writeTable2's own doc comment), preserving every still-valid cell's own
 * real content (text/fill/textColor) and row height/column width. A newly
 * added row/column gets TABLE2_ROW_HEIGHT/TABLE2_COL_WIDTH, the same
 * default table2Defaults itself starts a freshly placed table with; every
 * (row, col) position in the new grid gets a real TableCell entry (blank
 * if none existed before), so the grid stays fully populated the same way
 * a freshly placed one always is. Used by Properties' own row/column
 * count fields. */
export function resizeTable2(diagram: Diagram, id: number, rows: number, cols: number): Diagram {
  const safeRows = Math.max(1, rows)
  const safeCols = Math.max(1, cols)
  return {
    ...diagram,
    elements: diagram.elements.map(e => {
      if (e.id !== id || e.class !== 'Table2') return e
      const oldRowHeights = e.rowHeights ?? []
      const oldColumnWidths = e.columnWidths ?? []
      const rowHeights = Array.from({ length: safeRows }, (_, i) => oldRowHeights[i] ?? TABLE2_ROW_HEIGHT)
      const columnWidths = Array.from({ length: safeCols }, (_, j) => oldColumnWidths[j] ?? TABLE2_COL_WIDTH)
      const byPos = new Map((e.cells ?? []).map(c => [`${c.row}:${c.col}`, c]))
      const cells: TableCell[] = []
      for (let row = 0; row < safeRows; row++) {
        for (let col = 0; col < safeCols; col++) {
          cells.push(byPos.get(`${row}:${col}`) ?? { row, col })
        }
      }
      return { ...e, rowHeights, columnWidths, cells }
    }),
  }
}

/** Updates one already-existing row's own height or column's own width in
 * place — row/col must already be a valid index (see resizeTable2 to add
 * or remove one); out of range is a no-op. */
export function updateTable2RowHeight(diagram: Diagram, id: number, row: number, height: number): Diagram {
  return {
    ...diagram,
    elements: diagram.elements.map(e => {
      if (e.id !== id || e.class !== 'Table2' || !e.rowHeights || row < 0 || row >= e.rowHeights.length) return e
      return { ...e, rowHeights: e.rowHeights.map((h, i) => (i === row ? height : h)) }
    }),
  }
}

export function updateTable2ColumnWidth(diagram: Diagram, id: number, col: number, width: number): Diagram {
  return {
    ...diagram,
    elements: diagram.elements.map(e => {
      if (e.id !== id || e.class !== 'Table2' || !e.columnWidths || col < 0 || col >= e.columnWidths.length) return e
      return { ...e, columnWidths: e.columnWidths.map((w, i) => (i === col ? width : w)) }
    }),
  }
}

/** Updates one already-existing cell's own text — row/col must already be
 * a valid grid position (see resizeTable2); a (row, col) not currently
 * present is a no-op, which shouldn't happen in practice since resizeTable2
 * always keeps every valid position populated. */
export function updateTable2CellText(diagram: Diagram, id: number, row: number, col: number, text: string): Diagram {
  return {
    ...diagram,
    elements: diagram.elements.map(e => {
      if (e.id !== id || e.class !== 'Table2' || !e.cells) return e
      return { ...e, cells: e.cells.map(c => (c.row === row && c.col === col ? { ...c, text } : c)) }
    }),
  }
}

// A freshly placed Road's own color/width — matching render.go's own
// unset-Stroke/StrokeWidth fallback ("white"/8) explicitly, the same
// reason ARROW_DEFAULTS spells theirs out. No fill (an open line, like
// Arrow).
const ROAD_DEFAULTS = { stroke: '#ffffff', strokeWidth: 8 }

/** Places a new Road spanning start..end — a purely decorative geographic
 * background line, not real electrical equipment (see slddoc's own
 * ClassRoad doc comment): no Voltage, no Ports, never a valid
 * connectElements/routing target. Drawn from its own Points the same
 * drag-not-click way placeBusbar places a BusBarSection (this editor can
 * only draw a fresh Road as a straight two-point line this way — see
 * base.xml's own shape-335 entry — a Road extracted from a real multi-bend
 * file keeps every one of its own original vertices instead, editable one
 * at a time via the same per-point drag handle every other points-based
 * element already has). */
export function placeRoad(diagram: Diagram, start: Point, end: Point): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'Road',
    shape: '335',
    name: `Road-${id}`,
    layer: defaultLayer(diagram),
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    points: [start, end],
    ...ROAD_DEFAULTS,
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

// A freshly placed Line's own color/width — matching render.go's own
// unset-Stroke/StrokeWidth fallback ("black"/1) explicitly, the same
// reason ROAD_DEFAULTS spells theirs out. No fill (an open line, like
// Arrow/Road); lineStyle left unset (solid, the real default either way).
const LINE_DEFAULTS = { stroke: '#000000', strokeWidth: 1 }

/** Places a new Line spanning start..end — a purely decorative generic
 * line, not real electrical equipment (see slddoc's own ClassLine doc
 * comment): no Voltage, no Ports, never a valid connectElements/routing
 * target. Drawn from its own Points the same drag-not-click way
 * placeRoad places a Road (this editor can only draw a fresh Line as a
 * straight two-point line this way — see base.xml's own shape-1 entry —
 * a Line extracted from a real multi-bend file keeps every one of its
 * own original vertices instead, editable one at a time). */
export function placeLine(diagram: Diagram, start: Point, end: Point): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'Line',
    shape: '1',
    name: `Line-${id}`,
    layer: defaultLayer(diagram),
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    points: [start, end],
    ...LINE_DEFAULTS,
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

// A freshly drawn Polygon's own defaults: a white outline filled with the
// most common real corpus fill color (#663300); lineStyle left unset
// (solid, the real default).
const POLYGON_DEFAULTS = { fill: '#663300', stroke: '#ffffff', strokeWidth: 1 }

/** Places a new Polygon through points (at least 3; the path closes back
 * to points[0] implicitly) — a purely decorative closed shape, not real
 * electrical equipment (see slddoc's own ClassPolygon doc comment): no
 * Voltage, no Ports, never a valid connectElements/routing target. Canvas
 * collects points pen-tool style, one click per vertex; each vertex can
 * then be dragged one at a time, the same way a Line's can. */
export function placePolygon(diagram: Diagram, points: Point[]): Diagram {
  if (points.length < 3) return diagram
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'Polygon',
    shape: '16',
    name: `Polygon-${id}`,
    layer: defaultLayer(diagram),
    // Same first/last-vertex midpoint updateBusbarPoint keeps it at.
    x: (points[0].x + points[points.length - 1].x) / 2,
    y: (points[0].y + points[points.length - 1].y) / 2,
    points,
    ...POLYGON_DEFAULTS,
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

// A freshly drawn Arc's own defaults: white, width 1 (the real source's
// own 0.25 is barely visible on a fresh drawing).
const ARC_DEFAULTS = { stroke: '#ffffff', strokeWidth: 1 }

/** Places a new Arc from start to end — a purely decorative arc, not real
 * electrical equipment (see slddoc's own ClassArc doc comment): no
 * Voltage, no Ports, never a valid connectElements/routing target. It
 * starts as the circular arc through arc.defaultArcBulge (a quarter of the
 * chord out, on the upper side); Canvas then offers start/end/bulge
 * handles to reshape it (updateBusbarPoint/updateArcBulge). */
export function placeArc(diagram: Diagram, start: Point, end: Point): Diagram {
  const params = circularArcThrough(start, end, defaultArcBulge(start, end))
  if (!params) return diagram
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'Arc',
    shape: '9',
    name: `Arc-${id}`,
    layer: defaultLayer(diagram),
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    points: [start, end],
    ...params,
    ...ARC_DEFAULTS,
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

/** Reshapes Arc id into the circular arc from its own start through bulge
 * to its own end (radius and both flags recomputed — an elliptical arc,
 * e.g. an imported one, becomes circular). Unchanged when bulge is
 * collinear with start/end, since no circle passes through all three. */
export function updateArcBulge(diagram: Diagram, id: number, bulge: Point): Diagram {
  return {
    ...diagram,
    elements: diagram.elements.map(e => {
      if (e.id !== id || e.class !== 'Arc' || !e.points || e.points.length < 2) return e
      const params = circularArcThrough(e.points[0], e.points[1], bulge)
      return params ? { ...e, ...params } : e
    }),
  }
}

// What Copy captures for Paste: the element's own data minus its id (a
// paste always gets a fresh one) and Ports (a pasted copy starts
// unconnected — its ports referenced its old Node ids, which a copy has no
// claim to).
export type ClipboardEntry = Omit<DiagramElement, 'id' | 'ports'>

/** Captures an element for a later Paste. */
export function copyElement(el: DiagramElement): ClipboardEntry {
  const { ports: _ports, ...rest } = el
  return rest
}

/** Places a copied element at point — its anchor for most classes; for a
 * BusBarSection or Rectangle (see POINTS_BASED_CLASSES), point becomes the
 * new midpoint and the whole shape is translated to match, preserving its
 * length/angle/size (mirrors placeBusbar's own start..end -> anchor
 * convention). Named the same way a freshly placed element is —
 * "<type>-<id>" (e.g. "Busbar-5") — rather than "<original name> copy", so
 * a pasted copy reads like any other new element instead of accumulating
 * "copy" suffixes on repeated pastes.
 *
 * snap, when given, is applied to each of a pasted points-based element's
 * translated endpoints (and the anchor is then re-derived as their
 * midpoint, mirroring updateBusbarPoint's convention). Without it, a
 * shape whose original anchor wasn't itself exactly on-grid — its anchor
 * is always the plain midpoint of its two endpoints, which for two
 * on-grid points spaced an odd multiple of the grid apart isn't itself a
 * grid point — would carry that same off-grid remainder into the pasted
 * copy's endpoints even though `point` (the paste target) is on-grid,
 * making Paste look like it ignores Snap to grid. */
export function pasteElement(
  diagram: Diagram,
  entry: ClipboardEntry,
  point: Point,
  snap: (p: Point) => Point = p => p,
): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const baseName = (entry.name ?? entry.class).replace(/-\d+$/, '')
  const element: DiagramElement = {
    ...entry,
    id,
    name: `${baseName}-${id}`,
    x: point.x,
    y: point.y,
  }
  if (POINTS_BASED_CLASSES.has(element.class) && entry.points) {
    const dx = point.x - entry.x
    const dy = point.y - entry.y
    const points = entry.points.map(p => snap({ x: p.x + dx, y: p.y + dy }))
    const first = points[0]
    const last = points[points.length - 1]
    element.points = points
    element.x = (first.x + last.x) / 2
    element.y = (first.y + last.y) / 2
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

// What Copy captures for a connector: its own drawable fields, plus which
// (if either) of the *same copy operation's* own elements[] entries it was
// really attached to via a real Port — fromElementIndex/toElementIndex
// index into ClipboardGroup.elements, null when that end wasn't a Port at
// all (a tap onto a busbar or another connector's own line) or belonged to
// an element outside the copied set. pasteGroup reconnects only the
// non-null ends, to the matching *pasted* element's own fresh port —
// every other end (including any tap case, even onto a busbar that's also
// part of the same copy) comes out dangling, the same ordinary unconnected
// state any route ended in mid-air already has; chasing every tap case
// wasn't worth the complexity here.
export type ClipboardConnectorEntry = Pick<
  Connector,
  'kind' | 'name' | 'voltage' | 'layer' | 'dashed' | 'lineStyle' | 'points'
> & {
  fromElementIndex: number | null
  toElementIndex: number | null
}

// What Copy captures for a label: like ClipboardEntry, minus id (a paste
// always gets a fresh one) and for — that field is already documented as
// informational-only, never a live link, so a pasted copy simply starts
// unlinked rather than trying to preserve a reference to an element that
// paste may not even also be copying.
export type ClipboardLabelEntry = Omit<Label, 'id' | 'for'>

// What Copy captures for a digital device: like ClipboardLabelEntry, minus
// id — a DigitalDevice has no for-style link to drop, so this is just the
// id-less shape directly.
export type ClipboardDigitalDeviceEntry = Omit<DigitalDevice, 'id'>

// The clipboard's own shape once Copy can capture more than one kind at
// once — elements, connectors, labels, and digital devices selected
// together, all placed by one Paste as a single rigid group (see
// pasteGroup).
export interface ClipboardGroup {
  elements: ClipboardEntry[]
  connectors: ClipboardConnectorEntry[]
  labels: ClipboardLabelEntry[]
  digitalDevices: ClipboardDigitalDeviceEntry[]
}

/** Captures a mixed multi-selection (any combination of element/connector/
 * label/digital-device ids) for a later Paste — the unified counterpart of
 * copyElement, now covering every selectable kind Canvas's own
 * multi-select can hold. */
export function copySelection(
  diagram: Diagram,
  ids: { elementIds: Set<number>; connectorIds: Set<number>; labelIds: Set<number>; digitalDeviceIds: Set<number> },
): ClipboardGroup {
  const elements = diagram.elements.filter(e => ids.elementIds.has(e.id))
  const elementIndexById = new Map(elements.map((e, i) => [e.id, i]))

  const ownerElementIndex = (nodeId: number): number | null => {
    for (const e of elements) {
      if ((e.ports ?? []).some(p => p.node === nodeId)) return elementIndexById.get(e.id) ?? null
    }
    return null
  }

  const connectors: ClipboardConnectorEntry[] = diagram.connectors
    .filter(c => ids.connectorIds.has(c.id))
    .map(c => ({
      kind: c.kind,
      name: c.name,
      voltage: c.voltage,
      layer: c.layer,
      dashed: c.dashed,
      lineStyle: c.lineStyle,
      points: c.points,
      fromElementIndex: ownerElementIndex(c.from),
      toElementIndex: ownerElementIndex(c.to),
    }))

  const labels: ClipboardLabelEntry[] = diagram.labels
    .filter(l => ids.labelIds.has(l.id))
    .map(({ id: _id, for: _for, ...rest }) => rest)

  const digitalDevices: ClipboardDigitalDeviceEntry[] = diagram.digitalDevices
    .filter(dd => ids.digitalDeviceIds.has(dd.id))
    .map(({ id: _id, ...rest }) => rest)

  return { elements: elements.map(copyElement), connectors, labels, digitalDevices }
}

// Translates a connector's own points as one rigid body: only the first
// point is snapped (to (dx, dy) plus this connector's own first point),
// and the resulting adjustment is then applied identically to every other
// point — never snapping each point independently, which could distort or
// de-orthogonalize a multi-bend path in a way a single rigid shift can't.
function translateConnectorPoints(points: Point[], dx: number, dy: number, snap: (p: Point) => Point): Point[] {
  if (points.length === 0) return points
  const first = points[0]
  const snappedFirst = snap({ x: first.x + dx, y: first.y + dy })
  const adjDx = snappedFirst.x - first.x
  const adjDy = snappedFirst.y - first.y
  return points.map(p => ({ x: p.x + adjDx, y: p.y + adjDy }))
}

/** Places a whole copied mixed selection as a rigid group — the unified
 * counterpart of the old pasteElements, now also covering connectors and
 * labels. point becomes where the group's own centroid (the average of
 * every element's/label's own anchor, plus every connector's own drawn
 * points) lands; every entry is placed at its original offset from that
 * centroid, so the selection's relative layout — including any connector
 * geometry — is preserved exactly, the same way a single pasteElement
 * preserves one busbar's own shape.
 *
 * Elements are placed first (via pasteElement, unchanged), in order, so
 * each copied connector's own fromElementIndex/toElementIndex can be
 * resolved to the matching *pasted* element's own new id and get a real
 * fresh Port there — see ClipboardConnectorEntry's own doc comment for
 * when an end instead comes out dangling. */
export function pasteGroup(
  diagram: Diagram,
  group: ClipboardGroup,
  point: Point,
  snap: (p: Point) => Point = p => p,
): Diagram {
  const anchors: Point[] = [
    ...group.elements.map(e => ({ x: e.x, y: e.y })),
    ...group.labels.map(l => ({ x: l.x, y: l.y })),
    ...group.digitalDevices.map(dd => ({ x: dd.x, y: dd.y })),
    ...group.connectors.flatMap(c => c.points),
  ]
  if (anchors.length === 0) return diagram
  const centroid = {
    x: anchors.reduce((sum, p) => sum + p.x, 0) / anchors.length,
    y: anchors.reduce((sum, p) => sum + p.y, 0) / anchors.length,
  }
  const dx = point.x - centroid.x
  const dy = point.y - centroid.y

  let acc = diagram
  const newElementIds: number[] = []
  for (const entry of group.elements) {
    acc = pasteElement(acc, entry, snap({ x: entry.x + dx, y: entry.y + dy }), snap)
    newElementIds.push(acc.elements[acc.elements.length - 1].id)
  }

  const ids = new IdSequence(acc)

  if (group.labels.length > 0) {
    const newLabels: Label[] = group.labels.map(entry => {
      const p = snap({ x: entry.x + dx, y: entry.y + dy })
      return { ...entry, id: ids.take(), x: p.x, y: p.y }
    })
    acc = { ...acc, labels: [...acc.labels, ...newLabels] }
  }

  if (group.digitalDevices.length > 0) {
    const newDigitalDevices: DigitalDevice[] = group.digitalDevices.map(entry => {
      const p = snap({ x: entry.x + dx, y: entry.y + dy })
      return { ...entry, id: ids.take(), x: p.x, y: p.y }
    })
    acc = { ...acc, digitalDevices: [...acc.digitalDevices, ...newDigitalDevices] }
  }

  for (const entry of group.connectors) {
    const points = translateConnectorPoints(entry.points, dx, dy, snap)
    const start = points[0]
    const end = points[points.length - 1]
    const fromNode: DiagramNode = { id: ids.take(), x: start.x, y: start.y }
    const toNode: DiagramNode = { id: ids.take(), x: end.x, y: end.y }
    const connectorId = ids.take()
    const connector: Connector = {
      id: connectorId,
      kind: entry.kind,
      name: entry.name,
      voltage: entry.voltage,
      layer: entry.layer,
      dashed: entry.dashed,
      lineStyle: entry.lineStyle,
      from: fromNode.id,
      to: toNode.id,
      points,
    }

    let elements = acc.elements
    const attach = (elementIndex: number | null, node: DiagramNode) => {
      if (elementIndex === null) return
      const elId = newElementIds[elementIndex]
      elements = elements.map(e =>
        e.id === elId ? { ...e, ports: [...(e.ports ?? []), { name: nextPortName(e), node: node.id }] } : e,
      )
    }
    attach(entry.fromElementIndex, fromNode)
    attach(entry.toElementIndex, toNode)

    acc = { ...acc, elements, nodes: [...acc.nodes, fromNode, toNode], connectors: [...acc.connectors, connector] }
  }

  return { ...acc, lastId: ids.lastId }
}

/** Translates an element by (dx, dy) — its anchor for most classes, or
 * every vertex (plus the anchor, kept in sync for labeling/hit-testing)
 * for a points-based one (BusBarSection/Rectangle — see
 * POINTS_BASED_CLASSES). */
export function moveElement(diagram: Diagram, id: number, dx: number, dy: number): Diagram {
  return {
    ...diagram,
    elements: diagram.elements.map(e => {
      if (e.id !== id) return e
      if (POINTS_BASED_CLASSES.has(e.class) && e.points) {
        return {
          ...e,
          x: e.x + dx,
          y: e.y + dy,
          points: e.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
        }
      }
      return { ...e, x: e.x + dx, y: e.y + dy }
    }),
  }
}

/** Moves a whole mixed selection (elements, connectors, and labels
 * together) by (dx, dy) — the unified counterpart of the old moveElements,
 * now also covering connectors/labels selected in their own right rather
 * than just carried along by a moving element's port.
 *
 * Elements move exactly as moveElements always did. Every connector
 * attached to a moving element's port is re-routed to follow ("Piece C",
 * endpoint-follows-only): a connector whose *both* ends belong to moving
 * elements translates as a rigid whole; one with only one end attached
 * instead has just that end dragged to its new position, with the segment
 * touching it kept orthogonal the same way moveConnectorVertex keeps an
 * interior vertex's own segments orthogonal.
 *
 * A connector explicitly in ids.connectorIds (selected in its own right,
 * not just touching a moving element) gets the same treatment as if both/
 * one of its own ends were moving — except an end that's a real Port on an
 * element that ISN'T also moving is deliberately left fixed (adding it
 * would visually tear the wire's end away from equipment that isn't
 * actually moving); an end that's a tap onto a busbar/another connector's
 * own line, rather than a genuine Port, is always treated as free to move
 * with the connector, the same simplification copySelection already makes
 * for a tap junction.
 *
 * A label in ids.labelIds, or a digital device in ids.digitalDeviceIds,
 * just has its own x/y shifted by (dx, dy) — neither has a Port/Node of
 * its own to reroute anything through.
 *
 * Only a plain whole-selection drag goes through here — a BusBarSection's
 * own single-endpoint drag handle (updateBusbarPoint) is a separate,
 * harder case (there's no single "moved by dx,dy" delta for the rest of
 * the shape) and isn't rerouted. */
export function moveSelection(
  diagram: Diagram,
  ids: {
    elementIds: Set<number>
    connectorIds: Set<number>
    labelIds: Set<number>
    digitalDeviceIds: Set<number>
  },
  dx: number,
  dy: number,
): Diagram {
  const movedNodeIds = new Set<number>()
  for (const el of diagram.elements) {
    if (!ids.elementIds.has(el.id)) continue
    for (const p of el.ports ?? []) movedNodeIds.add(p.node)
  }

  if (ids.connectorIds.size > 0) {
    const elementNodeIds = new Set<number>()
    for (const el of diagram.elements) {
      for (const p of el.ports ?? []) elementNodeIds.add(p.node)
    }
    for (const c of diagram.connectors) {
      if (!ids.connectorIds.has(c.id)) continue
      const fromIsFixedPort = elementNodeIds.has(c.from) && !movedNodeIds.has(c.from)
      const toIsFixedPort = elementNodeIds.has(c.to) && !movedNodeIds.has(c.to)
      if (!fromIsFixedPort) movedNodeIds.add(c.from)
      if (!toIsFixedPort) movedNodeIds.add(c.to)
    }
  }

  let moved = [...ids.elementIds].reduce((acc, id) => moveElement(acc, id, dx, dy), diagram)
  if (ids.labelIds.size > 0) {
    moved = {
      ...moved,
      labels: moved.labels.map(l => (ids.labelIds.has(l.id) ? { ...l, x: l.x + dx, y: l.y + dy } : l)),
    }
  }
  if (ids.digitalDeviceIds.size > 0) {
    moved = {
      ...moved,
      digitalDevices: moved.digitalDevices.map(dd =>
        ids.digitalDeviceIds.has(dd.id) ? { ...dd, x: dd.x + dx, y: dd.y + dy } : dd,
      ),
    }
  }
  if (movedNodeIds.size === 0) return moved

  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy })

  const connectors = moved.connectors.map(connector => {
    const fromMoved = movedNodeIds.has(connector.from)
    const toMoved = movedNodeIds.has(connector.to)
    if (!fromMoved && !toMoved) return connector
    if (fromMoved && toMoved) return { ...connector, points: connector.points.map(shift) }

    const points = connector.points
    if (fromMoved) {
      const old0 = points[0]
      const new0 = shift(old0)
      if (points.length === 2) {
        const other = points[1]
        const wasHorizontal = old0.y === other.y
        const bend = wasHorizontal ? { x: new0.x, y: other.y } : { x: other.x, y: new0.y }
        return { ...connector, points: simplifyOrthogonalPath([new0, bend, other]) }
      }
      const neighbor = points[1]
      const wasHorizontal = old0.y === neighbor.y
      const adjusted = wasHorizontal
        ? { ...neighbor, y: new0.y }
        : old0.x === neighbor.x
          ? { ...neighbor, x: new0.x }
          : neighbor
      return { ...connector, points: simplifyOrthogonalPath([new0, adjusted, ...points.slice(2)]) }
    }

    const oldLast = points[points.length - 1]
    const newLast = shift(oldLast)
    if (points.length === 2) {
      const other = points[0]
      const wasHorizontal = oldLast.y === other.y
      const bend = wasHorizontal ? { x: newLast.x, y: other.y } : { x: other.x, y: newLast.y }
      return { ...connector, points: simplifyOrthogonalPath([other, bend, newLast]) }
    }
    const neighbor = points[points.length - 2]
    const wasHorizontal = oldLast.y === neighbor.y
    const adjusted = wasHorizontal
      ? { ...neighbor, y: newLast.y }
      : oldLast.x === neighbor.x
        ? { ...neighbor, x: newLast.x }
        : neighbor
    return { ...connector, points: simplifyOrthogonalPath([...points.slice(0, -2), adjusted, newLast]) }
  })

  const nodes = moved.nodes.map(n => {
    if (!movedNodeIds.has(n.id)) return n
    for (const c of connectors) {
      if (c.from === n.id) return { ...n, x: c.points[0].x, y: c.points[0].y }
      if (c.to === n.id) return { ...n, x: c.points[c.points.length - 1].x, y: c.points[c.points.length - 1].y }
    }
    return n
  })

  return { ...moved, connectors, nodes }
}

/** Updates one endpoint of a points-based element's own Points in place
 * (BusBarSection or Rectangle — see POINTS_BASED_CLASSES; for a Rectangle
 * this is how dragging a corner handle resizes it) — its anchor (X/Y) is
 * recomputed as the midpoint of the first and last point, the same
 * convention placeBusbar/placeRectangle establish when first drawing one.
 * A no-op for any other class, or an out-of-range point index. Kept the
 * name "Busbar" for historical reasons (every caller predates Rectangle),
 * not because it's busbar-specific. */
export function updateBusbarPoint(diagram: Diagram, id: number, pointIndex: number, point: Point): Diagram {
  return {
    ...diagram,
    elements: diagram.elements.map(e => {
      if (e.id !== id || !POINTS_BASED_CLASSES.has(e.class) || !e.points || !e.points[pointIndex]) return e
      const points = e.points.map((p, i) => (i === pointIndex ? point : p))
      const first = points[0]
      const last = points[points.length - 1]
      return { ...e, points, x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }
    }),
  }
}

function nextPortName(e: DiagramElement): string {
  return String((e.ports?.length ?? 0) + 1)
}

// A newly drawn OverheadLine/CableLine/LinkToObject connector gets an
// auto-generated Name — the same "<kind label>-<id>" convention
// placeElement already uses for a newly placed equipment symbol
// ("Breaker-3") — since these are meant to carry a real identity a plain
// BusWork/BusbarWire connector never does. For OverheadLine/CableLine
// it's also what actually makes writeNamedLine's own data-name attribute
// non-empty (confirmed against a real xsde2svg-exported line's own
// data-name, e.g. sld-viewer/assets/sld/IEEE9bus.svg's "Line2" — see
// backend/internal/slddoc/render.go); LinkToObject's own real xsde2svg
// rendering (writeObjectLink) never carries a data-name at all — a real
// instance's own element_28.go emits its polyline with no <g> wrapper and
// no data-name, unlike element_22/23's own writeNamedLine treatment — so
// there this Name is editor-only bookkeeping (Properties/XML), not
// anything Render reads back out. Every other kind returns undefined,
// same as never setting Name at all.
const NAMED_CONNECTOR_KIND_LABEL: Partial<Record<ConnectorKind, string>> = {
  OverheadLine: 'Overhead line',
  CableLine: 'Cable line',
  LinkToObject: 'Object link',
}

function defaultConnectorName(kind: ConnectorKind, id: number): string | undefined {
  const label = NAMED_CONNECTOR_KIND_LABEL[kind]
  return label ? `${label}-${id}` : undefined
}

/** Mirrors (if set), rotates, and translates a local (unrotated) point by
 * an element's own mirror/orient/anchor — matching exactly how
 * internal/slddoc.Render places a symbol's template, via
 * transform="translate(x,y) rotate(orient) scale(-1,1)" (mirror is the
 * innermost transform, applied to the point first, same as the backend's
 * own transform-attribute order). Exported for Canvas.tsx's own
 * elementBoxes, which maps a symbol's real rendered-DOM local bounding box
 * (getBBox(), still in that same pre-transform local space) through this
 * same math to get its true diagram-space footprint. */
export function placeLocalPoint(el: DiagramElement, p: Point): Point {
  const mx = el.mirror ? -p.x : p.x
  const rad = ((el.orient ?? 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: el.x + mx * cos - p.y * sin, y: el.y + mx * sin + p.y * cos }
}

// Power transformer (shape 47) geometry constants — mirrors
// backend/internal/slddoc's own render.go constants of the same name
// exactly (see writePowerTransformer's own doc comment for why these, not
// real xsde2svg's own Size 11-24 table, are the only numbers this editor
// ever uses). Kept in sync by hand, like every other JSON-shape mirror in
// this file — there's no codegen linking the two.
const TRANSFORMER_RADIUS = 22
const TRANSFORMER_X_SHIFT = 18
const TRANSFORMER_TOP_SHIFT = 25
const TRANSFORMER_SIDE_SHIFT = 29
const TRANSFORMER_VERT_SHIFT = 20

/** Winding index i's own leg length, for a transformer with the given
 * real winding count — mirrors render.go's transformerLegLength exactly
 * (see its own doc comment for why this varies by position: each value is
 * chosen so offset+TRANSFORMER_RADIUS+length is a multiple of the
 * editor's own default 10-unit grid, for that winding's own *default*
 * TerminalDirection). Kept in sync by hand like everything else here. */
function transformerLegLength(count: number, i: number): number {
  switch (count) {
    case 2:
      return 10
    case 3:
      return i === 0 ? 13 : 10
    case 4:
      switch (i) {
        case 0:
          return 8
        case 1:
          return 10
        default:
          return 9
      }
    default:
      return 10
  }
}

/** Real winding index i's own local (pre-rotation) circle-center offset,
 * for a PowerTransformer with the given real winding count — mirrors
 * render.go's transformerWindingOffset exactly. */
function transformerWindingOffset(count: number, i: number): Point {
  switch (count) {
    case 2:
      return i === 0 ? { x: TRANSFORMER_X_SHIFT, y: 0 } : { x: -TRANSFORMER_X_SHIFT, y: 0 }
    case 3:
      if (i === 0) return { x: 0, y: -TRANSFORMER_TOP_SHIFT }
      return i === 1 ? { x: TRANSFORMER_X_SHIFT, y: 0 } : { x: -TRANSFORMER_X_SHIFT, y: 0 }
    case 4:
      switch (i) {
        case 0:
          return { x: 0, y: -TRANSFORMER_VERT_SHIFT }
        case 1:
          return { x: 0, y: TRANSFORMER_X_SHIFT }
        case 2:
          return { x: -TRANSFORMER_SIDE_SHIFT, y: 0 }
        default:
          return { x: TRANSFORMER_SIDE_SHIFT, y: 0 }
      }
    default:
      return { x: 0, y: 0 }
  }
}

/** Real winding index i's own conventional lead direction for a
 * transformer with the given real winding count, used when that winding's
 * own `terminal` field is empty — mirrors render.go's defaultTerminal
 * exactly. */
function defaultTransformerTerminal(count: number, i: number): TerminalDirection {
  switch (count) {
    case 2:
      return i === 0 ? 'right' : 'left'
    case 3:
      if (i === 0) return 'top'
      return i === 1 ? 'right' : 'left'
    case 4:
      switch (i) {
        case 0:
          return 'top'
        case 1:
          return 'bottom'
        case 2:
          return 'left'
        default:
          return 'right'
      }
    default:
      return 'right'
  }
}

/** A winding's own lead tip — its real electrical terminal — given its own
 * circle center, lead direction, and own leg length (transformerLegLength);
 * mirrors render.go's transformerLegEndpoint exactly. */
function transformerLegEndpoint(cx: number, cy: number, dir: TerminalDirection, legLen: number): Point {
  switch (dir) {
    case 'top':
      return { x: cx, y: cy - TRANSFORMER_RADIUS - legLen }
    case 'bottom':
      return { x: cx, y: cy + TRANSFORMER_RADIUS + legLen }
    case 'left':
      return { x: cx - TRANSFORMER_RADIUS - legLen, y: cy }
    default:
      return { x: cx + TRANSFORMER_RADIUS + legLen, y: cy }
  }
}

// An autotransformer's own extra "line" terminal — the tap arc's own far
// tip (see render.go's writeAutotransformerTap and its own
// transformerTapOffsetY), a real electrical connection distinct from
// every winding's own regular lead. Always directly above the anchor
// (local x=0) regardless of winding count or Windings[0]'s own dX, so it
// stays grid-aligned the same way every other fixed-offset terminal here
// does.
const TRANSFORMER_TAP_OFFSET_Y = -50

/** A PowerTransformer's own local (pre-rotation) lead-tip positions, one
 * per winding, in Windings order, plus (autotransformer only) the tap's
 * own extra terminal last — the dynamic counterpart to a static shape's
 * own catalog Terminals, since a transformer's own terminal count and
 * positions depend on its own Windings (winding count, each one's own
 * terminal direction) and Autotransformer flag, not anything base.xml can
 * declare once per shape. Without the tap terminal here, the click-to-
 * route tool could never find it as a connection target at all — a real
 * gap a user hit, since the tap arc used to be purely cosmetic. */
function transformerLocalTerminals(el: DiagramElement): Point[] {
  const count = Math.max(2, el.windings?.length ?? 2)
  const points: Point[] = []
  for (let i = 0; i < count; i++) {
    const offset = transformerWindingOffset(count, i)
    const dir = el.windings?.[i]?.terminal || defaultTransformerTerminal(count, i)
    points.push(transformerLegEndpoint(offset.x, offset.y, dir, transformerLegLength(count, i)))
  }
  if (el.autotransformer) {
    points.push({ x: 0, y: TRANSFORMER_TAP_OFFSET_Y })
  }
  return points
}

/** An element's own real terminal positions — where a wire would actually
 * meet it — or null when its shape carries no <terminals> (most shapes,
 * for now; see base.xml's own doc comment) and it isn't a PowerTransformer
 * (whose own terminals are computed dynamically instead — see
 * transformerLocalTerminals). Purely a visual aid: Canvas draws a marker
 * at each one for the current selection. Ctrl/Cmd-click-to-connect
 * (connectElements, below) does not use this — it still joins two
 * elements' bare anchors regardless of any terminals a shape defines. */
export function symbolTerminals(el: DiagramElement, symbols: ElementSymbol[]): Point[] | null {
  if (el.class === 'PowerTransformer') {
    return transformerLocalTerminals(el).map(t => placeLocalPoint(el, t))
  }
  const symbol = symbols.find(s => s.shape === el.shape)
  if (!symbol?.terminals || symbol.terminals.length === 0) return null
  // A Fork's own template is drawn at its own Radius (arm length, unset =
  // FORK_ARM_LENGTH — see slddoc's own ClassFork), while base.xml declares
  // its terminals at the default size, so they scale along with it.
  const scale = el.class === 'Fork' && el.radius ? el.radius / FORK_ARM_LENGTH : 1
  return symbol.terminals.map(t => placeLocalPoint(el, { x: t.x * scale, y: t.y * scale }))
}

// A Fork's (shape 26) own default arm length — slddoc's own forkArmLength.
export const FORK_ARM_LENGTH = 10

/** Electrically joins two elements: a Node (plus a Port referencing it) is
 * created at each element's own anchor, and a Connector drawn straight
 * between them ties the two Nodes together. This is a simplified stand-in
 * for real port geometry (the symbol library doesn't record per-shape port
 * offsets — see backend/internal/slddoc's Port doc comment) — connecting
 * two elements always runs a straight line anchor-to-anchor rather than to
 * each shape's true terminal position. The new connector's voltage comes
 * from whichever of from/to already has one (see drawConnectorPath's own
 * doc comment) — with no defaultVoltage param here, an element joined to
 * one with no voltage of its own at all just stays unset, same as before.
 * A no-op when either end is a Rectangle, Circle, Arrow, Button, Road,
 * PostPole, Line, PowerflowIndicator, Table, or Table2 — a purely
 * decorative annotation, never a valid electrical endpoint (see slddoc's
 * own ClassRectangle/ClassCircle/ClassArrow/ClassButton/ClassRoad/
 * ClassPostPole/ClassLine/ClassPowerflowIndicator/ClassTable/ClassTable2
 * doc comments); the routing tool's own findConnectionTarget (Canvas.tsx)
 * excludes all ten from candidates entirely for the same reason. */
export function connectElements(diagram: Diagram, fromId: number, toId: number): Diagram {
  if (fromId === toId) return diagram
  const from = diagram.elements.find(e => e.id === fromId)
  const to = diagram.elements.find(e => e.id === toId)
  if (!from || !to) return diagram
  const notConnectable = (el: DiagramElement) =>
    el.class === 'Rectangle' ||
    el.class === 'Circle' ||
    el.class === 'Arrow' ||
    el.class === 'Button' ||
    el.class === 'Road' ||
    el.class === 'PostPole' ||
    el.class === 'Line' ||
    el.class === 'Polygon' ||
    el.class === 'Arc' ||
    el.class === 'PowerflowIndicator' ||
    el.class === 'Table' ||
    el.class === 'Table2'
  if (notConnectable(from) || notConnectable(to)) return diagram

  const ids = new IdSequence(diagram)
  const fromNode: DiagramNode = { id: ids.take(), x: from.x, y: from.y }
  const toNode: DiagramNode = { id: ids.take(), x: to.x, y: to.y }
  const connector: Connector = {
    id: ids.take(),
    kind: 'BusWork',
    layer: from.layer,
    voltage: from.voltage ?? to.voltage,
    from: fromNode.id,
    to: toNode.id,
    points: [
      { x: from.x, y: from.y },
      { x: to.x, y: to.y },
    ],
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...diagram.nodes, fromNode, toNode],
    elements: diagram.elements.map(e => {
      if (e.id === fromId) return { ...e, ports: [...(e.ports ?? []), { name: nextPortName(e), node: fromNode.id }] }
      if (e.id === toId) return { ...e, ports: [...(e.ports ?? []), { name: nextPortName(e), node: toNode.id }] }
      return e
    }),
    connectors: [...diagram.connectors, connector],
  }
}

/** Electrically joins two elements with an explicit, possibly multi-segment
 * path (points.length >= 2 — points[0] the from-side endpoint, the last
 * entry the to-side one) — the routing tool's counterpart to
 * connectElements' always-straight, always-two-point anchor-to-anchor
 * line. A Node (plus a Port referencing it) is still created at each
 * element's own endpoint of the path, exactly as connectElements does;
 * only the Connector's own drawn geometry differs. The new connector's
 * voltage class comes from whichever of from/to already has one — it's
 * electrically joining them, so it should read as the same voltage they
 * already do, not some unrelated value — falling back to defaultVoltage
 * (the last one picked in Properties, same seed placeElement/placeBusbar
 * use) only when neither end has one at all; either way, without this a
 * freshly drawn wire could render with no color (Render's fallback for an
 * unset/unknown voltage id) even while the in-progress preview drew in a
 * visible highlight color during routing. */
export function drawConnectorPath(
  diagram: Diagram,
  fromId: number,
  toId: number,
  points: Point[],
  defaultVoltage?: number,
  kind: ConnectorKind = 'BusWork',
): Diagram {
  if (fromId === toId || points.length < 2) return diagram
  const from = diagram.elements.find(e => e.id === fromId)
  const to = diagram.elements.find(e => e.id === toId)
  if (!from || !to) return diagram

  const ids = new IdSequence(diagram)
  const start = points[0]
  const end = points[points.length - 1]
  const fromNode: DiagramNode = { id: ids.take(), x: start.x, y: start.y }
  const toNode: DiagramNode = { id: ids.take(), x: end.x, y: end.y }
  const connectorId = ids.take()
  const connector: Connector = {
    id: connectorId,
    kind,
    name: defaultConnectorName(kind, connectorId),
    layer: from.layer,
    voltage: from.voltage ?? to.voltage ?? defaultVoltage,
    from: fromNode.id,
    to: toNode.id,
    points,
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...diagram.nodes, fromNode, toNode],
    elements: diagram.elements.map(e => {
      if (e.id === fromId) return { ...e, ports: [...(e.ports ?? []), { name: nextPortName(e), node: fromNode.id }] }
      if (e.id === toId) return { ...e, ports: [...(e.ports ?? []), { name: nextPortName(e), node: toNode.id }] }
      return e
    }),
    connectors: [...diagram.connectors, connector],
  }
}

/** Splits connectorId into up to two connectors at tapPoint, along its own
 * segmentIndex..segmentIndex+1 span, introducing a shared junction Node
 * there — the core operation behind tapping a new route into an existing
 * wire, on whichever end(s) of the new route the tap lands (see
 * drawConnectorPathToConnector/drawConnectorPathFromConnector/
 * drawConnectorBetweenConnectors below). Mirrors deleteConnectorSegment's
 * own split, just inserting a junction instead of cutting one out. Doesn't
 * touch diagram itself — the caller folds the returned nodes/connectors
 * into whatever diagram it eventually returns, and ids is an IdSequence
 * already open on that diagram (so two splices in the same edit, one per
 * end, share one counter). Returns null if connectorId/segmentIndex don't
 * resolve to a real span to split.
 *
 * tapPoint landing exactly on one of the connector's own two true
 * endpoints (its from/to Node's own position) is a special, cheaper case:
 * rather than spawning a new junction Node plus a zero-length duplicate
 * connector alongside the original, it reuses that end's already-existing
 * Node directly and leaves the original connector untouched — the same
 * thing an element's own terminal already does, just against a connector
 * end instead of a Port. This is also what makes a 'OverheadLine'
 * connector's own begin/end-only connect targets (Canvas's
 * findConnectionTarget) a plain, correct node reuse rather than a
 * needless split. */
function spliceConnectorAt(
  diagram: Diagram,
  connectorId: number,
  segmentIndex: number,
  tapPoint: Point,
  ids: IdSequence,
): { connectors: Connector[]; nodes: DiagramNode[]; junctionNode: DiagramNode } | null {
  const connector = diagram.connectors.find(c => c.id === connectorId)
  if (!connector) return null
  if (segmentIndex < 0 || segmentIndex >= connector.points.length - 1) return null

  const start = connector.points[0]
  const end = connector.points[connector.points.length - 1]
  if (tapPoint.x === start.x && tapPoint.y === start.y) {
    const fromNode = diagram.nodes.find(n => n.id === connector.from)
    if (fromNode) return { connectors: [connector], nodes: [], junctionNode: fromNode }
  }
  if (tapPoint.x === end.x && tapPoint.y === end.y) {
    const toNode = diagram.nodes.find(n => n.id === connector.to)
    if (toNode) return { connectors: [connector], nodes: [], junctionNode: toNode }
  }

  const junctionNode: DiagramNode = { id: ids.take(), x: tapPoint.x, y: tapPoint.y }
  const beforePoints = simplifyOrthogonalPath([...connector.points.slice(0, segmentIndex + 1), tapPoint])
  const afterPoints = simplifyOrthogonalPath([tapPoint, ...connector.points.slice(segmentIndex + 1)])

  const connectors: Connector[] = []
  if (beforePoints.length >= 2) {
    connectors.push({
      id: ids.take(),
      kind: connector.kind,
      voltage: connector.voltage,
      layer: connector.layer,
      dashed: connector.dashed,
      lineStyle: connector.lineStyle,
      from: connector.from,
      to: junctionNode.id,
      points: beforePoints,
    })
  }
  if (afterPoints.length >= 2) {
    connectors.push({
      id: ids.take(),
      kind: connector.kind,
      voltage: connector.voltage,
      layer: connector.layer,
      dashed: connector.dashed,
      lineStyle: connector.lineStyle,
      from: junctionNode.id,
      to: connector.to,
      points: afterPoints,
    })
  }

  return { connectors, nodes: [junctionNode], junctionNode }
}

/** Like drawConnectorPath, but the target is a point along an *existing*
 * connector's own line (targetConnectorId, at segmentIndex — see
 * geometry.nearestSegmentOnPolyline) rather than a second element's
 * terminal — lets the routing tool tap a new wire straight into an
 * already-drawn run (e.g. a breaker tying into a buswork jumper that's
 * itself headed to the bus), the same way it can already land on any point
 * along a real BusBarSection. Splits the target connector (spliceConnectorAt)
 * and gives all three connectors — both new halves and the new path drawn
 * here — a shared Node there, so it's a real electrical junction rather
 * than a merely-visual touch. */
export function drawConnectorPathToConnector(
  diagram: Diagram,
  fromId: number,
  targetConnectorId: number,
  segmentIndex: number,
  points: Point[],
  defaultVoltage?: number,
  kind: ConnectorKind = 'BusWork',
): Diagram {
  if (points.length < 2) return diagram
  const from = diagram.elements.find(e => e.id === fromId)
  const target = diagram.connectors.find(c => c.id === targetConnectorId)
  if (!from || !target) return diagram

  const ids = new IdSequence(diagram)
  const start = points[0]
  const tapPoint = points[points.length - 1]
  const splice = spliceConnectorAt(diagram, targetConnectorId, segmentIndex, tapPoint, ids)
  if (!splice) return diagram
  const fromNode: DiagramNode = { id: ids.take(), x: start.x, y: start.y }

  const tapConnectorId = ids.take()
  const tapConnector: Connector = {
    id: tapConnectorId,
    kind,
    name: defaultConnectorName(kind, tapConnectorId),
    layer: from.layer,
    voltage: from.voltage ?? target.voltage ?? defaultVoltage,
    from: fromNode.id,
    to: splice.junctionNode.id,
    points,
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...diagram.nodes, fromNode, ...splice.nodes],
    elements: diagram.elements.map(e =>
      e.id === fromId ? { ...e, ports: [...(e.ports ?? []), { name: nextPortName(e), node: fromNode.id }] } : e,
    ),
    connectors: [...diagram.connectors.filter(c => c.id !== targetConnectorId), ...splice.connectors, tapConnector],
  }
}

/** Like drawConnectorPathToConnector, but the roles are swapped: the
 * *source* end of the new path (points[0]) is the tap, into
 * sourceConnectorId at sourceSegmentIndex, and the far end
 * (points[points.length-1]) lands on a second element's terminal — used
 * when a route is *started* by Ctrl/Cmd-clicking a point along an existing
 * connector rather than clicking an element's own pin (see Canvas's
 * routing-start handling). */
export function drawConnectorPathFromConnector(
  diagram: Diagram,
  sourceConnectorId: number,
  sourceSegmentIndex: number,
  toId: number,
  points: Point[],
  defaultVoltage?: number,
  kind: ConnectorKind = 'BusWork',
): Diagram {
  if (points.length < 2) return diagram
  const source = diagram.connectors.find(c => c.id === sourceConnectorId)
  const to = diagram.elements.find(e => e.id === toId)
  if (!source || !to) return diagram

  const ids = new IdSequence(diagram)
  const tapPoint = points[0]
  const end = points[points.length - 1]
  const splice = spliceConnectorAt(diagram, sourceConnectorId, sourceSegmentIndex, tapPoint, ids)
  if (!splice) return diagram
  const toNode: DiagramNode = { id: ids.take(), x: end.x, y: end.y }

  const tapConnectorId = ids.take()
  const tapConnector: Connector = {
    id: tapConnectorId,
    kind,
    name: defaultConnectorName(kind, tapConnectorId),
    layer: to.layer,
    voltage: source.voltage ?? to.voltage ?? defaultVoltage,
    from: splice.junctionNode.id,
    to: toNode.id,
    points,
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...diagram.nodes, ...splice.nodes, toNode],
    elements: diagram.elements.map(e =>
      e.id === toId ? { ...e, ports: [...(e.ports ?? []), { name: nextPortName(e), node: toNode.id }] } : e,
    ),
    connectors: [...diagram.connectors.filter(c => c.id !== sourceConnectorId), ...splice.connectors, tapConnector],
  }
}

/** Like drawConnectorPathToConnector/drawConnectorPathFromConnector, but
 * *both* ends of the new path are taps into an existing connector — a
 * route Ctrl/Cmd-started on one wire and finished on a different one.
 * Splices both (each independently, off the same original diagram, since
 * they're necessarily two different connectors — guarded below) and joins
 * their two junction Nodes. */
export function drawConnectorBetweenConnectors(
  diagram: Diagram,
  sourceConnectorId: number,
  sourceSegmentIndex: number,
  targetConnectorId: number,
  targetSegmentIndex: number,
  points: Point[],
  defaultVoltage?: number,
  kind: ConnectorKind = 'BusWork',
): Diagram {
  if (points.length < 2 || sourceConnectorId === targetConnectorId) return diagram
  const source = diagram.connectors.find(c => c.id === sourceConnectorId)
  const target = diagram.connectors.find(c => c.id === targetConnectorId)
  if (!source || !target) return diagram

  const ids = new IdSequence(diagram)
  const startTap = points[0]
  const endTap = points[points.length - 1]
  const sourceSplice = spliceConnectorAt(diagram, sourceConnectorId, sourceSegmentIndex, startTap, ids)
  if (!sourceSplice) return diagram
  const targetSplice = spliceConnectorAt(diagram, targetConnectorId, targetSegmentIndex, endTap, ids)
  if (!targetSplice) return diagram

  const tapConnectorId = ids.take()
  const tapConnector: Connector = {
    id: tapConnectorId,
    kind,
    name: defaultConnectorName(kind, tapConnectorId),
    layer: source.layer,
    voltage: source.voltage ?? target.voltage ?? defaultVoltage,
    from: sourceSplice.junctionNode.id,
    to: targetSplice.junctionNode.id,
    points,
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...diagram.nodes, ...sourceSplice.nodes, ...targetSplice.nodes],
    connectors: [
      ...diagram.connectors.filter(c => c.id !== sourceConnectorId && c.id !== targetConnectorId),
      ...sourceSplice.connectors,
      ...targetSplice.connectors,
      tapConnector,
    ],
  }
}

/** Like drawConnectorPath, but ends "in mid-air" instead of on a second
 * element — a Node is still created at the far end (points[points.length -
 * 1]) so the Connector has somewhere to point its own `to`, but no
 * element gets a Port referencing it, leaving that end dangling (matching
 * how removeElement already treats a connector touching a node no element
 * still ports into). Used to let double-click end an in-progress route
 * without requiring a target element. defaultVoltage: see drawConnectorPath
 * — here there's no `to` element to check, so it's from's own voltage,
 * then defaultVoltage. */
export function drawDanglingConnectorPath(
  diagram: Diagram,
  fromId: number,
  points: Point[],
  defaultVoltage?: number,
  kind: ConnectorKind = 'BusWork',
): Diagram {
  if (points.length < 2) return diagram
  const from = diagram.elements.find(e => e.id === fromId)
  if (!from) return diagram

  const ids = new IdSequence(diagram)
  const start = points[0]
  const end = points[points.length - 1]
  const fromNode: DiagramNode = { id: ids.take(), x: start.x, y: start.y }
  const toNode: DiagramNode = { id: ids.take(), x: end.x, y: end.y }
  const connectorId = ids.take()
  const connector: Connector = {
    id: connectorId,
    kind,
    name: defaultConnectorName(kind, connectorId),
    layer: from.layer,
    voltage: from.voltage ?? defaultVoltage,
    from: fromNode.id,
    to: toNode.id,
    points,
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...diagram.nodes, fromNode, toNode],
    elements: diagram.elements.map(e =>
      e.id === fromId ? { ...e, ports: [...(e.ports ?? []), { name: nextPortName(e), node: fromNode.id }] } : e,
    ),
    connectors: [...diagram.connectors, connector],
  }
}

/** Like drawDanglingConnectorPath, but the source end is a tap into an
 * existing connector (sourceConnectorId/sourceSegmentIndex) rather than an
 * element's own terminal — double-clicking to end a route in mid-air when
 * it was itself started by Ctrl/Cmd-clicking a busbar or wire. */
export function drawDanglingConnectorPathFromConnector(
  diagram: Diagram,
  sourceConnectorId: number,
  sourceSegmentIndex: number,
  points: Point[],
  defaultVoltage?: number,
  kind: ConnectorKind = 'BusWork',
): Diagram {
  if (points.length < 2) return diagram
  const source = diagram.connectors.find(c => c.id === sourceConnectorId)
  if (!source) return diagram

  const ids = new IdSequence(diagram)
  const tapPoint = points[0]
  const end = points[points.length - 1]
  const splice = spliceConnectorAt(diagram, sourceConnectorId, sourceSegmentIndex, tapPoint, ids)
  if (!splice) return diagram
  const endNode: DiagramNode = { id: ids.take(), x: end.x, y: end.y }

  const tapConnectorId = ids.take()
  const tapConnector: Connector = {
    id: tapConnectorId,
    kind,
    name: defaultConnectorName(kind, tapConnectorId),
    layer: source.layer,
    voltage: source.voltage ?? defaultVoltage,
    from: splice.junctionNode.id,
    to: endNode.id,
    points,
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...diagram.nodes, ...splice.nodes, endNode],
    connectors: [...diagram.connectors.filter(c => c.id !== sourceConnectorId), ...splice.connectors, tapConnector],
  }
}

/** Like drawConnectorPath, but the *source* end (points[0]) isn't an
 * element's terminal at all — a bare point in mid-air, with no Node
 * created there referencing any Port. Used when a route is started by
 * double-clicking empty canvas rather than clicking a terminal (see
 * Canvas's own routing-start handling) — lets a diagram be drawn
 * wire-first, with equipment placed onto it (or not) afterward, instead
 * of always needing an element to exist before a wire can touch it. */
export function drawConnectorPathFromPoint(
  diagram: Diagram,
  points: Point[],
  toId: number,
  defaultVoltage?: number,
  kind: ConnectorKind = 'BusWork',
): Diagram {
  if (points.length < 2) return diagram
  const to = diagram.elements.find(e => e.id === toId)
  if (!to) return diagram

  const ids = new IdSequence(diagram)
  const start = points[0]
  const end = points[points.length - 1]
  const fromNode: DiagramNode = { id: ids.take(), x: start.x, y: start.y }
  const toNode: DiagramNode = { id: ids.take(), x: end.x, y: end.y }
  const connectorId = ids.take()
  const connector: Connector = {
    id: connectorId,
    kind,
    name: defaultConnectorName(kind, connectorId),
    layer: to.layer,
    voltage: to.voltage ?? defaultVoltage,
    from: fromNode.id,
    to: toNode.id,
    points,
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...diagram.nodes, fromNode, toNode],
    elements: diagram.elements.map(e =>
      e.id === toId ? { ...e, ports: [...(e.ports ?? []), { name: nextPortName(e), node: toNode.id }] } : e,
    ),
    connectors: [...diagram.connectors, connector],
  }
}

/** Like drawConnectorPathFromPoint, but the target end is a tap into an
 * *existing connector's own line* (targetConnectorId/segmentIndex) rather
 * than an element — a route started in mid-air and finished by tapping
 * into an already-drawn wire. */
export function drawConnectorPathFromPointToConnector(
  diagram: Diagram,
  points: Point[],
  targetConnectorId: number,
  segmentIndex: number,
  defaultVoltage?: number,
  kind: ConnectorKind = 'BusWork',
): Diagram {
  if (points.length < 2) return diagram
  const target = diagram.connectors.find(c => c.id === targetConnectorId)
  if (!target) return diagram

  const ids = new IdSequence(diagram)
  const start = points[0]
  const tapPoint = points[points.length - 1]
  const splice = spliceConnectorAt(diagram, targetConnectorId, segmentIndex, tapPoint, ids)
  if (!splice) return diagram
  const fromNode: DiagramNode = { id: ids.take(), x: start.x, y: start.y }

  const tapConnectorId = ids.take()
  const tapConnector: Connector = {
    id: tapConnectorId,
    kind,
    name: defaultConnectorName(kind, tapConnectorId),
    layer: target.layer,
    voltage: target.voltage ?? defaultVoltage,
    from: fromNode.id,
    to: splice.junctionNode.id,
    points,
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...diagram.nodes, fromNode, ...splice.nodes],
    connectors: [...diagram.connectors.filter(c => c.id !== targetConnectorId), ...splice.connectors, tapConnector],
  }
}

/** Like drawConnectorPathFromPoint, but ends in mid-air too (points[points.
 * length-1]) rather than on an element or connector — a route both
 * started and finished by double-clicking empty canvas, so the whole
 * connector has no element or connector attached to either end at all
 * (matching what a hand-built "just a wire" diagram already looks like —
 * see RELEASE.md's overhead-line-only). Since there's no element/
 * connector to borrow a layer from, falls back to defaultLayer (the same
 * seed placeElement/placeBusbar use for a brand new one). */
export function drawDanglingConnectorPathFromPoint(
  diagram: Diagram,
  points: Point[],
  defaultVoltage?: number,
  kind: ConnectorKind = 'BusWork',
): Diagram {
  if (points.length < 2) return diagram

  const ids = new IdSequence(diagram)
  const start = points[0]
  const end = points[points.length - 1]
  const fromNode: DiagramNode = { id: ids.take(), x: start.x, y: start.y }
  const toNode: DiagramNode = { id: ids.take(), x: end.x, y: end.y }
  const connectorId = ids.take()
  const connector: Connector = {
    id: connectorId,
    kind,
    name: defaultConnectorName(kind, connectorId),
    layer: defaultLayer(diagram),
    voltage: defaultVoltage,
    from: fromNode.id,
    to: toNode.id,
    points,
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...diagram.nodes, fromNode, toNode],
    connectors: [...diagram.connectors, connector],
  }
}

/** Removes an element, and any connector left dangling because it was the
 * element's own node's only remaining user (a node still ported into by
 * another element is left alone, along with any connector touching it). */
export function removeElement(diagram: Diagram, id: number): Diagram {
  const removed = diagram.elements.find(e => e.id === id)
  if (!removed) return diagram

  const remainingElements = diagram.elements.filter(e => e.id !== id)
  const removedNodes = new Set((removed.ports ?? []).map(p => p.node))

  const stillUsed = new Set<number>()
  for (const e of remainingElements) {
    for (const p of e.ports ?? []) stillUsed.add(p.node)
  }

  const orphaned = (nodeId: number) => removedNodes.has(nodeId) && !stillUsed.has(nodeId)

  return {
    ...diagram,
    elements: remainingElements,
    connectors: diagram.connectors.filter(c => !orphaned(c.from) && !orphaned(c.to)),
    nodes: diagram.nodes.filter(n => !orphaned(n.id)),
    labels: diagram.labels.filter(l => l.for !== id),
  }
}

/** Places a new standalone (unlinked) text label at point. for, when given,
 * is saved as a plain reference to that element's id — informational only,
 * the same as Connector.name; the label does not follow the element if it's
 * later moved. */
export function placeLabel(diagram: Diagram, point: Point, forId?: number): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const label: Label = {
    id,
    layer: defaultLayer(diagram),
    x: point.x,
    y: point.y,
    size: 10,
    text: 'Label',
    ...(forId ? { for: forId } : {}),
  }
  return { ...diagram, lastId: ids.lastId, labels: [...diagram.labels, label] }
}

/** Translates a label's own anchor by (dx, dy). */
export function moveLabel(diagram: Diagram, id: number, dx: number, dy: number): Diagram {
  return {
    ...diagram,
    labels: diagram.labels.map(l => (l.id === id ? { ...l, x: l.x + dx, y: l.y + dy } : l)),
  }
}

/** Applies a partial edit (Text/Size/Anchor/Bold/For, from Properties) to a
 * label. */
export function updateLabel(diagram: Diagram, id: number, patch: Partial<Label>): Diagram {
  return {
    ...diagram,
    labels: diagram.labels.map(l => (l.id === id ? { ...l, ...patch } : l)),
  }
}

export function removeLabel(diagram: Diagram, id: number): Diagram {
  return { ...diagram, labels: diagram.labels.filter(l => l.id !== id) }
}

/** Places a new shape-134 SCADA readout at point, with a placeholder
 * default value and no unit — Properties fills in Name/Unit/Value
 * afterward, the same as any other freshly placed element. */
export function placeDigitalDevice(diagram: Diagram, point: Point): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const digitalDevice: DigitalDevice = {
    id,
    layer: defaultLayer(diagram),
    x: point.x,
    y: point.y,
    size: 16,
    value: '0.00',
  }
  return {
    ...diagram,
    lastId: ids.lastId,
    digitalDevices: [...diagram.digitalDevices, digitalDevice],
  }
}

/** Translates a digital device's own anchor by (dx, dy). */
export function moveDigitalDevice(diagram: Diagram, id: number, dx: number, dy: number): Diagram {
  return {
    ...diagram,
    digitalDevices: diagram.digitalDevices.map(dd =>
      dd.id === id ? { ...dd, x: dd.x + dx, y: dd.y + dy } : dd,
    ),
  }
}

/** Applies a partial edit (Name/Value/Unit/Size/Anchor/Bold/Color/VAlign/Font,
 * from Properties) to a digital device. */
export function updateDigitalDevice(
  diagram: Diagram,
  id: number,
  patch: Partial<DigitalDevice>,
): Diagram {
  return {
    ...diagram,
    digitalDevices: diagram.digitalDevices.map(dd => (dd.id === id ? { ...dd, ...patch } : dd)),
  }
}

export function removeDigitalDevice(diagram: Diagram, id: number): Diagram {
  return { ...diagram, digitalDevices: diagram.digitalDevices.filter(dd => dd.id !== id) }
}

/** Removes a connector, and either of its own from/to Nodes that becomes
 * genuinely unreferenced as a result — not the from/to of any other
 * remaining connector, and not any element's Port either. A Node with no
 * *element* attached at all is still a normal, intentional thing (a route
 * started or ended in mid-air — see drawDanglingConnectorPath and its
 * *FromPoint sibling — is exactly this, deliberately), so this only prunes
 * one once literally nothing references it anymore; otherwise a diagram's
 * saved XML would accumulate a dead <node> entry every time a wire like
 * that got deleted. deleteConnectorSegment deliberately doesn't go through
 * this — it reuses this same connector's own from/to for whichever side
 * keeps the original endpoint, so pruning them here first would leave that
 * side pointing at a node that no longer exists. */
export function removeConnector(diagram: Diagram, id: number): Diagram {
  const removed = diagram.connectors.find(c => c.id === id)
  if (!removed) return diagram

  const remainingConnectors = diagram.connectors.filter(c => c.id !== id)
  const candidateNodes = new Set([removed.from, removed.to])

  const stillUsed = new Set<number>()
  for (const e of diagram.elements) {
    for (const p of e.ports ?? []) stillUsed.add(p.node)
  }
  for (const c of remainingConnectors) {
    stillUsed.add(c.from)
    stillUsed.add(c.to)
  }

  const orphaned = (nodeId: number) => candidateNodes.has(nodeId) && !stillUsed.has(nodeId)

  return {
    ...diagram,
    connectors: remainingConnectors,
    nodes: diagram.nodes.filter(n => !orphaned(n.id)),
  }
}

/** Removes just one segment of a connector — points[segmentIndex] to
 * points[segmentIndex + 1] — splitting it into up to two independent
 * connectors rather than deleting the whole thing. The side before the cut
 * keeps the original `from` Node/Port (so whichever element it started at
 * stays connected) and gets a brand new Node at the cut, unreferenced by
 * any Port — dangling, same as a route ended in mid-air; the side after
 * the cut mirrors this, keeping the original `to` end and dangling at the
 * cut. Either side is dropped entirely when the cut leaves it with a
 * single, segment-less point (e.g. deleting the first or last segment of a
 * connector, or the only segment of a straight two-point one — in the
 * latter case both sides are dropped and this is equivalent to just
 * removing the whole connector). */
export function deleteConnectorSegment(diagram: Diagram, connectorId: number, segmentIndex: number): Diagram {
  const connector = diagram.connectors.find(c => c.id === connectorId)
  if (!connector) return diagram
  const points = connector.points
  if (segmentIndex < 0 || segmentIndex >= points.length - 1) return diagram

  const beforePoints = points.slice(0, segmentIndex + 1)
  const afterPoints = points.slice(segmentIndex + 1)

  // A plain filter here, not removeConnector itself: removeConnector also
  // prunes the removed connector's own now-unreferenced from/to nodes, but
  // this function is about to reuse connector.from/connector.to for
  // whichever side keeps the original endpoint — pruning them first would
  // leave that side pointing at a node that no longer exists.
  let result = { ...diagram, connectors: diagram.connectors.filter(c => c.id !== connectorId) }
  const ids = new IdSequence(result)
  const newConnectors: Connector[] = []
  const newNodes: DiagramNode[] = []

  if (beforePoints.length >= 2) {
    const end = beforePoints[beforePoints.length - 1]
    const endNode: DiagramNode = { id: ids.take(), x: end.x, y: end.y }
    newNodes.push(endNode)
    newConnectors.push({
      id: ids.take(),
      kind: connector.kind,
      voltage: connector.voltage,
      layer: connector.layer,
      dashed: connector.dashed,
      lineStyle: connector.lineStyle,
      from: connector.from,
      to: endNode.id,
      points: beforePoints,
    })
  }
  if (afterPoints.length >= 2) {
    const start = afterPoints[0]
    const startNode: DiagramNode = { id: ids.take(), x: start.x, y: start.y }
    newNodes.push(startNode)
    newConnectors.push({
      id: ids.take(),
      kind: connector.kind,
      voltage: connector.voltage,
      layer: connector.layer,
      dashed: connector.dashed,
      lineStyle: connector.lineStyle,
      from: startNode.id,
      to: connector.to,
      points: afterPoints,
    })
  }

  return {
    ...result,
    lastId: ids.lastId,
    nodes: [...result.nodes, ...newNodes],
    connectors: [...result.connectors, ...newConnectors],
  }
}

// --- Connector geometry editing (dragging/adding/removing a bend point) ---
//
// A connector's own two endpoints (points[0] and points[points.length-1])
// are fixed — they're what its `from`/`to` Nodes (and, through them, an
// element's Port) actually point at, so none of the functions below ever
// move one. Every interior point is free to move, be added, or be
// removed. See moveConnectorVertex's own doc comment for the
// orthogonality rule an interior drag follows.

/** Collapses a points array back down to its essential vertices: a
 * "straight-through" interior point (its neighbors on both sides share
 * either its X or its Y, i.e. the two segments meeting there are already
 * parallel/colinear) carries no bend of its own and is dropped, and so is
 * an exact duplicate of its neighbor (a zero-length segment). Endpoints
 * (index 0 and the last) are never dropped. Run after any edit that could
 * leave a redundant point behind — moving a vertex into its neighbor's
 * row/column, or removing one entirely. */
export function simplifyOrthogonalPath(points: Point[]): Point[] {
  if (points.length <= 2) return points
  const result: Point[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1]
    const curr = points[i]
    const next = points[i + 1]
    if (prev.x === curr.x && curr.x === next.x) continue
    if (prev.y === curr.y && curr.y === next.y) continue
    if (prev.x === curr.x && prev.y === curr.y) continue
    result.push(curr)
  }
  const last = points[points.length - 1]
  const secondLast = result[result.length - 1]
  if (!(secondLast.x === last.x && secondLast.y === last.y)) result.push(last)
  return result
}

/** Drags one interior vertex (0 < vertexIndex < points.length - 1) of an
 * existing connector to point, keeping both segments that meet there
 * orthogonal — the "projection-lock" rule real schematic/PCB routers use:
 * each neighbor slides along whichever single axis keeps its own segment
 * to the dragged vertex parallel to what it always was (horizontal stays
 * horizontal, vertical stays vertical), so 90° is preserved without
 * touching anything further down the path. A neighbor that's itself a
 * fixed endpoint can't slide, so instead a new Z/U-shaped bend is inserted
 * between it and the dragged vertex — the wire still leaves that endpoint
 * in its original direction, then turns to reach the new position — one
 * new point on that side rather than moving the endpoint itself.
 * simplifyOrthogonalPath cleans up afterward, e.g. a drag that straightens
 * a bend back out, or lands exactly on top of a neighbor. */
export function moveConnectorVertex(diagram: Diagram, connectorId: number, vertexIndex: number, point: Point): Diagram {
  const connector = diagram.connectors.find(c => c.id === connectorId)
  if (!connector) return diagram
  const points = connector.points
  if (vertexIndex <= 0 || vertexIndex >= points.length - 1) return diagram

  const prev = points[vertexIndex - 1]
  const next = points[vertexIndex + 1]
  const old = points[vertexIndex]
  const prevIsFixed = vertexIndex - 1 === 0
  const nextIsFixed = vertexIndex + 1 === points.length - 1
  const prevWasHorizontal = prev.y === old.y
  const nextWasHorizontal = next.y === old.y

  const newPoints = [...points]

  if (prevIsFixed) {
    const bend = prevWasHorizontal ? { x: point.x, y: prev.y } : { x: prev.x, y: point.y }
    newPoints.splice(vertexIndex, 0, bend)
  } else {
    newPoints[vertexIndex - 1] = prevWasHorizontal ? { ...prev, y: point.y } : { ...prev, x: point.x }
  }

  const draggedIndex = prevIsFixed ? vertexIndex + 1 : vertexIndex
  newPoints[draggedIndex] = point

  if (nextIsFixed) {
    const bend = nextWasHorizontal ? { x: point.x, y: next.y } : { x: next.x, y: point.y }
    newPoints.splice(draggedIndex + 1, 0, bend)
  } else {
    newPoints[draggedIndex + 1] = nextWasHorizontal ? { ...next, y: point.y } : { ...next, x: point.x }
  }

  return {
    ...diagram,
    connectors: diagram.connectors.map(c => (c.id === connectorId ? { ...c, points: simplifyOrthogonalPath(newPoints) } : c)),
  }
}

/** True when a connector's own from/to Node (whichever end points at) is
 * genuinely dangling: not referenced by any Element's own Port, and not
 * shared with any other connector's own from/to (a real junction). Both
 * of those mean the endpoint is a real electrical connection, not a
 * free-floating point — Canvas only offers a drag handle for one where
 * this is true, and moveConnectorEndpoint itself re-checks it as a
 * defensive guard. */
export function isConnectorEndpointDangling(diagram: Diagram, connector: Connector, end: 'from' | 'to'): boolean {
  const nodeId = end === 'from' ? connector.from : connector.to
  for (const e of diagram.elements) {
    for (const p of e.ports ?? []) if (p.node === nodeId) return false
  }
  for (const c of diagram.connectors) {
    if (c.id === connector.id) continue
    if (c.from === nodeId || c.to === nodeId) return false
  }
  return true
}

/** Drags one of a connector's two true endpoints (points[0] for 'from',
 * points[length - 1] for 'to') to point — but only when
 * isConnectorEndpointDangling says that end is genuinely free; moving an
 * attached or shared one would silently tear it away from what it's
 * actually wired to, so this is a no-op otherwise (Canvas only offers a
 * handle for a dangling one in the first place — this check is a
 * defensive backstop, not the primary gate). Keeps the touching segment
 * orthogonal via the same projection-lock rule moveConnectorVertex uses
 * for an interior vertex, just with a single neighbor instead of two:
 * that neighbor slides along whichever axis preserves its own segment's
 * orientation when it's itself free to move, or gets a new bend inserted
 * next to it instead when it's the connector's other true endpoint (a
 * straight two-point wire) and can't. The corresponding Node is moved to
 * match, same as every other connector-endpoint edit in this file. */
export function moveConnectorEndpoint(diagram: Diagram, connectorId: number, end: 'from' | 'to', point: Point): Diagram {
  const connector = diagram.connectors.find(c => c.id === connectorId)
  if (!connector) return diagram
  if (!isConnectorEndpointDangling(diagram, connector, end)) return diagram

  const points = connector.points
  const lastIndex = points.length - 1
  const endIndex = end === 'from' ? 0 : lastIndex
  const neighborIndex = end === 'from' ? 1 : lastIndex - 1
  const neighbor = points[neighborIndex]
  const old = points[endIndex]
  const neighborIsFixed = neighborIndex === 0 || neighborIndex === lastIndex
  const wasHorizontal = neighbor.y === old.y

  const newPoints = [...points]
  newPoints[endIndex] = point

  if (neighborIsFixed) {
    const bend = wasHorizontal ? { x: point.x, y: neighbor.y } : { x: neighbor.x, y: point.y }
    newPoints.splice(end === 'from' ? 1 : lastIndex, 0, bend)
  } else {
    newPoints[neighborIndex] = wasHorizontal ? { ...neighbor, y: point.y } : { ...neighbor, x: point.x }
  }

  const nodeId = end === 'from' ? connector.from : connector.to
  return {
    ...diagram,
    connectors: diagram.connectors.map(c =>
      c.id === connectorId ? { ...c, points: simplifyOrthogonalPath(newPoints) } : c,
    ),
    nodes: diagram.nodes.map(n => (n.id === nodeId ? { ...n, x: point.x, y: point.y } : n)),
  }
}

/** Inserts a new vertex at point between an existing connector's
 * points[segmentIndex] and points[segmentIndex + 1] — the raw building
 * block behind both "double-click a segment to add a bend" (used as-is,
 * the point typically lying right on that segment already) and "drag a
 * segment's midpoint to reshape it" (the caller follows up with
 * moveConnectorVertex on the same index once the drag actually moves
 * anywhere, which is what turns this into a real bend). Deliberately
 * doesn't simplify — the point just added is often momentarily colinear
 * with its new neighbors, and collapsing it right back out would defeat
 * the insert. */
export function insertConnectorVertex(diagram: Diagram, connectorId: number, segmentIndex: number, point: Point): Diagram {
  const connector = diagram.connectors.find(c => c.id === connectorId)
  if (!connector) return diagram
  if (segmentIndex < 0 || segmentIndex >= connector.points.length - 1) return diagram
  const points = [...connector.points]
  points.splice(segmentIndex + 1, 0, point)
  return { ...diagram, connectors: diagram.connectors.map(c => (c.id === connectorId ? { ...c, points } : c)) }
}

/** Removes one interior vertex (0 < vertexIndex < points.length - 1)
 * outright — e.g. a specific bend point the user selected, then pressed
 * Delete on — collapsing its two adjacent segments into one and cleaning
 * up any resulting redundant point with simplifyOrthogonalPath. */
export function removeConnectorVertex(diagram: Diagram, connectorId: number, vertexIndex: number): Diagram {
  const connector = diagram.connectors.find(c => c.id === connectorId)
  if (!connector) return diagram
  if (vertexIndex <= 0 || vertexIndex >= connector.points.length - 1) return diagram
  const points = connector.points.filter((_, i) => i !== vertexIndex)
  return {
    ...diagram,
    connectors: diagram.connectors.map(c => (c.id === connectorId ? { ...c, points: simplifyOrthogonalPath(points) } : c)),
  }
}

/** Adds a new voltage class to the diagram (e.g. from one of the server's
 * default voltage-color presets, or a fully custom name/color) — this is
 * the only way a diagram ever gets one to assign to an element/connector;
 * a freshly created diagram starts with none. */
export function addVoltageClass(diagram: Diagram, name: string, color: string): Diagram {
  const ids = new IdSequence(diagram)
  const voltageClass: VoltageClass = { id: ids.take(), name, color }
  return { ...diagram, lastId: ids.lastId, voltageClasses: [...diagram.voltageClasses, voltageClass] }
}

export function updateVoltageClass(diagram: Diagram, id: number, patch: Partial<VoltageClass>): Diagram {
  return {
    ...diagram,
    voltageClasses: diagram.voltageClasses.map(vc => (vc.id === id ? { ...vc, ...patch } : vc)),
  }
}

/** Removes a voltage class. Any element/connector still referencing it by
 * id keeps that (now-dangling) reference rather than being cleared —
 * internal/slddoc.Render already falls back to a neutral gray for a
 * voltage id it can't resolve, so this doesn't break rendering, just
 * leaves it unassigned in effect until reassigned to something real. */
export function removeVoltageClass(diagram: Diagram, id: number): Diagram {
  return { ...diagram, voltageClasses: diagram.voltageClasses.filter(vc => vc.id !== id) }
}

/** Renames every voltage class still named after its own color (or not
 * named at all) — how slddoc.Extract names a color it had no voltage hint
 * for, e.g. `name="#962896" color="#962896"` — to the server preset
 * (config.voltageColors, from the yaml's voltage_colors) with the same
 * color, compared case-insensitively. A class the user already renamed is
 * never touched. Returns the same diagram reference when nothing matched,
 * so a caller can tell whether anything changed (the same convention
 * ensureLastId uses). */
export function applyPresetVoltageNames(diagram: Diagram, config: EditorConfig | null): Diagram {
  const presets = config?.voltageColors ?? []
  if (presets.length === 0) return diagram
  let changed = false
  const voltageClasses = diagram.voltageClasses.map(vc => {
    const color = vc.color.trim().toLowerCase()
    const name = vc.name.trim().toLowerCase()
    if (name !== '' && name !== color) return vc
    const preset = presets.find(p => p.color.trim().toLowerCase() === color)
    if (!preset || preset.name === vc.name) return vc
    changed = true
    return { ...vc, name: preset.name }
  })
  return changed ? { ...diagram, voltageClasses } : diagram
}

// BASE_LAYER mirrors internal/slddoc's BaseLayer: the always-present layer
// every object falls back to, which can't be deleted.
export const BASE_LAYER = 0

/** Adds a new, empty visibility layer, its id taken from the diagram's own
 * shared IdSequence. */
export function addLayer(diagram: Diagram, name: string): Diagram {
  const ids = new IdSequence(diagram)
  const layer: Layer = { id: ids.take(), name }
  return { ...diagram, lastId: ids.lastId, layers: [...diagram.layers, layer] }
}

export function updateLayer(diagram: Diagram, id: number, patch: Partial<Layer>): Diagram {
  return { ...diagram, layers: diagram.layers.map(l => (l.id === id ? { ...l, ...patch } : l)) }
}

/** Removes a layer (never BASE_LAYER), moving every element/connector/
 * label/digital device still on it back to BASE_LAYER, so nothing is left
 * referencing a layer that no longer exists — unlike removeVoltageClass,
 * which leaves its references dangling, since every object must always
 * carry exactly one resolvable layer. */
export function removeLayer(diagram: Diagram, id: number): Diagram {
  if (id === BASE_LAYER) return diagram
  const move = <T extends { layer: number }>(items: T[]): T[] =>
    items.some(x => x.layer === id) ? items.map(x => (x.layer === id ? { ...x, layer: BASE_LAYER } : x)) : items
  return {
    ...diagram,
    layers: diagram.layers.filter(l => l.id !== id),
    elements: move(diagram.elements),
    connectors: move(diagram.connectors),
    labels: move(diagram.labels),
    digitalDevices: move(diagram.digitalDevices),
  }
}

// layerUsage counts, per Layer id, how many elements/connectors/labels/
// digital devices sit on it — an inspection helper like voltageUsage.
export function layerUsage(diagram: Diagram): Map<number, number> {
  const counts = new Map<number, number>()
  const add = (layer: number) => counts.set(layer, (counts.get(layer) ?? 0) + 1)
  for (const x of diagram.elements) add(x.layer)
  for (const x of diagram.connectors) add(x.layer)
  for (const x of diagram.labels) add(x.layer)
  for (const x of diagram.digitalDevices) add(x.layer)
  return counts
}
