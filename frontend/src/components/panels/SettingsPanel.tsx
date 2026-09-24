import { useDiagramContext } from '../../state/useDiagramContext'
import * as diagramOps from '../../lib/diagramOps'
import { PanelShell } from './PanelShell'
import { t } from '../../i18n'

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { diagram, config, updateEditorSettings, updateDiagram, setDefaultVoltage } = useDiagramContext()

  const defaults = config?.editor
  const gridSpacing = diagram?.editor?.gridSpacing ?? defaults?.gridSpacing ?? 10
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
      </div>
    </PanelShell>
  )
}
