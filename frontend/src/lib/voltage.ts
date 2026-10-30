import type { EditorConfig, VoltageOrder } from '../types'

// The same reading as slddoc's ParseVoltage (internal/cim/cim.go): keep the two in step.
const VOLTAGE_RE = /([0-9]+(?:[.,][0-9]+)?)\s*(kv|кв|mv|мв|v|в)?/iu

/** Reads a voltage class name such as "110 kV", "6,3 kV" or "400 V" as kV;
 * the unit may also be in Cyrillic, and a bare number is kV.
 * @param name the voltage class name
 * @returns the voltage in kV, or null for a name that isn't one (e.g. a color) */
export function parseVoltageKV(name: string): number | null {
  if (name.trim().startsWith('#')) return null
  const m = VOLTAGE_RE.exec(name)
  if (!m) return null
  let v = Number(m[1].replace(',', '.'))
  switch (m[2]?.toLowerCase()) {
    case 'mv':
    case 'мв':
      v *= 1000
      break
    case 'v':
    case 'в':
      v /= 1000
      break
  }
  return v > 0 ? v : null
}

/** The configured order of voltage lists (editor.voltage_order). */
export function voltageOrder(config: EditorConfig | null): VoltageOrder {
  return config?.editor.voltageOrder ?? 'ascending'
}

/** Sorts items by the voltage their name reads as (parseVoltageKV); names
 * that aren't a voltage go last, keeping their order.
 * @param items the items to sort (not changed)
 * @param name the voltage class name of an item
 * @param order ascending or descending voltage
 * @returns a sorted copy */
export function sortByVoltage<T>(items: readonly T[], name: (item: T) => string, order: VoltageOrder): T[] {
  const sign = order === 'descending' ? -1 : 1
  return items
    .map((item, i) => ({ item, i, kv: parseVoltageKV(name(item)) }))
    .sort((a, b) => {
      if (a.kv === null || b.kv === null) return a.kv === b.kv ? a.i - b.i : a.kv === null ? 1 : -1
      return a.kv === b.kv ? a.i - b.i : sign * (a.kv - b.kv)
    })
    .map(x => x.item)
}
