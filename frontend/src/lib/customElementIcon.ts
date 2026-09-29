import type { CustomElement, Point } from '../types'

// How far a symbol's own drawing reaches beyond its anchor, for sizing the
// icon's viewBox — a symbol has no measured extent on the frontend, and
// most base.xml shapes fit within about this radius.
const SYMBOL_EXTENT = 12
const PADDING = 2

/** Turns a custom element's own Static rendering into markup for a small
 * palette icon: the whole-page <svg> is cropped (viewBox) to the
 * template's actual contents and its page background is dropped, so the
 * button's own background shows through. Returns '' when the markup can't
 * be parsed. */
export function customElementIconMarkup(custom: CustomElement, size: number): string {
  const doc = new DOMParser().parseFromString(custom.svg, 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName !== 'svg') return ''

  const d = custom.diagram
  const points: Point[] = [
    ...d.elements.flatMap(e => [
      { x: e.x - SYMBOL_EXTENT, y: e.y - SYMBOL_EXTENT },
      { x: e.x + SYMBOL_EXTENT, y: e.y + SYMBOL_EXTENT },
      ...(e.points ?? []),
    ]),
    ...d.connectors.flatMap(c => c.points),
    ...d.labels.map(l => ({ x: l.x, y: l.y })),
    ...d.digitalDevices.map(dd => ({ x: dd.x, y: dd.y })),
  ]
  if (points.length > 0) {
    const xs = points.map(p => p.x)
    const ys = points.map(p => p.y)
    const minX = Math.min(...xs) - PADDING
    const minY = Math.min(...ys) - PADDING
    const w = Math.max(...xs) + PADDING - minX
    const h = Math.max(...ys) + PADDING - minY
    root.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`)
  }
  root.setAttribute('width', String(size))
  root.setAttribute('height', String(size))
  root.setAttribute('class', 'shrink-0')
  root.setAttribute('style', 'stroke-width: 0px;')
  return new XMLSerializer().serializeToString(root)
}
