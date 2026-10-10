// Turning a locally dropped/picked file into a Diagram — shared by the
// single-file import (DiagramContext.loadDiagramFromFile, which opens the
// result) and the multi-file batch import (importDiagramFiles, which saves
// each result straight to the server instead).
import * as api from './api'
import * as diagramOps from './diagramOps'
import { diagramFileKind, readFileAsText } from './fileTransfer'
import { t } from '../i18n'
import type { ConverterMessage, Diagram, EditorConfig, ElementSymbol, ImportReport } from '../types'

export interface PreparedImport {
  diagram: Diagram
  // slddoc.Extract's own report, for an .svg or .xsde import only.
  report: ImportReport | null
  // Appended to the file's name: "" for the first page, "_N" for page N+1 of an .xsde (xsde2svg's own naming).
  nameSuffix: string
  // xsde2svg's diagnostics for this page, for an .xsde import only.
  messages: ConverterMessage[] | null
}

/** Turns a picked/dropped file into one diagram per page: an .xsld as-is, an xsde2svg-style .svg through
 * slddoc.Extract, an .xsde through xsde2svg and then Extract. An extracted diagram gets editor.defaultVoltage set to
 * its most-used voltage class and its size steps recovered (inferSizeSteps); every diagram then gets the fixes opening
 * one does (ensureLastId, applyPresetVoltageNames, normalizeTopology).
 * Rejects for an unsupported extension or a file the backend can't read. */
export async function prepareImport(
  file: File,
  config: EditorConfig | null,
  symbols: ElementSymbol[],
): Promise<PreparedImport[]> {
  const kind = diagramFileKind(file.name)
  if (!kind) throw new Error(t('file.invalidDiagramFile', { name: file.name }))
  if (kind === 'xsld') {
    const raw = await api.importDiagramXML(await readFileAsText(file))
    return [{ diagram: finish(raw, config, symbols, false), report: null, nameSuffix: '', messages: null }]
  }
  if (kind === 'svg') {
    const { diagram, report } = await api.importDiagramSVG(await readFileAsText(file))
    return [{ diagram: finish(diagram, config, symbols, true), report, nameSuffix: '', messages: null }]
  }
  const { pages, messages } = await api.importDiagramXSDE(await file.arrayBuffer())
  const imported = new Set(pages.map(p => p.page))
  return pages.map((p, i) => ({
    diagram: finish(p.diagram, config, symbols, true),
    report: p.report,
    nameSuffix: p.page > 1 ? `_${p.page - 1}` : '',
    // Whole-document messages, and those of a page that didn't extract, go with the first page.
    messages: messages.filter(m => m.page === p.page || (i === 0 && !imported.has(m.page))),
  }))
}

function finish(raw: Diagram, config: EditorConfig | null, symbols: ElementSymbol[], extracted: boolean): Diagram {
  if (extracted) {
    const voltage = diagramOps.mostUsedVoltage(raw)
    if (voltage !== undefined && raw.editor?.defaultVoltage === undefined) {
      raw = { ...raw, editor: { ...raw.editor, defaultVoltage: voltage } }
    }
  }
  let fixed = diagramOps.applyPresetVoltageNames(diagramOps.ensureLastId(raw), config)
  if (extracted) {
    // Extract reads each element's real port positions but not its size
    // step, so recover the step from where those ports sit. (T-taps, a port
    // drawn on or beside a wire mid-span, are joined by Extract itself.)
    fixed = diagramOps.inferSizeSteps(fixed, symbols)
  }
  return diagramOps.normalizeTopology(fixed, symbols)
}
