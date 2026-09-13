import type {
  Diagram,
  DiagramWire,
  DiagramInfo,
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
  }
}

interface DiagramResponse {
  diagram: DiagramWire
  warning?: string
}

export async function listDiagrams(): Promise<DiagramInfo[]> {
  const res = await fetch(`${BASE}/diagrams`)
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

export async function getDiagram(name: string): Promise<Diagram> {
  const res = await fetch(`${BASE}/diagrams/${encodeURIComponent(name)}`)
  return normalizeDiagram(await asJSON<DiagramWire>(res))
}

export async function saveDiagram(
  name: string,
  diagram: Diagram,
): Promise<{ diagram: Diagram; warning?: string }> {
  const res = await fetch(`${BASE}/diagrams/${encodeURIComponent(name)}`, {
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

export async function listElements(): Promise<ElementSymbol[]> {
  const res = await fetch(`${BASE}/elements`)
  return asJSON(res)
}

export async function getConfig(): Promise<EditorConfig> {
  const res = await fetch(`${BASE}/config`)
  return asJSON(res)
}
