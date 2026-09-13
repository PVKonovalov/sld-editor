import type { ElementSymbol } from '../types'

// Mirrors the placeholder substitution backend/internal/slddoc.Render does
// for a real placed element, but with static values that make sense for a
// state-less palette preview instead of a real instance's voltage/state:
// {state:a|b|c} always shows the first (closed/parallel) variant, {color}
// follows the button's own text color so the icon themes automatically,
// {fill} is empty (no state to show), and {radius} is a reasonable
// constant for the two shapes (Lamp, FaultPassageIndicator) that use one.
const STATE_RE = /\{state:([^|}]*)\|([^|}]*)\|([^}]*)\}/g

// BusBarSection (shape 24) has no template — internal/slddoc.Render draws
// its own Points as a polyline instead — so the palette shows a plain
// line as a stand-in for "you drag this one instead of clicking it".
const BUSBAR_ICON = '<line x1="-28" y1="0" x2="28" y2="0" stroke="currentColor" stroke-width="3" />'

/** SVG body suitable for a small <svg viewBox="-32 -32 64 64"> palette icon. */
export function elementIconMarkup(symbol: ElementSymbol): string {
  if (!symbol.template) return BUSBAR_ICON
  return symbol.template
    .replace(STATE_RE, (_match, parallel: string) => parallel)
    .replace(/\{color\}/g, 'currentColor')
    .replace(/\{fill\}/g, 'none')
    .replace(/\{radius\}/g, '8')
}
