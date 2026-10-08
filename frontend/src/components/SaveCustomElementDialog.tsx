import { useEffect, useState } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import { ConflictError } from '../lib/api'
import { t } from '../i18n'
import { GuideButton } from './GuideButton'
import type { Diagram } from '../types'

/** "Save selection as custom element": asks for a name and saves template
 * (the selection, already turned into a standalone diagram by
 * diagramOps.extractSelection) to the server's custom-elements directory.
 * A taken name switches the dialog to an overwrite confirmation instead of
 * failing outright. Backdrop click or Esc dismisses it. */
export function SaveCustomElementDialog({ template, onClose }: { template: Diagram; onClose: () => void }) {
  const { saveCustomElement } = useDiagramContext()
  const [name, setName] = useState('')
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function submit(overwrite: boolean) {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      await saveCustomElement(trimmed, template, overwrite)
      onClose()
    } catch (e) {
      if (e instanceof ConflictError) setConflict(true)
      else setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-80 rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">
            {t('customElement.saveTitle')}
            <GuideButton topic="custom-elements" />
          </h2>

          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('file.name')}</span>
            <input
              autoFocus
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              placeholder={t('customElement.namePlaceholder')}
              value={name}
              onChange={e => {
                setName(e.target.value)
                setConflict(false)
              }}
              onKeyDown={e => e.key === 'Enter' && submit(conflict)}
            />
          </label>

          {conflict && <p className="text-xs text-amber-400">{t('customElement.exists', { name: name.trim() })}</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-xs rounded border border-surface-600 text-gray-300 hover:bg-surface-600"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={() => submit(conflict)}
              className="px-3 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
            >
              {conflict ? t('customElement.overwrite') : t('customElement.save')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
