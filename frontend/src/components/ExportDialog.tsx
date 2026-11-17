import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleX, Link2, Loader2, RefreshCw, Save } from 'lucide-react'
import { t, type TranslationKey } from '../i18n'
import * as api from '../lib/api'
import * as diagramOps from '../lib/diagramOps'
import { nestSchemes, type SchemeGroupNode } from '../lib/schemes'
import { useEscapeKey } from '../lib/useEscapeKey'
import { useDiagramContext, type SelectionKind } from '../state/useDiagramContext'
import { GuideButton } from './GuideButton'
import { SchemePicker } from './SchemePicker'
import type { ExportCheck, ExportIssue, ExportResult, ProviderScheme, SchemeGroup } from '../types'

/** Groups as select options: depth-first, each with its depth. */
function flattenGroups(nodes: SchemeGroupNode[], depth = 0, out: { group: SchemeGroup; depth: number }[] = []) {
  for (const n of nodes) {
    if (n.group.id) out.push({ group: n.group, depth })
    flattenGroups(n.groups, depth + 1, out)
  }
  return out
}

function baseName(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1)
}

function issueText(i: ExportIssue): string {
  const item = i.item === undefined ? '' : t(i.kind === 'device' ? 'exportCheck.device' : 'exportCheck.element', { id: i.item })
  const schemes = (i.schemes ?? []).map(s => `${s.name || s.ref} (${s.ref})`).join(', ')
  return t(`exportCheck.issue.${i.code}` as TranslationKey, { item, shape: i.shape ?? '', detail: i.detail ?? '', schemes })
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Where an unlinked diagram (or one whose scheme is gone) goes: a new scheme, or an existing one linked first. */
type Target = 'register' | 'existing'

/** Export of the open, saved diagram to the provider. A linked scheme is exported to, its name, alias and group
 * editable; otherwise the user chooses to register a new scheme (name, alias, group: proposed, the group of the
 * scheme exported last) or to link an existing one. The check of the saved diagram lists what stops the export and
 * what is skipped; Export runs it, then reopens the diagram with its new link. */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { diagram, diagramName, dirty, saveDiagram, updateDiagram, selectMany, focusItem, openDiagram, config } =
    useDiagramContext()
  const provider = config?.bindings?.provider ?? ''
  const canExport = !!config?.bindings?.canExport
  const name = diagramName ?? ''
  const [target, setTarget] = useState<Target | null>(null)
  const [check, setCheck] = useState<ExportCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seq, setSeq] = useState(0)
  const [groups, setGroups] = useState<SchemeGroup[] | null>(null)
  const [form, setForm] = useState<{ name: string; alias: string; group: string | null }>({
    name: baseName(name),
    alias: '',
    group: null,
  })
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ExportResult | null>(null)

  const register = target === 'register'
  useEffect(() => {
    if (result) return
    let live = true
    setError(null)
    api.checkExport(name, register).then(
      c => live && setCheck(c),
      e => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [name, seq, register, result])

  // A linked scheme's own name, alias and group are the starting values.
  const linked = check?.scheme ?? null
  const linkedRef = linked?.ref
  useEffect(() => {
    if (linked) setForm({ name: linked.name, alias: linked.alias ?? '', group: linked.group })
  }, [linkedRef])

  useEffect(() => {
    if (groups) return
    let live = true
    api.listSchemeGroups().then(
      g => live && setGroups(g),
      e => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [groups])

  useEscapeKey(onClose, !picking)

  const options = useMemo(() => (groups ? flattenGroups(nestSchemes({ groups, schemes: [] })) : []), [groups])
  const chosenGroup = form.group ?? check?.defaultGroup ?? ''
  const groupName = (id: string) => groups?.find(g => g.id === id)?.name ?? id

  function show(i: ExportIssue) {
    if (i.item === undefined || !i.kind) return
    const kind: SelectionKind = i.kind === 'device' ? 'digitaldevice' : 'element'
    selectMany(new Map([[i.item, kind]]))
    focusItem(i.item, kind)
  }

  function link(s: ProviderScheme) {
    setPicking(false)
    setTarget(null)
    updateDiagram(d => diagramOps.setDiagramScheme(d, { source: provider, ref: s.ref }))
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      if (e instanceof api.ExportRefusedError) setCheck(e.check)
      else setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const saveAndCheck = () =>
    run(async () => {
      await saveDiagram()
      setSeq(n => n + 1)
    })

  const doExport = () =>
    run(async () => {
      const res = await api.exportDiagram(name, {
        register,
        name: form.name.trim(),
        alias: form.alias.trim(),
        group: chosenGroup,
      })
      setResult(res)
      await openDiagram(name)
    })

  const ownLink = !diagram?.scheme || diagram.scheme.source === provider
  const missing = !!check?.issues.some(i => i.code === 'schemeMissing')
  // Unlinked, or linked to a scheme that is gone: the user picks where the export goes.
  const choosing = !!check && !linked && ownLink && (missing || !diagram?.scheme || register)
  const ready =
    canExport && !!check?.ok && !dirty && !busy && (!!linked || (register && !!form.name.trim() && !!chosenGroup))
  const blocker = !canExport
    ? t('exportCheck.exportOff')
    : dirty
      ? t('exportCheck.saveFirst')
      : choosing && !register
        ? t('exportCheck.chooseFirst')
        : ''

  const errors = check?.issues.filter(i => i.severity === 'error') ?? []
  const warnings = check?.issues.filter(i => i.severity === 'warning') ?? []
  const issueList = (list: ExportIssue[], severity: ExportIssue['severity'], title: string) =>
    list.length > 0 && (
      <section>
        <h3 className={`mb-1 ${severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>{title}</h3>
        <ul className="space-y-0.5">
          {list.map((i, n) => (
            <li key={n} className="flex items-start gap-1.5">
              {severity === 'error' ? (
                <CircleX size={12} className="mt-0.5 shrink-0 text-red-400" />
              ) : (
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" />
              )}
              {i.item !== undefined ? (
                <button type="button" onClick={() => show(i)} className="text-left text-gray-200 hover:underline">
                  {issueText(i)}
                </button>
              ) : (
                <span className="text-gray-200 break-words">{issueText(i)}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    )

  const field = 'w-full bg-surface-900 border border-surface-600 rounded px-1.5 py-0.5'
  const schemeFields = (
    <>
      <label className="block">
        <span className="block text-gray-400">{t('exportCheck.schemeName')}</span>
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={field} />
      </label>
      <label className="block">
        <span className="block text-gray-400">{t('exportCheck.alias')}</span>
        <input
          value={form.alias}
          placeholder={form.name}
          onChange={e => setForm({ ...form, alias: e.target.value })}
          className={field}
        />
      </label>
      <label className="block">
        <span className="block text-gray-400">{t('exportCheck.group')}</span>
        {groups ? (
          <select value={chosenGroup} onChange={e => setForm({ ...form, group: e.target.value })} className={field}>
            <option value="">{t('exportCheck.chooseGroup')}</option>
            {options.map(o => (
              <option key={o.group.id} value={o.group.id}>
                {' '.repeat(o.depth * 3) + (o.group.name || o.group.id)}
              </option>
            ))}
          </select>
        ) : (
          <Loader2 size={12} className="animate-spin text-gray-400" />
        )}
      </label>
      {!linked && check?.defaultGroup && groups && chosenGroup === check.defaultGroup && (
        <p className="text-[11px] text-gray-500">{t('exportCheck.lastGroup', { name: groupName(check.defaultGroup) })}</p>
      )}
    </>
  )

  const body = result ? (
    <section className="space-y-2">
      <p className="flex items-start gap-1.5 text-emerald-300">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
        {t('exportCheck.done', {
          name: form.name.trim() || result.scheme.ref,
          ref: result.scheme.ref,
          components: result.components,
          bindings: result.bindings,
        })}
      </p>
      {issueList(result.skipped, 'warning', t('exportCheck.skipped', { count: result.skipped.length }))}
      {result.svgError ? (
        <p className="text-red-300 break-words">{t('exportCheck.svgFailed', { error: result.svgError })}</p>
      ) : result.svg?.length ? (
        <div className="text-gray-300">
          {t('exportCheck.svgDelivered')}
          <ul className="text-gray-400 break-all">
            {result.svg.map(w => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-amber-300">{t('exportCheck.svgNowhere')}</p>
      )}
      {result.registered && <p className="text-gray-300">{t('exportCheck.menuNote')}</p>}
      <p className="text-gray-400">{t('exportCheck.reloadNote')}</p>
      {error && <p className="text-red-300 break-words">{error}</p>}
    </section>
  ) : error && !check ? (
    <p className="text-red-300 break-words">{t('exportCheck.failed', { error })}</p>
  ) : !check ? (
    <Loader2 size={12} className="animate-spin text-gray-400" />
  ) : (
    <>
      <section className="space-y-1">
        <h3 className="text-gray-400">{t('bindings.scheme')}</h3>
        {linked ? (
          <div className="space-y-1.5 rounded border border-surface-600 bg-surface-800 p-2">
            <div className="text-gray-100">
              {linked.name || linked.ref} <span className="text-gray-500">({linked.ref})</span>
            </div>
            {schemeFields}
          </div>
        ) : choosing ? (
          <div className="space-y-1.5 rounded border border-surface-600 bg-surface-800 p-2">
            <p className="text-gray-300">{t(missing ? 'exportCheck.targetMissing' : 'exportCheck.targetUnlinked')}</p>
            <div role="radiogroup" className="space-y-0.5">
              {(['register', 'existing'] as const).map(v => (
                <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="export-target" checked={target === v} onChange={() => setTarget(v)} />
                  {t(v === 'register' ? 'exportCheck.targetRegister' : 'exportCheck.targetExisting')}
                </label>
              ))}
            </div>
            {register && (
              <>
                {schemeFields}
                <p className="text-[11px] text-gray-400">{t('exportCheck.menuNote')}</p>
              </>
            )}
            {target === 'existing' && config?.bindings?.schemes && (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="flex items-center gap-1 rounded border border-surface-500 px-2 py-0.5 hover:bg-surface-600"
              >
                <Link2 size={12} />
                {t('exportCheck.useExisting')}
              </button>
            )}
          </div>
        ) : null}
      </section>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-gray-400">{t('exportCheck.schemeType')}</dt>
        <dd className="text-gray-200">{check.schemeType ? `${check.schemeType.name} (${check.schemeType.id})` : '—'}</dd>
        <dt className="text-gray-400">{t('exportCheck.fileName')}</dt>
        <dd className="text-gray-200 break-all">{check.fileName}</dd>
        <dt className="text-gray-400">{t('exportCheck.svgPath')}</dt>
        <dd className="text-gray-200 break-all">{check.svgPath || '—'}</dd>
        <dt className="text-gray-400">{t('exportCheck.bound')}</dt>
        <dd className="text-gray-200">{check.bound}</dd>
      </dl>
      {issueList(errors, 'error', t('exportCheck.errors', { count: errors.length }))}
      {issueList(warnings, 'warning', t('exportCheck.warnings', { count: warnings.length }))}
      {check.issues.length === 0 && <p className="text-emerald-300">{t('exportCheck.allGood')}</p>}
      {error && <p className="text-red-300 break-words">{error}</p>}
    </>
  )

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
        <div
          role="dialog"
          aria-label={t('exportCheck.title')}
          className="pointer-events-auto w-[32rem] max-h-[85vh] flex flex-col rounded border border-surface-600 bg-surface-700 p-4 shadow-lg gap-3 text-xs"
        >
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">
            {t('exportCheck.title')}
            <GuideButton topic="rsdu-export" />
            {!result && (
              <button
                type="button"
                onClick={() => setSeq(n => n + 1)}
                title={t('exportCheck.recheck')}
                aria-label={t('exportCheck.recheck')}
                className="ml-auto text-gray-400 hover:text-white"
              >
                <RefreshCw size={12} />
              </button>
            )}
          </h2>
          <p className="text-gray-400 truncate" title={name}>
            {t('schemes.pickFor', { name })}
          </p>
          {dirty && !result && (
            <div className="flex items-center gap-2 rounded border border-amber-700 bg-amber-950/40 px-2 py-1 text-amber-200">
              <span className="flex-1">{t('exportCheck.unsaved')}</span>
              <button
                type="button"
                disabled={busy}
                onClick={saveAndCheck}
                className="flex items-center gap-1 rounded border border-amber-600 px-2 py-0.5 hover:bg-amber-900/50 disabled:opacity-50"
              >
                <Save size={12} />
                {t('exportCheck.saveAndCheck')}
              </button>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-auto space-y-3">{body}</div>
          {check && !result && (
            <p className={check.ok ? 'text-emerald-300' : 'text-red-300'}>
              {t(check.ok ? 'exportCheck.ok' : 'exportCheck.notOk')}
            </p>
          )}
          {blocker && !result && <p className="text-[11px] text-gray-400">{blocker}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-2 py-1 text-gray-300 hover:text-white">
              {t('common.close')}
            </button>
            {!result && (
              <button
                type="button"
                disabled={!ready}
                onClick={doExport}
                className="flex items-center gap-1 rounded bg-accent px-3 py-1 text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy && <Loader2 size={12} className="animate-spin" />}
                {t('exportCheck.export')}
              </button>
            )}
          </div>
        </div>
      </div>
      {picking && diagram && (
        <SchemePicker name={name} source={diagram.source} onPick={link} onClose={() => setPicking(false)} />
      )}
    </>
  )
}
