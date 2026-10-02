import type { Diagram } from '../types'

// Recovery drafts: a copy of the open diagram's unsaved edits, kept in this
// browser's IndexedDB (localStorage's ~5 MB is too small once a diagram
// embeds pictures) and keyed by the diagram's server name. DiagramContext
// writes one shortly after each edit and deletes it on Save or "Don't
// save"; one that is still there on the next visit means the edits never
// reached the server (a crash, a killed tab, a power cut), and the editor
// offers to restore it. Drafts are a safety net only: every failure here is
// logged and swallowed, never shown as an editing error.

export interface Draft {
  name: string
  diagram: Diagram
  savedAt: number // ms since the epoch
}

const DB_NAME = 'sld-editor'
const STORE = 'drafts'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' })
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

// Every write and delete goes through one chain, so a debounced write still
// in flight can never land after the delete a Save issued just after it.
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(job: () => Promise<T>, fallback: T): Promise<T> {
  const next = queue.then(job).catch(e => {
    console.warn('sld-editor: draft storage:', e)
    return fallback
  })
  queue = next
  return next
}

export function putDraft(name: string, diagram: Diagram): Promise<void> {
  const draft: Draft = { name, diagram, savedAt: Date.now() }
  return enqueue(() => run('readwrite', s => s.put(draft)).then(() => undefined), undefined)
}

export function deleteDraft(name: string): Promise<void> {
  return enqueue(() => run('readwrite', s => s.delete(name)).then(() => undefined), undefined)
}

export function getDraft(name: string): Promise<Draft | null> {
  return enqueue(() => run<Draft | undefined>('readonly', s => s.get(name)).then(d => d ?? null), null)
}

export function listDrafts(): Promise<Draft[]> {
  return enqueue(() => run<Draft[]>('readonly', s => s.getAll()), [])
}
