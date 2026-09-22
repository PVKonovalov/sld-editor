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

// Matches the shared slddoc module's Class (github.com/PVKonovalov/slddoc).
export type ElementClass =
  | 'Breaker'
  | 'Disconnector'
  | 'Sectionalizer'
  | 'LoadBreakSwitch'
  | 'GroundSwitch'
  | 'ShortCircuiter'
  | 'Ground'
  | 'PowerTransformer'
  | 'CurrentTransformer'
  | 'ChokeCoil'
  | 'Reactor'
  | 'ReactorShunt'
  | 'SurgeArrester'
  | 'Fuse'
  | 'Capacitor'
  | 'CapacitorBank'
  | 'Starter'
  | 'Generator'
  | 'BusBarSection'
  | 'JunctionPoint'
  | 'NonIntersection'
  | 'CableConnector'
  | 'CableJoint'
  | 'Lamp'
  | 'FaultPassageIndicator'
  | 'Rectangle'
  | 'Arrow'
  | 'Circle'
  | 'Button'
  | 'Road'
  | 'PostPole'
  | 'PackageSubstation'
  | 'EnclosedSubstation'

// Matches slddoc.WindingScheme — a PowerTransformer winding's own
// connection scheme. Only the three values with a real connection glyph in
// writePowerTransformer are offered (see TransformerWinding.scheme's own
// doc comment).
export type WindingScheme = 'wye' | 'wyeN' | 'delta'

// Matches slddoc.NeutralGrounding — only meaningful when a winding's own
// scheme is 'wyeN'. All three get their own distinct mark in
// writePowerTransformer (solid draws a real xsde2svg-style ground
// pictogram; isolated/resistor are this editor's own invented marks, since
// real xsde2svg has no glyph for either).
export type NeutralGrounding = 'solid' | 'isolated' | 'resistor'

// Matches slddoc.TerminalDirection — which side of a winding's own circle
// its lead (and real electrical Port) is drawn on, in the transformer's
// own local (pre-rotation) frame.
export type TerminalDirection = 'top' | 'bottom' | 'left' | 'right'

// Matches slddoc.TransformerWinding — one winding of a PowerTransformer
// element (see DiagramElement.windings), HV/MV/LV1/LV2 in declaration
// order.
export interface TransformerWinding {
  // References a VoltageClass.id (0/absent = unset) — this winding's own
  // rated voltage/color; unlike every other element class, a
  // PowerTransformer's windings can each carry a genuinely different one.
  voltage?: number
  // Empty draws no connection glyph at all.
  scheme?: WindingScheme
  grounding?: NeutralGrounding
  // Marks this as the regulated winding (OLTC/off-circuit tap changer) —
  // draws the diagonal regulation arrow. Real xsde2svg (and
  // writePowerTransformer) only ever draws one such arrow per transformer
  // regardless of how many windings request it — the last one set wins.
  tapChanger?: boolean
  // Empty falls back to this winding's own conventional default for the
  // transformer's own winding count (writePowerTransformer's own
  // defaultTerminal).
  terminal?: TerminalDirection
}

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
  // Flips the symbol template horizontally in its own local frame, applied
  // before orient's own rotation — matches backend/internal/slddoc's own
  // Mirror field. Meaningless for a BusBarSection (its own drawn `points`
  // are already absolute geometry, no local template to flip).
  mirror?: boolean
  state?: number | null
  position?: number | null
  fillOff?: string
  fillOn?: string
  // Also a PostPole's (shape 292) own drawn circle radius, doubling as its
  // Square variant's own half-width — see square below, and slddoc's own
  // Element.Radius doc comment for why one field covers both.
  radius?: number
  // Rectangle (shape 3) or Circle (shape 4) only — its own interior
  // color, matching backend/internal/slddoc's own Element.Fill. Not a
  // VoltageClass reference (a decorative annotation shape has no
  // electrical voltage of its own), the same free-text-color pattern
  // fillOff/fillOn already use for a Lamp. Also used by PackageSubstation
  // (shape 385) for its own inner rectangle's/triangle's interior — unlike
  // Rectangle/Circle, this one *does* have a real Voltage of its own (its
  // outline's color); Fill here is the real xsde2svg source's own Abonent
  // flag, generalized into this same free-choice field. Also used by
  // PostPole (292) for its own marker interior.
  fill?: string
  // A Rectangle's/Circle's own border color, an Arrow's (shape 2)/Road's
  // (shape 335) own line color, a Button's own box border color, or a
  // PostPole's (292) own marker border color — same free-text convention
  // as fill.
  stroke?: string
  // A Rectangle's/Circle's own border thickness, an Arrow's/Road's own
  // line thickness, or a Button's own box border thickness, matching
  // backend/internal/slddoc's own Element.StrokeWidth. Unset/0 means the
  // real xsde2svg default of 1 for every one of these except Road, whose
  // own unset default is much thicker (see that field's own Go doc
  // comment). Unused by PostPole (292) — its own border is always 1,
  // matching the real source's own hardcoded value.
  strokeWidth?: number
  // Arrow (shape 2) only — draws its own open chevron arrowhead at both
  // points instead of just the second one, matching backend/internal/
  // slddoc's own Element.DoubleHeaded.
  doubleHeaded?: boolean
  // PostPole (shape 292) only — draws its own square marker instead of
  // its default round one, matching backend/internal/slddoc's own
  // Element.Square.
  square?: boolean
  // PackageSubstation (shape 385) only — selects between its own two real
  // appearance variants, matching backend/internal/slddoc's own
  // Element.NType: 0/unset draws a box-in-box pictogram with a lead stub,
  // 1 draws a plain downward-pointing triangle instead.
  nType?: number
  // PackageSubstation (385) or EnclosedSubstation (386) — a short overlay
  // label (e.g. a transformer's own power rating, "160") drawn centered
  // on the shape, staying upright regardless of Orientation/Mirror.
  // Matches backend/internal/slddoc's own Element.PropertyText — see its
  // own doc comment for why this is a fixed centered/white/17px style
  // rather than the real source's own generic position/font/color
  // options. Empty means no label for these two. Also used by
  // FaultPassageIndicator (320003) for its own centered "FPI" text —
  // unlike 385/386, empty here means that fixed default label, not "no
  // label", since this shape's own real source draws no text at all (a
  // long-standing convention of this project's own, not derived from
  // anything real to match "no label" against). Also used by Button (shape
  // 113) for its own centered label — unlike 385/386/FPI, this one carries
  // no fixed style of its own; see textColor/bold.
  propertyText?: string
  // Button (shape 113) only — its own PropertyText color, matching
  // backend/internal/slddoc's own Element.TextColor. Unset falls back to
  // white, the more common real corpus case.
  textColor?: string
  // Button (shape 113) only — draws its own PropertyText in bold, matching
  // backend/internal/slddoc's own Element.Bold.
  bold?: boolean
  ports?: Port[]
  points?: Point[]
  // PowerTransformer (shape 47) only — see TransformerWinding's own doc
  // comment for what each winding records. len(windings) is the
  // transformer's own winding count (2, 3, or 4).
  autotransformer?: boolean
  windings?: TransformerWinding[]
  // Freeform connection-diagram label (e.g. "Yn/Δ-11"); empty means
  // "Show connection diagram label" is off. Real xsde2svg never computes
  // this string anywhere (the clock-hour number needs a phase-
  // displacement input the format doesn't carry), so it's typed in and
  // stored verbatim, not derived from the windings' own scheme.
  vectorGroupLabel?: string
}

// Matches backend/internal/slddoc.ConnectorKind.
export type ConnectorKind = 'BusbarWire' | 'OverheadLine' | 'CableLine' | 'BusWork' | 'LinkToObject'

// Matches backend/internal/slddoc.ConnectorLineStyle — a CableLine
// connector's own dash pattern, mirroring xsde2svg's own line-style
// switch (xsde2svg/internal/modus/element_23.go). Meaningless for every
// other ConnectorKind; unset/empty resolves to 'dashed' server-side (see
// render.go's resolveCableLineDash).
export type ConnectorLineStyle = 'solid' | 'dashed' | 'dashDot' | 'dotted'

export interface Connector {
  id: number
  kind: ConnectorKind
  // Optional, like DiagramElement.name — most kinds render with no
  // data-name at all; a 'OverheadLine' connector's own <g> wrapper does
  // (see backend/internal/slddoc.writeOverheadLine).
  name?: string
  voltage?: number
  layer: number
  dashed?: boolean
  // Only meaningful when kind === 'CableLine' — see ConnectorLineStyle's
  // own doc comment.
  lineStyle?: ConnectorLineStyle
  from: number
  to: number
  points: Point[]
}

export interface Label {
  id: number
  for?: number
  layer: number
  x: number
  y: number
  size: number
  anchor?: string
  bold?: boolean
  color?: string
  valign?: string
  font?: string
  text: string
}

// A shape-134 SCADA-style analog readout — shares Label's own text-styling
// fields, but its content isn't free text: value is a placeholder/default
// display value (this editor never binds to a live data source), name is
// the SCADA tag/point name (informational only, rendered as data-name), and
// unit is an optional suffix rendered as its own inline tspan.
export interface DigitalDevice {
  id: number
  layer: number
  x: number
  y: number
  size: number
  anchor?: string
  bold?: boolean
  color?: string
  valign?: string
  font?: string
  name?: string
  value: string
  unit?: string
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
  digitalDevices: DigitalDevice[] | null
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
  digitalDevices: DigitalDevice[]
}

export interface DiagramInfo {
  name: string
  modTime: string
}

// Matches backend/internal/elements.Symbol. shape is a symbol-library key
// (e.g. "41", "24"), not an assigned identity, so it stays a string. Carries
// no grouping/ordering of its own — see EditorConfig.palette, the single
// source of truth for where a shape shows up in the Elements panel.
export interface ElementSymbol {
  shape: string
  class: string
  name: string
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

// One entry of the install-wide Service/Normal/Test legend a withdrawable
// device's Position status dropdown (Properties) offers — global, not
// stored per diagram (see backend/internal/config.PositionState). Unlike
// StateColor, there's no color: Position drives a geometric offset
// (data-trolley), not a fill.
export interface PositionState {
  position: number
  label: string
}

export interface EditorDefaults {
  gridSpacing: number
  snap: boolean
  showGrid: boolean
  background: string
}

// Matches backend/internal/config.PaletteGroup.Items — a bare xsde2svg
// ObjectType code, the same vocabulary for every kind of palette entry,
// never a mix of codes and human-readable names: a real ElementSymbol's
// own shape, one of 4 fixed codes for a ConnectorKind the routing tool's
// next drawn connector should arm, or one of 2 fixed codes for this
// editor's own built-in non-Element widgets ('label'/'digitalDevice') —
// see lib/paletteItem.ts's own classifyPaletteItem, which turns one of
// these back into whichever kind it actually is (mirroring backend/
// internal/elements.Library's own ValidatePalette).
export type PaletteItem = string

// Matches backend/internal/config.PaletteGroup — one collapsible section
// of the Elements panel, in the order its own items should be shown. name
// is looked up via elementCatalogI18n's own categoryDisplayName, the same
// elementCatalog.category.<name> lookup an ElementSymbol's own category
// used to go through.
export interface PaletteGroup {
  name: string
  items: PaletteItem[]
}

export interface EditorConfig {
  editor: EditorDefaults
  voltageColors: VoltageColor[]
  stateColors: StateColor[]
  positionStates: PositionState[]
  fpiStateColors: StateColor[]
  // The install-wide default overlay text a FaultPassageIndicator (320003)
  // with no own propertyText draws — see backend/internal/config's own
  // Indicators.DefaultFPIText doc comment for why this is admin-configured
  // rather than hardcoded. "" falls back to the backend's own "FPI"
  // literal; diagramOps.placeElement/PropertiesPanel fall back to that
  // same literal too, for a config predating this field.
  defaultFpiText: string
  // The Elements panel's own layout — see backend/internal/config.Config's
  // own Palette doc comment.
  palette: PaletteGroup[]
}
