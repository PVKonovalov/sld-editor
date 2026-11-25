import { findSymbol, prepareImage, type InkImage, type Rect } from './symbolSearch'

// Runs symbolSearch off the main thread. Messages in: { type: 'image', key, width, height, data } (the RGBA pixels,
// kept as an ink image until another key comes), { type: 'search', id, key, rect, rotate, mirror }. Out:
// { type: 'progress', id, done }, { type: 'result', id, matches }, { type: 'error', id, message }.

const ctx = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent) => void) | null }

let image: { key: string; img: InkImage } | null = null

ctx.onmessage = (e: MessageEvent) => {
  const m = e.data
  if (m.type === 'image') {
    image = { key: m.key, img: prepareImage(m.data as Uint8ClampedArray, m.width, m.height) }
    return
  }
  if (m.type !== 'search') return
  if (!image || image.key !== m.key) {
    ctx.postMessage({ type: 'error', id: m.id, message: 'image' })
    return
  }
  try {
    const matches = findSymbol(image.img, m.rect as Rect, { rotate: m.rotate, mirror: m.mirror }, done =>
      ctx.postMessage({ type: 'progress', id: m.id, done }),
    )
    ctx.postMessage({ type: 'result', id: m.id, matches })
  } catch (err) {
    ctx.postMessage({ type: 'error', id: m.id, message: String(err) })
  }
}
