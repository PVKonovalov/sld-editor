import { createContext, useContext } from 'react'
import type {
  Diagram,
  DiagramEntry,
  ElementSymbol,
  EditorConfig,
  EditorSettings,
  ConnectorKind,
  ImportReport,
} from '../types'

// A dropped/picked file whose target name (fileName minus extension)
// already exists on the server — parked until ConfirmReloadDialog's
// Reload/Cancel decides whether it replaces the open diagram.
export interface PendingImport {
  text: string
  fileName: string
  name: string
}

// One .svg import's own record, for the import log dialog.
export interface ImportLog {
  fileName: string
  report: ImportReport
}

// The four selectable kinds a mixed multi-selection can hold — matches
// Render/RenderFragments' own data-editor-kind values ("digitaldevice",
// not "digitalDevice").
export type SelectionKind = 'element' | 'connector' | 'label' | 'digitaldevice'

export interface DiagramContextValue {
  diagramName: string | null
  diagram: Diagram | null
  dirty: boolean
  // The File panel's own folder browser: currentDir is the directory
  // (relative to the server's diagrams root, "" for the root itself)
  // diagrams currently lists the immediate contents of — subdirectories
  // first (DiagramEntry.isDir), then diagrams, matching backend/internal/
  // storage.Store.List exactly (it never recurses, so this is always just
  // one directory's own contents, not a flattened tree). browseDir
  // navigates to a different directory (a folder row, or "..") and
  // re-fetches; opening/creating/saving a diagram also re-browses to its
  // own containing folder afterward (see DiagramProvider's own doc
  // comments), so this always reflects wherever the current diagramName
  // actually lives once one is open.
  currentDir: string
  diagrams: DiagramEntry[]
  browseDir: (dir: string) => Promise<void>
  elements: ElementSymbol[]
  config: EditorConfig | null
  error: string | null

  // Exactly one of these is non-null/non-empty at a time — selecting one
  // clears the others. armedSymbol is the palette entry currently "loaded"
  // for click-to-place; armedWireKind is a wire kind loaded from the
  // palette's own Wires section instead (the routing tool's next
  // completed route uses it, then Canvas clears it back to null itself,
  // single-shot like armedSymbol); armedLabel is the Elements panel's own
  // "Text" button, click-to-place a standalone Label the same way armedSymbol
  // places an element; armedDigitalDevice is its "Digital device" button,
  // click-to-place a shape-134 SCADA readout the same way; selecting
  // anything cancels the others.
  selectedElementId: number | null
  selectedConnectorId: number | null
  selectedLabelId: number | null
  selectedDigitalDeviceId: number | null
  armedSymbol: ElementSymbol | null
  armedWireKind: ConnectorKind | null
  armedLabel: boolean
  armedDigitalDevice: boolean

  // The full mixed multi-selection — any combination of elements,
  // connectors, labels, and digital devices, keyed by id (unique across
  // all four kinds — the same shared id space RenderFragments' own ids
  // param already relies on) with each entry's own kind alongside it.
  // Always a superset of whichever single selectedXxxId is currently set
  // (a plain click collapses it to that one {id: kind} entry; arming
  // anything clears it). Shift-click toggles an {id, kind} pair in/out via
  // toggleSelection instead of replacing the whole selection. Everything
  // that only makes sense for a single element (Properties' full field
  // editor, a BusBarSection's draggable point handles, Ctrl/Cmd-click-to-
  // connect's anchor) keys off selectedElementId and ignores this map once
  // it holds more than one entry.
  selection: Map<number, SelectionKind>
  toggleSelection: (id: number, kind: SelectionKind) => void

  // The last voltage class the user picked in Properties (or Settings, or
  // the New Diagram dialog), remembered for the lifetime of the session
  // (not persisted itself — see Diagram.editor.defaultVoltage for the
  // persisted counterpart) so newly placed elements/busbars can default to
  // it instead of starting unset. Seeded from the diagram's own
  // editor.defaultVoltage whenever one is opened or created.
  defaultVoltage: number | undefined
  setDefaultVoltage: (voltage: number | undefined) => void

  selectElement: (id: number | null) => void
  selectConnector: (id: number | null) => void
  selectLabel: (id: number | null) => void
  selectDigitalDevice: (id: number | null) => void
  armSymbol: (symbol: ElementSymbol | null) => void
  armWireKind: (kind: ConnectorKind | null) => void
  armLabel: (armed: boolean) => void
  armDigitalDevice: (armed: boolean) => void
  deleteSelected: () => void

  clearError: () => void
  // defaultVoltageName: a server voltage-color preset's name (see
  // EditorConfig.voltageColors) to seed the new diagram's own
  // editor.defaultVoltage with — see DiagramProvider's own newDiagram doc
  // comment for why this one writes to disk immediately rather than
  // leaving the diagram merely dirty.
  newDiagram: (name: string, width?: number, height?: number, defaultVoltageName?: string) => Promise<void>
  openDiagram: (name: string) => Promise<void>
  // Parses a .xsld file's own text — or reconstructs a diagram from an
  // xsde2svg-style .svg's (slddoc.Extract), picked by fileName's extension
  // — from a file picker or drag-and-drop on the user's own machine (not
  // the server's diagrams list) and makes it the working diagram, named
  // after fileName minus its extension — marked dirty so Save persists it
  // server-side under that name, the same upsert saveDiagramAs already
  // does. An .svg import also sets importLog and opens the import log
  // dialog, and defaults the diagram's own editor.defaultVoltage to its
  // most-used extracted voltage class. Rejects for an unsupported extension.
  loadDiagramFromFile: (text: string, fileName: string) => Promise<void>
  // What a drop/pick calls: loadDiagramFromFile straight away, unless a
  // diagram of the same name already exists on the server — then it sets
  // pendingImport instead, for ConfirmReloadDialog to ask first.
  importDiagramFile: (text: string, fileName: string) => Promise<void>
  pendingImport: PendingImport | null
  // Reload: load pendingImport (the next Save overwrites the server copy).
  confirmPendingImport: () => Promise<void>
  // Cancel: drop pendingImport, leaving the open diagram untouched.
  cancelPendingImport: () => void
  // The last .svg import's own file name + slddoc.Extract report, for the
  // import log dialog — kept only while that imported diagram stays open
  // (cleared by openDiagram/newDiagram/an .xsld import), so the File panel
  // can offer to re-open it.
  importLog: ImportLog | null
  importLogOpen: boolean
  setImportLogOpen: (open: boolean) => void
  saveDiagram: () => Promise<void>
  saveDiagramAs: (name: string) => Promise<void>
  updateDiagram: (updater: (d: Diagram) => Diagram) => void
  updateEditorSettings: (patch: Partial<EditorSettings>) => void
}

// Kept in its own module (rather than alongside DiagramProvider in
// DiagramContext.tsx) so that file exports only a component — mixing a
// component export with a hook export in one file defeats Vite's Fast
// Refresh (it falls back to a full reload on every edit).
export const DiagramContext = createContext<DiagramContextValue | null>(null)

export function useDiagramContext(): DiagramContextValue {
  const ctx = useContext(DiagramContext)
  if (!ctx) throw new Error('useDiagramContext must be used within a DiagramProvider')
  return ctx
}
