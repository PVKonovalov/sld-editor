import { useDiagramContext } from '../../state/useDiagramContext'
import { elementDisplayName } from '../../lib/elementCatalogI18n'
import { t } from '../../i18n'
import type { DiagramElement } from '../../types'

// The last SVG export's switching devices that weren't Open or Close (see
// abnormalSwitchingDevices), under the Export buttons: each names the device
// (a link that highlights it on the canvas) and the State it was exported in.
export function SwitchStateWarnings({ devices }: { devices: DiagramElement[] }) {
  const { config, elements, highlighted, highlightItem } = useDiagramContext()
  if (devices.length === 0) return null

  function deviceName(el: DiagramElement): string {
    if (el.name) return el.name
    const symbol = elements.find(s => s.shape === el.shape)
    return `${symbol ? elementDisplayName(symbol) : el.class} #${el.id}`
  }

  function stateName(el: DiagramElement): string {
    if (el.state == null) return t('svgExport.noState')
    return config?.stateColors.find(sc => sc.state === el.state)?.label ?? String(el.state)
  }

  return (
    <div className="mt-1">
      <p className="text-[11px] text-amber-300">{t('svgExport.abnormalSwitches', { count: devices.length })}</p>
      <ul className="mt-1 max-h-48 overflow-y-auto space-y-1 text-[11px]">
        {devices.map(el => {
          const lit = highlighted?.id === el.id && highlighted.kind === 'element'
          return (
            <li key={el.id}>
              <button
                type="button"
                aria-pressed={lit}
                className={`text-left hover:underline ${lit ? 'text-amber-300' : 'text-sky-300'}`}
                onClick={() => highlightItem(el.id, 'element')}
              >
                {deviceName(el)}
              </button>
              <span className="text-gray-400">{` — ${stateName(el)}`}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
