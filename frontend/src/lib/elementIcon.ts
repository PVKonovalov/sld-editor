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

// GroundSwitch's own template (base.xml shape 54) is drawn earth-plates-up/
// stub-down in its raw, unrotated form — confirmed byte-for-byte against a
// real xsde2svg corpus export (sld-viewer/assets/sld/*.svg), which always
// places it pre-rotated (orient 90/180, never 0), so that geometry itself
// is correct and left untouched. The palette preview has no orient of its
// own to lean on, though, and shown raw it reads backwards (earth symbol
// where the network connection would be expected, stub where the dead-end
// earth symbol would be) — so just its icon gets a 180° spin here, purely
// cosmetic, independent of whatever orient a placed instance ends up with.
const ICON_ROTATION: Record<string, number> = { '54': 180 }

/** SVG body suitable for a small <svg viewBox="-32 -32 64 64"> palette icon. */
export function elementIconMarkup(symbol: ElementSymbol): string {
  if (!symbol.template) return BUSBAR_ICON
  const body = symbol.template
    .replace(STATE_RE, (_match, parallel: string) => parallel)
    .replace(/\{color\}/g, 'currentColor')
    .replace(/\{fill\}/g, 'none')
    .replace(/\{radius\}/g, '8')
  const rotation = ICON_ROTATION[symbol.shape]
  return rotation ? `<g transform="rotate(${rotation})">${body}</g>` : body
}
