import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Gap kept between a freshly placed dialog and the viewport edges, in pixels. */
const VIEWPORT_MARGIN = 16

export interface DialogSize {
  width: number
  height: number
  minWidth: number
  minHeight: number
}

/**
 * A floating, non-modal window: dragged by whatever gets `dragHandleProps`
 * (its header) and resized by whatever gets `resizeHandleProps` (a corner
 * grip, our own mouse handling rather than CSS `resize`, which is unreliable
 * in Safari next to a scrollbar). It starts centered (clamped into the
 * viewport) and is pinned to an explicit top-left corner right after the
 * first render, so later size changes grow it from that corner instead of
 * re-centering it. Same approach as sld-viewer's hook of this name.
 */
export function useDraggableDialog(initial: DialogSize) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState(() => ({
    width: Math.min(initial.width, window.innerWidth - 2 * VIEWPORT_MARGIN),
    height: Math.min(initial.height, window.innerHeight - 2 * VIEWPORT_MARGIN),
  }))
  const gesture = useRef<{ kind: 'drag' | 'resize'; x: number; y: number; a: number; b: number } | null>(null)
  const { minWidth, minHeight } = initial

  useLayoutEffect(() => {
    if (pos !== null) return
    setPos({
      x: Math.max(VIEWPORT_MARGIN, (window.innerWidth - size.width) / 2),
      y: Math.max(VIEWPORT_MARGIN, (window.innerHeight - size.height) / 2),
    })
  }, [pos, size])

  const onMove = useCallback(
    (e: MouseEvent) => {
      const g = gesture.current
      if (!g) return
      const dx = e.clientX - g.x
      const dy = e.clientY - g.y
      if (g.kind === 'drag') {
        // Keep the header reachable: never drag it above the viewport.
        setPos({ x: g.a + dx, y: Math.max(0, g.b + dy) })
      } else {
        setSize({ width: Math.max(minWidth, g.a + dx), height: Math.max(minHeight, g.b + dy) })
      }
    },
    [minWidth, minHeight],
  )

  const onUp = useCallback(() => {
    gesture.current = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }, [onMove])

  useEffect(
    () => () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    },
    [onMove, onUp],
  )

  function begin(kind: 'drag' | 'resize', e: React.MouseEvent) {
    const rect = dialogRef.current?.getBoundingClientRect()
    if (!rect || e.button !== 0) return
    e.preventDefault()
    gesture.current =
      kind === 'drag'
        ? { kind, x: e.clientX, y: e.clientY, a: rect.left, b: rect.top }
        : { kind, x: e.clientX, y: e.clientY, a: rect.width, b: rect.height }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const style: React.CSSProperties = {
    left: pos?.x ?? VIEWPORT_MARGIN,
    top: pos?.y ?? VIEWPORT_MARGIN,
    width: size.width,
    height: size.height,
    minWidth,
    minHeight,
  }

  return {
    dialogRef,
    style,
    dragHandleProps: {
      onMouseDown: (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button, input')) return // let header controls click through
        begin('drag', e)
      },
    },
    resizeHandleProps: {
      onMouseDown: (e: React.MouseEvent) => {
        e.stopPropagation()
        begin('resize', e)
      },
    },
  }
}
