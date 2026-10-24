// Turning a locally dropped/picked file into a Diagram — shared by the
// single-file import (DiagramContext.loadDiagramFromFile, which opens the
// result) and the multi-file batch import (importDiagramFiles, which saves
// each result straight to the server instead).
import * as api from './api'
import { joinDiagramPath, parentDir } from './diagramPath'
import { diagramFileKind, readFileAsText } from './fileTransfer'
import { t } from '../i18n'
import type { ConverterMessage, Diagram, ImportReport, UnmatchedVoltage } from '../types'

export interface PreparedImport {
  diagram: Diagram
  // slddoc.Extract's own report, for an .svg, .xsde or CIM import only.
  report: ImportReport | null
  // Appended to the file's name: "" for the first page, "_N" for page N+1 of an .xsde (xsde2svg's own naming), and
  // "/<diagram name>" for each diagram of a CIM model with several (a folder named after the file).
  nameSuffix: string
  // xsde2svg's diagnostics, or the CIM import's notes, for this page.
  messages: ConverterMessage[] | null
}

export interface PreparedFile {
  pages: PreparedImport[]
  // A CIM import's voltage classes no server preset names, colored like the nearest one (empty otherwise).
  unmatchedVoltages: UnmatchedVoltage[]
}

/** Turns a picked/dropped file into one diagram per page: an .xsld as-is, an xsde2svg-style .svg through
 * slddoc.Extract, an .xsde through xsde2svg and then Extract, a CIM model through slddoc.ImportCIM (a page per DL
 * diagram). The server also repairs each diagram as opening one
 * does, and gives an extracted one its most-used voltage class as the default voltage and its size steps.
 * Rejects for an unsupported extension or a file the backend can't read. */
export async function prepareImport(file: File): Promise<PreparedFile> {
  const kind = diagramFileKind(file.name)
  if (!kind) throw new Error(t('file.invalidDiagramFile', { name: file.name }))
  if (kind === 'xsld') {
    const raw = await api.importDiagramXML(await readFileAsText(file))
    return { pages: [{ diagram: raw, report: null, nameSuffix: '', messages: null }], unmatchedVoltages: [] }
  }
  if (kind === 'svg') {
    const { diagram, report } = await api.importDiagramSVG(await readFileAsText(file))
    return { pages: [{ diagram, report, nameSuffix: '', messages: null }], unmatchedVoltages: [] }
  }
  const bytes = await file.arrayBuffer()
  const { pages, messages, unmatchedVoltages } =
    kind === 'xsde' ? { ...(await api.importDiagramXSDE(bytes)), unmatchedVoltages: [] } : await api.importDiagramCIM(bytes)
  const imported = new Set(pages.map(p => p.page))
  const cimNames = kind !== 'xsde' && pages.length > 1 ? folderPageNames(pages.map(p => p.title)) : null
  return {
    pages: pages.map((p, i) => ({
      diagram: p.diagram,
      report: p.report,
      nameSuffix: cimNames ? `/${cimNames[i]}` : p.page > 1 ? `_${p.page - 1}` : '',
      // Whole-document messages, and those of a page that didn't extract, go with the first page.
      messages: messages.filter(m => m.page === p.page || (i === 0 && !imported.has(m.page))),
    })),
    unmatchedVoltages,
  }
}

/** folderPageNames turns diagram titles into diagram names: "/" and "\\" become "-", an empty one "page N", and a
 * repeated one gets " (2)", " (3)"… */
export function folderPageNames(titles: string[]): string[] {
  const used = new Set<string>()
  return titles.map((title, i) => {
    const base = title.replace(/[/\\]/g, '-').trim() || `page ${i + 1}`
    let name = base
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base} (${k})`
    used.add(name.toLowerCase())
    return name
  })
}

/** ExistingNames tells which diagram paths already exist on the server, listing each folder once (none with
 * overwrite), and remembers the paths saved since. */
export class ExistingNames {
  private readonly names = new Set<string>()
  private readonly listed = new Set<string>()
  private readonly overwrite: boolean

  constructor(overwrite: boolean) {
    this.overwrite = overwrite
  }

  async has(path: string): Promise<boolean> {
    const dir = parentDir(path)
    if (!this.overwrite && !this.listed.has(dir)) {
      this.listed.add(dir)
      try {
        for (const e of await api.listDiagrams(dir)) if (!e.isDir) this.names.add(joinDiagramPath(dir, e.name))
      } catch {
        // A folder not created yet holds nothing.
      }
    }
    return this.names.has(path)
  }

  add(path: string) {
    this.names.add(path)
  }
}

/** pages with each voltage class named in colors given that color. */
export function recolorVoltageClasses(pages: PreparedImport[], colors: ReadonlyMap<string, string>): PreparedImport[] {
  if (colors.size === 0) return pages
  return pages.map(p => ({
    ...p,
    diagram: {
      ...p.diagram,
      voltageClasses: p.diagram.voltageClasses.map(vc => {
        const color = colors.get(vc.name)
        return color && color !== vc.color ? { ...vc, color } : vc
      }),
    },
  }))
}
