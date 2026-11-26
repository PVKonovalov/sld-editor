import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { t } from '../i18n'
import * as api from '../lib/api'
import * as diagramOps from '../lib/diagramOps'
import { useDiagramContext } from '../state/useDiagramContext'
import { elementDiagramBox } from '../lib/elementBox'
import { designationLabelPlacement, ObstacleIndex, segmentBox, textBox } from '../lib/designationLabels'
import { FUNCTION_KIND_LABEL, UNIT_CONFIG_KEY } from '../lib/functionKinds'
import type {
  DesignationFormat,
  DesignationPlan,
  DesignationRow,
  Diagram,
  DiagramFunction,
  ElementSymbol,
  FunctionKind,
  Point,
} from '../types'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

interface Placed {
  labels: Map<number, Point>
  overlaps: Set<number>
}

/** Places a designation label for each of rows' elements that has no label For it yet (see
 * designationLabelPlacement): obstacles are every element's box, wire segment, label and digital device, and the
 * labels placed before it. */
function placeLabels(
  diagram: Diagram,
  rows: DesignationRow[],
  format: DesignationFormat,
  symbols: ElementSymbol[],
  grid: number,
  snap: boolean,
): Placed {
  const obstacles = new ObstacleIndex()
  const boxes = new Map<number, ReturnType<typeof elementDiagramBox>>()
  for (const el of diagram.elements) {
    const box = elementDiagramBox(el, symbols)
    boxes.set(el.id, box)
    obstacles.add(box)
  }
  for (const c of diagram.connectors) {
    for (let i = 1; i < c.points.length; i++) obstacles.add(segmentBox(c.points[i - 1], c.points[i]))
  }
  for (const l of diagram.labels) obstacles.add(textBox(l.x, l.y, l.text, l.size, l.anchor, l.valign))
  for (const dd of diagram.digitalDevices) {
    obstacles.add(textBox(dd.x, dd.y, `${dd.value}${dd.unit ?? ''}`, dd.size, dd.anchor, dd.valign))
  }
  for (const b of diagram.barInstruments) obstacles.add(diagramOps.barInstrumentBox(b))
  const labelled = new Set(diagram.labels.map(l => l.for))
  const labels = new Map<number, Point>()
  const overlaps = new Set<number>()
  for (const r of rows) {
    const box = boxes.get(r.element)
    if (!box || labelled.has(r.element)) continue
    const text = diagramOps.designationText(r.name, format)
    const size = diagramOps.NAME_LABEL_SIZE
    const p = designationLabelPlacement(box, text, size, obstacles, diagram.width, diagram.height, grid, snap)
    labels.set(r.element, { x: p.x, y: p.y })
    if (p.overlaps) overlaps.add(r.element)
    obstacles.add(textBox(p.x, p.y, text, size))
  }
  return { labels, overlaps }
}

function risky(r: DesignationRow): boolean {
  return !!r.oldName && !!(r.bound || r.mrid || r.exported)
}

/** Diagram → Enumerate elements (a floating panel, moved by its title, the diagram left visible behind it): proposes reference designations (POST /api/designations) for the whole diagram or
 * the selection, only for elements without one or renumbering all, previews them (old → new name, unit, warnings;
 * an element whose rename could break something outside the editor starts unchecked), lets a guessed feeder be
 * confirmed or flipped, and applies the checked rows as one undoable edit, labels on the designation layer. */
export function EnumerateDialog() {
  const {
    diagram,
    enumeratePrompt,
    setEnumeratePrompt,
    updateDiagram,
    config,
    elements,
    focusItem,
    selection: selected,
    selectMany,
    toggleSelection,
  } = useDiagramContext()
  const selection = enumeratePrompt?.selection ?? []
  const [scope, setScope] = useState<'diagram' | 'selection'>(selection.length > 0 ? 'selection' : 'diagram')
  const [renumber, setRenumber] = useState(false)
  const [format, setFormat] = useState<DesignationFormat>(diagram?.editor?.designationFormat ?? 'full')
  const [plan, setPlan] = useState<DesignationPlan | null>(null)
  const [plannedFor, setPlannedFor] = useState<Diagram | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const request = useRef(0)
  // The panel's offset from the centre, moved by dragging its title; drag holds where the drag started.
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null)
  const close = () => setEnumeratePrompt(null)

  useEffect(() => {
    if (!diagram || !enumeratePrompt) return
    const n = ++request.current
    setPlan(null)
    setError(null)
    api
      .planDesignations(diagram, scope === 'selection' ? enumeratePrompt.selection : [], renumber, format)
      .then(p => {
        if (n !== request.current) return
        setPlan(p)
        setPlannedFor(diagram)
        setChecked(new Set(p.rows.filter(r => !risky(r)).map(r => r.element)))
      })
      .catch((e: unknown) => {
        if (n === request.current) setError(e instanceof Error ? e.message : String(e))
      })
  }, [diagram, enumeratePrompt, scope, renumber, format])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setEnumeratePrompt(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setEnumeratePrompt])

  const grid = diagram?.editor?.gridSpacing ?? config?.editor.gridSpacing ?? 10
  const snap = diagram?.editor?.snap ?? config?.editor.snap ?? false
  const placed = useMemo(
    () => (diagram && plan ? placeLabels(diagram, plan.rows, format, elements, grid, snap) : null),
    [diagram, plan, format, elements, grid, snap],
  )

  if (!enumeratePrompt || !diagram) return null

  const functions = new Map((plan?.functions ?? []).map(f => [f.id, f]))
  const elementById = new Map(diagram.elements.map(e => [e.id, e]))
  const labelText = new Map<number, string>()
  for (const l of diagram.labels) if (l.for !== undefined && !labelText.has(l.for)) labelText.set(l.for, l.text)
  const short = format === 'short'
  const symbolName = (shape: string) => elements.find(s => s.shape === shape)?.name ?? shape
  const guessedUnits = [...new Set((plan?.rows ?? []).map(r => r.function))]
    .map(id => functions.get(id))
    .filter((f): f is DiagramFunction => !!f?.guessed)

  // Confirms a guessed feeder, or flips it to the other feeder kind with the next free number of its code.
  const settle = (f: DiagramFunction, flip: boolean) => {
    if (!plan) return
    let next: DiagramFunction = { ...f, guessed: undefined }
    if (flip) {
      const kind: FunctionKind = f.kind === 'incomingFeeder' ? 'outgoingFeeder' : 'incomingFeeder'
      const unit = config?.designations?.units[UNIT_CONFIG_KEY[kind]]
      const code = unit?.code ?? f.code
      const used = plan.functions.filter(o => o.parent === f.parent && o.code === code).map(o => o.number)
      const taken = diagram.functions?.filter(o => o.parent === f.parent && o.code === code).map(o => o.number) ?? []
      next = { ...next, kind, code, digits: unit?.digits || undefined, number: 1 + Math.max(0, ...used, ...taken) }
    }
    const fs = plan.functions.map(o => (o.id === f.id ? next : o))
    const path = diagramOps.functionDesignation(fs, f.id)
    const rows = plan.rows.map(r => {
      if (r.function !== f.id) return r
      const i = r.name.indexOf('-')
      return { ...r, name: path + (i >= 0 ? r.name.slice(i) : '') }
    })
    setPlan({ ...plan, functions: fs, rows })
  }

  const apply = () => {
    if (!plan || !placed) return
    if (plannedFor !== diagram) {
      setError(t('designations.stale'))
      return
    }
    const accepted = plan.rows.filter(r => checked.has(r.element))
    const { labels } = placeLabels(diagram, accepted, format, elements, grid, snap)
    updateDiagram(d => diagramOps.applyDesignations(d, plan, checked, labels, t('designations.layerName'), format))
    close()
  }

  // With short labels, the short texts more than one designated element would show once the plan is applied.
  const repeatedShort = new Set<string>()
  if (plan && format === 'short') {
    const rowName = new Map(plan.rows.map(r => [r.element, r.name]))
    const seen = new Set<string>()
    for (const e of diagram.elements) {
      const name = rowName.get(e.id) ?? (e.function ? e.name : undefined)
      if (!name) continue
      const text = diagramOps.designationText(name, 'short')
      if (seen.has(text)) repeatedShort.add(text)
      seen.add(text)
    }
  }

  const warnings = (r: DesignationRow): string[] => {
    const w: string[] = []
    if (r.oldName && r.bound) w.push(t('designations.warnBound'))
    if (r.oldName && r.mrid) w.push(t('designations.warnMrid'))
    if (r.oldName && r.exported) w.push(t('designations.warnExported'))
    if (r.duplicate) w.push(t('designations.warnDuplicate'))
    else if (repeatedShort.has(diagramOps.designationText(r.name, 'short'))) w.push(t('designations.warnShortRepeats'))
    if (placed?.overlaps.has(r.element)) w.push(t('designations.warnLabelOverlaps'))
    if (r.isolated) w.push(t('designations.warnIsolated'))
    return w
  }

  const radio = (name: string, value: boolean, onChange: () => void, label: string, disabled = false) => (
    <label className={`flex items-center gap-1.5 ${disabled ? 'text-gray-500' : 'text-gray-200 cursor-pointer'}`}>
      <input type="radio" name={name} checked={value} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  )

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none p-4">
        <div
          className="pointer-events-auto w-full max-w-4xl max-h-full flex flex-col rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3 text-xs"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        >
          <h2
            className="text-sm font-semibold text-gray-100 cursor-move select-none touch-none"
            title={t('designations.dragHint')}
            onPointerDown={e => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drag.current = { x: e.clientX, y: e.clientY, from: offset }
            }}
            onPointerMove={e => {
              const d = drag.current
              if (!d) return
              // The pointer is kept inside the window, so the title stays where it can be grabbed.
              const x = Math.min(Math.max(e.clientX, 0), window.innerWidth)
              const y = Math.min(Math.max(e.clientY, 0), window.innerHeight)
              setOffset({ x: d.from.x + x - d.x, y: d.from.y + y - d.y })
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            {t('designations.title')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <fieldset className="space-y-1">
              <legend className="text-gray-400 mb-1">{t('designations.scope')}</legend>
              {radio('enum-scope', scope === 'diagram', () => setScope('diagram'), t('designations.scopeDiagram'))}
              {radio(
                'enum-scope',
                scope === 'selection',
                () => setScope('selection'),
                t('designations.scopeSelection', { count: selection.length }),
                selection.length === 0,
              )}
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="text-gray-400 mb-1">{t('designations.mode')}</legend>
              {radio('enum-mode', !renumber, () => setRenumber(false), t('designations.modeMissing'))}
              {radio('enum-mode', renumber, () => setRenumber(true), t('designations.modeRenumber'))}
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="text-gray-400 mb-1">{t('designations.format')}</legend>
              {radio('enum-format', format === 'full', () => setFormat('full'), t('designations.formatFull'))}
              {radio('enum-format', format === 'short', () => setFormat('short'), t('designations.formatShort'))}
            </fieldset>
          </div>

          {guessedUnits.length > 0 && (
            <div className="space-y-1">
              <p className="text-amber-300">{t('designations.guessedHint')}</p>
              {guessedUnits.map(f => (
                <div key={f.id} className="flex items-center gap-2 text-gray-200">
                  <span className="font-mono">{diagramOps.functionDesignation(plan?.functions, f.id)}</span>
                  <span className="text-gray-400">{t(FUNCTION_KIND_LABEL[f.kind])}</span>
                  <button
                    type="button"
                    onClick={() => settle(f, false)}
                    className="px-2 py-0.5 rounded border border-surface-600 hover:bg-surface-600"
                  >
                    {t('designations.confirm')}
                  </button>
                  <button
                    type="button"
                    onClick={() => settle(f, true)}
                    className="px-2 py-0.5 rounded border border-surface-600 hover:bg-surface-600"
                  >
                    {t('designations.flip')}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-auto border border-surface-600 rounded">
            {!plan && !error && (
              <p className="flex items-center gap-1.5 p-3 text-gray-400">
                <Loader2 size={12} className="animate-spin" />
                {t('designations.loading')}
              </p>
            )}
            {plan && plan.rows.length === 0 && <p className="p-3 text-gray-400">{t('designations.nothing')}</p>}
            {plan && plan.rows.length > 0 && (
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-surface-700 text-gray-400">
                  <tr>
                    <th className="p-1 w-6">
                      <input
                        type="checkbox"
                        aria-label={t('designations.checkAll')}
                        checked={checked.size === plan.rows.length}
                        onChange={e => setChecked(new Set(e.target.checked ? plan.rows.map(r => r.element) : []))}
                      />
                    </th>
                    <th className="p-1">{t('designations.colElement')}</th>
                    <th className="p-1">{t('designations.colUnit')}</th>
                    {short && <th className="p-1">{t('designations.colLabel')}</th>}
                    <th className="p-1">{t('designations.colName')}</th>
                    <th className="p-1">{t('designations.colWarnings')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map(r => {
                    const el = elementById.get(r.element)
                    const f = functions.get(r.function)
                    const w = warnings(r)
                    return (
                      <tr
                        key={r.element}
                        aria-selected={selected.get(r.element) === 'element'}
                        onClick={e => {
                          if (IS_MAC ? e.metaKey : e.ctrlKey || e.metaKey) {
                            toggleSelection(r.element, 'element')
                            return
                          }
                          selectMany(new Map([[r.element, 'element']]))
                          focusItem(r.element, 'element')
                        }}
                        className={`cursor-pointer border-t border-surface-600 text-gray-200 ${
                          selected.get(r.element) === 'element' ? 'bg-accent/30' : 'hover:bg-surface-600'
                        }`}
                      >
                        <td className="p-1" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checked.has(r.element)}
                            onChange={e => {
                              const next = new Set(checked)
                              if (e.target.checked) next.add(r.element)
                              else next.delete(r.element)
                              setChecked(next)
                            }}
                          />
                        </td>
                        <td className="p-1">
                          {el ? symbolName(el.shape) : ''} <span className="text-gray-500">#{r.element}</span>
                        </td>
                        <td className="p-1 text-gray-300">
                          {f ? t(FUNCTION_KIND_LABEL[f.kind]) : ''}
                          {f?.guessed && <span className="text-amber-300"> ({t('designations.guessed')})</span>}
                        </td>
                        {short && (
                          <td className="p-1 font-mono">
                            {labelText.has(r.element) && (
                              <span className="text-gray-500">{labelText.get(r.element)} → </span>
                            )}
                            {diagramOps.designationText(r.name, 'short')}
                          </td>
                        )}
                        <td className={`p-1 font-mono ${short ? 'text-gray-400' : ''}`}>
                          {r.oldName && <span className="text-gray-500">{r.oldName} → </span>}
                          {r.name}
                        </td>
                        <td className="p-1 text-amber-300">{w.join('; ')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {plan && plan.unplaced.length > 0 && (
            <p className="text-amber-300">
              {t('designations.unplaced', {
                items: plan.unplaced
                  .map(id => {
                    const el = elementById.get(id)
                    return el?.name || `${el ? symbolName(el.shape) : ''} #${id}`
                  })
                  .join(', '),
              })}
            </p>
          )}
          {repeatedShort.size > 0 && !renumber && <p className="text-amber-300">{t('designations.shortRepeatsHint')}</p>}
          {error && <p className="text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            {plan && plan.rows.length > 0 && (
              <span className="mr-auto text-gray-400">
                {t('designations.checkedCount', { checked: checked.size, count: plan.rows.length })}
              </span>
            )}
            <button
              type="button"
              onClick={close}
              className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 text-gray-200"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={!plan || (checked.size === 0 && format === (diagram.editor?.designationFormat ?? 'full'))}
              onClick={apply}
              className="px-3 py-1 rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
            >
              {t('designations.apply')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
