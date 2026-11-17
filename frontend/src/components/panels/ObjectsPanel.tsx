import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  Box,
  ChevronDown,
  ChevronRight,
  Database,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { PanelShell } from './PanelShell'
import { t } from '../../i18n'
import * as api from '../../lib/api'
import { useVirtualRows } from '../../lib/virtualRows'
import type { BindingHit, BindingNode, BindingObject, BindingSearchResult, BindingSection, DraggedObject } from '../../types'

const ROW = 22

type Load<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; data: T }

// A selected tree row: a section node, or a catalog node of the catalog shown under section node `at`.
type Selection = { kind: 'section'; id: string } | { kind: 'node'; at: string; section: string; id: string }

type TreeRow =
  | { kind: 'section'; key: string; depth: number; s: BindingSection; expandable: boolean }
  | { kind: 'node'; key: string; depth: number; at: string; section: string; n: BindingNode }
  | { kind: 'loading'; key: string; depth: number }
  | { kind: 'error'; key: string; depth: number; error: string; retry: () => void }

type SortColumn = 'name' | 'type' | 'class'

// Where a search hit should be shown once its catalog (and list) are loaded.
interface Reveal {
  at: string
  section: string
  node: string
  row?: string
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// catalogIndex maps every node id of a catalog to its node and its parent's id ("" for a top node).
function catalogIndex(nodes: BindingNode[]) {
  const byId = new Map<string, { n: BindingNode; parent: string }>()
  const walk = (list: BindingNode[], parent: string) => {
    for (const n of list) {
      byId.set(n.id, { n, parent })
      if (n.children) walk(n.children, n.id)
    }
  }
  walk(nodes, '')
  return byId
}

// sectionPath returns the ids of the section nodes from a root down to the one with id, or null.
function sectionPath(list: BindingSection[], id: string): string[] | null {
  for (const s of list) {
    if (s.id === id) return [s.id]
    const sub = s.children ? sectionPath(s.children, id) : null
    if (sub) return [s.id, ...sub]
  }
  return null
}

function findSection(list: BindingSection[], id: string): BindingSection | null {
  for (const s of list) {
    if (s.id === id) return s
    const sub = s.children ? findSection(s.children, id) : null
    if (sub) return sub
  }
  return null
}

function ErrorLine({ error, retry, indent = 0 }: { error: string; retry: () => void; indent?: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-red-300 py-0.5" style={{ paddingLeft: indent }}>
      <span className="truncate" title={error}>
        {t('objects.error', { error })}
      </span>
      <button type="button" onClick={retry} className="shrink-0 rounded bg-surface-600 px-1.5 text-gray-100 hover:bg-surface-500">
        {t('objects.retry')}
      </button>
    </div>
  )
}

function Spinner({ indent = 0, label }: { indent?: number; label?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-400 py-0.5" style={{ paddingLeft: indent }}>
      <Loader2 size={12} className="animate-spin" />
      {label ?? t('objects.loading')}
    </div>
  )
}

/** The Objects panel: the binding provider's objects as section tree → catalog tree → list of the selected catalog
 * node, with search. Items are dragged with OBJECT_DRAG_TYPE. Shown only when bindings are on. */
export function ObjectsPanel({ provider, onClose }: { provider: string; onClose: () => void }) {
  const [sections, setSections] = useState<Load<BindingSection[]>>({ status: 'loading' })
  const [catalogs, setCatalogs] = useState<Record<string, Load<BindingNode[]>>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<Selection | null>(null)
  const [list, setList] = useState<{ key: string; load: Load<BindingObject[]> } | null>(null)
  const [selectedRow, setSelectedRow] = useState<string | null>(null)
  const [sort, setSort] = useState<{ col: SortColumn; dir: 1 | -1 }>({ col: 'name', dir: 1 })
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<{ at: string; section: string; load: Load<BindingSearchResult> } | null>(null)
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [scrollTreeTo, setScrollTreeTo] = useState<string | null>(null)
  const [scrollListTo, setScrollListTo] = useState<string | null>(null)
  const listSeq = useRef(0)
  const searchSeq = useRef(0)

  const loadSections = useCallback(() => {
    setSections({ status: 'loading' })
    api.getBindingSections().then(
      data => {
        setSections({ status: 'ok', data })
        setExpanded(prev => (data.length === 1 ? new Set(prev).add('s:' + data[0].id) : prev))
      },
      e => setSections({ status: 'error', error: errorText(e) }),
    )
  }, [])

  useEffect(loadSections, [loadSections])

  const loadCatalog = useCallback((section: string) => {
    setCatalogs(c => ({ ...c, [section]: { status: 'loading' } }))
    api.getBindingCatalog(section).then(
      data => setCatalogs(c => ({ ...c, [section]: { status: 'ok', data } })),
      e => setCatalogs(c => ({ ...c, [section]: { status: 'error', error: errorText(e) } })),
    )
  }, [])

  const loadList = useCallback((section: string, node: string) => {
    const key = section + ':' + node
    const seq = ++listSeq.current
    setList({ key, load: { status: 'loading' } })
    api.getBindingList(section, node).then(
      data => seq === listSeq.current && setList({ key, load: { status: 'ok', data } }),
      e => seq === listSeq.current && setList({ key, load: { status: 'error', error: errorText(e) } }),
    )
  }, [])

  function reloadAll() {
    setCatalogs({})
    setList(null)
    setSearch(null)
    setSelected(null)
    setSelectedRow(null)
    loadSections()
  }

  const indexes = useMemo(() => {
    const out: Record<string, ReturnType<typeof catalogIndex>> = {}
    for (const [section, load] of Object.entries(catalogs)) {
      if (load.status === 'ok') out[section] = catalogIndex(load.data)
    }
    return out
  }, [catalogs])

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Every expanded section with a catalog has it loaded (on first expand, and again after Reload).
  useEffect(() => {
    if (sections.status !== 'ok') return
    const visit = (list: BindingSection[]) => {
      for (const s of list) {
        if (!expanded.has('s:' + s.id)) continue
        if (s.section && !catalogs[s.section]) loadCatalog(s.section)
        if (s.children) visit(s.children)
      }
    }
    visit(sections.data)
  }, [sections, expanded, catalogs, loadCatalog])

  function selectNode(at: string, section: string, id: string, row: string | null = null) {
    setSelected({ kind: 'node', at, section, id })
    setSelectedRow(row)
    if (list?.key !== section + ':' + id || list.load.status === 'error') loadList(section, id)
  }

  const rows = useMemo(() => {
    const out: TreeRow[] = []
    if (sections.status !== 'ok') return out
    const addNodes = (nodes: BindingNode[], depth: number, at: string, section: string) => {
      for (const n of nodes) {
        const key = `c:${at}:${n.id}`
        out.push({ kind: 'node', key, depth, at, section, n })
        if (n.children && expanded.has(key)) addNodes(n.children, depth + 1, at, section)
      }
    }
    const addSections = (list: BindingSection[], depth: number) => {
      for (const s of list) {
        const key = 's:' + s.id
        out.push({ kind: 'section', key, depth, s, expandable: !!s.children?.length || !!s.section })
        if (!expanded.has(key)) continue
        if (s.children) addSections(s.children, depth + 1)
        if (!s.section) continue
        const cat = catalogs[s.section]
        const sec = s.section
        if (!cat || cat.status === 'loading') out.push({ kind: 'loading', key: key + ':loading', depth: depth + 1 })
        else if (cat.status === 'error')
          out.push({ kind: 'error', key: key + ':error', depth: depth + 1, error: cat.error, retry: () => loadCatalog(sec) })
        else addNodes(cat.data, depth + 1, s.id, sec)
      }
    }
    addSections(sections.data, 0)
    return out
  }, [sections, catalogs, expanded, loadCatalog])

  const tree = useVirtualRows(rows.length, ROW)

  // A search hit: once its catalog is loaded, expand the way to its node, select it and load its list.
  useEffect(() => {
    if (!reveal || sections.status !== 'ok') return
    const cat = catalogs[reveal.section]
    if (!cat) {
      loadCatalog(reveal.section)
      return
    }
    if (cat.status !== 'ok') return
    const index = indexes[reveal.section]
    if (!index?.has(reveal.node)) {
      setReveal(null)
      return
    }
    const keys: string[] = (sectionPath(sections.data, reveal.at) ?? []).map(id => 's:' + id)
    for (let p = index.get(reveal.node)?.parent; p; p = index.get(p)?.parent) keys.push(`c:${reveal.at}:${p}`)
    setExpanded(prev => {
      const next = new Set(prev)
      keys.forEach(k => next.add(k))
      return next
    })
    selectNode(reveal.at, reveal.section, reveal.node, reveal.row ?? null)
    setScrollTreeTo(`c:${reveal.at}:${reveal.node}`)
    if (reveal.row) setScrollListTo(reveal.row)
    setReveal(null)
  }, [reveal, sections, catalogs, indexes, loadCatalog])

  useEffect(() => {
    if (!scrollTreeTo) return
    const i = rows.findIndex(r => r.key === scrollTreeTo)
    if (i >= 0) {
      tree.scrollToIndex(i)
      setScrollTreeTo(null)
    }
  }, [scrollTreeTo, rows, tree])

  const listKey = selected?.kind === 'node' ? selected.section + ':' + selected.id : null
  const objects = useMemo(() => {
    if (list?.load.status !== 'ok' || list.key !== listKey) return []
    const value = (o: BindingObject) => (sort.col === 'name' ? o.name : sort.col === 'type' ? o.typeAlias ?? '' : o.class ?? '')
    return [...list.load.data].sort((a, b) => sort.dir * (collator.compare(value(a), value(b)) || collator.compare(a.name, b.name)))
  }, [list, sort, listKey])

  const listRows = useVirtualRows(objects.length, ROW)

  useEffect(() => {
    if (!scrollListTo || list?.load.status !== 'ok') return
    listRows.scrollToIndex(objects.findIndex(o => o.ref === scrollListTo))
    setScrollListTo(null)
  }, [scrollListTo, list, objects, listRows])

  // The section search runs in: the one of the selection.
  const scope = useMemo(() => {
    if (!selected || sections.status !== 'ok') return null
    if (selected.kind === 'node') {
      return { at: selected.at, section: selected.section, name: findSection(sections.data, selected.at)?.name ?? '' }
    }
    const s = findSection(sections.data, selected.id)
    return s?.section ? { at: s.id, section: s.section, name: s.name } : null
  }, [selected, sections])

  function runSearch() {
    const q = query.trim()
    if (!scope || [...q].length < 2) return
    const seq = ++searchSeq.current
    const { at, section } = scope
    setSearch({ at, section, load: { status: 'loading' } })
    api.searchBindings(section, q).then(
      data => seq === searchSeq.current && setSearch({ at, section, load: { status: 'ok', data } }),
      e => seq === searchSeq.current && setSearch({ at, section, load: { status: 'error', error: errorText(e) } }),
    )
  }

  function openHit(hit: BindingHit) {
    if (!search) return
    setReveal({ at: search.at, section: search.section, node: hit.node, row: hit.kind === 'list' ? hit.ref : undefined })
    setSearch(null)
  }

  function dragStart(e: DragEvent, obj: Omit<DraggedObject, 'source'>) {
    const payload: DraggedObject = { source: provider, ...obj }
    e.dataTransfer.setData(api.OBJECT_DRAG_TYPE, JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'copy'
  }

  function treeRow(r: TreeRow): ReactNode {
    const indent = 4 + r.depth * 12
    if (r.kind === 'loading') return <Spinner key={r.key} indent={indent + 14} />
    if (r.kind === 'error') return <ErrorLine key={r.key} error={r.error} retry={r.retry} indent={indent + 14} />
    const open = expanded.has(r.key)
    const isSelected =
      r.kind === 'section'
        ? selected?.kind === 'section' && selected.id === r.s.id
        : selected?.kind === 'node' && selected.at === r.at && selected.id === r.n.id
    const expandable = r.kind === 'section' ? r.expandable : !!r.n.children?.length
    const name = r.kind === 'section' ? r.s.name : r.n.name
    const title =
      r.kind === 'section' ? r.s.name : [r.n.name, r.n.typeName, r.n.alias].filter(Boolean).join(' · ')
    const Icon = r.kind === 'node' ? Box : r.s.section ? Database : open ? FolderOpen : Folder
    return (
      <div
        key={r.key}
        draggable
        onDragStart={e =>
          dragStart(e, r.kind === 'section'
            ? { ref: r.s.ref, name: r.s.name, type: '' }
            : { ref: r.n.ref, name: r.n.name, type: r.n.typeName ?? '' })
        }
        onClick={() => (r.kind === 'section' ? setSelected({ kind: 'section', id: r.s.id }) : selectNode(r.at, r.section, r.n.id))}
        onDoubleClick={() => expandable && toggle(r.key)}
        title={title}
        className={`flex items-center gap-1 cursor-default select-none rounded text-xs ${
          isSelected ? 'bg-accent text-white' : 'hover:bg-surface-600'
        }`}
        style={{ height: ROW, paddingLeft: indent }}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? t('objects.collapse') : t('objects.expand')}
          onClick={e => {
            e.stopPropagation()
            if (expandable) toggle(r.key)
          }}
          className={`w-3.5 shrink-0 ${expandable ? 'text-gray-400 hover:text-white' : 'invisible'}`}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <Icon size={13} className={`shrink-0 ${isSelected ? '' : 'text-gray-400'}`} />
        <span className="truncate">{name}</span>
        {r.kind === 'node' && r.n.typeName && (
          <span className={`ml-auto shrink-0 pr-1 text-[10px] ${isSelected ? 'text-white/80' : 'text-gray-500'}`}>
            {r.n.typeName}
          </span>
        )}
      </div>
    )
  }

  function header(col: SortColumn, label: string, className: string) {
    const active = sort.col === col
    return (
      <button
        type="button"
        onClick={() => setSort(s => ({ col, dir: s.col === col ? (-s.dir as 1 | -1) : 1 }))}
        className={`${className} truncate text-left hover:text-white ${active ? 'text-gray-100' : ''}`}
      >
        {label}
        {active && (sort.dir === 1 ? ' ▲' : ' ▼')}
      </button>
    )
  }

  function upperPart(): ReactNode {
    return (
      <>
        {search && searchResults(search.load)}
        <div
          ref={tree.ref}
          onScroll={tree.onScroll}
          className={`flex-1 min-h-0 overflow-y-auto px-1 py-1 ${search ? 'hidden' : ''}`}
        >
          {sections.status === 'loading' && <Spinner indent={4} />}
          {sections.status === 'error' && <ErrorLine error={sections.error} retry={loadSections} indent={4} />}
          <div style={{ height: tree.padTop }} />
          {rows.slice(tree.start, tree.end).map(treeRow)}
          <div style={{ height: tree.padBottom }} />
        </div>
      </>
    )
  }

  // searchResults replaces the tree while a search is shown; the tree stays mounted (hidden) so it keeps its scroll.
  function searchResults(load: Load<BindingSearchResult>): ReactNode {
    return (
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
          {load.status === 'loading' && <Spinner label={t('objects.searching')} />}
          {load.status === 'error' && <ErrorLine error={load.error} retry={runSearch} />}
          {load.status === 'ok' && load.data.hits.length === 0 && (
            <p className="text-xs text-gray-400">{t('objects.noHits')}</p>
          )}
          {load.status === 'ok' &&
            load.data.hits.map(h => (
              <div
                key={h.kind + h.ref}
                draggable
                onDragStart={e => dragStart(e, { ref: h.ref, name: h.name, type: '' })}
                onClick={() => openHit(h)}
                title={h.name}
                className="flex items-center gap-1.5 cursor-pointer rounded px-1 text-xs hover:bg-surface-600"
                style={{ height: ROW }}
              >
                {h.kind === 'catalog' ? (
                  <Box size={13} className="shrink-0 text-gray-400" />
                ) : (
                  <span className="w-[13px] shrink-0 text-center text-gray-400">•</span>
                )}
                <span className="truncate">{h.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-gray-500">
                  {h.kind === 'catalog' ? t('objects.hitCatalog') : t('objects.hitList')}
                </span>
              </div>
            ))}
          {load.status === 'ok' && load.data.truncated && (
            <p className="mt-1 text-xs text-amber-300">{t('objects.moreHits')}</p>
          )}
        </div>
    )
  }

  function lowerPart(): ReactNode {
    const load = list?.load
    return (
      <div className="flex-1 min-h-0 flex flex-col border-t border-surface-600">
        <div className="flex gap-2 px-3 py-1 text-[11px] text-gray-400 border-b border-surface-600">
          {header('name', t('objects.colName'), 'flex-[3]')}
          {header('type', t('objects.colType'), 'flex-1')}
          {header('class', t('objects.colClass'), 'flex-1')}
        </div>
        <div ref={listRows.ref} onScroll={listRows.onScroll} className="flex-1 min-h-0 overflow-y-auto px-1 py-1">
          {selected?.kind !== 'node' && <p className="px-2 text-xs text-gray-500">{t('objects.selectNode')}</p>}
          {selected?.kind === 'node' && (load?.status === 'loading' || list?.key !== listKey) && <Spinner indent={8} />}
          {selected?.kind === 'node' && list?.key === listKey && load?.status === 'error' && (
            <ErrorLine error={load.error} retry={() => loadList(selected.section, selected.id)} indent={8} />
          )}
          {selected?.kind === 'node' && list?.key === listKey && load?.status === 'ok' && objects.length === 0 && (
            <p className="px-2 text-xs text-gray-500">{t('objects.listEmpty')}</p>
          )}
          <div style={{ height: listRows.padTop }} />
          {objects.slice(listRows.start, listRows.end).map(o => {
            const isSel = o.ref === selectedRow
            return (
              <div
                key={o.ref}
                draggable
                onDragStart={e => dragStart(e, { ref: o.ref, name: o.name, type: o.typeAlias ?? '' })}
                onClick={() => setSelectedRow(o.ref)}
                title={[o.name, o.typeAlias, o.class].filter(Boolean).join(' · ')}
                className={`flex gap-2 items-center cursor-default select-none rounded px-2 text-xs ${
                  isSel ? 'bg-accent text-white' : 'hover:bg-surface-600'
                }`}
                style={{ height: ROW }}
              >
                <span className="flex-[3] truncate">{o.name}</span>
                <span className={`flex-1 truncate ${isSel ? '' : 'text-gray-400'}`}>{o.typeAlias || '—'}</span>
                <span className={`flex-1 truncate ${isSel ? '' : 'text-gray-400'}`}>{o.class || '—'}</span>
              </div>
            )
          })}
          <div style={{ height: listRows.padBottom }} />
        </div>
        {selected?.kind === 'node' && list?.key === listKey && load?.status === 'ok' && (
          <div className="px-3 py-1 text-[11px] text-gray-500 border-t border-surface-600">
            {t('objects.count', { count: objects.length })}
          </div>
        )}
      </div>
    )
  }

  const queryOk = [...query.trim()].length >= 2
  return (
    <PanelShell title={t('objects.title')} onClose={onClose} topic="objects" wide fill>
      <div className="flex items-center gap-1 px-2 py-2 border-b border-surface-600">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="search"
            value={query}
            disabled={!scope}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runSearch()}
            placeholder={scope ? t('objects.searchIn', { section: scope.name }) : t('objects.searchNoSection')}
            title={scope && !queryOk ? t('objects.searchMin') : undefined}
            className="w-full rounded bg-surface-800 border border-surface-600 pl-7 pr-2 py-1 text-xs text-gray-100 disabled:opacity-60"
          />
        </div>
        {search && (
          <button
            type="button"
            onClick={() => setSearch(null)}
            title={t('objects.backToTree')}
            aria-label={t('objects.backToTree')}
            className="p-1 text-gray-400 hover:text-white"
          >
            <X size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={reloadAll}
          title={t('objects.reload')}
          aria-label={t('objects.reload')}
          className="p-1 text-gray-400 hover:text-white"
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {upperPart()}
      {lowerPart()}
    </PanelShell>
  )
}
