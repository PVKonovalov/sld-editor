import { useEffect } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import * as diagramOps from '../lib/diagramOps'
import { t } from '../i18n'

/** A centered modal (backdrop click or Esc dismisses, same as
 * NewDiagramDialog) showing the last .svg import's own log — what
 * slddoc.Extract captured (counts, extracted voltage classes with how many
 * elements/connectors use each), what it skipped (unsupported data-type
 * codes with their readable names) and which element ids failed to parse
 * — plus a Default voltage picker over the extracted classes, preselected
 * by loadDiagramFromFile to the most-used one. Opened automatically after
 * each .svg import, and again from the File panel's "Show import log". */
export function ImportLogDialog({ onClose }: { onClose: () => void }) {
  const { importLog, diagram, updateDiagram, setDefaultVoltage } = useDiagramContext()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!importLog) return null
  const { report, fileName } = importLog
  const usage = diagram ? diagramOps.voltageUsage(diagram) : new Map<number, number>()
  const voltageClasses = diagram?.voltageClasses ?? []

  function changeDefaultVoltage(raw: string) {
    const voltage = raw ? Number(raw) : undefined
    updateDiagram(d => ({ ...d, editor: { ...d.editor, defaultVoltage: voltage } }))
    setDefaultVoltage(voltage)
  }

  const counts: [string, number][] = [
    [t('importLog.elements'), report.elements],
    [t('importLog.connectors'), report.connectors],
    [t('importLog.labels'), report.labels],
    [t('importLog.digitalDevices'), report.digitalDevices],
    [t('importLog.nodes'), report.nodes],
  ]

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-[28rem] max-h-[80vh] overflow-y-auto rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3 text-xs">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">{t('importLog.title')}</h2>
            <p className="text-[11px] text-gray-500 break-all">{fileName}</p>
          </div>

          <section>
            <h3 className="uppercase tracking-wide text-gray-400 mb-1">{t('importLog.summary')}</h3>
            <table className="w-full">
              <tbody>
                {counts.map(([label, n]) => (
                  <tr key={label}>
                    <td className="text-gray-400">{label}</td>
                    <td className="text-right text-gray-100 tabular-nums">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3 className="uppercase tracking-wide text-gray-400 mb-1">{t('importLog.voltageClasses')}</h3>
            {voltageClasses.length === 0 ? (
              <p className="text-gray-500">{t('importLog.none')}</p>
            ) : (
              <ul className="space-y-0.5">
                {voltageClasses.map(vc => (
                  <li key={vc.id} className="flex items-center gap-2">
                    <span
                      className="inline-block w-3 h-3 rounded-sm border border-surface-600 shrink-0"
                      style={{ background: vc.color }}
                    />
                    <span className="flex-1 text-gray-100 truncate">{vc.name}</span>
                    <span className="text-gray-400 tabular-nums">{usage.get(vc.id) ?? 0}</span>
                  </li>
                ))}
              </ul>
            )}
            {voltageClasses.length > 0 && (
              <label className="block mt-2">
                <span className="block text-gray-400 mb-1">{t('importLog.defaultVoltage')}</span>
                <select
                  className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                  value={diagram?.editor?.defaultVoltage ?? ''}
                  onChange={e => changeDefaultVoltage(e.target.value)}
                >
                  <option value="">{t('importLog.noDefaultVoltage')}</option>
                  {voltageClasses.map(vc => (
                    <option key={vc.id} value={vc.id}>
                      {vc.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>

          <section>
            <h3 className="uppercase tracking-wide text-gray-400 mb-1">{t('importLog.skipped')}</h3>
            {report.skipped.length === 0 ? (
              <p className="text-gray-500">{t('importLog.none')}</p>
            ) : (
              <ul className="space-y-0.5">
                {report.skipped.map(s => (
                  <li key={s.code} className="flex gap-2">
                    <span className="text-gray-400 tabular-nums w-14 shrink-0">{s.code}</span>
                    <span className="flex-1 text-gray-100">{s.name || t('importLog.unknownType')}</span>
                    <span className="text-gray-400 tabular-nums">× {s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="uppercase tracking-wide text-gray-400 mb-1">{t('importLog.failed')}</h3>
            {report.failed.length === 0 ? (
              <p className="text-gray-500">{t('importLog.none')}</p>
            ) : (
              <p className="text-red-300 break-words">{report.failed.join(', ')}</p>
            )}
          </section>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 rounded bg-accent hover:bg-accent-hover text-white"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
