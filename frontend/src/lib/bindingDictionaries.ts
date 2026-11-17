import { useEffect, useState } from 'react'
import { getBindingDictionaries, OBJECT_DRAG_TYPE } from './api'
import type { BindingDictionaries, BindingKind, BindingResolved, DraggedObject } from '../types'

let cached: Promise<BindingDictionaries> | null = null

/** The provider's dictionaries, read once per page load (again after a failure). */
export function loadBindingDictionaries(): Promise<BindingDictionaries> {
  if (!cached) {
    cached = getBindingDictionaries(false).catch(e => {
      cached = null
      throw e
    })
  }
  return cached
}

/** The dictionaries once loaded (null before), with the load error if any; nothing is loaded while enabled is false. */
export function useBindingDictionaries(enabled: boolean): { dict: BindingDictionaries | null; error: string | null } {
  const [dict, setDict] = useState<BindingDictionaries | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    loadBindingDictionaries().then(
      d => live && setDict(d),
      e => live && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [enabled])
  return { dict, error }
}

const MEASUREMENT = new Set<BindingKind>(['meas1', 'meas2'])

/** The option an object gets when bound as kind: the provider's suggestion when kind is the suggested one (or both
 * are measurements), else kind's default from the dictionaries. */
export function optionFor(kind: BindingKind, obj: BindingResolved, dict: BindingDictionaries | null): string | undefined {
  if (kind === obj.kind || (MEASUREMENT.has(kind) && MEASUREMENT.has(obj.kind))) return obj.option
  return dict?.kinds.find(k => k.kind === kind)?.defaultOption
}

/** The payload of an Objects-panel drag, or null when the drag carries none. Readable only in a drop handler. */
export function draggedObject(dt: DataTransfer): DraggedObject | null {
  const raw = dt.getData(OBJECT_DRAG_TYPE)
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as DraggedObject
    return typeof obj.ref === 'string' && typeof obj.source === 'string' ? obj : null
  } catch {
    return null
  }
}

/** Whether a drag (over or drop) carries an Objects-panel object. */
export function isObjectDrag(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes(OBJECT_DRAG_TYPE)
}
