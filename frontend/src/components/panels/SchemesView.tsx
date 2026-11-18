import { useState } from 'react'
import { CloudDownload, FilePlus, FolderOpen, Loader2, RefreshCw, Search } from 'lucide-react'
import { t } from '../../i18n'
import * as api from '../../lib/api'
import { joinDiagramPath } from '../../lib/diagramPath'
import { useSchemeTree } from '../../lib/schemes'
import { useDiagramContext } from '../../state/useDiagramContext'
import { GuideButton } from '../GuideButton'
import { SchemeTreeList } from '../SchemeTreeList'
import type { FetchedScheme, ProviderScheme } from '../../types'

type Filter = 'all' | 'linked' | 'unlinked'

/** A diagram name from a scheme name: "/" and "\" become "-". */
function diagramNameOf(s: ProviderScheme): string {
  return (s.name || `scheme ${s.ref}`).replace(/[/\\]/g, '-').trim()
}

/** The File panel's RSDU schemes tab: the provider's group → scheme tree, each scheme with its linked diagram. A
 * linked scheme opens its diagram; an unlinked one can get a new empty diagram linked to it, named after the scheme,
 * in a folder the user types (the File panel's current one by default), or, when the provider can fetch it, a diagram
 * imported from the scheme's own picture (Edit from RSDU…), in the folder of its file name or the current one. */
export function SchemesView({ provider }: { provider: string }) {
  const { openDiagram, newDiagram, editFromScheme, currentDir, diagramName, config } = useDiagramContext()
  const canFetch = !!config?.bindings?.fetch
  const { tree, error, reload } = useSchemeTree(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [creating, setCreating] = useState<{
    scheme: ProviderScheme
    folder: string
    name: string
    fetched?: FetchedScheme
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setActionError(null)
    try {
      await action()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function create() {
    if (!creating) return
    const name = joinDiagramPath(creating.folder.trim().replace(/^\/+|\/+$/g, ''), creating.name.trim())
    const { scheme, fetched } = creating
    run(async () => {
      const done = fetched
        ? await editFromScheme(fetched, scheme.ref, name)
        : await newDiagram(name, undefined, undefined, undefined, { source: provider, ref: scheme.ref })
      if (done) {
        setCreating(null)
        reload()
      }
    })
  }

  function fetchScheme(s: ProviderScheme) {
    run(async () => {
      const fetched = await api.fetchScheme(s.ref)
      setCreating({ scheme: s, folder: fetched.folder || currentDir, name: fetched.name, fetched })
    })
  }

  function row(s: ProviderScheme) {
    const isCreating = creating?.scheme.ref === s.ref
    return (
      <div className={`rounded px-1 py-0.5 ${s.diagram && s.diagram === diagramName ? 'bg-surface-600' : 'hover:bg-surface-600'}`}>
        <div className="flex items-center gap-1" title={s.fileName ? `${s.fileName} (${s.ref})` : s.ref}>
          <span className="flex-1 min-w-0 truncate text-gray-100">{s.name || s.ref}</span>
          {s.diagram ? (
            <button
              type="button"
              disabled={busy}
              title={t('schemes.open')}
              aria-label={t('schemes.open')}
              onClick={() => run(() => openDiagram(s.diagram!))}
              className="shrink-0 p-0.5 text-gray-400 hover:text-white disabled:opacity-40"
            >
              <FolderOpen size={12} />
            </button>
          ) : (
            <>
              {canFetch && (
                <button
                  type="button"
                  disabled={busy}
                  title={t('schemes.editFromProvider')}
                  aria-label={t('schemes.editFromProvider')}
                  onClick={() => (isCreating && creating?.fetched ? setCreating(null) : fetchScheme(s))}
                  className="shrink-0 p-0.5 text-gray-400 hover:text-white disabled:opacity-40"
                >
                  <CloudDownload size={12} />
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                title={t('schemes.newDiagram')}
                aria-label={t('schemes.newDiagram')}
                onClick={() =>
                  setCreating(isCreating && !creating?.fetched ? null : { scheme: s, folder: currentDir, name: diagramNameOf(s) })
                }
                className="shrink-0 p-0.5 text-gray-400 hover:text-white disabled:opacity-40"
              >
                <FilePlus size={12} />
              </button>
            </>
          )}
        </div>
        <div className="truncate text-[11px] text-gray-500">
          {s.diagram ? t('schemes.linkedTo', { name: s.diagram }) : t('schemes.notLinkedScheme')}
        </div>
        {isCreating && creating && (
          <div className="mt-1 space-y-1 rounded border border-surface-600 bg-surface-800 p-1.5">
            {creating.fetched && <FetchedSummary fetched={creating.fetched} />}
            <label className="block">
              <span className="block text-gray-400">{t('schemes.folder')}</span>
              <input
                value={creating.folder}
                placeholder="/"
                onChange={e => setCreating({ ...creating, folder: e.target.value })}
                className="w-full bg-surface-900 border border-surface-600 rounded px-1.5 py-0.5"
              />
            </label>
            <label className="block">
              <span className="block text-gray-400">{t('file.name')}</span>
              <input
                autoFocus
                value={creating.name}
                onChange={e => setCreating({ ...creating, name: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && create()}
                className="w-full bg-surface-900 border border-surface-600 rounded px-1.5 py-0.5"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(null)} className="px-1.5 text-gray-300 hover:text-white">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={busy || !creating.name.trim()}
                onClick={create}
                className="rounded bg-accent px-2 py-0.5 text-white hover:opacity-90 disabled:opacity-50"
              >
                {creating.fetched ? t('schemes.createFetched') : t('schemes.create')}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const shown = tree && {
    groups: tree.groups,
    schemes: tree.schemes.filter(s => filter === 'all' || (filter === 'linked') === !!s.diagram),
  }
  const linkedCount = tree?.schemes.filter(s => s.diagram).length ?? 0

  return (
    <section className="space-y-1.5 text-xs">
      <div className="flex items-center gap-1.5">
        <h3 className="uppercase tracking-wide text-gray-400">{t('schemes.tabSchemes')}</h3>
        <GuideButton topic="rsdu-schemes" />
        <button
          type="button"
          onClick={reload}
          title={t('schemes.reload')}
          aria-label={t('schemes.reload')}
          className="ml-auto text-gray-400 hover:text-white"
        >
          <RefreshCw size={12} />
        </button>
      </div>
      {tree && <p className="text-[11px] text-gray-500">{t('schemes.counts', { total: tree.schemes.length, linked: linkedCount })}</p>}
      <div className="relative">
        <Search size={12} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('schemes.filter')}
          aria-label={t('schemes.filter')}
          className="w-full bg-surface-800 border border-surface-600 rounded pl-6 pr-1.5 py-0.5"
        />
      </div>
      <select
        value={filter}
        onChange={e => setFilter(e.target.value as Filter)}
        aria-label={t('schemes.show')}
        className="w-full bg-surface-800 border border-surface-600 rounded px-1 py-0.5"
      >
        <option value="all">{t('schemes.showAll')}</option>
        <option value="linked">{t('schemes.showLinked')}</option>
        <option value="unlinked">{t('schemes.showUnlinked')}</option>
      </select>
      {error ? (
        <div className="space-y-1">
          <p className="text-red-300 break-words">{t('schemes.loadFailed', { error })}</p>
          <button type="button" onClick={reload} className="flex items-center gap-1 text-gray-300 hover:text-white">
            <RefreshCw size={12} />
            {t('schemes.retry')}
          </button>
        </div>
      ) : !shown ? (
        <Loader2 size={12} className="animate-spin text-gray-400" />
      ) : (
        <SchemeTreeList tree={shown} query={query} renderScheme={row} />
      )}
      {actionError && <p className="text-red-300 break-words">{actionError}</p>}
    </section>
  )
}

/** What Edit from RSDU… read: the file and what its import recognised and skipped (the full import log opens with the
 * diagram). */
function FetchedSummary({ fetched }: { fetched: FetchedScheme }) {
  const r = fetched.report
  const skipped = r.skipped.reduce((n, e) => n + e.count, 0)
  return (
    <div className="space-y-0.5 text-[11px]">
      <div className="truncate text-gray-400" title={fetched.file}>
        {t('schemes.fetchedFile', { file: fetched.file })}
      </div>
      <div className="text-gray-300">{t('schemes.fetchedCounts', { elements: r.elements, connectors: r.connectors })}</div>
      {(skipped > 0 || r.failed.length > 0) && (
        <div className="text-amber-300">{t('schemes.fetchedLost', { skipped, failed: r.failed.length })}</div>
      )}
    </div>
  )
}
