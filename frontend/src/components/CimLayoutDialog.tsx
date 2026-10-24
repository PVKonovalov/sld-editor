import { useEffect } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import { t } from '../i18n'
import { GuideButton } from './GuideButton'

/** Asked during a CIM import whose diagram layout another tool made (DiagramContext's cimLayoutPrompt): follow that
 * layout (also Esc or a backdrop click), or lay each substation out automatically, a diagram each. */
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
  const { fileName, diagrams } = cimLayoutPrompt

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
            <p className="text-gray-400 mt-1">{t('cimLayout.message', { file: fileName, count: diagrams })}</p>
          </div>
          <ul className="list-disc pl-4 space-y-1 text-gray-300">
            <li>{t('cimLayout.modelHint')}</li>
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
