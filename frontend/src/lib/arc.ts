import type { Point } from '../types'

// An Arc's (shape 9) own SVG elliptical-arc parameters, the same fields
// DiagramElement carries (see slddoc's own ClassArc doc comment): start/end
// are its Points, the rest are stored exactly as the arc command writes them.
export interface ArcParams {
  start: Point
  end: Point
  rx: number
  ry: number
  largeArc: boolean
  sweep: boolean
}

// The fixed x-axis rotation (degrees) every arc command is written with —
// matches slddoc's own arcRotation (the real source always passes 1).
export const ARC_ROTATION = 1

/** The same path data slddoc's own writeArc emits, for Canvas's own live
 * previews/highlights/in-DOM drag. */
export function arcPathD(a: ArcParams): string {
  return `M${a.start.x},${a.start.y} A${a.rx},${a.ry} ${ARC_ROTATION} ${a.largeArc ? 1 : 0} ${a.sweep ? 1 : 0} ${a.end.x},${a.end.y}`
}

/** The point at parameter t (0 = start, 1 = end) along the arc as a
 * browser draws it — SVG's own endpoint-to-center conversion (SVG 1.1
 * F.6.5), including its radius scale-up when the stored radii are too
 * small to span start..end. Falls back to the chord for a degenerate arc
 * (zero radius or coincident endpoints), same as a browser draws it. */
export function arcPointAt(a: ArcParams, t: number): Point {
  const { start: p1, end: p2 } = a
  let rx = Math.abs(a.rx)
  let ry = Math.abs(a.ry)
  if (rx === 0 || ry === 0 || (p1.x === p2.x && p1.y === p2.y)) {
    return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t }
  }
  const phi = (ARC_ROTATION * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (p1.x - p2.x) / 2
  const dy = (p1.y - p2.y) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const coef = (a.largeArc !== a.sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den))
  const cxp = (coef * rx * y1) / ry
  const cyp = (-coef * ry * x1) / rx
  const cx = cos * cxp - sin * cyp + (p1.x + p2.x) / 2
  const cy = sin * cxp + cos * cyp + (p1.y + p2.y) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const ux = (x1 - cxp) / rx
  const uy = (y1 - cyp) / ry
  const theta1 = angle(1, 0, ux, uy)
  let dTheta = angle(ux, uy, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
  if (!a.sweep && dTheta > 0) dTheta -= 2 * Math.PI
  if (a.sweep && dTheta < 0) dTheta += 2 * Math.PI
  const theta = theta1 + dTheta * t
  return {
    x: cx + rx * cos * Math.cos(theta) - ry * sin * Math.sin(theta),
    y: cy + rx * sin * Math.cos(theta) + ry * cos * Math.sin(theta),
  }
}

/** The arc's own midpoint — where Canvas draws its bulge handle. */
export function arcMidpoint(a: ArcParams): Point {
  return arcPointAt(a, 0.5)
}

/** The arc's own bounding box, sampled along the curve — Canvas's click-
 * tolerance box for it. */
export function arcBounds(a: ArcParams): { x: number; y: number; width: number; height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i <= 32; i++) {
    const p = arcPointAt(a, i / 32)
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** The circular arc from start through bulge to end: its radius plus the
 * large-arc/sweep flags that make a browser draw exactly that side. Null
 * when the three points are (nearly) collinear, i.e. no circle passes
 * through them. Angles are measured in SVG's own y-down frame, where
 * increasing angle is sweep=1's own "positive" direction. */
export function circularArcThrough(
  start: Point,
  end: Point,
  bulge: Point,
): { rx: number; ry: number; largeArc: boolean; sweep: boolean } | null {
  const ax = start.x
  const ay = start.y
  const bx = bulge.x
  const by = bulge.y
  const cx0 = end.x
  const cy0 = end.y
  const d = 2 * (ax * (by - cy0) + bx * (cy0 - ay) + cx0 * (ay - by))
  const chord = Math.hypot(end.x - start.x, end.y - start.y)
  if (chord === 0 || Math.abs(d) < 1e-9 * Math.max(1, chord * chord)) return null
  const a2 = ax * ax + ay * ay
  const b2 = bx * bx + by * by
  const c2 = cx0 * cx0 + cy0 * cy0
  const ux = (a2 * (by - cy0) + b2 * (cy0 - ay) + c2 * (ay - by)) / d
  const uy = (a2 * (cx0 - bx) + b2 * (ax - cx0) + c2 * (bx - ax)) / d
  const r = Math.hypot(ax - ux, ay - uy)
  const twoPi = 2 * Math.PI
  const norm = (v: number) => ((v % twoPi) + twoPi) % twoPi
  const a0 = Math.atan2(ay - uy, ax - ux)
  const toEnd = norm(Math.atan2(cy0 - uy, cx0 - ux) - a0)
  const toBulge = norm(Math.atan2(by - uy, bx - ux) - a0)
  const sweep = toBulge < toEnd
  const length = sweep ? toEnd : twoPi - toEnd
  const rounded = Math.round(r * 100) / 100
  return { rx: rounded, ry: rounded, largeArc: length > Math.PI, sweep }
}

/** Where a freshly drawn arc's bulge starts: a quarter of the chord out
 * from its midpoint, on the upper side (the left side for a vertical
 * chord), so a left-to-right drag gives a "∩". */
export function defaultArcBulge(start: Point, end: Point): Point {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy)
  let nx = dy / (len || 1)
  let ny = -dx / (len || 1)
  if (ny > 0 || (ny === 0 && nx > 0)) {
    nx = -nx
    ny = -ny
  }
  const h = len / 4
  return { x: (start.x + end.x) / 2 + nx * h, y: (start.y + end.y) / 2 + ny * h }
}
