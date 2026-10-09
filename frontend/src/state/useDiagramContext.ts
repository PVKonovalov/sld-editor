import { createContext, useContext } from 'react'
import type {
  Diagram,
  DiagramEntry,
  CustomElement,
  ElementSymbol,
  EditorConfig,
  EditorSettings,
  ConnectorKind,
  Point,
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

// One locally dropped/picked file, already read as text.
export interface ImportFile {
  text: string
  fileName: string
}

// One file's outcome in a multi-file import: saved to the server as name
// (message: a non-fatal render warning, if any), skipped because name
// already exists there, or failed (message: why).
export interface BatchImportItem {
  fileName: string
  name: string
  status: 'saved' | 'skipped' | 'failed'
  message?: string
}

// The last multi-file import, for BatchImportDialog: the folder it
// targeted, the files themselves (kept so skipped ones can be re-run with
// overwrite) and each one's outcome.
export interface BatchImport {
  dir: string
  files: ImportFile[]
  items: BatchImportItem[]
}

// One .svg import's own record, for the import log dialog.
export interface ImportLog {
  fileName: string
  report: ImportReport
}

// A recovery draft (lib/drafts.ts) offered by DraftRecoveryDialog.
export interface DraftInfo {
  name: string
  savedAt: number
}

// UnsavedChangesDialog's three answers.
export type UnsavedChoice = 'save' | 'discard' | 'cancel'

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
  browseDir: (dir: string) => Promise<DiagramEntry[]>
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
  // The server's custom elements (GET /api/custom-elements), loaded once at
  // startup, and the one armed from the palette's "Custom elements" group
  // for click-to-place (mutually exclusive with every other arm/selection,
  // single-shot like armedSymbol).
  customElements: CustomElement[]
  armedCustomElement: CustomElement | null

  // The full mixed multi-selection — any combination of elements,
  // connectors, labels, and digital devices, keyed by id (unique across
  // all four kinds — the same shared id space RenderFragments' own ids
  // param already relies on) with each entry's own kind alongside it.
  // Always a superset of whichever single selectedXxxId is currently set
  // (a plain click collapses it to that one {id: kind} entry; arming
  // anything clears it). Shift-click toggles an {id, kind} pair in/out via
  // toggleSelection instead of replacing the whole selection. Everything
  // that only makes sense for a single element (Properties' full field
  // editor, a BusBarSection's draggable point handles) keys off
  // selectedElementId and ignores this map once it holds more than one
  // entry. A selection frame or a paste sets it whole via selectMany.
  selection: Map<number, SelectionKind>
  toggleSelection: (id: number, kind: SelectionKind) => void
  // Replaces the whole selection at once (a selection frame, a paste, a
  // duplicate); an empty map clears it. Clears any armed tool, like the
  // single-item select* functions.
  selectMany: (entries: Map<number, SelectionKind>) => void

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
  armCustomElement: (custom: CustomElement | null) => void
  // "Save selection as custom element": saves template (see
  // diagramOps.extractSelection) under name and adds/replaces it in
  // customElements. Rejects with api.ConflictError when name exists and
  // overwrite is false.
  saveCustomElement: (name: string, template: Diagram, overwrite: boolean) => Promise<void>
  deleteSelected: () => void

  clearError: () => void
  // defaultVoltageName: a server voltage-color preset's name (see
  // EditorConfig.voltageColors) to seed the new diagram's own
  // editor.defaultVoltage with — see DiagramProvider's own newDiagram doc
  // comment for why this one writes to disk immediately rather than
  // leaving the diagram merely dirty.
  // newDiagram, openDiagram and importDiagramFile first ask (unsavedPrompt)
  // when the open diagram has unsaved edits; newDiagram resolves false when
  // that was cancelled.
  newDiagram: (name: string, width?: number, height?: number, defaultVoltageName?: string) => Promise<boolean>
  openDiagram: (name: string) => Promise<void>
  // Parses a .xsld file's own text — or reconstructs a diagram from an
  // xsde2svg-style .svg's (lib/importDiagram's prepareImport) — and makes it
  // the working diagram under name (the server path the next Save writes),
  // marked dirty. An .svg import also sets importLog and opens the import
  // log dialog. Rejects for an unsupported extension.
  loadDiagramFromFile: (text: string, fileName: string, name: string) => Promise<void>
  // What a single-file drop/pick calls: loads it as currentDir/<file name
  // minus extension> straight away, unless a diagram of that name already
  // exists on the server — then it sets pendingImport instead, for
  // ConfirmReloadDialog to ask first.
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
  // Set when an opened (or .xsld-imported) diagram has no usable
  // editor.defaultVoltage of its own (diagramOps.needsDefaultVoltage), for
  // DefaultVoltageDialog to ask for one; cleared by picking one or skipping.
  defaultVoltagePromptOpen: boolean
  setDefaultVoltagePromptOpen: (open: boolean) => void
  // What a multi-file drop/pick calls: saves every file straight to the
  // server into currentDir (skipping names that already exist), opening
  // none of them, and records the outcome as batchImport for
  // BatchImportDialog.
  importDiagramFiles: (files: ImportFile[]) => Promise<void>
  batchImport: BatchImport | null
  // Re-runs the last batch's skipped files, overwriting the server copies.
  overwriteBatchSkipped: () => Promise<void>
  closeBatchImport: () => void
  saveDiagram: () => Promise<void>
  saveDiagramAs: (name: string) => Promise<void>
  updateDiagram: (updater: (d: Diagram) => Diagram) => void
  updateEditorSettings: (patch: Partial<EditorSettings>) => void
  // Undo/redo of diagram edits (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y,
  // the canvas buttons). The history restarts whenever another diagram is
  // opened, created, imported or restored; saving keeps it.
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  // Layers hidden on the canvas (Layers section checkboxes): not drawn and
  // not pickable while editing; session-only, never saved or exported.
  hiddenLayers: ReadonlySet<number>
  setLayerHidden: (layer: number, hidden: boolean) => void
  // The diagram Properties' Find section (FindSection): its query and type
  // filter live here so they survive the panel switching to a selected
  // item's properties and back; cleared when another diagram opens.
  findQuery: string
  findType: string
  setFind: (query: string, type: string) => void
  // Find's "Not connected only" filter.
  findFree: boolean
  setFindFree: (free: boolean) => void
  // Ctrl/Cmd+F: findFocusSeq counts requests to show and focus Find (App
  // opens Properties, FindSection expands and focuses its box).
  findFocusSeq: number
  requestFind: () => void
  // Asks the canvas to centre (and zoom in) on one item; seq changes on
  // every request so the same item can be asked for again.
  focusRequest: { id: number; kind: SelectionKind; seq: number } | { point: Point; seq: number } | null
  focusItem: (id: number, kind: SelectionKind) => void
  // Centres the canvas on a diagram point and flashes a ring there (the
  // Connections section's node coordinates).
  focusPoint: (point: Point) => void
  // A click in Find's results selects the item but keeps Properties on the
  // diagram view and Find (findPinned) until it's selected another way.
  findPinned: boolean
  selectFromFind: (id: number, kind: SelectionKind) => void
  // Set while UnsavedChangesDialog asks whether to save the open diagram's
  // edits before it is replaced; resolveUnsavedPrompt answers it.
  unsavedPrompt: { diagramName: string } | null
  resolveUnsavedPrompt: (choice: UnsavedChoice) => Promise<void>
  // Recovery drafts to offer (on startup, or when their diagram is opened):
  // restoreDraft makes one the working diagram (still unsaved),
  // discardDraft deletes it, closeDraftRecovery leaves them for later.
  recoverableDrafts: DraftInfo[]
  restoreDraft: (name: string) => Promise<void>
  discardDraft: (name: string) => Promise<void>
  closeDraftRecovery: () => void
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
