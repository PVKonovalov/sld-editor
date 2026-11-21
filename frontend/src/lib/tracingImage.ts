import { useMemo, useSyncExternalStore } from 'react'
import * as api from './api'
import type { Diagram } from '../types'

// A tracing image: a picture shown under a diagram on the canvas only, to draw the diagram over it. Its file is stored
// on the server next to the diagram and the diagram's tracingImage references it; it is never rendered or exported.

/** The open diagram's tracing image as the canvas shows it. */
export interface TracingImage {
  href: string
  x: number
  y: number
  width: number
  height: number
  opacity: number // 0…1
  visible: boolean
}

// Bumped per diagram on every upload, so the image's URL changes and the browser loads the new file.
const versions = new Map<string, number>()
const listeners = new Set<() => void>()
let changes = 0

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Uploads image as the tracing image of diagram name; resolves to its file name. */
export async function uploadTracingImage(name: string, image: Blob): Promise<string> {
  const file = await api.uploadTracingImage(name, image)
  versions.set(name, (versions.get(name) ?? 0) + 1)
  changes++
  for (const l of listeners) l()
  return file
}

/** The tracing image of diagram (open as name), or null when it has none. */
export function useTracingImage(name: string | null, diagram: Diagram | null): TracingImage | null {
  useSyncExternalStore(subscribe, () => changes)
  const ref = diagram?.tracingImage
  const version = name ? (versions.get(name) ?? 0) : 0
  return useMemo(
    () =>
      name && ref
        ? {
            href: api.tracingImageUrl(name, version),
            x: ref.x,
            y: ref.y,
            width: ref.width,
            height: ref.height,
            opacity: ref.opacity,
            visible: !ref.hidden,
          }
        : null,
    [name, ref, version],
  )
}

// Tracing images kept by earlier versions of the editor in this browser (IndexedDB, one per diagram name): moved to
// the server when their diagram is opened.
const LEGACY_DB = 'sld-editor-tracing'
const LEGACY_STORE = 'images'

function legacyRun<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(LEGACY_DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(LEGACY_STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const req = op(db.transaction(LEGACY_STORE, mode).objectStore(LEGACY_STORE))
      req.onsuccess = () => {
        resolve(req.result)
        db.close()
      }
      req.onerror = () => {
        reject(req.error)
        db.close()
      }
    }
  })
}

/** The tracing image this browser kept for diagram name (href a data URI), or null. */
export async function legacyTracingImage(name: string): Promise<TracingImage | null> {
  try {
    return (await legacyRun<TracingImage | undefined>('readonly', s => s.get(name))) ?? null
  } catch {
    return null
  }
}

/** Moves the tracing image this browser kept for the diagram from, or for every diagram inside the folder from
 * (isDir), to the matching names under to. */
export async function renameLegacyTracingImages(from: string, to: string, isDir: boolean): Promise<void> {
  try {
    const keys = await legacyRun<IDBValidKey[]>('readonly', s => s.getAllKeys())
    for (const key of keys) {
      const name = String(key)
      if (!(isDir ? name.startsWith(`${from}/`) : name === from)) continue
      const image = await legacyRun<TracingImage | undefined>('readonly', s => s.get(name))
      if (!image) continue
      await legacyRun('readwrite', s => s.put(image, to + name.slice(from.length)))
      await legacyRun('readwrite', s => s.delete(name))
    }
  } catch (e) {
    console.warn('sld-editor: tracing image storage:', e)
  }
}

/** Forgets the tracing image this browser kept for diagram name. */
export async function deleteLegacyTracingImage(name: string): Promise<void> {
  try {
    await legacyRun('readwrite', s => s.delete(name))
  } catch (e) {
    console.warn('sld-editor: tracing image storage:', e)
  }
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
