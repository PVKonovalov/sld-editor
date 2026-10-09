import { useState } from 'react'
import { ScissorsLineDashed } from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import * as diagramOps from '../../lib/diagramOps'
import { elementDisplayName } from '../../lib/elementCatalogI18n'
import { GroupHeader } from './GroupHeader'
import { t, type TranslationKey } from '../../i18n'
import type { Connector, DiagramElement } from '../../types'

// The Properties panel's topology view of one element (each of its Ports)
// or wire (its two ends): the Node each sits on, and everything else
// attached to that Node, each a link that selects it, with a scissors button
// that disconnects just that item from the Node
// (diagramOps.disconnectAttachment), in one undo step.

type Row = { key: string; heading: string; node: number; self: diagramOps.NodeAttachment }

export function ConnectionsSection({ element, connector }: { element?: DiagramElement; connector?: Connector }) {
  const { diagram, elements, config, selectElement, selectConnector, updateDiagram } = useDiagramContext()
  const [collapsed, setCollapsed] = useState(false)
  if (!diagram) return null

  const rows: Row[] = []
  if (element) {
    for (const p of element.ports ?? []) {
      rows.push({
        key: `p${p.name}`,
        heading: t('properties.connectionPort', { port: p.name }),
        node: p.node,
        self: { kind: 'element', id: element.id, port: p.name },
      })
    }
  } else if (connector) {
    for (const end of ['from', 'to'] as const) {
      rows.push({
        key: end,
        heading: t(end === 'from' ? 'properties.connectionFrom' : 'properties.connectionTo'),
        node: connector[end],
        self: { kind: 'connector', id: connector.id, end },
      })
    }
  }
  if (rows.length === 0) return null
  const grid = diagram.editor?.gridSpacing ?? config?.editor.gridSpacing ?? 10

  const attachments = diagramOps.nodeAttachments(diagram)
  const nodesById = new Map(diagram.nodes.map(n => [n.id, n]))
  const elementsById = new Map(diagram.elements.map(e => [e.id, e]))
  const connectorsById = new Map(diagram.connectors.map(c => [c.id, c]))

  const sameAttachment = (a: diagramOps.NodeAttachment, b: diagramOps.NodeAttachment) =>
    a.kind === b.kind &&
    a.id === b.id &&
    (a.kind === 'element' ? a.port === (b as typeof a).port : a.end === (b as typeof a).end)

  function elementName(el: DiagramElement): string {
    if (el.name) return el.name
    const symbol = elements.find(s => s.shape === el.shape)
    return `${symbol ? elementDisplayName(symbol) : el.class} #${el.id}`
  }
  function connectorName(c: Connector): string {
    return c.name || `${t(`connectorKind.${c.kind}` as TranslationKey)} #${c.id}`
  }

  function attachmentLink(node: number, a: diagramOps.NodeAttachment) {
    let label: string
    let onClick: () => void
    if (a.kind === 'element') {
      const el = elementsById.get(a.id)
      if (!el) return null
      label = t('properties.connectionElementPort', { name: elementName(el), port: a.port })
      onClick = () => selectElement(a.id)
    } else {
      const c = connectorsById.get(a.id)
      if (!c) return null
      label = connectorName(c)
      onClick = () => selectConnector(a.id)
    }
    return (
      <li key={`${a.kind}-${a.id}-${a.kind === 'element' ? a.port : a.end}`} className="flex items-start gap-1">
        <button type="button" className="flex-1 min-w-0 text-left text-sky-300 hover:underline" onClick={onClick}>
          {label}
        </button>
        <button
          type="button"
          title={t('properties.disconnect', { name: label })}
          aria-label={t('properties.disconnect', { name: label })}
          onClick={() => updateDiagram(d => diagramOps.disconnectAttachment(d, node, a, grid, elements))}
          className="shrink-0 p-0.5 rounded text-gray-500 hover:text-red-400 hover:bg-surface-600"
        >
          <ScissorsLineDashed size={12} />
        </button>
      </li>
    )
  }

  return (
    <section>
      <GroupHeader
        label={t('properties.connections')}
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        topic="connections"
      />
      {!collapsed && (
        <div className="space-y-2 text-xs">
          {rows.map(row => {
            const node = nodesById.get(row.node)
            const others = (attachments.get(row.node) ?? []).filter(a => !sameAttachment(a, row.self))
            return (
              <div key={row.key}>
                <div className="text-gray-300">
                  {row.heading} →{' '}
                  {node
                    ? t('properties.connectionNode', { node: node.id, x: node.x, y: node.y })
                    : t('properties.connectionNodeMissing', { node: row.node })}
                </div>
                {others.length > 0 ? (
                  <ul className="pl-3 space-y-0.5">{others.map(a => attachmentLink(row.node, a))}</ul>
                ) : (
                  <div className="pl-3 text-red-400">
                    {t(connector ? 'properties.connectionFreeEnd' : 'properties.connectionNotConnected')}
                  </div>
                )}
              </div>
            )
          })}
          <p className="text-[10px] text-gray-500">{t('properties.connectionsHint')}</p>
        </div>
      )}
    </section>
  )
}
