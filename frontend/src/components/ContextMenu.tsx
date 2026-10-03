import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

export interface ContextMenuItem {
  label: string
  // Not called for an item with children: hovering it opens its submenu.
  onSelect?: () => void
  disabled?: boolean
  // A submenu, shown to the right while this item is hovered.
  children?: ContextMenuItem[]
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

const MENU_CLASS = 'min-w-[10rem] rounded border border-surface-600 bg-surface-700 py-1 shadow-lg'
const ITEM_CLASS =
  'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-surface-600 disabled:text-gray-500 disabled:hover:bg-transparent'

/** A small right-click menu positioned at (x, y) in viewport coordinates.
 * A full-viewport transparent backdrop behind it closes it on any outside
 * click, matching the usual "click away to dismiss" convention. An item
 * with children opens them as a submenu beside it on hover. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} onContextMenu={e => e.preventDefault()} />
      <div className={`fixed z-40 ${MENU_CLASS}`} style={{ left: x, top: y }}>
        <MenuItems items={items} onClose={onClose} />
      </div>
    </>
  )
}

function MenuItems({ items, onClose }: { items: ContextMenuItem[]; onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      {items.map(item => (
        <div
          key={item.label}
          className="relative"
          onMouseEnter={() => setOpen(item.children ? item.label : null)}
          onMouseLeave={() => setOpen(o => (o === item.label ? null : o))}
        >
          <button
            type="button"
            disabled={item.disabled}
            onClick={() => {
              if (item.children) {
                setOpen(item.label)
                return
              }
              item.onSelect?.()
              onClose()
            }}
            className={ITEM_CLASS}
          >
            <span>{item.label}</span>
            {item.children && <ChevronRight size={12} className="shrink-0" />}
          </button>
          {item.children && open === item.label && !item.disabled && (
            <div className={`absolute left-full top-0 -mt-1 ${MENU_CLASS}`}>
              <MenuItems items={item.children} onClose={onClose} />
            </div>
          )}
        </div>
      ))}
    </>
  )
}
