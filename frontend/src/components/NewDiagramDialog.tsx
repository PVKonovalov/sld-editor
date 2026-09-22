import { useState } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import { joinDiagramPath } from '../lib/diagramPath'
import { t } from '../i18n'

/** A centered modal (backdrop click or Esc dismisses, matching
 * ContextMenu's own "click away to close" convention) collecting
 * everything File > New needs beyond a bare name: the diagram's own size
 * and its default voltage level, both otherwise easy to forget to set
 * until well into placing elements. Default voltage is one of the
 * server's voltage-color presets (same list Settings' own "Voltage
 * classes" picker offers) — DiagramProvider's newDiagram turns the chosen
 * preset into the diagram's first VoltageClass and its own
 * editor.defaultVoltage. */
export function NewDiagramDialog({ onClose }: { onClose: () => void }) {
  const { newDiagram, config, currentDir } = useDiagramContext()
  const [name, setName] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [defaultVoltageName, setDefaultVoltageName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await newDiagram(
        joinDiagramPath(currentDir, name.trim()),
        width ? Number(width) : undefined,
        height ? Number(height) : undefined,
        defaultVoltageName || undefined,
      )
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-80 rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3">
          <h2 className="text-sm font-semibold text-gray-100">{t('file.newDiagramTitle')}</h2>
          {currentDir && <p className="text-[11px] text-gray-500">{t('file.creatingIn', { dir: currentDir })}</p>}

          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('file.name')}</span>
            <input
              autoFocus
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              placeholder={t('file.namePlaceholder')}
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
          </label>

          <div className="flex gap-2">
            <label className="block text-xs flex-1">
              <span className="block text-gray-400 mb-1">{t('file.width')}</span>
              <input
                type="number"
                min={1}
                placeholder="2000"
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={width}
                onChange={e => setWidth(e.target.value)}
              />
            </label>
            <label className="block text-xs flex-1">
              <span className="block text-gray-400 mb-1">{t('file.height')}</span>
              <input
                type="number"
                min={1}
                placeholder="1200"
                className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                value={height}
                onChange={e => setHeight(e.target.value)}
              />
            </label>
          </div>

          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">{t('file.defaultVoltage')}</span>
            <select
              className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
              value={defaultVoltageName}
              onChange={e => setDefaultVoltageName(e.target.value)}
            >
              <option value="">{t('common.none')}</option>
              {config?.voltageColors.map(v => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
            <span className="block text-gray-500 mt-1">{t('file.defaultVoltageHint')}</span>
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-xs rounded border border-surface-600 text-gray-300 hover:bg-surface-600"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={submit}
              className="px-3 py-1 text-xs rounded bg-accent hover:bg-accent-hover disabled:opacity-50 text-white"
            >
              {t('file.create')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
