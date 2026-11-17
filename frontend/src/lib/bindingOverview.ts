import type { Binding, BindingKind, Diagram, DiagramElement, ElementSymbol } from '../types'
import type { BindingTarget } from './diagramOps'
import { elementDisplayName } from './elementCatalogI18n'
import { t, type TranslationKey } from '../i18n'
import { DIGITAL_DEVICE_SHAPE, LABEL_SHAPE } from './paletteItem'

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
  /** A wire's connector kind, an element's class. */
  sub?: string
}

/** Every bindable item of diagram: elements, digital devices, text labels (named by their first line), wires. */
export function bindables(diagram: Diagram): Bindable[] {
  const out: Bindable[] = []
  const fields = (i: { bindings?: Binding[]; precision?: number; features?: string }) => ({
    bindings: i.bindings,
    precision: i.precision,
    features: i.features,
  })
  for (const e of diagram.elements) {
    out.push({ target: { kind: 'element', id: e.id }, shape: e.shape, expected: expectsBinding(e), name: e.name ?? '', sub: e.class, ...fields(e) })
  }
  for (const d of diagram.digitalDevices) {
    out.push({ target: { kind: 'digitaldevice', id: d.id }, shape: DIGITAL_DEVICE_SHAPE, expected: true, name: d.name ?? '', ...fields(d) })
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
  label: string
  wire: (kind: string) => string
}

const ITEM_TITLE: Record<BindingTarget['kind'], TranslationKey> = {
  element: 'bindings.staleElement',
  digitaldevice: 'bindings.staleDigitalDevice',
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
    }))
}

/** Which binding a gap is about: any (no binding at all) or one kind. */
export type GapKind = 'any' | BindingKind

/** Reports whether row has no binding (gap 'any') or none of kind gap. */
export function isUnbound(bindings: Partial<Record<BindingKind, Binding>>, gap: GapKind): boolean {
  return gap === 'any' ? Object.keys(bindings).length === 0 : !bindings[gap]
}

/** Returns the ids of diagram's elements expected to be bound and of its digital devices that have a gap. */
export function unboundIds(diagram: Diagram, gap: GapKind): { elements: Set<number>; digitalDevices: Set<number> } {
  const elements = new Set<number>()
  const digitalDevices = new Set<number>()
  for (const el of diagram.elements) {
    if (expectsBinding(el) && isUnbound(byKind(el.bindings), gap)) elements.add(el.id)
  }
  for (const dd of diagram.digitalDevices) {
    if (isUnbound(byKind(dd.bindings), gap)) digitalDevices.add(dd.id)
  }
  return { elements, digitalDevices }
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
