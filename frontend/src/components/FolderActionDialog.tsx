import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useDiagramContext } from '../state/useDiagramContext'
import * as api from '../lib/api'
import { presenceSession } from '../lib/presenceSession'
import type { OpenTab } from '../types'
import { t } from '../i18n'
import { GuideButton } from './GuideButton'

export type FolderAction =
  | { kind: 'newFolder' }
  | { kind: 'rename'; path: string; isDir: boolean }
  | { kind: 'delete'; path: string; isDir: boolean }

/** The File panel's folder actions as a modal: New folder (a name in the current folder), Rename or move (a full
 * path, prefilled with the item's own), and Delete (a confirmation). Rename and Delete list the other tabs that
 * have the item, or anything inside it, open. */
export function FolderActionDialog({ action, onClose }: { action: FolderAction; onClose: () => void }) {
  const { createFolder, renameEntry, deleteEntry, currentDir } = useDiagramContext()
  const [value, setValue] = useState(action.kind === 'rename' ? action.path : '')
  const [others, setOthers] = useState<OpenTab[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const path = action.kind === 'newFolder' ? null : action.path

  useEffect(() => {
    if (path === null) return
    let cancelled = false
    api
      .openTabs(path, presenceSession)
      .then(tabs => !cancelled && setOthers(tabs))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [path])

  const trimmed = value.trim()
  const canSubmit =
    !busy && (action.kind === 'delete' || (trimmed !== '' && (action.kind !== 'rename' || trimmed !== action.path)))

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (action.kind === 'newFolder') await createFolder(trimmed)
      else if (action.kind === 'rename') await renameEntry(action.path, trimmed, action.isDir)
      else await deleteEntry(action.path, action.isDir)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const title =
    action.kind === 'newFolder'
      ? t('file.newFolderTitle')
      : action.kind === 'rename'
        ? t(action.isDir ? 'file.renameFolderTitle' : 'file.renameDiagramTitle')
        : t(action.isDir ? 'file.deleteFolderTitle' : 'file.deleteDiagramTitle')

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-96 rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">
            {title}
            <GuideButton topic="folders" />
          </h2>

          {action.kind === 'newFolder' && (
            <>
              {currentDir && <p className="text-[11px] text-gray-500">{t('file.creatingIn', { dir: currentDir })}</p>}
              <label className="block text-xs">
                <span className="block text-gray-400 mb-1">{t('file.name')}</span>
                <input
                  autoFocus
                  className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                  placeholder={t('file.folderNamePlaceholder')}
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                />
              </label>
            </>
          )}

          {action.kind === 'rename' && (
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('file.newPath')}</span>
              <input
                autoFocus
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
              />
              <span className="block text-gray-500 mt-1">{t('file.renameHint')}</span>
            </label>
          )}

          {action.kind === 'delete' && (
            <p className="text-xs text-gray-300 break-all">
              {t(action.isDir ? 'file.deleteFolderConfirm' : 'file.deleteDiagramConfirm', { name: action.path })}
            </p>
          )}

          {others.length > 0 && (
            <div className="flex gap-1.5 text-[11px] text-amber-300">
              <TriangleAlert size={14} className="shrink-0 mt-px" />
              <div>
                <p>{t('file.openElsewhere')}</p>
                <ul>
                  {others.map(o => (
                    <li key={`${o.diagram} ${o.ip} ${o.since}`} className="break-all">
                      {t('file.openElsewhereItem', { diagram: o.diagram, ip: o.ip })}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

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
              autoFocus={action.kind === 'delete'}
              disabled={!canSubmit}
              onClick={submit}
              className={`px-3 py-1 text-xs rounded disabled:opacity-50 text-white ${
                action.kind === 'delete' ? 'bg-red-700 hover:bg-red-600' : 'bg-accent hover:bg-accent-hover'
              }`}
            >
              {action.kind === 'newFolder'
                ? t('file.create')
                : action.kind === 'rename'
                  ? t('file.renameApply')
                  : t('file.delete')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
