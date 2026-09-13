import { useState } from 'react'
import { useDiagramContext } from '../../state/useDiagramContext'
import { PanelShell } from './PanelShell'
import { t } from '../../i18n'

export function FilePanel({ onClose }: { onClose: () => void }) {
  const { diagrams, diagramName, dirty, newDiagram, openDiagram, saveDiagram, saveDiagramAs, error, clearError } =
    useDiagramContext()
  const [newName, setNewName] = useState('')
  const [saveAsName, setSaveAsName] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

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
          <div className="flex gap-1">
            <input
              className="flex-1 min-w-0 bg-surface-800 border border-surface-600 rounded px-2 py-1 text-xs"
              placeholder={t('file.namePlaceholder')}
              value={newName}
              onChange={e => setNewName(e.target.value)}
            />
            <button
              type="button"
              disabled={busy || !newName.trim()}
              onClick={() =>
                run(async () => {
                  await newDiagram(newName.trim())
                  setNewName('')
                })
              }
              className="px-2 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white shrink-0"
            >
              {t('file.create')}
            </button>
          </div>
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('file.open')}</h3>
          {diagrams.length === 0 && <p className="text-xs text-gray-500">{t('file.noDiagrams')}</p>}
          <ul className="space-y-1">
            {diagrams.map(d => (
              <li key={d.name}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => openDiagram(d.name))}
                  className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-surface-600 truncate ${
                    d.name === diagramName ? 'bg-surface-600 text-white' : 'text-gray-300'
                  }`}
                >
                  {d.name}
                </button>
              </li>
            ))}
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
                  await saveDiagramAs(saveAsName.trim())
                  setSaveAsName('')
                })
              }
              className="px-2 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white shrink-0"
            >
              {t('file.saveAs')}
            </button>
          </div>
        </section>

        {(localError || error) && <p className="text-xs text-red-400">{localError ?? error}</p>}
      </div>
    </PanelShell>
  )
}
