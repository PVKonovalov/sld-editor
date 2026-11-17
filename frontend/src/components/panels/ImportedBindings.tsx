import { useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { GroupHeader } from './GroupHeader'
import { t, type TranslationKey } from '../../i18n'
import { BINDING_KINDS } from '../../lib/bindingOverview'
import { componentTypeName, typeOfShape, useBindingDictionaries } from '../../lib/bindingDictionaries'
import { compareItem } from '../../lib/bindingImport'
import { useDiagramContext } from '../../state/useDiagramContext'
import type { Binding } from '../../types'

function bindingLine(b: Binding): string {
  let s = b.name ? `${b.name} (${b.ref})` : b.ref
  if (b.option) s += ` · ${b.option}`
  if (b.scale && b.scale !== 1) s += ` · ×${b.scale}`
  return s
}

/** While an import is open, what the linked scheme holds for item id, read-only, with the values that differ from
 * the item's own in amber. shape is the item's shape (a wire has none). */
export function ImportedBindings({
  id,
  shape,
  bindings,
  precision,
  features,
  componentType,
}: {
  id: number
  shape?: string
  bindings?: Binding[]
  precision?: number
  features?: string
  componentType?: string
}) {
  const { bindingImport, config } = useDiagramContext()
  const provider = config?.bindings?.provider ?? ''
  const [collapsed, setCollapsed] = useState(false)
  const { dict } = useBindingDictionaries(!!bindingImport)
  const component = useMemo(() => bindingImport?.components.find(c => c.item === id), [bindingImport, id])
  if (!bindingImport || !provider) return null
  const own = { bindings: (bindings ?? []).filter(b => b.source === provider), precision, features, componentType }
  const cmp = compareItem(own, shape ?? '', component, k => dict?.kinds.find(i => i.kind === k)?.defaultOption, typeOfShape(dict))
  if (!component && !cmp.status) return null

  const status = cmp.status ?? 'same'
  const tone = (changed: boolean) => (changed ? 'text-amber-200' : 'text-gray-300')
  return (
    <div>
      <GroupHeader
        label={t('bindingImport.properties')}
        collapsed={collapsed}
        onToggle={() => setCollapsed(v => !v)}
        topic="bindings-import"
      />
      {!collapsed && (
        <div className="space-y-1 text-xs">
          <p className="text-gray-400">
            {t('bindingImport.status')}: {t(`bindingImport.statusName.${status}` as TranslationKey)}
          </p>
          {component?.shape && shape && component.shape !== shape && (
            <p className="flex items-center gap-1 text-amber-300">
              <AlertTriangle size={11} />
              {t('bindingImport.shapeDiffers', { shape: component.shape })}
            </p>
          )}
          {!component ? (
            <p className="text-gray-400">{t('bindingImport.noComponent')}</p>
          ) : (
            <>
              {BINDING_KINDS.map(k => {
                const b = component.bindings.find(x => x.kind === k)
                if (!b && !cmp.kinds.includes(k)) return null
                return (
                  <div key={k} className={tone(cmp.kinds.includes(k))}>
                    <span className="text-gray-500">{t(`bindings.kind.${k}` as TranslationKey)}: </span>
                    <span className="break-words">{b ? bindingLine(b) : '—'}</span>
                  </div>
                )
              })}
              <div className={tone(cmp.display)}>
                <span className="text-gray-500">{t('bindingImport.display')}: </span>
                {component.type ? `${componentTypeName(dict, component.type)} · ` : ''}
                {component.precision ?? 0} · {component.features || '—'}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
