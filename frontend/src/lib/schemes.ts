import { useCallback, useEffect, useState } from 'react'
import * as api from './api'
import type { ProviderScheme, SchemeGroup, SchemeTree } from '../types'

/** A group of the scheme tree with its subgroups and schemes, each sorted by name. */
export interface SchemeGroupNode {
  group: SchemeGroup
  groups: SchemeGroupNode[]
  schemes: ProviderScheme[]
}

/** Nests tree's groups by parent; a group whose parent is unknown, or that is part of a cycle, becomes a root. Schemes
 * of an unknown group go into a root without a name (id ""). */
export function nestSchemes(tree: SchemeTree): SchemeGroupNode[] {
  const nodes = new Map<string, SchemeGroupNode>()
  for (const g of tree.groups) nodes.set(g.id, { group: g, groups: [], schemes: [] })
  const parentOf = (n: SchemeGroupNode) => (n.group.parent ? nodes.get(n.group.parent) : undefined)
  const inCycle = (n: SchemeGroupNode) => {
    const seen = new Set<SchemeGroupNode>()
    for (let p = parentOf(n); p; p = parentOf(p)) {
      if (p === n) return true
      if (seen.has(p)) return false
      seen.add(p)
    }
    return false
  }
  const roots: SchemeGroupNode[] = []
  for (const node of nodes.values()) {
    const parent = parentOf(node)
    if (parent && !inCycle(node)) parent.groups.push(node)
    else roots.push(node)
  }
  let orphans: SchemeGroupNode | undefined
  for (const s of tree.schemes) {
    const node = nodes.get(s.group)
    if (node) node.schemes.push(s)
    else {
      orphans ??= { group: { id: '', name: '' }, groups: [], schemes: [] }
      orphans.schemes.push(s)
    }
  }
  if (orphans) roots.push(orphans)
  return roots
}

/** Reports whether node or anything under it has a scheme matching keep. */
export function hasScheme(node: SchemeGroupNode, keep: (s: ProviderScheme) => boolean): boolean {
  return node.schemes.some(keep) || node.groups.some(g => hasScheme(g, keep))
}

/** Lower-cased text a filter matches a scheme against: name, file name, ref and linked diagram. */
export function schemeText(s: ProviderScheme): string {
  return `${s.name}\n${s.fileName ?? ''}\n${s.ref}\n${s.diagram ?? ''}`.toLowerCase()
}

/** Loads the scheme tree when enabled; reload asks again. */
export function useSchemeTree(enabled: boolean) {
  const [tree, setTree] = useState<SchemeTree | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seq, setSeq] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let live = true
    api.listSchemes().then(
      t => live && (setTree(t), setError(null)),
      e => live && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [enabled, seq])
  const reload = useCallback(() => {
    setTree(null)
    setError(null)
    setSeq(n => n + 1)
  }, [])
  return { tree, error, reload }
}
