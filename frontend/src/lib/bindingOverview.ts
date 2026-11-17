import type { Binding, BindingKind, Diagram, DiagramElement, ElementSymbol } from '../types'
import type { SelectionKind } from '../state/useDiagramContext'
import { elementDisplayName } from './elementCatalogI18n'

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

/** One item of the overview: an element or digital device and its bindings by kind. */
export interface OverviewRow {
  id: number
  kind: Extract<SelectionKind, 'element' | 'digitaldevice'>
  name: string
  typeName: string
  bindings: Partial<Record<BindingKind, Binding>>
}

function byKind(bindings: Binding[] | undefined): Partial<Record<BindingKind, Binding>> {
  const out: Partial<Record<BindingKind, Binding>> = {}
  for (const b of bindings ?? []) out[b.kind] = b
  return out
}

/** Returns the overview rows of diagram: the elements expected to be bound or carrying a binding, then every digital
 * device; ddTypeName names digital devices' type. */
export function overviewRows(diagram: Diagram, symbols: ElementSymbol[], ddTypeName: string): OverviewRow[] {
  const bySymbol = new Map(symbols.map(s => [s.shape, s]))
  const rows: OverviewRow[] = []
  for (const el of diagram.elements) {
    if (!expectsBinding(el) && !el.bindings?.length) continue
    const symbol = bySymbol.get(el.shape)
    rows.push({
      id: el.id,
      kind: 'element',
      name: el.name ?? '',
      typeName: symbol ? elementDisplayName(symbol) : el.class,
      bindings: byKind(el.bindings),
    })
  }
  for (const dd of diagram.digitalDevices) {
    rows.push({ id: dd.id, kind: 'digitaldevice', name: dd.name ?? '', typeName: ddTypeName, bindings: byKind(dd.bindings) })
  }
  return rows
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
