import { useRef, useState } from 'react'
import { ImageIcon } from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import { fitImage, imageSize, uploadTracingImage, useTracingImage } from '../../lib/tracingImage'
import { t } from '../../i18n'
import { GuideButton } from '../GuideButton'
import type { DiagramTracingImage } from '../../types'

const inputClass = 'w-full bg-surface-800 border border-surface-600 rounded px-2 py-1'
const buttonClass = 'flex-1 text-xs rounded border border-surface-600 hover:bg-surface-600 text-gray-200 px-2 py-1'

/** The diagram Properties' tracing image (lib/tracingImage): a picture under the diagram to draw it over, with its
 * position, width (the height keeps its proportions), opacity and visibility. Loading one uploads it to the server
 * at once; it and every change are diagram edits, kept with the diagram when it is saved. */
export function TracingImageSection() {
  const { diagram, diagramName, updateDiagram } = useDiagramContext()
  const image = useTracingImage(diagramName, diagram)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!diagram || !diagramName) return null
  const ref = diagram.tracingImage

  const update = (patch: Partial<DiagramTracingImage>) =>
    updateDiagram(d => (d.tracingImage ? { ...d, tracingImage: { ...d.tracingImage, ...patch } } : d))

  async function load(file: File) {
    setError(false)
    setBusy(true)
    try {
      const url = URL.createObjectURL(file)
      const size = await imageSize(url).finally(() => URL.revokeObjectURL(url))
      const stored = await uploadTracingImage(diagramName!, file)
      updateDiagram(d => ({
        ...d,
        tracingImage: { file: stored, ...fitImage(size, d.width, d.height), opacity: d.tracingImage?.opacity ?? 0.4 },
      }))
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  async function fit() {
    if (!image) return
    update(fitImage(await imageSize(image.href), diagram!.width, diagram!.height))
  }

  const number = (key: 'x' | 'y' | 'width', value: string) => {
    const v = Number(value)
    if (!Number.isFinite(v) || !ref) return
    if (key !== 'width') return update({ [key]: v })
    if (v > 0) update({ width: v, height: (ref.height / ref.width) * v })
  }

  return (
    <div className="space-y-2 rounded border border-surface-600 p-2">
      <div className="flex items-center gap-1.5 text-xs text-gray-300">
        <ImageIcon size={14} />
        <span className="flex-1">{t('tracingImage.title')}</span>
        <GuideButton topic="tracing-image" />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void load(file)
        }}
      />
      <div className="flex gap-2">
        <button type="button" className={buttonClass} disabled={busy} onClick={() => fileRef.current?.click()}>
          {image ? t('tracingImage.replace') : t('tracingImage.load')}
        </button>
        {image && (
          <button type="button" className={buttonClass} onClick={() => updateDiagram(d => ({ ...d, tracingImage: undefined }))}>
            {t('tracingImage.remove')}
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-state-warning">{t('tracingImage.loadError')}</p>}
      {image && (
        <>
          <label className="flex items-center gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={image.visible}
              onChange={e => update({ hidden: e.target.checked ? undefined : true })}
            />
            {t('tracingImage.show')}
          </label>
          <label className="block text-xs">
            <span className="block text-gray-400 mb-1">
              {t('tracingImage.opacity')}: {Math.round(image.opacity * 100)}%
            </span>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={Math.round(image.opacity * 100)}
              onChange={e => update({ opacity: Number(e.target.value) / 100 })}
              className="w-full"
            />
          </label>
          <div className="flex gap-2">
            {(['x', 'y', 'width'] as const).map(key => (
              <label key={key} className="block text-xs flex-1">
                <span className="block text-gray-400 mb-1">{t(`tracingImage.${key}`)}</span>
                <input
                  type="number"
                  className={inputClass}
                  value={Math.round(image[key])}
                  onChange={e => number(key, e.target.value)}
                />
              </label>
            ))}
          </div>
          <button type="button" className={buttonClass + ' w-full'} onClick={() => void fit()}>
            {t('tracingImage.fit')}
          </button>
        </>
      )}
    </div>
  )
}
