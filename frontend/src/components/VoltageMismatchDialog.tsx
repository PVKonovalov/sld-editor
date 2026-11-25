import { useEffect, useState } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import { t } from '../i18n'
import { GuideButton } from './GuideButton'

/** Asked when an edit would connect different voltage classes (DiagramContext's voltagePrompt): Connect makes those
 * connections, Connect and set class also gives the chosen one of those classes to everything joined there, Don't
 * connect (also Esc or a backdrop click) applies the edit without them, so those ends stay free. */
export function VoltageMismatchDialog() {
  const { voltagePrompt, resolveVoltagePrompt, diagram } = useDiagramContext()
  const [chosen, setChosen] = useState<number | null>(null)

  useEffect(() => {
    if (!voltagePrompt) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') resolveVoltagePrompt(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [voltagePrompt, resolveVoltagePrompt])

  useEffect(() => setChosen(null), [voltagePrompt])

  if (!voltagePrompt) return null

  const className = (id: number) => {
    const vc = diagram?.voltageClasses.find(v => v.id === id)
    return vc?.name || vc?.color || `#${id}`
  }
  const involved = [...new Set(voltagePrompt.flatMap(m => m.voltages))].sort((a, b) => a - b)
  const voltage = chosen !== null && involved.includes(chosen) ? chosen : involved[0]
  const groups = [
    ...new Set(voltagePrompt.map(m => [...m.voltages].sort((a, b) => a - b).map(className).join(' ↔ '))),
  ]

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={() => resolveVoltagePrompt(false)} />
      <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-96 rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3 text-xs">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">
            {t('voltageMismatch.title')}
            <GuideButton topic="voltage-mismatch" />
          </h2>
          <p className="text-gray-300">{t('voltageMismatch.message', { count: voltagePrompt.length })}</p>
          <ul className="list-disc pl-5 text-gray-200">
            {groups.map(g => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-gray-300">
            {t('voltageMismatch.setClass')}
            <select
              value={voltage}
              onChange={e => setChosen(Number(e.target.value))}
              className="flex-1 rounded border border-surface-600 bg-surface-800 px-1 py-0.5 text-gray-100"
            >
              {involved.map(v => (
                <option key={v} value={v}>
                  {className(v)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => resolveVoltagePrompt(false)}
              className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 text-gray-200"
            >
              {t('voltageMismatch.dontConnect')}
            </button>
            <button
              type="button"
              onClick={() => resolveVoltagePrompt(true)}
              className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 text-gray-200"
            >
              {t('voltageMismatch.connect')}
            </button>
            <button
              type="button"
              onClick={() => resolveVoltagePrompt(true, voltage)}
              className="px-3 py-1 rounded bg-accent hover:bg-accent-hover text-white"
            >
              {t('voltageMismatch.connectAndSet')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
