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

/** t()'s counterpart for a key built at runtime from server-provided data
 * (see lib/elementCatalogI18n.ts) rather than a literal known at compile
 * time — falls back to `fallback` unchanged when the active dictionary has
 * no such key, for data (e.g. a site's own config-added element library
 * file) this app's own translations were never expected to cover. */
export function tOrFallback(key: string, fallback: string, params?: Record<string, string | number>): string {
  if (!Object.prototype.hasOwnProperty.call(dictionary, key)) return fallback
  return t(key as TranslationKey, params)
}
