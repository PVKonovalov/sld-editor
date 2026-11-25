// Where a designation label goes: a pure function of boxes, with no React or state, so it could move to the server.

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

// The estimated width of a character, as a share of the font size.
export const CHAR_WIDTH = 0.6
// The gap kept between a label and anything else.
export const LABEL_MARGIN = 2
// How many steps a blocked label slides along each side.
export const SLIDE_STEPS = 5

const CELL = 64

/** An index of obstacle boxes in a grid of cells, so a test against thousands of them stays fast. */
export class ObstacleIndex {
  private cells = new Map<string, Box[]>()

  add(box: Box) {
    for (const key of this.keys(box)) {
      const list = this.cells.get(key)
      if (list) list.push(box)
      else this.cells.set(key, [box])
    }
  }

  /** Whether box, grown by margin, overlaps any obstacle. */
  hits(box: Box, margin = LABEL_MARGIN): boolean {
    const b = { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin }
    for (const key of this.keys(b)) {
      for (const o of this.cells.get(key) ?? []) {
        if (b.x < o.x + o.width && o.x < b.x + b.width && b.y < o.y + o.height && o.y < b.y + b.height) return true
      }
    }
    return false
  }

  private *keys(b: Box): Generator<string> {
    for (let cx = Math.floor(b.x / CELL); cx <= Math.floor((b.x + b.width) / CELL); cx++) {
      for (let cy = Math.floor(b.y / CELL); cy <= Math.floor((b.y + b.height) / CELL); cy++) yield `${cx},${cy}`
    }
  }
}

/** The box of a text of size at (x, y) — y its baseline unless valign is top or middle — aligned by anchor. */
export function textBox(x: number, y: number, text: string, size: number, anchor?: string, valign?: string): Box {
  const width = [...text].length * size * CHAR_WIDTH
  const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x
  const top = valign === 'top' ? y : valign === 'middle' ? y - size / 2 : y - size
  return { x: left, y: top, width, height: size }
}

/** The box of segment a–b, at least 1 thick. */
export function segmentBox(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(Math.abs(a.x - b.x), 1), height: Math.max(Math.abs(a.y - b.y), 1) }
}

export interface LabelPlacement {
  // The label's anchor point (start-anchored, baseline at y).
  x: number
  y: number
  // No free place was found: it overlaps something.
  overlaps: boolean
}

/** Places a start-anchored label of text, font size size, for an element of box (in diagram coordinates): one grid
 * step to its right, vertically centered; else one grid step above it, left-aligned with it; else sliding — on the
 * right up and down a line at a time, above further up a line at a time and right within the element's width — up to
 * SLIDE_STEPS steps. A place is taken only when the label lies wholly inside the width × height diagram and overlaps
 * no obstacle (LABEL_MARGIN apart). Positions are on the grid when snap. Without a free place, the label goes to the
 * right of the element, kept inside the diagram, with overlaps set. */
export function designationLabelPlacement(
  box: Box,
  text: string,
  size: number,
  obstacles: ObstacleIndex,
  width: number,
  height: number,
  grid: number,
  snap: boolean,
): LabelPlacement {
  const textWidth = [...text].length * size * CHAR_WIDTH
  const line = size + LABEL_MARGIN
  const onGrid = (v: number, round: (n: number) => number) => (snap && grid > 0 ? round(v / grid) * grid : v)
  const fits = (x: number, y: number) =>
    x >= 0 && y - size >= 0 && x + textWidth <= width && y <= height && !obstacles.hits(textBox(x, y, text, size))
  const right = (dy: number) => ({
    x: onGrid(box.x + box.width + grid, Math.ceil),
    y: onGrid(box.y + box.height / 2 + size / 2 + dy, Math.round),
  })
  const above = (dy: number, dx: number) => ({
    x: onGrid(box.x + dx, Math.round),
    y: onGrid(box.y - grid - dy, Math.floor),
  })
  const candidates = [right(0), above(0, 0)]
  for (let k = 1; k <= SLIDE_STEPS; k++) candidates.push(right(-k * line), right(k * line))
  const shift = Math.max(grid, 1)
  for (let k = 0; k <= SLIDE_STEPS; k++) {
    for (let dx = k === 0 ? shift : 0; dx <= box.width; dx += shift) candidates.push(above(k * line, dx))
  }
  for (const c of candidates) if (fits(c.x, c.y)) return { ...c, overlaps: false }
  const clamp = (v: number, lo: number, hi: number) => {
    const c = Math.min(Math.max(v, lo), Math.max(hi, lo))
    if (!snap || grid <= 0) return c
    const up = Math.ceil(c / grid) * grid
    return up <= hi ? up : Math.max(Math.floor(c / grid) * grid, Math.min(lo, hi))
  }
  return { x: clamp(candidates[0].x, 0, width - textWidth), y: clamp(candidates[0].y, size, height), overlaps: true }
}
