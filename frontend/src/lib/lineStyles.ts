import type { LineHaloConfig } from '../types'

// Default halo colour per configured halo style (backend config line_halos).
export function haloDefaults(halos: LineHaloConfig[] | undefined): Map<string, string> {
  return new Map((halos ?? []).map(h => [h.style, h.color]))
}

// Splits a Line's styles ("a,b") into names.
export function lineStyleNames(styles: string | undefined): string[] {
  return (styles ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

// Parses haloColors ("name:color,…") into a map.
export function parseHaloColors(haloColors: string | undefined): Map<string, string> {
  const map = new Map<string, string>()
  for (const pair of (haloColors ?? '').split(',')) {
    const i = pair.indexOf(':')
    if (i <= 0) continue
    const name = pair.slice(0, i).trim()
    const color = pair.slice(i + 1).trim()
    if (name && color) map.set(name, color)
  }
  return map
}

// Returns haloColors with name's colour set; undefined, or the default colour, removes the override. Undefined when
// nothing is overridden.
export function withHaloColor(
  haloColors: string | undefined,
  name: string,
  color: string | undefined,
  defaultColor: string | undefined,
): string | undefined {
  const map = parseHaloColors(haloColors)
  if (!color || color.toLowerCase() === defaultColor?.toLowerCase()) map.delete(name)
  else map.set(name, color)
  const out = [...map].map(([k, v]) => `${k}:${v}`).join(',')
  return out || undefined
}

// Returns styles with name added (at the end) or removed; undefined when none is left.
export function withLineStyle(styles: string | undefined, name: string, on: boolean): string | undefined {
  const names = lineStyleNames(styles).filter(n => n !== name)
  if (on) names.push(name)
  return names.length ? names.join(',') : undefined
}
