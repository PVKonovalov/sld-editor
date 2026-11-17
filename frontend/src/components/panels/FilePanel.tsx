import { useEffect, useRef, useState } from 'react'
import { Folder, ArrowUp, FolderPlus, Pencil, Trash2 } from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import { PanelShell } from './PanelShell'
import { NewDiagramDialog } from '../NewDiagramDialog'
import { FolderActionDialog, type FolderAction } from '../FolderActionDialog'
import { t } from '../../i18n'
import { joinDiagramPath, parentDir } from '../../lib/diagramPath'
import * as api from '../../lib/api'
import { SchemeStatusIcon } from '../SchemeTreeList'
import { SchemesView } from './SchemesView'
import type { DiagramEntry, SchemeStatus } from '../../types'

type Tab = 'diagrams' | 'schemes'
// The tab survives closing and reopening the panel.
let lastTab: Tab = 'diagrams'

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
    loading,
    importing,
    config,
  } = useDiagramContext()
  const provider = config?.bindings?.provider ?? ''
  const schemesOn = !!provider && !!config?.bindings?.schemes
  const [tab, setTabState] = useState<Tab>(lastTab)
  const setTab = (next: Tab) => {
    lastTab = next
    setTabState(next)
  }
  const shownTab = schemesOn ? tab : 'diagrams'
  // Whether each linked scheme of the listed folder still exists; null before the first answer, 'unknown' when it
  // can't be told.
  const [exist, setExist] = useState<Record<string, boolean> | 'unknown' | null>(null)
  // The previous answer stays until the new one arrives, so a re-listing doesn't flicker.
  useEffect(() => {
    if (!schemesOn) return
    const refs = diagrams.filter(d => !d.isDir && d.scheme?.source === provider).map(d => d.scheme!.ref)
    if (refs.length === 0) {
      setExist(null)
      return
    }
    let live = true
    api.schemesExist(refs).then(
      e => live && setExist(e),
      () => live && setExist('unknown'),
    )
    return () => {
      live = false
    }
  }, [diagrams, schemesOn, provider])

  function schemeStatus(d: DiagramEntry): SchemeStatus | null {
    if (!schemesOn || !d.scheme || d.scheme.source !== provider || !d.schemeStatus) return null
    if (exist === 'unknown') return 'unknown'
    if (exist && exist[d.scheme.ref] === false) return 'missing'
    return d.schemeStatus
  }
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [folderAction, setFolderAction] = useState<FolderAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function run(action: () => Promise<unknown>) {
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

  // Rename and Delete for one row, shown while the row is hovered or one of them has focus.
  function rowActions(path: string, isDir: boolean, entry?: DiagramEntry) {
    const disabled = busy || loading !== null || importing !== null
    const cls =
      'p-1 text-gray-400 hover:text-gray-100 opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:hidden'
    return (
      <span className="flex shrink-0 pr-1">
        <button
          type="button"
          title={t('file.rename')}
          disabled={disabled}
          onClick={() => setFolderAction({ kind: 'rename', path, isDir })}
          className={cls}
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          title={t('file.delete')}
          disabled={disabled}
          onClick={() => setFolderAction({ kind: 'delete', path, isDir, scheme: entry?.scheme })}
          className={cls}
        >
          <Trash2 size={12} />
        </button>
      </span>
    )
  }

  return (
    <PanelShell title={t('sidebar.file')} onClose={onClose} topic="files">
      <div className="space-y-4">
        <section>
          <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('file.new')}</h3>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || loading !== null || importing !== null}
              onClick={() => setNewDialogOpen(true)}
              className="flex-1 px-2 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
            >
              {t('file.new')}
            </button>
            <button
              type="button"
              disabled={busy || loading !== null || importing !== null}
              onClick={() => setFolderAction({ kind: 'newFolder' })}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-xs rounded border border-surface-600 hover:bg-surface-600 disabled:opacity-50 text-gray-200"
            >
              <FolderPlus size={14} className="shrink-0" />
              {t('file.newFolder')}
            </button>
          </div>
          {newDialogOpen && <NewDiagramDialog onClose={() => setNewDialogOpen(false)} />}
          {folderAction && <FolderActionDialog action={folderAction} onClose={() => setFolderAction(null)} />}
        </section>

        {schemesOn && (
          <div role="tablist" className="flex border-b border-surface-600 text-xs">
            {(['diagrams', 'schemes'] as const).map(id => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={shownTab === id}
                onClick={() => setTab(id)}
                className={`px-3 py-1 -mb-px border-b-2 ${
                  shownTab === id ? 'border-accent text-gray-100' : 'border-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                {t(id === 'diagrams' ? 'schemes.tabDiagrams' : 'schemes.tabSchemes')}
              </button>
            ))}
          </div>
        )}
        {shownTab === 'schemes' && <SchemesView provider={provider} />}

        {shownTab === 'diagrams' && (
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
                  disabled={busy || loading !== null || importing !== null}
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
                <li key={`dir:${d.name}`} className="group flex items-center rounded hover:bg-surface-600">
                  <button
                    type="button"
                    disabled={busy || loading !== null || importing !== null}
                    onClick={() => run(() => browseDir(joinDiagramPath(currentDir, d.name)))}
                    className="flex-1 min-w-0 flex items-center gap-1.5 text-left px-2 py-1 text-xs text-gray-300"
                  >
                    <Folder size={14} className="shrink-0" />
                    <span className="truncate" title={d.name}>
                      {d.name}
                    </span>
                  </button>
                  {rowActions(joinDiagramPath(currentDir, d.name), true)}
                </li>
              ) : (
                <li
                  key={`file:${d.name}`}
                  className={`group flex items-center rounded hover:bg-surface-600 ${
                    joinDiagramPath(currentDir, d.name) === diagramName ? 'bg-surface-600 text-white' : 'text-gray-300'
                  }`}
                >
                  <button
                    type="button"
                    disabled={busy || loading !== null || importing !== null}
                    onClick={() => run(() => openDiagram(joinDiagramPath(currentDir, d.name)))}
                    className="flex-1 min-w-0 flex items-center gap-1.5 text-left px-2 py-1 text-xs"
                    title={d.name}
                  >
                    <span className="truncate">{d.name}</span>
                    {schemeStatus(d) && <SchemeStatusIcon status={schemeStatus(d)!} scheme={d.scheme!.ref} />}
                  </button>
                  {rowActions(joinDiagramPath(currentDir, d.name), false, d)}
                </li>
              ),
            )}
          </ul>
        </section>
        )}

        <section>
          <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('file.import')}</h3>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xsld,.svg,.xsde,.zip,.xml,.rdf,image/svg+xml"
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
                  await importDiagramFile(files[0])
                } else {
                  await importDiagramFiles(files)
                }
              })
            }}
          />
          <button
            type="button"
            disabled={busy || loading !== null || importing !== null}
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
