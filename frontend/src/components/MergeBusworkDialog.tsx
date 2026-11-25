import { useEffect, useState } from 'react'
import { t } from '../i18n'
import type { Connector } from '../types'

/** Asks which of wires (a buswork chain, see diagramOps.busworkChain) the merged wire keeps; the lowest id is
 * preselected. onMerge gets the chosen id; onClose (also Esc or a backdrop click) cancels. */
export function MergeBusworkDialog({
  wires,
  onMerge,
  onClose,
}: {
  wires: Connector[]
  onMerge: (keepId: number) => void
  onClose: () => void
}) {
  const [keepId, setKeepId] = useState(() => Math.min(...wires.map(c => c.id)))

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-96 rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3 text-xs">
          <h2 className="text-sm font-semibold text-gray-100">{t('mergeBuswork.title')}</h2>
          <p className="text-gray-300">{t('mergeBuswork.message', { count: wires.length })}</p>
          <div className="max-h-64 overflow-auto space-y-1">
            {[...wires]
              .sort((a, b) => a.id - b.id)
              .map(c => (
                <label key={c.id} className="flex items-center gap-2 text-gray-200 cursor-pointer">
                  <input type="radio" name="merge-keep" checked={keepId === c.id} onChange={() => setKeepId(c.id)} />
                  <span>ID {c.id}</span>
                  {c.name && <span className="text-gray-400 truncate">{c.name}</span>}
                </label>
              ))}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 text-gray-200"
            >
              {t('mergeBuswork.cancel')}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => onMerge(keepId)}
              className="px-3 py-1 rounded bg-accent hover:bg-accent-hover text-white"
            >
              {t('mergeBuswork.merge')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
