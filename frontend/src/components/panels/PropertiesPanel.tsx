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

// A Lamp reads its own two fixed FillOff/FillOn colors (see
// diagramOps.LAMP_DEFAULTS/render.go's lampColor), not a voltage class
// color or the global state->color legend the switching devices above
// use — so it gets its own small State (lit/unlit)/FillOff/FillOn/Radius
// section instead of the ordinary Voltage class + State fields.
const LAMP_STATE_OFF = 0
const LAMP_STATE_ON = 1

// A handful of common web-safe SVG font-family values for a Label's own
// Font dropdown — an empty Label.font (this list's first entry) falls
// back to the original hardcoded Arial (see model.go's own doc comment).
const LABEL_FONTS = ['Arial', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia']

// <input type="color"> only ever shows/produces a #rrggbb value — it can't
// represent a non-hex CSS color/keyword (e.g. LAMP_DEFAULTS' own
// fillOff: 'none'), so an existing FillOff/FillOn that isn't one falls
// back to this swatch purely for display; picking a color always commits
// a real #rrggbb hex regardless; a "none" fillOff already read as fully
// transparent, same as this swatch's own black.
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
function swatchColor(value: string | undefined, fallback: string): string {
  return value && HEX_COLOR_RE.test(value) ? value : fallback
}

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
    diagramName,
    diagram,
    config,
    elements,
    selectedElementId,
    selectedElementIds,
    selectedConnectorId,
    selectedLabelId,
    updateDiagram,
    deleteSelected,
    setDefaultVoltage,
  } = useDiagramContext()
  const element = diagram?.elements.find(e => e.id === selectedElementId) ?? null
  const connector = diagram?.connectors.find(c => c.id === selectedConnectorId) ?? null
  const label = diagram?.labels.find(l => l.id === selectedLabelId) ?? null
  const voltageOptions = diagram ? diagramOps.voltageClassOptions(diagram, config) : []

  if (!diagram) {
    return (
      <PanelShell title={t('sidebar.properties')} onClose={onClose} side="right">
        <p className="text-xs text-gray-500">{t('properties.noSelection')}</p>
      </PanelShell>
    )
  }

  // Nothing on the canvas is selected, but a diagram is open (e.g. it was
  // just picked from the File panel) — show its own width/height instead
  // of just "nothing selected", since those otherwise have no home to be
  // edited from after creation (NewDiagramDialog is the only other place
  // that sets them, and only at creation time).
  if (!element && !connector && !label && selectedElementIds.size === 0) {
    return (
      <PanelShell title={t('sidebar.properties')} onClose={onClose} side="right">
        <div className="space-y-3">
          <p className="text-xs text-gray-400">{t('properties.diagram')}</p>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.fileName')}</span>
            <input
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1 opacity-50"
              value={diagramName ?? ''}
              readOnly
            />
          </label>
          <div className="flex gap-2">
            <label className="block text-xs flex-1">
              <span className="block text-gray-400 mb-1">{t('properties.width')}</span>
              <input
                type="number"
                min={1}
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={diagram.width}
                onChange={e => updateDiagram(d => ({ ...d, width: Number(e.target.value) }))}
              />
            </label>
            <label className="block text-xs flex-1">
              <span className="block text-gray-400 mb-1">{t('properties.height')}</span>
              <input
                type="number"
                min={1}
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={diagram.height}
                onChange={e => updateDiagram(d => ({ ...d, height: Number(e.target.value) }))}
              />
            </label>
          </div>
        </div>
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
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.name')}</span>
            <input
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={connector.name ?? ''}
              onChange={e =>
                updateDiagram(d => ({
                  ...d,
                  connectors: d.connectors.map(c => (c.id === connector.id ? { ...c, name: e.target.value } : c)),
                }))
              }
            />
          </label>
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

  if (label) {
    const patchLabel = (fields: Partial<typeof label>) => {
      updateDiagram(d => diagramOps.updateLabel(d, label.id, fields))
    }
    return (
      <PanelShell title={t('sidebar.properties')} onClose={onClose} side="right">
        <div className="space-y-3">
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.labelText')}</span>
            <textarea
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              rows={3}
              value={label.text}
              onChange={e => patchLabel({ text: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.labelSize')}</span>
            <input
              type="number"
              min={1}
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={label.size}
              onChange={e => patchLabel({ size: Number(e.target.value) })}
            />
          </label>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.labelAnchor')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={label.anchor ?? 'start'}
              onChange={e => patchLabel({ anchor: e.target.value })}
            >
              <option value="start">{t('properties.anchorStart')}</option>
              <option value="middle">{t('properties.anchorMiddle')}</option>
              <option value="end">{t('properties.anchorEnd')}</option>
            </select>
          </label>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.labelVAlign')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={label.valign ?? 'bottom'}
              onChange={e => patchLabel({ valign: e.target.value === 'bottom' ? undefined : e.target.value })}
            >
              <option value="top">{t('properties.vAlignTop')}</option>
              <option value="middle">{t('properties.vAlignMiddle')}</option>
              <option value="bottom">{t('properties.vAlignBottom')}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={!!label.bold} onChange={e => patchLabel({ bold: e.target.checked })} />
            <span className="text-gray-400">{t('properties.labelBold')}</span>
          </label>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.labelColor')}</span>
            <input
              type="color"
              className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
              value={swatchColor(label.color, '#ffffff')}
              onChange={e => patchLabel({ color: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.labelFont')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={label.font ?? LABEL_FONTS[0]}
              onChange={e => patchLabel({ font: e.target.value === LABEL_FONTS[0] ? undefined : e.target.value })}
            >
              {LABEL_FONTS.map(f => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.labelFor')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={label.for ?? ''}
              onChange={e => patchLabel({ for: e.target.value === '' ? undefined : Number(e.target.value) })}
            >
              <option value="">{t('common.none')}</option>
              {diagram.elements.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name ?? e.class}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-gray-500">{t('common.idLabel', { id: label.id })}</p>
          <DeleteButton label={t('properties.deleteLabel')} onDelete={deleteSelected} />
        </div>
      </PanelShell>
    )
  }

  const el = element!
  // The palette catalog's own name for this element's Shape ("Breaker
  // (withdrawable)", not just "Breaker") — the same label its own
  // Elements-panel button shows — rather than el.class, which doesn't
  // distinguish a fixed shape from a withdrawable one sharing the same
  // Class. Falls back to the bare Class for an element loaded from a
  // library that no longer has that Shape (e.g. shapeDisconnectorLegacy's
  // own kind of gap), so this never just renders blank.
  const typeName = elements.find(s => s.shape === el.shape)?.name ?? el.class
  const isLamp = el.class === 'Lamp'

  function patch(fields: Partial<DiagramElement>) {
    updateDiagram(d => ({
      ...d,
      elements: d.elements.map(e => (e.id === el.id ? { ...e, ...fields } : e)),
    }))
  }

  return (
    <PanelShell title={t('sidebar.properties')} onClose={onClose} side="right">
      <div className="space-y-3">
        <p className="text-xs text-gray-400">{typeName}</p>
        <label className="block text-xs">
          <span className="block text-gray-400 mb-1">{t('properties.name')}</span>
          <input
            className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
            value={el.name ?? ''}
            onChange={e => patch({ name: e.target.value })}
          />
        </label>

        {!isLamp && (
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.voltageClass')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={el.voltage ?? ''}
              onChange={e =>
                updateDiagram(d => {
                  const { diagram: withClass, voltage } = diagramOps.resolveVoltageSelection(
                    d,
                    config,
                    e.target.value,
                  )
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
        )}

        {isLamp && (
          <>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.lampState')}</span>
              <select
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.state ?? LAMP_STATE_OFF}
                onChange={e => patch({ state: Number(e.target.value) })}
              >
                <option value={LAMP_STATE_OFF}>{t('properties.lampOff')}</option>
                <option value={LAMP_STATE_ON}>{t('properties.lampOn')}</option>
              </select>
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.lampFillOff')}</span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.fillOff, '#000000')}
                onChange={e => patch({ fillOff: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.lampFillOn')}</span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.fillOn, '#ff0000')}
                onChange={e => patch({ fillOn: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.lampRadius')}</span>
              <input
                type="number"
                min={1}
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.radius ?? ''}
                onChange={e => patch({ radius: Number(e.target.value) })}
              />
            </label>
          </>
        )}

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
          // A Lamp's own template is a plain circle — rotating it changes
          // nothing visually, so Orientation is skipped for it the same
          // way Voltage class is above.
          !isLamp && (
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
          )
        )}

        <p className="text-[10px] text-gray-500">{t('common.idLabel', { id: el.id })}</p>
        <p className="text-[10px] text-gray-500">{t('properties.connectHint')}</p>
        <DeleteButton label={t('properties.deleteElement')} onDelete={deleteSelected} />
      </div>
    </PanelShell>
  )
}
