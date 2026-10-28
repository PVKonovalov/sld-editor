import { useEffect } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import { t } from '../i18n'
import { GuideButton } from './GuideButton'
import { formatTimestamp } from '../lib/revision'

/** Asked during a CIM import with a diagram layout, this editor's export or another tool's (DiagramContext's
 * cimLayoutPrompt), with who exported the file as its layout document states: follow that layout (also Esc or a
 * backdrop click), or lay each substation out automatically, a diagram each. */
export function CimLayoutDialog() {
  const { cimLayoutPrompt, resolveCimLayoutPrompt } = useDiagramContext()

  useEffect(() => {
    if (!cimLayoutPrompt) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') resolveCimLayoutPrompt('model')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cimLayoutPrompt, resolveCimLayoutPrompt])

  if (!cimLayoutPrompt) return null
  const { fileName, diagrams, own, source } = cimLayoutPrompt
  const created = source?.created && !Number.isNaN(Date.parse(source.created)) ? formatTimestamp(source.created) : source?.created
  const rows = [
    [t('cimLayout.authority'), source?.authoritySet],
    [t('cimLayout.description'), source?.description],
    [t('cimLayout.created'), created],
  ].filter((r): r is [string, string] => !!r[1])

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={() => resolveCimLayoutPrompt('model')} />
      <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-[28rem] rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3 text-xs">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">
              {t('cimLayout.title')}
              <GuideButton topic="cim-import" />
            </h2>
            <p className="text-gray-400 mt-1">
              {t(own ? 'cimLayout.ownMessage' : 'cimLayout.message', { file: fileName, count: diagrams })}
            </p>
          </div>
          <div>
            <div className="text-gray-400">{t('cimLayout.source')}</div>
            {rows.length > 0 ? (
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                {rows.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-gray-400">{label}</dt>
                    <dd className="text-gray-200 break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="mt-1 text-gray-500">{t('cimLayout.noSource')}</div>
            )}
          </div>
          <ul className="list-disc pl-4 space-y-1 text-gray-300">
            <li>{t(own ? 'cimLayout.ownModelHint' : 'cimLayout.modelHint')}</li>
            <li>{t('cimLayout.autoHint')}</li>
          </ul>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => resolveCimLayoutPrompt('auto')}
              className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 text-gray-200"
            >
              {t('cimLayout.auto')}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => resolveCimLayoutPrompt('model')}
              className="px-3 py-1 rounded bg-accent hover:bg-accent-hover text-white"
            >
              {t('cimLayout.model')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
