import type { Connector, DiagramElement, Electrical } from '../types'

// The nameplate parameters each class carries (slddoc.Electrical), in the
// order the Properties panel lists them. Integer fields take whole numbers.

export type ElectricalField = keyof Electrical
export type WindingField = 'ratedU' | 'ratedS' | 'r' | 'x' | 'g' | 'b' | 'phaseAngleClock'

export const INTEGER_FIELDS = new Set<string>(['maximumSections', 'normalSections', 'phaseAngleClock'])

const LINE: ElectricalField[] = ['length', 'r', 'x', 'bch', 'gch', 'r0', 'x0', 'b0ch', 'g0ch']
const MACHINE: ElectricalField[] = ['ratedS', 'ratedU', 'maxP', 'minP', 'maxQ', 'minQ']
const SHUNT: ElectricalField[] = ['nomU', 'bPerSection', 'gPerSection', 'maximumSections', 'normalSections']
const SWITCH: ElectricalField[] = ['ratedCurrent']

const ELEMENT_FIELDS: Record<string, ElectricalField[]> = {
  Booster: ['ratedS', 'ratedU', 'r', 'x'],
  Reactor: ['r', 'x'],
  ChokeCoil: ['r', 'x'],
  Generator: MACHINE,
  SynchronousCompensator: MACHINE,
  SynchronousMotor: MACHINE,
  Capacitor: SHUNT,
  CapacitorBank: SHUNT,
  ReactorShunt: SHUNT,
  BusBarSection: ['ipMax'],
  Load: ['p', 'q'],
  NetworkInfeed: ['minP', 'maxP', 'minQ', 'maxQ'],
  StaticVarCompensator: ['capacitiveRating', 'inductiveRating', 'slope'],
  ...Object.fromEntries(
    [
      'Breaker',
      'PowerCircuitBreaker',
      'Disconnector',
      'KnifeSwitch',
      'KnifeSwitch3',
      'LoadBreakSwitch',
      'Sectionalizer',
      'GroundSwitch',
      'ShortCircuiter',
      'ShortCircuiterNoGround',
      'Fuse',
      'DisconnectorFuse',
      'Chassis',
      'HalfChassis',
      'Starter',
    ].map(c => [c, SWITCH]),
  ),
}

export const WINDING_FIELDS: WindingField[] = ['ratedU', 'ratedS', 'r', 'x', 'g', 'b', 'phaseAngleClock']

// A chosen CIM class that uses other parameters than its element class's default.
const CIM_FIELDS: Record<string, ElectricalField[]> = {
  AsynchronousMachine: ['ratedS', 'ratedU'],
  PetersenCoil: ['nomU'],
  EnergySource: [],
}

/** The parameters an element carries, by its CIM class choice and then its class; empty when it has none (a
 * PowerTransformer keeps them per winding). */
export function elementElectricalFields(el: DiagramElement): ElectricalField[] {
  return (el.cim ? CIM_FIELDS[el.cim] : undefined) ?? ELEMENT_FIELDS[el.class] ?? []
}

/** The parameters a connector carries: an overhead or cable line's, or a link to object's load when it stands for an
 * EnergyConsumer (its default CIM class). */
export function connectorElectricalFields(c: Connector): ElectricalField[] {
  if (c.kind === 'OverheadLine' || c.kind === 'CableLine') return LINE
  if (c.kind === 'LinkToObject' && (c.cim ?? 'EnergyConsumer') === 'EnergyConsumer') return ['p', 'q']
  return []
}

/**
 * Sets one parameter (undefined clears it) and returns the new Electrical, or undefined when none is left set,
 * so an element without parameters stores no <electrical> at all.
 */
export function withElectricalValue(
  current: Electrical | undefined,
  field: ElectricalField,
  value: number | undefined,
): Electrical | undefined {
  const next: Electrical = { ...current, [field]: value }
  if (value === undefined) delete next[field]
  return Object.keys(next).length > 0 ? next : undefined
}
