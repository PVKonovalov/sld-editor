import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CircleX, Link2, Loader2, RefreshCw, Save } from 'lucide-react'
import { t, type TranslationKey } from '../i18n'
import * as api from '../lib/api'
import * as diagramOps from '../lib/diagramOps'
import { nestSchemes, type SchemeGroupNode } from '../lib/schemes'
import { useEscapeKey } from '../lib/useEscapeKey'
import { useDiagramContext, type SelectionKind } from '../state/useDiagramContext'
import { GuideButton } from './GuideButton'
import { SchemePicker } from './SchemePicker'
import type { ExportCheck, ExportIssue, ProviderScheme, SchemeGroup } from '../types'

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

/** Export of the open diagram to the provider. This version only checks: the scheme it goes to (linked, or a new
 * one with its name and group, proposed: the group of the scheme exported last), the scheme type, where its SVG goes
 * and what stops it or is skipped; Export stays disabled. The check covers the saved diagram. */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { diagram, diagramName, dirty, saveDiagram, updateDiagram, selectMany, focusItem, config } = useDiagramContext()
  const provider = config?.bindings?.provider ?? ''
  const canExport = !!config?.bindings?.canExport
  const name = diagramName ?? ''
  const [check, setCheck] = useState<ExportCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seq, setSeq] = useState(0)
  const [groups, setGroups] = useState<SchemeGroup[] | null>(null)
  const [schemeName, setSchemeName] = useState(baseName(name))
  const [group, setGroup] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    setCheck(null)
    setError(null)
    api.checkExport(name).then(
      c => live && setCheck(c),
      e => live && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [name, seq])

  const isNew = !!check && !check.scheme
  useEffect(() => {
    if (!isNew || groups) return
    let live = true
    api.listSchemeGroups().then(
      g => live && setGroups(g),
      e => live && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [isNew, groups])

  useEscapeKey(onClose, !picking)

  const options = useMemo(() => (groups ? flattenGroups(nestSchemes({ groups, schemes: [] })) : []), [groups])
  const chosenGroup = group ?? check?.defaultGroup ?? ''
  const groupName = (id: string) => groups?.find(g => g.id === id)?.name ?? id

  function show(i: ExportIssue) {
    if (i.item === undefined || !i.kind) return
    const kind: SelectionKind = i.kind === 'device' ? 'digitaldevice' : 'element'
    selectMany(new Map([[i.item, kind]]))
    focusItem(i.item, kind)
  }

  function link(s: ProviderScheme) {
    setPicking(false)
    updateDiagram(d => diagramOps.setDiagramScheme(d, { source: provider, ref: s.ref }))
  }

  async function saveAndCheck() {
    setSaving(true)
    try {
      await saveDiagram()
      setSeq(n => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const errors = check?.issues.filter(i => i.severity === 'error') ?? []
  const warnings = check?.issues.filter(i => i.severity === 'warning') ?? []
  const issueList = (list: ExportIssue[], severity: ExportIssue['severity']) =>
    list.length > 0 && (
      <section>
        <h3 className={`mb-1 ${severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
          {t(severity === 'error' ? 'exportCheck.errors' : 'exportCheck.warnings', { count: list.length })}
        </h3>
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
            <button
              type="button"
              onClick={() => setSeq(n => n + 1)}
              title={t('exportCheck.recheck')}
              aria-label={t('exportCheck.recheck')}
              className="ml-auto text-gray-400 hover:text-white"
            >
              <RefreshCw size={12} />
            </button>
          </h2>
          <p className="text-gray-400 truncate" title={name}>
            {t('schemes.pickFor', { name })}
          </p>
          {dirty && (
            <div className="flex items-center gap-2 rounded border border-amber-700 bg-amber-950/40 px-2 py-1 text-amber-200">
              <span className="flex-1">{t('exportCheck.unsaved')}</span>
              <button
                type="button"
                disabled={saving}
                onClick={saveAndCheck}
                className="flex items-center gap-1 rounded border border-amber-600 px-2 py-0.5 hover:bg-amber-900/50 disabled:opacity-50"
              >
                <Save size={12} />
                {t('exportCheck.saveAndCheck')}
              </button>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-auto space-y-3">
            {error ? (
              <p className="text-red-300 break-words">{t('exportCheck.failed', { error })}</p>
            ) : !check ? (
              <Loader2 size={12} className="animate-spin text-gray-400" />
            ) : (
              <>
                <section className="space-y-1">
                  <h3 className="text-gray-400">{t('bindings.scheme')}</h3>
                  {check.scheme ? (
                    <div className="rounded border border-surface-600 bg-surface-800 px-2 py-1">
                      <div className="text-gray-100">
                        {check.scheme.name || check.scheme.ref} <span className="text-gray-500">({check.scheme.ref})</span>
                      </div>
                      <div className="text-[11px] text-gray-500">{check.scheme.fileName}</div>
                    </div>
                  ) : (
                    <div className="space-y-1.5 rounded border border-surface-600 bg-surface-800 p-2">
                      <p className="text-gray-300">{t('exportCheck.newScheme')}</p>
                      <label className="block">
                        <span className="block text-gray-400">{t('exportCheck.schemeName')}</span>
                        <input
                          value={schemeName}
                          onChange={e => setSchemeName(e.target.value)}
                          className="w-full bg-surface-900 border border-surface-600 rounded px-1.5 py-0.5"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-gray-400">{t('exportCheck.group')}</span>
                        {groups ? (
                          <select
                            value={chosenGroup}
                            onChange={e => setGroup(e.target.value)}
                            className="w-full bg-surface-900 border border-surface-600 rounded px-1 py-0.5"
                          >
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
                      {check.defaultGroup && groups && chosenGroup === check.defaultGroup && (
                        <p className="text-[11px] text-gray-500">{t('exportCheck.lastGroup', { name: groupName(check.defaultGroup) })}</p>
                      )}
                      <p className="text-[11px] text-gray-400">{t('exportCheck.menuNote')}</p>
                      {config?.bindings?.schemes && (
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
                  )}
                </section>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <dt className="text-gray-400">{t('exportCheck.schemeType')}</dt>
                  <dd className="text-gray-200">
                    {check.schemeType ? `${check.schemeType.name} (${check.schemeType.id})` : '—'}
                  </dd>
                  <dt className="text-gray-400">{t('exportCheck.fileName')}</dt>
                  <dd className="text-gray-200 break-all">{check.fileName}</dd>
                  <dt className="text-gray-400">{t('exportCheck.svgPath')}</dt>
                  <dd className="text-gray-200 break-all">{check.svgPath || '—'}</dd>
                  <dt className="text-gray-400">{t('exportCheck.bound')}</dt>
                  <dd className="text-gray-200">{check.bound}</dd>
                </dl>
                {issueList(errors, 'error')}
                {issueList(warnings, 'warning')}
                {check.issues.length === 0 && <p className="text-emerald-300">{t('exportCheck.allGood')}</p>}
              </>
            )}
          </div>
          {check && (
            <p className={check.ok ? 'text-emerald-300' : 'text-red-300'}>
              {t(check.ok ? 'exportCheck.ok' : 'exportCheck.notOk')}
            </p>
          )}
          {!canExport && <p className="text-[11px] text-gray-400">{t('exportCheck.noWrite')}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-2 py-1 text-gray-300 hover:text-white">
              {t('common.close')}
            </button>
            <button
              type="button"
              disabled
              title={t('exportCheck.exportLater')}
              className="rounded bg-accent px-3 py-1 text-white disabled:opacity-50"
            >
              {t('exportCheck.export')}
            </button>
          </div>
        </div>
      </div>
      {picking && diagram && (
        <SchemePicker name={name} source={diagram.source} onPick={link} onClose={() => setPicking(false)} />
      )}
    </>
  )
}
