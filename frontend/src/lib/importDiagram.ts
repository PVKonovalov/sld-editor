// Turning a locally dropped/picked file into a Diagram — shared by the
// single-file import (DiagramContext.loadDiagramFromFile, which opens the
// result) and the multi-file batch import (importDiagramFiles, which saves
// each result straight to the server instead).
import * as api from './api'
import * as diagramOps from './diagramOps'
import { diagramFileKind } from './fileTransfer'
import { t } from '../i18n'
import type { Diagram, EditorConfig, ImportReport } from '../types'

export interface PreparedImport {
  diagram: Diagram
  // slddoc.Extract's own report, for an .svg import only.
  report: ImportReport | null
}

/** Parses an .xsld as-is, or reconstructs a diagram from an xsde2svg-style
 * .svg (slddoc.Extract, with editor.defaultVoltage defaulted to its most-used
 * extracted voltage class, since Extract never sets one), then applies the
 * same fixes opening a diagram does: ensureLastId and applyPresetVoltageNames.
 * Rejects for an unsupported extension. */
export async function prepareImport(text: string, fileName: string, config: EditorConfig | null): Promise<PreparedImport> {
  const kind = diagramFileKind(fileName)
  if (!kind) throw new Error(t('file.invalidDiagramFile', { name: fileName }))
  let raw: Diagram
  let report: ImportReport | null = null
  if (kind === 'svg') {
    const extracted = await api.importDiagramSVG(text)
    raw = extracted.diagram
    report = extracted.report
    const voltage = diagramOps.mostUsedVoltage(raw)
    if (voltage !== undefined && raw.editor?.defaultVoltage === undefined) {
      raw = { ...raw, editor: { ...raw.editor, defaultVoltage: voltage } }
    }
  } else {
    raw = await api.importDiagramXML(text)
  }
  return { diagram: diagramOps.applyPresetVoltageNames(diagramOps.ensureLastId(raw), config), report }
}
