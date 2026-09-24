// A diagram's own "name" (DiagramContext's diagramName, the string passed
// to api.getDiagram/saveDiagram/createDiagram) is a full "/"-separated path
// relative to the server's own diagrams root, e.g. "region1/substation-5" —
// matching backend/internal/storage's own name convention exactly (see its
// safeName doc comment). These pure helpers are the only place that
// splits/joins one, shared between DiagramContext (deciding which folder to
// browse after an open/save) and FilePanel (building a new diagram's own
// full name from the folder currently browsed plus a typed leaf name).

/** The folder a path's own diagram lives in — "" for one at the store's own
 * root, matching DiagramEntry's own root-relative dir convention. */
export function parentDir(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

/** The leaf segment of a path — the complement of parentDir, matching the
 * `name` a DiagramEntry for it carries in its own folder's listing. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Joins a (possibly root, "") directory with a leaf name into a full path
 * — the inverse of parentDir. name may itself carry further "/" segments
 * (typing "sub/name" into a New/Save As field nests deeper than dir alone
 * would), so this is a plain string join, not a single-segment append. */
export function joinDiagramPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}
