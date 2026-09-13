export interface ContextMenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/** A small right-click menu positioned at (x, y) in viewport coordinates.
 * A full-viewport transparent backdrop behind it closes it on any outside
 * click, matching the usual "click away to dismiss" convention. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} onContextMenu={e => e.preventDefault()} />
      <div
        className="fixed z-40 min-w-[10rem] rounded border border-surface-600 bg-surface-700 py-1 shadow-lg"
        style={{ left: x, top: y }}
      >
        {items.map(item => (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect()
              onClose()
            }}
            className="block w-full px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-surface-600 disabled:text-gray-500 disabled:hover:bg-transparent"
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}
