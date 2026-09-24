import { useEffect, useState } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import { t } from '../i18n'

/** A centered modal (backdrop click or Esc cancels, same as
 * NewDiagramDialog/ImportLogDialog) shown when a dropped/picked .xsld/.svg
 * would take the name of a diagram that already exists on the server
 * (DiagramContext's pendingImport): Reload loads the file anyway — the
 * next Save then overwrites the server copy — Cancel leaves the currently
 * open diagram untouched. */
export function ConfirmReloadDialog() {
  const { pendingImport, confirmPendingImport, cancelPendingImport } = useDiagramContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') cancelPendingImport()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelPendingImport])

  if (!pendingImport) return null

  async function reload() {
    setBusy(true)
    setError(null)
    try {
      await confirmPendingImport()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/50" onClick={cancelPendingImport} />
      <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-96 rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3 text-xs">
          <h2 className="text-sm font-semibold text-gray-100">{t('reload.title')}</h2>
          <p className="text-gray-300 break-words">
            {t('reload.message', { name: pendingImport.name, file: pendingImport.fileName })}
          </p>
          {error && <p className="text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={cancelPendingImport}
              className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 disabled:opacity-50 text-gray-200"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              autoFocus
              disabled={busy}
              onClick={reload}
              className="px-3 py-1 rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
            >
              {t('reload.reload')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
