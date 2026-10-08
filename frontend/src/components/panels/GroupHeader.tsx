import { ChevronDown, ChevronRight } from 'lucide-react'
import { GuideButton } from '../GuideButton'

// A collapsible group's own collapse/expand toggle — shared by the Elements
// panel's palette groups and the Properties panel's diagram-level Layers/
// Voltage classes groups. Expanded state isn't
// persisted anywhere (plain component state): every group starts collapsed
// and it resets to that the next time the panel itself mounts, which is
// fine for a session-only UI convenience like this. A topic (user guide
// heading id) adds a "?" after the label, outside the toggle button.
export function GroupHeader({
  label,
  collapsed,
  onToggle,
  topic,
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
  topic?: string
}) {
  const toggle = (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1 w-full text-xs uppercase tracking-wide text-gray-400 mb-1 hover:text-gray-200"
    >
      {collapsed ? <ChevronRight size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
      <span>{label}</span>
    </button>
  )
  if (!topic) return toggle
  return (
    <div className="flex items-start gap-1">
      {toggle}
      <GuideButton topic={topic} size={13} className="mt-px" />
    </div>
  )
}
