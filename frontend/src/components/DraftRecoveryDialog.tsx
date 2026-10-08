import { useState } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import { t } from '../i18n'
import { GuideButton } from './GuideButton'

/** Offers the recovery drafts (lib/drafts.ts) of diagrams whose edits never
 * reached the server: on startup, or when such a diagram is opened again.
 * Restore makes one the working diagram, still unsaved; Discard deletes it;
 * Decide later closes the dialog and keeps the drafts. */
export function DraftRecoveryDialog() {
  const { recoverableDrafts, restoreDraft, discardDraft, closeDraftRecovery } = useDiagramContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (recoverableDrafts.length === 0) return null

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" />
      <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-[28rem] max-h-[80vh] overflow-y-auto rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3 text-xs">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">
            {t('drafts.title')}
            <GuideButton topic="unsaved" />
          </h2>
          <p className="text-gray-300">{t('drafts.message')}</p>
          <ul className="space-y-2">
            {recoverableDrafts.map(d => (
              <li key={d.name} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-gray-100 break-words">{d.name}</div>
                  <div className="text-[10px] text-gray-500">
                    {t('drafts.savedAt', { time: new Date(d.savedAt).toLocaleString() })}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => discardDraft(d.name))}
                  className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 disabled:opacity-50 text-gray-200"
                >
                  {t('drafts.discard')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => restoreDraft(d.name))}
                  className="px-3 py-1 rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
                >
                  {t('drafts.restore')}
                </button>
              </li>
            ))}
          </ul>
          {error && <p className="text-red-400">{error}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={closeDraftRecovery}
              className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 disabled:opacity-50 text-gray-200"
            >
              {t('drafts.later')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
