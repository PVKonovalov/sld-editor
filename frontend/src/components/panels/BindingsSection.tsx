import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { Download, FolderTree, Loader2, Lock, RefreshCw, Upload, X } from 'lucide-react'
import { GroupHeader } from './GroupHeader'
import { SchemeLinkRow } from './SchemeLinkRow'
import { t, type TranslationKey } from '../../i18n'
import * as api from '../../lib/api'
import * as diagramOps from '../../lib/diagramOps'
import type { BindingTarget, StaleBinding } from '../../lib/diagramOps'
import { draggedObject, isObjectDrag, optionFor, useBindingDictionaries } from '../../lib/bindingDictionaries'
import { itemTitle } from '../../lib/bindingOverview'
import { useDiagramContext } from '../../state/useDiagramContext'
import type { Binding, BindingDictionaries, BindingKind, Diagram, SchemeRef } from '../../types'

const KINDS: BindingKind[] = ['equipment', 'meas1', 'meas2', 'jump']

// Whether the Bindings groups are collapsed, kept while the selection changes.
let collapsedState = true

function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(collapsedState)
  return [
    collapsed,
    () =>
      setCollapsed(c => {
        collapsedState = !c
        return !c
      }),
  ]
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function SourceTag({ source }: { source: string }) {
  return (
    <span className="shrink-0 rounded bg-surface-600 px-1 text-[10px] uppercase tracking-wide text-gray-300">
      {source}
    </span>
  )
}

function Detail({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === '') return null
  return (
    <div className="flex gap-1 text-[11px]">
      <span className="text-gray-500">{label}:</span>
      <span className="font-mono text-gray-300 break-all">{value}</span>
    </div>
  )
}

/** The provider's options as a combo grouped by global type; a value the dictionaries don't know is kept as is. */
export function OptionSelect({
  dict,
  value,
  onChange,
  className = '',
}: {
  dict: BindingDictionaries | null
  value?: string
  onChange: (alias: string) => void
  className?: string
}) {
  const groups = new Map<string, { name: string; options: BindingDictionaries['options'] }>()
  for (const o of dict?.options ?? []) {
    const key = o.group ?? ''
    if (!groups.has(key)) groups.set(key, { name: o.groupName || o.group || '', options: [] })
    groups.get(key)!.options.push(o)
  }
  const known = dict?.options.some(o => o.alias === value)
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className={`bg-surface-800 border border-surface-600 rounded px-1 py-0.5 text-[11px] text-gray-200 ${className}`}
    >
      {!value && <option value="">—</option>}
      {value && !known && <option value={value}>{value}</option>}
      {[...groups.values()].map(g => (
        <optgroup key={g.name} label={g.name}>
          {g.options.map(o => (
            <option key={o.alias} value={o.alias} title={o.alias}>
              {o.name || o.alias}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

/** A whole number field committed on Enter or blur; check returns whether a value is allowed. */
function IntField({
  value,
  check,
  onCommit,
  title,
}: {
  value: number
  check: (n: number) => boolean
  onCommit: (n: number) => void
  title?: string
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const n = Number(text.trim())
  const valid = text.trim() !== '' && Number.isInteger(n) && check(n)
  const commit = () => {
    if (valid && n !== value) onCommit(n)
    else if (!valid) setText(String(value))
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      title={title}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setText(String(value))
      }}
      className={`w-14 bg-surface-800 border rounded px-1 py-0.5 text-[11px] text-gray-200 ${
        valid ? 'border-surface-600' : 'border-red-500'
      }`}
    />
  )
}

/** A drop zone for Objects-panel objects of the active provider: onObject gets the dragged ref. */
function useObjectDrop(enabled: boolean, provider: string, onObject: (ref: string) => void) {
  const [over, setOver] = useState(false)
  if (!enabled) return { over: false, props: {} }
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!isObjectDrag(e.dataTransfer)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        setOver(false)
        const obj = draggedObject(e.dataTransfer)
        if (!obj) return
        e.preventDefault()
        if (obj.source === provider) onObject(obj.ref)
      },
    },
  }
}

/** One binding (or "—" for none) under its title. Editable (option, scale, remove, drop an object to rebind) when
 * it is of the active provider; a binding of another provider gets a lock and stays read-only. */
/** The full path of a bound object, read when first shown and again when ref changes. */
function useBindingPath(ref: string | undefined) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{ ref: string; text?: string; error?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = (r: string) => {
    setBusy(true)
    api.bindingPath(r).then(
      path => {
        setBusy(false)
        setState({ ref: r, text: path.map(n => n.name || n.ref).join(' / ') })
      },
      e => {
        setBusy(false)
        setState({ ref: r, error: t('bindings.fullPathFailed', { error: errorText(e) }) })
      },
    )
  }
  useEffect(() => {
    if (open && ref && state?.ref !== ref && !busy) load(ref)
  }, [open, ref])
  const current = state?.ref === ref ? state : null
  return {
    open: open && !!ref,
    busy,
    text: current?.text,
    error: current?.error,
    toggle: () => setOpen(v => !v),
  }
}

function BindingRow({
  title,
  binding,
  provider,
  dict,
  editable,
  busy,
  error,
  onDropRef,
  onOption,
  onScale,
  onRemove,
}: {
  title: string
  binding?: Binding
  provider: string
  dict: BindingDictionaries | null
  editable: boolean
  busy?: boolean
  error?: string | null
  onDropRef?: (ref: string) => void
  onOption?: (alias: string) => void
  onScale?: (scale: number) => void
  onRemove?: () => void
}) {
  const foreign = binding !== undefined && binding.source !== provider
  const canEdit = editable && !foreign
  const drop = useObjectDrop(editable && !!onDropRef, provider, ref => onDropRef?.(ref))
  const path = useBindingPath(foreign ? undefined : binding?.ref)
  return (
    <div className="text-xs" {...drop.props}>
      <span className="flex items-center gap-1 text-gray-400 mb-0.5">
        {title}
        {busy && <Loader2 size={11} className="animate-spin" />}
      </span>
      <div
        className={`rounded border px-2 py-1 space-y-0.5 ${
          drop.over ? 'border-accent bg-accent/10' : binding ? 'border-surface-600 bg-surface-800' : 'border-dashed border-surface-600'
        }`}
      >
        {binding ? (
          <>
            <div className="flex items-center gap-1" title={binding.ref}>
              <span className="flex-1 truncate text-gray-200">{binding.name || binding.ref}</span>
              {foreign && (
                <span title={t('bindings.otherSource', { source: binding.source })} className="text-gray-400">
                  <Lock size={12} aria-label={t('bindings.otherSource', { source: binding.source })} />
                </span>
              )}
              <SourceTag source={binding.source} />
              {!foreign && (
                <button
                  type="button"
                  onClick={path.toggle}
                  title={t('bindings.fullPath')}
                  aria-label={t('bindings.fullPath')}
                  aria-pressed={path.open}
                  className={path.open ? 'text-accent' : 'text-gray-400 hover:text-gray-200'}
                >
                  {path.busy ? <Loader2 size={12} className="animate-spin" /> : <FolderTree size={12} />}
                </button>
              )}
              {canEdit && onRemove && (
                <button
                  type="button"
                  onClick={onRemove}
                  title={t('bindings.remove')}
                  aria-label={t('bindings.remove')}
                  className="text-gray-400 hover:text-red-300"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {path.open && path.text && (
              <p className="text-[11px] text-gray-300 break-words" title={path.text}>
                {path.text}
              </p>
            )}
            {path.open && path.error && <p className="text-[11px] text-red-300 break-words">{path.error}</p>}
            <Detail label={t('bindings.type')} value={binding.type} />
            {canEdit && onOption ? (
              <label className="flex items-center gap-1 text-[11px]">
                <span className="text-gray-500 w-14 shrink-0">{t('bindings.option')}:</span>
                <OptionSelect dict={dict} value={binding.option} onChange={onOption} className="flex-1 min-w-0" />
              </label>
            ) : (
              <Detail label={t('bindings.option')} value={binding.option} />
            )}
            {canEdit && onScale ? (
              <label className="flex items-center gap-1 text-[11px]">
                <span className="text-gray-500 w-14 shrink-0">{t('bindings.scale')}:</span>
                <IntField value={binding.scale || 1} check={n => n !== 0} onCommit={onScale} title={t('bindings.scaleHint')} />
              </label>
            ) : (
              onScale !== undefined || binding.scale ? <Detail label={t('bindings.scale')} value={binding.scale || 1} /> : null
            )}
          </>
        ) : (
          <span className="block text-gray-500 text-[11px]">{editable ? t('bindings.dropHere') : '—'}</span>
        )}
      </div>
      {error && <p className="mt-0.5 text-[11px] text-red-300 break-words">{error}</p>}
    </div>
  )
}

/** The Features checkboxes: a comma-separated list of the provider's feature aliases; unknown aliases are kept. */
function FeaturesField({ dict, value, onChange }: { dict: BindingDictionaries; value?: string; onChange: (v: string) => void }) {
  const set = new Set((value ?? '').split(',').map(s => s.trim()).filter(Boolean))
  return (
    <div className="space-y-0.5">
      {dict.features.map(f => (
        <label key={f.alias} className="flex items-center gap-1.5 text-[11px] text-gray-300" title={f.alias}>
          <input
            type="checkbox"
            checked={set.has(f.alias)}
            onChange={e => {
              const next = new Set(set)
              if (e.target.checked) next.add(f.alias)
              else next.delete(f.alias)
              onChange([...next].join(','))
            }}
          />
          {f.name || f.alias}
        </label>
      ))}
    </div>
  )
}

/** "Remove all", asking once more before it acts. */
function RemoveAll({ onRemove }: { onRemove: () => void }) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="text-[11px] text-red-300 hover:underline">
        {t('bindings.removeAll')}
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-gray-300">{t('bindings.removeAllConfirm')}</span>
      <button
        type="button"
        onClick={() => {
          setAsking(false)
          onRemove()
        }}
        className="rounded bg-red-900 px-1.5 text-red-100 hover:bg-red-800"
      >
        {t('bindings.removeAllYes')}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="text-gray-400 hover:text-white">
        {t('common.cancel')}
      </button>
    </div>
  )
}

/** The Bindings group of a selected element or digital device; nothing when bindings are off (provider ""). Every
 * kind can be bound by dropping an Objects-panel object on its row. */
export function BindingsSection({
  provider,
  target,
  bindings,
  precision,
  features,
}: {
  provider: string
  target: BindingTarget
  bindings?: Binding[]
  precision?: number
  features?: string
}) {
  const { updateDiagram } = useDiagramContext()
  const [collapsed, toggle] = useCollapsed()
  const { dict, error: dictError } = useBindingDictionaries(!!provider && !collapsed)
  const [busy, setBusy] = useState<BindingKind | null>(null)
  const [dropError, setDropError] = useState<{ kind: BindingKind; error: string } | null>(null)
  useEffect(() => setDropError(null), [target.kind, target.id])
  if (!provider) return null

  const own = bindings?.filter(b => b.source === provider) ?? []
  function bindRef(kind: BindingKind, ref: string) {
    setBusy(kind)
    setDropError(null)
    api.resolveBinding(ref).then(
      obj => {
        setBusy(null)
        updateDiagram(d => diagramOps.setItemBinding(d, target, diagramOps.bindingFromResolved(provider, obj, kind, optionFor(kind, obj, dict))))
      },
      e => {
        setBusy(null)
        setDropError({ kind, error: t('bindings.resolveFailed', { error: errorText(e) }) })
      },
    )
  }

  return (
    <div>
      <GroupHeader label={t('bindings.title')} collapsed={collapsed} onToggle={toggle} topic="properties-bindings" />
      {!collapsed && (
        <div className="space-y-2">
          {dictError && <p className="text-[11px] text-red-300">{t('bindings.dictionariesFailed', { error: dictError })}</p>}
          {KINDS.map(kind => (
            <BindingRow
              key={kind}
              title={t(`bindings.kind.${kind}` as TranslationKey)}
              binding={bindings?.find(b => b.kind === kind)}
              provider={provider}
              dict={dict}
              editable
              busy={busy === kind}
              error={dropError?.kind === kind ? dropError.error : null}
              onDropRef={ref => bindRef(kind, ref)}
              onOption={option => updateDiagram(d => diagramOps.updateItemBinding(d, target, kind, { option }))}
              onScale={scale => updateDiagram(d => diagramOps.updateItemBinding(d, target, kind, { scale }))}
              onRemove={() => updateDiagram(d => diagramOps.removeItemBinding(d, target, kind))}
            />
          ))}
          <label className="flex items-center gap-1 text-xs">
            <span className="text-gray-400 flex-1">{t('bindings.precision')}</span>
            <IntField
              value={precision ?? 0}
              check={n => n >= 0 && n <= 10}
              onCommit={n => updateDiagram(d => diagramOps.setItemBindingExtras(d, target, { precision: n }))}
              title={t('bindings.precisionHint')}
            />
          </label>
          <div className="text-xs">
            <span className="block text-gray-400 mb-0.5">{t('bindings.features')}</span>
            {dict ? (
              <FeaturesField
                dict={dict}
                value={features}
                onChange={v => updateDiagram(d => diagramOps.setItemBindingExtras(d, target, { features: v }))}
              />
            ) : (
              <Detail label={t('bindings.features')} value={features} />
            )}
          </div>
          {(own.length > 0 || !!precision || !!features) && (
            <RemoveAll onRemove={() => updateDiagram(d => diagramOps.removeAllItemBindings(d, target, provider))} />
          )}
        </div>
      )}
    </div>
  )
}

function staleLabel(s: StaleBinding, diagram: Diagram): string {
  if (!s.target) return t('bindings.object')
  return `${itemTitle(diagram, s.target)} · ${t(`bindings.kind.${s.kind}` as TranslationKey)}`
}

/** Refresh bindings: re-reads every binding of the active provider and updates what it caches (one undo step),
 * then reports the bindings whose object is gone. */
function RefreshBindings({ provider }: { provider: string }) {
  const { diagram, updateDiagram, selectMany, focusItem } = useDiagramContext()
  const [state, setState] = useState<
    { status: 'idle' } | { status: 'busy' } | { status: 'error'; error: string } | { status: 'done'; updated: number; total: number; stale: StaleBinding[] }
  >({ status: 'idle' })
  if (!diagram) return null

  function run() {
    const refs = diagramOps.bindingRefs(diagram!, provider)
    if (refs.length === 0) {
      setState({ status: 'done', updated: 0, total: 0, stale: [] })
      return
    }
    setState({ status: 'busy' })
    api.resolveBindings(refs).then(
      res => {
        let report = { updated: 0, stale: [] as StaleBinding[] }
        updateDiagram(d => {
          const r = diagramOps.refreshBindings(d, provider, res.objects, res.missing)
          report = { updated: r.updated, stale: r.stale }
          return r.diagram
        })
        setState({ status: 'done', total: refs.length, ...report })
      },
      e => setState({ status: 'error', error: errorText(e) }),
    )
  }

  let body: ReactNode = null
  if (state.status === 'error') body = <p className="text-[11px] text-red-300 break-words">{t('bindings.refreshFailed', { error: state.error })}</p>
  if (state.status === 'done') {
    body = (
      <div className="space-y-1 text-[11px]">
        <p className="text-gray-300">
          {t('bindings.refreshDone', { total: state.total, updated: state.updated, missing: state.stale.length })}
        </p>
        {state.stale.length > 0 && (
          <ul className="space-y-0.5">
            {state.stale.map((s, i) => (
              <li key={i} className="flex items-center gap-1">
                <span className="flex-1 truncate text-amber-300" title={s.ref}>
                  {staleLabel(s, diagram)}
                </span>
                <span className="font-mono text-gray-500">{s.ref}</span>
                {s.target && (
                  <button
                    type="button"
                    onClick={() => {
                      selectMany(new Map([[s.target!.id, s.target!.kind]]))
                      focusItem(s.target!.id, s.target!.kind)
                    }}
                    className="text-accent hover:underline"
                  >
                    {t('bindings.staleSelect')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={run}
        disabled={state.status === 'busy'}
        title={t('bindings.refreshHint')}
        className="flex items-center gap-1.5 rounded bg-surface-600 px-2 py-1 text-xs text-gray-100 hover:bg-surface-500 disabled:opacity-60"
      >
        {state.status === 'busy' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        {t('bindings.refresh')}
      </button>
      {body}
    </div>
  )
}

/** The diagram's scheme link (SchemeLinkRow) and the object the whole diagram is bound to, set by dropping an Objects-panel
 * object on its row; Refresh bindings for every binding of the diagram. Nothing when bindings are off. */
export function DiagramBindingsSection({
  provider,
  scheme,
  object,
}: {
  provider: string
  scheme?: SchemeRef
  object?: Binding
}) {
  const { updateDiagram, config, diagramName, setExportOpen } = useDiagramContext()
  const [collapsed, toggle] = useCollapsed()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!provider) return null

  function bindRef(ref: string) {
    setBusy(true)
    setError(null)
    api.resolveBinding(ref).then(
      obj => {
        setBusy(false)
        updateDiagram(d => diagramOps.setDiagramObject(d, diagramOps.bindingFromResolved(provider, obj, 'equipment')))
      },
      e => {
        setBusy(false)
        setError(t('bindings.resolveFailed', { error: errorText(e) }))
      },
    )
  }

  return (
    <div>
      <GroupHeader label={t('bindings.title')} collapsed={collapsed} onToggle={toggle} topic="properties-bindings" />
      {!collapsed && (
        <div className="space-y-2">
          <SchemeLinkRow provider={provider} scheme={scheme} schemes={!!config?.bindings?.schemes} />
          <BindingRow
            title={t('bindings.object')}
            binding={object}
            provider={provider}
            dict={null}
            editable
            busy={busy}
            error={error}
            onDropRef={bindRef}
            onRemove={() => updateDiagram(d => diagramOps.setDiagramObject(d, undefined))}
          />
          <RefreshBindings provider={provider} />
          {config?.bindings?.import && diagramName && scheme?.source === provider && <ImportBindingsButton name={diagramName} />}
          {config?.bindings?.exportCheck && diagramName && (
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="flex items-center gap-1 rounded border border-surface-500 px-2 py-0.5 text-xs hover:bg-surface-600"
            >
              <Upload size={12} />
              {t('exportCheck.open')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Reads the bindings of the scheme the saved diagram name is linked to; the bindings overview then compares them
 * with the diagram's. Off while the diagram has unsaved changes, since the link read is the saved one. */
function ImportBindingsButton({ name }: { name: string }) {
  const { dirty, setBindingImport } = useDiagramContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function run() {
    setBusy(true)
    setError(null)
    api.importBindings(name).then(
      res => {
        setBusy(false)
        setBindingImport(res)
      },
      e => {
        setBusy(false)
        setError(t('bindingImport.failed', { error: errorText(e) }))
      },
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={busy || dirty}
        title={dirty ? t('bindingImport.saveFirst') : undefined}
        className="flex items-center gap-1 rounded border border-surface-500 px-2 py-0.5 text-xs hover:bg-surface-600 disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        {t('bindingImport.open')}
      </button>
      {error && <p className="text-[11px] text-red-300 break-words">{error}</p>}
    </>
  )
}
