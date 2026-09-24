import { Folder, Boxes, Settings as SettingsIcon, SlidersHorizontal, Info, type LucideIcon } from 'lucide-react'
import { t } from '../i18n'

export type PanelId = 'file' | 'elements' | 'settings' | 'properties'

const ITEMS: { id: PanelId; icon: LucideIcon; label: string }[] = [
  { id: 'file', icon: Folder, label: t('sidebar.file') },
  { id: 'elements', icon: Boxes, label: t('sidebar.elements') },
  { id: 'settings', icon: SettingsIcon, label: t('sidebar.settings') },
  { id: 'properties', icon: SlidersHorizontal, label: t('sidebar.properties') },
]

interface Props {
  // File/Elements/Settings share one slot (at most one open at a time);
  // Properties docks on the opposite side of the canvas and can be open
  // at the same time as one of them, so its own state is tracked
  // separately rather than folded into a single "active panel" value.
  activeLeftPanel: Exclude<PanelId, 'properties'> | null
  propertiesOpen: boolean
  onPanelToggle: (id: PanelId) => void
  // Opens the About dialog (program icon, name, version).
  onAbout: () => void
}

export function Sidebar({ activeLeftPanel, propertiesOpen, onPanelToggle, onAbout }: Props) {
  return (
    <aside className="flex flex-col items-center w-12 shrink-0 h-full bg-surface-800 border-r border-surface-600 py-2 gap-1 z-20">
      {ITEMS.map(({ id, icon: Icon, label }) => {
        const active = id === 'properties' ? propertiesOpen : activeLeftPanel === id
        return (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={() => onPanelToggle(id)}
            className={`flex items-center justify-center w-9 h-9 rounded transition-colors ${
              active ? 'bg-accent text-white' : 'text-gray-300 hover:bg-surface-600 hover:text-white'
            }`}
          >
            <Icon size={18} />
          </button>
        )
      })}
      <button
        type="button"
        title={t('sidebar.about')}
        aria-label={t('sidebar.about')}
        onClick={onAbout}
        className="mt-auto flex items-center justify-center w-9 h-9 rounded transition-colors text-gray-300 hover:bg-surface-600 hover:text-white"
      >
        <Info size={18} />
      </button>
    </aside>
  )
}
