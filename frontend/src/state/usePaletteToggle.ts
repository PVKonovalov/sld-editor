import { useCallback } from 'react'
import { useDiagramContext } from './useDiagramContext'
import { classifyPaletteItem } from '../lib/paletteItem'
import type { PaletteItem } from '../types'

/** Arms palette item (a config.palette code), or disarms it when it's the
 * one already armed: exactly what clicking its Elements panel button does.
 * Shared by that button and the placement hot keys (config hotKeys,
 * handled in Canvas). An element shape the loaded libraries don't have is
 * ignored. */
export function usePaletteToggle(): (item: PaletteItem) => void {
  const {
    elements,
    armedSymbol,
    armSymbol,
    armedWireKind,
    armWireKind,
    armedLabel,
    armLabel,
    armedDigitalDevice,
    armDigitalDevice,
  } = useDiagramContext()
  return useCallback(
    (item: PaletteItem) => {
      const c = classifyPaletteItem(item)
      if (c.kind === 'wireKind') {
        armWireKind(armedWireKind === c.value ? null : c.value)
      } else if (c.kind === 'special') {
        if (c.value === 'label') armLabel(!armedLabel)
        else armDigitalDevice(!armedDigitalDevice)
      } else {
        const el = elements.find(s => s.shape === c.shape)
        if (el) armSymbol(armedSymbol?.shape === el.shape ? null : el)
      }
    },
    [elements, armedSymbol, armSymbol, armedWireKind, armWireKind, armedLabel, armLabel, armedDigitalDevice, armDigitalDevice],
  )
}

/** config.hotKeys turned around: palette item code → its hot key. */
export function hotKeyByItem(hotKeys: Record<string, string> | undefined): Map<string, string> {
  const m = new Map<string, string>()
  for (const [key, item] of Object.entries(hotKeys ?? {})) m.set(item, key)
  return m
}
