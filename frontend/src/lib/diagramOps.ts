import type {
  Diagram,
  DiagramElement,
  DiagramNode,
  Connector,
  ConnectorKind,
  VoltageClass,
  ElementClass,
  Point,
  ElementSymbol,
  EditorConfig,
  Label,
  DigitalDevice,
} from '../types'

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
// A Breaker/Disconnector/LoadBreakSwitch (either the fixed or withdrawable
// shape — both share the same Class) starts out placed in service, not
// open, so a freshly drawn one-line reads correctly without a separate
// trip to Properties for every single device: 1 is "Close" in the
// state->color legend (config.stateColors). GroundSwitch gets its own
// default below instead, since leaving it unset now has a different
// visual consequence (see GROUND_SWITCH_DEFAULT_STATE's own comment).
const DEFAULT_CLOSED_CLASSES = new Set<ElementClass>(['Breaker', 'Disconnector', 'LoadBreakSwitch'])
const STATE_CLOSE = 1

// GroundSwitch's own template (base.xml shape 54) draws earth-plates-up/
// stub-down at orient 0 — confirmed against a real xsde2svg corpus export,
// which always places this shape pre-rotated (90/180, never 0), so the
// template itself is left as-is. A freshly placed one defaults to 180°
// instead of unset/0 so it already reads the conventional way (stub up
// toward whatever it's tapped off of, earth symbol dangling below) without
// a separate trip to Properties' Orientation field first.
const GROUND_SWITCH_DEFAULT_ORIENT = 180

// GroundSwitch's blade is now state-driven too (base.xml's {state:...},
// matching Breaker/Disconnector's own mechanism), and an unset State reads
// as Close (applyStateLine's own nil-maps-to-first-option rule) — so
// leaving it unset would make a freshly placed one default to the
// grounded/closed look. 0 (Open) instead matches both the real corpus
// (~92% of a real substation export's own GroundSwitch elements are Open)
// and this template's own pre-{state:...} fixed appearance, so a freshly
// placed one still looks the same as it always has.
const GROUND_SWITCH_DEFAULT_STATE = 0

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

// A freshly placed FaultPassageIndicator starts at State 0 (Open) — same
// reasoning as GroundSwitch's own default, since an unrecorded State would
// otherwise still read as Open here too (render.go's fpiColor defaults nil
// the same way), so this just gives Properties' own dropdown a real
// starting value — with a real radius instead of unset, which (like an
// unset Lamp radius) renders as an invisible r="0" circle; 10 also matches
// where base.xml's own <terminals> for this shape are fixed, and the
// default 10-unit grid (its own "FPI" text is sized down to fit inside a
// ring this small).
const FPI_DEFAULTS: Pick<DiagramElement, 'state' | 'radius'> = {
  state: 0,
  radius: 10,
}

export function placeElement(
  diagram: Diagram,
  symbol: ElementSymbol,
  point: Point,
  defaultVoltage?: number,
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
    // voltage class color (see base.xml's own header comment).
    ...(elementClass === 'Lamp' || elementClass === 'FaultPassageIndicator' ? {} : { voltage: defaultVoltage }),
    x: point.x,
    y: point.y,
    ...(DEFAULT_CLOSED_CLASSES.has(elementClass) ? { state: STATE_CLOSE } : {}),
    ...(elementClass === 'Lamp' ? LAMP_DEFAULTS : {}),
    ...(elementClass === 'GroundSwitch'
      ? { orient: GROUND_SWITCH_DEFAULT_ORIENT, state: GROUND_SWITCH_DEFAULT_STATE }
      : {}),
    ...(WITHDRAWABLE_SHAPES.has(symbol.shape) ? { position: POSITION_NORMAL } : {}),
    ...(elementClass === 'FaultPassageIndicator' ? FPI_DEFAULTS : {}),
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
 * BusBarSection, point becomes the new midpoint and the whole shape is
 * translated to match, preserving its length/angle (mirrors placeBusbar's
 * own start..end -> anchor convention). Named the same way a freshly
 * placed element is — "<type>-<id>" (e.g. "Busbar-5") — rather than
 * "<original name> copy", so a pasted copy reads like any other new
 * element instead of accumulating "copy" suffixes on repeated pastes.
 *
 * snap, when given, is applied to each of a pasted BusBarSection's
 * translated endpoints (and the anchor is then re-derived as their
 * midpoint, mirroring updateBusbarPoint's convention). Without it, a
 * busbar whose original anchor wasn't itself exactly on-grid — its anchor
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
  if (element.class === 'BusBarSection' && entry.points) {
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

/** Captures a whole multi-selection for a later Paste, in the same order
 * the elements were selected. */
export function copyElements(els: DiagramElement[]): ClipboardEntry[] {
  return els.map(copyElement)
}

/** Places a whole copied multi-selection as a rigid group: point becomes
 * where the group's own centroid (the average of every entry's own
 * anchor) lands, and every entry is placed at its original offset from
 * that centroid — so the selection's relative layout is preserved exactly,
 * the same way a single pasteElement preserves one busbar's own shape.
 * Falls back to placeElements' own convention for a one-entry group: its
 * centroid is just its own anchor, so it lands exactly at point, matching
 * pasteElement.
 *
 * Each entry's own raw (unsnapped) offset from the centroid is snapped
 * before placing it — the centroid of two or more on-grid anchors isn't
 * necessarily itself on-grid (the same reason updateBusbarPoint/pasteElement
 * snap a busbar's own endpoints rather than trusting its anchor), so
 * without this an ordinary (non-busbar) element in a pasted group could
 * land off-grid even though point itself is on-grid. */
export function pasteElements(
  diagram: Diagram,
  entries: ClipboardEntry[],
  point: Point,
  snap: (p: Point) => Point = p => p,
): Diagram {
  if (entries.length === 0) return diagram
  const centroid = {
    x: entries.reduce((sum, e) => sum + e.x, 0) / entries.length,
    y: entries.reduce((sum, e) => sum + e.y, 0) / entries.length,
  }
  return entries.reduce(
    (acc, entry) =>
      pasteElement(acc, entry, snap({ x: point.x + (entry.x - centroid.x), y: point.y + (entry.y - centroid.y) }), snap),
    diagram,
  )
}

/** Translates an element by (dx, dy) — its anchor for most classes, or
 * every vertex (plus the anchor, kept in sync for labeling/hit-testing)
 * for a BusBarSection. */
export function moveElement(diagram: Diagram, id: number, dx: number, dy: number): Diagram {
  return {
    ...diagram,
    elements: diagram.elements.map(e => {
      if (e.id !== id) return e
      if (e.class === 'BusBarSection' && e.points) {
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

/** Moves a whole set of elements together by (dx, dy) — same translation
 * moveElement applies to each one — and re-routes every connector attached
 * to any of their ports to follow ("Piece C", endpoint-follows-only, the
 * simplest useful version rather than full accordion re-layout): a
 * connector whose *both* ends belong to elements in ids translates as a
 * rigid whole (nothing about its shape needs to change, since every point
 * keeps the same relative position); one with only one end attached to a
 * moving element instead has just that end dragged to its new position,
 * with the segment touching it kept orthogonal the same way
 * moveConnectorVertex keeps an interior vertex's own segments orthogonal —
 * an ordinary interior neighbor slides along whichever axis preserves that
 * one segment's original orientation, while a neighbor that's actually the
 * connector's other (unmoving) true endpoint gets a new bend inserted next
 * to it instead, since it can't move. Only a plain whole-element drag goes
 * through here — a BusBarSection's own single-endpoint drag handle
 * (updateBusbarPoint) is a separate, harder case (there's no single
 * "moved by dx,dy" delta for the rest of the shape) and isn't rerouted. */
export function moveElements(diagram: Diagram, ids: number[], dx: number, dy: number): Diagram {
  const moving = new Set(ids)
  const movedNodeIds = new Set<number>()
  for (const el of diagram.elements) {
    if (!moving.has(el.id)) continue
    for (const p of el.ports ?? []) movedNodeIds.add(p.node)
  }

  const moved = ids.reduce((acc, id) => moveElement(acc, id, dx, dy), diagram)
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

/** Updates one endpoint of a BusBarSection's own Points in place — its
 * anchor (X/Y) is recomputed as the midpoint of the first and last point,
 * the same convention placeBusbar establishes when first drawing one. A
 * no-op for any other class, or an out-of-range point index. */
export function updateBusbarPoint(diagram: Diagram, id: number, pointIndex: number, point: Point): Diagram {
  return {
    ...diagram,
    elements: diagram.elements.map(e => {
      if (e.id !== id || e.class !== 'BusBarSection' || !e.points || !e.points[pointIndex]) return e
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

// A newly drawn OverheadLine/CableLine connector gets an auto-generated
// Name — the same "<kind label>-<id>" convention placeElement already
// uses for a newly placed equipment symbol ("Breaker-3") — since both are
// meant to carry a real identity a plain BusWork/BusbarWire connector
// never does; it's also what actually makes writeNamedLine's own
// data-name attribute non-empty (confirmed against a real xsde2svg-
// exported line's own data-name, e.g. sld-viewer/assets/sld/IEEE9bus.svg's
// "Line2" — see backend/internal/slddoc/render.go). Every other kind
// returns undefined, same as never setting Name at all.
const NAMED_CONNECTOR_KIND_LABEL: Partial<Record<ConnectorKind, string>> = {
  OverheadLine: 'Overhead line',
  CableLine: 'Cable line',
}

function defaultConnectorName(kind: ConnectorKind, id: number): string | undefined {
  const label = NAMED_CONNECTOR_KIND_LABEL[kind]
  return label ? `${label}-${id}` : undefined
}

/** Rotates a local (unrotated) point by an element's own orient (degrees)
 * and translates it by the element's own anchor — matching exactly how
 * internal/slddoc.Render places a symbol's template, via
 * transform="translate(x,y) rotate(orient)". Exported for Canvas.tsx's own
 * elementBoxes, which maps a symbol's real rendered-DOM local bounding box
 * (getBBox(), still in that same pre-transform local space) through this
 * same math to get its true diagram-space footprint. */
export function placeLocalPoint(el: DiagramElement, p: Point): Point {
  const rad = ((el.orient ?? 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: el.x + p.x * cos - p.y * sin, y: el.y + p.x * sin + p.y * cos }
}

/** An element's own real terminal positions — where a wire would actually
 * meet it — or null when its shape carries no <terminals> (most shapes,
 * for now; see base.xml's own doc comment). Purely a visual aid: Canvas
 * draws a marker at each one for the current selection. Ctrl/Cmd-click-
 * to-connect (connectElements, below) does not use this — it still joins
 * two elements' bare anchors regardless of any terminals a shape defines. */
export function symbolTerminals(el: DiagramElement, symbols: ElementSymbol[]): Point[] | null {
  const symbol = symbols.find(s => s.shape === el.shape)
  if (!symbol?.terminals || symbol.terminals.length === 0) return null
  return symbol.terminals.map(t => placeLocalPoint(el, t))
}

/** Electrically joins two elements: a Node (plus a Port referencing it) is
 * created at each element's own anchor, and a Connector drawn straight
 * between them ties the two Nodes together. This is a simplified stand-in
 * for real port geometry (the symbol library doesn't record per-shape port
 * offsets — see backend/internal/slddoc's Port doc comment) — connecting
 * two elements always runs a straight line anchor-to-anchor rather than to
 * each shape's true terminal position. The new connector's voltage comes
 * from whichever of from/to already has one (see drawConnectorPath's own
 * doc comment) — with no defaultVoltage param here, an element joined to
 * one with no voltage of its own at all just stays unset, same as before. */
export function connectElements(diagram: Diagram, fromId: number, toId: number): Diagram {
  if (fromId === toId) return diagram
  const from = diagram.elements.find(e => e.id === fromId)
  const to = diagram.elements.find(e => e.id === toId)
  if (!from || !to) return diagram

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
