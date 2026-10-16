// The open diagram's name in the page address (?diagram=folder/name), so a
// reload, a bookmark or a link opens it again.

const PARAM = 'diagram'

/** The diagram the page address names, or null. */
export function diagramFromAddress(): string | null {
  return new URLSearchParams(window.location.search).get(PARAM) || null
}

/** Puts name in the page address (null removes it), replacing the current
 * history entry. "/" is left readable. */
export function setDiagramAddress(name: string | null) {
  const params = new URLSearchParams(window.location.search)
  params.delete(PARAM)
  let search = params.toString()
  if (name) search += `${search ? '&' : ''}${PARAM}=${encodeURIComponent(name).replace(/%2F/g, '/')}`
  const url = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, '', url)
  }
}
