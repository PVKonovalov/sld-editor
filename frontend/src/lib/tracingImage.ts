import { useEffect, useSyncExternalStore } from 'react'

// A tracing image: a picture shown under a diagram on the canvas only, to draw the diagram over it. It is never part
// of the diagram (not saved, rendered, exported or undone); this browser keeps one per diagram in IndexedDB.

export interface TracingImage {
  href: string // data URI
  x: number
  y: number
  width: number
  height: number
  opacity: number // 0…1
  visible: boolean
}

const DB_NAME = 'sld-editor-tracing'
const STORE = 'images'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const req = op(db.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

// Writes go through one chain, so they land in the order made.
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(job: () => Promise<T>, fallback: T): Promise<T> {
  const next = queue.then(job).catch(e => {
    console.warn('sld-editor: tracing image storage:', e)
    return fallback
  })
  queue = next
  return next
}

// The open diagram's image, shared by the canvas and the Properties panel.
let current: { name: string | null; image: TracingImage | null } = { name: null, image: null }
const listeners = new Set<() => void>()

function publish(next: typeof current) {
  current = next
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The tracing image of diagram name (null while none is set or it is loading), loaded from this browser's storage
 * when name changes. */
export function useTracingImage(name: string | null): TracingImage | null {
  useEffect(() => {
    if (current.name === name) return
    publish({ name, image: null })
    if (!name) return
    void enqueue(() => run<TracingImage | undefined>('readonly', s => s.get(name)), undefined).then(image => {
      if (current.name === name && image) publish({ name, image })
    })
  }, [name])
  const state = useSyncExternalStore(subscribe, () => current)
  return state.name === name ? state.image : null
}

/** Sets (or, with null, removes) the tracing image of diagram name and stores it. */
export function setTracingImage(name: string, image: TracingImage | null) {
  if (current.name === name) publish({ name, image })
  const write = image
    ? () => run('readwrite', s => s.put(image, name)).then(() => undefined)
    : () => run('readwrite', s => s.delete(name)).then(() => undefined)
  void enqueue(write, undefined)
}

/** Moves the tracing image of the diagram from, or of every diagram inside the folder from (isDir), to the matching
 * names under to. */
export async function renameTracingImages(from: string, to: string, isDir: boolean): Promise<void> {
  const keys = await enqueue(() => run<IDBValidKey[]>('readonly', s => s.getAllKeys()), [])
  for (const key of keys) {
    const name = String(key)
    if (!(isDir ? name.startsWith(`${from}/`) : name === from)) continue
    const image = await enqueue(() => run<TracingImage | undefined>('readonly', s => s.get(name)), undefined)
    if (!image) continue
    const moved = to + name.slice(from.length)
    await enqueue(() => run('readwrite', s => s.put(image, moved)).then(() => undefined), undefined)
    await enqueue(() => run('readwrite', s => s.delete(name)).then(() => undefined), undefined)
    if (current.name === name) publish({ name: moved, image })
  }
}

/** Removes the tracing image of diagram name from storage. */
export function deleteTracingImage(name: string): Promise<void> {
  if (current.name === name) publish({ name, image: null })
  return enqueue(() => run('readwrite', s => s.delete(name)).then(() => undefined), undefined)
}

/** Reads an image's natural size from its data URI. */
export function imageSize(href: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('image'))
    img.src = href
  })
}

/** The position and size that fit an image of size into a width × height diagram, centered, keeping its
 * proportions. */
export function fitImage(size: { width: number; height: number }, width: number, height: number) {
  const scale = Math.min(width / size.width, height / size.height)
  const w = size.width * scale
  const h = size.height * scale
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h }
}
