import { dictionary } from './en'

// Pinned to en.ts's key set: adding a second locale (a sibling dictionary
// typed as `Record<TranslationKey, string>`) is a compile error until every
// key here has a translation, rather than a silent runtime fallback.
export type TranslationKey = keyof typeof dictionary

/** Looks up `key` in the active dictionary, substituting any `{{param}}` placeholders. */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const template = dictionary[key]
  if (!params) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name] ?? `{{${name}}}`))
}
