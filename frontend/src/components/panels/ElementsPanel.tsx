import { useMemo } from 'react'
import { Type, Gauge } from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import { PanelShell } from './PanelShell'
import { t, type TranslationKey } from '../../i18n'
import { elementIconMarkup } from '../../lib/elementIcon'
import { WIRE_KIND_ICONS, WIRE_KINDS } from '../../lib/wireKindIcon'
import type { ElementSymbol } from '../../types'

// Labels for WIRE_KINDS' own palette buttons/hint text ('BusbarWire' was
// removed as a palette entry — see wireKindIcon.ts's own doc comment).
const WIRE_KIND_LABELS: Record<'BusWork' | 'OverheadLine' | 'CableLine', TranslationKey> = {
  BusWork: 'connectorKind.BusWork',
  OverheadLine: 'connectorKind.OverheadLine',
  CableLine: 'connectorKind.CableLine',
}

export function ElementsPanel({ onClose }: { onClose: () => void }) {
  const {
    elements,
    diagram,
    armedSymbol,
    armSymbol,
    armedWireKind,
    armWireKind,
    armedLabel,
    armLabel,
    armedDigitalDevice,
    armDigitalDevice,
  } = useDiagramContext()

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
          {armedSymbol
            ? t('elements.armedHint', { name: armedSymbol.name })
            : armedWireKind
              ? t('elements.wireArmedHint', { name: t(WIRE_KIND_LABELS[armedWireKind as keyof typeof WIRE_KIND_LABELS]) })
              : armedLabel
                ? t('elements.labelArmedHint')
                : armedDigitalDevice
                  ? t('elements.digitalDeviceArmedHint')
                  : t('elements.pickHint')}
        </p>
      )}
      <div className="space-y-3">
        <div>
          <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('elements.wires')}</h3>
          <div className="grid grid-cols-3 gap-1">
            {WIRE_KINDS.map(kind => {
              const active = armedWireKind === kind
              return (
                <button
                  key={kind}
                  type="button"
                  title={t(WIRE_KIND_LABELS[kind])}
                  disabled={!diagram}
                  onClick={() => armWireKind(active ? null : kind)}
                  className={`flex flex-col items-center justify-center gap-1 aspect-square rounded border p-[3.6px] text-[10px] disabled:opacity-40 disabled:cursor-not-allowed ${
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
                    dangerouslySetInnerHTML={{ __html: WIRE_KIND_ICONS[kind] }}
                  />
                  <span className="line-clamp-2 text-center leading-tight">{t(WIRE_KIND_LABELS[kind])}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{t('elements.text')}</h3>
          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              title={t('elements.text')}
              disabled={!diagram}
              onClick={() => armLabel(!armedLabel)}
              className={`flex flex-col items-center justify-center gap-1 aspect-square rounded border p-[3.6px] text-[10px] disabled:opacity-40 disabled:cursor-not-allowed ${
                armedLabel
                  ? 'border-accent bg-accent/20 text-white'
                  : 'border-surface-600 bg-surface-800 text-gray-300 hover:border-surface-500'
              }`}
            >
              <Type size={20} className="shrink-0" />
              <span className="line-clamp-2 text-center leading-tight">{t('elements.text')}</span>
            </button>
            <button
              type="button"
              title={t('elements.digitalDevice')}
              disabled={!diagram}
              onClick={() => armDigitalDevice(!armedDigitalDevice)}
              className={`flex flex-col items-center justify-center gap-1 aspect-square rounded border p-[3.6px] text-[10px] disabled:opacity-40 disabled:cursor-not-allowed ${
                armedDigitalDevice
                  ? 'border-accent bg-accent/20 text-white'
                  : 'border-surface-600 bg-surface-800 text-gray-300 hover:border-surface-500'
              }`}
            >
              <Gauge size={20} className="shrink-0" />
              <span className="line-clamp-2 text-center leading-tight">{t('elements.digitalDevice')}</span>
            </button>
          </div>
        </div>
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
                    className={`flex flex-col items-center justify-center gap-1 aspect-square rounded border p-[3.6px] text-[10px] disabled:opacity-40 disabled:cursor-not-allowed ${
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
