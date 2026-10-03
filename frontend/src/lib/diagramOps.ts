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
import { t } from '../i18n'
import { circularArcThrough, defaultArcBulge } from './arc'
import { nearestPointOnSegment } from './geometry'

// Element classes whose own geometry is a drawn Points array (two or more
// vertices) rather than a single x/y anchor+orient — BusBarSection (a real
// electrical busbar), Rectangle, Circle, Arrow, Button, Road, Line, and
// Table (the latter seven purely decorative annotations, no electrical
// meaning at all — never a routing target). Shared by every
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
  'SmallWindow',
  'Picture',
  'Circle',
  'Arrow',
  'Button',
  'WindowIcon',
  'AutomationDevice',
  'Road',
  'Line',
  'Polygon',
  'Container',
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

  return ensureUniqueIds(d)
}

/** Repairs a diagram whose items share an id (older .svg imports numbered
 * their nodes and voltage classes 1..N, colliding with the source's own
 * ids, and the source writes a Powerflow arrow and its reading under one
 * id): elements, then connectors, digital devices and labels keep the
 * first use of an id, later ones get a fresh id; a colliding node or
 * voltage class is renumbered with every reference to it. Layer ids are
 * never reused. Returns diagram itself when every id is already unique. */
export function ensureUniqueIds(diagram: Diagram): Diagram {
  const used = new Set<number>(diagram.layers.map(l => l.id))
  const collides = (id: number) => id === 0 || used.has(id)
  let dirty = false
  const ids = new IdSequence(diagram)
  const take = () => {
    let id = ids.take()
    while (used.has(id)) id = ids.take()
    used.add(id)
    dirty = true
    return id
  }
  const keep = <T extends { id: number }>(items: T[]): T[] =>
    items.map(x => {
      if (collides(x.id)) return { ...x, id: take() }
      used.add(x.id)
      return x
    })
  const elements = keep(diagram.elements)
  const connectors = keep(diagram.connectors)
  const digitalDevices = keep(diagram.digitalDevices)
  const labels = keep(diagram.labels)

  const nodeId = new Map<number, number>()
  const nodes = diagram.nodes.map(n => {
    if (!collides(n.id)) {
      used.add(n.id)
      return n
    }
    const id = take()
    nodeId.set(n.id, id)
    return { ...n, id }
  })
  const classId = new Map<number, number>()
  const voltageClasses = diagram.voltageClasses.map(vc => {
    if (!collides(vc.id)) {
      used.add(vc.id)
      return vc
    }
    const id = take()
    classId.set(vc.id, id)
    return { ...vc, id }
  })
  if (!dirty) return diagram

  const node = (id: number) => nodeId.get(id) ?? id
  const volt = (v: number | undefined) => (v === undefined ? v : (classId.get(v) ?? v))
  return {
    ...diagram,
    lastId: ids.lastId,
    nodes,
    voltageClasses,
    elements: elements.map(e => ({
      ...e,
      voltage: volt(e.voltage),
      ports: e.ports?.map(p => ({ ...p, node: node(p.node) })),
      windings: e.windings?.map(w => ({ ...w, voltage: volt(w.voltage) })),
      sectors: e.sectors?.map(sc => ({ ...sc, voltage: volt(sc.voltage) })),
    })),
    connectors: connectors.map(c => ({ ...c, from: node(c.from), to: node(c.to), voltage: volt(c.voltage) })),
    digitalDevices,
    labels,
    editor: diagram.editor && { ...diagram.editor, defaultVoltage: volt(diagram.editor.defaultVoltage) },
  }
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
  // An item moved to another layer may now belong in another layer group
  // of the document (Layer.z), which a patch in place can't do.
  if (layerChanged(previous, next, targets)) return { kind: 'full' }
  return { kind: 'patch', targets }
}

// Whether any of targets now sits on a different layer than before.
function layerChanged(previous: Diagram, next: Diagram, targets: { id: number; kind: DataEditorKind }[]): boolean {
  const layers = (d: Diagram) => {
    const m = new Map<number, number>()
    for (const list of [d.elements, d.connectors, d.labels, d.digitalDevices]) for (const x of list) m.set(x.id, x.layer)
    return m
  }
  const before = layers(previous)
  const after = layers(next)
  return targets.some(({ id }) => before.get(id) !== after.get(id))
}

/** The layer newly placed items go on: the diagram's active layer
 * (editor.activeLayer) while it still exists, else the first layer. */
export function defaultLayer(diagram: Diagram): number {
  const active = diagram.editor?.activeLayer
  if (active !== undefined && diagram.layers.some(l => l.id === active)) return active
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
// A Breaker/Disconnector/DisconnectorFuse/Sectionalizer/PowerCircuitBreaker/LoadBreakSwitch (either the fixed or
// withdrawable shape — both share the same Class) starts out placed in
// service, not open, so a freshly drawn one-line reads correctly without a
// separate trip to Properties for every single device: 1 is "Close" in the
// state->color legend (config.stateColors). GroundSwitch/ShortCircuiter
// get their own default below instead, since leaving it unset now has a
// different visual consequence (see GROUND_TYPE_DEFAULT_STATE's own
// comment).
const DEFAULT_CLOSED_CLASSES = new Set<ElementClass>(['Breaker', 'Disconnector', 'DisconnectorFuse', 'Sectionalizer', 'PowerCircuitBreaker', 'LoadBreakSwitch'])
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
const WITHDRAWABLE_SHAPES = new Set(['43', '49', '50', '154', '51'])
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

// A freshly placed Lamp on pole (320002) is gray, its real corpus color
// and render.go's own unset-Stroke fallback.
const LAMP_ON_POLE_DEFAULTS: Pick<DiagramElement, 'stroke'> = { stroke: '#808080' }

// A freshly placed Connector (10) is magenta, every real instance's color
// and render.go's own unset-Stroke fallback.
const CONNECTOR_POINT_DEFAULTS: Pick<DiagramElement, 'stroke'> = { stroke: '#ff00ff' }

// A freshly placed Connector arrow (83) gets the real corpus look: a coral
// line with a white, dim-gray-outlined arrowhead, render.go's own unset
// fallbacks, pointing right at the default length.
const CONNECTOR_ARROW_DEFAULTS: Pick<DiagramElement, 'stroke' | 'headStroke' | 'fill'> = {
  stroke: '#ff7f50',
  headStroke: '#696969',
  fill: '#ffffff',
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

// Element classes that never carry a voltage class of their own, so are
// never seeded with defaultVoltage: the click-to-placed indicators/
// decorations placeElement skips (see its own comment), plus every
// decorative Points-based class (drawn by their own place* functions,
// none of which seeds a voltage either). BusBarSection is the one
// Points-based class that does carry one.
const NO_VOLTAGE_CLASSES: ReadonlySet<ElementClass> = new Set<ElementClass>([
  'Lamp',
  'LampOnPole',
  'ConnectorArrow',
  'ConnectorPoint',
  'FaultPassageIndicator',
  'PostPole',
  'PowerflowIndicator',
  'Table2',
  ...[...POINTS_BASED_CLASSES].filter(c => c !== 'BusBarSection'),
])

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
    ...(NO_VOLTAGE_CLASSES.has(elementClass) ? {} : { voltage: defaultVoltage }),
    x: point.x,
    y: point.y,
    ...(DEFAULT_CLOSED_CLASSES.has(elementClass) ? { state: STATE_CLOSE } : {}),
    ...(elementClass === 'Lamp' ? LAMP_DEFAULTS : {}),
    ...(elementClass === 'PostPole' ? POLE_DEFAULTS : {}),
    ...(elementClass === 'LampOnPole' ? LAMP_ON_POLE_DEFAULTS : {}),
    ...(elementClass === 'ConnectorArrow' ? CONNECTOR_ARROW_DEFAULTS : {}),
    ...(elementClass === 'ConnectorPoint' ? CONNECTOR_POINT_DEFAULTS : {}),
    ...(elementClass === 'PowerflowIndicator' ? POWERFLOW_INDICATOR_DEFAULTS : {}),
    ...(elementClass === 'GroundSwitch' || elementClass === 'ShortCircuiter'
      ? { orient: GROUND_TYPE_DEFAULT_ORIENT, state: GROUND_TYPE_DEFAULT_STATE }
      : {}),
    // A short-circuiter without ground is normally Open too (422 of 425
    // real corpus instances), but keeps its own upright default orient.
    ...(elementClass === 'ShortCircuiterNoGround' ? { state: GROUND_TYPE_DEFAULT_STATE } : {}),
    ...(WITHDRAWABLE_SHAPES.has(symbol.shape) ? { position: POSITION_NORMAL } : {}),
    ...(elementClass === 'FaultPassageIndicator' ? fpiDefaults(defaultFpiText) : {}),
    ...(elementClass === 'PowerTransformer' ? powerTransformerDefaults(defaultVoltage) : {}),
    ...(elementClass === 'Table2' ? table2Defaults() : {}),
    // One sector, filled with the same default voltage as its outline.
    ...(elementClass === 'Substation' ? { sectors: [{ voltage: defaultVoltage }] } : {}),
  }
  // Every fixed Port exists from the start (see fitElementPorts), joined to
  // whatever wire or node the new element was dropped exactly onto.
  return fitElementPorts({ ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }, id, [symbol])
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
  // A busbar drawn over existing wire ends or terminals connects to them.
  return joinBusbar({ ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }, id)
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
 * routing target. Drawn from its own Points the same
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
 * routing target. Drawn from its own Points the same
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

// A freshly drawn Small window's own colors: unfilled with the light-blue
// border real corpus mostly uses; the border is always 1px (writeSmallWindow).
const SMALL_WINDOW_DEFAULTS = { fill: 'none', stroke: '#00a0f0' }

/** Places a new Small window (shape 319) spanning start..end: Rectangle's
 * same decorative box (see slddoc's ClassSmallWindow), no Voltage, no
 * Ports, never a routing target. */
export function placeSmallWindow(diagram: Diagram, start: Point, end: Point): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'SmallWindow',
    shape: '319',
    name: `Small window-${id}`,
    layer: defaultLayer(diagram),
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    points: [start, end],
    ...SMALL_WINDOW_DEFAULTS,
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

/** Places a new Picture (shape 11, Backdrop/image file) spanning
 * start..end: a decorative two-corner frame (see slddoc's ClassPicture),
 * no Voltage, no Ports, never a routing target. It starts with no image
 * (drawn as a dashed placeholder); setPictureHref gives it one. It goes
 * first in the element list, so it draws beneath everything else (a
 * backdrop), since an opaque picture on top would hide the equipment. */
export function placePicture(diagram: Diagram, start: Point, end: Point): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'Picture',
    shape: '11',
    name: `Picture-${id}`,
    layer: defaultLayer(diagram),
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    points: [start, end],
  }
  return { ...diagram, lastId: ids.lastId, elements: [element, ...diagram.elements] }
}

/** Sets the image (a data URI) of Picture id. */
export function setPictureHref(diagram: Diagram, id: number, href: string): Diagram {
  return {
    ...diagram,
    elements: diagram.elements.map(el => (el.id === id && el.class === 'Picture' ? { ...el, href } : el)),
  }
}

// A freshly placed Automation device starts Off: a gray tile when Off, green
// when On, white text in both, the source's black 1px border.
const AUTOMATION_DEVICE_DEFAULTS = {
  state: 0,
  fillOff: '#808080',
  fillOn: '#00aa00',
  textColor: '#ffffff',
  textColorOn: '#ffffff',
  stroke: '#000000',
}

/** Places a new Automation device (shape 103) spanning start..end: a
 * decorative two-state status tile (see slddoc's ClassAutomationDevice), no
 * Voltage, no Ports, never a routing target. */
export function placeAutomationDevice(diagram: Diagram, start: Point, end: Point): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'AutomationDevice',
    shape: '103',
    name: `Automation-${id}`,
    layer: defaultLayer(diagram),
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    points: [start, end],
    ...AUTOMATION_DEVICE_DEFAULTS,
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

// A freshly placed Window icon's own colors — the real corpus look (an
// orange tile with a black border and black text), with render.go's own
// fixed 1px border.
const WINDOW_ICON_DEFAULTS = { fill: 'orange', stroke: '#000000', textColor: '#000000', bold: false }

/** Places a new Window icon (shape 302) spanning start..end: Button's
 * smaller sibling (see slddoc's ClassWindowIcon), decorative, no Voltage,
 * no Ports, never a routing target. */
export function placeWindowIcon(diagram: Diagram, start: Point, end: Point): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'WindowIcon',
    shape: '302',
    name: `Window-${id}`,
    layer: defaultLayer(diagram),
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    points: [start, end],
    propertyText: t('elementCatalog.defaultText.302'),
    ...WINDOW_ICON_DEFAULTS,
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
 * routing target. Drawn from its own Points the same
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
 * routing target. Drawn from its own Points the same
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
 * comment): no Voltage, no Ports, never a valid routing
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
 * Voltage, no Ports, never a valid routing target. Canvas
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

// A freshly drawn Container's own defaults: the real corpus look (a dim
// gray dotted outline, no fill) with a visible white 14px caption above it.
const CONTAINER_DEFAULTS = { fill: 'none', stroke: '#696969', strokeWidth: 1, lineStyle: 'dotted' as const, textColor: '#ffffff', textSize: 14 }

/** The caption placements Properties offers for a Container (shape 310):
 * the ones real corpus uses, computed the way xsde2svg's element_310.go
 * does from the outline's bounding box with its 5-unit gap. */
export const CONTAINER_CAPTION_PRESETS = [
  'aboveCenter',
  'aboveLeft',
  'aboveRight',
  'belowCenter',
  'belowLeft',
  'belowRight',
  'left',
  'right',
  'center',
] as const
export type ContainerCaptionPreset = (typeof CONTAINER_CAPTION_PRESETS)[number]

const CONTAINER_CAPTION_GAP = 5

/** A Container caption's textDx/textDy/textAnchor/textBaseline for preset,
 * relative to the outline's top-left, for the given vertices. */
export function containerCaptionPlacement(
  points: Point[],
  preset: ContainerCaptionPreset,
): Pick<DiagramElement, 'textDx' | 'textDy' | 'textAnchor' | 'textBaseline'> {
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  const g = CONTAINER_CAPTION_GAP
  switch (preset) {
    case 'aboveCenter':
      return { textDx: w / 2, textDy: -g, textAnchor: 'middle', textBaseline: 'baseline' }
    case 'aboveLeft':
      return { textDx: 0, textDy: -g, textAnchor: 'start', textBaseline: 'baseline' }
    case 'aboveRight':
      return { textDx: w, textDy: -g, textAnchor: 'end', textBaseline: 'baseline' }
    case 'belowCenter':
      return { textDx: w / 2, textDy: h, textAnchor: 'middle', textBaseline: 'text-before-edge' }
    case 'belowLeft':
      return { textDx: 0, textDy: h, textAnchor: 'start', textBaseline: 'text-before-edge' }
    case 'belowRight':
      return { textDx: w, textDy: h, textAnchor: 'end', textBaseline: 'text-before-edge' }
    case 'left':
      return { textDx: -g, textDy: h / 2, textAnchor: 'end', textBaseline: 'middle' }
    case 'right':
      return { textDx: w + g, textDy: h / 2, textAnchor: 'start', textBaseline: 'middle' }
    case 'center':
      return { textDx: w / 2, textDy: h / 2, textAnchor: 'middle', textBaseline: 'middle' }
  }
}

/** Which preset el's caption currently matches, or null for a custom
 * placement (e.g. an imported one). */
export function containerCaptionPresetOf(el: DiagramElement): ContainerCaptionPreset | null {
  if (!el.points || el.points.length === 0) return null
  for (const preset of CONTAINER_CAPTION_PRESETS) {
    const p = containerCaptionPlacement(el.points, preset)
    if (
      (el.textDx ?? 0) === p.textDx &&
      (el.textDy ?? 0) === p.textDy &&
      (el.textAnchor || 'middle') === p.textAnchor &&
      (el.textBaseline || 'middle') === p.textBaseline
    ) {
      return preset
    }
  }
  return null
}

/** Places a new Container through points (at least 3, closed implicitly):
 * a decorative outline around a group of equipment with a caption (see
 * slddoc's ClassContainer), no Voltage, no Ports, never a routing target.
 * Drawn pen-tool style like a Polygon. */
export function placeContainer(diagram: Diagram, points: Point[]): Diagram {
  if (points.length < 3) return diagram
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: 'Container',
    shape: '310',
    name: `Container-${id}`,
    layer: defaultLayer(diagram),
    x: (points[0].x + points[points.length - 1].x) / 2,
    y: (points[0].y + points[points.length - 1].y) / 2,
    points,
    propertyText: t('elementCatalog.defaultText.310'),
    ...CONTAINER_DEFAULTS,
    ...containerCaptionPlacement(points, 'aboveCenter'),
  }
  return { ...diagram, lastId: ids.lastId, elements: [...diagram.elements, element] }
}

// A freshly drawn Arc's own defaults: white, width 1 (the real source's
// own 0.25 is barely visible on a fresh drawing).
const ARC_DEFAULTS = { stroke: '#ffffff', strokeWidth: 1 }

/** Places a new Arc from start to end — a purely decorative arc, not real
 * electrical equipment (see slddoc's own ClassArc doc comment): no
 * Voltage, no Ports, never a valid routing target. It
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

// Every anchor a group of items is placed by: each element's/label's/
// digital device's own x/y, plus every connector point.
function groupAnchors(d: Pick<Diagram, 'elements' | 'labels' | 'digitalDevices' | 'connectors'>): Point[] {
  return [
    ...d.elements.map(e => ({ x: e.x, y: e.y })),
    ...d.labels.map(l => ({ x: l.x, y: l.y })),
    ...d.digitalDevices.map(dd => ({ x: dd.x, y: dd.y })),
    ...d.connectors.flatMap(c => c.points),
  ]
}

/** The point placeCustomElement lands on its target point: the average of
 * every anchor in d (groupAnchors), or null when d is empty. */
export function groupCentroid(d: Pick<Diagram, 'elements' | 'labels' | 'digitalDevices' | 'connectors'>): Point | null {
  const anchors = groupAnchors(d)
  if (anchors.length === 0) return null
  return {
    x: anchors.reduce((sum, p) => sum + p.x, 0) / anchors.length,
    y: anchors.reduce((sum, p) => sum + p.y, 0) / anchors.length,
  }
}

/** groupCentroid of a selection, in the diagram's own coordinates — so a
 * copy placed there with placeCustomElement lands exactly on top of the
 * original, and one placed at this point + (dx, dy) is the original moved
 * by (dx, dy). */
export function selectionCentroid(
  diagram: Diagram,
  selection: Map<number, 'element' | 'connector' | 'label' | 'digitaldevice'>,
): Point | null {
  const has = (id: number, kind: string) => selection.get(id) === kind
  return groupCentroid({
    elements: diagram.elements.filter(e => has(e.id, 'element')),
    connectors: diagram.connectors.filter(c => has(c.id, 'connector')),
    labels: diagram.labels.filter(l => has(l.id, 'label')),
    digitalDevices: diagram.digitalDevices.filter(dd => has(dd.id, 'digitaldevice')),
  })
}

/** Places a copy of a whole custom element (see CustomElement) — every
 * node, element, connector, label, and digital device of template — so
 * its centroid (the same anchor average pasteGroup uses) lands at point.
 * Unlike pasteGroup, the template's node topology is kept exactly: every
 * Node is copied once under a fresh id and every Port/Connector end still
 * points at the copy of the same Node, so two wires meeting at a shared
 * junction stay connected rather than coming out as two dangling ends.
 *
 * The whole group moves by one rigid offset, chosen so the first element's
 * (or, with none, the first anchor's) snapped position is exact — a
 * template drawn on-grid therefore lands on-grid without distorting it.
 * Every id is fresh (IdSequence), elements are renamed "<type>-<id>" like a
 * paste, and a named-line connector (overhead/cable) gets a fresh default
 * name. A voltage reference is kept when the target diagram has a voltage
 * class of the same name (case-insensitive), otherwise — including when
 * unset — it becomes defaultVoltage (never for a class in
 * NO_VOLTAGE_CLASSES). A layer is kept when the target has it, otherwise
 * it becomes the target's default layer (defaultLayer); with toActiveLayer
 * (a custom element from the palette, whose layers mean nothing here) every
 * item goes on the default layer. Label.for is remapped to the copied
 * element. Also what Paste uses, with the copied selection
 * (extractSelection) as the template. */
export function placeCustomElement(
  diagram: Diagram,
  template: Diagram,
  point: Point,
  symbols: ElementSymbol[],
  snap: (p: Point) => Point = p => p,
  defaultVoltage?: number,
  toActiveLayer = false,
): Diagram {
  const anchors = groupAnchors(template)
  const centroid = groupCentroid(template)
  if (!centroid) return diagram
  const ref = anchors[0]
  const snappedRef = snap({ x: ref.x + point.x - centroid.x, y: ref.y + point.y - centroid.y })
  const dx = snappedRef.x - ref.x
  const dy = snappedRef.y - ref.y
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy })

  const ids = new IdSequence(diagram)

  const templateVoltageNames = new Map(template.voltageClasses.map(v => [v.id, v.name.trim().toLowerCase()]))
  const targetVoltageByName = new Map(diagram.voltageClasses.map(v => [v.name.trim().toLowerCase(), v.id]))
  const mapVoltage = (v: number | undefined): number | undefined => {
    const name = v ? templateVoltageNames.get(v) : undefined
    return (name !== undefined ? targetVoltageByName.get(name) : undefined) ?? defaultVoltage
  }
  const targetLayers = new Set(diagram.layers.map(l => l.id))
  const mapLayer = (layer: number): number =>
    !toActiveLayer && targetLayers.has(layer) ? layer : defaultLayer(diagram)

  const newNodes: DiagramNode[] = []
  const nodeIds = new Map<number, number>()
  for (const n of template.nodes) {
    const id = ids.take()
    nodeIds.set(n.id, id)
    newNodes.push({ id, ...shift(n) })
  }
  // A reference to a Node the template doesn't actually define still gets a
  // real (fresh) Node, at the referencing end's own position.
  const mapNode = (old: number, at: Point): number => {
    const known = nodeIds.get(old)
    if (known !== undefined) return known
    const id = ids.take()
    nodeIds.set(old, id)
    newNodes.push({ id, ...at })
    return id
  }

  const elementIds = new Map<number, number>()
  const newElements: DiagramElement[] = template.elements.map(e => {
    const id = ids.take()
    elementIds.set(e.id, id)
    const at = shift(e)
    const baseName = (e.name ?? e.class).replace(/-\d+$/, '')
    const electrical = !NO_VOLTAGE_CLASSES.has(e.class)
    return {
      ...e,
      id,
      name: `${baseName}-${id}`,
      layer: mapLayer(e.layer),
      x: at.x,
      y: at.y,
      ...(e.points ? { points: e.points.map(shift) } : {}),
      ...(e.ports ? { ports: e.ports.map(p => ({ ...p, node: mapNode(p.node, at) })) } : {}),
      ...(electrical ? { voltage: mapVoltage(e.voltage) } : {}),
      ...(e.windings ? { windings: e.windings.map(w => ({ ...w, voltage: mapVoltage(w.voltage) })) } : {}),
    }
  })

  const newConnectors: Connector[] = template.connectors.map(c => {
    const id = ids.take()
    const points = c.points.map(shift)
    const start = points[0] ?? shift(ref)
    const end = points[points.length - 1] ?? start
    return {
      ...c,
      id,
      name: defaultConnectorName(c.kind, id) ?? c.name,
      layer: mapLayer(c.layer),
      voltage: mapVoltage(c.voltage),
      from: mapNode(c.from, start),
      to: mapNode(c.to, end),
      points,
    }
  })

  const newLabels: Label[] = template.labels.map(l => ({
    ...l,
    id: ids.take(),
    layer: mapLayer(l.layer),
    ...shift(l),
    for: l.for ? elementIds.get(l.for) : undefined,
  }))

  const newDigitalDevices: DigitalDevice[] = template.digitalDevices.map(dd => ({
    ...dd,
    id: ids.take(),
    layer: mapLayer(dd.layer),
    ...shift(dd),
  }))

  const placed: Diagram = {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...diagram.nodes, ...newNodes],
    elements: [...diagram.elements, ...newElements],
    connectors: [...diagram.connectors, ...newConnectors],
    labels: [...diagram.labels, ...newLabels],
    digitalDevices: [...diagram.digitalDevices, ...newDigitalDevices],
  }
  // The copy gets its shapes' full fixed Ports even when the template (an
  // older file) lacked some, and joins whatever it was dropped onto.
  let result = normalizeTopology(placed, symbols, new Set(newElements.map(e => e.id)))
  for (const e of newElements) result = joinPortNodes(result, e.id)
  return result
}

// How far a symbol's own drawing reaches beyond its anchor, for sizing an
// extracted custom element's page — a symbol has no measured extent here,
// and most base.xml shapes fit within about this radius.
const SYMBOL_EXTENT = 12

/** Turns a selection into a small standalone diagram for "Save selection
 * as custom element" — placeCustomElement's inverse. Only what's selected
 * is copied (an unselected wire touching a selected element is left out;
 * that element keeps its Port and Node, just with nothing attached), plus
 * exactly the Nodes, voltage classes and layers those reference, the base
 * layer always included. Label.for is kept only when its element is
 * selected too. Ids stay as they are — placeCustomElement gives every
 * entry a fresh one anyway. Everything is shifted by a whole number of grid
 * steps so the contents start one step in from the top-left, and the page
 * is cropped to fit; editor settings are copied from the source. Returns
 * null for an empty selection. */
export function extractSelection(
  diagram: Diagram,
  selection: Map<number, 'element' | 'connector' | 'label' | 'digitaldevice'>,
  gridSpacing: number,
): Diagram | null {
  const has = (id: number, kind: string) => selection.get(id) === kind
  const elements = diagram.elements.filter(e => has(e.id, 'element'))
  const connectors = diagram.connectors.filter(c => has(c.id, 'connector'))
  const labels = diagram.labels.filter(l => has(l.id, 'label'))
  const digitalDevices = diagram.digitalDevices.filter(dd => has(dd.id, 'digitaldevice'))
  if (elements.length + connectors.length + labels.length + digitalDevices.length === 0) return null

  const extent: Point[] = [
    ...elements.flatMap(e => [
      { x: e.x - SYMBOL_EXTENT, y: e.y - SYMBOL_EXTENT },
      { x: e.x + SYMBOL_EXTENT, y: e.y + SYMBOL_EXTENT },
      ...(e.points ?? []),
    ]),
    ...connectors.flatMap(c => c.points),
    ...labels.map(l => ({ x: l.x, y: l.y })),
    ...digitalDevices.map(dd => ({ x: dd.x, y: dd.y })),
  ]
  const g = gridSpacing > 0 ? gridSpacing : 10
  const minX = Math.min(...extent.map(p => p.x))
  const minY = Math.min(...extent.map(p => p.y))
  const dx = g - Math.floor(minX / g) * g
  const dy = g - Math.floor(minY / g) * g
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy })
  const width = Math.ceil((Math.max(...extent.map(p => p.x)) + dx + g) / g) * g
  const height = Math.ceil((Math.max(...extent.map(p => p.y)) + dy + g) / g) * g

  const nodeIds = new Set<number>([
    ...elements.flatMap(e => (e.ports ?? []).map(p => p.node)),
    ...connectors.flatMap(c => [c.from, c.to]),
  ])
  const voltageIds = new Set<number>(
    [
      ...elements.flatMap(e => [e.voltage, ...(e.windings ?? []).map(w => w.voltage)]),
      ...connectors.map(c => c.voltage),
    ].filter((v): v is number => !!v),
  )
  const layerIds = new Set<number>([
    BASE_LAYER,
    ...elements.map(e => e.layer),
    ...connectors.map(c => c.layer),
    ...labels.map(l => l.layer),
    ...digitalDevices.map(dd => dd.layer),
  ])
  const elementIds = new Set(elements.map(e => e.id))

  return {
    width,
    height,
    lastId: diagram.lastId,
    editor: diagram.editor,
    layers: diagram.layers.filter(l => layerIds.has(l.id)),
    voltageClasses: diagram.voltageClasses.filter(v => voltageIds.has(v.id)),
    nodes: diagram.nodes.filter(n => nodeIds.has(n.id)).map(n => ({ ...n, ...shift(n) })),
    elements: elements.map(e => ({
      ...e,
      ...shift(e),
      ...(e.points ? { points: e.points.map(shift) } : {}),
    })),
    connectors: connectors.map(c => ({ ...c, points: c.points.map(shift) })),
    labels: labels.map(l => ({
      ...l,
      ...shift(l),
      for: l.for !== undefined && elementIds.has(l.for) ? l.for : undefined,
    })),
    digitalDevices: digitalDevices.map(dd => ({ ...dd, ...shift(dd) })),
  }
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

    const end = fromMoved ? 'from' : 'to'
    const p = fromMoved ? connector.points[0] : connector.points[connector.points.length - 1]
    return { ...connector, points: rerouteConnectorEnd(connector.points, end, shift(p)) }
  })

  const nodes = moved.nodes.map(n => {
    if (!movedNodeIds.has(n.id)) return n
    for (const c of connectors) {
      if (c.from === n.id) return { ...n, x: c.points[0].x, y: c.points[0].y }
      if (c.to === n.id) return { ...n, x: c.points[c.points.length - 1].x, y: c.points[c.points.length - 1].y }
    }
    // A port node with no wire on it moves with its element all the same.
    return { ...n, ...shift(n) }
  })

  // A drop that squeezes a wire to zero length (a terminal dragged onto
  // that wire's far end) joins its two ends instead of leaving a one-point
  // wire behind, and a moved element's terminal that lands exactly on a
  // node or a wire joins it there — see removeDegenerateConnectors and
  // joinPortNodes.
  let result = removeDegenerateConnectors({ ...moved, connectors, nodes })
  for (const id of ids.elementIds) {
    const el = result.elements.find(e => e.id === id)
    result = el?.class === 'BusBarSection' ? joinBusbar(result, id) : joinPortNodes(result, id)
  }
  return joinNodesToBusbars(result, movedNodeIds)
}

/** Moves one end of a connector's own path to newPoint, keeping the segment
 * touching it orthogonal: a two-point wire gets a bend inserted, a longer
 * one has its neighboring vertex slid along the axis that preserves that
 * segment's orientation (moveConnectorVertex's projection-lock rule). */
function rerouteConnectorEnd(points: Point[], end: 'from' | 'to', newPoint: Point): Point[] {
  if (points.length < 2) return points
  if (end === 'from') {
    const old0 = points[0]
    const new0 = newPoint
    if (points.length === 2) {
      const other = points[1]
      const wasHorizontal = old0.y === other.y
      const bend = wasHorizontal ? { x: new0.x, y: other.y } : { x: other.x, y: new0.y }
      return simplifyOrthogonalPath([new0, bend, other])
    }
    const neighbor = points[1]
    const wasHorizontal = old0.y === neighbor.y
    const adjusted = wasHorizontal
      ? { ...neighbor, y: new0.y }
      : old0.x === neighbor.x
        ? { ...neighbor, x: new0.x }
        : neighbor
    return simplifyOrthogonalPath([new0, adjusted, ...points.slice(2)])
  }

  const oldLast = points[points.length - 1]
  const newLast = newPoint
  if (points.length === 2) {
    const other = points[0]
    const wasHorizontal = oldLast.y === other.y
    const bend = wasHorizontal ? { x: newLast.x, y: other.y } : { x: other.x, y: newLast.y }
    return simplifyOrthogonalPath([other, bend, newLast])
  }
  const neighbor = points[points.length - 2]
  const wasHorizontal = oldLast.y === neighbor.y
  const adjusted = wasHorizontal
    ? { ...neighbor, y: newLast.y }
    : oldLast.x === neighbor.x
      ? { ...neighbor, x: newLast.x }
      : neighbor
  return simplifyOrthogonalPath([...points.slice(0, -2), adjusted, newLast])
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
  return joinBusbar(reshapePoints(diagram, id, pointIndex, point), id)
}

function reshapePoints(diagram: Diagram, id: number, pointIndex: number, point: Point): Diagram {
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
 * transformerLocalTerminals). These are where an element's fixed Ports sit
 * (see fitElementPorts), and Canvas draws a marker at each one for the
 * current selection. */
/** One thing attached to a Node: an element's Port, or a connector's end. */
export type NodeAttachment =
  | { kind: 'element'; id: number; port: string }
  | { kind: 'connector'; id: number; end: 'from' | 'to' }

/** Everything attached to each Node, keyed by node id — the Properties
 * panel's Connections section lists it per port / wire end. */
export function nodeAttachments(diagram: Diagram): Map<number, NodeAttachment[]> {
  const byNode = new Map<number, NodeAttachment[]>()
  const add = (node: number, a: NodeAttachment) => {
    const list = byNode.get(node)
    if (list) list.push(a)
    else byNode.set(node, [a])
  }
  for (const el of diagram.elements) for (const p of el.ports ?? []) add(p.node, { kind: 'element', id: el.id, port: p.name })
  for (const c of diagram.connectors) {
    add(c.from, { kind: 'connector', id: c.id, end: 'from' })
    add(c.to, { kind: 'connector', id: c.id, end: 'to' })
  }
  return byNode
}

/** The ids of every node something is attached to besides a single port:
 * a connector end, or two or more element ports sharing it (a terminal
 * sitting straight on a busbar or another device). Canvas draws such a
 * node's terminal mark green, an unattached one red. */
export function connectedNodeIds(diagram: Diagram): Set<number> {
  const connected = new Set<number>()
  for (const c of diagram.connectors) {
    connected.add(c.from)
    connected.add(c.to)
  }
  const portCount = new Map<number, number>()
  for (const el of diagram.elements) {
    for (const p of el.ports ?? []) {
      const n = (portCount.get(p.node) ?? 0) + 1
      portCount.set(p.node, n)
      if (n >= 2) connected.add(p.node)
    }
  }
  connected.delete(0)
  return connected
}

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
  const step = symbol.scalable ? (el.scale ?? 0) : 0
  const half = symbol.leads && el.span ? el.span / 2 : 0
  return symbol.terminals.map(t => {
    const x = scaledLength(t.x * scale, step)
    let y = scaledLength(t.y * scale, step)
    // A lead shape's leads reach ±span/2 (slddoc's LeadTerminal).
    if (half > Math.abs(y) && y !== 0) y = Math.sign(y) * half
    return placeLocalPoint(el, { x, y })
  })
}

/** The lead distances (xsde2svg's Distance) the Properties panel offers. */
export const LEAD_DISTANCES = [2, 3, 4]

/** xsde2svg's own lead unit (Xsde2svgScale): a Distance of 2 is 20 apart. */
export const XSDE_LEAD_UNIT = 10

/** A lead shape's terminal spacing for a Distance: the source's
 * Scale(step, distance·unit), unit being the grid step when snapping (so
 * the terminals stay on the grid) or XSDE_LEAD_UNIT. */
export function leadSpanFor(distance: number, unit: number, step: number): number {
  return scaledLength(distance * unit, step)
}

/** A lead shape's terminal-to-terminal distance at its size step when its
 * span is unset: the library's own spacing, scaled. */
export function defaultLeadSpan(el: DiagramElement, symbols: ElementSymbol[]): number {
  const symbol = symbols.find(s => s.shape === el.shape)
  const ys = (symbol?.terminals ?? []).map(t => t.y)
  if (ys.length < 2) return 0
  const step = symbol?.scalable ? (el.scale ?? 0) : 0
  return scaledLength(Math.max(...ys), step) - scaledLength(Math.min(...ys), step)
}

/** The size steps (DiagramElement.scale) offered in Properties and tried
 * on SVG import. */
export const SIZE_STEPS = [-2, -1, 0, 1, 2, 3, 4]

/** A size step's own scale factor, √2^step — slddoc's SizeFactor. */
export function sizeFactor(step: number): number {
  return Math.SQRT2 ** step
}

/** The factor el's template is drawn at (its size step, when its symbol
 * takes one), for mapping its rendered local geometry to the diagram. */
export function elementSizeFactor(el: DiagramElement, symbols: ElementSymbol[]): number {
  if (!el.scale) return 1
  return symbols.find(s => s.shape === el.shape)?.scalable ? sizeFactor(el.scale) : 1
}

// xsde2svg's Scale(step, v) = int(v·√2^step), truncated toward zero, with
// a nudge so an exact whole product isn't truncated one short by
// floating-point noise — slddoc's scaledLength.
function scaledLength(v: number, step: number): number {
  if (step === 0) return v
  const p = v * sizeFactor(step)
  return Math.trunc(p < 0 ? p - 1e-9 : p + 1e-9)
}

/** Sets each imported element's size step (scale) when its Port Nodes sit
 * where its terminals do at one step but not at the library size: an
 * xsde2svg diagram draws every element at its own step, and Extract reads
 * the real port positions but not the step. Only elements whose shape
 * takes a size step and has two or more terminals are considered (one
 * terminal on the anchor is the same at every step), except lead shapes
 * (ElementSymbol.leads), whose step Extract reads from the drawn body; a
 * port whose Node is shared with another element (one Node for a whole
 * busbar) is skipped. */
export function inferSizeSteps(diagram: Diagram, symbols: ElementSymbol[]): Diagram {
  const nodes = new Map(diagram.nodes.map(n => [n.id, n]))
  const portUse = new Map<number, number>()
  for (const e of diagram.elements) for (const p of e.ports ?? []) portUse.set(p.node, (portUse.get(p.node) ?? 0) + 1)
  let changed = false
  const elements = diagram.elements.map(el => {
    const symbol = symbols.find(s => s.shape === el.shape)
    if (!symbol?.scalable || !symbol.terminals || symbol.terminals.length < 2 || el.scale) return el
    // Extract already set a lead shape's step from its drawn body: its port
    // spacing is its per-instance lead length, not its size.
    if (symbol.leads) return el
    const points = (el.ports ?? [])
      .filter(p => portUse.get(p.node) === 1)
      .map(p => nodes.get(p.node))
      .filter((n): n is DiagramNode => !!n)
    if (points.length === 0) return el
    // The worst distance from a port to its nearest terminal at a step.
    const error = (step: number) => {
      const terminals = symbolTerminals({ ...el, scale: step }, symbols) ?? []
      return Math.max(...points.map(p => Math.min(...terminals.map(t => Math.hypot(t.x - p.x, t.y - p.y)))))
    }
    let best = 0
    let bestError = error(0)
    for (const step of SIZE_STEPS) {
      const e = error(step)
      if (e < bestError - 0.5) {
        best = step
        bestError = e
      }
    }
    if (best === 0 || bestError > SIZE_STEP_TOLERANCE) return el
    changed = true
    return { ...el, scale: best }
  })
  return changed ? { ...diagram, elements } : diagram
}

/** Joins each imported element Port that is still connected to nothing to
 * a wire or busbar passing within PORT_TAP_TOLERANCE of its side: the Port
 * Node moves onto that line and the wire is split there (joinPortNodes).
 * xsde2svg draws a T-tap by ending a device's lead a unit or two short of
 * (or past) the wire it meets — e.g. a ground switch's stub tip 2 units
 * beside a vertical wire — and Extract only snaps points to wire ends and
 * busbars. Wires already on one of the element's own Ports are left
 * alone, and so are overhead lines (never tapped mid-span) — except for a
 * grounding device (GROUNDING_CLASSES) within LINE_ENTRANCE_REACH of the
 * line's nearer end, its line grounding switch at the substation: there
 * the piece from that end to the tap becomes BusWork (tapLineEntrance). */
export function tapFreePortsOntoWires(diagram: Diagram): Diagram {
  const portUse = new Map<number, number>()
  for (const e of diagram.elements) for (const p of e.ports ?? []) portUse.set(p.node, (portUse.get(p.node) ?? 0) + 1)
  const wired = new Set(diagram.connectors.flatMap(c => [c.from, c.to]))
  let d = diagram
  for (const el of diagram.elements) {
    if (el.class === 'BusBarSection' || !el.ports) continue
    const own = new Set(el.ports.map(p => p.node))
    for (const port of el.ports) {
      if (portUse.get(port.node) !== 1 || wired.has(port.node)) continue
      const node = d.nodes.find(n => n.id === port.node)
      if (!node) continue
      let best: Point | null = null
      let bestDist = PORT_TAP_TOLERANCE
      let line: { id: number; segment: number } | null = null
      const consider = (pts: Point[], lineId?: number) => {
        for (let i = 0; i < pts.length - 1; i++) {
          const q = nearestPointOnSegment(pts[i], pts[i + 1], node)
          const dist = Math.hypot(q.x - node.x, q.y - node.y)
          // Not rounded: on a slightly slanted wire a rounded point would
          // fall off the line, and joinPortNodes splits only exactly on it.
          if (dist <= bestDist) {
            best = q
            bestDist = dist
            line = lineId === undefined ? null : { id: lineId, segment: i }
          }
        }
      }
      const grounding = GROUNDING_CLASSES.has(el.class)
      for (const c of d.connectors) {
        if (own.has(c.from) || own.has(c.to)) continue
        if (c.kind === 'OverheadLine') {
          if (grounding) consider(c.points, c.id)
          continue
        }
        consider(c.points)
      }
      for (const bus of d.elements) if (bus.class === 'BusBarSection' && bus.points) consider(bus.points)
      if (!best) continue
      // A port already exactly on the wire still needs the split.
      const at: Point = best
      const before = d
      if (!samePoint(at, node)) d = { ...d, nodes: d.nodes.map(n => (n.id === node.id ? { ...n, x: at.x, y: at.y } : n)) }
      const hit = line as { id: number; segment: number } | null
      if (hit) {
        const moved = d
        d = tapLineEntrance(d, hit.id, hit.segment, node.id, at)
        if (d === moved) d = before // too far along the line: leave the port as it was
      } else {
        d = joinPortNodes(d, el.id)
      }
    }
  }
  return d
}

// How far (diagram units) a free imported Port may sit from the wire it
// taps — Extract's own snapTolerance.
const PORT_TAP_TOLERANCE = 5

// Single-port grounding devices that may tap an overhead line at its
// substation end (tapFreePortsOntoWires).
const GROUNDING_CLASSES = new Set<string>(['GroundSwitch', 'Ground', 'ShortCircuiter'])

// How far along an overhead line (diagram units) from its nearer end a
// grounding device may tap it: the line entrance at the substation (154 of
// the corpus's 156 such switches sit within 50).
const LINE_ENTRANCE_REACH = 50

/** Joins node (a grounding device's Port Node, already moved to at, a point
 * on segment `segment` of overhead line lineId) to that line: the piece
 * from the line's nearer end to at becomes a BusWork wire of the same
 * voltage and layer, and the line, keeping its id and name, now starts (or
 * ends) at node. Electrically the device then sits on the line's
 * substation-end node, and the line stays one object. Returns diagram
 * itself when at is further than LINE_ENTRANCE_REACH from both ends; when
 * at is the end itself, node is merged into that end's Node instead. */
function tapLineEntrance(diagram: Diagram, lineId: number, segment: number, nodeId: number, at: Point): Diagram {
  const c = diagram.connectors.find(x => x.id === lineId)
  if (!c) return diagram
  const pts = c.points
  let total = 0
  let along = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
    if (i === segment) along = total + Math.hypot(at.x - pts[i].x, at.y - pts[i].y)
    total += len
  }
  const fromStart = along <= total - along
  const reach = fromStart ? along : total - along
  if (reach > LINE_ENTRANCE_REACH) return diagram
  const endNode = fromStart ? c.from : c.to
  if (reach < TOPOLOGY_EPSILON) return mergeNode(diagram, endNode, nodeId)

  const head = simplifyOrthogonalPath([...pts.slice(0, segment + 1), at])
  const tail = simplifyOrthogonalPath([at, ...pts.slice(segment + 1)])
  const ids = new IdSequence(diagram)
  const stubId = ids.take()
  const stub: Connector = {
    id: stubId,
    kind: 'BusWork',
    voltage: c.voltage,
    layer: c.layer,
    from: fromStart ? c.from : nodeId,
    to: fromStart ? nodeId : c.to,
    points: fromStart ? head : tail,
  }
  const rest: Connector = fromStart ? { ...c, from: nodeId, points: tail } : { ...c, to: nodeId, points: head }
  return {
    ...diagram,
    lastId: ids.lastId,
    connectors: [...diagram.connectors.map(x => (x.id === lineId ? rest : x)), stub],
  }
}

// How far (diagram units) an imported port may sit from its terminal at
// the inferred size step: base.xml moves some terminals a unit or two onto
// the grid (e.g. the Thyristor's anode lead), which scales along.
const SIZE_STEP_TOLERANCE = 6

// A Fork's (shape 26) own default arm length — slddoc's own forkArmLength.
export const FORK_ARM_LENGTH = 10


/** Electrically joins two elements with an explicit, possibly multi-segment
 * path (points.length >= 2 — points[0] the from-side endpoint, the last
 * entry the to-side one), the routing tool's element-to-element creator.
 * Each end attaches to that element's terminal Port Node nearest it
 * (attachElementEnd). The new connector's
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
  const acc = { elements: diagram.elements, nodes: diagram.nodes }
  const fromNodeId = attachElementEnd(acc, fromId, start, ids)
  const toNodeId = attachElementEnd(acc, toId, end, ids)
  const connectorId = ids.take()
  const connector: Connector = {
    id: connectorId,
    kind,
    name: defaultConnectorName(kind, connectorId),
    layer: from.layer,
    voltage: from.voltage ?? to.voltage ?? defaultVoltage,
    from: fromNodeId,
    to: toNodeId,
    points,
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: acc.nodes,
    elements: acc.elements,
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
  const acc = { elements: diagram.elements, nodes: diagram.nodes }
  const fromNodeId = attachElementEnd(acc, fromId, start, ids)

  const tapConnectorId = ids.take()
  const tapConnector: Connector = {
    id: tapConnectorId,
    kind,
    name: defaultConnectorName(kind, tapConnectorId),
    layer: from.layer,
    voltage: from.voltage ?? target.voltage ?? defaultVoltage,
    from: fromNodeId,
    to: splice.junctionNode.id,
    points,
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...acc.nodes, ...splice.nodes],
    elements: acc.elements,
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
  const acc = { elements: diagram.elements, nodes: diagram.nodes }
  const toNodeId = attachElementEnd(acc, toId, end, ids)

  const tapConnectorId = ids.take()
  const tapConnector: Connector = {
    id: tapConnectorId,
    kind,
    name: defaultConnectorName(kind, tapConnectorId),
    layer: to.layer,
    voltage: source.voltage ?? to.voltage ?? defaultVoltage,
    from: splice.junctionNode.id,
    to: toNodeId,
    points,
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...acc.nodes, ...splice.nodes],
    elements: acc.elements,
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
  const acc = { elements: diagram.elements, nodes: diagram.nodes }
  const fromNodeId = attachElementEnd(acc, fromId, start, ids)
  const toNode: DiagramNode = { id: ids.take(), x: end.x, y: end.y }
  const connectorId = ids.take()
  const connector: Connector = {
    id: connectorId,
    kind,
    name: defaultConnectorName(kind, connectorId),
    layer: from.layer,
    voltage: from.voltage ?? defaultVoltage,
    from: fromNodeId,
    to: toNode.id,
    points,
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...acc.nodes, toNode],
    elements: acc.elements,
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
  const acc = { elements: diagram.elements, nodes: diagram.nodes }
  const toNodeId = attachElementEnd(acc, toId, end, ids)
  const connectorId = ids.take()
  const connector: Connector = {
    id: connectorId,
    kind,
    name: defaultConnectorName(kind, connectorId),
    layer: to.layer,
    voltage: to.voltage ?? defaultVoltage,
    from: fromNode.id,
    to: toNodeId,
    points,
  }

  return {
    ...diagram,
    lastId: ids.lastId,
    nodes: [...acc.nodes, fromNode],
    elements: acc.elements,
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

/** Adds a text label (shape 5) showing element elementId's name, For that
 * element, at point: size 10, start-anchored, bottom-aligned (the default),
 * Arial, white, on the element's own layer — the Properties panel's "Add
 * name label" button, which places it to the element's right. Returns
 * diagram itself when the element has no name. */
export function placeNameLabel(diagram: Diagram, elementId: number, point: Point): Diagram {
  const el = diagram.elements.find(e => e.id === elementId)
  if (!el?.name) return diagram
  const ids = new IdSequence(diagram)
  const label: Label = {
    id: ids.take(),
    for: el.id,
    layer: el.layer,
    x: point.x,
    y: point.y,
    size: 10,
    anchor: 'start',
    font: 'Arial',
    color: 'white',
    text: el.name,
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
  const moved: Diagram = {
    ...diagram,
    connectors: diagram.connectors.map(c =>
      c.id === connectorId ? { ...c, points: simplifyOrthogonalPath(newPoints) } : c,
    ),
    nodes: diagram.nodes.map(n => (n.id === nodeId ? { ...n, x: point.x, y: point.y } : n)),
  }
  // A wire end dropped exactly on another Node (a device terminal's, or
  // another wire's end) joins it, keeping that Node; one dropped on a
  // busbar connects to it. Never onto this wire's own other end.
  const otherEnd = end === 'from' ? connector.to : connector.from
  const onto = diagram.nodes.find(n => n.id !== nodeId && n.id !== otherEnd && samePoint(n, point))
  if (onto) return mergeNode(moved, nodeId, onto.id)
  return joinNodesToBusbars(moved, new Set([nodeId]))
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
/** Moves the given items (a selection: id → kind) onto layer. */
export function setItemsLayer(diagram: Diagram, items: ReadonlyMap<number, string>, layer: number): Diagram {
  const move = <T extends { id: number; layer: number }>(list: T[], kind: string): T[] =>
    list.some(x => items.get(x.id) === kind && x.layer !== layer)
      ? list.map(x => (items.get(x.id) === kind && x.layer !== layer ? { ...x, layer } : x))
      : list
  return {
    ...diagram,
    elements: move(diagram.elements, 'element'),
    connectors: move(diagram.connectors, 'connector'),
    labels: move(diagram.labels, 'label'),
    digitalDevices: move(diagram.digitalDevices, 'digitaldevice'),
  }
}

export function removeLayer(diagram: Diagram, id: number): Diagram {
  if (id === BASE_LAYER) return diagram
  const move = <T extends { layer: number }>(items: T[]): T[] =>
    items.some(x => x.layer === id) ? items.map(x => (x.layer === id ? { ...x, layer: BASE_LAYER } : x)) : items
  const editor = diagram.editor?.activeLayer === id ? { ...diagram.editor, activeLayer: undefined } : diagram.editor
  return {
    ...diagram,
    editor,
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

// ---------------------------------------------------------------------------
// Fixed ports and node topology.
//
// An element whose shape declares terminals (symbolTerminals — base.xml's
// <terminals>, or a PowerTransformer's per-winding legs) always has exactly
// that many Ports, named "1".."N" in terminal order, each on its own Node at
// the terminal's real position — the same model slddoc's Extract produces
// for an imported diagram. Wiring never adds a Port to one: a wire end on a
// terminal uses that terminal's Node, so several wires on one terminal share
// it. A BusBarSection is the exception — it has no discrete terminals, and a
// tap anywhere along it still adds a Port of its own. An element whose shape
// isn't in the loaded catalog is never touched.
// ---------------------------------------------------------------------------

const TOPOLOGY_EPSILON = 1e-6
// How far an existing Port's Node may sit from a terminal and still count as
// that terminal's (absorbs rotation rounding in older diagrams).
const PORT_MATCH_TOLERANCE = 0.5

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < TOPOLOGY_EPSILON && Math.abs(a.y - b.y) < TOPOLOGY_EPSILON
}

function roundPoint(p: Point): Point {
  return { x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 }
}

function isOnSegment(p: Point, a: Point, b: Point): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return samePoint(p, a)
  const cross = (p.x - a.x) * dy - (p.y - a.y) * dx
  if (Math.abs(cross) > TOPOLOGY_EPSILON * Math.sqrt(len2)) return false
  const dot = (p.x - a.x) * dx + (p.y - a.y) * dy
  return dot >= -TOPOLOGY_EPSILON && dot <= len2 + TOPOLOGY_EPSILON
}

/** The terminal positions an element's fixed Ports must sit on, or null
 * when its Ports aren't fixed (a BusBarSection, a shape with no terminals,
 * or one missing from the catalog). */
function fixedTerminals(el: DiagramElement, symbols: ElementSymbol[]): Point[] | null {
  if (el.class === 'BusBarSection') return null
  const terminals = symbolTerminals(el, symbols)
  return terminals && terminals.length > 0 ? terminals.map(roundPoint) : null
}

/** Replaces every reference to Node drop with keep (Ports, connector ends)
 * and removes drop. */
function mergeNode(diagram: Diagram, drop: number, keep: number): Diagram {
  if (drop === keep) return diagram
  return {
    ...diagram,
    nodes: diagram.nodes.filter(n => n.id !== drop),
    elements: diagram.elements.map(e =>
      (e.ports ?? []).some(p => p.node === drop)
        ? { ...e, ports: e.ports!.map(p => (p.node === drop ? { ...p, node: keep } : p)) }
        : e,
    ),
    connectors: diagram.connectors.map(c =>
      c.from === drop || c.to === drop
        ? { ...c, from: c.from === drop ? keep : c.from, to: c.to === drop ? keep : c.to }
        : c,
    ),
  }
}

/** Removes every zero-length connector (fewer than two points, or all of
 * them the same point) and joins its two end Nodes into one, keeping
 * whichever an element's Port references — such a wire means its two ends
 * were meant to be one connection (e.g. a terminal dragged onto a wire's
 * far end), and a one-point wire has no segment for hit-testing to work
 * with. Returns diagram itself when there's none. */
export function removeDegenerateConnectors(diagram: Diagram): Diagram {
  const degenerate = diagram.connectors.filter(
    c => c.points.length < 2 || c.points.every(p => samePoint(p, c.points[0])),
  )
  if (degenerate.length === 0) return diagram
  let d: Diagram = { ...diagram, connectors: diagram.connectors.filter(c => !degenerate.includes(c)) }
  for (const c of degenerate) {
    const portNodes = new Set(d.elements.flatMap(e => (e.ports ?? []).map(p => p.node)))
    const keep = portNodes.has(c.from) || !portNodes.has(c.to) ? c.from : c.to
    d = mergeNode(d, keep === c.from ? c.to : c.from, keep)
  }
  const used = new Set([
    ...d.elements.flatMap(e => (e.ports ?? []).map(p => p.node)),
    ...d.connectors.flatMap(c => [c.from, c.to]),
  ])
  return { ...d, nodes: d.nodes.filter(n => used.has(n.id)) }
}

/** Joins each of an element's Port Nodes to whatever lies exactly at its
 * position: another Node there is merged into it, a wire whose line passes
 * through it (not at one of its ends, and not an OverheadLine, which can't
 * be tapped mid-span) is split there with this Node as the junction, and a
 * BusBarSection whose line passes through it gets a Port on it. Wires
 * already touching one of this element's own Ports are left alone, so a
 * wire drawn past its own other terminal doesn't short it. */
export function joinPortNodes(diagram: Diagram, elementId: number): Diagram {
  const el = diagram.elements.find(e => e.id === elementId)
  if (!el || !el.ports || el.ports.length === 0) return diagram
  const ownNodes = new Set(el.ports.map(p => p.node))
  let d = diagram
  let ids: IdSequence | null = null

  for (const port of el.ports) {
    const node = d.nodes.find(n => n.id === port.node)
    if (!node) continue

    for (const other of d.nodes.filter(n => !ownNodes.has(n.id) && samePoint(n, node))) {
      d = mergeNode(d, other.id, node.id)
    }

    const split: Connector[] = []
    const touched = new Set<number>()
    for (const c of d.connectors) {
      if (ownNodes.has(c.from) || ownNodes.has(c.to) || c.kind === 'OverheadLine' || c.points.length < 2) continue
      if (samePoint(c.points[0], node) || samePoint(c.points[c.points.length - 1], node)) continue
      const k = c.points.findIndex((a, i) => i < c.points.length - 1 && isOnSegment(node, a, c.points[i + 1]))
      if (k < 0) continue
      ids ??= new IdSequence(d)
      const at = { x: node.x, y: node.y }
      const before = simplifyOrthogonalPath([...c.points.slice(0, k + 1), at])
      const after = simplifyOrthogonalPath([at, ...c.points.slice(k + 1)])
      const isDegenerate = (pts: Point[]) => pts.length < 2 || pts.every(q => samePoint(q, pts[0]))
      if (isDegenerate(before) || isDegenerate(after)) continue
      const secondId = ids.take()
      split.push(
        { ...c, to: node.id, points: before },
        { ...c, id: secondId, name: defaultConnectorName(c.kind, secondId) ?? c.name, from: node.id, points: after },
      )
      touched.add(c.id)
    }
    if (touched.size > 0) d = { ...d, connectors: [...d.connectors.filter(c => !touched.has(c.id)), ...split] }

    const tappedBuses = d.elements.filter(
      bus =>
        bus.id !== elementId &&
        bus.class === 'BusBarSection' &&
        bus.points &&
        bus.points.length >= 2 &&
        !(bus.ports ?? []).some(p => p.node === node.id) &&
        bus.points.some((a, i) => i < bus.points!.length - 1 && isOnSegment(node, a, bus.points![i + 1])),
    )
    if (tappedBuses.length > 0) {
      const tapped = new Set(tappedBuses.map(b => b.id))
      d = {
        ...d,
        elements: d.elements.map(bus =>
          tapped.has(bus.id) ? { ...bus, ports: [...(bus.ports ?? []), { name: nextPortName(bus), node: node.id }] } : bus,
        ),
      }
    }
  }
  return ids ? { ...d, lastId: ids.lastId } : d
}

/** Gives an element exactly its shape's fixed Ports (see this section's
 * header), each on a Node at its terminal. An existing Port whose Node sits
 * at a terminal keeps it; duplicates on the same terminal are merged into
 * one Node (their wires now share it); a leftover Port goes to the nearest
 * still-free terminal; any Port beyond that is dropped, its wires left
 * unconnected; a terminal with no Port gets a fresh Node, joined to
 * whatever lies exactly there (joinPortNodes).
 *
 * With moveNodes (an edit that really moved the element's terminals —
 * orientation, mirror, position, size), each kept Node is moved onto its
 * terminal, the wire ends on it following. Without it (repairing a diagram
 * on open), existing Nodes and wires are never moved: an imported diagram
 * can legitimately keep a Port on a Node away from its terminal, such as
 * one Node standing for a whole busbar that every device on it shares. A
 * Node another element's Port also uses is never moved either way.
 * Returns diagram itself when nothing changed. */
export function fitElementPorts(
  diagram: Diagram,
  elementId: number,
  symbols: ElementSymbol[],
  moveNodes = false,
  nodeIndex?: Map<number, DiagramNode>,
  element?: DiagramElement,
): Diagram {
  const el = element ?? diagram.elements.find(e => e.id === elementId)
  if (!el) return diagram
  if (el.class === 'BusBarSection') return joinBusbar(diagram, elementId)
  const terminals = fixedTerminals(el, symbols)
  if (!terminals) return diagram

  const nodeById = nodeIndex ?? new Map(diagram.nodes.map(n => [n.id, n]))
  const slots: number[][] = terminals.map(() => [])
  const leftover: number[] = []
  for (const port of el.ports ?? []) {
    const node = nodeById.get(port.node)
    if (!node) continue
    const i = terminals.findIndex(t => Math.hypot(t.x - node.x, t.y - node.y) <= PORT_MATCH_TOLERANCE)
    if (i >= 0) {
      if (!slots[i].includes(port.node)) slots[i].push(port.node)
    } else if (!leftover.includes(port.node)) leftover.push(port.node)
  }
  // Each free terminal takes its closest leftover Port (closest pairs
  // first). A leftover still unplaced then joins its nearest terminal when
  // it's unambiguously that one's — within half the gap between terminals —
  // so a stray second Port on the same terminal (an older diagram, or an
  // import drawn a few units off) keeps its wire; anything farther (e.g. a
  // winding a transformer no longer has) is dropped.
  const dist = (nodeId: number, i: number) => {
    const node = nodeById.get(nodeId)!
    return Math.hypot(terminals[i].x - node.x, terminals[i].y - node.y)
  }
  const pairs = leftover.flatMap(nodeId => terminals.map((_, i) => ({ nodeId, i, d: dist(nodeId, i) })))
  pairs.sort((a, b) => a.d - b.d)
  const placed = new Set<number>()
  const taken = new Set(slots.flatMap((nodes, i) => (nodes.length > 0 ? [i] : [])))
  for (const { nodeId, i } of pairs) {
    if (placed.has(nodeId) || taken.has(i)) continue
    slots[i].push(nodeId)
    placed.add(nodeId)
    taken.add(i)
  }
  let minGap = Infinity
  for (let i = 0; i < terminals.length; i++) {
    for (let j = i + 1; j < terminals.length; j++) {
      minGap = Math.min(minGap, Math.hypot(terminals[i].x - terminals[j].x, terminals[i].y - terminals[j].y))
    }
  }
  for (const nodeId of leftover) {
    if (placed.has(nodeId)) continue
    let best = 0
    for (let i = 1; i < terminals.length; i++) if (dist(nodeId, i) < dist(nodeId, best)) best = i
    if (dist(nodeId, best) <= minGap / 2) slots[best].push(nodeId)
  }

  let d = diagram
  const ids = new IdSequence(d)
  const newNodes: DiagramNode[] = []
  const portNodes = slots.map((nodes, i) => {
    if (nodes.length === 0) {
      const node = { id: ids.take(), ...terminals[i] }
      newNodes.push(node)
      return node.id
    }
    const [keep, ...rest] = nodes
    for (const drop of rest) d = mergeNode(d, drop, keep)
    return keep
  })

  // Move each kept Node (and the wire ends on it) onto its terminal.
  const target = new Map<number, Point>()
  if (moveNodes) {
    const sharedNodes = new Set(
      d.elements.filter(e => e.id !== elementId).flatMap(e => (e.ports ?? []).map(p => p.node)),
    )
    portNodes.forEach((nodeId, i) => {
      const node = d.nodes.find(n => n.id === nodeId)
      if (node && !sharedNodes.has(nodeId) && !samePoint(node, terminals[i])) target.set(nodeId, terminals[i])
    })
  }
  if (target.size > 0) {
    d = {
      ...d,
      nodes: d.nodes.map(n => (target.has(n.id) ? { ...n, ...target.get(n.id)! } : n)),
      connectors: d.connectors.map(c => {
        const from = target.get(c.from)
        const to = target.get(c.to)
        if (!from && !to) return c
        let points = c.points
        if (from && points.length > 0) points = rerouteConnectorEnd(points, 'from', from)
        if (to && points.length > 0) points = rerouteConnectorEnd(points, 'to', to)
        return { ...c, points }
      }),
    }
  }
  if (newNodes.length > 0) d = { ...d, nodes: [...d.nodes, ...newNodes], lastId: ids.lastId }

  const ports = portNodes.map((node, i) => ({ name: String(i + 1), node }))
  const samePorts =
    (el.ports ?? []).length === ports.length &&
    ports.every((p, i) => el.ports![i].name === p.name && el.ports![i].node === p.node)
  if (!samePorts) d = { ...d, elements: d.elements.map(e => (e.id === elementId ? { ...e, ports } : e)) }
  // Joining only ever concerns a Node that is really on its terminal — a
  // fresh one, or one moved there; never an imported off-terminal Node.
  return newNodes.length > 0 || target.size > 0 ? joinPortNodes(d, elementId) : d
}

/** Repairs a whole diagram's topology — removeDegenerateConnectors, then
 * fitElementPorts (with join) for every element, or only those in onlyIds.
 * Run on open/import and whenever a copied group lands (paste, custom
 * element). Returns diagram itself when nothing needed fixing, so callers
 * can tell whether to mark it dirty. */
export function normalizeTopology(diagram: Diagram, symbols: ElementSymbol[], onlyIds?: Set<number>): Diagram {
  if (symbols.length === 0) return diagram
  let d = removeDegenerateConnectors(diagram)
  // One shared node index (rebuilt only after a fit actually changed
  // something) keeps this linear on a large diagram rather than
  // re-indexing every node for every element.
  let index = new Map(d.nodes.map(n => [n.id, n]))
  const elementsById = new Map(d.elements.map(e => [e.id, e]))
  for (const el of diagram.elements) {
    if (onlyIds && !onlyIds.has(el.id)) continue
    const current = elementsById.get(el.id)
    if (!current) continue
    const next = fitElementPorts(d, el.id, symbols, false, index, current)
    if (next !== d) {
      d = next
      index = new Map(d.nodes.map(n => [n.id, n]))
      for (const e of d.elements) elementsById.set(e.id, e)
    }
  }
  return mergeNodesOntoPorts(removeDegenerateConnectors(d), onlyIds)
}

/** Merges every Node that isn't any element's Port but sits exactly on a
 * Port Node into that Port Node (a wire end left lying on a terminal
 * without being attached, e.g. by an older drag of a free wire end). No
 * Node moves and no wire is split, so an imported diagram stays as drawn.
 * With onlyIds, only those elements' Port Nodes collect. */
function mergeNodesOntoPorts(diagram: Diagram, onlyIds?: Set<number>): Diagram {
  const allPorts = new Set(diagram.elements.flatMap(e => (e.ports ?? []).map(p => p.node)))
  const collecting = onlyIds
    ? new Set(diagram.elements.filter(e => onlyIds.has(e.id)).flatMap(e => (e.ports ?? []).map(p => p.node)))
    : allPorts
  const byPoint = new Map<string, number>()
  for (const n of diagram.nodes) if (collecting.has(n.id)) byPoint.set(`${n.x},${n.y}`, n.id)
  let d = diagram
  for (const n of diagram.nodes) {
    if (allPorts.has(n.id)) continue
    const keep = byPoint.get(`${n.x},${n.y}`)
    if (keep === undefined) continue
    // Don't collapse a wire running from this terminal straight back onto it.
    if (d.connectors.some(c => (c.from === n.id && c.to === keep) || (c.to === n.id && c.from === keep))) continue
    d = mergeNode(d, n.id, keep)
  }
  return d
}

/** Whether an element's Ports are fixed and already in place (see this
 * section's header) — attachElementEnd then picks one of them rather than
 * adding a Port. */
function hasFixedPorts(el: DiagramElement): boolean {
  return el.class !== 'BusBarSection' && !!el.ports && el.ports.length > 0
}

/** The Node a new wire end at `at` attaches to on element elementId: for an
 * element with fixed Ports, the Port Node nearest `at` (no Port is ever
 * added); for a BusBarSection, or an element with no Ports at all (a shape
 * without terminals), a fresh Node at `at` plus a new Port, as before.
 * Mutates acc's elements/nodes in place of the caller's own copies. */
function attachElementEnd(
  acc: { elements: DiagramElement[]; nodes: DiagramNode[] },
  elementId: number,
  at: Point,
  ids: IdSequence,
): number {
  const el = acc.elements.find(e => e.id === elementId)
  if (el && el.ports && hasFixedPorts(el)) {
    let best = el.ports[0].node
    let bestDist = Infinity
    for (const p of el.ports) {
      const n = acc.nodes.find(x => x.id === p.node)
      if (!n) continue
      const dist = Math.hypot(n.x - at.x, n.y - at.y)
      if (dist < bestDist) {
        best = p.node
        bestDist = dist
      }
    }
    return best
  }
  const node: DiagramNode = { id: ids.take(), x: at.x, y: at.y }
  acc.nodes = [...acc.nodes, node]
  acc.elements = acc.elements.map(e =>
    e.id === elementId ? { ...e, ports: [...(e.ports ?? []), { name: nextPortName(e), node: node.id }] } : e,
  )
  return node.id
}

/** One end of a "Topology → Connect to…" join: an element at the terminal
 * (or busbar point) nearest point, or a connector at point on segment
 * segmentIndex — Canvas's own ConnectTarget. */
export type TopologyTarget =
  | { kind: 'element'; elementId: number; point: Point }
  | { kind: 'connector'; connectorId: number; segmentIndex: number; point: Point }

/** The Node target resolves to, adding what it needs: a device's terminal
 * Port Node, a new busbar Port at the point, or a connector's end Node (a
 * point mid-wire splits it there, spliceConnectorAt). */
function topologyTargetNode(
  diagram: Diagram,
  target: TopologyTarget,
  ids: IdSequence,
): { diagram: Diagram; node: number } | null {
  if (target.kind === 'element') {
    if (!diagram.elements.some(e => e.id === target.elementId)) return null
    const acc = { elements: diagram.elements, nodes: diagram.nodes }
    const node = attachElementEnd(acc, target.elementId, target.point, ids)
    return { diagram: { ...diagram, elements: acc.elements, nodes: acc.nodes }, node }
  }
  const splice = spliceConnectorAt(diagram, target.connectorId, target.segmentIndex, target.point, ids)
  if (!splice) return null
  return {
    diagram: {
      ...diagram,
      nodes: [...diagram.nodes, ...splice.nodes],
      connectors: [...diagram.connectors.filter(c => c.id !== target.connectorId), ...splice.connectors],
    },
    node: splice.junctionNode.id,
  }
}

/** "Topology → Connect to…": joins first to second without drawing
 * anything — first's Node is merged into second's, which keeps its
 * position (wires that ended on first's Node keep their drawn geometry).
 * For an imported diagram whose drawing already touches but whose topology
 * doesn't. Returns diagram itself when both are the same item or already
 * share a Node. */
export function joinTopologyTargets(diagram: Diagram, first: TopologyTarget, second: TopologyTarget): Diagram {
  const sameItem =
    first.kind === second.kind &&
    (first.kind === 'element'
      ? first.elementId === (second as typeof first).elementId
      : first.connectorId === (second as typeof first).connectorId)
  if (sameItem) return diagram
  const ids = new IdSequence(diagram)
  // They are different items, so resolving one (splitting its wire) never
  // renumbers the other.
  const b = topologyTargetNode(diagram, second, ids)
  if (!b) return diagram
  const a = topologyTargetNode(b.diagram, first, ids)
  if (!a || a.node === b.node) return diagram
  return removeDegenerateConnectors({ ...mergeNode(a.diagram, a.node, b.node), lastId: ids.lastId })
}

/** A busbar has one Port per connection point (each on its own Node — the
 * downstream topology processor merges a busbar's terminals into one
 * node). This makes every Node lying exactly on the busbar's line that
 * isn't one of its Ports yet a new Port of it: a wire end or a device
 * terminal the busbar was drawn, moved or reshaped over. A wire that only
 * crosses the busbar has no Node there, so it stays unconnected. Returns
 * diagram itself when there's nothing to join. */
export function joinBusbar(diagram: Diagram, busId: number): Diagram {
  const bus = diagram.elements.find(e => e.id === busId)
  if (!bus || bus.class !== 'BusBarSection' || !bus.points || bus.points.length < 2) return diagram
  const pts = bus.points
  const own = new Set((bus.ports ?? []).map(p => p.node))
  const onLine = diagram.nodes.filter(
    n => !own.has(n.id) && pts.some((a, i) => i < pts.length - 1 && isOnSegment(n, a, pts[i + 1])),
  )
  if (onLine.length === 0) return diagram
  const ports = [...(bus.ports ?? [])]
  for (const n of onLine) ports.push({ name: String(ports.length + 1), node: n.id })
  return { ...diagram, elements: diagram.elements.map(e => (e.id === busId ? { ...e, ports } : e)) }
}

/** Connects each of nodeIds that lies exactly on a busbar's line to that
 * busbar (a new Port of it, see joinBusbar) — for a wire end or terminal
 * just moved onto one. */
function joinNodesToBusbars(diagram: Diagram, nodeIds: Set<number>): Diagram {
  if (nodeIds.size === 0) return diagram
  const nodes = diagram.nodes.filter(n => nodeIds.has(n.id))
  let d = diagram
  for (const bus of diagram.elements) {
    if (bus.class !== 'BusBarSection' || !bus.points || bus.points.length < 2) continue
    const pts = bus.points
    const own = new Set((bus.ports ?? []).map(p => p.node))
    const add = nodes.filter(n => !own.has(n.id) && pts.some((a, i) => i < pts.length - 1 && isOnSegment(n, a, pts[i + 1])))
    if (add.length === 0) continue
    const ports = [...(bus.ports ?? [])]
    for (const n of add) ports.push({ name: String(ports.length + 1), node: n.id })
    d = { ...d, elements: d.elements.map(e => (e.id === bus.id ? { ...e, ports } : e)) }
  }
  return d
}
