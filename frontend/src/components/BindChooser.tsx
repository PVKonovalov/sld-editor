import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { t, type TranslationKey } from '../i18n'
import * as api from '../lib/api'
import * as diagramOps from '../lib/diagramOps'
import type { BindingTarget } from '../lib/diagramOps'
import { optionFor, useBindingDictionaries } from '../lib/bindingDictionaries'
import { bindables, itemTitle } from '../lib/bindingOverview'
import { useDiagramContext } from '../state/useDiagramContext'
import { OptionSelect } from './panels/BindingsSection'
import type { Binding, BindingKind, BindingResolved } from '../types'

// The kinds offered for an item: a bar instrument takes its value and its setpoints, every other item the rest.
const KINDS: BindingKind[] = ['equipment', 'meas1', 'meas2', 'jump']
const BAR_KINDS: BindingKind[] = ['meas1', 'setpointLA', 'setpointLW', 'setpointHW', 'setpointHA']

// The class an item other than an element is described to the provider as.
const ITEM_CLASS: Record<BindingTarget['kind'], string> = {
  element: '',
  digitaldevice: 'DigitalDevice',
  barinstrument: 'BarInstrument',
  label: 'Label',
  connector: 'Connector',
}

/** What was dropped where: the object ref, the item it was dropped on and the drop point in the window. */
export interface BindDrop {
  ref: string
  name: string
  target: BindingTarget
  x: number
  y: number
}

type Mode = 'auto' | BindingKind

/** The chooser opened by dropping an Objects-panel object on an element, digital device, text label or wire. The object is resolved
 * and the provider's automatic bindings fetched. Auto (the default when the provider proposes any) lists them, each
 * with a checkbox; a kind binds the object alone with an option, preset as the provider suggests. Bind writes them
 * in one undo step, each replacing the item's binding of its kind. */
export function BindChooser({ drop, provider, onClose }: { drop: BindDrop; provider: string; onClose: () => void }) {
  const { diagram, updateDiagram } = useDiagramContext()
  const { dict } = useBindingDictionaries(true)
  const [obj, setObj] = useState<BindingResolved | null>(null)
  const [auto, setAuto] = useState<Binding[] | null>(null)
  const [autoError, setAutoError] = useState<string | null>(null)
  const [unticked, setUnticked] = useState<Set<BindingKind>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [option, setOption] = useState<string | undefined>()
  const box = useRef<HTMLDivElement>(null)

  const item = diagram
    ? bindables(diagram).find(b => b.target.kind === drop.target.kind && b.target.id === drop.target.id)
    : undefined
  const element = { shape: item?.shape ?? '', class: item?.sub ?? ITEM_CLASS[drop.target.kind] }

  useEffect(() => {
    let live = true
    api.resolveBinding(drop.ref).then(
      o => {
        if (!live) return
        setObj(o)
        setOption(o.option)
      },
      e => live && setError(e instanceof Error ? e.message : String(e)),
    )
    api.suggestBindings(drop.ref, element).then(
      bs => live && setAuto(bs),
      e => {
        if (!live) return
        setAuto([])
        setAutoError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      live = false
    }
    // The element is read once, when the object is dropped.
  }, [drop.ref])

  // Auto by default when the provider proposes something, else the suggested kind.
  useEffect(() => {
    if (mode !== null || !obj || auto === null) return
    setMode(auto.length > 0 ? 'auto' : obj.kind)
  }, [mode, obj, auto])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const existing = (kind: BindingKind) => item?.bindings?.find(b => b.kind === kind)
  const itemName = diagram ? itemTitle(diagram, drop.target) : ''

  const chosen = mode === 'auto' ? (auto ?? []).filter(b => !unticked.has(b.kind)) : []
  const ready = !!obj && mode !== null && (mode !== 'auto' || chosen.length > 0)

  function bind() {
    if (!obj || mode === null) return
    const bindings =
      mode === 'auto' ? chosen : [diagramOps.bindingFromResolved(provider, obj, mode, option)]
    updateDiagram(d => diagramOps.setItemBindings(d, drop.target, bindings))
    onClose()
  }

  const left = Math.min(drop.x, window.innerWidth - 340)
  const top = Math.min(drop.y, window.innerHeight - 420)
  const loading = (!obj || auto === null) && !error
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={t('bindings.chooserTitle')}
      className="fixed z-50 w-80 rounded border border-surface-500 bg-surface-700 p-3 text-xs text-gray-200 shadow-xl space-y-2"
      style={{ left, top }}
    >
      <div className="font-medium text-gray-100">{t('bindings.chooserTitle')}</div>
      <div className="text-gray-400 truncate" title={itemName}>
        {t('bindings.chooserItem', { item: itemName })}
      </div>
      {loading && (
        <div className="flex items-center gap-1.5 text-gray-400">
          <Loader2 size={12} className="animate-spin" />
          {drop.name || drop.ref}
        </div>
      )}
      {error && <p className="text-red-300 break-words">{t('bindings.resolveFailed', { error })}</p>}
      {obj && auto !== null && mode !== null && (
        <>
          <div className="rounded border border-surface-600 bg-surface-800 px-2 py-1" title={obj.ref}>
            <div className="truncate text-gray-100">{obj.name || obj.ref}</div>
            {(obj.typeName || obj.type) && <div className="truncate text-[11px] text-gray-400">{obj.typeName || obj.type}</div>}
          </div>
          <fieldset className="space-y-0.5">
            <legend className="text-gray-400 mb-0.5">{t('bindings.chooserKind')}</legend>
            <label className={`flex items-center gap-1.5 ${auto.length === 0 ? 'text-gray-500' : ''}`}>
              <input
                type="radio"
                name="bind-kind"
                checked={mode === 'auto'}
                disabled={auto.length === 0}
                onChange={() => setMode('auto')}
              />
              {t('bindings.auto')}
            </label>
            {mode === 'auto' && (
              <ul className="ml-5 space-y-1">
                {auto.map(b => {
                  const old = existing(b.kind)
                  return (
                    <li key={b.kind}>
                      <label className="flex items-start gap-1.5" title={b.ref}>
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={!unticked.has(b.kind)}
                          onChange={e =>
                            setUnticked(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) next.delete(b.kind)
                              else next.add(b.kind)
                              return next
                            })
                          }
                        />
                        <span className="min-w-0">
                          <span className="block text-gray-400">{t(`bindings.kind.${b.kind}` as TranslationKey)}</span>
                          <span className="block truncate text-gray-100">{b.name || b.ref}</span>
                          {b.type && <span className="block truncate text-[11px] text-gray-500">{b.type}</span>}
                          {old && old.ref !== b.ref && (
                            <span className="block text-[11px] text-amber-300 break-words">
                              {t('bindings.replaces', { name: old.name || old.ref })}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
            {auto.length === 0 && (
              <p className="ml-5 text-[11px] text-gray-500 break-words">
                {autoError ? t('bindings.autoFailed', { error: autoError }) : t('bindings.autoNone')}
              </p>
            )}
            {(drop.target.kind === 'barinstrument' ? BAR_KINDS : KINDS).filter(k => !dict || dict.kinds.some(i => i.kind === k)).map(k => (
              <label key={k} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="bind-kind"
                  checked={mode === k}
                  onChange={() => {
                    setMode(k)
                    setOption(optionFor(k, obj, dict))
                  }}
                />
                {t(`bindings.kind.${k}` as TranslationKey)}
                {k === obj.kind && <span className="text-[10px] text-gray-500">{t('bindings.suggested')}</span>}
              </label>
            ))}
          </fieldset>
          {mode !== 'auto' && (
            <>
              <label className="block">
                <span className="block text-gray-400 mb-0.5">{t('bindings.option')}</span>
                <OptionSelect dict={dict} value={option} onChange={setOption} className="w-full" />
              </label>
              {existing(mode) && (
                <p className="text-amber-300 break-words">
                  {t('bindings.replaces', { name: existing(mode)!.name || existing(mode)!.ref })}
                </p>
              )}
            </>
          )}
        </>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="px-2 py-1 text-gray-300 hover:text-white">
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={bind}
          disabled={!ready}
          className="rounded bg-accent px-3 py-1 text-white hover:opacity-90 disabled:opacity-50"
        >
          {t('bindings.bind')}
        </button>
      </div>
    </div>
  )
}
