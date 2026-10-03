// Turning a locally dropped/picked file into a Diagram — shared by the
// single-file import (DiagramContext.loadDiagramFromFile, which opens the
// result) and the multi-file batch import (importDiagramFiles, which saves
// each result straight to the server instead).
import * as api from './api'
import * as diagramOps from './diagramOps'
import { diagramFileKind } from './fileTransfer'
import { t } from '../i18n'
import type { Diagram, EditorConfig, ElementSymbol, ImportReport } from '../types'

export interface PreparedImport {
  diagram: Diagram
  // slddoc.Extract's own report, for an .svg import only.
  report: ImportReport | null
}

/** Parses an .xsld as-is, or reconstructs a diagram from an xsde2svg-style
 * .svg (slddoc.Extract, with editor.defaultVoltage defaulted to its most-used
 * extracted voltage class, since Extract never sets one, and each element's
 * size step recovered by inferSizeSteps), then applies the
 * same fixes opening a diagram does: ensureLastId, applyPresetVoltageNames and
 * normalizeTopology.
 * Rejects for an unsupported extension. */
export async function prepareImport(
  text: string,
  fileName: string,
  config: EditorConfig | null,
  symbols: ElementSymbol[],
): Promise<PreparedImport> {
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
  let fixed = diagramOps.applyPresetVoltageNames(diagramOps.ensureLastId(raw), config)
  if (kind === 'svg') {
    // Extract reads each element's real port positions but not its size
    // step, so recover the step from where those ports sit; it also only
    // snaps ports to wire ends, so join a port drawn just beside a wire (a
    // T-tap) to it. After ensureLastId: a tap may split a wire (new ids).
    fixed = diagramOps.tapFreePortsOntoWires(diagramOps.inferSizeSteps(fixed, symbols))
  }
  return { diagram: diagramOps.normalizeTopology(fixed, symbols), report }
}
