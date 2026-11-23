import { useState } from 'react'
import { t } from '../../i18n'
import * as diagramOps from '../../lib/diagramOps'
import { useDiagramContext } from '../../state/useDiagramContext'
import { FUNCTION_KIND_LABEL, UNIT_CONFIG_KEY } from '../../lib/functionKinds'
import type { DiagramElement, DiagramFunction, FunctionKind } from '../../types'

const UNIT_KINDS = Object.keys(UNIT_CONFIG_KEY) as Exclude<FunctionKind, 'voltageLevel'>[]
const LETTER_CODE = /^[A-HJ-NP-Z]{1,3}$/

/** A text field that commits a valid value on Enter or blur and reverts an invalid one. */
function CommitInput({
  id,
  value,
  valid,
  onCommit,
}: {
  id: string
  value: string
  valid: (v: string) => boolean
  onCommit: (v: string) => void
}) {
  const [text, setText] = useState(value)
  const commit = () => {
    if (text !== value && valid(text)) onCommit(text)
    else setText(value)
  }
  return (
    <input
      id={id}
      className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1 font-mono"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

/** Properties → Functional unit of an element with a letter code (or a unit): which unit it belongs to, that unit's
 * kind, code and number (a changed code or number renames its elements), confirming a guessed feeder, and making a
 * new unit of the selected elements. */
export function FunctionSection({ el }: { el: DiagramElement }) {
  const { diagram, config, updateDiagram, selection } = useDiagramContext()
  if (!diagram || (!config?.letterCodes?.[el.shape] && !el.function)) return null
  const functions = diagram.functions ?? []
  const units = functions.filter(f => f.kind !== 'voltageLevel')
  const f = functions.find(x => x.id === el.function)
  const unitCode = (kind: Exclude<FunctionKind, 'voltageLevel'>) => config?.designations?.units[UNIT_CONFIG_KEY[kind]]
  const patch = (p: Partial<DiagramFunction>) => f && updateDiagram(d => diagramOps.updateFunction(d, f.id, p))
  const newUnit = () => {
    const ids = [...selection].filter(([, kind]) => kind === 'element').map(([id]) => id)
    const kind = f && f.kind !== 'voltageLevel' ? f.kind : 'other'
    const code = unitCode(kind)
    updateDiagram(
      d =>
        diagramOps.newFunctionFromElements(d, ids.includes(el.id) ? ids : [el.id], kind, code?.code ?? 'X', code?.digits ?? 0)
          .diagram,
    )
  }
  return (
    <div className="text-xs space-y-2">
      <label className="block">
        <span className="text-gray-400 block mb-1" title={t('properties.functionHint')}>
          {t('properties.function')}
        </span>
        <select
          className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
          value={f?.id ?? ''}
          onChange={e => updateDiagram(d => diagramOps.setElementFunction(d, el.id, Number(e.target.value) || 0))}
        >
          <option value="">{t('properties.functionNone')}</option>
          {units.map(u => (
            <option key={u.id} value={u.id}>
              {diagramOps.functionDesignation(functions, u.id)} — {t(FUNCTION_KIND_LABEL[u.kind])}
            </option>
          ))}
        </select>
      </label>
      {f && f.kind !== 'voltageLevel' && (
        <div className="grid grid-cols-3 gap-2">
          <label className="block col-span-3">
            <span className="text-gray-400 block mb-1">{t('properties.functionKind')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={f.kind}
              onChange={e => {
                const kind = e.target.value as Exclude<FunctionKind, 'voltageLevel'>
                const code = unitCode(kind)
                patch({ kind, ...(code ? { code: code.code, digits: code.digits || undefined } : {}) })
              }}
            >
              {UNIT_KINDS.map(k => (
                <option key={k} value={k}>
                  {t(FUNCTION_KIND_LABEL[k])}
                </option>
              ))}
            </select>
          </label>
          <label className="block" htmlFor="function-code">
            <span className="text-gray-400 block mb-1">{t('properties.functionCode')}</span>
            <CommitInput
              key={`code-${f.id}-${f.code}`}
              id="function-code"
              value={f.code}
              valid={v => LETTER_CODE.test(v)}
              onCommit={code => patch({ code })}
            />
          </label>
          <label className="block" htmlFor="function-number">
            <span className="text-gray-400 block mb-1">{t('properties.functionNumber')}</span>
            <CommitInput
              key={`number-${f.id}-${f.number}`}
              id="function-number"
              value={String(f.number)}
              valid={v => /^[1-9][0-9]*$/.test(v)}
              onCommit={v => patch({ number: Number(v) })}
            />
          </label>
        </div>
      )}
      {f?.guessed && (
        <div className="flex items-center gap-2 text-amber-300">
          <span className="flex-1">{t('properties.functionGuessed')}</span>
          <button
            type="button"
            onClick={() => patch({ guessed: undefined })}
            className="px-2 py-0.5 rounded border border-surface-600 hover:bg-surface-600 text-gray-200"
          >
            {t('properties.functionConfirm')}
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={newUnit}
        className="w-full px-2 py-1 rounded border border-surface-600 hover:bg-surface-600 text-gray-200"
      >
        {t('properties.newFunction')}
      </button>
    </div>
  )
}
