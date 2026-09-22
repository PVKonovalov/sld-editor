import { Trash2 } from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import * as diagramOps from '../../lib/diagramOps'
import { PanelShell } from './PanelShell'
import { t, type TranslationKey } from '../../i18n'
import { elementDisplayName } from '../../lib/elementCatalogI18n'
import { CONNECTOR_KIND_CODES, LABEL_SHAPE, DIGITAL_DEVICE_SHAPE } from '../../lib/paletteItem'
import type { DiagramElement, ConnectorKind, ConnectorLineStyle, TransformerWinding, WindingScheme, TerminalDirection } from '../../types'

const ORIENTATIONS = [0, 90, 180, -90]

// A connector's own "Type:ID" line (see CONNECTOR_KIND_CODES for the "ID"
// half) — every ConnectorKind, not just the 4 the Elements panel's own
// "Wires" section offers to arm (ElementsPanel.tsx's own WIRE_KIND_LABELS):
// a real diagram can still carry a 'BusbarWire' connector from before that
// kind was removed as a palette choice.
const CONNECTOR_KIND_LABELS: Record<ConnectorKind, TranslationKey> = {
  BusbarWire: 'connectorKind.BusbarWire',
  OverheadLine: 'connectorKind.OverheadLine',
  CableLine: 'connectorKind.CableLine',
  BusWork: 'connectorKind.BusWork',
  LinkToObject: 'connectorKind.LinkToObject',
}

// Matches the "Name:shape" convention DiagramElementProperties' own
// typeLabel uses (e.g. "Power transformer:47") — the same xsde2svg
// ObjectType code convention, generalized to a Connector (its own Kind's
// code, e.g. "Object link:28" — absent for 'BusbarWire', which has none),
// a Label ("Text:5"), or a DigitalDevice ("Digital device:134"), each
// falling back to just the bare name with no ":code" suffix when there's
// no real code to show.
function typeCodeLabel(name: string, code?: string): string {
  return code ? `${name}:${code}` : name
}

// A Cable line connector's own dash-pattern choices, mirroring xsde2svg's
// own line-style switch (xsde2svg/internal/modus/element_23.go) exactly —
// meaningless for every other ConnectorKind, so this dropdown only shows
// when the selected connector's kind is 'CableLine'. An empty value
// (Default) leaves LineStyle unset, which render.go's
// resolveCableLineDash then treats as 'dashed'.
const CABLE_LINE_STYLES: { value: ConnectorLineStyle | ''; labelKey: TranslationKey }[] = [
  { value: '', labelKey: 'properties.lineStyleDefault' },
  { value: 'solid', labelKey: 'properties.lineStyleSolid' },
  { value: 'dashed', labelKey: 'properties.lineStyleDashed' },
  { value: 'dashDot', labelKey: 'properties.lineStyleDashDot' },
  { value: 'dotted', labelKey: 'properties.lineStyleDotted' },
]

// A Line element's (shape 1) own dash choices — reuses ConnectorLineStyle
// like CABLE_LINE_STYLES above, but only the 2 real variants
// element_1.go's own source actually produces (no 'dotted', which has no
// real counterpart for this shape — see slddoc's own ClassLine doc
// comment), and '' means "Solid" directly rather than CABLE_LINE_STYLES'
// own "Default" (which resolves to dashed) — Line's own unset default
// really is solid.
const LINE_STYLES: { value: ConnectorLineStyle | ''; labelKey: TranslationKey }[] = [
  { value: '', labelKey: 'properties.lineStyleSolid' },
  { value: 'dashed', labelKey: 'properties.lineStyleDashed' },
  { value: 'dashDot', labelKey: 'properties.lineStyleDashDot' },
]

// A PowerTransformer's per-winding Scheme/Grounding/Terminal choices —
// mirrors slddoc's own WindingScheme/NeutralGrounding/TerminalDirection
// enums exactly.
const TRANSFORMER_SCHEMES: { value: WindingScheme | ''; labelKey: TranslationKey }[] = [
  { value: '', labelKey: 'properties.transformerSchemeNone' },
  { value: 'wye', labelKey: 'properties.transformerSchemeWye' },
  { value: 'wyeN', labelKey: 'properties.transformerSchemeWyeN' },
  { value: 'delta', labelKey: 'properties.transformerSchemeDelta' },
]
const TRANSFORMER_GROUNDINGS: { value: TransformerWinding['grounding'] | ''; labelKey: TranslationKey }[] = [
  { value: '', labelKey: 'common.none' },
  { value: 'solid', labelKey: 'properties.transformerGroundingSolid' },
  { value: 'isolated', labelKey: 'properties.transformerGroundingIsolated' },
  { value: 'resistor', labelKey: 'properties.transformerGroundingResistor' },
]
const TRANSFORMER_TERMINALS: { value: TerminalDirection; labelKey: TranslationKey }[] = [
  { value: 'top', labelKey: 'properties.transformerTerminalTop' },
  { value: 'bottom', labelKey: 'properties.transformerTerminalBottom' },
  { value: 'left', labelKey: 'properties.transformerTerminalLeft' },
  { value: 'right', labelKey: 'properties.transformerTerminalRight' },
]
// A freshly added winding (growing Number of windings) starts as a plain
// wye, the same default placeElement seeds a freshly placed transformer's
// own first two windings with.
const BLANK_WINDING: TransformerWinding = { scheme: 'wye' }

// Classes whose base.xml template reacts to {state:...}/{fill} — every
// switching device with an Open/Close/Intermediate position, and so the
// only ones that get a State dropdown in Properties. Starter (76) also
// reacts to {state:...} for its own moving-part orientation, but — unlike
// every other class here — has no {fill}/data-fill color legend of its
// own (the real source never gave it one); it's included anyway since the
// dropdown itself is just "which of the three template variants to draw".
const SWITCHING_DEVICE_CLASSES = new Set([
  'Breaker',
  'Disconnector',
  'Sectionalizer',
  'LoadBreakSwitch',
  'GroundSwitch',
  'ShortCircuiter',
  'Starter',
])

// Sectionalizer (164) and Short-circuiter (398) only have two real
// positions — the real xsde2svg source never modeled an Intermediate one
// for either device (see base.xml's own comments on shapes 164/398) — so
// their own State dropdown offers only Open/Close, unlike every other
// class in SWITCHING_DEVICE_CLASSES above.
const TWO_STATE_CLASSES = new Set(['Sectionalizer', 'ShortCircuiter'])

// Shapes whose base.xml template also reacts to {positionAttr}/
// {positionOffset} (a withdrawable device's own Service/Normal/Test
// racking position, independent of its own State) — Breaker/Disconnector/
// Fuse each share a Class with a non-withdrawable sibling (41/162, 203),
// so this has to be keyed by Shape, not Class, unlike
// SWITCHING_DEVICE_CLASSES above. Shown alongside State, whose own label
// switches to "Operational Status" for these so it isn't confused with the
// new "Position status" field — Fuse (154) and Chassis (51) have no State
// field at all (SWITCHING_DEVICE_CLASSES doesn't include either), so they
// only ever show Position status, never that relabeling.
const WITHDRAWABLE_SHAPES = new Set(['43', '49', '154', '51'])

// A Lamp reads its own two fixed FillOff/FillOn colors (see
// diagramOps.LAMP_DEFAULTS/render.go's lampColor), not a voltage class
// color or the global state->color legend the switching devices above
// use — so it gets its own small State (lit/unlit)/FillOff/FillOn/Radius
// section instead of the ordinary Voltage class + State fields.
const LAMP_STATE_OFF = 0
const LAMP_STATE_ON = 1

// PackageSubstation's own State (backend/internal/slddoc's own
// Element.State, reused rather than a dedicated field) isn't an
// Open/Close/Intermediate switching-device concept — it's the real
// xsde2svg source's own Tech.Closed, a plain solid-vs-dashed outline
// toggle, so it gets its own small Solid/Dashed dropdown here instead of
// SWITCHING_DEVICE_CLASSES' shared config.stateColors-driven one. 1
// (Solid) matches applyStateLine's own nil-defaults-to-first-option
// convention, so an unset State already reads as Solid without a
// separate default having to be seeded on placement.
const SUBSTATION_STATE_SOLID = 1
const SUBSTATION_STATE_DASHED = 0

// PackageSubstation's own NType (backend/internal/slddoc's own
// Element.NType) selects between its two real appearance variants — see
// that field's own doc comment.
const SUBSTATION_NTYPE_BOX = 0
const SUBSTATION_NTYPE_TRIANGLE = 1

// PowerflowIndicator's own State (backend/internal/slddoc's own
// Element.State, reused rather than a dedicated field) isn't an
// Open/Close/Intermediate switching-device concept either — it's a plain
// two-way arrow direction, so it gets its own small Forward/Backward
// dropdown here instead. 0/unset reads as Forward ("→"), matching
// writePowerflowIndicator's own nil-defaults-to-"→" convention.
const POWERFLOW_DIRECTION_FORWARD = 0
const POWERFLOW_DIRECTION_BACKWARD = 1

// A handful of common web-safe SVG font-family values for a Label's own
// Font dropdown — an empty Label.font (this list's first entry) falls
// back to the original hardcoded Arial (see model.go's own doc comment).
const LABEL_FONTS = ['Arial', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia']

// <input type="color"> only ever shows/produces a #rrggbb value — it can't
// display a non-hex CSS color/keyword directly (e.g. LAMP_DEFAULTS' own
// fillOff: 'none', or a real xsde2svg-exported Label/DigitalDevice's own
// named color like "yellow"/"darkturquoise" — see slddoc's own
// parseLabel/parseDigitalDevice doc comments). resolveCssColor converts any
// value the browser's own CSS color parser accepts (named color, hex,
// rgb(), ...) into its #rrggbb form via a detached <canvas>'s 2D context,
// whose fillStyle getter always normalizes a fully-opaque color to that
// exact form — rather than this maintaining its own list of the 147 CSS
// named colors. A value the browser rejects too (like "none") returns
// null, since canvas silently keeps the previous fillStyle on an invalid
// assignment; INVALID_COLOR_SENTINEL is set first so that "previous value"
// is always distinguishable from a real result.
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
const INVALID_COLOR_SENTINEL = '#010203'
function resolveCssColor(value: string): string | null {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = INVALID_COLOR_SENTINEL
  ctx.fillStyle = value
  const resolved = ctx.fillStyle
  return resolved === INVALID_COLOR_SENTINEL ? null : resolved
}
function swatchColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  if (HEX_COLOR_RE.test(value)) return value
  return resolveCssColor(value) ?? fallback
}

function WindingEditor({
  winding,
  index,
  voltageOptions,
  onChange,
  onVoltageChange,
}: {
  winding: TransformerWinding
  index: number
  voltageOptions: { value: string; label: string }[]
  onChange: (fields: Partial<TransformerWinding>) => void
  // Separate from onChange: a voltageOptions value can be a server preset's
  // raw "preset:<name>" string, not yet a numeric VoltageClass id — turning
  // that into a real id (creating the class on the diagram first, if it's
  // not there yet) needs diagramOps.resolveVoltageSelection, which needs
  // the whole Diagram/config, not just this one winding's own fields — see
  // this same pattern on the plain Element/Connector Voltage class selects.
  onVoltageChange: (rawValue: string) => void
}) {
  return (
    <div className="border border-surface-700 rounded p-2 space-y-2">
      <p className="text-[11px] text-gray-400">{t('properties.transformerWinding', { n: index + 1 })}</p>
      <label className="block text-xs">
        <span className="block text-gray-500 mb-0.5">{t('properties.voltageClass')}</span>
        <select
          className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
          value={winding.voltage ?? ''}
          onChange={e => onVoltageChange(e.target.value)}
        >
          <option value="">{t('common.none')}</option>
          {voltageOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs">
        <span className="block text-gray-500 mb-0.5">{t('properties.transformerScheme')}</span>
        <select
          className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
          value={winding.scheme ?? ''}
          onChange={e => onChange({ scheme: e.target.value === '' ? undefined : (e.target.value as WindingScheme) })}
        >
          {TRANSFORMER_SCHEMES.map(opt => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
      </label>
      {winding.scheme === 'wyeN' && (
        <label className="block text-xs">
          <span className="block text-gray-500 mb-0.5">{t('properties.transformerGrounding')}</span>
          <select
            className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
            value={winding.grounding ?? ''}
            onChange={e =>
              onChange({ grounding: e.target.value === '' ? undefined : (e.target.value as TransformerWinding['grounding']) })
            }
          >
            {TRANSFORMER_GROUNDINGS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-xs">
        <span className="block text-gray-500 mb-0.5">{t('properties.transformerTerminal')}</span>
        <select
          className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
          value={winding.terminal ?? ''}
          onChange={e => onChange({ terminal: e.target.value === '' ? undefined : (e.target.value as TerminalDirection) })}
        >
          <option value="">{t('common.none')}</option>
          {TRANSFORMER_TERMINALS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={winding.tapChanger ?? false} onChange={e => onChange({ tapChanger: e.target.checked || undefined })} />
        {t('properties.transformerTapChanger')}
      </label>
    </div>
  )
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
    selectedDigitalDeviceId,
    updateDiagram,
    deleteSelected,
    setDefaultVoltage,
  } = useDiagramContext()
  const element = diagram?.elements.find(e => e.id === selectedElementId) ?? null
  const connector = diagram?.connectors.find(c => c.id === selectedConnectorId) ?? null
  const label = diagram?.labels.find(l => l.id === selectedLabelId) ?? null
  const digitalDevice = diagram?.digitalDevices.find(dd => dd.id === selectedDigitalDeviceId) ?? null
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
  if (!element && !connector && !label && !digitalDevice && selectedElementIds.size === 0) {
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
          <p className="text-xs text-gray-400">
            {typeCodeLabel(t(CONNECTOR_KIND_LABELS[connector.kind]), CONNECTOR_KIND_CODES[connector.kind])}
          </p>
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
          {connector.kind === 'CableLine' && (
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.lineStyle')}</span>
              <select
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={connector.lineStyle ?? ''}
                onChange={e =>
                  updateDiagram(d => ({
                    ...d,
                    connectors: d.connectors.map(c =>
                      c.id === connector.id
                        ? { ...c, lineStyle: e.target.value === '' ? undefined : (e.target.value as ConnectorLineStyle) }
                        : c,
                    ),
                  }))
                }
              >
                {CABLE_LINE_STYLES.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </label>
          )}
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
          <p className="text-xs text-gray-400">{typeCodeLabel(t('elements.text'), LABEL_SHAPE)}</p>
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

  if (digitalDevice) {
    const patchDigitalDevice = (fields: Partial<typeof digitalDevice>) => {
      updateDiagram(d => diagramOps.updateDigitalDevice(d, digitalDevice.id, fields))
    }
    return (
      <PanelShell title={t('sidebar.properties')} onClose={onClose} side="right">
        <div className="space-y-3">
          <p className="text-xs text-gray-400">{typeCodeLabel(t('elements.digitalDevice'), DIGITAL_DEVICE_SHAPE)}</p>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.digitalDeviceName')}</span>
            <input
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={digitalDevice.name ?? ''}
              onChange={e => patchDigitalDevice({ name: e.target.value || undefined })}
            />
          </label>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.digitalDeviceValue')}</span>
            <input
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={digitalDevice.value}
              onChange={e => patchDigitalDevice({ value: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.digitalDeviceUnit')}</span>
            <input
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={digitalDevice.unit ?? ''}
              onChange={e => patchDigitalDevice({ unit: e.target.value || undefined })}
            />
          </label>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.labelSize')}</span>
            <input
              type="number"
              min={1}
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={digitalDevice.size}
              onChange={e => patchDigitalDevice({ size: Number(e.target.value) })}
            />
          </label>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.labelAnchor')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={digitalDevice.anchor ?? 'start'}
              onChange={e => patchDigitalDevice({ anchor: e.target.value })}
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
              value={digitalDevice.valign ?? 'bottom'}
              onChange={e => patchDigitalDevice({ valign: e.target.value === 'bottom' ? undefined : e.target.value })}
            >
              <option value="top">{t('properties.vAlignTop')}</option>
              <option value="middle">{t('properties.vAlignMiddle')}</option>
              <option value="bottom">{t('properties.vAlignBottom')}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={!!digitalDevice.bold}
              onChange={e => patchDigitalDevice({ bold: e.target.checked })}
            />
            <span className="text-gray-400">{t('properties.labelBold')}</span>
          </label>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.labelColor')}</span>
            <input
              type="color"
              className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
              value={swatchColor(digitalDevice.color, '#ffffff')}
              onChange={e => patchDigitalDevice({ color: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.labelFont')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={digitalDevice.font ?? LABEL_FONTS[0]}
              onChange={e =>
                patchDigitalDevice({ font: e.target.value === LABEL_FONTS[0] ? undefined : e.target.value })
              }
            >
              {LABEL_FONTS.map(f => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-gray-500">{t('common.idLabel', { id: digitalDevice.id })}</p>
          <DeleteButton label={t('properties.deleteDigitalDevice')} onDelete={deleteSelected} />
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
  const typeSymbol = elements.find(s => s.shape === el.shape)
  const typeName = typeSymbol ? elementDisplayName(typeSymbol) : el.class
  // "Name:shape" — the same "Breaker:41" convention render.go's own
  // typeComment annotates the rendered SVG with (see shapeName), shown
  // here for every element, not just the ones whose name happens to
  // already read as distinctive (e.g. "Breaker (withdrawable)") — see
  // typeCodeLabel for the same convention generalized to a Connector/
  // Label/DigitalDevice.
  const typeLabel = typeCodeLabel(typeName, el.shape)
  const isLamp = el.class === 'Lamp'
  const isRectangle = el.class === 'Rectangle'
  const isCircle = el.class === 'Circle'
  const isArrow = el.class === 'Arrow'
  const isButton = el.class === 'Button'
  const isRoad = el.class === 'Road'
  const isPostPole = el.class === 'PostPole'
  const isLine = el.class === 'Line'
  const isPowerflowIndicator = el.class === 'PowerflowIndicator'
  const isTable = el.class === 'Table'
  const isTable2 = el.class === 'Table2'
  const isPackageSubstation = el.class === 'PackageSubstation'
  const isEnclosedSubstation = el.class === 'EnclosedSubstation'
  const isJunctionPoint = el.class === 'JunctionPoint'
  // Neither a Lamp nor a FaultPassageIndicator reads a Voltage class color
  // (see diagramOps.placeElement's own matching exclusion) — both get a
  // fixed color of their own instead. A Rectangle/Circle/Arrow/Button/Road/
  // PostPole/Line/PowerflowIndicator/Table/Table2 isn't part of the
  // electrical network at all (see slddoc's own ClassRectangle/
  // ClassCircle/ClassArrow/ClassButton/ClassRoad/ClassPostPole/ClassLine/
  // ClassPowerflowIndicator/ClassTable/ClassTable2 doc comments) — its own
  // Stroke (plus, for a Rectangle/Circle/Button/PostPole/Table/Table2,
  // Fill, or for a PowerflowIndicator/Table, TextColor) is its equivalent,
  // shown below.
  const hasNoVoltage =
    isLamp ||
    el.class === 'FaultPassageIndicator' ||
    isRectangle ||
    isCircle ||
    isArrow ||
    isButton ||
    isRoad ||
    isPostPole ||
    isLine ||
    isPowerflowIndicator ||
    isTable ||
    isTable2

  function patch(fields: Partial<DiagramElement>) {
    updateDiagram(d => ({
      ...d,
      elements: d.elements.map(e => (e.id === el.id ? { ...e, ...fields } : e)),
    }))
  }

  return (
    <PanelShell title={t('sidebar.properties')} onClose={onClose} side="right">
      <div className="space-y-3">
        <p className="text-xs text-gray-400">{typeLabel}</p>
        <label className="block text-xs">
          <span className="block text-gray-400 mb-1">{t('properties.name')}</span>
          <input
            className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
            value={el.name ?? ''}
            onChange={e => patch({ name: e.target.value })}
          />
        </label>

        {!hasNoVoltage && (
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
              <span className="flex items-center justify-between mb-1">
                <span className="text-gray-400">{t('properties.lampFillOff')}</span>
                {/* Same gap as Rectangle/Circle's own Fill picker: type="color"
                    only ever produces a real #rrggbb value, so once a color's
                    been picked there's no way back to LAMP_DEFAULTS' own
                    "none" through the picker itself. */}
                <button
                  type="button"
                  className="text-[10px] text-gray-400 hover:text-white underline"
                  onClick={() => patch({ fillOff: 'none' })}
                >
                  {t('properties.transparent')}
                </button>
              </span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.fillOff, '#000000')}
                onChange={e => patch({ fillOff: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="flex items-center justify-between mb-1">
                <span className="text-gray-400">{t('properties.lampFillOn')}</span>
                <button
                  type="button"
                  className="text-[10px] text-gray-400 hover:text-white underline"
                  onClick={() => patch({ fillOn: 'none' })}
                >
                  {t('properties.transparent')}
                </button>
              </span>
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

        {isRectangle && (
          <>
            <label className="block text-xs">
              <span className="flex items-center justify-between mb-1">
                <span className="text-gray-400">{t('properties.rectangleFill')}</span>
                {/* type="color" only ever produces a real #rrggbb value, so once
                    a color's been picked there's no way back to the "none"
                    (transparent) default through the picker itself — this
                    button is the only way to clear it again. */}
                <button
                  type="button"
                  className="text-[10px] text-gray-400 hover:text-white underline"
                  onClick={() => patch({ fill: 'none' })}
                >
                  {t('properties.transparent')}
                </button>
              </span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.fill, '#000000')}
                onChange={e => patch({ fill: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.rectangleStroke')}</span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.stroke, '#ffffff')}
                onChange={e => patch({ stroke: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.rectangleStrokeWidth')}</span>
              <input
                type="number"
                min={1}
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.strokeWidth ?? 1}
                onChange={e => patch({ strokeWidth: Number(e.target.value) })}
              />
            </label>
          </>
        )}

        {isCircle && (
          <>
            {/* Reuses Rectangle's own property labels/i18n keys rather than
                duplicating "circleFill" etc. — a Circle's Fill/Stroke/
                StrokeWidth model is identical to Rectangle's, unlike
                Arrow's (no fill, "line" not "border"). */}
            <label className="block text-xs">
              <span className="flex items-center justify-between mb-1">
                <span className="text-gray-400">{t('properties.rectangleFill')}</span>
                <button
                  type="button"
                  className="text-[10px] text-gray-400 hover:text-white underline"
                  onClick={() => patch({ fill: 'none' })}
                >
                  {t('properties.transparent')}
                </button>
              </span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.fill, '#000000')}
                onChange={e => patch({ fill: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.rectangleStroke')}</span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.stroke, '#ffffff')}
                onChange={e => patch({ stroke: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.rectangleStrokeWidth')}</span>
              <input
                type="number"
                min={1}
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.strokeWidth ?? 1}
                onChange={e => patch({ strokeWidth: Number(e.target.value) })}
              />
            </label>
          </>
        )}

        {isButton && (
          <>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.buttonText')}</span>
              <input
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.propertyText ?? ''}
                onChange={e => patch({ propertyText: e.target.value })}
              />
            </label>
            {/* Reuses Rectangle's own Fill/Stroke/StrokeWidth i18n keys and
                transparent-default convention — a Button's own box model
                is identical to Rectangle's (see diagramOps.BUTTON_DEFAULTS). */}
            <label className="block text-xs">
              <span className="flex items-center justify-between mb-1">
                <span className="text-gray-400">{t('properties.rectangleFill')}</span>
                <button
                  type="button"
                  className="text-[10px] text-gray-400 hover:text-white underline"
                  onClick={() => patch({ fill: 'none' })}
                >
                  {t('properties.transparent')}
                </button>
              </span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.fill, '#000000')}
                onChange={e => patch({ fill: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.rectangleStroke')}</span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.stroke, '#ffffff')}
                onChange={e => patch({ stroke: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.rectangleStrokeWidth')}</span>
              <input
                type="number"
                min={1}
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.strokeWidth ?? 1}
                onChange={e => patch({ strokeWidth: Number(e.target.value) })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.buttonTextColor')}</span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.textColor, '#ffffff')}
                onChange={e => patch({ textColor: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!!el.bold} onChange={e => patch({ bold: e.target.checked })} />
              <span className="text-gray-400">{t('properties.labelBold')}</span>
            </label>
          </>
        )}

        {isPackageSubstation && (
          <>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.substationNType')}</span>
              <select
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.nType ?? SUBSTATION_NTYPE_BOX}
                onChange={e => patch({ nType: Number(e.target.value) })}
              >
                <option value={SUBSTATION_NTYPE_BOX}>{t('properties.substationNTypeBox')}</option>
                <option value={SUBSTATION_NTYPE_TRIANGLE}>{t('properties.substationNTypeTriangle')}</option>
              </select>
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.substationState')}</span>
              <select
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.state ?? SUBSTATION_STATE_SOLID}
                onChange={e => patch({ state: Number(e.target.value) })}
              >
                <option value={SUBSTATION_STATE_SOLID}>{t('properties.substationSolid')}</option>
                <option value={SUBSTATION_STATE_DASHED}>{t('properties.substationDashed')}</option>
              </select>
            </label>
            <label className="block text-xs">
              <span className="flex items-center justify-between mb-1">
                <span className="text-gray-400">{t('properties.substationFill')}</span>
                <button
                  type="button"
                  className="text-[10px] text-gray-400 hover:text-white underline"
                  onClick={() => patch({ fill: 'none' })}
                >
                  {t('properties.transparent')}
                </button>
              </span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.fill, '#000000')}
                onChange={e => patch({ fill: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.substationPropertyText')}</span>
              <input
                type="text"
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.propertyText ?? ''}
                onChange={e => patch({ propertyText: e.target.value })}
              />
            </label>
          </>
        )}

        {isEnclosedSubstation && (
          <>
            {/* Reuses PackageSubstation's own State/Fill labels/i18n keys
                (no Appearance dropdown — this shape has no NType, only
                ever the one fixed square-plus-triangle look). */}
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.substationState')}</span>
              <select
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.state ?? SUBSTATION_STATE_SOLID}
                onChange={e => patch({ state: Number(e.target.value) })}
              >
                <option value={SUBSTATION_STATE_SOLID}>{t('properties.substationSolid')}</option>
                <option value={SUBSTATION_STATE_DASHED}>{t('properties.substationDashed')}</option>
              </select>
            </label>
            <label className="block text-xs">
              <span className="flex items-center justify-between mb-1">
                <span className="text-gray-400">{t('properties.substationFill')}</span>
                <button
                  type="button"
                  className="text-[10px] text-gray-400 hover:text-white underline"
                  onClick={() => patch({ fill: 'none' })}
                >
                  {t('properties.transparent')}
                </button>
              </span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.fill, '#000000')}
                onChange={e => patch({ fill: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.substationPropertyText')}</span>
              <input
                type="text"
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.propertyText ?? ''}
                onChange={e => patch({ propertyText: e.target.value })}
              />
            </label>
          </>
        )}

        {isJunctionPoint && (
          <>
            {/* Both unset by default (fill "none", radius 3) — this
                editor's own long-standing look, kept as the fallback so an
                already-placed/-saved junction point's look doesn't change;
                real xsde2svg usually draws a filled dot at a varying
                radius instead, which Extract captures explicitly (see
                Element.Radius/Fill's own doc comments, slddoc/model.go). */}
            <label className="block text-xs">
              <span className="flex items-center justify-between mb-1">
                <span className="text-gray-400">{t('properties.junctionFill')}</span>
                <button
                  type="button"
                  className="text-[10px] text-gray-400 hover:text-white underline"
                  onClick={() => patch({ fill: 'none' })}
                >
                  {t('properties.transparent')}
                </button>
              </span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.fill, '#000000')}
                onChange={e => patch({ fill: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.junctionRadius')}</span>
              <input
                type="number"
                min={1}
                placeholder="3"
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.radius ?? ''}
                onChange={e => patch({ radius: Number(e.target.value) })}
              />
            </label>
          </>
        )}

        {isArrow && (
          <>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.arrowStroke')}</span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.stroke, '#ffffff')}
                onChange={e => patch({ stroke: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.arrowStrokeWidth')}</span>
              <input
                type="number"
                min={1}
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.strokeWidth ?? 1}
                onChange={e => patch({ strokeWidth: Number(e.target.value) })}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={el.doubleHeaded ?? false}
                onChange={e => patch({ doubleHeaded: e.target.checked || undefined })}
              />
              {t('properties.arrowDoubleHeaded')}
            </label>
          </>
        )}

        {isRoad && (
          <>
            {/* Reuses Arrow's own Stroke/StrokeWidth i18n keys — a Road's
                own line-color model is identical to Arrow's (no Fill, an
                open line), just with a much thicker real-world default
                width (diagramOps.ROAD_DEFAULTS) than the number input's
                own min/fallback below assumes for every other class. */}
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.arrowStroke')}</span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.stroke, '#ffffff')}
                onChange={e => patch({ stroke: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.arrowStrokeWidth')}</span>
              <input
                type="number"
                min={1}
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.strokeWidth ?? 8}
                onChange={e => patch({ strokeWidth: Number(e.target.value) })}
              />
            </label>
          </>
        )}

        {isPostPole && (
          <>
            {/* Reuses Rectangle's own Fill/Stroke i18n keys (identical
                free-text-color model) and Lamp's own Radius key (a plain
                "Radius" label, despite its own lamp-specific key name) —
                no StrokeWidth (always 1, see slddoc's own Element.Square
                doc comment) and no Orientation (hidden below, visually
                inert for this shape either way). */}
            <label className="block text-xs">
              <span className="flex items-center justify-between mb-1">
                <span className="text-gray-400">{t('properties.rectangleFill')}</span>
                <button
                  type="button"
                  className="text-[10px] text-gray-400 hover:text-white underline"
                  onClick={() => patch({ fill: 'none' })}
                >
                  {t('properties.transparent')}
                </button>
              </span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.fill, '#000000')}
                onChange={e => patch({ fill: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.rectangleStroke')}</span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.stroke, '#808080')}
                onChange={e => patch({ stroke: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.lampRadius')}</span>
              <input
                type="number"
                min={1}
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.radius ?? 10}
                onChange={e => patch({ radius: Number(e.target.value) })}
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!!el.square} onChange={e => patch({ square: e.target.checked })} />
              <span className="text-gray-400">{t('properties.poleSquare')}</span>
            </label>
          </>
        )}

        {isLine && (
          <>
            {/* Reuses Arrow's own Stroke/StrokeWidth i18n keys — a Line's
                own line-color model is identical to Arrow's/Road's (no
                Fill, an open line) — plus its own LineStyle select (see
                LINE_STYLES). */}
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.arrowStroke')}</span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.stroke, '#000000')}
                onChange={e => patch({ stroke: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.arrowStrokeWidth')}</span>
              <input
                type="number"
                min={1}
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.strokeWidth ?? 1}
                onChange={e => patch({ strokeWidth: Number(e.target.value) })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.lineStyle')}</span>
              <select
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.lineStyle ?? ''}
                onChange={e => patch({ lineStyle: (e.target.value || undefined) as ConnectorLineStyle | undefined })}
              >
                {LINE_STYLES.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {isPowerflowIndicator && (
          <>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.powerflowDirection')}</span>
              <select
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.state ?? POWERFLOW_DIRECTION_FORWARD}
                onChange={e => patch({ state: Number(e.target.value) })}
              >
                <option value={POWERFLOW_DIRECTION_FORWARD}>{t('properties.powerflowForward')}</option>
                <option value={POWERFLOW_DIRECTION_BACKWARD}>{t('properties.powerflowBackward')}</option>
              </select>
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.powerflowColor')}</span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.textColor, '#000000')}
                onChange={e => patch({ textColor: e.target.value })}
              />
            </label>
          </>
        )}

        {isTable && (
          <>
            {/* Reuses Rectangle's own Fill/Stroke i18n keys (identical
                free-text-color model) plus Line's own LineStyle select and
                Button's own Text/Text color fields — a Table (312) is
                structurally Rectangle + optional centered label +
                LineStyle, matching writeTable exactly. */}
            <label className="block text-xs">
              <span className="flex items-center justify-between mb-1">
                <span className="text-gray-400">{t('properties.rectangleFill')}</span>
                <button
                  type="button"
                  className="text-[10px] text-gray-400 hover:text-white underline"
                  onClick={() => patch({ fill: 'none' })}
                >
                  {t('properties.transparent')}
                </button>
              </span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.fill, '#000000')}
                onChange={e => patch({ fill: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.rectangleStroke')}</span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.stroke, '#ffffff')}
                onChange={e => patch({ stroke: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.rectangleStrokeWidth')}</span>
              <input
                type="number"
                min={1}
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.strokeWidth ?? 1}
                onChange={e => patch({ strokeWidth: Number(e.target.value) })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.lineStyle')}</span>
              <select
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.lineStyle ?? ''}
                onChange={e => patch({ lineStyle: (e.target.value || undefined) as ConnectorLineStyle | undefined })}
              >
                {LINE_STYLES.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.buttonText')}</span>
              <input
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.propertyText ?? ''}
                onChange={e => patch({ propertyText: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.buttonTextColor')}</span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.textColor, '#000000')}
                onChange={e => patch({ textColor: e.target.value })}
              />
            </label>
            {/* Table falls into the Points-editor branch below, not the
                generic Orientation/Mirror else-branch every anchor-based
                class gets — but unlike Rectangle/Circle/Arrow/Button/Road/
                Line, its own Orient field is real here (see slddoc's own
                Element.Orient doc comment): it rotates just the label
                around the box's own center, the box itself never rotates.
                Mirror is never shown — writeTable never applies it. */}
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.tableTextRotation')}</span>
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
          </>
        )}

        {isTable2 && (
          <>
            {/* Also reuses Rectangle's own Fill/Stroke i18n keys plus
                Line's own LineStyle select — Table2's own grid-wide
                default cell background/grid line color/dash, matching
                writeTable2. Row/column count and per-row/column size are
                its own new concept (no other shape has a resizable grid);
                per-cell Fill/TextColor overrides aren't exposed here yet
                (still preserved/rendered correctly for anything Extract
                recovers — see TableCell's own doc comment). */}
            <div className="grid grid-cols-2 gap-1">
              <label className="block text-xs">
                <span className="block text-gray-400 mb-1">{t('properties.tableRows')}</span>
                <input
                  type="number"
                  min={1}
                  className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                  value={el.rowHeights?.length ?? 1}
                  onChange={e =>
                    updateDiagram(d => diagramOps.resizeTable2(d, el.id, Number(e.target.value), el.columnWidths?.length ?? 1))
                  }
                />
              </label>
              <label className="block text-xs">
                <span className="block text-gray-400 mb-1">{t('properties.tableColumns')}</span>
                <input
                  type="number"
                  min={1}
                  className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                  value={el.columnWidths?.length ?? 1}
                  onChange={e =>
                    updateDiagram(d => diagramOps.resizeTable2(d, el.id, el.rowHeights?.length ?? 1, Number(e.target.value)))
                  }
                />
              </label>
            </div>
            <label className="block text-xs">
              <span className="flex items-center justify-between mb-1">
                <span className="text-gray-400">{t('properties.rectangleFill')}</span>
                <button
                  type="button"
                  className="text-[10px] text-gray-400 hover:text-white underline"
                  onClick={() => patch({ fill: 'none' })}
                >
                  {t('properties.transparent')}
                </button>
              </span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.fill, '#ffffff')}
                onChange={e => patch({ fill: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.rectangleStroke')}</span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(el.stroke, '#ffffff')}
                onChange={e => patch({ stroke: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.rectangleStrokeWidth')}</span>
              <input
                type="number"
                min={1}
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.strokeWidth ?? 1}
                onChange={e => patch({ strokeWidth: Number(e.target.value) })}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.lineStyle')}</span>
              <select
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.lineStyle ?? ''}
                onChange={e => patch({ lineStyle: (e.target.value || undefined) as ConnectorLineStyle | undefined })}
              >
                {LINE_STYLES.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="block text-xs text-gray-400 mb-1">{t('properties.tableRowHeights')}</span>
              <div className="grid grid-cols-4 gap-1">
                {(el.rowHeights ?? []).map((h, i) => (
                  <input
                    key={i}
                    type="number"
                    min={1}
                    className="w-full bg-surface-800 border border-surface-600 rounded px-1 py-1 text-[11px]"
                    value={h}
                    onChange={e => updateDiagram(d => diagramOps.updateTable2RowHeight(d, el.id, i, Number(e.target.value)))}
                  />
                ))}
              </div>
            </div>
            <div>
              <span className="block text-xs text-gray-400 mb-1">{t('properties.tableColumnWidths')}</span>
              <div className="grid grid-cols-4 gap-1">
                {(el.columnWidths ?? []).map((w, i) => (
                  <input
                    key={i}
                    type="number"
                    min={1}
                    className="w-full bg-surface-800 border border-surface-600 rounded px-1 py-1 text-[11px]"
                    value={w}
                    onChange={e => updateDiagram(d => diagramOps.updateTable2ColumnWidth(d, el.id, i, Number(e.target.value)))}
                  />
                ))}
              </div>
            </div>
            <div>
              <span className="block text-xs text-gray-400 mb-1">{t('properties.tableCells')}</span>
              <div className="space-y-1">
                {Array.from({ length: el.rowHeights?.length ?? 0 }, (_, row) => (
                  <div
                    key={row}
                    className="grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${el.columnWidths?.length ?? 0}, minmax(0,1fr))` }}
                  >
                    {Array.from({ length: el.columnWidths?.length ?? 0 }, (_, col) => {
                      const cell = el.cells?.find(c => c.row === row && c.col === col)
                      return (
                        <input
                          key={col}
                          type="text"
                          className="w-full bg-surface-800 border border-surface-600 rounded px-1 py-0.5 text-[11px]"
                          value={cell?.text ?? ''}
                          onChange={e => updateDiagram(d => diagramOps.updateTable2CellText(d, el.id, row, col, e.target.value))}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {el.class === 'PowerTransformer' && (
          <>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={el.autotransformer ?? false}
                onChange={e => patch({ autotransformer: e.target.checked || undefined })}
              />
              {t('properties.transformerAutotransformer')}
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.transformerWindingCount')}</span>
              <select
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={el.windings?.length ?? 2}
                onChange={e => {
                  const n = Number(e.target.value)
                  const current = el.windings ?? []
                  const windings =
                    n <= current.length ? current.slice(0, n) : [...current, ...Array(n - current.length).fill(BLANK_WINDING)]
                  patch({ windings })
                }}
              >
                {[2, 3, 4].map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {(el.windings ?? []).map((w, i) => (
              <WindingEditor
                key={i}
                winding={w}
                index={i}
                voltageOptions={voltageOptions}
                onChange={fields => {
                  const windings = (el.windings ?? []).map((existing, idx) => (idx === i ? { ...existing, ...fields } : existing))
                  patch({ windings })
                }}
                onVoltageChange={rawValue =>
                  updateDiagram(d => {
                    const { diagram: withClass, voltage } = diagramOps.resolveVoltageSelection(d, config, rawValue)
                    const windings = (el.windings ?? []).map((existing, idx) => (idx === i ? { ...existing, voltage } : existing))
                    return {
                      ...withClass,
                      elements: withClass.elements.map(x => (x.id === el.id ? { ...x, windings } : x)),
                    }
                  })
                }
              />
            ))}
            {/* Checked <=> vectorGroupLabel is non-empty (empty means "off",
                same as render.go treats it) — a bare click needs some
                non-empty value to check itself with before any text is
                typed, so it uses a single space as a "checked but still
                blank" placeholder rather than introducing component-local
                state this panel otherwise never needs (see below, where
                that same placeholder reads back as an empty text field). */}
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={(el.vectorGroupLabel ?? '') !== ''}
                onChange={e => patch({ vectorGroupLabel: e.target.checked ? el.vectorGroupLabel || ' ' : undefined })}
              />
              {t('properties.transformerShowVectorGroup')}
            </label>
            {(el.vectorGroupLabel ?? '') !== '' && (
              <input
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1 text-xs"
                placeholder={t('properties.transformerVectorGroupPlaceholder')}
                value={el.vectorGroupLabel === ' ' ? '' : (el.vectorGroupLabel ?? '')}
                onChange={e => patch({ vectorGroupLabel: e.target.value })}
              />
            )}
          </>
        )}

        {SWITCHING_DEVICE_CLASSES.has(el.class) && (
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">
              {t(WITHDRAWABLE_SHAPES.has(el.shape) ? 'properties.operationalStatus' : 'properties.state')}
            </span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={el.state ?? ''}
              onChange={e => patch({ state: e.target.value === '' ? undefined : Number(e.target.value) })}
            >
              <option value="">{t('common.none')}</option>
              {(config?.stateColors ?? [])
                .filter(sc => !TWO_STATE_CLASSES.has(el.class) || sc.state === 0 || sc.state === 1)
                .map(sc => (
                  <option key={sc.state} value={sc.state}>
                    {sc.label}
                  </option>
                ))}
            </select>
          </label>
        )}

        {WITHDRAWABLE_SHAPES.has(el.shape) && (
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.positionStatus')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={el.position ?? ''}
              onChange={e => patch({ position: e.target.value === '' ? undefined : Number(e.target.value) })}
            >
              <option value="">{t('common.none')}</option>
              {(config?.positionStates ?? []).map(ps => (
                <option key={ps.position} value={ps.position}>
                  {ps.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {el.class === 'FaultPassageIndicator' && (
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.state')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={el.state ?? ''}
              onChange={e => patch({ state: e.target.value === '' ? undefined : Number(e.target.value) })}
            >
              <option value="">{t('common.none')}</option>
              {(config?.fpiStateColors ?? []).map(sc => (
                <option key={sc.state} value={sc.state}>
                  {sc.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {el.class === 'FaultPassageIndicator' && (
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('properties.substationPropertyText')}</span>
            <input
              type="text"
              placeholder={config?.defaultFpiText || 'FPI'}
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={el.propertyText ?? ''}
              onChange={e => patch({ propertyText: e.target.value })}
            />
          </label>
        )}

        {(el.class === 'BusBarSection' || isRectangle || isCircle || isArrow || isButton || isRoad || isLine || isTable) &&
        el.points ? (
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
          // Lamp's own template is a plain circle with no terminals at
          // all — rotating it changes nothing, visually or functionally,
          // so Orientation is skipped for it alone. FaultPassageIndicator
          // looks the same rotated too, but unlike Lamp it does have real
          // terminals (top/bottom) — Orientation is what lets one of those
          // land on a horizontal wire instead of only ever a vertical one,
          // so it still needs the field even though nothing visually
          // changes. PostPole gets the same skip as Lamp — no terminals
          // either, and both its own round and (axis-aligned, 4-fold
          // symmetric) square variants look identical at every orientation
          // this editor supports (see slddoc's own ClassPostPole doc
          // comment) — Mirror is equally inert for the same reason. Table2
          // gets the same skip too — it has no Orient/Mirror concept in
          // the model at all (see slddoc's own ClassTable2 doc comment;
          // unlike Table (312), whose own Orient rotates just its label
          // and is shown in the Points-editor branch above instead).
          !isLamp && !isPostPole && !isTable2 && (
            <>
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
              {/* PowerflowIndicator's own arrow glyph has no Mirror concept
                  in the real source at all (unlike Orientation, which does
                  rotate it) — writePowerflowIndicator never applies it, so
                  the checkbox is skipped here the same reason Orientation
                  itself is skipped for Lamp/PostPole just above. */}
              {!isPowerflowIndicator && (
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={el.mirror ?? false}
                    onChange={e => patch({ mirror: e.target.checked || undefined })}
                  />
                  <span className="text-gray-400">{t('properties.mirror')}</span>
                </label>
              )}
            </>
          )
        )}

        <p className="text-[10px] text-gray-500">{t('common.idLabel', { id: el.id })}</p>
        <p className="text-[10px] text-gray-500">{t('properties.connectHint')}</p>
        <DeleteButton label={t('properties.deleteElement')} onDelete={deleteSelected} />
      </div>
    </PanelShell>
  )
}
