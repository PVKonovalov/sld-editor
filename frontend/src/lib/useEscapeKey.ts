import { useEffect, useRef } from 'react'

/** Calls onEscape on Escape while enabled. The listener is added once: re-adding it on every render would drop an
 * Escape whose earlier window listener (the canvas's) re-renders the caller mid-dispatch. */
export function useEscapeKey(onEscape: () => void, enabled = true) {
  const handler = useRef(onEscape)
  const on = useRef(enabled)
  useEffect(() => {
    handler.current = onEscape
    on.current = enabled
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && on.current) handler.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
