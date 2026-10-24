import type {
  CIMWarning,
  CustomElement,
  Diagram,
  DiagramWire,
  DiagramEntry,
  ElementSymbol,
  EditorConfig,
  ImportReport,
  ConverterMessage,
  OpenedDiagram,
  PresenceStatus,
  OpenTab,
  UnmatchedVoltage,
  VoltageColor,
} from '../types'
import { stripPictureHrefs } from './picture'

const BASE = '/api'

// A JSON request body, gzip-compressed when the browser can (the backend
// unpacks Content-Encoding: gzip): a large diagram is about ten times smaller
// on the wire, which matters on every render and save over a slow link.
async function jsonBody(method: string, value: unknown): Promise<RequestInit> {
  const json = JSON.stringify(value)
  if (typeof CompressionStream === 'undefined') {
    return { method, headers: { 'Content-Type': 'application/json' }, body: json }
  }
  const body = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob()
  return { method, headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body }
}

async function asJSON<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error((body && body.error) || `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

// The backend serializes a Go nil slice as JSON null; every list field is
// normalized to [] here so the rest of the app never has to null-check them.
function normalizeDiagram(d: DiagramWire): Diagram {
  return {
    ...d,
    layers: d.layers ?? [],
    voltageClasses: d.voltageClasses ?? [],
    nodes: d.nodes ?? [],
    elements: d.elements ?? [],
    connectors: d.connectors ?? [],
    labels: d.labels ?? [],
    digitalDevices: d.digitalDevices ?? [],
    history: d.history ?? undefined,
  }
}

interface DiagramResponse {
  diagram: DiagramWire
  warning?: string
}

/** Lists one directory's immediate contents — dir is a path relative to the
 * server's own diagrams root ("" for the root itself), matching
 * backend/internal/storage.Store.List: subdirectories first, then
 * diagrams. Never recurses — navigating into a subdirectory is a separate
 * call with a deeper dir. */
export async function listDiagrams(dir: string): Promise<DiagramEntry[]> {
  const res = await fetch(`${BASE}/diagrams?dir=${encodeURIComponent(dir)}`)
  return asJSON(res)
}

/** Creates the empty folder dir (POST /api/folders). */
export async function createFolder(dir: string): Promise<void> {
  await asJSON(await fetch(`${BASE}/folders?dir=${encodeURIComponent(dir)}`, { method: 'POST' }))
}

/** Renames or moves a diagram (isDir false) or a folder with its contents (isDir true) from one full path to
 * another; missing folders on the way are created. */
export async function renameEntry(from: string, to: string, isDir: boolean): Promise<void> {
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  await asJSON(await fetch(`${BASE}/${isDir ? 'folders' : 'diagrams'}/rename?${q}`, { method: 'POST' }))
}

/** Deletes a diagram, or an empty folder (isDir true). */
/** Deletes a diagram or an empty folder; the server refuses while a tab other than session has it open. */
export async function deleteEntry(path: string, isDir: boolean, session: string): Promise<void> {
  const q = `${isDir ? 'dir' : 'name'}=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}`
  await asJSON(await fetch(`${BASE}/${isDir ? 'folders' : 'diagrams'}?${q}`, { method: 'DELETE' }))
}

export async function createDiagram(
  name: string,
  width?: number,
  height?: number,
): Promise<{ diagram: Diagram; warning?: string }> {
  const res = await fetch(`${BASE}/diagrams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, width, height }),
  })
  const data = await asJSON<DiagramResponse>(res)
  return { diagram: normalizeDiagram(data.diagram), warning: data.warning }
}

// name (a diagram's full path from the store's own root, e.g.
// "region1/substation-5") travels as a query parameter, not a URL path
// segment — a "/" inside a path *segment* would otherwise need encoding as
// literal %2F, which most servers (Gin included) treat as an ordinary
// character within that one segment rather than a separator, so a
// subdirectory-qualified name could never reach the backend's own :name
// route this way. As a query parameter's value, encodeURIComponent's own
// %2F round-trips back to a real "/" once Go's net/url decodes the query
// string, matching backend/internal/api's own getDiagram/saveDiagram,
// which read name from c.Query, not c.Param.
//
// The server checks the diagram's ids (no topology repair: see repairDiagram)
// and renders it for the canvas in the same request (see OpenedDiagram).
export async function getDiagram(name: string): Promise<OpenedDiagram> {
  const res = await fetch(`${BASE}/diagrams/open?name=${encodeURIComponent(name)}`)
  const data = await asJSON<Omit<OpenedDiagram, 'diagram'> & { diagram: DiagramWire }>(res)
  return { ...data, diagram: normalizeDiagram(data.diagram) }
}

export async function saveDiagram(
  name: string,
  diagram: Diagram,
): Promise<{ diagram: Diagram; warning?: string }> {
  const res = await fetch(`${BASE}/diagrams/save?name=${encodeURIComponent(name)}`, await jsonBody('PUT', diagram))
  const data = await asJSON<DiagramResponse>(res)
  return { diagram: normalizeDiagram(data.diagram), warning: data.warning }
}

/** Repairs a diagram's topology on the server (POST /api/repair: fixed ports, busbar ports, wire splits, ids,
 * preset voltage names) without persisting it; repaired tells whether anything changed. */
export async function repairDiagram(diagram: Diagram): Promise<{ diagram: Diagram; repaired: boolean }> {
  const res = await fetch(`${BASE}/repair`, await jsonBody('POST', diagram))
  const data = await asJSON<{ diagram: DiagramWire; repaired: boolean }>(res)
  return { diagram: normalizeDiagram(data.diagram), repaired: data.repaired }
}

/** Renders a diagram (saved or not) to SVG without persisting it — used for
 * a live canvas preview of in-progress edits. */
export async function renderPreview(diagram: Diagram): Promise<{ svg: string; warning?: string }> {
  const res = await fetch(`${BASE}/render`, await jsonBody('POST', stripPictureHrefs(diagram)))
  return asJSON(res)
}

/** renderPreview's incremental counterpart: given the full diagram (still
 * needed server-side for voltage/topology resolution, which can span ids
 * outside ids itself) and the set of element/connector/label/digital-device
 * ids that actually changed since the canvas's own last successful render,
 * returns only those ids' own fresh markup — keyed by id, JSON's own object
 * keys always strings even though these started as numbers on both ends —
 * for Canvas.tsx to patch its existing DOM nodes in place instead of
 * replacing its whole injected SVG. See backend/internal/slddoc.
 * RenderFragments' own doc comment for the full contract (an id no longer
 * in diagram at all is silently skipped, not an error). */
export async function renderPreviewFragments(
  diagram: Diagram,
  ids: number[],
): Promise<{ fragments: Record<string, string>; warning?: string }> {
  const res = await fetch(`${BASE}/render/fragments`, await jsonBody('POST', { diagram: stripPictureHrefs(diagram), ids }))
  return asJSON(res)
}

/** Renders a diagram (saved or not) to its on-disk XML shape, for the
 * browser to download directly to the user's own machine — not tied to the
 * server's own diagrams directory the way saveDiagram/getDiagram are. */
export async function exportDiagramXML(diagram: Diagram): Promise<string> {
  const res = await fetch(`${BASE}/export/xml`, await jsonBody('POST', diagram))
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error((body && body.error) || `${res.status} ${res.statusText}`)
  }
  return res.text()
}

/** exportDiagramXML's counterpart for the Static-mode SVG (the same
 * rendering the companion .svg Save writes to disk). */
export async function exportDiagramSVG(diagram: Diagram): Promise<string> {
  const res = await fetch(`${BASE}/export/svg`, await jsonBody('POST', diagram))
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error((body && body.error) || `${res.status} ${res.statusText}`)
  }
  return res.text()
}

/** Converts the diagram to CGMES 3.0 (POST /api/export/cim): a zip of the EQ and DL documents, its file
 * name, and what the export filled in or left out. name seeds the mRIDs and names the files. */
export async function exportDiagramCIM(
  diagram: Diagram,
  name: string,
): Promise<{ filename: string; file: Blob; warnings: CIMWarning[] }> {
  const res = await fetch(`${BASE}/export/cim?name=${encodeURIComponent(name)}`, await jsonBody('POST', diagram))
  const out = await asJSON<{ filename: string; file: string; warnings: CIMWarning[] | null }>(res)
  const bytes = Uint8Array.from(atob(out.file), c => c.charCodeAt(0))
  return { filename: out.filename, file: new Blob([bytes], { type: 'application/zip' }), warnings: out.warnings ?? [] }
}

/** Parses a raw .xsld file's own text (loaded from the user's machine, e.g.
 * via a file picker or drag-and-drop) into a Diagram, the same shape
 * getDiagram returns for one opened from the server's own diagrams list. */
export async function importDiagramXML(xmlText: string): Promise<Diagram> {
  const res = await fetch(`${BASE}/import/xml`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xmlText,
  })
  return normalizeDiagram(await asJSON<DiagramWire>(res))
}

// Reconstructs a diagram from a dropped/picked xsde2svg-style .svg
// (slddoc.Extract on the backend), returning Extract's own report of what
// it couldn't capture alongside it.
export async function importDiagramSVG(svgText: string): Promise<{ diagram: Diagram; report: ImportReport }> {
  const res = await fetch(`${BASE}/import/svg`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/svg+xml' },
    body: svgText,
  })
  const data = await asJSON<{ diagram: DiagramWire; report: ImportReport }>(res)
  return { diagram: normalizeDiagram(data.diagram), report: data.report }
}

/** Converts a raw .xsde (Modus) file with xsde2svg and extracts every page (POST /api/import/xsde).
 * Returns the pages that extracted, each with its 1-based number, and the converter's messages. */
export async function importDiagramXSDE(bytes: ArrayBuffer): Promise<{
  pages: { page: number; title: string; diagram: Diagram; report: ImportReport }[]
  messages: ConverterMessage[]
}> {
  const res = await fetch(`${BASE}/import/xsde`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  })
  const data = await asJSON<{
    pages: { page: number; title: string; diagram: DiagramWire; report: ImportReport }[]
    messages: ConverterMessage[] | null
  }>(res)
  return {
    pages: data.pages.map(p => ({ ...p, diagram: normalizeDiagram(p.diagram) })),
    messages: data.messages ?? [],
  }
}

/** Adds presets to the server's voltage_colors, in its configuration file too (POST /api/config/voltage-colors);
 * one whose voltage or name a preset already has is left out. Resolves to the whole list now. */
export async function addVoltageColors(colors: VoltageColor[]): Promise<VoltageColor[]> {
  const res = await fetch(`${BASE}/config/voltage-colors`, await jsonBody('POST', colors))
  const data = await asJSON<{ voltageColors: VoltageColor[] | null }>(res)
  return data.voltageColors ?? []
}

/** Converts a CIM model (a zip of CGMES profiles, or one RDF/XML document) to a diagram per Diagram Layout diagram
 * (POST /api/import/cim), in the shape of importDiagramXSDE's answer plus the voltage classes no server preset
 * names. */
export async function importDiagramCIM(bytes: ArrayBuffer): Promise<{
  pages: { page: number; title: string; diagram: Diagram; report: ImportReport }[]
  messages: ConverterMessage[]
  unmatchedVoltages: UnmatchedVoltage[]
}> {
  const res = await fetch(`${BASE}/import/cim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  })
  const data = await asJSON<{
    pages: { page: number; title: string; diagram: DiagramWire; report: ImportReport }[]
    messages: ConverterMessage[] | null
    unmatchedVoltages: UnmatchedVoltage[] | null
  }>(res)
  return {
    pages: data.pages.map(p => ({ ...p, diagram: normalizeDiagram(p.diagram) })),
    messages: data.messages ?? [],
    unmatchedVoltages: data.unmatchedVoltages ?? [],
  }
}

export async function listElements(): Promise<ElementSymbol[]> {
  const res = await fetch(`${BASE}/elements`)
  return asJSON(res)
}

/** Lists the server's custom elements (see CustomElement), each fully
 * loaded, for the Elements palette's "Custom elements" group. */
export async function listCustomElements(): Promise<CustomElement[]> {
  const res = await fetch(`${BASE}/custom-elements`)
  const data = await asJSON<(Omit<CustomElement, 'diagram'> & { diagram: DiagramWire })[] | null>(res)
  return (data ?? []).map(c => ({ ...c, diagram: normalizeDiagram(c.diagram) }))
}

/** Saves diagram as a custom element named name (a bare file name, no "/")
 * and returns the new palette entry. Throws ConflictError when the name is
 * already taken and overwrite isn't set. */
export async function saveCustomElement(name: string, diagram: Diagram, overwrite: boolean): Promise<CustomElement> {
  const res = await fetch(
    `${BASE}/custom-elements?name=${encodeURIComponent(name)}${overwrite ? '&overwrite=1' : ''}`,
    await jsonBody('PUT', diagram),
  )
  if (res.status === 409) throw new ConflictError(name)
  const data = await asJSON<Omit<CustomElement, 'diagram'> & { diagram: DiagramWire }>(res)
  return { ...data, diagram: normalizeDiagram(data.diagram) }
}

/** Thrown by saveCustomElement when name already exists (HTTP 409). */
export class ConflictError extends Error {
  constructor(name: string) {
    super(`"${name}" already exists`)
    this.name = 'ConflictError'
  }
}

/** The user guide as an HTML fragment (the backend converts the configured
 * Markdown file on every request), in lang when a translation exists
 * (USER_GUIDE.<lang>.md), otherwise the default guide. */
export async function getUserGuide(lang: string): Promise<string> {
  const res = await fetch(`${BASE}/user-guide?lang=${encodeURIComponent(lang)}`)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error((body && body.error) || `${res.status} ${res.statusText}`)
  }
  return res.text()
}

export async function getConfig(): Promise<EditorConfig> {
  const res = await fetch(`${BASE}/config`)
  return asJSON(res)
}

/** A tab's presence heartbeat (POST /api/presence): session is the tab's own random id, diagram the open
 * diagram's name ("" for none). Returns the other tabs on that diagram (IP address, when opened) and its last save. */
export async function touchPresence(session: string, diagram: string): Promise<PresenceStatus> {
  const res = await fetch(`${BASE}/presence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session, diagram }),
  })
  const data = await asJSON<{ others: PresenceStatus['others'] | null; lastSave?: PresenceStatus['lastSave'] }>(res)
  return { others: data.others ?? [], lastSave: data.lastSave }
}

/** Tells the server this tab is closing, so it stops counting as having a diagram open. */
export function leavePresence(session: string) {
  navigator.sendBeacon(
    `${BASE}/presence`,
    new Blob([JSON.stringify({ session, diagram: '' })], { type: 'application/json' }),
  )
}

/** The other tabs (not session) that have the diagram path, or any diagram inside the folder path, open. */
export async function openTabs(path: string, session: string): Promise<OpenTab[]> {
  const res = await fetch(`${BASE}/presence/open?path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}`)
  const data = await asJSON<{ others: OpenTab[] | null }>(res)
  return data.others ?? []
}
