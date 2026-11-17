import { useCallback, useEffect, useRef, useState } from 'react'

const OVERSCAN = 8

/** Renders only the visible rows of a fixed-row-height list. Put `ref` and `onScroll` on the scrolling element and
 * render rows [start, end) between spacers of `padTop` and `padBottom` pixels. scrollToIndex brings a row into view.
 * The scroll position survives the element being hidden (display: none resets it).
 * @param count number of rows
 * @param rowHeight height of every row, px */
export function useVirtualRows(count: number, rowHeight: number) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(0)
  const lastTop = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    setHeight(el.clientHeight)
    const ro = new ResizeObserver(() => {
      setHeight(el.clientHeight)
      if (el.clientHeight > 0 && el.scrollTop !== lastTop.current) el.scrollTop = lastTop.current
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el || el.clientHeight === 0) return
    lastTop.current = el.scrollTop
    setScrollTop(el.scrollTop)
  }, [])

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = ref.current
      if (!el || index < 0) return
      const top = index * rowHeight
      if (top < el.scrollTop || top + rowHeight > el.scrollTop + el.clientHeight) {
        el.scrollTop = Math.max(0, top - el.clientHeight / 2)
        lastTop.current = el.scrollTop
        setScrollTop(el.scrollTop)
      }
    },
    [rowHeight],
  )

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN)
  const end = Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + OVERSCAN)
  return {
    ref,
    onScroll,
    scrollToIndex,
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (count - end) * rowHeight),
  }
}
