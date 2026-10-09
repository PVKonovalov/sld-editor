import { t, type TranslationKey } from '../i18n'
import type { Diagram, ElementSymbol } from '../types'
import type { SelectionKind } from '../state/useDiagramContext'
import { elementDisplayName } from './elementCatalogI18n'

// The diagram Properties' Find section (components/panels/FindSection.tsx):
// searches the open diagram in memory by name, text, id and type.

/** One kind of item Find can filter on: an element shape ("el:41"), a wire
 * kind ("wire:CableLine"), text labels ("label") or digital devices ("dd"). */
export interface FindType {
  key: string
  label: string
  count: number
}

/** One search result. */
export interface FindResult {
  id: number
  kind: SelectionKind
  typeKey: string
  typeLabel: string
  name: string
  layer: number
}

/** Every item of the diagram as Find sees it: its type, display name and
 * the text it can be found by. */
function findItems(diagram: Diagram, symbols: ElementSymbol[]): (FindResult & { haystack: string })[] {
  const symbolByShape = new Map(symbols.map(s => [s.shape, s]))
  const items: (FindResult & { haystack: string })[] = []
  const add = (r: FindResult, ...extra: (string | undefined)[]) =>
    items.push({
      ...r,
      haystack: [r.name, r.typeLabel, ...extra].filter(Boolean).join('\n').toLowerCase(),
    })
  for (const el of diagram.elements) {
    const symbol = symbolByShape.get(el.shape)
    const typeLabel = symbol ? elementDisplayName(symbol) : el.class
    add(
      { id: el.id, kind: 'element', typeKey: `el:${el.shape}`, typeLabel, name: el.name ?? '', layer: el.layer },
      symbol?.name,
      el.class,
      el.shape,
      el.propertyText,
    )
  }
  for (const c of diagram.connectors) {
    const typeLabel = t(`connectorKind.${c.kind}` as TranslationKey)
    add({ id: c.id, kind: 'connector', typeKey: `wire:${c.kind}`, typeLabel, name: c.name ?? '', layer: c.layer }, c.kind)
  }
  for (const l of diagram.labels) {
    add({ id: l.id, kind: 'label', typeKey: 'label', typeLabel: t('find.typeLabel'), name: l.text, layer: l.layer })
  }
  for (const dd of diagram.digitalDevices) {
    add(
      { id: dd.id, kind: 'digitaldevice', typeKey: 'dd', typeLabel: t('elements.digitalDevice'), name: dd.name ?? '', layer: dd.layer },
      dd.value,
    )
  }
  return items
}

/** The types present in diagram, most frequent first, for the type filter. */
export function findTypes(diagram: Diagram, symbols: ElementSymbol[]): FindType[] {
  const byKey = new Map<string, FindType>()
  for (const it of findItems(diagram, symbols)) {
    const ft = byKey.get(it.typeKey)
    if (ft) ft.count++
    else byKey.set(it.typeKey, { key: it.typeKey, label: it.typeLabel, count: 1 })
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** The items matching query (case-insensitive, in the name, label text,
 * type name or shape code, or the id, with or without a leading "#") and
 * typeKey ("" for all types). An exact id match comes first, then items
 * whose name starts with the query, then the rest, each by name. An empty
 * query lists everything of the chosen type, or nothing without one. */
export function findMatches(diagram: Diagram, symbols: ElementSymbol[], query: string, typeKey: string): FindResult[] {
  const q = query.trim().toLowerCase()
  if (!q && !typeKey) return []
  const idQuery = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null
  const scored: { r: FindResult; rank: number }[] = []
  for (const it of findItems(diagram, symbols)) {
    if (typeKey && it.typeKey !== typeKey) continue
    let rank: number
    if (!q) rank = 2
    else if (idQuery !== null && it.id === idQuery) rank = 0
    else if (it.name.toLowerCase().startsWith(q)) rank = 1
    else if (it.haystack.includes(q) || (idQuery !== null && String(it.id).includes(String(idQuery)))) rank = 2
    else continue
    const { haystack: _, ...r } = it
    scored.push({ r, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || a.r.name.localeCompare(b.r.name) || a.r.id - b.r.id)
  return scored.map(s => s.r)
}
