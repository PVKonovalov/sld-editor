import { locale, t } from '../i18n'

// Post-processing of the user guide's HTML (GET /api/user-guide) for
// GuideWindow, and its Print / "Save as PDF": the rendered guide in a hidden
// iframe as a light A4 page with a table of contents, then the browser's print
// dialog, whose "Save as PDF" destination gives the PDF. No server-side
// rendering: fonts (Cyrillic included), pictures and the language come for free.

/** Wraps every guide picture in a numbered <figure> (styled as a card by
 * .guide-content figure), so a screenshot of the dark editor stands apart from
 * the guide's own dark background. The caption is the image's Markdown title,
 * else its alt text.
 * @param html the guide's HTML fragment
 * @returns the fragment with the figures */
export function withFigures(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.querySelectorAll('img').forEach((img, i) => {
    const figure = doc.createElement('figure')
    const caption = doc.createElement('figcaption')
    const text = img.title || img.alt
    caption.textContent = text ? `${t('help.figure', { n: i + 1 })}. ${text}` : t('help.figure', { n: i + 1 })
    img.removeAttribute('title')
    // A picture alone in its paragraph replaces it (a <figure> can't sit in a <p>).
    const p = img.parentElement
    const alone = p?.tagName === 'P' && p.childNodes.length === 1
    ;(alone ? p : img).replaceWith(figure)
    figure.append(img, caption)
  })
  return doc.body.innerHTML
}

const PRINT_CSS = `
@page { size: A4; margin: 18mm 16mm; }
body { font: 10.5pt/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; background: #fff; margin: 0; }
h1 { font-size: 20pt; margin: 0 0 8pt; }
h2 { font-size: 14pt; margin: 18pt 0 6pt; padding-bottom: 2pt; border-bottom: 1px solid #bbb; break-after: avoid; }
h3 { font-size: 12pt; margin: 12pt 0 4pt; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
a { color: #1d4ed8; text-decoration: none; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; background: #f1f1f1; padding: 0 2pt; border-radius: 2pt; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0; font-size: 9pt; }
th, td { border: 1px solid #bbb; padding: 3pt 5pt; text-align: left; vertical-align: top; }
th { background: #eee; }
tr, figure { break-inside: avoid; }
figure { margin: 8pt auto; text-align: center; }
figure img { max-width: 100%; max-height: 220mm; padding: 3pt; border: 1px solid #bbb; background: #f4f4f4; }
figcaption { margin-top: 3pt; font-size: 9pt; color: #444; }
nav.toc { break-after: page; }
nav.toc h2 { border: none; }
nav.toc ul { list-style: none; padding: 0; margin: 0; }
nav.toc li.l3 { padding-left: 14pt; font-size: 9.5pt; }
`

// The printable document: absolute image URLs and a table of contents from
// the h2/h3 headings (its links work inside the PDF).
function printableHtml(guideHtml: string, title: string): string {
  const doc = new DOMParser().parseFromString(`<body>${guideHtml}</body>`, 'text/html')
  doc.querySelectorAll('img').forEach(img => {
    img.src = new URL(img.getAttribute('src') ?? '', window.location.href).href
  })
  const headings = [...doc.querySelectorAll<HTMLHeadingElement>('h2[id], h3[id]')]
  if (headings.length > 0) {
    const nav = doc.createElement('nav')
    nav.className = 'toc'
    const h = doc.createElement('h2')
    h.textContent = t('help.contents')
    const ul = doc.createElement('ul')
    for (const heading of headings) {
      const li = doc.createElement('li')
      li.className = heading.tagName === 'H2' ? 'l2' : 'l3'
      const a = doc.createElement('a')
      a.href = `#${heading.id}`
      a.textContent = heading.textContent
      li.append(a)
      ul.append(li)
    }
    nav.append(h, ul)
    const h1 = doc.body.querySelector('h1')
    if (h1) h1.after(nav)
    else doc.body.prepend(nav)
  }
  const escapedTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${escapedTitle}</title>`
    + `<style>${PRINT_CSS}</style></head><body>${doc.body.innerHTML}</body></html>`
}

/** Opens the browser's print dialog for the guide.
 * @param guideHtml the guide's HTML as GuideWindow shows it
 * @param title the printout's title, also the PDF's default file name */
export function printGuide(guideHtml: string, title: string): void {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  // Fires once the document and its pictures have loaded.
  iframe.onload = () => {
    const win = iframe.contentWindow
    if (!win) return
    win.addEventListener('afterprint', () => iframe.remove(), { once: true })
    // The PDF's file name comes from the top document's title.
    const pageTitle = document.title
    document.title = title
    win.focus()
    win.print()
    document.title = pageTitle
  }
  iframe.srcdoc = printableHtml(guideHtml, title)
  document.body.append(iframe)
}
