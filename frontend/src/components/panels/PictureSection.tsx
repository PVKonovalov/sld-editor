import { useRef, useState } from 'react'
import { imageNaturalSize, readImageFile } from '../../lib/picture'
import { t } from '../../i18n'
import type { DiagramElement } from '../../types'

// A Picture's (shape 11) own Properties: a preview of its image, Choose/
// Replace (read in the browser as a data URI, see lib/picture.ts), and a
// button that resizes the frame to the image's own proportions, keeping its
// top-left corner and width.
export function PictureSection({ el, patch }: { el: DiagramElement; patch: (fields: Partial<DiagramElement>) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    readImageFile(file)
      .then(href => patch({ href }))
      .catch(() => setError(t('properties.pictureReadError')))
  }

  function fitProportions() {
    if (!el.href || !el.points || el.points.length < 2) return
    const [p0, p1] = el.points
    imageNaturalSize(el.href)
      .then(({ width, height }) => {
        if (width <= 0 || height <= 0) return
        const x = Math.min(p0.x, p1.x)
        const y = Math.min(p0.y, p1.y)
        const w = Math.abs(p1.x - p0.x)
        const h = Math.round((w * height) / width)
        patch({ points: [{ x, y }, { x: x + w, y: y + h }], x: x + w / 2, y: y + h / 2 })
      })
      .catch(() => setError(t('properties.pictureReadError')))
  }

  return (
    <div className="space-y-2">
      <span className="block text-xs text-gray-400">{t('properties.pictureImage')}</span>
      {el.href ? (
        <img src={el.href} alt="" className="max-h-32 max-w-full border border-surface-600 rounded" />
      ) : (
        <p className="text-xs text-gray-500">{t('properties.pictureNone')}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 px-2 py-1 text-xs rounded border border-surface-600 hover:bg-surface-600 text-gray-200"
          onClick={() => inputRef.current?.click()}
        >
          {t(el.href ? 'properties.pictureReplace' : 'properties.pictureChoose')}
        </button>
        {el.href && (
          <button
            type="button"
            className="flex-1 px-2 py-1 text-xs rounded border border-surface-600 hover:bg-surface-600 text-gray-200"
            onClick={fitProportions}
          >
            {t('properties.pictureFit')}
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
