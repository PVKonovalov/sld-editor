import { Trash2 } from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import * as diagramOps from '../../lib/diagramOps'
import { PanelShell } from './PanelShell'
import { t } from '../../i18n'
import type { DiagramElement } from '../../types'

const ORIENTATIONS = [0, 90, 180, -90]

// Classes whose base.xml template reacts to {state:...}/{fill} — every
// switching device with an Open/Close/Intermediate position, and so the
// only ones that get a State dropdown in Properties.
const SWITCHING_DEVICE_CLASSES = new Set(['Breaker', 'Disconnector', 'LoadBreakSwitch', 'GroundSwitch'])

function DeleteButton({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    <button
      type="button"
      onClick={onDelete}
      className="w-full flex items-center justify-center gap-1.5 px-2 py-1 text-xs rounded border border-red-900 bg-red-950/50 text-red-300 hover:bg-red-950"
    >
      <Trash2 size={13} />
      {label}
    </button>
  )
}

export function PropertiesPanel({ onClose }: { onClose: () => void }) {
  const {
    diagram,
    config,
    selectedElementId,
    selectedElementIds,
    selectedConnectorId,
    updateDiagram,
    deleteSelected,
    setDefaultVoltage,
  } = useDiagramContext()
  const element = diagram?.elements.find(e => e.id === selectedElementId) ?? null
  const connector = diagram?.connectors.find(c => c.id === selectedConnectorId) ?? null
  const voltageOptions = diagram ? diagramOps.voltageClassOptions(diagram, config) : []

  if (!diagram || (!element && !connector && selectedElementIds.size === 0)) {
    return (
      <PanelShell title={t('sidebar.properties')} onClose={onClose} side="right">
        <p className="text-xs text-gray-500">{t('properties.noSelection')}</p>
      </PanelShell>
    )
  }

  // A multi-selection (shift-click) has no single element's fields to show
  // — just its size and a bulk delete acting on the whole set (see
  // DiagramContext's deleteSelected).
  if (selectedElementIds.size > 1) {
    return (
      <PanelShell title={t('sidebar.properties')} onClose={onClose} side="right">
        <div className="space-y-3">
          <p className="text-xs text-gray-400">{t('properties.multiSelection', { count: selectedElementIds.size })}</p>
          <DeleteButton label={t('properties.deleteElements')} onDelete={deleteSelected} />
        </div>
      </PanelShell>
    )
  }

  if (connector) {
    return (
      <PanelShell title={t('sidebar.properties')} onClose={onClose} side="right">
        <div className="space-y-3">
          <p className="text-xs text-gray-400">{t('properties.connectorKind', { kind: connector.kind })}</p>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.voltageClass')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={connector.voltage ?? ''}
              onChange={e =>
                updateDiagram(d => {
                  const { diagram: withClass, voltage } = diagramOps.resolveVoltageSelection(
                    d,
                    config,
                    e.target.value,
                  )
                  return {
                    ...withClass,
                    connectors: withClass.connectors.map(c => (c.id === connector.id ? { ...c, voltage } : c)),
                  }
                })
              }
            >
              <option value="">{t('common.none')}</option>
              {voltageOptions.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-gray-500">{t('common.idLabel', { id: connector.id })}</p>
          <DeleteButton label={t('properties.deleteConnector')} onDelete={deleteSelected} />
        </div>
      </PanelShell>
    )
  }

  const el = element!

  function patch(fields: Partial<DiagramElement>) {
    updateDiagram(d => ({
      ...d,
      elements: d.elements.map(e => (e.id === el.id ? { ...e, ...fields } : e)),
    }))
  }

  return (
    <PanelShell title={t('sidebar.properties')} onClose={onClose} side="right">
      <div className="space-y-3">
        <label className="block text-xs">
          <span className="block text-gray-400 mb-1">{t('properties.name')}</span>
          <input
            className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
            value={el.name ?? ''}
            onChange={e => patch({ name: e.target.value })}
          />
        </label>

        <label className="block text-xs">
          <span className="block text-gray-400 mb-1">{t('properties.voltageClass')}</span>
          <select
            className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
            value={el.voltage ?? ''}
            onChange={e =>
              updateDiagram(d => {
                const { diagram: withClass, voltage } = diagramOps.resolveVoltageSelection(d, config, e.target.value)
                setDefaultVoltage(voltage)
                return {
                  ...withClass,
                  elements: withClass.elements.map(x => (x.id === el.id ? { ...x, voltage } : x)),
                }
              })
            }
          >
            <option value="">{t('common.none')}</option>
            {voltageOptions.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {SWITCHING_DEVICE_CLASSES.has(el.class) && (
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.state')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={el.state ?? ''}
              onChange={e => patch({ state: e.target.value === '' ? undefined : Number(e.target.value) })}
            >
              <option value="">{t('common.none')}</option>
              {(config?.stateColors ?? []).map(sc => (
                <option key={sc.state} value={sc.state}>
                  {sc.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {el.class === 'BusBarSection' && el.points ? (
          <div>
            <span className="block text-xs text-gray-400 mb-1">{t('properties.points')}</span>
            <div className="space-y-2">
              {el.points.map((p, i) => (
                <div key={i} className="grid grid-cols-2 gap-1">
                  <label className="block text-xs">
                    <span className="block text-gray-500 mb-0.5">{t('properties.pointX', { n: i + 1 })}</span>
                    <input
                      type="number"
                      className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                      value={p.x}
                      onChange={e =>
                        updateDiagram(d =>
                          diagramOps.updateBusbarPoint(d, el.id, i, { ...p, x: Number(e.target.value) }),
                        )
                      }
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="block text-gray-500 mb-0.5">{t('properties.pointY', { n: i + 1 })}</span>
                    <input
                      type="number"
                      className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                      value={p.y}
                      onChange={e =>
                        updateDiagram(d =>
                          diagramOps.updateBusbarPoint(d, el.id, i, { ...p, y: Number(e.target.value) }),
                        )
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.orientation')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={el.orient ?? 0}
              onChange={e => patch({ orient: Number(e.target.value) })}
            >
              {ORIENTATIONS.map(o => (
                <option key={o} value={o}>
                  {o}°
                </option>
              ))}
            </select>
          </label>
        )}

        <p className="text-[10px] text-gray-500">{t('common.idLabel', { id: el.id })}</p>
        <p className="text-[10px] text-gray-500">{t('properties.connectHint')}</p>
        <DeleteButton label={t('properties.deleteElement')} onDelete={deleteSelected} />
      </div>
    </PanelShell>
  )
}
