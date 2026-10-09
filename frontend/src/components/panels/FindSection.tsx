import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useDiagramContext, type SelectionKind } from '../../state/useDiagramContext'
import { findMatches, findTypes, type FindResult } from '../../lib/find'
import { GroupHeader } from './GroupHeader'
import { t } from '../../i18n'

// How many results are listed; the rest are counted ("…and N more").
const MAX_RESULTS = 200

// The last Ctrl/Cmd+F request (findFocusSeq) acted on. Module-level, since
// the request usually arrives just before this section mounts: it clears the
// selection, which switches Properties to the diagram view.
let handledFocusSeq = 0

/** The diagram Properties' Find section: finds elements, wires, text labels
 * and digital devices of the open diagram by name, label text, id or type
 * (lib/find.ts), with a type filter. Clicking a result (or ↑/↓ and Enter)
 * selects it and asks the canvas to centre on it (focusItem). The query and
 * filter live in DiagramContext, so they are still there after selecting a
 * result switches the panel to its properties and back. Ctrl/Cmd+F
 * (requestFind) expands and focuses it. */
export function FindSection() {
  const {
    diagram,
    elements,
    hiddenLayers,
    findQuery,
    findType,
    setFind,
    findFocusSeq,
    focusItem,
    selectElement,
    selectConnector,
    selectLabel,
    selectDigitalDevice,
  } = useDiagramContext()
  const [collapsed, setCollapsed] = useState(() => !findQuery && !findType)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const types = useMemo(() => (diagram ? findTypes(diagram, elements) : []), [diagram, elements])
  const results = useMemo(
    () => (diagram ? findMatches(diagram, elements, findQuery, findType) : []),
    [diagram, elements, findQuery, findType],
  )
  const shown = results.slice(0, MAX_RESULTS)

  useEffect(() => setActive(0), [findQuery, findType])

  // Ctrl/Cmd+F: expand and focus, also when this section mounts because of it.
  useEffect(() => {
    if (findFocusSeq <= handledFocusSeq) return
    handledFocusSeq = findFocusSeq
    setCollapsed(false)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [findFocusSeq])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!diagram) return null

  function open(r: FindResult) {
    const select: Record<SelectionKind, (id: number) => void> = {
      element: selectElement,
      connector: selectConnector,
      label: selectLabel,
      digitaldevice: selectDigitalDevice,
    }
    select[r.kind](r.id)
    focusItem(r.id, r.kind)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(i => Math.min(i + 1, shown.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && shown[active]) {
      e.preventDefault()
      open(shown[active])
    } else if (e.key === 'Escape' && findQuery) {
      e.stopPropagation()
      setFind('', findType)
    }
  }

  return (
    <section>
      <GroupHeader label={t('find.title')} collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} topic="find" />
      {!collapsed && (
        <div className="space-y-1.5 text-xs">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              ref={inputRef}
              type="search"
              className="w-full bg-surface-800 border border-surface-600 rounded pl-6 pr-2 py-1"
              placeholder={t('find.placeholder')}
              value={findQuery}
              onChange={e => setFind(e.target.value, findType)}
              onKeyDown={onKeyDown}
            />
          </div>
          <select
            className="w-full bg-surface-800 border border-surface-600 rounded px-1.5 py-1"
            value={findType}
            onChange={e => setFind(findQuery, e.target.value)}
          >
            <option value="">{t('find.allTypes')}</option>
            {types.map(ft => (
              <option key={ft.key} value={ft.key}>
                {ft.label} ({ft.count})
              </option>
            ))}
          </select>
          {(findQuery.trim() || findType) &&
            (shown.length === 0 ? (
              <p className="text-gray-500">{t('find.noResults')}</p>
            ) : (
              <ul ref={listRef} className="max-h-72 overflow-y-auto rounded border border-surface-600 divide-y divide-surface-600">
                {shown.map((r, i) => {
                  const hidden = hiddenLayers.has(r.layer)
                  return (
                    <li key={`${r.kind}-${r.id}`} data-index={i}>
                      <button
                        type="button"
                        onClick={() => open(r)}
                        onMouseEnter={() => setActive(i)}
                        title={hidden ? t('find.hiddenLayer') : undefined}
                        className={`w-full text-left px-2 py-1 ${i === active ? 'bg-surface-600' : 'hover:bg-surface-600'} ${
                          hidden ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="flex items-baseline gap-1.5">
                          <span className="flex-1 min-w-0 truncate text-gray-100">{r.name || r.typeLabel}</span>
                          <span className="shrink-0 tabular-nums text-gray-500">#{r.id}</span>
                        </div>
                        {r.name && <div className="truncate text-[10px] text-gray-400">{r.typeLabel}</div>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ))}
          {results.length > MAX_RESULTS && (
            <p className="text-gray-500">{t('find.more', { count: results.length - MAX_RESULTS })}</p>
          )}
          <p className="text-[10px] text-gray-500">{t('find.hint')}</p>
        </div>
      )}
    </section>
  )
}
