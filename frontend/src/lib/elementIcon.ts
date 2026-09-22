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

// Rectangle (shape 3) likewise has no template (see BUSBAR_ICON above) —
// its own icon is a small dashed box, the same "you drag this one"
// visual cue, distinguishing it from a busbar's plain line.
const RECTANGLE_ICON =
  '<rect x="-20" y="-14" width="40" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="5 3" />'

// Arrow (shape 2) likewise has no template (see BUSBAR_ICON above) — a
// diagonal line with an open chevron at the tip, matching writeArrow's own
// real shape (a line plus an unfilled two-stroke chevron, not a filled
// triangle).
const ARROW_ICON =
  '<path d="M -20 16 L 18 -16 M 6 -16 L 18 -16 L 18 -4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />'

// Circle (shape 4) likewise has no template (see BUSBAR_ICON above) — same
// "you drag this one" dashed-outline cue as RECTANGLE_ICON, just an ellipse.
const CIRCLE_ICON =
  '<ellipse cx="0" cy="0" rx="20" ry="14" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="5 3" />'

// PackageSubstation (shape 385) also has no template — its own two real
// appearance variants (see writePackageSubstation) are structurally too
// different from each other for a static template — but unlike
// Rectangle/Arrow/Circle above it's real equipment, not a decorative
// "you drag this" annotation, so this icon is a solid (not dashed)
// preview of its own default (NType 0) box-in-box look, at the shape's
// own real local proportions (outer 36-unit box, inner 18-unit
// rectangle, short lead stub).
const PACKAGE_SUBSTATION_ICON =
  '<rect x="-18" y="-18" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2" />' +
  '<rect x="-9" y="-18" width="18" height="36" fill="none" stroke="currentColor" stroke-width="2" />' +
  '<line x1="0" y1="-18" x2="0" y2="-24" stroke="currentColor" stroke-width="2" />'

// EnclosedSubstation (shape 386) likewise has no template — same
// "real equipment, solid not dashed" reasoning PACKAGE_SUBSTATION_ICON
// above uses — a square outline with the same downward-pointing triangle
// always drawn inside it (see writeEnclosedSubstation), no separate lead
// stub (this shape's own real source draws none).
const ENCLOSED_SUBSTATION_ICON =
  '<rect x="-18" y="-18" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2" />' +
  '<path d="M -18 -18 L 18 -18 L 0 18 Z" fill="none" stroke="currentColor" stroke-width="2" />'
// Button (shape 113) likewise has no template (see BUSBAR_ICON above) — same
// "you drag this one" dashed-outline cue as RECTANGLE_ICON, plus a short
// center line standing in for its own label text, distinguishing it from a
// plain Rectangle.
const BUTTON_ICON =
  '<rect x="-20" y="-14" width="40" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="5 3" />' +
  '<line x1="-11" y1="0" x2="11" y2="0" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />'

// Road (shape 335) likewise has no template (see BUSBAR_ICON above) — a
// solid (not dashed — real corpus never draws one transparent-ish/hollow)
// bent polyline at a thick stroke width, matching a real instance's own
// visual weight (real corpus shows 8-12) and distinguishing it from
// BUSBAR_ICON's own plain thin straight line.
const ROAD_ICON = '<path d="M -22 14 L -6 -8 L 10 -6 L 22 14" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />'

// PostPole (shape 292) also has no template — unlike Rectangle/Circle/
// Road above, it's click-to-place (a single anchor, not two dragged
// points), so its icon is solid, not dashed, the same "real equipment"
// convention PACKAGE_SUBSTATION_ICON/ENCLOSED_SUBSTATION_ICON already use
// — a ring with a filled center dot, standing in for either of the real
// shape's own two variants (round or square) without picking one.
const POLE_ICON =
  '<circle cx="0" cy="0" r="16" fill="none" stroke="currentColor" stroke-width="2" />' +
  '<circle cx="0" cy="0" r="4" fill="currentColor" stroke="none" />'

// Line (shape 1) likewise has no template (see BUSBAR_ICON above) — a
// plain diagonal thin line, matching a real instance's own default weight
// (real corpus mostly shows width 1, unlike Road's own much thicker
// convention) and drawn at an angle (unlike BUSBAR_ICON's own horizontal
// one) since real corpus shows a Line running at an arbitrary angle far
// more often than a busbar's own conventionally-horizontal one.
const LINE_ICON = '<line x1="-22" y1="16" x2="22" y2="-16" stroke="currentColor" stroke-width="2" />'

// PowerflowIndicator (shape 320001) also has no template — same solid,
// click-to-place "real equipment" convention POLE_ICON uses, drawn as the
// same bold arrow glyph writePowerflowIndicator itself draws (always the
// "→" variant here — a static preview has no State to reflect, same
// reasoning elementIcon's own {state:a|b|c} substitution always picks its
// first option).
const POWERFLOW_INDICATOR_ICON =
  '<text x="0" y="9" text-anchor="middle" font-size="28" font-weight="bold" fill="currentColor">→</text>'

// Table (shape 312) also has no template — same "you drag this one"
// dashed-outline cue as RECTANGLE_ICON/BUTTON_ICON, plus a 2x2 cross
// standing in for its own row/column structure, distinguishing it from a
// plain Rectangle or a Button's own single center line.
const TABLE_ICON =
  '<rect x="-20" y="-14" width="40" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="5 3" />' +
  '<line x1="0" y1="-14" x2="0" y2="14" stroke="currentColor" stroke-width="1.5" />' +
  '<line x1="-20" y1="0" x2="20" y2="0" stroke="currentColor" stroke-width="1.5" />'

// Table2 (shape 313) also has no template — same solid, click-to-place
// "real equipment" convention POLE_ICON/POWERFLOW_INDICATOR_ICON use
// (unlike Table above, this one isn't drag-to-draw), drawn as a plain
// solid 2x2 grid — a static preview has no real row/column count to
// reflect, so this is just illustrative, not a literal default-grid
// preview.
const TABLE2_ICON =
  '<rect x="-18" y="-14" width="36" height="28" fill="none" stroke="currentColor" stroke-width="2" />' +
  '<line x1="0" y1="-14" x2="0" y2="14" stroke="currentColor" stroke-width="2" />' +
  '<line x1="-18" y1="0" x2="18" y2="0" stroke="currentColor" stroke-width="2" />'

const EMPTY_TEMPLATE_ICONS: Record<string, string> = {
  '24': BUSBAR_ICON,
  '3': RECTANGLE_ICON,
  '2': ARROW_ICON,
  '4': CIRCLE_ICON,
  '113': BUTTON_ICON,
  '335': ROAD_ICON,
  '292': POLE_ICON,
  '1': LINE_ICON,
  '320001': POWERFLOW_INDICATOR_ICON,
  '312': TABLE_ICON,
  '313': TABLE2_ICON,
  '385': PACKAGE_SUBSTATION_ICON,
  '386': ENCLOSED_SUBSTATION_ICON,
}

// GroundSwitch's own template (base.xml shape 54) is drawn earth-plates-up/
// stub-down in its raw, unrotated form — confirmed byte-for-byte against a
// real xsde2svg corpus export (sld-viewer/assets/sld/*.svg), which always
// places it pre-rotated (orient 90/180, never 0), so that geometry itself
// is correct and left untouched. The palette preview has no orient of its
// own to lean on, though, and shown raw it reads backwards (earth symbol
// where the network connection would be expected, stub where the dead-end
// earth symbol would be) — so just its icon gets a 180° spin here, purely
// cosmetic, independent of whatever orient a placed instance ends up with.
// Short-circuiter (398) has the exact same raw-template layout (earth
// symbol at the top, terminal at the bottom) and the same
// GROUND_TYPE_DEFAULT_ORIENT default placement in diagramOps.ts, so it
// gets the same treatment.
const ICON_ROTATION: Record<string, number> = { '54': 180, '398': 180 }

/** SVG body suitable for a small <svg viewBox="-32 -32 64 64"> palette icon. */
export function elementIconMarkup(symbol: ElementSymbol): string {
  if (!symbol.template) return EMPTY_TEMPLATE_ICONS[symbol.shape] ?? BUSBAR_ICON
  const body = symbol.template
    .replace(STATE_RE, (_match, parallel: string) => parallel)
    .replace(/\{color\}/g, 'currentColor')
    .replace(/\{fill\}/g, 'none')
    .replace(/\{radius\}/g, '8')
  const rotation = ICON_ROTATION[symbol.shape]
  return rotation ? `<g transform="rotate(${rotation})">${body}</g>` : body
}
