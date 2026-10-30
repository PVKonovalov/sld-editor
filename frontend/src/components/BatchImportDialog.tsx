import { useEffect, useState } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import { t } from '../i18n'
import { GuideButton } from './GuideButton'
import { ConverterMessages } from './ConverterMessages'
import { stripDiagramExtension } from '../lib/fileTransfer'
import { baseName } from '../lib/diagramPath'

const STATUS_CLASS = {
  saved: 'text-green-400',
  skipped: 'text-yellow-300',
  failed: 'text-red-400',
} as const

/** A centered modal (backdrop click or Esc closes, same as the other
 * dialogs) listing the outcome of the last multi-file import
 * (DiagramContext.batchImport): the target folder, then each file as
 * Saved / Skipped (a diagram of that name already exists) / Failed, with a
 * render warning or error message when there is one. "Overwrite skipped"
 * re-runs just the skipped files, replacing the server's own copies
 * (overwriteBatchSkipped). */
export function BatchImportDialog() {
  const { batchImport, overwriteBatchSkipped, closeBatchImport } = useDiagramContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openMessages, setOpenMessages] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeBatchImport()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeBatchImport])

  if (!batchImport) return null
  const { dir, files, items, opened } = batchImport
  const severalDiagrams = files.length === 1 && items.length > 1
  const count = (status: keyof typeof STATUS_CLASS) => items.filter(i => i.status === status).length
  const skipped = count('skipped')

  async function overwrite() {
    setBusy(true)
    setError(null)
    try {
      await overwriteBatchSkipped()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/50" onClick={closeBatchImport} />
      <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-[30rem] max-h-[80vh] flex flex-col rounded border border-surface-600 bg-surface-700 p-4 shadow-lg text-xs space-y-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">
              {t('batchImport.title')}
              <GuideButton topic="import" />
            </h2>
            <p className="text-[11px] text-gray-500 break-all">{t('batchImport.folder', { dir: dir || '/' })}</p>
            {severalDiagrams && (
              <p className="text-amber-300 mt-1">
                {t('batchImport.severalDiagrams', { file: files[0].name, count: items.length })}{' '}
                {opened
                  ? t('batchImport.openedFirst', { name: opened.split('/').pop() ?? opened })
                  : t('batchImport.noneOpened')}
              </p>
            )}
            <p className="text-gray-400 mt-1">
              {t('batchImport.summary', { saved: count('saved'), skipped, failed: count('failed') })}
            </p>
          </div>

          <ul className="flex-1 overflow-y-auto space-y-1">
            {items.map(item => {
              const target = baseName(item.name)
              const problems = item.messages?.filter(m => m.level !== 'INFO').length ?? 0
              return (
                <li key={item.name} className="flex gap-2">
                  <span className={`w-20 shrink-0 ${STATUS_CLASS[item.status]}`}>{t(`batchImport.${item.status}`)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-gray-100 break-all">
                      {item.fileName}
                      {target !== stripDiagramExtension(item.fileName) && <span className="text-gray-400"> → {target}</span>}
                    </span>
                    {item.message && <span className="block text-gray-500 break-words">{item.message}</span>}
                    {item.messages && item.messages.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setOpenMessages(openMessages === item.name ? null : item.name)}
                        className={`block hover:underline ${problems > 0 ? 'text-yellow-300' : 'text-gray-400'}`}
                      >
                        {t('batchImport.messages', { count: item.messages.length })}
                      </button>
                    )}
                    {openMessages === item.name && item.messages && (
                      <div className="mt-1 pl-2 border-l border-surface-600">
                        <ConverterMessages messages={item.messages} />
                      </div>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>

          {error && <p className="text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            {skipped > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={overwrite}
                className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 disabled:opacity-50 text-gray-200"
              >
                {t('batchImport.overwrite', { count: skipped })}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={closeBatchImport}
              className="px-3 py-1 rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
