import type { ConnectorKind, PaletteItem } from '../types'

// Mirrors backend/internal/elements.Library's own ValidatePalette
// classification exactly, and its own PaletteConnectorKinds/
// PaletteLabelShape/PaletteDigitalDeviceShape constants — a
// PaletteItem is always a bare xsde2svg ObjectType code, the same
// vocabulary for every kind of palette entry, never a name for some kinds
// and a code for others (see PaletteItem's own doc comment in
// types/index.ts). These 4 wire-kind codes are the same ones
// internal/slddoc.Render's own data-type attribute uses for a rendered
// connector (see that package's connectorTypeCode).
const WIRE_KIND_CODES: Record<string, ConnectorKind> = {
  '21': 'BusWork',
  '22': 'OverheadLine',
  '23': 'CableLine',
  '28': 'LinkToObject',
}

// The reverse of WIRE_KIND_CODES above — a ConnectorKind's own xsde2svg
// code, for display (e.g. PropertiesPanel's own "Object link:28" type
// line). 'BusbarWire' is deliberately absent, same as WIRE_KIND_CODES
// itself never maps a code to it — it was removed as a palette choice and
// internal/slddoc.Render's own connectorTypeCode has no entry for it
// either, so a real instance of that legacy kind has no code to show.
export const CONNECTOR_KIND_CODES: Partial<Record<ConnectorKind, string>> = Object.fromEntries(
  Object.entries(WIRE_KIND_CODES).map(([code, kind]) => [kind, code]),
)

export const LABEL_SHAPE = '5'
export const DIGITAL_DEVICE_SHAPE = '134'

export type ClassifiedPaletteItem =
  | { kind: 'wireKind'; value: ConnectorKind }
  | { kind: 'special'; value: 'label' | 'digitalDevice' }
  | { kind: 'element'; shape: string }

export function classifyPaletteItem(item: PaletteItem): ClassifiedPaletteItem {
  const wireKind = WIRE_KIND_CODES[item]
  if (wireKind) return { kind: 'wireKind', value: wireKind }
  if (item === LABEL_SHAPE) return { kind: 'special', value: 'label' }
  if (item === DIGITAL_DEVICE_SHAPE) return { kind: 'special', value: 'digitalDevice' }
  return { kind: 'element', shape: item }
}
