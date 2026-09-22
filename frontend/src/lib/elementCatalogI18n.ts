// Translates the bundled backend/assets/elements/base.xml catalog's own
// name/category strings (plain English XML attributes, not i18n keys —
// see /api/elements) for display, via the elementCatalog.name.<shape>/
// elementCatalog.category.<category> dictionary keys in i18n/en.ts and
// ru.ts. Falls back to the raw string from the server for anything from a
// site's own config-added element library file (elements.libraries in
// config), which has no such key and isn't expected to — this app's own
// translations only ever cover the bundled default catalog.
import { tOrFallback } from '../i18n'
import type { ElementSymbol } from '../types'

export function elementDisplayName(symbol: Pick<ElementSymbol, 'shape' | 'name'>): string {
  return tOrFallback(`elementCatalog.name.${symbol.shape}`, symbol.name)
}

export function categoryDisplayName(category: string): string {
  return tOrFallback(`elementCatalog.category.${category}`, category)
}
