import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import * as diagramOps from '../../lib/diagramOps'
import { GroupHeader } from './GroupHeader'
import { t } from '../../i18n'

// The Properties panel's diagram-level groups (shown when nothing is
// selected): the open diagram's own <layers> and <voltageClasses>, each
// collapsible and starting collapsed (see GroupHeader).

/** Add/rename/delete the diagram's visibility layers, with how many
 * objects sit on each. The base layer (diagramOps.BASE_LAYER) can be
 * renamed but not deleted; deleting any other layer moves its objects to
 * the base layer (diagramOps.removeLayer). */
export function LayersSection() {
  const { diagram, updateDiagram } = useDiagramContext()
  const [collapsed, setCollapsed] = useState(true)
  if (!diagram) return null
  const usage = diagramOps.layerUsage(diagram)

  return (
    <section>
      <GroupHeader
        label={`${t('diagram.layers')} (${diagram.layers.length})`}
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
      />
      {!collapsed && (
        <div className="space-y-1">
          {diagram.layers.map(layer => {
            const isBase = layer.id === diagramOps.BASE_LAYER
            return (
              <div key={layer.id} className="flex items-center gap-1">
                <span className="w-8 shrink-0 text-[11px] text-gray-500 tabular-nums truncate" title={String(layer.id)}>
                  {layer.id}
                </span>
                <input
                  type="text"
                  aria-label={t('diagram.layerName')}
                  value={layer.name}
                  onChange={e => updateDiagram(d => diagramOps.updateLayer(d, layer.id, { name: e.target.value }))}
                  className="flex-1 min-w-0 bg-surface-800 border border-surface-600 rounded px-1.5 py-1 text-xs"
                />
                <span className="w-10 shrink-0 text-right text-xs text-gray-400 tabular-nums" title={t('diagram.usage')}>
                  {usage.get(layer.id) ?? 0}
                </span>
                <button
                  type="button"
                  disabled={isBase}
                  aria-label={t('diagram.deleteLayer')}
                  title={isBase ? t('diagram.baseLayer') : t('diagram.deleteLayer')}
                  onClick={() => updateDiagram(d => diagramOps.removeLayer(d, layer.id))}
                  className="text-red-400 hover:text-red-300 disabled:opacity-30 disabled:hover:text-red-400 shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
          <button
            type="button"
            onClick={() => updateDiagram(d => diagramOps.addLayer(d, t('diagram.newLayer')))}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-accent hover:bg-accent-hover text-white"
          >
            <Plus size={13} />
            {t('diagram.addLayer')}
          </button>
        </div>
      )}
    </section>
  )
}

/** Edit the diagram's voltage classes (color, name, delete), with how many
 * elements/connectors use each (diagramOps.voltageUsage), and add one from
 * the server's voltage presets. */
export function VoltageClassesSection() {
  const { diagram, config, updateDiagram } = useDiagramContext()
  const [collapsed, setCollapsed] = useState(true)
  const [presetName, setPresetName] = useState('')
  if (!diagram) return null
  const usage = diagramOps.voltageUsage(diagram)

  function addPreset() {
    const preset = config?.voltageColors.find(v => v.name === presetName)
    if (!preset) return
    updateDiagram(d => diagramOps.addVoltageClass(d, preset.name, preset.color))
    setPresetName('')
  }

  return (
    <section>
      <GroupHeader
        label={`${t('diagram.voltageClasses')} (${diagram.voltageClasses.length})`}
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
      />
      {!collapsed && (
        <div>
          {diagram.voltageClasses.length === 0 && (
            <p className="text-xs text-gray-500 mb-2">{t('diagram.noVoltageClasses')}</p>
          )}

          <div className="space-y-1 mb-2">
            {diagram.voltageClasses.map(vc => (
              <div key={vc.id} className="flex items-center gap-1">
                <input
                  type="color"
                  value={vc.color}
                  onChange={e => updateDiagram(d => diagramOps.updateVoltageClass(d, vc.id, { color: e.target.value }))}
                  className="w-6 h-6 shrink-0 bg-surface-800 border border-surface-600 rounded"
                />
                <input
                  type="text"
                  value={vc.name}
                  onChange={e => updateDiagram(d => diagramOps.updateVoltageClass(d, vc.id, { name: e.target.value }))}
                  className="flex-1 min-w-0 bg-surface-800 border border-surface-600 rounded px-1.5 py-1 text-xs"
                />
                <span className="w-10 shrink-0 text-right text-xs text-gray-400 tabular-nums" title={t('diagram.usage')}>
                  {usage.get(vc.id) ?? 0}
                </span>
                <button
                  type="button"
                  aria-label={t('diagram.deleteVoltageClass')}
                  title={t('diagram.deleteVoltageClass')}
                  onClick={() => updateDiagram(d => diagramOps.removeVoltageClass(d, vc.id))}
                  className="text-red-400 hover:text-red-300 shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          {config && config.voltageColors.length > 0 && (
            <div className="flex gap-1">
              <select
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
                className="flex-1 min-w-0 bg-surface-800 border border-surface-600 rounded px-1.5 py-1 text-xs"
              >
                <option value="">{t('diagram.pickVoltage')}</option>
                {config.voltageColors.map(v => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!presetName}
                onClick={addPreset}
                className="px-2 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white shrink-0"
              >
                {t('diagram.addVoltageClass')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
