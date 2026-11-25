// Finding the instances of a symbol in a line-drawing picture (the tracing image): the picture is reduced to ink and
// paper, and every position is scored by chamfer matching against the sample's 8 rotation/mirror variants.

/** Distances are truncated here (image pixels): a sample ink pixel this far or farther from any ink counts as missed. */
const T = 3
const MIN_SCORE = 0.5
const COARSE_MIN_SCORE = 0.4
const INK_COUNT_TOLERANCE = 0.4
const MAX_FULL_PIXELS = 3_000_000

export interface InkImage {
  width: number
  height: number
  ink: Uint8Array
  dist: Float32Array
  integral: Int32Array
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A sample variant: turned by rotate degrees clockwise (0/90/180/270) after a horizontal flip when mirror. */
interface Variant {
  rotate: number
  mirror: boolean
  width: number
  height: number
  ink: Uint8Array
  pts: Int32Array
  count: number
  dist: Float32Array
}

export interface SymbolMatch {
  rect: Rect
  score: number
  rotate: number
  mirror: boolean
}

/** Otsu's threshold of a 0…255 histogram. */
function otsu(hist: Uint32Array, total: number): number {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 127
  for (let i = 0; i < 256; i++) {
    wB += hist[i]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += i * hist[i]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      threshold = i
    }
  }
  return threshold
}

/** Two-pass 3-4 chamfer distance (in pixels, truncated at T) of every pixel to the nearest ink pixel. */
function distanceMap(ink: Uint8Array, w: number, h: number): Float32Array {
  const big = T * 3 + 4
  const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = ink[i] ? 0 : big
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let v = d[i]
      if (v === 0) continue
      if (x > 0) v = Math.min(v, d[i - 1] + 3)
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3)
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4)
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4)
      }
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      let v = d[i]
      if (v === 0) continue
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3)
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3)
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4)
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4)
      }
      d[i] = v
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = Math.min(d[i] / 3, T)
  return d
}

function integralOf(ink: Uint8Array, w: number, h: number): Int32Array {
  const s = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += ink[y * w + x]
      s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + row
    }
  }
  return s
}

function inkImage(ink: Uint8Array, width: number, height: number): InkImage {
  return { width, height, ink, dist: distanceMap(ink, width, height), integral: integralOf(ink, width, height) }
}

/** The ink image of RGBA pixels: luminance over white, thresholded by Otsu; the minority side is ink, so a light
 * drawing on a dark background works too. */
export function prepareImage(rgba: Uint8ClampedArray, width: number, height: number): InkImage {
  const n = width * height
  const lum = new Uint8Array(n)
  const hist = new Uint32Array(256)
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255
    const l = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
    const v = Math.round(l * a + 255 * (1 - a))
    lum[i] = v
    hist[v]++
  }
  const threshold = otsu(hist, n)
  let dark = 0
  for (let i = 0; i < n; i++) if (lum[i] <= threshold) dark++
  const inkDark = dark <= n / 2
  const ink = new Uint8Array(n)
  for (let i = 0; i < n; i++) ink[i] = (lum[i] <= threshold) === inkDark ? 1 : 0
  return inkImage(ink, width, height)
}

/** img reduced by factor f, a reduced pixel being ink when any of its pixels is. */
function reduce(img: { width: number; height: number; ink: Uint8Array }, f: number) {
  const width = Math.ceil(img.width / f)
  const height = Math.ceil(img.height / f)
  const ink = new Uint8Array(width * height)
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.ink[y * img.width + x]) ink[Math.floor(y / f) * width + Math.floor(x / f)] = 1
    }
  }
  return { width, height, ink }
}

function variantOf(ink: Uint8Array, width: number, height: number, rotate: number, mirror: boolean): Variant {
  let w = width
  let h = height
  let cur = ink
  if (mirror) {
    const next = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) next[y * w + x] = cur[y * w + (w - 1 - x)]
    cur = next
  }
  for (let k = 0; k < rotate / 90; k++) {
    const next = new Uint8Array(w * h)
    for (let y = 0; y < w; y++) for (let x = 0; x < h; x++) next[y * h + x] = cur[(h - 1 - x) * w + y]
    cur = next
    ;[w, h] = [h, w]
  }
  const pts: number[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cur[y * w + x]) pts.push(x, y)
  return {
    rotate,
    mirror,
    width: w,
    height: h,
    ink: cur,
    pts: Int32Array.from(pts),
    count: pts.length / 2,
    dist: distanceMap(cur, w, h),
  }
}

/** The distinct variants of the sample ink (identical bitmaps once), rotated only when rotate, mirrored only when
 * mirror. */
function variantsOf(sample: Uint8Array, width: number, height: number, rotate: boolean, mirror: boolean): Variant[] {
  const out: Variant[] = []
  for (const m of mirror ? [false, true] : [false]) {
    for (const r of rotate ? [0, 90, 180, 270] : [0]) {
      const v = variantOf(sample, width, height, r, m)
      const same = out.some(o => o.width === v.width && o.height === v.height && o.ink.every((p, i) => p === v.ink[i]))
      if (!same) out.push(v)
    }
  }
  return out
}

/** The score (0…1) of variant v at x0, y0 of img, or -1 below minScore. */
function scoreAt(img: InkImage, v: Variant, x0: number, y0: number, minScore: number): number {
  const W = img.width
  const s = img.integral
  const W1 = W + 1
  const count =
    s[(y0 + v.height) * W1 + x0 + v.width] - s[y0 * W1 + x0 + v.width] - s[(y0 + v.height) * W1 + x0] + s[y0 * W1 + x0]
  if (count < v.count * (1 - INK_COUNT_TOLERANCE) || count > v.count * (1 + INK_COUNT_TOLERANCE)) return -1
  const budget = 2 * T * (1 - minScore)
  const limit = budget * v.count
  let fwd = 0
  for (let i = 0; i < v.pts.length; i += 2) {
    fwd += img.dist[(y0 + v.pts[i + 1]) * W + x0 + v.pts[i]]
    if (fwd > limit) return -1
  }
  fwd /= v.count
  let rev = 0
  for (let y = 0; y < v.height; y++) {
    const row = (y0 + y) * W + x0
    for (let x = 0; x < v.width; x++) if (img.ink[row + x]) rev += v.dist[y * v.width + x]
  }
  rev /= Math.max(count, 1)
  const score = 1 - (fwd + rev) / (2 * T)
  return score >= minScore ? Math.min(score, 1) : -1
}

/** Every position of v in img (within area, default the whole image) scoring at least minScore. */
function scan(img: InkImage, v: Variant, minScore: number, area?: Rect): SymbolMatch[] {
  const x1 = Math.max(0, area?.x ?? 0)
  const y1 = Math.max(0, area?.y ?? 0)
  const x2 = Math.min(img.width - v.width, area ? area.x + area.width : img.width)
  const y2 = Math.min(img.height - v.height, area ? area.y + area.height : img.height)
  const out: SymbolMatch[] = []
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const score = scoreAt(img, v, x, y, minScore)
      if (score >= 0) out.push({ rect: { x, y, width: v.width, height: v.height }, score, rotate: v.rotate, mirror: v.mirror })
    }
  }
  return out
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** The best hits: by score, dropping any overlapping a better kept one by more than 30% of the smaller box. */
function bestHits(hits: SymbolMatch[], cell: number): SymbolMatch[] {
  hits.sort((a, b) => b.score - a.score)
  const grid = new Map<string, SymbolMatch[]>()
  const key = (x: number, y: number) => `${x},${y}`
  const kept: SymbolMatch[] = []
  for (const h of hits) {
    const cx = Math.floor(h.rect.x / cell)
    const cy = Math.floor(h.rect.y / cell)
    let clash = false
    for (let dy = -1; dy <= 1 && !clash; dy++) {
      for (let dx = -1; dx <= 1 && !clash; dx++) {
        for (const k of grid.get(key(cx + dx, cy + dy)) ?? []) {
          const min = Math.min(h.rect.width * h.rect.height, k.rect.width * k.rect.height)
          if (overlap(h.rect, k.rect) > 0.3 * min) {
            clash = true
            break
          }
        }
      }
    }
    if (clash) continue
    kept.push(h)
    const list = grid.get(key(cx, cy)) ?? []
    list.push(h)
    grid.set(key(cx, cy), list)
  }
  return kept
}

/** The instances of the sample (img's ink inside rect, in image pixels) in img: its variants (rotated and mirrored
 * when allowed) at every position, best hits only, best first. Large pictures are scanned reduced first and refined
 * around the reduced hits. onProgress gets the done fraction. */
export function findSymbol(
  img: InkImage,
  rect: Rect,
  opts: { rotate: boolean; mirror: boolean },
  onProgress?: (done: number) => void,
): SymbolMatch[] {
  const x = Math.max(0, Math.round(rect.x))
  const y = Math.max(0, Math.round(rect.y))
  const w = Math.min(img.width, Math.round(rect.x + rect.width)) - x
  const h = Math.min(img.height, Math.round(rect.y + rect.height)) - y
  if (w < 2 || h < 2) return []
  const sample = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) sample[j * w + i] = img.ink[(y + j) * img.width + x + i]
  const variants = variantsOf(sample, w, h, opts.rotate, opts.mirror).filter(v => v.count > 0)
  const f = Math.max(1, Math.ceil(Math.sqrt((img.width * img.height) / MAX_FULL_PIXELS)))
  const hits: SymbolMatch[] = []
  if (f === 1 || w / f < 4 || h / f < 4) {
    variants.forEach((v, i) => {
      hits.push(...scan(img, v, MIN_SCORE))
      onProgress?.((i + 1) / variants.length)
    })
  } else {
    const small = reduce(img, f)
    const smallImg = inkImage(small.ink, small.width, small.height)
    const smallSample = reduce({ width: w, height: h, ink: sample }, f)
    variants.forEach((v, i) => {
      const sv = variantOf(smallSample.ink, smallSample.width, smallSample.height, v.rotate, v.mirror)
      const coarse = bestHits(scan(smallImg, sv, COARSE_MIN_SCORE), Math.max(sv.width, sv.height))
      for (const c of coarse) {
        const area = { x: c.rect.x * f - f - 1, y: c.rect.y * f - f - 1, width: 2 * f + 2, height: 2 * f + 2 }
        hits.push(...scan(img, v, MIN_SCORE, area))
      }
      onProgress?.((i + 1) / variants.length)
    })
  }
  return bestHits(hits, Math.max(w, h))
}

/** The similarity threshold to start the review with: the middle of the largest gap between sorted scores above
 * 0.6, else 0.8. */
export function defaultThreshold(matches: { score: number }[]): number {
  const scores = matches.map(m => m.score).filter(s => s > 0.6).sort((a, b) => b - a)
  let best = 0
  let threshold = 0.8
  for (let i = 0; i + 1 < scores.length; i++) {
    const gap = scores[i] - scores[i + 1]
    if (gap > best) {
      best = gap
      threshold = (scores[i] + scores[i + 1]) / 2
    }
  }
  return best > 0.03 ? threshold : 0.8
}

/** The anchor, orientation and mirror of an element matching variant (rotate, mirror) at the center of a match,
 * from the sample element (anchor offset d from the sample rectangle's center, orient o, mirror m). The editor
 * places a symbol mirrored first, then turned (diagramOps.placeLocalPoint); so is a variant. */
export function variantPlacement(
  d: { x: number; y: number },
  orient: number,
  mirror: boolean,
  center: { x: number; y: number },
  rotate: number,
  flip: boolean,
): { x: number; y: number; orient: number; mirror: boolean } {
  const fx = flip ? -d.x : d.x
  const rad = (rotate * Math.PI) / 180
  const cos = Math.round(Math.cos(rad))
  const sin = Math.round(Math.sin(rad))
  return {
    x: center.x + fx * cos - d.y * sin,
    y: center.y + fx * sin + d.y * cos,
    orient: flip ? rotate - orient : rotate + orient,
    mirror: flip ? !mirror : mirror,
  }
}

type Frame = { x: number; y: number; orient?: number; mirror?: boolean }

/** The SVG matrix (a, b, c, d, e, f) taking an element drawn in frame from to frame to (anchor, orient, mirror;
 * mirrored first, then turned), for drawing a copy of its rendered markup elsewhere. */
export function frameMatrix(from: Frame, to: Frame): [number, number, number, number, number, number] {
  const m = (f: Frame) => {
    const r = ((f.orient ?? 0) * Math.PI) / 180
    const s = f.mirror ? -1 : 1
    return [Math.cos(r) * s, Math.sin(r) * s, -Math.sin(r), Math.cos(r), f.x, f.y]
  }
  const [a, b, c, d, e, f] = m(from)
  const det = a * d - b * c
  const inv = [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
  const [A, B, C, D, E, F] = m(to)
  return [
    A * inv[0] + C * inv[1],
    B * inv[0] + D * inv[1],
    A * inv[2] + C * inv[3],
    B * inv[2] + D * inv[3],
    A * inv[4] + C * inv[5] + E,
    B * inv[4] + D * inv[5] + F,
  ]
}
