import { useEffect, useState } from 'react'
import { TriangleAlert, Users } from 'lucide-react'
import { useDiagramContext } from '../state/useDiagramContext'
import * as api from '../lib/api'
import { formatTimestamp } from '../lib/revision'
import type { PresenceStatus } from '../types'
import { t } from '../i18n'

// How often a tab tells the server which diagram it has open; the server
// forgets a tab after 150 s (backend api.presenceTTL).
const HEARTBEAT_MS = 60_000

// This tab's presence id (crypto.randomUUID needs a secure context, which a
// plain-http LAN install isn't). Kept across Vite hot reloads, which would
// otherwise leave the old id listed until the server forgets it.
const session: string =
  import.meta.hot?.data.session ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
if (import.meta.hot) import.meta.hot.data.session = session

/** "10.0.3.41 since 10:15 (2), 10.0.3.57 since 10:32": one entry per IP address, with its earliest
 * opening time and how many tabs it has open; others is already in opening order. */
function joinOthers(others: PresenceStatus['others']): string {
  const byIp = new Map<string, { since: string; count: number }>()
  for (const o of others) {
    const seen = byIp.get(o.ip)
    if (seen) seen.count++
    else byIp.set(o.ip, { since: o.since, count: 1 })
  }
  return [...byIp]
    .map(([ip, { since, count }]) => {
      const params = { ip, time: formatTimestamp(since), count }
      return count > 1 ? t('presence.sinceTabs', params) : t('presence.since', params)
    })
    .join(', ')
}

/** A one-line amber warning at the top of the screen when other tabs have the open diagram too, or
 * when someone saved it after this tab opened or last saved it. */
export function PresenceBanner() {
  const { diagramName, savedHistory } = useDiagramContext()
  const [status, setStatus] = useState<PresenceStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const beat = () =>
      api
        .touchPresence(session, diagramName ?? '')
        .then(st => !cancelled && setStatus(st))
        .catch(() => !cancelled && setStatus(null))
    setStatus(null)
    void beat()
    if (!diagramName) return () => void (cancelled = true)
    const timer = setInterval(beat, HEARTBEAT_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [diagramName])

  useEffect(() => {
    const leave = () => api.leavePresence(session)
    window.addEventListener('pagehide', leave)
    return () => window.removeEventListener('pagehide', leave)
  }, [])

  if (!diagramName || !status) return null
  const base = savedHistory[savedHistory.length - 1]?.time
  const lastSave = status.lastSave
  const stale = lastSave && (!base || Date.parse(lastSave.time) > Date.parse(base))
  let text: string
  let hint: string
  if (stale) {
    text = t('presence.savedBy', { ip: lastSave.ip || '?', time: formatTimestamp(lastSave.time) })
    hint = t('presence.savedByHint')
  } else if (status.others.length > 0) {
    text = t('presence.openBy', { ips: joinOthers(status.others) })
    hint = t('presence.openByHint')
  } else return null

  const Icon = stale ? TriangleAlert : Users
  return (
    <div
      role="status"
      title={`${text}\n${hint}`}
      className="absolute top-2 left-1/2 -translate-x-1/2 z-40 max-w-[min(90%,48rem)] flex items-center gap-2 rounded-md border border-[#7a6230] bg-[#2b2416]/95 px-3 py-1.5 text-xs text-[#e6a83c] shadow"
    >
      <Icon size={14} className="shrink-0" />
      <span className="truncate">{text}</span>
    </div>
  )
}
