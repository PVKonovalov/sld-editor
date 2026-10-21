import { useDiagramContext } from '../../state/useDiagramContext'
import { elementDisplayName } from '../../lib/elementCatalogI18n'
import { t, type TranslationKey } from '../../i18n'
import type { CIMWarning } from '../../types'

// The last CIM export's notes, under the Export buttons: each names the item
// (a link that highlights it on the canvas) and what was filled in or left out.

function fieldLabel(field: string): string {
  const [winding, name] = field.includes(':') ? field.split(':') : ['', field]
  const label = name === 'connectionKind' ? t('properties.transformerScheme') : t(`electrical.${name}` as TranslationKey)
  return winding ? `${t('properties.transformerWinding', { n: Number(winding) })}: ${label}` : label
}

export function CimWarnings({ warnings }: { warnings: CIMWarning[] }) {
  const { diagram, elements, highlighted, highlightItem } = useDiagramContext()
  if (!diagram) return null

  function itemName(w: CIMWarning): string {
    if (w.item === 'voltageClass') return diagram!.voltageClasses.find(v => v.id === w.id)?.name ?? `#${w.id}`
    if (w.item === 'connector') {
      const c = diagram!.connectors.find(x => x.id === w.id)
      return c?.name || `${c ? t(`connectorKind.${c.kind}` as TranslationKey) : ''} #${w.id}`
    }
    const el = diagram!.elements.find(x => x.id === w.id)
    if (el?.name) return el.name
    const symbol = el && elements.find(s => s.shape === el.shape)
    return `${symbol ? elementDisplayName(symbol) : (el?.class ?? '')} #${w.id}`
  }

  if (warnings.length === 0) return <p className="text-[11px] text-emerald-400 mt-1">{t('cim.done')}</p>
  return (
    <div className="mt-1">
      <p className="text-[11px] text-amber-300">{t('cim.notes', { count: warnings.length })}</p>
      <ul className="mt-1 max-h-48 overflow-y-auto space-y-1 text-[11px]">
        {warnings.map((w, i) => {
          const name = itemName(w)
          const lit = highlighted?.id === w.id && highlighted.kind === w.item
          return (
            <li key={i}>
              {w.item === 'voltageClass' ? (
                <span className="text-gray-200">{name}</span>
              ) : (
                <button
                  type="button"
                  aria-pressed={lit}
                  className={`text-left hover:underline ${lit ? 'text-amber-300' : 'text-sky-300'}`}
                  onClick={() => highlightItem(w.id, w.item as 'element' | 'connector')}
                >
                  {name}
                </button>
              )}
              <span className="text-gray-400">
                {' — '}
                {t(`cim.${w.kind}` as TranslationKey, { fields: (w.fields ?? []).map(fieldLabel).join(', ') })}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
