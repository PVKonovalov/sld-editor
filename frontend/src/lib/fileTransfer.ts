// Client-side (not backend) helpers for moving a diagram's own text content
// to/from the user's own machine — a plain browser download (Save XML/SVG)
// and reading a locally picked/dropped .xsld/.svg file's own text (Load from
// file, drag-and-drop) — kept separate from lib/api.ts since neither one
// talks to the backend at all.

/** Triggers a browser download of `content` as a file named `filename`,
 * without navigating away from the app. */
export function downloadText(filename: string, content: string, mimeType: string): void {
  downloadBlob(filename, new Blob([content], { type: mimeType }))
}

/** downloadText for binary content. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Which importable format a picked/dropped file is, by extension: a
 * diagram's own source .xsld, or an xsde2svg-style rendered .svg to
 * reconstruct a diagram from (see the backend's POST /api/import/svg), or a
 * Modus .xsde converted by xsde2svg first (POST /api/import/xsde), or a CIM model: a zip of CGMES profiles or one
 * RDF/XML document (POST /api/import/cim).
 * null for anything else. */
export type DiagramFileKind = 'xsld' | 'svg' | 'xsde' | 'cim'

export function diagramFileKind(filename: string): DiagramFileKind | null {
  if (/\.xsld$/i.test(filename)) return 'xsld'
  if (/\.svg$/i.test(filename)) return 'svg'
  if (/\.xsde$/i.test(filename)) return 'xsde'
  if (/\.(zip|xml|rdf)$/i.test(filename)) return 'cim'
  return null
}

/** Strips a trailing ".xsld"/".svg"/".xsde" (case-insensitive) from a picked/dropped
 * file's own name, for use as the diagram's own name. */
export function stripDiagramExtension(filename: string): string {
  return filename.replace(/\.(xsld|svg|xsde|zip|xml|rdf)$/i, '')
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'))
    reader.readAsText(file)
  })
}


