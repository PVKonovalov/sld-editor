import { useEffect } from 'react'
import { t } from '../i18n'

/** A centered modal (backdrop click or Esc closes, same as the other
 * dialogs) opened from the sidebar's About button: the program icon
 * (public/favicon.svg), name, version (__APP_VERSION__, the git tag the
 * build came from — see vite.config.ts) and a one-line description. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
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
      <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
        <div
          role="dialog"
          aria-label={t('about.title')}
          className="pointer-events-auto w-80 rounded border border-surface-600 bg-surface-700 p-5 shadow-lg text-xs text-center space-y-3"
        >
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="w-16 h-16 mx-auto rounded" />
          <div>
            <h2 className="text-base font-semibold text-gray-100">{t('about.appName')}</h2>
            <p className="text-gray-400 tabular-nums mt-0.5">{t('about.version', { version: __APP_VERSION__ })}</p>
          </div>
          <p className="text-gray-400">{t('about.description')}</p>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="px-3 py-1 rounded bg-accent hover:bg-accent-hover text-white"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </>
  )
}
