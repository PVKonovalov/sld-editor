import * as diagramOps from './diagramOps'
import type { DiagramElement, ElementSymbol } from '../types'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** An element's drawn footprint in diagram coordinates, read from the
 * canvas's rendered markup like Canvas's own elementBoxes: a symbol placed
 * by translate(x,y) rotate(…) is measured in its local frame (getBBox) and
 * mapped through diagramOps.placeLocalPoint (with its size step); markup
 * drawn in absolute coordinates is taken as is. A Points-based shape uses
 * its own points. Falls back to the anchor alone when nothing is rendered. */
export function elementDiagramBox(el: DiagramElement, symbols: ElementSymbol[]): Box {
  if (el.points && el.points.length > 0) {
    const xs = el.points.map(p => p.x)
    const ys = el.points.map(p => p.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  }
  const node = document.querySelector(
    `.sld-rendered [data-editor-kind="element"][id="${el.id}"]`,
  ) as SVGGraphicsElement | null
  let local: DOMRect | null = null
  try {
    local = node?.getBBox() ?? null
  } catch {
    local = null
  }
  if (!node || !local) return { x: el.x, y: el.y, width: 0, height: 0 }
  if (!(node.getAttribute('transform') ?? '').trim().startsWith('translate(')) {
    return { x: local.x, y: local.y, width: local.width, height: local.height }
  }
  const f = diagramOps.elementSizeFactor(el, symbols)
  const corners = [
    { x: local.x, y: local.y },
    { x: local.x + local.width, y: local.y },
    { x: local.x, y: local.y + local.height },
    { x: local.x + local.width, y: local.y + local.height },
  ].map(p => diagramOps.placeLocalPoint(el, { x: p.x * f, y: p.y * f }))
  const xs = corners.map(p => p.x)
  const ys = corners.map(p => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
