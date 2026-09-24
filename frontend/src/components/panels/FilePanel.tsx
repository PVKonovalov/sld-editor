import { useRef, useState } from 'react'
import { Folder, ArrowUp } from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import { PanelShell } from './PanelShell'
import { NewDiagramDialog } from '../NewDiagramDialog'
import { t } from '../../i18n'
import * as api from '../../lib/api'
import { downloadText, readFileAsText } from '../../lib/fileTransfer'
import { joinDiagramPath, parentDir } from '../../lib/diagramPath'

export function FilePanel({ onClose }: { onClose: () => void }) {
  const {
    currentDir,
    diagrams,
    browseDir,
    diagramName,
    diagram,
    dirty,
    openDiagram,
    importDiagramFile,
    importLog,
    setImportLogOpen,
    saveDiagram,
    saveDiagramAs,
    error,
    clearError,
  } = useDiagramContext()
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')
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
          <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('file.save')}</h3>
          <button
            type="button"
            disabled={busy || !diagramName || !dirty}
            onClick={() => run(saveDiagram)}
            className="w-full px-2 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white mb-3"
          >
            {t('file.save')}
            {dirty ? ' *' : ''}
          </button>

          <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('file.saveAs')}</h3>
          {currentDir && <p className="text-[11px] text-gray-500 mb-1">{t('file.creatingIn', { dir: currentDir })}</p>}
          <div className="flex gap-1">
            <input
              className="flex-1 min-w-0 bg-surface-800 border border-surface-600 rounded px-2 py-1 text-xs"
              placeholder={t('file.namePlaceholder')}
              value={saveAsName}
              onChange={e => setSaveAsName(e.target.value)}
              disabled={!diagramName}
            />
            <button
              type="button"
              disabled={busy || !diagramName || !saveAsName.trim()}
              onClick={() =>
                run(async () => {
                  await saveDiagramAs(joinDiagramPath(currentDir, saveAsName.trim()))
                  setSaveAsName('')
                })
              }
              className="px-2 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white shrink-0"
            >
              {t('file.saveAs')}
            </button>
          </div>
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('file.export')}</h3>
          <div className="flex gap-1 mb-3">
            <button
              type="button"
              disabled={busy || !diagram}
              onClick={() =>
                run(async () => {
                  if (!diagram) return
                  const xml = await api.exportDiagramXML(diagram)
                  downloadText(`${diagramName ?? 'diagram'}.xsld`, xml, 'application/xml')
                })
              }
              className="flex-1 px-2 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
            >
              {t('file.downloadXml')}
            </button>
            <button
              type="button"
              disabled={busy || !diagram}
              onClick={() =>
                run(async () => {
                  if (!diagram) return
                  const svg = await api.exportDiagramSVG(diagram)
                  downloadText(`${diagramName ?? 'diagram'}.svg`, svg, 'image/svg+xml')
                })
              }
              className="flex-1 px-2 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
            >
              {t('file.downloadSvg')}
            </button>
          </div>

          <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('file.import')}</h3>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xsld,.svg,image/svg+xml"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              run(async () => {
                const text = await readFileAsText(file)
                await importDiagramFile(text, file.name)
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
