import { ChevronDown, ChevronRight } from 'lucide-react'

// A collapsible group's own collapse/expand toggle — shared by the Elements
// panel's palette groups and the Properties panel's diagram-level Layers/
// Voltage classes groups. Expanded state isn't
// persisted anywhere (plain component state): every group starts collapsed
// and it resets to that the next time the panel itself mounts, which is
// fine for a session-only UI convenience like this.
export function GroupHeader({ label, collapsed, onToggle }: { label: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1 w-full text-xs uppercase tracking-wide text-gray-400 mb-1 hover:text-gray-200"
    >
      {collapsed ? <ChevronRight size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
      <span>{label}</span>
    </button>
  )
}
