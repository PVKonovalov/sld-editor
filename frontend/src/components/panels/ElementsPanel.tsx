import { useMemo, useState, type ReactNode } from 'react'
import { Type, Gauge } from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import { hotKeyByItem, usePaletteToggle } from '../../state/usePaletteToggle'
import { PanelShell } from './PanelShell'
import { GroupHeader } from './GroupHeader'
import { t, type TranslationKey } from '../../i18n'
import { elementIconMarkup } from '../../lib/elementIcon'
import { WIRE_KIND_ICONS } from '../../lib/wireKindIcon'
import { classifyPaletteItem } from '../../lib/paletteItem'
import { customElementIconMarkup } from '../../lib/customElementIcon'
import { categoryDisplayName, elementDisplayName } from '../../lib/elementCatalogI18n'
import type { CustomElement, ElementSymbol } from '../../types'

// The "Custom elements" group's own expand/collapse key — not a
// config.palette group (those come from the server config), so it can't
// collide with one's own name.
const CUSTOM_GROUP_KEY = '\u0000custom'

// Labels for the "Wires" group's own buttons/hint text ('BusbarWire' was
// removed as a palette entry — see wireKindIcon.ts's own doc comment).
const WIRE_KIND_LABELS: Record<'BusWork' | 'OverheadLine' | 'CableLine' | 'LinkToObject', TranslationKey> = {
  BusWork: 'connectorKind.BusWork',
  OverheadLine: 'connectorKind.OverheadLine',
  CableLine: 'connectorKind.CableLine',
  LinkToObject: 'connectorKind.LinkToObject',
}

// One palette button — shared by every PaletteItem kind (wireKind/special/
// element), so the click-to-arm styling only needs to be written once.
function PaletteButton({
  title,
  label,
  icon,
  active,
  disabled,
  onClick,
  hotKey,
}: {
  title: string
  label: string
  icon: ReactNode
  active: boolean
  disabled: boolean
  onClick: () => void
  // Its placement hot key (config hot_keys), shown in the tooltip and as a
  // badge in the corner.
  hotKey?: string
}) {
  return (
    <button
      type="button"
      title={hotKey ? `${title} (${hotKey.toUpperCase()})` : title}
      disabled={disabled}
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-1 aspect-square rounded border p-[3.6px] text-[10px] disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? 'border-accent bg-accent/20 text-white'
          : 'border-surface-600 bg-surface-800 text-gray-300 hover:border-surface-500'
      }`}
    >
      {hotKey && (
        <kbd className="absolute top-0.5 right-0.5 rounded bg-surface-600 px-1 text-[9px] leading-tight text-gray-300 font-sans">
          {hotKey.toUpperCase()}
        </kbd>
      )}
      {icon}
      <span className="line-clamp-2 text-center leading-tight">{label}</span>
    </button>
  )
}

function customElementIcon(custom: CustomElement) {
  return <span className="shrink-0" dangerouslySetInnerHTML={{ __html: customElementIconMarkup(custom, 28) }} />
}

function wireKindIcon(kind: keyof typeof WIRE_KIND_ICONS) {
  return <svg viewBox="-32 -32 64 64" width={28} height={28} className="shrink-0" dangerouslySetInnerHTML={{ __html: WIRE_KIND_ICONS[kind] }} />
}

function elementIcon(el: ElementSymbol) {
  return <svg viewBox="-32 -32 64 64" width={28} height={28} className="shrink-0" dangerouslySetInnerHTML={{ __html: elementIconMarkup(el) }} />
}

export function ElementsPanel({ onClose }: { onClose: () => void }) {
  const {
    elements,
    config,
    diagram,
    armedSymbol,
    armedWireKind,
    armedLabel,
    armedDigitalDevice,
    customElements,
    armedCustomElement,
    armCustomElement,
  } = useDiagramContext()

  const elementsByShape = useMemo(() => {
    const m = new Map<string, ElementSymbol>()
    for (const el of elements) m.set(el.shape, el)
    return m
  }, [elements])

  const groups = config?.palette ?? []
  const togglePaletteItem = usePaletteToggle()
  const hotKeys = useMemo(() => hotKeyByItem(config?.hotKeys), [config])

  // Keyed by each PaletteGroup's own name — tracks which groups are
  // expanded rather than which are collapsed, so every group defaults to
  // collapsed (empty set) without having to know the full list of group
  // names up front (they only exist once `config` has loaded from the
  // backend). Collapsing a group doesn't touch armedSymbol/armedWireKind/
  // etc. themselves, so an element already armed from a group that then
  // gets collapsed stays armed (and its own hint text above keeps
  // showing), same as any other panel state.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const toggleGroup = (key: string) =>
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <PanelShell title={t('sidebar.elements')} onClose={onClose} topic="placing">
      {groups.length === 0 && <p className="text-xs text-gray-500">{t('elements.empty')}</p>}
      {diagram && (
        <p className="text-xs text-gray-400 mb-2">
          {armedSymbol
            ? t('elements.armedHint', { name: elementDisplayName(armedSymbol) })
            : armedWireKind
              ? t('elements.wireArmedHint', { name: t(WIRE_KIND_LABELS[armedWireKind as keyof typeof WIRE_KIND_LABELS]) })
              : armedLabel
                ? t('elements.labelArmedHint')
                : armedDigitalDevice
                  ? t('elements.digitalDeviceArmedHint')
                  : armedCustomElement
                    ? t('elements.customArmedHint', { name: armedCustomElement.name })
                    : t('elements.pickHint')}
        </p>
      )}
      <div className="space-y-3">
        {groups.map(group => (
          <div key={group.name}>
            <GroupHeader
              label={categoryDisplayName(group.name)}
              topic={group.name === 'Wires' ? 'wiring' : undefined}
              collapsed={!expandedGroups.has(group.name)}
              onToggle={() => toggleGroup(group.name)}
            />
            {expandedGroups.has(group.name) && (
              <div className="grid grid-cols-3 gap-1">
                {group.items.map(item => {
                  const classified = classifyPaletteItem(item)

                  if (classified.kind === 'wireKind') {
                    const kind = classified.value as keyof typeof WIRE_KIND_LABELS
                    const active = armedWireKind === kind
                    const label = t(WIRE_KIND_LABELS[kind])
                    return (
                      <PaletteButton
                        key={item}
                        title={label}
                        label={label}
                        icon={wireKindIcon(kind)}
                        active={active}
                        disabled={!diagram}
                        onClick={() => togglePaletteItem(item)}
                        hotKey={hotKeys.get(item)}
                      />
                    )
                  }

                  if (classified.kind === 'special') {
                    if (classified.value === 'label') {
                      return (
                        <PaletteButton
                          key={item}
                          title={t('elements.text')}
                          label={t('elements.text')}
                          icon={<Type size={20} className="shrink-0" />}
                          active={armedLabel}
                          disabled={!diagram}
                          onClick={() => togglePaletteItem(item)}
                          hotKey={hotKeys.get(item)}
                        />
                      )
                    }
                    return (
                      <PaletteButton
                        key={item}
                        title={t('elements.digitalDevice')}
                        label={t('elements.digitalDevice')}
                        icon={<Gauge size={20} className="shrink-0" />}
                        active={armedDigitalDevice}
                        disabled={!diagram}
                        onClick={() => togglePaletteItem(item)}
                        hotKey={hotKeys.get(item)}
                      />
                    )
                  }

                  // An element PaletteItem always resolves — the backend
                  // validates every shape reference against the loaded
                  // element libraries at startup (elements.ValidatePalette)
                  // — but a config predating that check, or hand-edited
                  // afterward, could still be stale, so this stays
                  // defensive rather than assuming.
                  const el = elementsByShape.get(classified.shape)
                  if (!el) return null
                  const active = armedSymbol?.shape === el.shape
                  const label = elementDisplayName(el)
                  return (
                    <PaletteButton
                      key={item}
                      title={label}
                      label={label}
                      icon={elementIcon(el)}
                      active={active}
                      disabled={!diagram}
                      onClick={() => togglePaletteItem(item)}
                      hotKey={hotKeys.get(item)}
                    />
                  )
                })}
              </div>
            )}
          </div>
        ))}
        {customElements.length > 0 && (
          <div>
            <GroupHeader
              label={t('elements.customGroup')}
              topic="custom-elements"
              collapsed={!expandedGroups.has(CUSTOM_GROUP_KEY)}
              onToggle={() => toggleGroup(CUSTOM_GROUP_KEY)}
            />
            {expandedGroups.has(CUSTOM_GROUP_KEY) && (
              <div className="grid grid-cols-3 gap-1">
                {customElements.map(custom => {
                  const active = armedCustomElement?.name === custom.name
                  return (
                    <PaletteButton
                      key={custom.name}
                      title={custom.name}
                      label={custom.name}
                      icon={customElementIcon(custom)}
                      active={active}
                      disabled={!diagram}
                      onClick={() => armCustomElement(active ? null : custom)}
                    />
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </PanelShell>
  )
}
