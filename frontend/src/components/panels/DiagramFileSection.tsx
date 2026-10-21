import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import { t } from '../../i18n'
import * as api from '../../lib/api'
import { downloadBlob, downloadText } from '../../lib/fileTransfer'
import { CimWarnings } from './CimWarnings'
import type { CIMWarning } from '../../types'
import { joinDiagramPath, parentDir } from '../../lib/diagramPath'
import { GuideButton } from '../GuideButton'

/** The open diagram's own file actions, in the Properties panel's diagram
 * view: Save, Save As and Export (download .xsld/.svg, or a CGMES 3.0 zip). The File panel
 * keeps only what brings a diagram in (New, Open, Import — including
 * Show import log, which belongs to the last import). Save As writes next to the open diagram
 * (its own parentDir), not into whatever folder the File panel happens to
 * be browsing; the typed name may still carry further `/` segments. Repair
 * runs the server's topology repair on the open diagram, as one undo step. */
export function DiagramFileSection() {
  const { diagramName, diagram, dirty, saveDiagram, saveDiagramAs, repairDiagram, error, clearError } = useDiagramContext()
  const [saveAsName, setSaveAsName] = useState('')
  const [busy, setBusy] = useState(false)
  // Set while the Save button's own save runs, for its spinner.
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  // Set while Repair's request runs, for its spinner.
  const [repairing, setRepairing] = useState(false)
  // The last Repair's outcome, cleared by any other action here.
  const [repairNote, setRepairNote] = useState<string | null>(null)
  // The last CIM export's notes, cleared by any other action here.
  const [cimWarnings, setCimWarnings] = useState<CIMWarning[] | null>(null)
  const dir = diagramName ? parentDir(diagramName) : ''

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setLocalError(null)
    setRepairNote(null)
    setCimWarnings(null)
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
    <section className="space-y-3">
      <div>
        <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('file.save')}</h3>
        <button
          type="button"
          disabled={busy || !diagramName || !dirty}
          onClick={() => {
            setSaving(true)
            void run(saveDiagram).finally(() => setSaving(false))
          }}
          aria-busy={saving}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
        >
          {saving && <Loader2 size={12} className="animate-spin shrink-0" />}
          {t('file.save')}
          {dirty ? ' *' : ''}
        </button>
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('file.saveAs')}</h3>
        {dir && <p className="text-[11px] text-gray-500 mb-1">{t('file.creatingIn', { dir })}</p>}
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
                await saveDiagramAs(joinDiagramPath(dir, saveAsName.trim()))
                setSaveAsName('')
              })
            }
            className="px-2 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white shrink-0"
          >
            {t('file.saveAs')}
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('file.export')}</h3>
        <div className="flex gap-1">
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
        <div className="flex items-center gap-1 mt-1">
          <button
            type="button"
            disabled={busy || !diagram}
            onClick={() =>
              run(async () => {
                if (!diagram) return
                const out = await api.exportDiagramCIM(diagram, diagramName ?? 'diagram')
                downloadBlob(out.filename, out.file)
                setCimWarnings(out.warnings)
              })
            }
            className="flex-1 px-2 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
          >
            {t('file.downloadCim')}
          </button>
          <GuideButton topic="cim-export" />
        </div>
        {cimWarnings && <CimWarnings warnings={cimWarnings} />}
      </div>

      <div>
        <h3 className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-400 mb-1">
          {t('file.repair')}
          <GuideButton topic="repair" />
        </h3>
        <button
          type="button"
          disabled={busy || !diagram}
          onClick={() => {
            setRepairing(true)
            void run(async () => {
              const changed = await repairDiagram()
              setRepairNote(t(changed ? 'file.repairDone' : 'file.repairNothing'))
            }).finally(() => setRepairing(false))
          }}
          aria-busy={repairing}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1 text-xs rounded border border-surface-600 hover:bg-surface-600 disabled:opacity-50 text-gray-200"
        >
          {repairing && <Loader2 size={12} className="animate-spin shrink-0" />}
          {t('file.repairButton')}
        </button>
        <p className="text-[11px] text-gray-500 mt-1">{t('file.repairHint')}</p>
        {repairNote && <p className="text-[11px] text-emerald-400 mt-1">{repairNote}</p>}
      </div>

      {(localError || error) && <p className="text-xs text-red-400">{localError ?? error}</p>}
    </section>
  )
}
