import type { Binding, BindingKind, DesignationPlan, Diagram, DiagramElement, DiagramFunction, ElementSymbol } from '../types'
import { functionSegment, type BindingTarget } from './diagramOps'
import { elementDisplayName } from './elementCatalogI18n'
import { t, type TranslationKey } from '../i18n'
import { BAR_INSTRUMENT_SHAPE, DIGITAL_DEVICE_SHAPE, LABEL_SHAPE } from './paletteItem'

export const BINDING_KINDS: BindingKind[] = ['equipment', 'meas1', 'meas2', 'jump']

/** Drawing shapes and topology helpers: never expected to be bound, listed only when they carry a binding. */
const UNBOUND_CLASSES = new Set<string>([
  'Line',
  'Arc',
  'Polygon',
  'Rectangle',
  'Circle',
  'Arrow',
  'Container',
  'Picture',
  'Road',
  'ConnectorArrow',
  'ConnectorPoint',
  'JunctionPoint',
  'Fork',
  'NonIntersection',
  'CableConnector',
  'CableJoint',
  'TwoTerminalBox',
  'Ground',
  'Chassis',
  'HalfChassis',
])

/** Reports whether el is expected to carry a binding. */
export function expectsBinding(el: DiagramElement): boolean {
  return !UNBOUND_CLASSES.has(el.class)
}

/** A bindable item: an element, digital device, text label or wire, with its shape (a wire: "") and binding fields. */
export interface Bindable {
  target: BindingTarget
  shape: string
  /** An element that is expected to be bound, or a digital device. */
  expected: boolean
  name: string
  bindings?: Binding[]
  precision?: number
  features?: string
  componentType?: string
  /** A wire's connector kind, an element's class. */
  sub?: string
  /** An element's functional unit (DiagramFunction.id). */
  function?: number
}

/** Every bindable item of diagram: elements, digital devices, bar instruments, text labels (named by their first line), wires. */
export function bindables(diagram: Diagram): Bindable[] {
  const out: Bindable[] = []
  const fields = (i: { bindings?: Binding[]; precision?: number; features?: string; componentType?: string }) => ({
    bindings: i.bindings,
    precision: i.precision,
    features: i.features,
    componentType: i.componentType,
  })
  for (const e of diagram.elements) {
    out.push({ target: { kind: 'element', id: e.id }, shape: e.shape, expected: expectsBinding(e), name: e.name ?? '', sub: e.class, function: e.function, ...fields(e) })
  }
  for (const d of diagram.digitalDevices) {
    out.push({ target: { kind: 'digitaldevice', id: d.id }, shape: DIGITAL_DEVICE_SHAPE, expected: true, name: d.name ?? '', ...fields(d) })
  }
  for (const b of diagram.barInstruments) {
    out.push({ target: { kind: 'barinstrument', id: b.id }, shape: BAR_INSTRUMENT_SHAPE, expected: true, name: b.name ?? '', ...fields(b) })
  }
  for (const l of diagram.labels) {
    out.push({ target: { kind: 'label', id: l.id }, shape: LABEL_SHAPE, expected: false, name: l.text.split('\n')[0], ...fields(l) })
  }
  for (const c of diagram.connectors) {
    out.push({ target: { kind: 'connector', id: c.id }, shape: '', expected: false, name: c.name ?? '', sub: c.kind, ...fields(c) })
  }
  return out
}

/** How the overview names the types that aren't element symbols (see overviewTypeNames). */
export interface TypeNames {
  digitalDevice: string
  barInstrument: string
  label: string
  wire: (kind: string) => string
}

const ITEM_TITLE: Record<BindingTarget['kind'], TranslationKey> = {
  element: 'bindings.staleElement',
  digitaldevice: 'bindings.staleDigitalDevice',
  barinstrument: 'bindings.staleBarInstrument',
  label: 'bindings.staleLabel',
  connector: 'bindings.staleWire',
}

/** Names the item target of diagram: "name (id)", or its kind and id when it has no name. */
export function itemTitle(diagram: Diagram, target: BindingTarget): string {
  const name = bindables(diagram).find(b => b.target.kind === target.kind && b.target.id === target.id)?.name
  return name ? `${name} (${target.id})` : t(ITEM_TITLE[target.kind], { id: target.id })
}

/** The overview's type names in the current language. */
export function overviewTypeNames(): TypeNames {
  return {
    digitalDevice: t('overview.digitalDevice'),
    barInstrument: t('overview.barInstrument'),
    label: t('overview.label'),
    wire: kind => t(`connectorKind.${kind}` as TranslationKey),
  }
}

/** The type name of item: its symbol's for an element. */
export function typeName(item: Bindable, bySymbol: Map<string, ElementSymbol>, names: TypeNames): string {
  switch (item.target.kind) {
    case 'element': {
      const symbol = bySymbol.get(item.shape)
      return symbol ? elementDisplayName(symbol) : (item.sub ?? '')
    }
    case 'digitaldevice':
      return names.digitalDevice
    case 'barinstrument':
      return names.barInstrument
    case 'label':
      return names.label
    case 'connector':
      return names.wire(item.sub ?? '')
  }
}

/** One item of the overview and its bindings by kind. */
export interface OverviewRow {
  id: number
  kind: BindingTarget['kind']
  name: string
  typeName: string
  bindings: Partial<Record<BindingKind, Binding>>
  function?: number
}

function byKind(bindings: Binding[] | undefined): Partial<Record<BindingKind, Binding>> {
  const out: Partial<Record<BindingKind, Binding>> = {}
  for (const b of bindings ?? []) out[b.kind] = b
  return out
}

/** Returns the overview rows of diagram: the items expected to be bound (elements, digital devices) and every item
 * carrying a binding (text labels and wires included). */
export function overviewRows(diagram: Diagram, symbols: ElementSymbol[], names: TypeNames): OverviewRow[] {
  const bySymbol = new Map(symbols.map(s => [s.shape, s]))
  return bindables(diagram)
    .filter(i => i.expected || i.bindings?.length)
    .map(i => ({
      id: i.target.id,
      kind: i.target.kind,
      name: i.name,
      typeName: typeName(i, bySymbol, names),
      bindings: byKind(i.bindings),
      function: i.function,
    }))
}

/** A node of the overview tree: a function of the designation hierarchy (fn null: the items in no function), its
 * own designation segment, its child functions and its own rows. */
export interface OverviewNode {
  key: string
  fn: DiagramFunction | null
  segment: string
  children: OverviewNode[]
  rows: OverviewRow[]
}

/** Returns rows arranged by the hierarchy of plan (voltage level → unit, worked out from the topology as Enumerate
 * elements does; functions with negative ids are only proposed): an element goes to its plan row's or level's function,
 * else to its own. Rows keep their order within a node, nodes are sorted by segment, functions without rows below
 * them are left out, and the rows in no known function go to a last node with fn null. */
export function overviewTree(plan: DesignationPlan, rows: OverviewRow[]): OverviewNode[] {
  const nodes = new Map<number, OverviewNode>()
  for (const f of plan.functions) {
    nodes.set(f.id, { key: `f${f.id}`, fn: f, segment: functionSegment(f), children: [], rows: [] })
  }
  const planned = new Map<number, number>([
    ...plan.levels.map((m): [number, number] => [m.element, m.function]),
    ...plan.rows.map((r): [number, number] => [r.element, r.function]),
  ])
  const none: OverviewNode = { key: 'none', fn: null, segment: '', children: [], rows: [] }
  for (const r of rows) {
    const fn = r.kind === 'element' ? (planned.get(r.id) ?? r.function) : undefined
    ;(fn !== undefined ? (nodes.get(fn) ?? none) : none).rows.push(r)
  }
  const roots: OverviewNode[] = []
  for (const n of nodes.values()) {
    const parent = n.fn?.parent ? nodes.get(n.fn.parent) : undefined
    if (parent && !reaches(nodes, parent, n)) parent.children.push(n)
    else roots.push(n)
  }
  const prune = (list: OverviewNode[]): OverviewNode[] =>
    list
      .map(n => ({ ...n, children: prune(n.children) }))
      .filter(n => n.rows.length > 0 || n.children.length > 0)
      .sort((a, b) => a.segment.localeCompare(b.segment, undefined, { numeric: true }))
  const out = prune(roots)
  if (none.rows.length > 0) out.push(none)
  return out
}

function reaches(nodes: Map<number, OverviewNode>, from: OverviewNode, to: OverviewNode): boolean {
  const seen = new Set<number>()
  for (let n: OverviewNode | undefined = from; n?.fn && !seen.has(n.fn.id); n = n.fn.parent ? nodes.get(n.fn.parent) : undefined) {
    if (n === to) return true
    seen.add(n.fn.id)
  }
  return false
}

/** Every row of node and of the nodes below it. */
export function nodeRows(node: OverviewNode): OverviewRow[] {
  return [...node.rows, ...node.children.flatMap(nodeRows)]
}

/** The keys of every node in nodes and below them. */
export function nodeKeys(nodes: OverviewNode[]): string[] {
  return nodes.flatMap(n => [n.key, ...nodeKeys(n.children)])
}

/** Which binding a gap is about: any (no binding at all) or one kind. */
export type GapKind = 'any' | BindingKind

/** Reports whether row has no binding (gap 'any') or none of kind gap. */
export function isUnbound(bindings: Partial<Record<BindingKind, Binding>>, gap: GapKind): boolean {
  return gap === 'any' ? Object.keys(bindings).length === 0 : !bindings[gap]
}

/** Returns the ids of diagram's elements expected to be bound and of its digital devices and bar instruments that have
 * a gap. */
export function unboundIds(
  diagram: Diagram,
  gap: GapKind,
): { elements: Set<number>; digitalDevices: Set<number>; barInstruments: Set<number> } {
  const elements = new Set<number>()
  const digitalDevices = new Set<number>()
  const barInstruments = new Set<number>()
  for (const el of diagram.elements) {
    if (expectsBinding(el) && isUnbound(byKind(el.bindings), gap)) elements.add(el.id)
  }
  for (const dd of diagram.digitalDevices) {
    if (isUnbound(byKind(dd.bindings), gap)) digitalDevices.add(dd.id)
  }
  for (const b of diagram.barInstruments) {
    if (isUnbound(byKind(b.bindings), gap)) barInstruments.add(b.id)
  }
  return { elements, digitalDevices, barInstruments }
}

function csvCell(s: string): string {
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Returns rows as CSV (UTF-8 with a byte-order mark, so spreadsheets read non-Latin text): header, then id, name,
 * type and the bound object's name per kind. */
export function overviewCsv(rows: OverviewRow[], kinds: BindingKind[], header: string[]): string {
  const lines = [header, ...rows.map(r => [String(r.id), r.name, r.typeName, ...kinds.map(k => r.bindings[k]?.name || r.bindings[k]?.ref || '')])]
  return '﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
