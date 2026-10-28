import { useEffect, useState } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import { t } from '../i18n'
import { GuideButton } from './GuideButton'
import { hexColor } from '../lib/color'


/** Asked during a CIM import whose voltage classes no server preset names (DiagramContext's voltageColorsPrompt):
 * a row per class with the pages using it, the nearest preset whose color it was given, a color to change it and
 * an Add box (ticked) that puts it into the configuration's voltage_colors. Apply colors the imported pages and adds
 * the ticked classes; Keep suggested (also Esc or a backdrop click) imports them with the suggested colors. */
export function VoltageColorsDialog() {
  const { voltageColorsPrompt, resolveVoltageColorsPrompt, addVoltagePresets } = useDiagramContext()
  const [colors, setColors] = useState<Map<string, string>>(new Map())
  const [skipAdd, setSkipAdd] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setColors(new Map((voltageColorsPrompt?.voltages ?? []).map(v => [v.name, hexColor(v.color)])))
    setSkipAdd(new Set())
    setError(null)
  }, [voltageColorsPrompt])

  useEffect(() => {
    if (!voltageColorsPrompt) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') resolveVoltageColorsPrompt(new Map())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [voltageColorsPrompt, resolveVoltageColorsPrompt])

  if (!voltageColorsPrompt) return null
  const { fileName, voltages } = voltageColorsPrompt
  const colorOf = (name: string, fallback: string) => colors.get(name) ?? hexColor(fallback)

  async function apply() {
    const add = voltages.filter(v => !skipAdd.has(v.name)).map(v => ({ name: v.name, color: colorOf(v.name, v.color) }))
    setBusy(true)
    setError(null)
    try {
      if (add.length > 0) await addVoltagePresets(add)
      resolveVoltageColorsPrompt(new Map(voltages.map(v => [v.name, colorOf(v.name, v.color)])))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function toggleAdd(name: string) {
    setSkipAdd(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={() => !busy && resolveVoltageColorsPrompt(new Map())} />
      <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-[30rem] max-h-[80vh] overflow-y-auto rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3 text-xs">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">
              {t('voltageColors.title')}
              <GuideButton topic="cim-voltage-colors" />
            </h2>
            <p className="text-gray-400 mt-1">{t('voltageColors.message', { file: fileName })}</p>
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-left text-gray-400">
                <th className="font-normal pb-1">{t('voltageColors.class')}</th>
                <th className="font-normal pb-1 text-right pr-3">{t('voltageColors.pages')}</th>
                <th className="font-normal pb-1">{t('voltageColors.nearest')}</th>
                <th className="font-normal pb-1">{t('voltageColors.color')}</th>
                <th className="font-normal pb-1 text-center">{t('voltageColors.addToConfig')}</th>
              </tr>
            </thead>
            <tbody>
              {voltages.map(v => (
                <tr key={v.name}>
                  <td className="py-0.5 text-gray-100">{v.name}</td>
                  <td className="py-0.5 text-right pr-3 text-gray-400 tabular-nums">{v.pages}</td>
                  <td className="py-0.5 text-gray-300">
                    {v.preset ? (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block w-3 h-3 rounded-sm border border-surface-600 shrink-0"
                          style={{ background: v.color }}
                        />
                        {v.preset}
                      </span>
                    ) : (
                      t('common.none')
                    )}
                  </td>
                  <td className="py-0.5">
                    <input
                      type="color"
                      className="w-10 h-5 bg-transparent border border-surface-600 rounded cursor-pointer"
                      value={colorOf(v.name, v.color)}
                      onChange={e => setColors(prev => new Map(prev).set(v.name, e.target.value))}
                    />
                  </td>
                  <td className="py-0.5 text-center">
                    <input type="checkbox" checked={!skipAdd.has(v.name)} onChange={() => toggleAdd(v.name)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-gray-500">{t('voltageColors.addToConfigHint')}</p>
          {error && <p className="text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => resolveVoltageColorsPrompt(new Map())}
              className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 disabled:opacity-50 text-gray-200"
            >
              {t('voltageColors.skip')}
            </button>
            <button
              type="button"
              autoFocus
              disabled={busy}
              onClick={apply}
              className="px-3 py-1 rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
            >
              {t('voltageColors.apply')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
