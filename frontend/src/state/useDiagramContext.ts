import { createContext, useContext } from 'react'
import type { Diagram, DiagramInfo, ElementSymbol, EditorConfig, EditorSettings, ConnectorKind } from '../types'

export interface DiagramContextValue {
  diagramName: string | null
  diagram: Diagram | null
  dirty: boolean
  diagrams: DiagramInfo[]
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

  // The full element multi-selection — always a superset of
  // selectedElementId (a plain click collapses it to that one id; a
  // connector selection or an armed symbol clears it). Shift-click toggles
  // an id in/out via toggleElementSelection instead of replacing it.
  // Everything that only makes sense for a single element (Properties'
  // full field editor, a BusBarSection's draggable point handles,
  // Ctrl/Cmd-click-to-connect's anchor) keys off selectedElementId and
  // ignores this set once it holds more than one id.
  selectedElementIds: Set<number>
  toggleElementSelection: (id: number) => void

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
  refreshDiagrams: () => Promise<void>
  // defaultVoltageName: a server voltage-color preset's name (see
  // EditorConfig.voltageColors) to seed the new diagram's own
  // editor.defaultVoltage with — see DiagramProvider's own newDiagram doc
  // comment for why this one writes to disk immediately rather than
  // leaving the diagram merely dirty.
  newDiagram: (name: string, width?: number, height?: number, defaultVoltageName?: string) => Promise<void>
  openDiagram: (name: string) => Promise<void>
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
