// Translates the bundled backend/assets/elements/base.xml catalog's own
// name strings and config.Config.Palette's own group names (plain English
// strings, not i18n keys — see /api/elements and /api/config) for display,
// via the elementCatalog.name.<shape>/elementCatalog.category.<name>
// dictionary keys in i18n/en.ts and ru.ts (a group's own name reuses the
// "category" key prefix an ElementSymbol's now-removed category attribute
// used to, including for the two built-in "Wires"/"Text" groups, not just
// equipment ones). Falls back to the raw string for anything with no such
// key: a site's own config-added element library file (elements.libraries
// in config), or a palette group name it invented — this app's own
// translations only ever cover the bundled defaults.
import { tOrFallback } from '../i18n'
import type { ElementSymbol } from '../types'

export function elementDisplayName(symbol: Pick<ElementSymbol, 'shape' | 'name'>): string {
  return tOrFallback(`elementCatalog.name.${symbol.shape}`, symbol.name)
}

export function categoryDisplayName(groupName: string): string {
  return tOrFallback(`elementCatalog.category.${groupName}`, groupName)
}
