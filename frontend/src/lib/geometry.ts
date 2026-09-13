import type { Point } from '../types'

/**
 * Converts a mouse event's client coordinates into diagram (SVG user-unit)
 * coordinates, given the bounding rect of an element sized exactly
 * diagramWidth x diagramHeight in those units. Works regardless of the
 * current pan/zoom transform, since getBoundingClientRect already reflects
 * whatever CSS transform react-zoom-pan-pinch has applied — no need to
 * read its internal scale/position state.
 */
export function clientToDiagramPoint(
  rect: DOMRect,
  diagramWidth: number,
  diagramHeight: number,
  clientX: number,
  clientY: number,
): Point {
  return {
    x: (clientX - rect.left) * (diagramWidth / rect.width),
    y: (clientY - rect.top) * (diagramHeight / rect.height),
  }
}

/** Rounds value to the nearest multiple of spacing, or returns it unchanged
 * when snapping is disabled or spacing isn't positive. */
export function snapValue(value: number, spacing: number, enabled: boolean): number {
  if (!enabled || !spacing) return value
  return Math.round(value / spacing) * spacing
}

/** Nearest point to p on the segment from a to b, clamped to the segment
 * itself (not the infinite line through it). */
export function nearestPointOnSegment(a: Point, b: Point, p: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return a
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

/** Nearest point to p anywhere along a multi-vertex polyline (points.length
 * >= 2), checking every consecutive segment rather than just its
 * endpoints — lets a busbar act as a continuous terminal (any point along
 * its own drawn length), not just at its two drawn endpoints. */
export function nearestPointOnPolyline(points: Point[], p: Point): Point {
  return nearestSegmentOnPolyline(points, p).point
}

/** Like nearestPointOnPolyline, but also reports which segment (the index
 * i of its first endpoint, points[i]..points[i + 1]) the projected point
 * fell on — needed to know where to insert a new vertex when the user
 * double-clicks (or drags a midpoint handle) on a connector's line. */
export function nearestSegmentOnPolyline(points: Point[], p: Point): { index: number; point: Point } {
  let best = points[0]
  let bestIndex = 0
  let bestDist = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const candidate = nearestPointOnSegment(points[i], points[i + 1], p)
    const dist = Math.hypot(candidate.x - p.x, candidate.y - p.y)
    if (dist < bestDist) {
      bestDist = dist
      best = candidate
      bestIndex = i
    }
  }
  return { index: bestIndex, point: best }
}
