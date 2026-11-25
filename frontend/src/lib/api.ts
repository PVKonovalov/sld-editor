import type {
  Binding,
  ProviderScheme,
  SchemeCandidate,
  ExportCheck,
  ExportRequest,
  ExportResult,
  SVGExportResult,
  SchemeBindings,
  SchemeGroup,
  SchemeType,
  SchemeRef,
  SchemeTree,
  BindingDictionaries,
  BindingResolved,
  BindingResolveResult,
  BindingNode,
  BindingObject,
  BindingSearchResult,
  BindingSection,
  CIMWarning,
  CustomElement,
  Diagram,
  DiagramWire,
  DesignationPlan,
  DesignationFormat,
  DiagramEntry,
  ElementSymbol,
  EditorConfig,
  FetchedScheme,
  ImportReport,
  ConverterMessage,
  OpenedDiagram,
  PresenceStatus,
  OpenTab,
  UnmatchedVoltage,
  CimHeader,
  CimLayoutKind,
  CimSameVoltageTransformer,
  VoltageColor,
} from '../types'
import { stripPictureHrefs } from './picture'
import { t } from '../i18n'

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
    if (body && body.linkedTo) throw new Error(t('schemes.linkedElsewhere', { name: body.linkedTo }))
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
  scheme?: SchemeRef,
): Promise<{ diagram: Diagram; warning?: string }> {
  const res = await fetch(`${BASE}/diagrams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, width, height, scheme }),
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

/** Saves diagram as name; from, for Save As, is its old name, whose tracing image the server copies along. */
export async function saveDiagram(
  name: string,
  diagram: Diagram,
  from?: string,
): Promise<{ diagram: Diagram; warning?: string }> {
  const query = `name=${encodeURIComponent(name)}${from ? `&from=${encodeURIComponent(from)}` : ''}`
  const res = await fetch(`${BASE}/diagrams/save?${query}`, await jsonBody('PUT', diagram))
  const data = await asJSON<DiagramResponse>(res)
  return { diagram: normalizeDiagram(data.diagram), warning: data.warning }
}

/** Stores image as the tracing image of the existing diagram name (PUT /diagrams/tracing-image), replacing its
 * earlier one; resolves to its file name, which the diagram references once saved. */
export async function uploadTracingImage(name: string, image: Blob): Promise<string> {
  const res = await fetch(`${BASE}/diagrams/tracing-image?name=${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': image.type || 'application/octet-stream' },
    body: image,
  })
  return (await asJSON<{ file: string }>(res)).file
}

/** The URL of diagram name's tracing image; version changes it after an upload, so the browser reloads it. */
export function tracingImageUrl(name: string, version: number): string {
  return `${BASE}/diagrams/tracing-image?name=${encodeURIComponent(name)}&v=${version}`
}

/** Proposes reference designations for the diagram's equipment (POST /api/designations): the element ids in scope
 * (empty: all), renumbering the ones already designated when renumber; the short format numbers each letter code
 * across the diagram. Changes nothing. */
export async function planDesignations(
  diagram: Diagram,
  scope: number[],
  renumber: boolean,
  format: DesignationFormat,
): Promise<DesignationPlan> {
  const res = await fetch(`${BASE}/designations`, await jsonBody('POST', { diagram, scope, renumber, format }))
  const plan = await asJSON<DesignationPlan>(res)
  return { functions: plan.functions ?? [], rows: plan.rows ?? [], unplaced: plan.unplaced ?? [], levels: plan.levels ?? [] }
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
 * replacing its whole injected SVG. See slddoc.RenderFragments' own doc
 * comment for the full contract (an id no longer
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

/** Converts a CIM model (a zip of CGMES profiles, or one RDF/XML document) to a diagram per Diagram Layout diagram,
 * or with auto (or no layout in it) a diagram per substation laid out automatically (POST /api/import/cim), in the
 * shape of importDiagramXSDE's answer plus the voltage classes no server preset names, whose layout the pages follow
 * (this editor's export, another tool's, or none) and the layout document's header (who exported it). windings gives transformer ends (by mRID) their voltage in kV ({} keeps the model's);
 * without it, a model with transformers whose windings all have one voltage answers only sameVoltageTransformers,
 * with no pages, to be asked and posted again. */
export async function importDiagramCIM(
  bytes: ArrayBuffer,
  opts: { auto?: boolean; windings?: Record<string, number> } = {},
): Promise<{
  pages: { page: number; title: string; diagram: Diagram; report: ImportReport }[]
  messages: ConverterMessage[]
  unmatchedVoltages: UnmatchedVoltage[]
  layout: CimLayoutKind
  source: CimHeader | null
  sameVoltageTransformers: CimSameVoltageTransformer[]
}> {
  const query = new URLSearchParams()
  if (opts.auto) query.set('layout', 'auto')
  if (opts.windings) query.set('windings', JSON.stringify(opts.windings))
  const res = await fetch(`${BASE}/import/cim${query.size ? `?${query}` : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  })
  const data = await asJSON<{
    pages: { page: number; title: string; diagram: DiagramWire; report: ImportReport }[]
    messages: ConverterMessage[] | null
    unmatchedVoltages: UnmatchedVoltage[] | null
    layout?: CimLayoutKind
    source?: CimHeader | null
    sameVoltageTransformers: CimSameVoltageTransformer[] | null
  }>(res)
  return {
    pages: (data.pages ?? []).map(p => ({ ...p, diagram: normalizeDiagram(p.diagram) })),
    messages: data.messages ?? [],
    unmatchedVoltages: data.unmatchedVoltages ?? [],
    layout: data.layout ?? '',
    source: data.source ?? null,
    sameVoltageTransformers: data.sameVoltageTransformers ?? [],
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

/** The SCADA binding provider's reference lists (GET /api/bindings/dictionaries); refresh re-reads them from its
 * data source. */
export async function getBindingDictionaries(refresh = false): Promise<BindingDictionaries> {
  const res = await fetch(`${BASE}/bindings/dictionaries${refresh ? '?refresh=1' : ''}`)
  return asJSON(res)
}

/** The provider's top-level object tree (GET /api/bindings/sections). */
export async function getBindingSections(): Promise<BindingSection[]> {
  const res = await fetch(`${BASE}/bindings/sections`)
  return asJSON(res)
}

/** The catalog tree of a section (BindingSection.section) (GET /api/bindings/catalog). */
export async function getBindingCatalog(section: string): Promise<BindingNode[]> {
  const res = await fetch(`${BASE}/bindings/catalog?section=${encodeURIComponent(section)}`)
  return asJSON(res)
}

/** The objects listed under catalog node node of section (GET /api/bindings/list). */
export async function getBindingList(section: string, node: string): Promise<BindingObject[]> {
  const res = await fetch(
    `${BASE}/bindings/list?section=${encodeURIComponent(section)}&node=${encodeURIComponent(node)}`,
  )
  return asJSON(res)
}

/** Catalog nodes and objects of section whose name contains q, case-insensitively (GET /api/bindings/search). */
export async function searchBindings(section: string, q: string, limit?: number): Promise<BindingSearchResult> {
  const params = new URLSearchParams({ section, q })
  if (limit) params.set('limit', String(limit))
  const res = await fetch(`${BASE}/bindings/search?${params}`)
  return asJSON(res)
}

/** The object ref with the binding kind and option the provider suggests for it. */
export async function resolveBinding(ref: string): Promise<BindingResolved> {
  const res = await fetch(`${BASE}/bindings/object?${new URLSearchParams({ ref })}`)
  return asJSON(res)
}

/** Every ref resolved at once: the objects found, and the refs that don't exist or can't be bound. */
export async function resolveBindings(refs: string[]): Promise<BindingResolveResult> {
  const res = await fetch(`${BASE}/bindings/objects`, await jsonBody('POST', { refs }))
  return asJSON(res)
}

/** The path of a provider object from its tree's root down to the object. */
export async function bindingPath(ref: string): Promise<{ ref: string; name: string }[]> {
  const body: { path: { ref: string; name: string }[] | null } = await asJSON(
    await fetch(`${BASE}/bindings/path?ref=${encodeURIComponent(ref)}`),
  )
  return body.path ?? []
}

/** The bindings the provider proposes for binding object ref to an element automatically (none when it proposes
 * nothing for that object). */
export async function suggestBindings(ref: string, element: { shape: string; class: string }): Promise<Binding[]> {
  const res = await fetch(`${BASE}/bindings/suggest`, await jsonBody('POST', { ref, element }))
  const body: { bindings: Binding[] } = await asJSON(res)
  return body.bindings ?? []
}

/** The provider's scheme groups and schemes, each scheme with the diagram linked to it (GET /api/bindings/schemes). */
export async function listSchemes(): Promise<SchemeTree> {
  const tree: SchemeTree = await asJSON(await fetch(`${BASE}/bindings/schemes`))
  return { groups: tree.groups ?? [], schemes: tree.schemes ?? [] }
}

/** What an export of the saved diagram name would do and what stops it. */
export async function checkExport(name: string, register = false): Promise<ExportCheck> {
  const q = `name=${encodeURIComponent(name)}${register ? '&register=true' : ''}`
  const c: ExportCheck = await asJSON(await fetch(`${BASE}/bindings/export/check?${q}`))
  return { ...c, issues: c.issues ?? [] }
}

/** The picture of scheme ref read from its viewer's storage and imported as an .svg import. diagram is the diagram
 * being re-fetched, which may already be linked to the scheme. */
export async function fetchScheme(ref: string, diagram?: string): Promise<FetchedScheme> {
  const q = new URLSearchParams({ ref })
  if (diagram) q.set('diagram', diagram)
  const data = await asJSON<Omit<FetchedScheme, 'diagram'> & { diagram: DiagramWire }>(
    await fetch(`${BASE}/bindings/schemes/fetch?${q}`, { method: 'POST' }),
  )
  return { ...data, diagram: normalizeDiagram(data.diagram) }
}

/** The bindings of the scheme the saved diagram name is linked to, read from the provider for import. */
export async function importBindings(name: string): Promise<SchemeBindings> {
  const r: SchemeBindings = await asJSON(
    await fetch(`${BASE}/bindings/import?name=${encodeURIComponent(name)}`, { method: 'POST' }),
  )
  return {
    ...r,
    issues: r.issues ?? [],
    components: (r.components ?? []).map(c => ({ ...c, bindings: c.bindings ?? [] })),
  }
}

/** An export the server's check stopped; check tells why. */
export class ExportRefusedError extends Error {
  check: ExportCheck
  constructor(message: string, check: ExportCheck) {
    super(message)
    this.check = { ...check, issues: check.issues ?? [] }
  }
}

/** Exports the saved diagram name to the provider as req chose; the server saves the diagram's new scheme link.
 * Throws ExportRefusedError when the check fails. */
/** Delivers only the saved picture of the diagram name to its linked scheme (nothing in the database) and saves the
 * diagram with that export time (POST /api/bindings/export/svg). */
export async function exportDiagramPicture(name: string): Promise<SVGExportResult> {
  const res = await fetch(`${BASE}/bindings/export/svg?name=${encodeURIComponent(name)}`, { method: 'POST' })
  const r: SVGExportResult = await asJSON(res)
  return { ...r, svg: r.svg ?? [] }
}

export async function exportDiagram(name: string, req: ExportRequest): Promise<ExportResult> {
  const res = await fetch(`${BASE}/bindings/export?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (res.status === 409) {
    const body = await res.json().catch(() => null)
    if (body?.check) throw new ExportRefusedError(body.error, body.check)
    throw new Error(body?.error || `${res.status} ${res.statusText}`)
  }
  const r: ExportResult = await asJSON(res)
  return { ...r, skipped: r.skipped ?? [] }
}

/** The groups a new scheme can go into. */
export async function listSchemeGroups(): Promise<SchemeGroup[]> {
  return (await asJSON(await fetch(`${BASE}/bindings/scheme-groups`))) ?? []
}

/** The provider's scheme types. */
export async function listSchemeTypes(): Promise<SchemeType[]> {
  return (await asJSON(await fetch(`${BASE}/bindings/scheme-types`))) ?? []
}

/** Thrown by getScheme for a scheme the provider no longer has. */
export class SchemeNotFoundError extends Error {
  constructor(ref: string) {
    super(t('schemes.missing', { ref }))
  }
}

/** The scheme ref with its linked diagram; rejects with SchemeNotFoundError when the scheme is gone. */
export async function getScheme(ref: string): Promise<ProviderScheme> {
  const res = await fetch(`${BASE}/bindings/scheme?ref=${encodeURIComponent(ref)}`)
  if (res.status === 404) throw new SchemeNotFoundError(ref)
  return asJSON(res)
}

/** Schemes proposed for the diagram name (its path) imported from source, best first. */
export async function suggestSchemes(name: string, source?: string): Promise<SchemeCandidate[]> {
  const q = new URLSearchParams({ name, source: source ?? '' })
  const body: { candidates: SchemeCandidate[] } = await asJSON(await fetch(`${BASE}/bindings/schemes/suggest?${q}`))
  return body.candidates ?? []
}

/** Which of the scheme refs exist at the provider. */
export async function schemesExist(refs: string[]): Promise<Record<string, boolean>> {
  const body: { exist: Record<string, boolean> } = await asJSON(
    await fetch(`${BASE}/bindings/schemes/exist`, await jsonBody('POST', { refs })),
  )
  return body.exist ?? {}
}

/** The drag data type of an object dragged from the Objects panel; its value is a JSON DraggedObject. */
export const OBJECT_DRAG_TYPE = 'application/x-sld-object'
