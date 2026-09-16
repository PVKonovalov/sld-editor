// Mirrors backend/internal/slddoc's JSON shape (see model.go) and the
// small API-only types layered on top of it in backend/internal/elements
// and backend/internal/config.
//
// Every id (and every field that references one — Port.node,
// DiagramElement.voltage/layer, Connector.voltage/layer/from/to,
// Label.for/layer) is a plain integer, assigned by lib/diagramOps.ts's
// IdSequence and persisted via Diagram.lastId; 0 doubles as "unset" for an
// optional reference (voltage, for) since a real id is never 0. The one
// exception is DiagramElement.shape/ElementSymbol.shape, a symbol-library
// key (e.g. "41", "24") rather than an assigned identity, which stays a
// string.

export interface Point {
  x: number
  y: number
}

export interface Port {
  name: string
  node: number
}

export interface Layer {
  id: number
  name: string
}

export interface VoltageClass {
  id: number
  name: string
  color: string
}

export interface DiagramNode {
  id: number
  x: number
  y: number
}

export interface EditorSettings {
  gridSpacing?: number
  snap?: boolean
  showGrid?: boolean
  background?: string
  // References a VoltageClass.id (0/absent = unset) a newly placed
  // element/connector in this diagram should start out with instead of no
  // voltage at all.
  defaultVoltage?: number
  // Debug overlay: a small red X at every Diagram.Node's own position (not
  // just a symbol's declared Terminals) — see Canvas's own render of it.
  showNodes?: boolean
}

// Matches backend/internal/slddoc.Class.
export type ElementClass =
  | 'Breaker'
  | 'Disconnector'
  | 'LoadBreakSwitch'
  | 'GroundSwitch'
  | 'Ground'
  | 'PowerTransformer'
  | 'CurrentTransformer'
  | 'ChokeCoil'
  | 'SurgeArrester'
  | 'Fuse'
  | 'Capacitor'
  | 'BusBarSection'
  | 'JunctionPoint'
  | 'Lamp'
  | 'FaultPassageIndicator'

export interface DiagramElement {
  id: number
  class: ElementClass
  shape: string
  name?: string
  voltage?: number
  layer: number
  x: number
  y: number
  orient?: number
  state?: number | null
  fillOff?: string
  fillOn?: string
  radius?: number
  ports?: Port[]
  points?: Point[]
}

// Matches backend/internal/slddoc.ConnectorKind.
export type ConnectorKind = 'BusbarWire' | 'OverheadLine' | 'CableLine' | 'BusWork'

export interface Connector {
  id: number
  kind: ConnectorKind
  voltage?: number
  layer: number
  dashed?: boolean
  from: number
  to: number
  points: Point[]
}

export interface Label {
  for?: number
  layer: number
  x: number
  y: number
  size: number
  anchor?: string
  bold?: boolean
  text: string
}

// The wire shape (a Go nil slice serializes as JSON null): use
// normalizeDiagram in lib/api.ts to get the array-always shape below
// everywhere else in the app.
export interface DiagramWire {
  width: number
  height: number
  source?: string
  lastId?: number
  editor?: EditorSettings
  layers: Layer[] | null
  voltageClasses: VoltageClass[] | null
  nodes: DiagramNode[] | null
  elements: DiagramElement[] | null
  connectors: Connector[] | null
  labels: Label[] | null
}

export interface Diagram {
  width: number
  height: number
  source?: string
  // Highest auto-assigned integer id this editor has ever handed out for
  // an element/node/connector/voltage class in this diagram (see
  // lib/diagramOps.ts's IdSequence). Absent/0 on a diagram this editor has
  // never assigned an id in — including one it created but hasn't placed
  // anything into yet.
  lastId?: number
  editor?: EditorSettings
  layers: Layer[]
  voltageClasses: VoltageClass[]
  nodes: DiagramNode[]
  elements: DiagramElement[]
  connectors: Connector[]
  labels: Label[]
}

export interface DiagramInfo {
  name: string
  modTime: string
}

// Matches backend/internal/elements.Symbol. shape is a symbol-library key
// (e.g. "41", "24"), not an assigned identity, so it stays a string.
export interface ElementSymbol {
  shape: string
  class: string
  name: string
  category?: string
  // Local, unrotated points on this shape where a real electrical
  // connection can be made (e.g. a Breaker's own two stem ends) — absent
  // for a shape with none, like a busbar. Purely informational for now:
  // Canvas draws a marker at each one for the current selection, but
  // Ctrl/Cmd-click-to-connect still just joins two elements' bare anchors.
  terminals?: Point[]
  // Raw SVG template body (local, unrotated coordinates around origin
  // (0,0)) this shape renders from — see lib/elementIcon.ts for turning
  // it into a static palette preview icon.
  template: string
}

export interface VoltageColor {
  name: string
  color: string
}

// One entry of the install-wide Open/Close/Intermediate legend a switching
// device's State dropdown (Properties) offers and its rendered fill color
// is drawn from — global, not stored per diagram (see
// backend/internal/config.StateColor).
export interface StateColor {
  state: number
  label: string
  color: string
}

export interface EditorDefaults {
  gridSpacing: number
  snap: boolean
  showGrid: boolean
  background: string
}

export interface EditorConfig {
  editor: EditorDefaults
  voltageColors: VoltageColor[]
  stateColors: StateColor[]
}
