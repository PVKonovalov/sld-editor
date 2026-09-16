import { dictionary } from './active'
import type { Dictionary } from './active'

// Pinned to en.ts's own key set (./active always re-exports Dictionary
// from ./en, the canonical dictionary, regardless of which locale's
// runtime values are active — see generate-active-locale.mjs): a locale
// dictionary (ru.ts, typed as `Record<TranslationKey, string>`) missing a
// translation for a key added here is a compile error, not a silent
// runtime fallback.
export type TranslationKey = keyof Dictionary

/** Looks up `key` in the active dictionary, substituting any `{{param}}` placeholders. */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const template = dictionary[key]
  if (!params) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name] ?? `{{${name}}}`))
}
