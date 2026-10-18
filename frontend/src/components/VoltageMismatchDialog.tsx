import { useEffect } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import { t } from '../i18n'
import { GuideButton } from './GuideButton'

/** Asked when an edit would connect different voltage classes (DiagramContext's voltagePrompt): Connect makes those
 * connections, Don't connect (also Esc or a backdrop click) applies the edit without them, so those ends stay free. */
export function VoltageMismatchDialog() {
  const { voltagePrompt, resolveVoltagePrompt, diagram } = useDiagramContext()

  useEffect(() => {
    if (!voltagePrompt) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') resolveVoltagePrompt(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [voltagePrompt, resolveVoltagePrompt])

  if (!voltagePrompt) return null

  const className = (id: number) => {
    const vc = diagram?.voltageClasses.find(v => v.id === id)
    return vc?.name || vc?.color || `#${id}`
  }
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
              className="px-3 py-1 rounded bg-accent hover:bg-accent-hover text-white"
            >
              {t('voltageMismatch.connect')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
