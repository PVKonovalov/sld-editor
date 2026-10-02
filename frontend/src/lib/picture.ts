import type { Diagram } from '../types'

// A Picture (shape 11) embeds its image as a data URI in href, which can
// run to megabytes. The canvas posts the whole diagram to /api/render on
// every edit, so the hrefs are stripped from those requests and filled
// into the rendered <image> tags here instead (Interactive render never
// writes one; see slddoc's writePicture). A stripped href becomes this
// empty data URI, so the backend still knows the Picture has an image and
// leaves its no-image placeholder frame out.
const STRIPPED_HREF = 'data:,'

/** diagram with every Picture's href replaced by a short stand-in, for the
 * live-render requests only (Save/Export still send the real image). */
export function stripPictureHrefs(diagram: Diagram): Diagram {
  if (!diagram.elements.some(el => el.class === 'Picture' && el.href)) return diagram
  return {
    ...diagram,
    elements: diagram.elements.map(el => (el.class === 'Picture' && el.href ? { ...el, href: STRIPPED_HREF } : el)),
  }
}

/** Sets each rendered Picture's <image> href under root from diagram state. */
export function fillPictureHrefs(root: Element, diagram: Diagram) {
  for (const el of diagram.elements) {
    if (el.class !== 'Picture' || !el.href) continue
    const image = root.querySelector(`[data-editor-kind="element"][id="${el.id}"] image`)
    if (image && image.getAttribute('href') !== el.href) image.setAttribute('href', el.href)
  }
}

/** Reads an image file chosen by the user as a data URI. */
export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** The natural pixel size of the image a data URI holds. */
export function imageNaturalSize(href: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('image'))
    img.src = href
  })
}
