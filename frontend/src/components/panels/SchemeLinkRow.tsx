import { useEffect, useState } from 'react'
import { CloudDownload, Link2, Link2Off, Loader2, Lock } from 'lucide-react'
import { t } from '../../i18n'
import * as api from '../../lib/api'
import * as diagramOps from '../../lib/diagramOps'
import { useDiagramContext } from '../../state/useDiagramContext'
import { SchemePicker } from '../SchemePicker'
import type { ProviderScheme, SchemeRef } from '../../types'

type Looked = { status: 'busy' } | { status: 'found'; scheme: ProviderScheme } | { status: 'missing' } | { status: 'unknown'; error: string }

/** The scheme the open diagram is linked to: its name as the provider has it (missing when the provider no longer
 * has it), when it was last exported, Link… / Change… (the scheme picker) and Unlink. Both are undoable edits saved
 * with the diagram. schemes: the provider links diagrams to schemes; otherwise the link is shown read-only. When the
 * provider can fetch the scheme's picture, Re-fetch replaces the diagram with it after a confirmation. */
export function SchemeLinkRow({ provider, scheme, schemes }: { provider: string; scheme?: SchemeRef; schemes: boolean }) {
  const { diagram, diagramName, updateDiagram, refetchScheme, config } = useDiagramContext()
  const [looked, setLooked] = useState<Looked | null>(null)
  const [picking, setPicking] = useState(false)
  const [refetch, setRefetch] = useState<{ status: 'confirm' | 'busy' } | { status: 'failed'; error: string } | null>(null)
  const own = !!scheme && scheme.source === provider

  useEffect(() => {
    if (!own || !schemes) {
      setLooked(null)
      return
    }
    let live = true
    setLooked({ status: 'busy' })
    api.getScheme(scheme.ref).then(
      s => live && setLooked({ status: 'found', scheme: s }),
      e =>
        live &&
        setLooked(
          e instanceof api.SchemeNotFoundError
            ? { status: 'missing' }
            : { status: 'unknown', error: e instanceof Error ? e.message : String(e) },
        ),
    )
    return () => {
      live = false
    }
  }, [own, schemes, scheme?.ref])

  function runRefetch() {
    setRefetch({ status: 'busy' })
    refetchScheme().then(
      () => setRefetch(null),
      e => setRefetch({ status: 'failed', error: e instanceof Error ? e.message : String(e) }),
    )
  }

  function pick(s: ProviderScheme) {
    setPicking(false)
    updateDiagram(d => diagramOps.setDiagramScheme(d, { source: provider, ref: s.ref }))
  }

  const exported = scheme?.exported ? new Date(scheme.exported).toLocaleString() : null
  return (
    <div className="text-xs space-y-1">
      <span className="block text-gray-400">{t('bindings.scheme')}</span>
      {scheme ? (
        <div className="rounded border border-surface-600 bg-surface-800 px-2 py-1 space-y-0.5" title={`${scheme.source}:${scheme.ref}`}>
          <div className="flex items-center gap-1">
            <span className="flex-1 truncate text-gray-200">
              {looked?.status === 'found' ? looked.scheme.name || scheme.ref : scheme.ref}
            </span>
            {looked?.status === 'busy' && <Loader2 size={12} className="animate-spin text-gray-400" />}
            {!own && (
              <span title={t('bindings.otherSource', { source: scheme.source })} className="text-gray-400">
                <Lock size={12} aria-label={t('bindings.otherSource', { source: scheme.source })} />
              </span>
            )}
          </div>
          {looked?.status === 'found' && looked.scheme.fileName && (
            <div className="truncate text-[11px] text-gray-500">{looked.scheme.fileName}</div>
          )}
          <div className="text-[11px] text-gray-500">
            {exported ? t('schemes.exportedAt', { time: exported }) : t('schemes.neverExported')}
          </div>
          {looked?.status === 'missing' && <div className="text-[11px] text-red-300">{t('schemes.missing', { ref: scheme.ref })}</div>}
          {looked?.status === 'unknown' && (
            <div className="text-[11px] text-gray-400 break-words">{t('schemes.unknown', { error: looked.error })}</div>
          )}
        </div>
      ) : (
        <span className="block text-gray-500 px-2">{t('schemes.notLinked')}</span>
      )}
      {schemes && (!scheme || own) && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="flex items-center gap-1 rounded border border-surface-500 px-2 py-0.5 hover:bg-surface-600"
          >
            <Link2 size={12} />
            {scheme ? t('schemes.change') : t('schemes.linkEllipsis')}
          </button>
          {scheme && (
            <button
              type="button"
              onClick={() => updateDiagram(d => diagramOps.setDiagramScheme(d, undefined))}
              className="flex items-center gap-1 rounded border border-surface-500 px-2 py-0.5 hover:bg-surface-600"
            >
              <Link2Off size={12} />
              {t('schemes.unlink')}
            </button>
          )}
        </div>
      )}
      {schemes && own && config?.bindings?.fetch && (
        <div className="space-y-1">
          {refetch?.status === 'confirm' ? (
            <div className="rounded border border-amber-700/60 bg-surface-800 p-1.5 space-y-1">
              <p className="text-amber-200">{t('schemes.refetchConfirm')}</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setRefetch(null)} className="px-1.5 text-gray-300 hover:text-white">
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={runRefetch}
                  className="rounded bg-accent px-2 py-0.5 text-white hover:opacity-90"
                >
                  {t('schemes.refetch')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={refetch?.status === 'busy'}
              onClick={() => setRefetch({ status: 'confirm' })}
              className="flex items-center gap-1 rounded border border-surface-500 px-2 py-0.5 hover:bg-surface-600 disabled:opacity-50"
            >
              {refetch?.status === 'busy' ? <Loader2 size={12} className="animate-spin" /> : <CloudDownload size={12} />}
              {t('schemes.refetch')}
            </button>
          )}
          {refetch?.status === 'failed' && (
            <p className="text-[11px] text-red-300 break-words">{t('schemes.refetchFailed', { error: refetch.error })}</p>
          )}
        </div>
      )}
      {picking && diagram && (
        <SchemePicker
          name={diagramName ?? ''}
          source={diagram.source}
          current={own ? scheme?.ref : undefined}
          onPick={pick}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}
