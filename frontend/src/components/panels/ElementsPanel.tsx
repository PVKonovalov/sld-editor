import { useMemo } from 'react'
import { useDiagramContext } from '../../state/useDiagramContext'
import { PanelShell } from './PanelShell'
import { t } from '../../i18n'
import { elementIconMarkup } from '../../lib/elementIcon'
import type { ElementSymbol } from '../../types'

export function ElementsPanel({ onClose }: { onClose: () => void }) {
  const { elements, diagram, armedSymbol, armSymbol } = useDiagramContext()

  const groups = useMemo(() => {
    const byCategory = new Map<string, ElementSymbol[]>()
    for (const el of elements) {
      const key = el.category || t('elements.uncategorized')
      const list = byCategory.get(key) ?? []
      list.push(el)
      byCategory.set(key, list)
    }
    return Array.from(byCategory.entries())
  }, [elements])

  return (
    <PanelShell title={t('sidebar.elements')} onClose={onClose}>
      {groups.length === 0 && <p className="text-xs text-gray-500">{t('elements.empty')}</p>}
      {diagram && (
        <p className="text-xs text-gray-400 mb-2">
          {armedSymbol ? t('elements.armedHint', { name: armedSymbol.name }) : t('elements.pickHint')}
        </p>
      )}
      <div className="space-y-3">
        {groups.map(([category, items]) => (
          <div key={category}>
            <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{category}</h3>
            <div className="grid grid-cols-3 gap-1">
              {items.map(el => {
                const active = armedSymbol?.shape === el.shape
                return (
                  <button
                    key={el.shape}
                    type="button"
                    title={el.name}
                    disabled={!diagram}
                    onClick={() => armSymbol(active ? null : el)}
                    className={`flex flex-col items-center justify-center gap-1 aspect-square rounded border p-1 text-[10px] disabled:opacity-40 disabled:cursor-not-allowed ${
                      active
                        ? 'border-accent bg-accent/20 text-white'
                        : 'border-surface-600 bg-surface-800 text-gray-300 hover:border-surface-500'
                    }`}
                  >
                    <svg
                      viewBox="-32 -32 64 64"
                      width={28}
                      height={28}
                      className="shrink-0"
                      dangerouslySetInnerHTML={{ __html: elementIconMarkup(el) }}
                    />
                    <span className="line-clamp-2 text-center leading-tight">{el.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  )
}
