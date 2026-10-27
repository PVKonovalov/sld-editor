import { useEffect, useState } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import { t } from '../i18n'
import { GuideButton } from './GuideButton'
import type { CimSameVoltageTransformer } from '../types'

// The voltage each winding starts with: its rated voltage, else the model's.
function initialValues(transformers: CimSameVoltageTransformer[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const tr of transformers) for (const w of tr.windings) out[w.mrid] = String(w.ratedU ?? w.kv)
  return out
}

function parseKV(value: string): number {
  return Number(value.trim().replace(',', '.'))
}

/** Asked during a CIM import whose transformers have one voltage on all their windings (DiagramContext's
 * cimWindingsPrompt), before anything is laid out: a voltage for each winding, or the model's kept (also Esc or a
 * backdrop click). */
export function CimWindingsDialog() {
  const { cimWindingsPrompt, resolveCimWindingsPrompt } = useDiagramContext()
  const [values, setValues] = useState<Record<string, string>>({})
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    if (!cimWindingsPrompt) return
    setValues(initialValues(cimWindingsPrompt.transformers))
    setInvalid(false)
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') resolveCimWindingsPrompt({})
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cimWindingsPrompt, resolveCimWindingsPrompt])

  if (!cimWindingsPrompt) return null
  const { fileName, transformers } = cimWindingsPrompt

  function apply() {
    const windings: Record<string, number> = {}
    for (const tr of transformers) {
      for (const w of tr.windings) {
        const kv = parseKV(values[w.mrid] ?? '')
        if (!Number.isFinite(kv) || kv <= 0) {
          setInvalid(true)
          return
        }
        if (kv !== w.kv) windings[w.mrid] = kv
      }
    }
    resolveCimWindingsPrompt(windings)
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={() => resolveCimWindingsPrompt({})} />
      <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-[30rem] max-h-[80vh] overflow-y-auto rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3 text-xs">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">
              {t('cimWindings.title')}
              <GuideButton topic="cim-winding-voltages" />
            </h2>
            <p className="text-gray-400 mt-1">{t('cimWindings.message', { file: fileName })}</p>
          </div>
          {transformers.map(tr => (
            <div key={tr.mrid} className="space-y-1">
              <div className="text-gray-100 font-semibold">{tr.name || tr.mrid}</div>
              {tr.windings.map(w => (
                <label key={w.mrid} className="flex items-center gap-2 pl-2">
                  <span className="w-24 text-gray-300">{t('cimWindings.winding', { end: w.end || '?' })}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-20 rounded border border-surface-600 bg-surface-800 px-1.5 py-0.5 text-right text-gray-100 tabular-nums"
                    value={values[w.mrid] ?? ''}
                    onChange={e => {
                      setValues(prev => ({ ...prev, [w.mrid]: e.target.value }))
                      setInvalid(false)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') apply()
                    }}
                  />
                  <span className="text-gray-400">{t('cimWindings.kv')}</span>
                  <span className="text-gray-500">
                    {t('cimWindings.inModel', { kv: w.kv })}
                    {w.ratedU !== undefined && `, ${t('cimWindings.rated', { kv: w.ratedU })}`}
                  </span>
                </label>
              ))}
            </div>
          ))}
          {invalid && <p className="text-red-400">{t('cimWindings.invalid')}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => resolveCimWindingsPrompt({})}
              className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 text-gray-200"
            >
              {t('cimWindings.keep')}
            </button>
            <button
              type="button"
              autoFocus
              onClick={apply}
              className="px-3 py-1 rounded bg-accent hover:bg-accent-hover text-white"
            >
              {t('cimWindings.apply')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
