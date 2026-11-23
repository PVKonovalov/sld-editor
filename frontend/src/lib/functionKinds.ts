import type { TranslationKey } from '../i18n'
import type { FunctionKind } from '../types'

// Config designations.units key of each unit kind.
export const UNIT_CONFIG_KEY: Record<Exclude<FunctionKind, 'voltageLevel'>, string> = {
  incomingFeeder: 'incoming_feeder',
  outgoingFeeder: 'outgoing_feeder',
  generator: 'generator',
  transformer: 'transformer',
  busCoupler: 'bus_coupler',
  busbar: 'busbar',
  measuring: 'measuring',
  other: 'other',
}

export const FUNCTION_KIND_LABEL: Record<FunctionKind, TranslationKey> = {
  voltageLevel: 'designations.kind.voltageLevel',
  incomingFeeder: 'designations.kind.incomingFeeder',
  outgoingFeeder: 'designations.kind.outgoingFeeder',
  generator: 'designations.kind.generator',
  transformer: 'designations.kind.transformer',
  busCoupler: 'designations.kind.busCoupler',
  busbar: 'designations.kind.busbar',
  measuring: 'designations.kind.measuring',
  other: 'designations.kind.other',
}
