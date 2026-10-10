import { t } from '../i18n'
import type { ConverterMessage } from '../types'

const LEVEL_CLASS: Record<ConverterMessage['level'], string> = {
  ERROR: 'text-red-400',
  WARN: 'text-yellow-300',
  INFO: 'text-gray-400',
}

/** xsde2svg's diagnostics for an .xsde import, errors first, with page numbers when they span several pages. */
export function ConverterMessages({ messages }: { messages: ConverterMessage[] }) {
  if (messages.length === 0) return <p className="text-gray-500">{t('importLog.none')}</p>
  const showPage = new Set(messages.map(m => m.page)).size > 1
  const rank = { ERROR: 0, WARN: 1, INFO: 2 }
  const sorted = [...messages].sort((a, b) => rank[a.level] - rank[b.level] || a.page - b.page)
  return (
    <ul className="space-y-0.5">
      {sorted.map((m, i) => (
        <li key={i} className="flex gap-2">
          <span className={`w-16 shrink-0 ${LEVEL_CLASS[m.level] ?? 'text-gray-400'}`}>{t(`converter.${m.level}`)}</span>
          {showPage && (
            <span className="w-12 shrink-0 text-gray-500 tabular-nums">
              {m.page > 0 ? t('converter.page', { page: m.page }) : ''}
            </span>
          )}
          <span className="flex-1 min-w-0 text-gray-100 break-words">{m.text}</span>
        </li>
      ))}
    </ul>
  )
}
