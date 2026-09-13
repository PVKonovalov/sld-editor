import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  /** Which edge of the canvas this panel is docked against — only affects
   * which side carries the divider border. Defaults to 'left' (File,
   * Elements, Settings, docked next to the icon rail); Properties docks on
   * the right instead, next to whatever is selected on the canvas. */
  side?: 'left' | 'right'
}

export function PanelShell({ title, onClose, children, side = 'left' }: Props) {
  return (
    <div
      className={`w-72 shrink-0 h-full bg-surface-700 flex flex-col ${
        side === 'right' ? 'border-l border-surface-600' : 'border-r border-surface-600'
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-600">
        <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="text-gray-400 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-sm text-gray-200">{children}</div>
    </div>
  )
}
