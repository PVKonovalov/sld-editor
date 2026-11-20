import type { TracingImage } from './tracingImage'
import type { Rect, SymbolMatch } from './symbolSearch'

// Runs a symbol search (symbolSearch.worker) on the tracing image, in diagram coordinates. One worker is kept while
// the image stays the same; cancelling a search ends that worker.

let worker: Worker | null = null
let workerKey: string | null = null
let workerSize = { width: 0, height: 0 }
let nextId = 1

const keyOf = (href: string) => `${href.length}:${href.slice(-64)}`

async function pixels(href: string): Promise<ImageData> {
  const img = new Image()
  img.src = href
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const c = canvas.getContext('2d', { willReadFrequently: true })
  if (!c) throw new Error('canvas')
  c.drawImage(img, 0, 0)
  return c.getImageData(0, 0, canvas.width, canvas.height)
}

function endWorker() {
  worker?.terminate()
  worker = null
  workerKey = null
}

export interface DiagramMatch {
  box: Rect // diagram coordinates
  score: number
  rotate: number
  mirror: boolean
}

/** Searches image for the symbol inside sample (diagram coordinates); onProgress gets the done fraction. cancel
 * stops it (the promise then never settles). */
export function searchSymbol(
  image: TracingImage,
  sample: Rect,
  opts: { rotate: boolean; mirror: boolean },
  onProgress: (done: number) => void,
): { promise: Promise<DiagramMatch[]>; cancel: () => void } {
  const id = nextId++
  let cancelled = false
  const promise = (async () => {
    const key = keyOf(image.href)
    if (!worker || workerKey !== key) {
      const data = await pixels(image.href)
      if (cancelled) return new Promise<DiagramMatch[]>(() => {})
      endWorker()
      worker = new Worker(new URL('./symbolSearch.worker.ts', import.meta.url), { type: 'module' })
      workerKey = key
      workerSize = { width: data.width, height: data.height }
      worker.postMessage({ type: 'image', key, width: data.width, height: data.height, data: data.data }, [
        data.data.buffer,
      ])
    }
    const w = worker
    const sx = workerSize.width / image.width
    const sy = workerSize.height / image.height
    const rect = {
      x: (sample.x - image.x) * sx,
      y: (sample.y - image.y) * sy,
      width: sample.width * sx,
      height: sample.height * sy,
    }
    return new Promise<DiagramMatch[]>((resolve, reject) => {
      w.onmessage = (e: MessageEvent) => {
        const m = e.data
        if (m.id !== id) return
        if (m.type === 'progress') onProgress(m.done)
        else if (m.type === 'error') reject(new Error(m.message))
        else if (m.type === 'result')
          resolve(
            (m.matches as SymbolMatch[]).map(r => ({
              box: {
                x: image.x + r.rect.x / sx,
                y: image.y + r.rect.y / sy,
                width: r.rect.width / sx,
                height: r.rect.height / sy,
              },
              score: r.score,
              rotate: r.rotate,
              mirror: r.mirror,
            })),
          )
      }
      w.onerror = () => reject(new Error('worker'))
      w.postMessage({ type: 'search', id, key, rect, ...opts })
    })
  })()
  return {
    promise,
    cancel: () => {
      cancelled = true
      endWorker()
    },
  }
}
