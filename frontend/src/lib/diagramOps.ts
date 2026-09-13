import type {
  Diagram,
  DiagramElement,
  DiagramNode,
  Connector,
  VoltageClass,
  ElementClass,
  Point,
  ElementSymbol,
  EditorConfig,
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
 * element/node/connector/voltage-class id for the highest value already in
 * use — so a freshly opened legacy diagram can't hand out an id that
 * collides with one already on disk. A no-op once a diagram has its own
 * lastId. */
export function ensureLastId(diagram: Diagram): Diagram {
  if (diagram.lastId) return diagram

  let max = 0
  const consider = (id: number) => {
    if (id > max) max = id
  }
  diagram.elements.forEach(e => consider(e.id))
  diagram.nodes.forEach(n => consider(n.id))
  diagram.connectors.forEach(c => consider(c.id))
  diagram.voltageClasses.forEach(vc => consider(vc.id))

  return max > 0 ? { ...diagram, lastId: max } : diagram
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
export function placeElement(
  diagram: Diagram,
  symbol: ElementSymbol,
  point: Point,
  defaultVoltage?: number,
): Diagram {
  const ids = new IdSequence(diagram)
  const id = ids.take()
  const element: DiagramElement = {
    id,
    class: symbol.class as ElementClass,
    shape: symbol.shape,
    name: `${symbol.name}-${id}`,
    layer: defaultLayer(diagram),
    voltage: defaultVoltage,
    x: point.x,
    y: point.y,
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

/** Rotates a local (unrotated) point by an element's own orient (degrees)
 * and translates it by the element's own anchor — matching exactly how
 * internal/slddoc.Render places a symbol's template, via
 * transform="translate(x,y) rotate(orient)". */
function placeLocalPoint(el: DiagramElement, p: Point): Point {
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
  const connector: Connector = {
    id: ids.take(),
    kind: 'BusWork',
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

/** Like drawConnectorPath, but ends "in mid-air" instead of on a second
 * element — a Node is still created at the far end (points[points.length -
 * 1]) so the Connector has somewhere to point its own `to`, but no
 * element gets a Port referencing it, leaving that end dangling (matching
 * how removeElement already treats a connector touching a node no element
 * still ports into). Used to let double-click end an in-progress route
 * without requiring a target element. defaultVoltage: see drawConnectorPath
 * — here there's no `to` element to check, so it's from's own voltage,
 * then defaultVoltage. */
export function drawDanglingConnectorPath(diagram: Diagram, fromId: number, points: Point[], defaultVoltage?: number): Diagram {
  if (points.length < 2) return diagram
  const from = diagram.elements.find(e => e.id === fromId)
  if (!from) return diagram

  const ids = new IdSequence(diagram)
  const start = points[0]
  const end = points[points.length - 1]
  const fromNode: DiagramNode = { id: ids.take(), x: start.x, y: start.y }
  const toNode: DiagramNode = { id: ids.take(), x: end.x, y: end.y }
  const connector: Connector = {
    id: ids.take(),
    kind: 'BusWork',
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

export function removeConnector(diagram: Diagram, id: number): Diagram {
  return { ...diagram, connectors: diagram.connectors.filter(c => c.id !== id) }
}

/** Every Node id some element's own Port actually references — the
 * complement of this is what "dangling" means for a connector's own
 * `from`/`to` (see danglingConnectorEnds): a route ended in mid-air
 * (drawDanglingConnectorPath) or the cut side of a deleteConnectorSegment
 * split are the two ways a connector ends up pointing at a Node nothing
 * else uses. removeElement already deletes a connector outright rather
 * than leaving it dangling when an element it was attached to goes away
 * (see that function's own doc comment), so this never needs to account
 * for that case. */
export function usedNodeIds(diagram: Diagram): Set<number> {
  const used = new Set<number>()
  for (const e of diagram.elements) {
    for (const p of e.ports ?? []) used.add(p.node)
  }
  return used
}

/** Which end(s) of a connector are dangling — its `from` and/or `to` Node
 * isn't referenced by any element's Port, so that end isn't really
 * attached to anything. usedNodeIds should be computed once per diagram
 * (not per connector) and passed in. */
export function danglingConnectorEnds(connector: Connector, used: Set<number>): { from: boolean; to: boolean } {
  return { from: !used.has(connector.from), to: !used.has(connector.to) }
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

  let result = removeConnector(diagram, connectorId)
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
