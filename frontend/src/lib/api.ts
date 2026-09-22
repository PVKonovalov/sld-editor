import type {
  Diagram,
  DiagramWire,
  DiagramEntry,
  ElementSymbol,
  EditorConfig,
} from '../types'

const BASE = '/api'

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
export async function getDiagram(name: string): Promise<Diagram> {
  const res = await fetch(`${BASE}/diagrams/open?name=${encodeURIComponent(name)}`)
  return normalizeDiagram(await asJSON<DiagramWire>(res))
}

export async function saveDiagram(
  name: string,
  diagram: Diagram,
): Promise<{ diagram: Diagram; warning?: string }> {
  const res = await fetch(`${BASE}/diagrams/save?name=${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(diagram),
  })
  const data = await asJSON<DiagramResponse>(res)
  return { diagram: normalizeDiagram(data.diagram), warning: data.warning }
}

/** Renders a diagram (saved or not) to SVG without persisting it — used for
 * a live canvas preview of in-progress edits. */
export async function renderPreview(diagram: Diagram): Promise<{ svg: string; warning?: string }> {
  const res = await fetch(`${BASE}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(diagram),
  })
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
  const res = await fetch(`${BASE}/render/fragments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ diagram, ids }),
  })
  return asJSON(res)
}

/** Renders a diagram (saved or not) to its on-disk XML shape, for the
 * browser to download directly to the user's own machine — not tied to the
 * server's own diagrams directory the way saveDiagram/getDiagram are. */
export async function exportDiagramXML(diagram: Diagram): Promise<string> {
  const res = await fetch(`${BASE}/export/xml`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(diagram),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error((body && body.error) || `${res.status} ${res.statusText}`)
  }
  return res.text()
}

/** exportDiagramXML's counterpart for the Static-mode SVG (the same
 * rendering the companion .svg Save writes to disk). */
export async function exportDiagramSVG(diagram: Diagram): Promise<string> {
  const res = await fetch(`${BASE}/export/svg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(diagram),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error((body && body.error) || `${res.status} ${res.statusText}`)
  }
  return res.text()
}

/** Parses a raw .xml file's own text (loaded from the user's machine, e.g.
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

export async function listElements(): Promise<ElementSymbol[]> {
  const res = await fetch(`${BASE}/elements`)
  return asJSON(res)
}

export async function getConfig(): Promise<EditorConfig> {
  const res = await fetch(`${BASE}/config`)
  return asJSON(res)
}
