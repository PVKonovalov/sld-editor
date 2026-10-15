import { locale } from '../i18n'

/** Formats an RFC 3339 time in the build's locale: just the time for today, date and time otherwise. */
export function formatTimestamp(time: string): string {
  const d = new Date(time)
  const today = d.toDateString() === new Date().toDateString()
  return today
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
}
