import { BookOpen, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDraggableDialog } from '../hooks/useDraggableDialog'
import * as api from '../lib/api'
import { locale, t } from '../i18n'

interface Props {
  /** Heading id to scroll to. requestId changes on every request, so asking
   * for the same topic again scrolls (and highlights) again. */
  topic?: string
  requestId: number
  onClose: () => void
}

interface TocEntry {
  id: string
  text: string
  level: number
}

// The guide's HTML, fetched once per page load (the backend re-reads the
// Markdown on every request; seeing an edited guide needs a page reload).
let guideCache: string | null = null

/** The user guide window (sidebar Help button, "?" topic buttons in dialogs
 * and panels): non-modal, draggable and resizable, so it can stay open
 * beside the canvas and the dialog it explains. A filterable table of
 * contents built from the rendered h2/h3 headings sits beside the text;
 * picking an entry or a topic scrolls to it with a brief highlight. "#id"
 * links inside the guide scroll within it. The HTML (GET /api/user-guide,
 * goldmark with raw HTML disabled) is safe to inject; styled by
 * .guide-content (styles/index.css). Ported from sld-viewer's GuideWindow. */
export function GuideWindow({ topic, requestId, onClose }: Props) {
  const { dialogRef, style, dragHandleProps, resizeHandleProps } = useDraggableDialog({
    width: 960,
    height: 680,
    minWidth: 520,
    minHeight: 320,
  })
  const [html, setHtml] = useState<string | null>(guideCache)
  const [error, setError] = useState<string | null>(null)
  const [toc, setToc] = useState<TocEntry[]>([])
  const [filter, setFilter] = useState('')
  const [current, setCurrent] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (guideCache !== null) return
    let cancelled = false
    api
      .getUserGuide(locale)
      .then(h => {
        guideCache = h
        if (!cancelled) setHtml(h)
      })
      .catch(e => !cancelled && setError((e as Error).message))
    return () => {
      cancelled = true
    }
  }, [])

  // Table of contents from the rendered headings.
  useEffect(() => {
    const root = contentRef.current
    if (!root || html === null) {
      setToc([])
      return
    }
    setToc(
      [...root.querySelectorAll<HTMLHeadingElement>('h2[id], h3[id]')].map(h => ({
        id: h.id,
        text: h.textContent ?? '',
        level: h.tagName === 'H2' ? 2 : 3,
      })),
    )
  }, [html])

  function scrollTo(id: string) {
    const el = contentRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)
    const box = scrollRef.current
    if (!el || !box) return
    // Only the text pane scrolls (scrollIntoView could also shift the window).
    box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8
    el.classList.remove('guide-topic-highlight')
    void el.offsetWidth // restart the animation
    el.classList.add('guide-topic-highlight')
    setCurrent(id)
  }

  // Scroll to the requested topic once the document is rendered.
  useEffect(() => {
    if (html === null) return
    if (topic) scrollTo(topic)
    else scrollRef.current?.scrollTo({ top: 0 })
  }, [html, topic, requestId])

  // Keep the table of contents' highlight on the section being read.
  function handleScroll() {
    const box = scrollRef.current?.getBoundingClientRect()
    const root = contentRef.current
    if (!box || !root) return
    let id: string | null = null
    for (const h of root.querySelectorAll<HTMLElement>('h2[id], h3[id]')) {
      if (h.getBoundingClientRect().top - box.top > 16) break
      id = h.id
    }
    setCurrent(id)
  }

  function handleContentClick(e: React.MouseEvent<HTMLDivElement>) {
    const href = (e.target as HTMLElement).closest('a')?.getAttribute('href')
    if (!href) return
    if (href.startsWith('#')) {
      e.preventDefault()
      scrollTo(decodeURIComponent(href.slice(1)))
    } else {
      // Anything else leaves the editor: open it in a new tab instead.
      e.preventDefault()
      window.open(href, '_blank', 'noopener')
    }
  }

  const q = filter.trim().toLowerCase()
  const visibleToc = q ? toc.filter(entry => entry.text.toLowerCase().includes(q)) : toc

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={t('help.title')}
      style={style}
      className="fixed z-[70] flex flex-col overflow-hidden rounded-lg border border-surface-500 bg-surface-700 shadow-2xl"
    >
      <div
        {...dragHandleProps}
        className="flex items-center justify-between gap-3 px-4 py-2 shrink-0 border-b border-surface-600 cursor-move select-none"
      >
        <div className="flex items-center gap-2 text-accent">
          <BookOpen size={16} />
          <h2 className="text-sm font-semibold text-gray-100">{t('help.title')}</h2>
        </div>
        <button
          type="button"
          title={t('common.close')}
          aria-label={t('common.close')}
          onClick={onClose}
          className="p-1 rounded text-gray-400 hover:bg-surface-600 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        <nav className="w-60 shrink-0 flex flex-col min-h-0 border-r border-surface-600">
          <input
            className="m-2 bg-surface-800 border border-surface-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-accent"
            placeholder={t('help.filterPlaceholder')}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <ul className="flex-1 overflow-y-auto px-1 pb-2 text-xs">
            {visibleToc.map(entry => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => scrollTo(entry.id)}
                  className={`w-full text-left py-1 pr-2 rounded hover:bg-surface-600 hover:text-white ${
                    entry.level === 2 ? 'pl-2 font-medium' : 'pl-5'
                  } ${
                    entry.id === current
                      ? 'bg-surface-600 text-white'
                      : entry.level === 2
                        ? 'text-gray-200'
                        : 'text-gray-400'
                  }`}
                >
                  {entry.text}
                </button>
              </li>
            ))}
            {html !== null && visibleToc.length === 0 && (
              <li className="px-2 py-1 text-gray-500">{t('help.noMatches')}</li>
            )}
          </ul>
        </nav>
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-w-0 overflow-y-auto px-6 py-4">
          {error ? (
            <p className="text-xs text-red-400">{t('help.loadError', { error })}</p>
          ) : html === null ? (
            <p className="text-xs text-gray-400">{t('help.loading')}</p>
          ) : (
            <div
              ref={contentRef}
              className="guide-content"
              onClick={handleContentClick}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>

      <div
        {...resizeHandleProps}
        className="absolute bottom-0 right-0 w-4 h-4 flex items-end justify-end pb-0.5 pr-0.5 cursor-nwse-resize text-gray-500 hover:text-gray-300"
      >
        <svg width="9" height="9" viewBox="0 0 9 9" className="pointer-events-none">
          <path d="M8 1L1 8" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 4.3L4.3 8" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 7.6L7.6 8" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </div>
    </div>
  )
}
