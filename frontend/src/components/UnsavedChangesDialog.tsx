import { useEffect, useState } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import type { UnsavedChoice } from '../state/useDiagramContext'
import { t } from '../i18n'
import { GuideButton } from './GuideButton'

/** Asked before a diagram with unsaved edits would be replaced (opening
 * another one, New, or a single-file import; see DiagramContext's
 * confirmLeave): Save writes it first, Don't save drops the edits and their
 * recovery draft, Cancel (also Esc or a backdrop click) keeps it open and
 * abandons the action. Drawn above the other dialogs, since New asks from
 * inside its own. */
export function UnsavedChangesDialog() {
  const { unsavedPrompt, resolveUnsavedPrompt } = useDiagramContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!unsavedPrompt) return
    setError(null)
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') void resolveUnsavedPrompt('cancel')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [unsavedPrompt, resolveUnsavedPrompt])

  if (!unsavedPrompt) return null

  async function answer(choice: UnsavedChoice) {
    setBusy(true)
    setError(null)
    try {
      await resolveUnsavedPrompt(choice)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={() => !busy && void answer('cancel')} />
      <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-96 rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3 text-xs">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">
            {t('unsaved.title')}
            <GuideButton topic="unsaved" />
          </h2>
          <p className="text-gray-300 break-words">{t('unsaved.message', { name: unsavedPrompt.diagramName })}</p>
          {error && <p className="text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void answer('cancel')}
              className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 disabled:opacity-50 text-gray-200"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void answer('discard')}
              className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 disabled:opacity-50 text-gray-200"
            >
              {t('unsaved.discard')}
            </button>
            <button
              type="button"
              autoFocus
              disabled={busy}
              onClick={() => void answer('save')}
              className="px-3 py-1 rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
            >
              {t('unsaved.save')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
