import { useEffect } from 'react'
import { useDiagramContext } from '../state/useDiagramContext'
import { t } from '../i18n'
import { GuideButton } from './GuideButton'

/** Shown after opening or importing a diagram whose device connection points lie off their terminals
 * (DiagramContext.misplacedPorts): lists each device and port with how far off it is. Move snaps them onto the
 * terminals, the buswork ends on them following (one undoable edit; the devices stay put); Leave as is (also Esc
 * or a backdrop click) keeps them, each still fixable by dragging its amber wire-end handle. */
export function MisplacedPortsDialog() {
  const { diagram, misplacedPorts, fixMisplacedPorts, dismissMisplacedPorts } = useDiagramContext()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') dismissMisplacedPorts()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dismissMisplacedPorts])

  if (!diagram) return null
  const names = new Map(diagram.elements.map(e => [e.id, e.name || `${e.class} #${e.id}`]))
  const most = Math.max(...misplacedPorts.map(p => p.distance))

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/50" onClick={dismissMisplacedPorts} />
      <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-[26rem] max-h-[80vh] overflow-y-auto rounded border border-surface-600 bg-surface-700 p-4 shadow-lg space-y-3 text-xs">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">
              {t('misplacedPorts.title')}
              <GuideButton topic="editing-wire" />
            </h2>
            <p className="text-gray-400 mt-1">
              {t('misplacedPorts.message', { count: misplacedPorts.length, distance: Math.round(most) })}
            </p>
          </div>
          <ul className="space-y-0.5 max-h-48 overflow-y-auto">
            {misplacedPorts.map(p => (
              <li key={`${p.elementId}-${p.port}`} className="flex items-center gap-2">
                <span className="flex-1 text-gray-100 truncate">
                  {t('misplacedPorts.port', { name: names.get(p.elementId) ?? '', port: p.port })}
                </span>
                <span className="text-gray-400 tabular-nums">{Math.round(p.distance * 10) / 10}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={dismissMisplacedPorts}
              className="px-3 py-1 rounded border border-surface-600 hover:bg-surface-600 text-gray-200"
            >
              {t('misplacedPorts.leave')}
            </button>
            <button
              type="button"
              autoFocus
              onClick={fixMisplacedPorts}
              className="px-3 py-1 rounded bg-accent hover:bg-accent-hover text-white"
            >
              {t('misplacedPorts.move')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
