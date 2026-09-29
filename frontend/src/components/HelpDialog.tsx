import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import * as api from '../lib/api'
import { locale, t } from '../i18n'

/** The sidebar's Help button: a large scrollable modal showing the user
 * guide (config user_guide, converted from Markdown to HTML by the backend
 * on every request — see GET /api/user-guide). Backdrop click, Esc or the
 * close button dismisses it. The HTML is goldmark's output with raw HTML
 * disabled, so it's safe to inject; styled by .guide-content
 * (styles/index.css). */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getUserGuide(locale)
      .then(h => !cancelled && setHtml(h))
      .catch(e => !cancelled && setError((e as Error).message))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none p-6">
        <div
          role="dialog"
          aria-label={t('help.title')}
          className="pointer-events-auto flex flex-col w-full max-w-3xl max-h-full rounded border border-surface-600 bg-surface-700 shadow-lg"
        >
          <div className="flex items-center justify-between px-4 py-2 border-b border-surface-600">
            <h2 className="text-sm font-semibold text-gray-100">{t('help.title')}</h2>
            <button
              type="button"
              autoFocus
              title={t('common.close')}
              aria-label={t('common.close')}
              onClick={onClose}
              className="p-1 rounded text-gray-400 hover:bg-surface-600 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-4">
            {error ? (
              <p className="text-xs text-red-400">{t('help.loadError', { error })}</p>
            ) : html === null ? (
              <p className="text-xs text-gray-400">{t('help.loading')}</p>
            ) : (
              <div className="guide-content" dangerouslySetInnerHTML={{ __html: html }} />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
