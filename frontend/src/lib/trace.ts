import type { Diagram, DiagramElement } from '../types'

// The canvas's Trace (context menu → Trace): everything electrically
// joined to a starting point, found by a breadth-first search over the
// diagram's Nodes.

export interface TraceOptions {
  // A switching device (one with a state) passes only when Closed (1); Open,
  // Intermediate and a withdrawable device not racked in (position other
  // than Service, 0) stop the trace. Off: every switch passes.
  respectStates: boolean
  // A power transformer or booster joins its windings, so the trace goes on
  // to the other voltage levels. Off: it stops there.
  throughTransformers: boolean
}

export interface TraceResult {
  nodes: Set<number>
  connectors: Set<number>
  // Elements the trace reached and went through (or that end there: a
  // single-terminal device).
  elements: Set<number>
  // Elements the trace reached but couldn't pass: an open switch, a racked
  // out device, a transformer with throughTransformers off.
  stops: Set<number>
}

const TRANSFORMER_CLASSES = new Set<string>(['PowerTransformer', 'Booster'])

// Switch state values (config state_colors): 1 is Closed.
const STATE_CLOSED = 1
// Racking position values (config position_states): 0 is Service.
const POSITION_SERVICE = 0

/** Whether the trace may go from one of el's ports to the others. */
function passes(el: DiagramElement, opts: TraceOptions): boolean {
  if (el.class === 'BusBarSection') return true
  if (TRANSFORMER_CLASSES.has(el.class)) return opts.throughTransformers
  if (!opts.respectStates) return true
  if (el.position != null && el.position !== POSITION_SERVICE) return false
  if (el.state != null && el.state !== STATE_CLOSED) return false
  return true
}

/** One place a trace starts: a Node, or (with none) just an element, a
 * busbar with nothing on it. */
export interface TraceStart {
  node?: number
  element?: number
}

/** Traces from every start at once (several sources, say two feeding
 * lines): a breadth-first search where a wire joins its two ends, a busbar
 * all its connection points, and a device with two or more ports its ports
 * when it passes (see TraceOptions); a single-port device is reached but
 * leads nowhere. */
export function traceNetwork(diagram: Diagram, starts: TraceStart[], opts: TraceOptions): TraceResult {
  const result: TraceResult = { nodes: new Set(), connectors: new Set(), elements: new Set(), stops: new Set() }
  const wiresAt = new Map<number, { id: number; other: number }[]>()
  for (const c of diagram.connectors) {
    for (const [here, other] of [
      [c.from, c.to],
      [c.to, c.from],
    ]) {
      const list = wiresAt.get(here) ?? []
      list.push({ id: c.id, other })
      wiresAt.set(here, list)
    }
  }
  const elementsAt = new Map<number, DiagramElement[]>()
  for (const el of diagram.elements) {
    for (const p of el.ports ?? []) {
      const list = elementsAt.get(p.node) ?? []
      if (!list.includes(el)) list.push(el)
      elementsAt.set(p.node, list)
    }
  }

  const queue: number[] = []
  for (const start of starts) {
    if (start.node === undefined) {
      if (start.element !== undefined) result.elements.add(start.element)
    } else if (!result.nodes.has(start.node)) {
      result.nodes.add(start.node)
      queue.push(start.node)
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]
    const reach = (next: number) => {
      if (result.nodes.has(next)) return
      result.nodes.add(next)
      queue.push(next)
    }
    for (const w of wiresAt.get(node) ?? []) {
      result.connectors.add(w.id)
      reach(w.other)
    }
    for (const el of elementsAt.get(node) ?? []) {
      const ports = el.ports ?? []
      if (ports.length < 2) {
        result.elements.add(el.id)
        continue
      }
      if (!passes(el, opts)) {
        result.stops.add(el.id)
        continue
      }
      result.elements.add(el.id)
      for (const p of ports) reach(p.node)
    }
  }
  // A device reached on one side but passed from another isn't a stop.
  for (const id of result.elements) result.stops.delete(id)
  return result
}
