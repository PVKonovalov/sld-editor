import type { Binding, BindingStatus, DeletedBinding, Diagram } from '../types'

/** The part of an element, wire, label or digital device an export writes. */
interface Bound {
  id: number
  precision?: number
  features?: string
  componentType?: string
  componentEdited?: boolean
  bindings?: Binding[]
}

const COLLECTIONS = ['elements', 'connectors', 'labels', 'digitalDevices'] as const

const sameValue = (a: Binding, b: Binding) =>
  a.source === b.source && a.ref === b.ref && (a.option ?? '') === (b.option ?? '') && (a.scale ?? 0) === (b.scale ?? 0)

const sameComponent = (a: Bound, b: Bound) =>
  (a.precision ?? 0) === (b.precision ?? 0) &&
  (a.features ?? '') === (b.features ?? '') &&
  (a.componentType ?? '') === (b.componentType ?? '')

function withStatus(b: Binding, status: BindingStatus | undefined): Binding {
  if (b.status === status) return b
  const { status: _, ...rest } = b
  return status ? { ...rest, status } : rest
}

/** The pending deletions of a diagram while one edit is tracked. */
class Deletions {
  list: DeletedBinding[]
  changed = false
  constructor(list: DeletedBinding[] | undefined) {
    this.list = list ?? []
  }
  add(d: DeletedBinding) {
    if (this.list.some(x => x.item === d.item && x.source === d.source && x.kind === d.kind && x.ref === d.ref)) return
    this.list = [...this.list, d]
    this.changed = true
  }
}

/** p, a binding the provider has, is gone from item id: its row is to be deleted. */
const gone = (id: number, p: Binding, dels: Deletions) => {
  if (p.status !== 'new') dels.add({ item: id, source: p.source, kind: p.kind, ref: p.ref })
}

/** next's bindings with their statuses after the edit from prev's; the ones the provider has that were removed or
 * got another ref go to dels, their replacement is new. A deleted binding is never revived as edited. */
function trackBindings(id: number, prev: Binding[], next: Binding[], dels: Deletions): Binding[] {
  let out: Binding[] | null = null
  next.forEach((b, i) => {
    const p = prev.find(x => x.kind === b.kind)
    let status: BindingStatus | undefined = 'new'
    if (p && p.source === b.source && p.ref === b.ref) status = sameValue(p, b) || p.status === 'new' ? p.status : 'edited'
    else if (p) gone(id, p, dels)
    const t = withStatus(b, status)
    if (t !== b) (out ??= [...next])[i] = t
  })
  for (const p of prev) if (!next.some(b => b.kind === p.kind)) gone(id, p, dels)
  return out ?? next
}

/** next with the export statuses of what changed from prev: an added binding (or one with another ref) becomes 'new',
 * one whose option or scale changed 'edited', one the provider has that was removed (or replaced, or whose item was
 * removed) goes to deletedBindings, an item whose precision, features or component type changed gets
 * componentEdited. Not when the edit links the diagram to another scheme; untouched items keep their reference. */
export function trackBindingChanges(prev: Diagram, next: Diagram): Diagram {
  if (prev === next || prev.scheme?.source !== next.scheme?.source || prev.scheme?.ref !== next.scheme?.ref) return next
  const dels = new Deletions(next.deletedBindings)
  const prevItems = new Map<number, Bound>()
  for (const c of COLLECTIONS) for (const it of prev[c] as Bound[]) prevItems.set(it.id, it)
  const present = new Set<number>()
  let out = next
  for (const c of COLLECTIONS) {
    const list = next[c] as Bound[]
    let changed: Bound[] | null = null
    list.forEach((it, i) => {
      present.add(it.id)
      const p = prevItems.get(it.id)
      if (p === it) return
      const prevBindings = p?.bindings ?? []
      const bindings = trackBindings(it.id, prevBindings, it.bindings ?? [], dels)
      const settled = prevBindings.some(b => b.status !== 'new')
      const edited = !!p && (!!p.componentEdited || (settled && !sameComponent(p, it)))
      if (bindings === (it.bindings ?? []) && edited === !!it.componentEdited) return
      const t: Bound = { ...it, bindings: bindings.length ? bindings : it.bindings }
      if (edited) t.componentEdited = true
      else delete t.componentEdited
      ;(changed ??= [...list])[i] = t
    })
    if (changed) out = { ...out, [c]: changed } as Diagram
  }
  for (const [id, p] of prevItems) {
    if (!present.has(id)) for (const b of p.bindings ?? []) gone(id, b, dels)
  }
  if (prev.object !== next.object) {
    const [object] = trackBindings(0, prev.object ? [prev.object] : [], next.object ? [next.object] : [], dels)
    if (object !== next.object) out = { ...out, object }
  }
  if (dels.changed) out = { ...out, deletedBindings: dels.list.length ? dels.list : undefined }
  return out
}

/** Whether d has binding changes of source not yet exported. */
export function hasPendingBindings(d: Diagram, source: string): boolean {
  if (d.deletedBindings?.some(x => x.source === source)) return true
  if (d.object?.source === source && d.object.status) return true
  return COLLECTIONS.some(c =>
    (d[c] as Bound[]).some(
      it =>
        (it.componentEdited && it.bindings?.some(b => b.source === source)) ||
        it.bindings?.some(b => b.source === source && b.status),
    ),
  )
}

/** How many items (the diagram's object counted as one) have binding changes of source not yet exported. */
export function pendingItemCount(d: Diagram, source: string): number {
  const ids = new Set<number>()
  for (const x of d.deletedBindings ?? []) if (x.source === source) ids.add(x.item)
  if (d.object?.source === source && d.object.status) ids.add(0)
  for (const c of COLLECTIONS) {
    for (const it of d[c] as Bound[]) {
      const own = it.bindings?.filter(b => b.source === source) ?? []
      if ((it.componentEdited && own.length) || own.some(b => b.status)) ids.add(it.id)
    }
  }
  return ids.size
}
