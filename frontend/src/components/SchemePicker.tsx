import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, Search } from 'lucide-react'
import { t } from '../i18n'
import * as api from '../lib/api'
import { useSchemeTree } from '../lib/schemes'
import { useEscapeKey } from '../lib/useEscapeKey'
import { GuideButton } from './GuideButton'
import { SchemeTreeList } from './SchemeTreeList'
import type { ProviderScheme, SchemeCandidate } from '../types'

/** Link to a scheme: the provider's scheme tree with the schemes proposed for the diagram name (its path; source is
 * the file it was imported from) on top, none chosen unless exactly one matches by path. A scheme linked to another
 * diagram can't be chosen. onPick gets the chosen scheme. */
export function SchemePicker({
  name,
  source,
  current,
  onPick,
  onClose,
}: {
  name: string
  source?: string
  current?: string
  onPick: (s: ProviderScheme) => void
  onClose: () => void
}) {
  const { tree, error, reload } = useSchemeTree(true)
  const [candidates, setCandidates] = useState<SchemeCandidate[] | null>(null)
  const [chosen, setChosen] = useState<ProviderScheme | null>(null)
  const [query, setQuery] = useState('')

  const takenBy = (s: ProviderScheme) => (s.diagram && s.diagram !== name ? s.diagram : '')

  useEffect(() => {
    let live = true
    api.suggestSchemes(name, source).then(
      cs => {
        if (!live) return
        setCandidates(cs)
        const byPath = cs.filter(c => c.match === 'path' && !takenBy(c))
        if (byPath.length === 1 && byPath[0].ref !== current) setChosen(prev => prev ?? byPath[0])
      },
      () => live && setCandidates([]),
    )
    return () => {
      live = false
    }
  }, [name, source, current])

  useEscapeKey(onClose)

  function row(s: ProviderScheme, match?: SchemeCandidate['match']) {
    const holder = takenBy(s)
    const isCurrent = s.ref === current
    return (
      <label
        className={`flex items-start gap-1.5 rounded px-1 py-0.5 ${holder ? 'text-gray-500' : 'hover:bg-surface-600 cursor-pointer'}`}
        title={s.fileName ? `${s.fileName} (${s.ref})` : s.ref}
      >
        <input
          type="radio"
          name="scheme"
          className="mt-0.5"
          disabled={!!holder}
          checked={chosen?.ref === s.ref}
          onChange={() => setChosen(s)}
        />
        <span className="min-w-0">
          <span className="block truncate text-gray-100">
            {s.name || s.ref}
            {isCurrent && <span className="ml-1 text-[10px] text-gray-400">{t('schemes.current')}</span>}
            {match === 'name' && <span className="ml-1 text-[10px] text-amber-300">{t('schemes.ambiguous')}</span>}
          </span>
          <span className="block truncate text-[11px] text-gray-500">{s.fileName || '—'}</span>
          {holder && <span className="block truncate text-[11px] text-amber-300">{t('schemes.linkedTo', { name: holder })}</span>}
        </span>
      </label>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
        <div
          role="dialog"
          aria-label={t('schemes.pickTitle')}
          className="pointer-events-auto w-[30rem] max-h-[85vh] flex flex-col rounded border border-surface-600 bg-surface-700 p-4 shadow-lg gap-3 text-xs"
        >
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">
            {t('schemes.pickTitle')}
            <GuideButton topic="rsdu-schemes" />
          </h2>
          <p className="text-gray-400 truncate" title={name}>
            {t('schemes.pickFor', { name })}
          </p>
          <section>
            <h3 className="text-gray-400 mb-1">{t('schemes.candidates')}</h3>
            {candidates === null ? (
              <Loader2 size={12} className="animate-spin text-gray-400" />
            ) : candidates.length === 0 ? (
              <p className="text-gray-500">{t('schemes.noCandidates')}</p>
            ) : (
              <ul className="max-h-40 overflow-auto space-y-0.5">
                {candidates.map(c => (
                  <li key={c.ref}>{row(c, c.match)}</li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-gray-400">{t('schemes.all')}</h3>
              <div className="relative flex-1">
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
            </div>
            <div className="flex-1 min-h-32 overflow-auto rounded border border-surface-600 bg-surface-800 p-1">
              {error ? (
                <div className="space-y-1">
                  <p className="text-red-300 break-words">{t('schemes.loadFailed', { error })}</p>
                  <button type="button" onClick={reload} className="flex items-center gap-1 text-gray-300 hover:text-white">
                    <RefreshCw size={12} />
                    {t('schemes.retry')}
                  </button>
                </div>
              ) : !tree ? (
                <Loader2 size={12} className="animate-spin text-gray-400" />
              ) : (
                <SchemeTreeList tree={tree} query={query} renderScheme={s => row(s)} />
              )}
            </div>
          </section>
          <p className="text-[11px] text-gray-500">{t('schemes.pickHint')}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-2 py-1 text-gray-300 hover:text-white">
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={!chosen || chosen.ref === current}
              onClick={() => chosen && onPick(chosen)}
              className="rounded bg-accent px-3 py-1 text-white hover:opacity-90 disabled:opacity-50"
            >
              {t('schemes.link')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
