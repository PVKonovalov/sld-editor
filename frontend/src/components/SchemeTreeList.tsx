import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, CircleHelp, Folder, Link2, Link2Off } from 'lucide-react'
import { t } from '../i18n'
import { hasScheme, nestSchemes, schemeText, type SchemeGroupNode } from '../lib/schemes'
import type { ProviderScheme, SchemeStatus, SchemeTree } from '../types'

/** The provider's group → scheme tree, filtered by query (name, file name, ref or linked diagram); a filter expands
 * every group with a match. renderScheme draws one scheme row. */
export function SchemeTreeList({
  tree,
  query,
  renderScheme,
}: {
  tree: SchemeTree
  query: string
  renderScheme: (s: ProviderScheme) => ReactNode
}) {
  const roots = useMemo(() => nestSchemes(tree), [tree])
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const q = query.trim().toLowerCase()
  const keep = (s: ProviderScheme) => !q || schemeText(s).includes(q)

  function group(node: SchemeGroupNode, depth: number): ReactNode {
    if (!hasScheme(node, keep)) return null
    const expanded = !!q || open.has(node.group.id)
    return (
      <li key={`g:${node.group.id}`}>
        <button
          type="button"
          onClick={() =>
            setOpen(prev => {
              const next = new Set(prev)
              if (next.has(node.group.id)) next.delete(node.group.id)
              else next.add(node.group.id)
              return next
            })
          }
          className="w-full flex items-center gap-1 text-left py-0.5 hover:bg-surface-600 rounded text-gray-300"
          style={{ paddingLeft: depth * 12 }}
        >
          {expanded ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
          <Folder size={12} className="shrink-0 text-gray-500" />
          <span className="truncate">{node.group.name || t('schemes.noGroup')}</span>
        </button>
        {expanded && (
          <ul>
            {node.groups.map(g => group(g, depth + 1))}
            {node.schemes.filter(keep).map(s => (
              <li key={`s:${s.ref}`} style={{ paddingLeft: (depth + 1) * 12 }}>
                {renderScheme(s)}
              </li>
            ))}
          </ul>
        )}
      </li>
    )
  }

  const items = roots.map(r => group(r, 0)).filter(Boolean)
  return items.length > 0 ? <ul className="text-xs">{items}</ul> : <p className="text-xs text-gray-500">{t('schemes.none')}</p>
}

const STATUS_COLOR: Record<SchemeStatus, string> = {
  linked: 'text-gray-400',
  exported: 'text-emerald-400',
  changed: 'text-amber-400',
  missing: 'text-red-400',
  unknown: 'text-gray-500',
}

/** The icon of a diagram's scheme link status, titled with the status and the scheme. */
export function SchemeStatusIcon({ status, scheme }: { status: SchemeStatus; scheme: string }) {
  const title = t(`schemes.status.${status}`, { ref: scheme })
  const Icon = status === 'missing' ? Link2Off : status === 'unknown' ? CircleHelp : Link2
  return (
    <span title={title} aria-label={title} className={`shrink-0 ${STATUS_COLOR[status]}`}>
      <Icon size={12} />
    </span>
  )
}
