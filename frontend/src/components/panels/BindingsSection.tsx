import { useState } from 'react'
import { Lock } from 'lucide-react'
import { GroupHeader } from './GroupHeader'
import { t, type TranslationKey } from '../../i18n'
import type { Binding, BindingKind, SchemeRef } from '../../types'

const KINDS: BindingKind[] = ['equipment', 'meas1', 'meas2', 'jump']

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

/** One binding (or "—" for none) under its title: name (else ref) with the source tag, then type, option, scale.
 * A binding of a provider other than the active one gets a lock: it is kept but can't be edited or exported. */
export function BindingRow({ title, binding, provider }: { title: string; binding?: Binding; provider: string }) {
  const foreign = binding !== undefined && binding.source !== provider
  return (
    <div className="text-xs">
      <span className="block text-gray-400 mb-0.5">{title}</span>
      {binding ? (
        <div className="rounded border border-surface-600 bg-surface-800 px-2 py-1 space-y-0.5">
          <div className="flex items-center gap-1" title={binding.ref}>
            <span className="flex-1 truncate text-gray-200">{binding.name || binding.ref}</span>
            {foreign && (
              <span title={t('bindings.otherSource', { source: binding.source })} className="text-gray-400">
                <Lock size={12} aria-label={t('bindings.otherSource', { source: binding.source })} />
              </span>
            )}
            <SourceTag source={binding.source} />
          </div>
          <Detail label={t('bindings.type')} value={binding.type} />
          <Detail label={t('bindings.option')} value={binding.option} />
          <Detail label={t('bindings.scale')} value={binding.scale || 1} />
        </div>
      ) : (
        <span className="block text-gray-500 px-2">—</span>
      )}
    </div>
  )
}

/** The read-only Bindings group of a selected element or digital device; nothing when bindings are off (provider
 * "") or it has no binding, precision or features. */
export function BindingsSection({
  provider,
  bindings,
  precision,
  features,
}: {
  provider: string
  bindings?: Binding[]
  precision?: number
  features?: string
}) {
  const [collapsed, setCollapsed] = useState(true)
  if (!provider || (!bindings?.length && !precision && !features)) return null
  return (
    <div>
      <GroupHeader
        label={t('bindings.title')}
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        topic="properties-bindings"
      />
      {!collapsed && (
        <div className="space-y-2">
          {KINDS.map(kind => (
            <BindingRow
              key={kind}
              title={t(`bindings.kind.${kind}` as TranslationKey)}
              binding={bindings?.find(b => b.kind === kind)}
              provider={provider}
            />
          ))}
          <Detail label={t('bindings.precision')} value={precision || undefined} />
          <Detail label={t('bindings.features')} value={features} />
        </div>
      )}
    </div>
  )
}

/** The diagram's own scheme and bound object, read-only; nothing when bindings are off or it has neither. */
export function DiagramBindingsSection({
  provider,
  scheme,
  object,
}: {
  provider: string
  scheme?: SchemeRef
  object?: Binding
}) {
  const [collapsed, setCollapsed] = useState(true)
  if (!provider || (!scheme && !object)) return null
  return (
    <div>
      <GroupHeader
        label={t('bindings.title')}
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        topic="properties-bindings"
      />
      {!collapsed && (
        <div className="space-y-2">
          <div className="text-xs">
            <span className="block text-gray-400 mb-0.5">{t('bindings.scheme')}</span>
            {scheme ? (
              <div className="flex items-center gap-1 rounded border border-surface-600 bg-surface-800 px-2 py-1">
                <span className="flex-1 truncate font-mono text-gray-200">{scheme.ref}</span>
                {scheme.source !== provider && (
                  <span title={t('bindings.otherSource', { source: scheme.source })} className="text-gray-400">
                    <Lock size={12} aria-label={t('bindings.otherSource', { source: scheme.source })} />
                  </span>
                )}
                <SourceTag source={scheme.source} />
              </div>
            ) : (
              <span className="block text-gray-500 px-2">—</span>
            )}
          </div>
          <BindingRow title={t('bindings.object')} binding={object} provider={provider} />
        </div>
      )}
    </div>
  )
}
