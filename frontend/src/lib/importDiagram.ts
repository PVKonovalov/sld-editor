// Turning a locally dropped/picked file into a Diagram — shared by the
// single-file import (DiagramContext.loadDiagramFromFile, which opens the
// result) and the multi-file batch import (importDiagramFiles, which saves
// each result straight to the server instead).
import * as api from './api'
import { diagramFileKind, readFileAsText } from './fileTransfer'
import { t } from '../i18n'
import type { ConverterMessage, Diagram, ImportReport } from '../types'

export interface PreparedImport {
  diagram: Diagram
  // slddoc.Extract's own report, for an .svg, .xsde or CIM import only.
  report: ImportReport | null
  // Appended to the file's name: "" for the first page, "_N" for page N+1 of an .xsde (xsde2svg's own naming) or a CIM
  // model with several diagrams.
  nameSuffix: string
  // xsde2svg's diagnostics, or the CIM import's notes, for this page.
  messages: ConverterMessage[] | null
}

/** Turns a picked/dropped file into one diagram per page: an .xsld as-is, an xsde2svg-style .svg through
 * slddoc.Extract, an .xsde through xsde2svg and then Extract, a CIM model through slddoc.ImportCIM (a page per DL
 * diagram). The server also repairs each diagram as opening one
 * does, and gives an extracted one its most-used voltage class as the default voltage and its size steps.
 * Rejects for an unsupported extension or a file the backend can't read. */
export async function prepareImport(file: File): Promise<PreparedImport[]> {
  const kind = diagramFileKind(file.name)
  if (!kind) throw new Error(t('file.invalidDiagramFile', { name: file.name }))
  if (kind === 'xsld') {
    const raw = await api.importDiagramXML(await readFileAsText(file))
    return [{ diagram: raw, report: null, nameSuffix: '', messages: null }]
  }
  if (kind === 'svg') {
    const { diagram, report } = await api.importDiagramSVG(await readFileAsText(file))
    return [{ diagram, report, nameSuffix: '', messages: null }]
  }
  const bytes = await file.arrayBuffer()
  const { pages, messages } = kind === 'xsde' ? await api.importDiagramXSDE(bytes) : await api.importDiagramCIM(bytes)
  const imported = new Set(pages.map(p => p.page))
  return pages.map((p, i) => ({
    diagram: p.diagram,
    report: p.report,
    nameSuffix: p.page > 1 ? `_${p.page - 1}` : '',
    // Whole-document messages, and those of a page that didn't extract, go with the first page.
    messages: messages.filter(m => m.page === p.page || (i === 0 && !imported.has(m.page))),
  }))
}
