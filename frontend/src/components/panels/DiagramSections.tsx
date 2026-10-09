import { useState } from 'react'
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import * as diagramOps from '../../lib/diagramOps'
import { GroupHeader } from './GroupHeader'
import { t } from '../../i18n'

// The Properties panel's diagram-level groups (shown when nothing is
// selected): the open diagram's own <layers> and <voltageClasses>, each
// collapsible and starting collapsed (see GroupHeader).

/** Add/rename/delete the diagram's layers, with how many objects sit on
 * each. The base layer (diagramOps.BASE_LAYER) can be renamed but not
 * deleted; deleting any other layer moves its objects to the base layer
 * (diagramOps.removeLayer). Each layer also has a show/hide toggle (a view
 * preference for this session, DiagramContext's hiddenLayers) and a Z, its
 * drawing order (higher layers draw over lower ones). "New items go on"
 * sets editor.activeLayer. */
export function LayersSection() {
  const { diagram, updateDiagram, updateEditorSettings, hiddenLayers, setLayerHidden } = useDiagramContext()
  const [collapsed, setCollapsed] = useState(true)
  if (!diagram) return null
  const usage = diagramOps.layerUsage(diagram)
  const active = diagramOps.defaultLayer(diagram)

  return (
    <section>
      <GroupHeader
        label={`${t('diagram.layers')} (${diagram.layers.length})`}
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        topic="layers"
      />
      {!collapsed && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className="w-5 shrink-0" />
            <span className="flex-1">{t('diagram.layerName')}</span>
            <span className="w-11 shrink-0 text-center" title={t('diagram.layerZHint')}>
              {t('diagram.layerZ')}
            </span>
            <span className="w-8 shrink-0 text-right" title={t('diagram.usage')}>
              #
            </span>
            <span className="w-[13px] shrink-0" />
          </div>
          {diagram.layers.map(layer => {
            const isBase = layer.id === diagramOps.BASE_LAYER
            const hidden = hiddenLayers.has(layer.id)
            return (
              <div key={layer.id} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={!hidden}
                  aria-label={hidden ? t('diagram.showLayer') : t('diagram.hideLayer')}
                  title={hidden ? t('diagram.showLayer') : t('diagram.hideLayer')}
                  onClick={() => setLayerHidden(layer.id, !hidden)}
                  className={`w-5 shrink-0 flex justify-center ${hidden ? 'text-gray-600' : 'text-gray-300'} hover:text-white`}
                >
                  {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <input
                  type="text"
                  aria-label={t('diagram.layerName')}
                  title={t('diagram.layerId', { id: layer.id })}
                  value={layer.name}
                  onChange={e => updateDiagram(d => diagramOps.updateLayer(d, layer.id, { name: e.target.value }))}
                  className={`flex-1 min-w-0 bg-surface-800 border border-surface-600 rounded px-1.5 py-1 text-xs ${hidden ? 'text-gray-500' : ''}`}
                />
                <input
                  type="number"
                  aria-label={t('diagram.layerZ')}
                  title={t('diagram.layerZHint')}
                  value={layer.z ?? 0}
                  onChange={e => {
                    const z = Math.trunc(Number(e.target.value)) || 0
                    updateDiagram(d => diagramOps.updateLayer(d, layer.id, { z: z === 0 ? undefined : z }))
                  }}
                  className="w-11 shrink-0 bg-surface-800 border border-surface-600 rounded px-1 py-1 text-xs tabular-nums"
                />
                <span className="w-8 shrink-0 text-right text-xs text-gray-400 tabular-nums" title={t('diagram.usage')}>
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
          <label className="block text-xs pt-1">
            <span className="block text-gray-400 mb-1">{t('diagram.activeLayer')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={active}
              onChange={e => {
                const id = Number(e.target.value)
                updateEditorSettings({ activeLayer: id === diagramOps.BASE_LAYER ? undefined : id })
              }}
            >
              {diagram.layers.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name || l.id}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </section>
  )
}

/** Edit the diagram's voltage classes (color, name, delete), with how many
 * elements/connectors use each (diagramOps.voltageUsage), add one from the
 * server's voltage presets, and "Match preset colors": reopens the voltage
 * dialog (DefaultVoltageDialog) on the classes whose color is close to a
 * preset (diagramOps.voltageColorMatches). */
export function VoltageClassesSection() {
  const { diagram, config, updateDiagram, setDefaultVoltagePromptOpen } = useDiagramContext()
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
        topic="layers"
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
                {config.voltageColors
                  .filter(v => !diagram.voltageClasses.some(vc => vc.name.trim().toLowerCase() === v.name.trim().toLowerCase()))
                  .map(v => (
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

          {config && config.voltageColors.length > 0 && (
            <button
              type="button"
              disabled={diagramOps.voltageColorMatches(diagram, config).length === 0}
              title={t('diagram.matchPresetColorsHint')}
              onClick={() => setDefaultVoltagePromptOpen(true)}
              className="mt-1 w-full px-2 py-1 text-xs rounded bg-surface-600 text-gray-200 hover:bg-surface-500 disabled:opacity-50"
            >
              {t('diagram.matchPresetColors')}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
