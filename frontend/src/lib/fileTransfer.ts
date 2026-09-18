// Client-side (not backend) helpers for moving a diagram's own text content
// to/from the user's own machine — a plain browser download (Save XML/SVG)
// and reading a locally picked/dropped .xml file's own text (Load from
// file, drag-and-drop) — kept separate from lib/api.ts since neither one
// talks to the backend at all.

/** Triggers a browser download of `content` as a file named `filename`,
 * without navigating away from the app. */
export function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Strips a trailing ".xml" (case-insensitive) from a picked/dropped
 * file's own name, for use as the diagram's own name. */
export function stripXmlExtension(filename: string): string {
  return filename.replace(/\.xml$/i, '')
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'))
    reader.readAsText(file)
  })
}
