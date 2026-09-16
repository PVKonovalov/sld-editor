import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import * as diagramOps from '../../lib/diagramOps'
import { PanelShell } from './PanelShell'
import { t } from '../../i18n'

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { diagram, config, updateEditorSettings, updateDiagram, setDefaultVoltage } = useDiagramContext()
  const [presetName, setPresetName] = useState('')

  const defaults = config?.editor
  const gridSpacing = diagram?.editor?.gridSpacing ?? defaults?.gridSpacing ?? 20
  const snap = diagram?.editor?.snap ?? defaults?.snap ?? true
  const showGrid = diagram?.editor?.showGrid ?? defaults?.showGrid ?? true
  const showNodes = diagram?.editor?.showNodes ?? true
  const background = diagram?.editor?.background ?? defaults?.background ?? '#12161d'
  const disabled = !diagram
  const voltageOptions = diagram ? diagramOps.voltageClassOptions(diagram, config) : []

  function changeDefaultVoltage(rawValue: string) {
    if (!diagram) return
    const { diagram: withClass, voltage } = diagramOps.resolveVoltageSelection(diagram, config, rawValue)
    updateDiagram(() => ({ ...withClass, editor: { ...withClass.editor, defaultVoltage: voltage } }))
    setDefaultVoltage(voltage)
  }

  function addPreset() {
    const preset = config?.voltageColors.find(v => v.name === presetName)
    if (!preset) return
    updateDiagram(d => diagramOps.addVoltageClass(d, preset.name, preset.color))
    setPresetName('')
  }

  return (
    <PanelShell title={t('sidebar.settings')} onClose={onClose}>
      {!diagram && <p className="text-xs text-gray-500 mb-3">{t('settings.noDiagram')}</p>}
      <div className="space-y-3">
        <label className="block text-xs">
          <span className="block text-gray-400 mb-1">{t('settings.gridSpacing')}</span>
          <input
            type="number"
            min={1}
            step={1}
            disabled={disabled}
            value={gridSpacing}
            onChange={e => updateEditorSettings({ gridSpacing: Number(e.target.value) })}
            className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1 disabled:opacity-50"
          />
        </label>

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            disabled={disabled}
            checked={snap}
            onChange={e => updateEditorSettings({ snap: e.target.checked })}
          />
          <span>{t('settings.snapToGrid')}</span>
        </label>

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            disabled={disabled}
            checked={showGrid}
            onChange={e => updateEditorSettings({ showGrid: e.target.checked })}
          />
          <span>{t('settings.showGrid')}</span>
        </label>

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            disabled={disabled}
            checked={showNodes}
            onChange={e => updateEditorSettings({ showNodes: e.target.checked })}
          />
          <span>{t('settings.showNodes')}</span>
        </label>

        <label className="block text-xs">
          <span className="block text-gray-400 mb-1">{t('settings.background')}</span>
          <input
            type="color"
            disabled={disabled}
            value={background}
            onChange={e => updateEditorSettings({ background: e.target.value })}
            className="w-full h-8 bg-surface-800 border border-surface-600 rounded disabled:opacity-50"
          />
        </label>

        {diagram && (
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('settings.defaultVoltage')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={diagram.editor?.defaultVoltage ?? ''}
              onChange={e => changeDefaultVoltage(e.target.value)}
            >
              <option value="">{t('common.none')}</option>
              {voltageOptions.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {diagram && (
          <div>
            <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('settings.voltageClasses')}</h3>

            {diagram.voltageClasses.length === 0 && (
              <p className="text-xs text-gray-500 mb-2">{t('settings.noVoltageClasses')}</p>
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
                  <button
                    type="button"
                    aria-label={t('settings.deleteVoltageClass')}
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
                  <option value="">{t('settings.pickVoltage')}</option>
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
                  {t('settings.addVoltageClass')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </PanelShell>
  )
}
