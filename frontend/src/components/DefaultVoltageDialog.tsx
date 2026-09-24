import { useEffect, useState } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import * as diagramOps from '../lib/diagramOps'
import { t } from '../i18n'

/** A centered modal (backdrop click or Esc skips, same as ImportLogDialog)
 * shown right after opening a diagram — from the File panel, or a dropped/
 * picked .xsld — whose file carries no usable editor.defaultVoltage
 * (diagramOps.needsDefaultVoltage). Lists the diagram's own voltage classes
 * with their usage counts, and offers them plus the server's voltage
 * presets (the same voltageClassOptions/resolveVoltageSelection pair
 * Properties uses, so picking a preset not yet on the diagram adds it),
 * preselecting the most-used class. OK records the pick as
 * editor.defaultVoltage (the diagram becomes dirty, so the next Save
 * writes it); Skip leaves it unset until the diagram is opened again. */
export function DefaultVoltageDialog() {
  const { diagram, config, updateDiagram, setDefaultVoltage, setDefaultVoltagePromptOpen } = useDiagramContext()
  const [value, setValue] = useState(() => {
    if (!diagram) return ''
    const most = diagramOps.mostUsedVoltage(diagram) ?? diagram.voltageClasses[0]?.id
    if (most !== undefined) return String(most)
    return diagramOps.voltageClassOptions(diagram, config)[0]?.value ?? ''
  })

  const close = () => setDefaultVoltagePromptOpen(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDefaultVoltagePromptOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setDefaultVoltagePromptOpen])

  if (!diagram) return null
  const usage = diagramOps.voltageUsage(diagram)
  const options = diagramOps.voltageClassOptions(diagram, config)

  function confirm() {
    if (!diagram || !value) return
    const { diagram: withClass, voltage } = diagramOps.resolveVoltageSelection(diagram, config, value)
    if (voltage === undefined) return
    updateDiagram(() => ({ ...withClass, editor: { ...withClass.editor, defaultVoltage: voltage } }))
    setDefaultVoltage(voltage)
    close()
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/50" onClick={close} />
      <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-[26rem] max-h-[80vh] overflow-y-auto rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3 text-xs">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">{t('defaultVoltage.title')}</h2>
            <p className="text-gray-400 mt-1">{t('defaultVoltage.message')}</p>
          </div>

          {diagram.voltageClasses.length > 0 && (
            <section>
              <h3 className="uppercase tracking-wide text-gray-400 mb-1">{t('defaultVoltage.diagramClasses')}</h3>
              <ul className="space-y-0.5">
                {diagram.voltageClasses.map(vc => (
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
            </section>
          )}

          <label className="block">
            <span className="block text-gray-400 mb-1">{t('defaultVoltage.voltage')}</span>
            <select
              autoFocus
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={value}
              onChange={e => setValue(e.target.value)}
            >
              {options.map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 text-gray-200"
            >
              {t('defaultVoltage.skip')}
            </button>
            <button
              type="button"
              disabled={!value}
              onClick={confirm}
              className="px-3 py-1 rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
            >
              {t('defaultVoltage.ok')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
