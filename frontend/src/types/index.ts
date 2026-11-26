// Mirrors slddoc's JSON shape (see slddoc internal/model/model.go) and the
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
  // The CIM Terminal it was imported from (see DiagramElement.mrid).
  mrid?: string
}

export interface Layer {
  id: number
  name: string
  // Drawing order: higher layers draw over lower ones; equal ones (all, by
  // default) are interleaved. See slddoc's Layer.Z.
  z?: number
}

export interface VoltageClass {
  id: number
  name: string
  color: string
}

// A diagram's own fill color for a switching device in state (backend slddoc.DiagramStateColor).
export interface DiagramStateColor {
  state: number
  color: string
}

export interface DiagramNode {
  id: number
  x: number
  y: number
  // The CIM ConnectivityNode it was imported from (see DiagramElement.mrid).
  mrid?: string
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
  // The Layer.id newly placed items go on (absent = the base layer, 0).
  activeLayer?: number
  // Also a wire jump where two buswork wires of the same voltage class cross
  // (absent = EditorDefaults.jumpSameVoltage).
  jumpSameVoltage?: boolean
  // What designation labels show (absent = 'full'), and the layer they go on (absent/0 = not created yet).
  designationFormat?: DesignationFormat
  designationLayer?: number
}

export type DesignationFormat = 'full' | 'short'

// Matches slddoc.FunctionKind.
export type FunctionKind =
  | 'voltageLevel'
  | 'incomingFeeder'
  | 'outgoingFeeder'
  | 'generator'
  | 'transformer'
  | 'busCoupler'
  | 'busbar'
  | 'measuring'
  | 'other'

// Matches slddoc.Function: one voltage level or unit of the IEC 81346 functional hierarchy (XSLD_FORMAT §4.11).
export interface DiagramFunction {
  id: number
  parent?: number
  kind: FunctionKind
  code: string
  number: number
  digits?: number
  voltage?: number
  pair?: number
  guessed?: boolean
}

// Matches the shared slddoc module's Class (github.com/PVKonovalov/slddoc).
export type ElementClass =
  | 'Breaker'
  | 'Disconnector'
  | 'Sectionalizer'
  | 'PowerCircuitBreaker'
  | 'LoadBreakSwitch'
  | 'GroundSwitch'
  | 'ShortCircuiter'
  | 'ShortCircuiterNoGround'
  | 'DisconnectorFuse'
  | 'SynchronousCompensator'
  | 'SynchronousMotor'
  | 'KnifeSwitch'
  | 'KnifeSwitch3'
  | 'Ground'
  | 'PowerTransformer'
  | 'Booster'
  | 'CurrentTransformer'
  | 'ChokeCoil'
  | 'Reactor'
  | 'ReactorShunt'
  | 'SurgeArrester'
  | 'Fuse'
  | 'Capacitor'
  | 'Resistor'
  | 'Thyristor'
  | 'CapacitorBank'
  | 'Starter'
  | 'Generator'
  | 'BusBarSection'
  | 'JunctionPoint'
  | 'Fork'
  | 'NonIntersection'
  | 'CableConnector'
  | 'CableJoint'
  | 'PowerPole'
  | 'Lamp'
  | 'LampOnPole'
  | 'LED'
  | 'Device'
  | 'ZoneDivision'
  | 'ConnectorPoint'
  | 'ConnectorArrow'
  | 'FaultPassageIndicator'
  | 'Rectangle'
  | 'SmallWindow'
  | 'Substation'
  | 'BlockingFilter'
  | 'PowerPlant'
  | 'AnchorPole'
  | 'AutomationDevice'
  | 'DisplayPanel'
  | 'Picture'
  | 'Arrow'
  | 'Circle'
  | 'Button'
  | 'WindowIcon'
  | 'Road'
  | 'PostPole'
  | 'Line'
  | 'Polygon'
  | 'Container'
  | 'Arc'
  | 'PackageSubstation'
  | 'EnclosedSubstation'
  | 'PowerflowIndicator'
  | 'Table'
  | 'Table2'
  | 'Load'
  | 'NetworkInfeed'
  | 'StaticVarCompensator'
  | 'TwoTerminalBox'

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
  // The CIM PowerTransformerEnd it was imported from (see DiagramElement.mrid).
  mrid?: string
  // Nameplate parameters (slddoc.TransformerWinding): kV, MVA, Ω, S, clock number.
  ratedU?: number
  ratedS?: number
  r?: number
  x?: number
  g?: number
  b?: number
  phaseAngleClock?: number
}

// Matches slddoc.Electrical: an element's or line's nameplate data, in CIM
// names and units (km, Ω, S, MVA, kV, MW, Mvar, A). Each class uses only its
// own subset (lib/electrical.ts).
export interface Electrical {
  length?: number
  r?: number
  x?: number
  bch?: number
  gch?: number
  r0?: number
  x0?: number
  b0ch?: number
  g0ch?: number
  ratedS?: number
  ratedU?: number
  minP?: number
  maxP?: number
  minQ?: number
  maxQ?: number
  nomU?: number
  bPerSection?: number
  gPerSection?: number
  maximumSections?: number
  normalSections?: number
  ratedCurrent?: number
  ipMax?: number
  p?: number
  q?: number
  capacitiveRating?: number
  inductiveRating?: number
  slope?: number
}

// Matches slddoc.BindingKind: what a binding supplies to its item.
export type BindingKind =
  | 'equipment'
  | 'meas1'
  | 'meas2'
  | 'jump'
  | 'setpointLA'
  | 'setpointLW'
  | 'setpointHW'
  | 'setpointHA'

// Matches slddoc.Binding: a link of a diagram item to an object of a SCADA data provider.
export interface Binding {
  source: string
  kind: BindingKind
  // Provider's key of the object, opaque outside the provider (RSDU: "tableId:id").
  ref: string
  option?: string
  // Unset/0 means 1; negative inverts a discrete value.
  scale?: number
  // Cached from the provider for display.
  name?: string
  type?: string
  uid?: string
  // What the next export writes: added (or its ref changed), or its option/scale changed; absent: the provider has it.
  status?: BindingStatus
}

export type BindingStatus = 'new' | 'edited'

// Matches slddoc.DeletedBinding: the provider's kind binding with ref of item (0: the diagram's object), removed or
// replaced by one with another ref; the next export deletes it.
export interface DeletedBinding {
  item: number
  source: string
  kind: BindingKind
  ref: string
}

// Matches slddoc.SchemeRef: the provider's scheme a diagram is linked and exported to; exported (RFC 3339) is when
// it was last exported, absent = never.
export interface SchemeRef {
  source: string
  ref: string
  exported?: string
  registered?: boolean
}

// Matches binding.SchemeGroup: a folder of the provider's schemes; parent absent for a root group.
export interface SchemeGroup {
  id: string
  parent?: string
  name: string
}

// Matches binding.Scheme: a provider's scheme; diagram is the editor diagram linked to it.
export interface ProviderScheme {
  ref: string
  group: string
  name: string
  alias?: string
  type?: string
  typeId?: string
  fileName?: string
  updated?: string
  diagram?: string
}

export interface SchemeTree {
  groups: SchemeGroup[]
  schemes: ProviderScheme[]
}

// Matches binding.Candidate: a scheme proposed for a diagram; 'path' when its file name matches the diagram's path,
// 'name' when only the base name matches (ambiguous).
export interface SchemeCandidate extends ProviderScheme {
  match: 'path' | 'name'
}

// A diagram's link to a scheme as the file list shows it: the first three from the server (storage.Scheme*), the
// last two after asking the provider whether the scheme exists.
export type SchemeStatus = 'linked' | 'exported' | 'changed' | 'missing' | 'unknown'

export interface DiagramElement {
  id: number
  class: ElementClass
  shape: string
  name?: string
  voltage?: number
  layer: number
  // Editor group id (an id from the shared sequence; unset = not grouped),
  // rendered as data-group. Connectors, labels and digital devices have it too.
  group?: number
  x: number
  y: number
  orient?: number
  // Flips the symbol template horizontally in its own local frame, applied
  // before orient's own rotation — matches slddoc's own
  // Mirror field. Meaningless for a BusBarSection (its own drawn `points`
  // are already absolute geometry, no local template to flip).
  mirror?: boolean
  // slddoc's Element.Scale: the xsde2svg size step, each step √2 larger
  // (unset = 0, the library's own size). Only for a symbol whose
  // ElementSymbol.scalable is set; see diagramOps.symbolTerminals.
  scale?: number
  // slddoc's Element.Span: a lead shape's (ElementSymbol.leads) distance
  // between its two terminals in diagram units; unset = the library's own
  // spacing at its size step. See diagramOps.symbolTerminals.
  span?: number
  // Also a PowerflowIndicator's (shape 320001) own two-way arrow direction:
  // nil/0 draws "→", any other value draws "←" — not a real switching
  // status, matching slddoc's own Element.State doc
  // comment.
  state?: number | null
  position?: number | null
  fillOff?: string
  fillOn?: string
  // Also a PostPole's (shape 292) own drawn circle radius, doubling as its
  // Square variant's own half-width — see square below, and slddoc's own
  // Element.Radius doc comment for why one field covers both.
  // Also a Circle's (shape 4) radius, its center being x/y.
  radius?: number
  // Rectangle (shape 3) or Circle (shape 4) only — its own interior
  // color, matching slddoc's own Element.Fill. Not a
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
  // (shape 335)/Line's (shape 1) own line color, a Button's own box
  // border color, or a PostPole's (292) own marker border color — same
  // free-text convention as fill.
  stroke?: string
  // A Rectangle's/Circle's own border thickness, an Arrow's/Road's/
  // Line's own line thickness, or a Button's own box border thickness,
  // matching slddoc's own Element.StrokeWidth. Unset/0
  // means the real xsde2svg default of 1 for every one of these except
  // Road, whose own unset default is much thicker (see that field's own
  // Go doc comment). Unused by PostPole (292) — its own border is always
  // 1, matching the real source's own hardcoded value.
  strokeWidth?: number
  // Line (shape 1) only: Modus composite style names, comma-separated (slddoc Element.Styles).
  styles?: string
  // Line only: halo colors changed from the default, "name:color,…" (slddoc Element.HaloColors).
  haloColors?: string
  // Arrow (shape 2) only — draws its own open chevron arrowhead at both
  // points instead of just the second one, matching backend/internal/
  // slddoc's own Element.DoubleHeaded.
  doubleHeaded?: boolean
  // Booster (shape 6) only — draws its own regulation arrow, matching
  // slddoc's own Element.TapChanger (a PowerTransformer marks its
  // regulated winding with TransformerWinding.tapChanger instead).
  tapChanger?: boolean
  // PostPole (shape 292) only — draws its own square marker instead of
  // its default round one, matching slddoc's own
  // Element.Square.
  square?: boolean
  // The side a symbol with a {terminal:top|bottom} template (Static var compensator) has its terminal on; unset =
  // top (slddoc's Element.Terminal).
  terminal?: TerminalDirection
  // Line (shape 1) only — its own dash pattern, matching backend/
  // slddoc's own Element.LineStyle. Reuses ConnectorLineStyle
  // (the same solid/dashed/dashDot choice a CableLine connector's own
  // lineStyle already offers), but resolved through its own real dash
  // values, distinct from CableLine's — see that Go field's own doc
  // comment. Empty/unset means solid, unlike Connector.lineStyle's own
  // empty-means-dashed default.
  lineStyle?: ConnectorLineStyle
  // PackageSubstation (shape 385) only — selects between its own two real
  // appearance variants, matching slddoc's own
  // Element.NType: 0/unset draws a box-in-box pictogram with a lead stub,
  // 1 draws a plain downward-pointing triangle instead.
  nType?: number
  // PackageSubstation (385) or EnclosedSubstation (386) — a short overlay
  // label (e.g. a transformer's own power rating, "160") drawn centered
  // on the shape, staying upright regardless of Orientation/Mirror.
  // Matches slddoc's own Element.PropertyText — see its
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
  // slddoc's own Element.TextColor. Unset falls back to
  // white, the more common real corpus case. Also used by
  // PowerflowIndicator (320001) for its own arrow glyph's fill color;
  // unset falls back to black there instead, matching Line's own default.
  textColor?: string
  // Button (shape 113) only — draws its own PropertyText in bold, matching
  // slddoc's own Element.Bold.
  bold?: boolean
  // Container (shape 310) only — its caption's font size (unset = 14),
  // anchor offset from the outline's top-left, and text-anchor/
  // dominant-baseline (unset = middle), matching slddoc's own
  // Element.TextSize/TextDx/TextDy/TextAnchor/TextBaseline. Its orient
  // rotates the caption.
  textSize?: number
  textDx?: number
  textDy?: number
  textAnchor?: string
  textBaseline?: string
  // Connector arrow (shape 83) only — its total length (unset = 30) and
  // arrowhead outline color, matching slddoc's own Element.Length/
  // HeadStroke. Its orient is its direction (0 = pointing right, any
  // angle), stroke its line color and fill its arrowhead fill.
  length?: number
  headStroke?: string
  // Arc (shape 9): its own SVG arc parameters, stored exactly as the
  // arc command writes them (points holds its start and end), matching
  // slddoc's own Element.RadiusX/RadiusY/LargeArc/Sweep. A Rectangle's
  // (shape 3) rx is its corner radius (unset = square corners).
  rx?: number
  ry?: number
  largeArc?: boolean
  sweep?: boolean
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
  // Table2 (shape 313) only — its own row/column grid, matching backend/
  // slddoc's own Element.RowHeights/ColumnWidths/Cells. X/Y is
  // the grid's own top-left anchor (unlike every Points-based decorative
  // shape); rowHeights[i]/columnWidths[j] is row i's/column j's own real
  // size, cumulative-summed from that anchor to place each cell. A (row,
  // col) with no matching TableCell entry, and not covered by a merged one, is not drawn.
  rowHeights?: number[]
  columnWidths?: number[]
  cells?: TableCell[]
  // An AutomationDevice's (shape 103) or DisplayPanel's (102) On text and text color; propertyText/
  // textColor are its Off ones.
  propertyTextOn?: string
  textColorOn?: string
  // A Substation's (shape 360) sector fills, 1–4, each a VoltageClass id.
  sectors?: { voltage?: number }[]
  // A Picture's (shape 11) image as a data URI. Stripped from live-render
  // requests (lib/picture.ts).
  href?: string
  electrical?: Electrical
  // The CIM class this element exports as, one of its symbol's cim list; unset means the default.
  cim?: string
  // The mRID of the CIM equipment it was imported from, which a CIM export keeps; unset for items drawn here or
  // copied (lib/diagramOps' placeCustomElement and extractSelection drop it).
  mrid?: string
  // The functional unit (DiagramFunction.id) it belongs to; absent = none.
  function?: number
  // Decimal places of a shown value, the provider's display features (comma-separated), and the SCADA bindings
  // (at most one per kind) — slddoc's Element.Precision/Features/Bindings.
  precision?: number
  features?: string
  // The provider's component type the item is exported as (RSDU: VS_TCOMP.ID); absent: chosen by shape.
  componentType?: string
  // precision, features or componentType changed since the last export.
  componentEdited?: boolean
  bindings?: Binding[]
}

// Matches slddoc.TableCell: one cell of a Table2 (shape 313) grid at its top-left position row/col. A merged cell spans
// rowSpan rows and colSpan columns (absent: 1); the positions it covers have no cell. text lines are split by "\n";
// fontSize is in px (absent: 11); alignH absent is center, alignV absent is middle.
export interface TableCell {
  row: number
  col: number
  rowSpan?: number
  colSpan?: number
  text?: string
  fill?: string
  textColor?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  alignH?: 'left' | 'right'
  alignV?: 'top' | 'bottom'
}

// Matches slddoc.ConnectorKind.
export type ConnectorKind = 'BusbarWire' | 'OverheadLine' | 'CableLine' | 'BusWork' | 'LinkToObject'

// Matches slddoc.ConnectorLineStyle — a CableLine
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
  // (see slddoc internal/render/render.go writeNamedLine).
  name?: string
  voltage?: number
  layer: number
  group?: number
  dashed?: boolean
  // Only meaningful when kind === 'CableLine' — see ConnectorLineStyle's
  // own doc comment.
  lineStyle?: ConnectorLineStyle
  from: number
  to: number
  points: Point[]
  // OverheadLine/CableLine parameters, or a LinkToObject's load.
  electrical?: Electrical
  // The CIM class a LinkToObject exports as; unset means the default.
  cim?: string
  // The CIM equipment it was imported from, and its Terminals at from and to (see DiagramElement.mrid).
  mrid?: string
  fromMrid?: string
  toMrid?: string
  // Precision, features and bindings as on DiagramElement.
  precision?: number
  features?: string
  // The provider's component type the item is exported as (RSDU: VS_TCOMP.ID); absent: chosen by shape.
  componentType?: string
  // precision, features or componentType changed since the last export.
  componentEdited?: boolean
  bindings?: Binding[]
}

export interface Label {
  id: number
  for?: number
  layer: number
  group?: number
  x: number
  y: number
  size: number
  anchor?: string
  bold?: boolean
  underline?: boolean
  italic?: boolean
  color?: string
  valign?: string
  font?: string
  // Clockwise turn in degrees about x/y, in (-180, 180]; absent = level (slddoc Label.Rotate).
  rotate?: number
  text: string
  // Precision, features and bindings as on DiagramElement.
  precision?: number
  features?: string
  // The provider's component type the item is exported as (RSDU: VS_TCOMP.ID); absent: chosen by shape.
  componentType?: string
  // precision, features or componentType changed since the last export.
  componentEdited?: boolean
  bindings?: Binding[]
}

// A shape-134 SCADA-style analog readout — shares Label's own text-styling
// fields, but its content isn't free text: value is a placeholder/default
// display value (this editor never binds to a live data source), name is
// the SCADA tag/point name (informational only, rendered as data-name), and
// unit is an optional suffix rendered as its own inline tspan.
export interface DigitalDevice {
  id: number
  layer: number
  group?: number
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
  // As in DiagramElement.
  precision?: number
  features?: string
  // The provider's component type the item is exported as (RSDU: VS_TCOMP.ID); absent: chosen by shape.
  componentType?: string
  // precision, features or componentType changed since the last export.
  componentEdited?: boolean
  bindings?: Binding[]
}

// A bar instrument (320008), slddoc's BarInstrument: a value drawn as a bar along a track from min to max, coloured by
// the zone of the value. x/y is the track's min end; orient 'h' (absent) grows right, 'v' up. length/thickness and
// the show* options absent take the bar_instrument config. The setpoints absent are not set; bound, SCADA overrides
// them at run time.
export interface BarInstrument {
  id: number
  layer: number
  group?: number
  x: number
  y: number
  orient?: 'h' | 'v'
  length?: number
  thickness?: number
  name?: string
  unit?: string
  min: number
  max: number
  origin?: number
  lowAlarm?: number
  lowWarning?: number
  highWarning?: number
  highAlarm?: number
  deadband?: number
  value: number
  valueSize?: number
  showValue?: boolean
  showScale?: boolean
  showZones?: boolean
  colors?: BarColors
  precision?: number
  features?: string
  componentType?: string
  componentEdited?: boolean
  bindings?: Binding[]
}

export interface BarColors {
  track?: string
  normal?: string
  warning?: string
  alarm?: string
  bad?: string
}

// GET /api/config's barInstrument (config.BarInstrument, validated: every field set).
export interface BarInstrumentConfig {
  length: number
  thickness: number
  valueSize: number
  showValue: boolean
  showScale: boolean
  showZones: boolean
  colors: Required<BarColors>
}

// One unsupported xsde2svg data-type code an .svg import skipped: its
// human-readable name (slddoc.ObjectTypeName, "" when unknown) and how many
// top-level nodes carried it.
export interface ImportSkippedEntry {
  code: string
  name: string
  count: number
}

// POST /api/import/svg's own report (the backend's api.importReport):
// what slddoc.Extract captured from a dropped .svg, plus what it couldn't —
// skipped lists unsupported data-type codes (code-sorted), failed lists
// element ids whose geometry didn't parse.
// One xsde2svg diagnostic from POST /api/import/xsde: page is 1-based, 0 for the whole document.
export interface ConverterMessage {
  level: 'INFO' | 'WARN' | 'ERROR'
  page: number
  text: string
}

export interface ImportReport {
  elements: number
  connectors: number
  labels: number
  digitalDevices: number
  barInstruments: number
  nodes: number
  skipped: ImportSkippedEntry[]
  failed: string[]
}

// GET /api/diagrams/open: the diagram as repaired on the server (repaired
// tells whether that changed anything, so the editor marks it unsaved) and its
// interactive SVG for the canvas.
export interface OpenedDiagram {
  diagram: Diagram
  svg: string
  repaired: boolean
  warning?: string
}

// The wire shape (a Go nil slice serializes as JSON null): use
// normalizeDiagram in lib/api.ts to get the array-always shape below
// everywhere else in the app.
// A diagram's tracing image (slddoc's TracingImage): file is the image file stored next to the diagram on the
// server (api.tracingImageUrl), x/y/width/height its place in diagram units, opacity 0…1.
export interface DiagramTracingImage {
  file: string
  x: number
  y: number
  width: number
  height: number
  opacity: number
  hidden?: boolean
}

export interface DiagramWire {
  width: number
  height: number
  source?: string
  lastId?: number
  editor?: EditorSettings
  tracingImage?: DiagramTracingImage
  layers: Layer[] | null
  voltageClasses: VoltageClass[] | null
  stateColors?: DiagramStateColor[]
  nodes: DiagramNode[] | null
  elements: DiagramElement[] | null
  connectors: Connector[] | null
  labels: Label[] | null
  digitalDevices: DigitalDevice[] | null
  barInstruments?: BarInstrument[] | null
  history?: Revision[] | null
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
  tracingImage?: DiagramTracingImage
  // The provider's scheme this diagram is exported to, and the object the whole diagram is bound to.
  scheme?: SchemeRef
  object?: Binding
  deletedBindings?: DeletedBinding[]
  layers: Layer[]
  voltageClasses: VoltageClass[]
  // Absent until the diagram is first saved; the server then copies config.stateColors in.
  stateColors?: DiagramStateColor[]
  nodes: DiagramNode[]
  elements: DiagramElement[]
  connectors: Connector[]
  labels: Label[]
  digitalDevices: DigitalDevice[]
  barInstruments: BarInstrument[]
  functions?: DiagramFunction[]
  // Save history, oldest first. Appended by the server on every save
  // (backend storage.SaveRevision); the editor never changes it.
  history?: Revision[]
}

// Matches slddoc.Revision: one save of a diagram (time is RFC 3339).
// Matches slddoc.CIMWarning: something the CIM export filled in or left out.
// fields name Electrical/TransformerWinding keys ("2:ratedU" = winding 2's)
// or "connectionKind".
export interface CIMWarning {
  kind: 'missing' | 'voltage' | 'noTerminal' | 'notExported' | 'openEnd' | 'shorted' | 'guessedVoltage' | 'windings' | 'mrid' | 'mridFormat'
  item: 'element' | 'connector' | 'voltageClass'
  id: number
  fields?: string[]
}

export interface Revision {
  time: string
  ip?: string
}

// Matches backend presence.Status (POST /api/presence).
export interface PresenceStatus {
  // The other tabs with the same diagram open, in the order they opened it (since: RFC 3339).
  others: { ip: string; since: string }[]
  lastSave?: Revision
}

// Matches backend presence.OpenTab (GET /api/presence/open): another tab with diagram open (since: RFC 3339).
export interface OpenTab {
  diagram: string
  ip: string
  since: string
}

// Matches backend/internal/storage.Entry — one item in a single directory's
// listing (GET /api/diagrams?dir=...): either a subdirectory (isDir true,
// modTime the directory's own, not especially meaningful) the File panel's
// browser can navigate into, or a stored diagram (isDir false). name is
// always the bare last path segment, never the full path from the store's
// own root — the File panel joins it with whatever directory is currently
// browsed to get a diagram's real openable name.
export interface DiagramEntry {
  name: string
  isDir: boolean
  modTime: string
  // The scheme the diagram is linked to and its status, as the server knows it.
  scheme?: SchemeRef
  schemeStatus?: 'linked' | 'exported' | 'changed'
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
  // Whether a placed element of this shape takes a size step
  // (DiagramElement.scale): it is drawn from template.
  scalable?: boolean
  // Whether a placed element of this shape draws its leads to a
  // per-instance length (DiagramElement.span): breakers, disconnectors and
  // similar two-terminal devices.
  leads?: boolean
  // The CIM classes an element of this shape can export as, the default first (the cim.classes configuration);
  // absent for a shape that isn't exported as equipment.
  cim?: string[]
}

// Matches backend/internal/api.customElement: one entry of the Elements
// palette's "Custom elements" group — a whole predefined diagram fragment
// (an ordinary .xsld saved in the server's custom-elements directory),
// placed as a copy of its contents by diagramOps.placeCustomElement. svg is
// its Static rendering, used for the palette icon.
export interface CustomElement {
  name: string
  diagram: Diagram
  svg: string
}

export interface VoltageColor {
  name: string
  color: string
}

// A voltage class of a CIM import that no voltageColors preset names (POST /api/import/cim's unmatchedVoltages):
// the import gave it the color of preset, the preset nearest in voltage ("" and grey when none); pages counts the
// pages using it.
export interface UnmatchedVoltage {
  name: string
  preset: string
  color: string
  pages: number
}

// Whose diagram layout a CIM import follows (POST /api/import/cim's layout): this editor's own export, another
// tool's, or none (laid out automatically).
export type CimLayoutKind = 'own' | 'foreign' | ''

// The header of a CIM document (slddoc.CIMHeader, IEC 61970-552 md:FullModel): who made it and when, as it states.
export interface CimHeader {
  profiles?: string[]
  description?: string
  authoritySet?: string
  created?: string
}

// A transformer of a CIM import whose windings all have one voltage (POST /api/import/cim's sameVoltageTransformers,
// slddoc.CIMSameVoltageTransformer): asked by CimWindingsDialog before the import goes on.
export interface CimSameVoltageTransformer {
  mrid: string
  name: string
  windings: CimWindingVoltage[]
}

// One winding of a CimSameVoltageTransformer: its PowerTransformerEnd's mRID and end number, the voltage the model
// gives it and its rated voltage (kV).
export interface CimWindingVoltage {
  mrid: string
  end: number
  name?: string
  kv: number
  ratedU?: number
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
  jumpSameVoltage: boolean
  // Order of voltage lists (dropdowns), by the voltage a class name reads as.
  voltageOrder: VoltageOrder
}

export type VoltageOrder = 'ascending' | 'descending'

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

// One line_halos entry: a Modus composite style, its default halo colour, and gap (a background stripe inside).
export interface LineHaloConfig {
  style: string
  color: string
  gap?: boolean
}

export interface EditorConfig {
  editor: EditorDefaults
  voltageColors: VoltageColor[]
  // Max Euclidean RGB distance at which a diagram's voltage class color is
  // offered the nearest voltageColors preset (backend config
  // voltage_color_tolerance; 0 = exact only). Optional for an older server.
  voltageColorTolerance?: number
  stateColors: StateColor[]
  positionStates: PositionState[]
  fpiStateColors: StateColor[]
  // Line composite styles drawn as a halo, with default colours (backend config line_halos). Optional for an older
  // server.
  lineHalos?: LineHaloConfig[]
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
  // Placement hot keys (config hot_keys, lower-cased): key → palette item
  // code. Absent from an older server, or when none are configured.
  hotKeys?: Record<string, string>
  // Equipment shape code → IEC 81346-2 letter code (config letter_codes), and the hierarchy's letters (config
  // designations). Absent from an older server.
  letterCodes?: Record<string, string>
  designations?: DesignationsConfig
  // The CIM classes a connector kind exported as equipment can stand for, default first (cim.classes "28").
  cimConnectorClasses?: Partial<Record<ConnectorKind, string[]>>
  // The SCADA binding provider ("" = bindings off, no binding UI) and whether it can export (backend config
  // bindings). Absent from an older server.
  bindings?: BindingsConfig
  // The default look of a bar instrument (config bar_instrument). Absent from an older server.
  barInstrument?: BarInstrumentConfig
}

// Matches backend config.Designations; units are keyed by its unit kind names (incoming_feeder, ...).
export interface DesignationsConfig {
  voltageLevels: { maxKv: number; code: string }[]
  fallbackVoltageCode: string
  units: Record<string, { code: string; digits: number }>
}

// POST /api/designations: slddoc.DesignationPlan. Functions it creates have negative ids.
export interface DesignationRow {
  element: number
  function: number
  oldName?: string
  name: string
  bound?: boolean
  mrid?: boolean
  exported?: boolean
  duplicate?: boolean
  // Its unit reaches no busbar (in a diagram with busbars): likely a wire not joined.
  isolated?: boolean
}

export interface DesignationPlan {
  functions: DiagramFunction[]
  rows: DesignationRow[]
  unplaced: number[]
  // Elements in no unit (busbars, shapes without a letter code) and the voltage level function they lie in.
  levels: { element: number; function: number }[]
}

export interface BindingsConfig {
  provider: string
  canExport: boolean
  // Diagrams can be linked to the provider's schemes.
  schemes?: boolean
  // The provider can check a diagram before an export.
  exportCheck?: boolean
  // A linked scheme's bindings can be imported.
  import?: boolean
  // A scheme's picture can be read from its viewer's storage and imported (Edit from RSDU…).
  fetch?: boolean
}

// POST /api/bindings/schemes/fetch: a scheme's picture imported as an .svg import, with the folder and name proposed
// for its diagram.
export interface FetchedScheme {
  diagram: Diagram
  report: ImportReport
  file: string
  folder: string
  name: string
}

// Matches binding.SchemeType.
export interface SchemeType {
  id: string
  name: string
}

// Matches binding.ExportIssue: code names the finding (the frontend words it); item, kind and shape the diagram item
// it is about; schemes the provider's schemes involved; detail extra text.
export interface ExportIssue {
  code: string
  severity: 'error' | 'warning'
  item?: number
  kind?: 'element' | 'device'
  shape?: string
  schemes?: ProviderScheme[]
  detail?: string
}

// Matches binding.ExportCheck.
export interface ExportCheck {
  ok: boolean
  scheme?: ProviderScheme
  schemeType?: SchemeType
  fileName: string
  svgPath?: string
  bound: number
  defaultGroup?: string
  issues: ExportIssue[]
}

// Matches binding.ExportRequest: register a new scheme or export to the linked one; "" keeps a linked scheme's own.
export interface ExportRequest {
  register: boolean
  name: string
  alias: string
  group: string
  // Only count what the export would write; nothing is written or saved.
  preview?: boolean
}

// Matches binding.ExportChanges: rows an export wrote.
export interface ExportChanges {
  inserted: number
  updated: number
  deleted: number
}

// Matches api.SVGExportResult: the scheme link with its new export time and where the picture went.
export interface SVGExportResult {
  scheme: SchemeRef
  svg: string[]
}

// Matches binding.ExportResult.
export interface ExportResult {
  scheme: SchemeRef
  registered: boolean
  // changes are what the export would write (a preview); nothing was.
  preview?: boolean
  components: number
  bindings: number
  changes: ExportChanges
  skipped: ExportIssue[]
  svg?: string[]
  svgError?: string
}

// Matches binding.KindInfo: a binding kind as the provider offers it; an empty name is named by the frontend.
export interface BindingKindInfo {
  kind: BindingKind
  name: string
  defaultOption?: string
}

// Matches binding.Dictionaries (GET /api/bindings/dictionaries).
export interface BindingDictionaries {
  kinds: BindingKindInfo[]
  options: { alias: string; name: string; group?: string; groupName?: string }[]
  features: { alias: string; name: string; mask: number }[]
  // The types an item can be exported as (RSDU: VS_TCOMP of the scheme type); shape: the symbol code it stands for.
  componentTypes?: { id: string; name: string; shape?: string }[]
}

// Matches binding.Section: a node of the provider's top-level object tree. section, when set, is the id the
// catalog, list and search calls take; ref binds the node itself.
export interface BindingSection {
  id: string
  name: string
  icon?: number
  section?: string
  ref: string
  children?: BindingSection[]
}

// Matches binding.Node: a catalog node of a section; id is what the list call takes as node.
export interface BindingNode {
  id: string
  name: string
  alias?: string
  typeName?: string
  icon?: number
  ref: string
  children?: BindingNode[]
}

// Matches binding.Object: an object listed under a catalog node.
export interface BindingObject {
  id: string
  ref: string
  name: string
  typeAlias?: string
  class?: string
  uid?: string
  cvalif?: number
  scale?: number
}

// Matches binding.Resolved (GET /api/bindings/object): an object with what a binding caches of it and the kind and
// option the provider suggests.
export interface BindingResolved {
  ref: string
  name: string
  type?: string
  typeName?: string
  uid?: string
  parentRef?: string
  kind: BindingKind
  option?: string
}

// POST /api/bindings/objects: the refs found, and those that don't exist or can't be bound.
export interface BindingResolveResult {
  objects: Record<string, BindingResolved>
  missing: string[]
}

// Matches binding.Hit: a search match; node is the catalog node to reveal.
export interface BindingHit {
  ref: string
  name: string
  kind: 'catalog' | 'list'
  node: string
  // The type's name (a catalog node's type, a list object's type alias); absent when it has none.
  typeName?: string
}

// Matches binding.SearchResult.
export interface BindingSearchResult {
  hits: BindingHit[]
  truncated: boolean
}

// The payload of an object dragged from the Objects panel (drag data type OBJECT_DRAG_TYPE in lib/api.ts).
export interface DraggedObject {
  source: string
  ref: string
  name: string
  type: string
}

// Matches binding.Component: what a provider's scheme holds for item; shape is its component type's shape code.
export interface SchemeComponent {
  item: number
  shape?: string
  // The component's type (RSDU: VS_TCOMP.ID).
  type?: string
  precision?: number
  features?: string
  bindings: Binding[]
}

// Matches binding.SchemeBindings: a scheme's bindings, read for import; issues are warnings.
export interface SchemeBindings {
  scheme: ProviderScheme
  object?: Binding
  components: SchemeComponent[]
  issues: ExportIssue[]
}
