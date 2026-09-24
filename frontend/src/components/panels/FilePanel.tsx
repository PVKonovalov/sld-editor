import { useRef, useState } from 'react'
import { Folder, ArrowUp } from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import { PanelShell } from './PanelShell'
import { NewDiagramDialog } from '../NewDiagramDialog'
import { t } from '../../i18n'
import { readFileAsText, readFilesAsText } from '../../lib/fileTransfer'
import { joinDiagramPath, parentDir } from '../../lib/diagramPath'

export function FilePanel({ onClose }: { onClose: () => void }) {
  const {
    currentDir,
    diagrams,
    browseDir,
    diagramName,
    openDiagram,
    importDiagramFile,
    importDiagramFiles,
    importLog,
    setImportLogOpen,
    error,
    clearError,
  } = useDiagramContext()
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setLocalError(null)
    clearError()
    try {
      await action()
    } catch (e) {
      setLocalError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <PanelShell title={t('sidebar.file')} onClose={onClose}>
      <div className="space-y-4">
        <section>
          <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('file.new')}</h3>
          <button
            type="button"
            disabled={busy}
            onClick={() => setNewDialogOpen(true)}
            className="w-full px-2 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
          >
            {t('file.new')}
          </button>
          {newDialogOpen && <NewDiagramDialog onClose={() => setNewDialogOpen(false)} />}
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('file.open')}</h3>
          <p className="text-[11px] text-gray-500 mb-1 truncate">
            {t('file.currentDir', { dir: currentDir || '/' })}
          </p>
          {diagrams.length === 0 && <p className="text-xs text-gray-500">{t('file.noDiagrams')}</p>}
          <ul className="space-y-1">
            {currentDir !== '' && (
              <li>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => browseDir(parentDir(currentDir)))}
                  className="w-full flex items-center gap-1.5 text-left px-2 py-1 rounded text-xs hover:bg-surface-600 text-gray-300"
                >
                  <ArrowUp size={14} className="shrink-0" />
                  ..
                </button>
              </li>
            )}
            {diagrams.map(d =>
              d.isDir ? (
                <li key={`dir:${d.name}`}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => browseDir(joinDiagramPath(currentDir, d.name)))}
                    className="w-full flex items-center gap-1.5 text-left px-2 py-1 rounded text-xs hover:bg-surface-600 text-gray-300 truncate"
                  >
                    <Folder size={14} className="shrink-0" />
                    <span className="truncate">{d.name}</span>
                  </button>
                </li>
              ) : (
                <li key={`file:${d.name}`}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => openDiagram(joinDiagramPath(currentDir, d.name)))}
                    className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-surface-600 truncate ${
                      joinDiagramPath(currentDir, d.name) === diagramName ? 'bg-surface-600 text-white' : 'text-gray-300'
                    }`}
                  >
                    {d.name}
                  </button>
                </li>
              ),
            )}
          </ul>
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('file.import')}</h3>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xsld,.svg,image/svg+xml"
            multiple
            className="hidden"
            onChange={e => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (files.length === 0) return
              run(async () => {
                // One file opens in the editor; several are saved straight
                // into the current folder (importDiagramFiles).
                if (files.length === 1) {
                  await importDiagramFile(await readFileAsText(files[0]), files[0].name)
                } else {
                  await importDiagramFiles(await readFilesAsText(files))
                }
              })
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-2 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
          >
            {t('file.loadFromFile')}
          </button>
          <p className="text-[11px] text-gray-500 mt-1">{t('file.dropHint')}</p>
          {importLog && (
            <button
              type="button"
              onClick={() => setImportLogOpen(true)}
              className="w-full mt-2 px-2 py-1 text-xs rounded border border-surface-600 hover:bg-surface-600 text-gray-200"
            >
              {t('file.showImportLog')}
            </button>
          )}
        </section>

        {(localError || error) && <p className="text-xs text-red-400">{localError ?? error}</p>}
      </div>
    </PanelShell>
  )
}
