import { useState } from 'react'
import { Grid3x3 } from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import * as diagramOps from '../../lib/diagramOps'
import { t } from '../../i18n'
import { GuideButton } from '../GuideButton'

/** The diagram Properties' "Snap to grid" command: moves every element,
 * wire and connection point onto the nearest point of the diagram's grid
 * (diagramOps.snapDiagramToGrid), keeping connections, as one undo step.
 * Uses the grid spacing even when Settings' Snap to grid is off. Labels and
 * digital devices stay where they are. */
export function SnapToGridSection() {
  const { diagram, updateDiagram, elements, config } = useDiagramContext()
  const [result, setResult] = useState<string | null>(null)
  if (!diagram) return null
  const grid = diagram.editor?.gridSpacing ?? config?.editor.gridSpacing ?? 10

  function snap() {
    const r = diagramOps.snapDiagramToGrid(diagram!, grid, elements)
    if (r.diagram !== diagram) updateDiagram(() => r.diagram)
    setResult(r.moved > 0 ? t('properties.snapToGridDone', { count: r.moved }) : t('properties.snapToGridNone'))
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          title={t('properties.snapToGridHint', { grid })}
          onClick={snap}
          className="flex flex-1 items-center justify-center gap-1.5 px-2 py-1 text-xs rounded bg-surface-600 text-gray-200 hover:bg-surface-500"
        >
          <Grid3x3 size={14} />
          {t('properties.snapToGrid')}
        </button>
        <GuideButton topic="snap-to-grid" />
      </div>
      {result && <p className="text-[11px] text-gray-500">{result}</p>}
    </div>
  )
}
