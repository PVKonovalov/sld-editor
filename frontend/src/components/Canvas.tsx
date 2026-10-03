import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { useDiagramContext, type SelectionKind } from '../state/useDiagramContext'
import * as api from '../lib/api'
import * as diagramOps from '../lib/diagramOps'
import { arcBounds, arcMidpoint, arcPathD, circularArcThrough, defaultArcBulge, type ArcParams } from '../lib/arc'
import { clientToDiagramPoint, nearestSegmentOnPolyline, snapPointOnSegment, snapValue } from '../lib/geometry'
import { fillPictureHrefs, readImageFile } from '../lib/picture'
import { t } from '../i18n'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { SaveCustomElementDialog } from './SaveCustomElementDialog'
import type { Diagram, DiagramElement, Connector, ConnectorKind, Label, DigitalDevice, Point } from '../types'

const BUSBAR_SHAPE = '24'
const RECTANGLE_SHAPE = '3'
const SMALL_WINDOW_SHAPE = '319'
const PICTURE_SHAPE = '11'
const CIRCLE_SHAPE = '4'
const ARROW_SHAPE = '2'
const BUTTON_SHAPE = '113'
const WINDOW_ICON_SHAPE = '302'
const AUTOMATION_DEVICE_SHAPE = '103'
const ROAD_SHAPE = '335'
const LINE_SHAPE = '1'
const POLYGON_SHAPE = '16'
const CONTAINER_SHAPE = '310'
// Shapes drawn pen-tool style, one click per vertex: Polygon, and Container
// (a closed outline with a caption).
const PEN_DRAWN_SHAPES: ReadonlySet<string> = new Set([POLYGON_SHAPE, CONTAINER_SHAPE])
const ARC_SHAPE = '9'
// An Arc's (shape 9) own bulge handle, alongside its two real Points'
// own handles — a virtual point index for pointDrag, committed through
// diagramOps.updateArcBulge rather than updateBusbarPoint.
const ARC_BULGE_INDEX = 2

// The ArcParams an Arc element draws with, optionally with one of its
// handles (start 0, end 1, bulge ARC_BULGE_INDEX) moved to point — shared
// by the live handle-drag preview and every other place Canvas redraws an
// arc itself rather than waiting on the backend's own render.
function elementArc(el: DiagramElement, moved?: { index: number; point: Point }): ArcParams | null {
  if (!el.points || el.points.length < 2) return null
  const base: ArcParams = {
    start: el.points[0],
    end: el.points[1],
    rx: el.rx ?? 0,
    ry: el.ry ?? 0,
    largeArc: !!el.largeArc,
    sweep: !!el.sweep,
  }
  if (!moved) return base
  if (moved.index === 0) return { ...base, start: moved.point }
  if (moved.index === 1) return { ...base, end: moved.point }
  const params = circularArcThrough(base.start, base.end, moved.point)
  return params ? { ...base, ...params } : base
}
const TABLE_SHAPE = '312'
// Shapes placed by dragging out two opposite points rather than a single
// click — see diagramOps.POINTS_BASED_CLASSES for the element-class
// equivalent used once one's already on the diagram. Table2 (313) is
// deliberately not here — it's click-to-place, like PostPole/Lamp (see
// diagramOps.table2Defaults' own doc comment for why its own grid
// geometry can't be expressed as two dragged corners at all).
const DRAG_TO_DRAW_SHAPES: ReadonlySet<string> = new Set([
  BUSBAR_SHAPE,
  RECTANGLE_SHAPE,
  SMALL_WINDOW_SHAPE,
  PICTURE_SHAPE,
  CIRCLE_SHAPE,
  ARROW_SHAPE,
  BUTTON_SHAPE,
  WINDOW_ICON_SHAPE,
  AUTOMATION_DEVICE_SHAPE,
  ROAD_SHAPE,
  LINE_SHAPE,
  ARC_SHAPE,
  TABLE_SHAPE,
])
const HIGHLIGHT = '#3b82f6'
const CONNECT_TARGET_COLOR = '#22c55e'
// How many grid cells, per side, get batched into one grid-dot pattern
// tile — see the grid overlay's own comment, below, for why (a Chromium
// rendering quirk with a densely-tiled SVG <pattern> under a live CSS
// scale). 10 keeps each tile's own dot count (100) trivial while cutting
// the number of tile boundaries roughly 100-fold versus one dot per tile.
const GRID_TILE_FACTOR = 10
// Every (row, col) dot position within one batched tile, in grid-cell
// units (multiply by gridSpacing for actual coordinates) — computed once
// at module load rather than per render, since GRID_TILE_FACTOR is fixed.
const GRID_TILE_DOTS: [number, number][] = Array.from({ length: GRID_TILE_FACTOR }, (_, row) =>
  Array.from({ length: GRID_TILE_FACTOR }, (_, col) => [row, col] as [number, number]),
).flat()
// Half-length of a terminal marker's "X", in diagram units.
const TERMINAL_MARK_SIZE = 4 / 3
// A terminal/node mark's color: connected (a wire or another port on its
// node) vs free.
const TERMINAL_CONNECTED_COLOR = '#22c55e'
const TERMINAL_FREE_COLOR = 'red'
// Half-length of a selected Label/DigitalDevice's own anchor-point "X"
// marker — same shape convention as TERMINAL_MARK_SIZE, just larger since
// it's a standalone selection indicator rather than a small always-drawn
// terminal mark.
const SELECTION_MARK_SIZE = 6
// How close (diagram units) a click/hover needs to be to an element's own
// terminal (or, mid-route, any point along a busbar) to count as hitting
// it, rather than the element's ordinary body — deliberately tight (a
// Breaker's terminals sit 10 units out from a ±7-unit box) so it doesn't
// swallow the rest of the element and break plain select/drag there.
const TERMINAL_HIT_RADIUS = 5
// How close (diagram units) a click must land to a polygon draft's first
// vertex to close the path there — the pen tool's "close path" target.
const POLYGON_CLOSE_RADIUS = 5
// Padding (diagram units) added around a symbol element's own real
// computed bounding box — see elementBoxes' own doc comment — for its
// selection-highlight rect, and, separately (and more tightly), for the
// click-tolerance fallback in findElementBoxHit. Matches sld-viewer's own
// equivalent constants (its own highlight pad and BBOX_HIT_PAD), the
// reference this project's UI/UX follows.
const BOX_HIGHLIGHT_PAD = 6
// Screen pixels a press must travel before it counts as drawing a
// selection frame rather than a plain click on empty canvas.
const MARQUEE_MIN_DRAG = 4
// Grid steps a keyboard paste lands right and down from the original.
const PASTE_OFFSET_STEPS = 2

type Box = { x: number; y: number; width: number; height: number }

function pointsBox(points: Point[]): Box {
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function pointInBox(p: Point, b: Box): boolean {
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height
}

function boxInside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

function boxesIntersect(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
}

// Whether segment a-b properly crosses any edge of box (an endpoint inside
// it is checked separately).
function segmentCrossesBox(a: Point, b: Point, box: Box): boolean {
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ]
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  const straddles = (d1: number, d2: number) => (d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)
  return corners.some((c, i) => {
    const d = corners[(i + 1) % 4]
    return straddles(cross(c, d, a), cross(c, d, b)) && straddles(cross(a, b, c), cross(a, b, d))
  })
}
const BOX_HIT_PAD = 2

type Ghost = { ids: number[]; dx: number; dy: number }
type NewBusbar = { start: Point; current: Point }
type PointDrag = { elementId: number; pointIndex: number; point: Point }
// A symbol element's own real rendered bounding box, in diagram-space
// (post rotate+translate), top-left + size. Computed from the backend-
// rendered SVG's own <g> node (getBBox(), which returns local pre-transform
// geometry) mapped through the same rotate/translate math
// diagramOps.placeLocalPoint already uses for a shape's declared
// Terminals — see elementBoxes' own doc comment for why a fixed-radius
// circle (this editor's previous approach) doesn't work here.
type ElementBox = { x: number; y: number; width: number; height: number }
// An in-progress drag of a selected Label's own anchor — mirrors Ghost's
// dx/dy-offset convention (single label, not a set, so no ids array), kept
// separate from Ghost so an element drag's own selectedElements-hiding
// logic isn't affected by dragging a label at the same time (they're
// mutually exclusive selections anyway, but the state itself stays scoped).
type LabelDrag = { id: number; dx: number; dy: number }
// The same drag convention as LabelDrag, for a selected DigitalDevice's own
// anchor instead of a Label's.
type DigitalDeviceDrag = { id: number; dx: number; dy: number }
type ContextMenuState = { x: number; y: number; diagramPoint: Point; elementId: number | null; connectorId: number | null }
// A valid place for a route to start or finish: either an element's own
// terminal/busbar point ('element'), or a point along an already-drawn
// connector's own line ('connector', tapping into it as a junction — see
// diagramOps.drawConnectorPathToConnector/drawConnectorPathFromConnector/
// drawConnectorBetweenConnectors/drawDanglingConnectorPathFromConnector).
// Doubles as both the in-progress hover/finish indicator (connectTarget
// state) and, once a route starts, its own fixed starting anchor
// (Routing.from) — a plain element/busbar terminal only ever needs a
// plain click to start from, while starting from a connector's own line
// additionally requires Ctrl/Cmd (see handleMouseDown) since a plain click
// there already means select/drag.
type ConnectTarget =
  | { kind: 'element'; elementId: number; point: Point }
  | { kind: 'connector'; connectorId: number; segmentIndex: number; point: Point }
// A route's own starting anchor: either a genuine ConnectTarget (an
// element/busbar terminal, or a connector tap — see ConnectTarget's own
// doc comment), or a bare 'point' in mid-air with nothing there at all —
// double-clicking empty canvas while not already routing starts one of
// these (see handleWrapperDoubleClick), letting a diagram be drawn
// wire-first instead of always needing an element to exist before a wire
// can touch it. Never something findConnectionTarget itself returns —
// only ConnectTarget's own two kinds are real hit-test results.
type RouteStart = ConnectTarget | { kind: 'point'; point: Point }
// An in-progress click-to-route: path always holds at least the start
// point (from's own terminal/anchor, connector tap, or bare mid-air
// point), each further click appending one more anchored vertex (see
// appendOrthogonalPoint).
type Routing = { from: RouteStart; path: Point[] }
// An in-progress drag of an already-drawn connector's own geometry: an
// existing interior vertex (kind 'vertex', index into its points array), a
// segment's midpoint (kind 'midpoint', the index of that segment's first
// endpoint) — dragging a midpoint speculatively inserts a new vertex there,
// only committed to the diagram on mouseup (see handleMidpointMouseDown) —
// or one of the connector's own two true endpoints (kind 'endpoint',
// 'from'/'to'), offered only while that particular end is genuinely
// dangling (see diagramOps.isConnectorEndpointDangling).
type VertexDrag =
  | { connectorId: number; kind: 'vertex'; index: number; point: Point }
  | { connectorId: number; kind: 'midpoint'; segmentIndex: number; point: Point }
  | { connectorId: number; kind: 'endpoint'; end: 'from' | 'to'; point: Point }
// A specific bend point the user clicked (without dragging) on a selected
// connector, distinct from selecting the connector itself — lets
// Delete/Backspace remove just that one vertex instead of the whole wire.
type SelectedVertex = { connectorId: number; index: number }

// A delta smaller than this (diagram units) counts as "no real difference"
// rather than a genuine, if tiny, segment — needed because a busbar/
// connector connect-target's coordinate (nearestSegmentOnPolyline's raw
// projection, before snapPointOnSegment grid-aligns the common orthogonal
// case — a diagonal segment is left unsnapped) can still land off a clean
// whole number, so comparing it to the previous point with exact equality
// would almost always see a "real" delta of a few
// hundredths of a unit and draw a practically-invisible spur segment
// instead of recognizing the two points as the same one.
const ALIGNMENT_EPSILON = 1

// Appends end to path as one orthogonal (H-then-V or V-then-H) segment
// pair — or a single segment when end is already (within
// ALIGNMENT_EPSILON) horizontal or vertical from the last point — picking
// whichever axis order moves along the larger delta first, a reasonable
// default absent any explicit per-route bend-direction toggle (not yet
// built). A no-op if end is within epsilon of the last point in both axes
// (e.g. a stray click).
function appendOrthogonalPoint(path: Point[], end: Point): Point[] {
  const last = path[path.length - 1]
  let dx = end.x - last.x
  let dy = end.y - last.y
  if (Math.abs(dx) < ALIGNMENT_EPSILON) {
    end = { ...end, x: last.x }
    dx = 0
  }
  if (Math.abs(dy) < ALIGNMENT_EPSILON) {
    end = { ...end, y: last.y }
    dy = 0
  }
  if (dx === 0 && dy === 0) return path
  if (dx !== 0 && dy !== 0) {
    const corner = Math.abs(dx) >= Math.abs(dy) ? { x: end.x, y: last.y } : { x: last.x, y: end.y }
    return [...path, corner, end]
  }
  return [...path, end]
}

// Parses one RenderFragments-returned fragment string (always exactly one
// top-level SVG node — a <g>, or a bare <rect>/<circle>/<ellipse>/
// <polyline>/<path>/<text>, matching whichever of those the element/
// connector/label/digital device in question renders as — see
// internal/slddoc.Render's own doc comment on RenderMode/bare-tag shapes)
// into a real, detached DOM node ready to swap in for its own stale one.
// Can't use a plain <div>.innerHTML for this — the HTML parser doesn't
// namespace bare SVG tags correctly — so the fragment is parsed as XML
// wrapped in its own <svg> root instead, matching the same trick sld-viewer
// and this component's own dangerouslySetInnerHTML rely on implicitly (an
// <svg> element's own innerHTML setter *does* parse its children with the
// right namespace, unlike a generic Element's). Returns null on a parse
// failure (malformed markup, which should never happen against this
// backend's own output, but a corrupt/truncated response over a bad
// connection is exactly the scenario this whole feature exists for) — the
// caller then just leaves the stale node in place rather than risking
// tearing out a live DOM node for nothing.
function parseSvgFragment(markup: string): Element | null {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    'image/svg+xml',
  )
  if (doc.querySelector('parsererror')) return null
  return doc.documentElement.firstElementChild
}

// Patches root's own existing DOM nodes in place from a RenderFragments
// response, the incremental counterpart to replacing the whole injected
// SVG's own innerHTML: for each {id, kind} in targets (diagramOps.
// diffDiagramForRender's own 'patch' result), looks up the current node by
// the same [data-editor-kind][id=X] selector every other click/drag/
// hit-test in this file already uses, and swaps it for the freshly parsed
// replacement — keeping whatever position in the DOM (and so z-order) the
// prior full render already gave it, since a 'patch' diff only ever covers
// ids that already existed (see diffDiagramForRender's own doc comment for
// why an add/remove forces a full render instead). fragments is keyed by
// id as a string (this is JSON decoded from the wire, where every object
// key is necessarily a string even though both ends think of it as a
// number) — an id present in targets but missing from fragments (the
// backend's own "no longer in the diagram at all" skip — shouldn't happen
// here, since a 'patch' diff only names ids that are still present in the
// diagram just posted, but handled the same defensive way regardless) or a
// lookup/parse failure just leaves that one node stale rather than
// aborting the whole patch.
function patchFragmentsInDom(
  root: Element,
  targets: { id: number; kind: diagramOps.DataEditorKind }[],
  fragments: Record<string, string>,
) {
  for (const { id, kind } of targets) {
    const markup = fragments[String(id)]
    if (markup === undefined) continue
    const node = root.querySelector(`[data-editor-kind="${kind}"][id="${id}"]`)
    if (!node) continue
    const replacement = parseSvgFragment(markup)
    if (!replacement) continue
    node.replaceWith(replacement)
  }
}

// Hides the rendered items of the given layers. Every item is a top-level
// child of the rendered <svg> with data-layer set, except base-layer items,
// which carry none (slddoc's withLayerAttr).
function hiddenLayerCss(hidden: ReadonlySet<number>): string {
  return [...hidden]
    .map(layer =>
      layer === diagramOps.BASE_LAYER
        ? '.sld-rendered svg > [data-editor-kind]:not([data-layer])'
        : `.sld-rendered svg > [data-layer="${layer}"]`,
    )
    .join(',\n')
    .concat(' { display: none; }')
}

// Zoom in/out/fit-to-view buttons overlaid on the canvas, mirroring
// sld-viewer's own ZoomControls (SldPanel.tsx) — mounted as a sibling of
// TransformComponent, inside TransformWrapper, since useControls() only
// works within that context. "Reset view" is really a fit-to-content
// action, not a fixed-scale reset: it scales to whichever of
// width/height-to-wrapper ratio is smaller (a "contain" fit) and centers
// the result, rather than snapping back to scale 1. Unlike sld-viewer
// (which injects a raw SVG string and reads its own natural size via
// width.baseVal/height.baseVal), the diagram's real size is already known
// exactly from diagram.width/height, so no DOM measurement of the content
// itself is needed. animationTime is always 0 — react-zoom-pan-pinch's
// default rAF-driven animation never completes in a backgrounded tab,
// which would otherwise leave the transform stuck mid-animation.
function ZoomControls({ width, height }: { width: number; height: number }) {
  const { zoomIn, zoomOut, setTransform, instance } = useControls()

  const fitToView = useCallback(() => {
    const wrapper = instance.wrapperComponent
    if (!wrapper || !wrapper.clientWidth || !wrapper.clientHeight) return
    const scale = Math.min(wrapper.clientWidth / width, wrapper.clientHeight / height)
    const x = (wrapper.clientWidth - width * scale) / 2
    const y = (wrapper.clientHeight - height * scale) / 2
    setTransform(x, y, scale, 0)
  }, [instance, setTransform, width, height])

  const buttons = [
    { icon: ZoomIn, onClick: () => zoomIn(), title: t('canvas.zoomIn') },
    { icon: ZoomOut, onClick: () => zoomOut(), title: t('canvas.zoomOut') },
    { icon: Maximize2, onClick: fitToView, title: t('canvas.resetView') },
  ]

  return (
    <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-10">
      {buttons.map(({ icon: Icon, onClick, title }) => (
        <button
          key={title}
          type="button"
          title={title}
          aria-label={title}
          onClick={onClick}
          className="flex items-center justify-center w-8 h-8 rounded bg-surface-700 border border-surface-500 text-gray-300 hover:text-white hover:bg-surface-600 shadow transition-colors"
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  )
}

// Renders the current in-memory diagram by asking the backend to render it,
// debounced, rather than reimplementing internal/slddoc's symbol-template
// rendering in the browser. Selection (click, Shift/Ctrl/Cmd-click, the
// selection frame), drag, Alt-drag duplicate, copy/paste, click-to-place
// and wire routing are all handled here by hit-testing a click against the
// data-editor-kind ("element"/"connector"/"label"/"digitaldevice") marker
// Render/RenderFragments write on every selectable node, and reading its
// plain DOM id (the entity's own bare integer id, parsed back out of the
// string the DOM always represents it as) — then mutating diagram state
// directly. Each debounce firing diffs the latest diagram against
// lastRenderedRef (diagramOps.diffDiagramForRender) to pick how to catch
// the displayed SVG up: POST /api/render/fragments and patch just the
// changed nodes in place (patchFragmentsInDom) when only a fixed set of
// already-existing elements/connectors/labels/digital devices changed;
// POST /api/render (the original, whole-document path — setSvg below,
// injected via dangerouslySetInnerHTML) for anything an id-level patch
// can't express (an add/remove, or a diagram-wide change like a
// VoltageClass's own color); nothing at all for a no-op. A lightweight
// local "ghost" overlay gives instant feedback for an in-progress
// drag/draw without waiting on either round trip.
export function Canvas() {
  const {
    diagram,
    config,
    elements,
    selectedElementId,
    selection,
    toggleSelection,
    selectMany,
    selectedConnectorId,
    selectedLabelId,
    selectedDigitalDeviceId,
    armedSymbol,
    armedWireKind,
    armedLabel,
    armedDigitalDevice,
    armedCustomElement,
    defaultVoltage,
    selectElement,
    selectConnector,
    selectLabel,
    selectDigitalDevice,
    armSymbol,
    armWireKind,
    armLabel,
    armDigitalDevice,
    armCustomElement,
    deleteSelected,
    updateDiagram,
    hiddenLayers,
  } = useDiagramContext()
  // An item on a layer hidden in the Layers section is neither drawn
  // (hiddenLayerCss) nor picked by any diagram-state hit test below.
  const isHidden = (item: { layer: number }) => hiddenLayers.has(item.layer)

  const [svg, setSvg] = useState('')
  const [warning, setWarning] = useState<string | null>(null)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [newBusbar, setNewBusbar] = useState<NewBusbar | null>(null)
  const [pointDrag, setPointDrag] = useState<PointDrag | null>(null)
  const [labelDrag, setLabelDrag] = useState<LabelDrag | null>(null)
  const [digitalDeviceDrag, setDigitalDeviceDrag] = useState<DigitalDeviceDrag | null>(null)
  // What Copy captured: the selection as a standalone diagram
  // (diagramOps.extractSelection), pasted the same way a custom element is
  // placed so its ports and junctions come along intact. centroid is where
  // the copied group sat (diagramOps.selectionCentroid) and pastes how many
  // times Ctrl/Cmd+V has pasted it, for the growing paste offset.
  const [clipboard, setClipboard] = useState<{ template: Diagram; centroid: Point; pastes: number } | null>(null)
  // Space held: left-drag pans the view instead of drawing a selection
  // frame (see the TransformWrapper's panning prop).
  const [spaceHeld, setSpaceHeld] = useState(false)
  // An in-progress selection frame (left-drag from empty canvas): start/
  // current in diagram units; crossing when dragged right-to-left (picks
  // whatever it touches) rather than left-to-right (only what's fully
  // inside) — see marqueeHits.
  const [marquee, setMarquee] = useState<{ start: Point; current: Point } | null>(null)
  const renderedRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  // The selection being saved via the context menu's "Save as custom
  // element…" (diagramOps.extractSelection's result) while its name dialog
  // is open.
  const [customElementTemplate, setCustomElementTemplate] = useState<Diagram | null>(null)
  const [routing, setRouting] = useState<Routing | null>(null)
  const [routingCursor, setRoutingCursor] = useState<Point | null>(null)
  // An in-progress pen-tool Polygon (armedSymbol shape 16): the vertices
  // clicked so far plus the live cursor position for the rubber-band
  // segment. Discarded whenever Polygon stops being the armed symbol.
  const [polygonDraft, setPolygonDraft] = useState<Point[] | null>(null)
  const [polygonCursor, setPolygonCursor] = useState<Point | null>(null)
  useEffect(() => {
    if (!PEN_DRAWN_SHAPES.has(armedSymbol?.shape ?? '')) {
      setPolygonDraft(null)
      setPolygonCursor(null)
    }
  }, [armedSymbol])
  const [connectTarget, setConnectTarget] = useState<ConnectTarget | null>(null)
  // "Topology → Connect to… / Create wire to…" waiting for its second
  // terminal: from is the first (picked by the right-click), mode what a
  // click on the second does (join the two nodes, or draw a buswork wire).
  const [topologyPick, setTopologyPick] = useState<{ mode: 'join' | 'wire'; from: ConnectTarget } | null>(null)
  const [vertexDrag, setVertexDrag] = useState<VertexDrag | null>(null)
  const [selectedVertex, setSelectedVertex] = useState<SelectedVertex | null>(null)
  const [elementBoxes, setElementBoxes] = useState<Map<number, ElementBox>>(new Map())
  const wrapperRef = useRef<HTMLDivElement>(null)
  // The diagram exactly as of the last successful render (full or
  // incremental) — the baseline diffDiagramForRender compares the latest
  // diagram against on every debounce firing, so a diff always covers
  // everything changed since something was actually confirmed on screen,
  // not just the single most recent edit (several edits can land within
  // one debounce window). null before the first render of a freshly
  // opened/created diagram, which always takes the full-render path (see
  // below) since there's nothing yet to diff against.
  const lastRenderedRef = useRef<Diagram | null>(null)
  // Bumped after every successful incremental patch, purely to give the
  // elementBoxes effect below a signal to recompute — that effect already
  // depends on svg, but svg itself never changes for a patch (only real
  // DOM nodes are mutated directly, the same instant-DOM-first approach
  // dragElementsInDom already uses elsewhere), so without this a patched
  // element's own possibly-changed geometry (a drag, a resize) would leave
  // elementBoxes stale until some *other*, unrelated edit happened to
  // trigger a full render.
  const [patchVersion, setPatchVersion] = useState(0)

  // The current mixed selection, split by kind — every drag/copy/paste/
  // context-menu action that needs to treat "the whole selection" as one
  // group works from these rather than filtering `selection` itself each
  // time. Cheap enough (selection is never more than a handful of ids) to
  // just recompute on every render rather than memoizing.
  const elementSelection = new Set<number>()
  const connectorSelection = new Set<number>()
  const labelSelection = new Set<number>()
  const digitalDeviceSelection = new Set<number>()
  for (const [id, kind] of selection) {
    if (kind === 'element') elementSelection.add(id)
    else if (kind === 'connector') connectorSelection.add(id)
    else if (kind === 'label') labelSelection.add(id)
    else digitalDeviceSelection.add(id)
  }

  // What a drag started on (clickedId, clickedKind) should move: the whole
  // current mixed selection, when the clicked item is already part of one
  // holding more than one entry (matches the desktop convention "dragging
  // any item in a multi-selection moves the whole group"), or otherwise
  // just that one item on its own — the same either/or handleMouseDown's
  // own element branch has always used, now shared by every kind.
  function movingGroup(clickedId: number, clickedKind: SelectionKind) {
    if (selection.get(clickedId) === clickedKind && selection.size > 1) {
      return {
        elementIds: elementSelection,
        connectorIds: connectorSelection,
        labelIds: labelSelection,
        digitalDeviceIds: digitalDeviceSelection,
      }
    }
    const empty = new Set<number>()
    return {
      elementIds: clickedKind === 'element' ? new Set([clickedId]) : empty,
      connectorIds: clickedKind === 'connector' ? new Set([clickedId]) : empty,
      labelIds: clickedKind === 'label' ? new Set([clickedId]) : empty,
      digitalDeviceIds: clickedKind === 'digitaldevice' ? new Set([clickedId]) : empty,
    }
  }

  // Starts a whole-selection drag from any one clicked item (element,
  // connector, label, or digital device) — the unified counterpart of what
  // used to be handleMouseDown's own element-only drag logic. point is the
  // already-computed diagram-space mousedown position. Collapses the
  // selection to just the clicked item first when it isn't already part of
  // a multi-selection (matching every kind's own previous plain-click
  // behavior); dragging a member of an actual multi-selection moves the
  // whole group and leaves the selection itself untouched.
  //
  // Elements get their usual live DOM-preview via dragElementsInDom
  // (ghost); at most one label and one digital device also get a live
  // preview (dragLabelInDom/dragDigitalDeviceInDom) — connectors never do
  // (they only ever reroute once the diagram itself updates on mouseup,
  // the same as an element's own attached connector already does), and a
  // *group* of more than one label or digital device doesn't either (their
  // own drag state is a single id, not an array) — both are purely visual
  // simplifications; the final committed position via moveSelection is
  // correct regardless.
  function startGroupDrag(point: Point, clickedId: number, clickedKind: SelectionKind) {
    const moving = movingGroup(clickedId, clickedKind)
    const totalCount =
      moving.elementIds.size + moving.connectorIds.size + moving.labelIds.size + moving.digitalDeviceIds.size
    if (totalCount <= 1) {
      if (clickedKind === 'element') selectElement(clickedId)
      else if (clickedKind === 'connector') selectConnector(clickedId)
      else if (clickedKind === 'label') selectLabel(clickedId)
      else selectDigitalDevice(clickedId)
    }

    const elementIds = [...moving.elementIds]
    const previewLabelId = moving.labelIds.size === 1 ? [...moving.labelIds][0] : null
    const previewDigitalDeviceId = moving.digitalDeviceIds.size === 1 ? [...moving.digitalDeviceIds][0] : null

    const preview = (dx: number, dy: number) => {
      if (elementIds.length > 0) dragElementsInDom(elementIds, dx, dy)
      if (previewLabelId !== null) dragLabelInDom(previewLabelId, dx, dy)
      if (previewDigitalDeviceId !== null) dragDigitalDeviceInDom(previewDigitalDeviceId, dx, dy)
    }

    const onMove = (ev: MouseEvent) => {
      const p = toPoint(ev.clientX, ev.clientY)
      const dx = snapValue(p.x - point.x, gridSpacing, snapEnabled)
      const dy = snapValue(p.y - point.y, gridSpacing, snapEnabled)
      if (elementIds.length > 0) setGhost({ ids: elementIds, dx, dy })
      if (previewLabelId !== null) setLabelDrag({ id: previewLabelId, dx, dy })
      if (previewDigitalDeviceId !== null) setDigitalDeviceDrag({ id: previewDigitalDeviceId, dx, dy })
      preview(dx, dy)
    }
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const p = toPoint(ev.clientX, ev.clientY)
      const dx = snapValue(p.x - point.x, gridSpacing, snapEnabled)
      const dy = snapValue(p.y - point.y, gridSpacing, snapEnabled)
      setGhost(null)
      setLabelDrag(null)
      setDigitalDeviceDrag(null)
      if (dx !== 0 || dy !== 0) {
        preview(dx, dy)
        updateDiagram(d => diagramOps.moveSelection(d, moving, dx, dy))
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // A selectable item's own bounding box in diagram units: an element's
  // measured box (elementBoxes), a connector's points, a label's/digital
  // device's rendered <text>. null when it has nothing to measure yet.
  function itemBox(id: number, kind: SelectionKind): Box | null {
    if (kind === 'element') {
      const box = elementBoxes.get(id)
      if (box) return box
      const el = diagram!.elements.find(e => e.id === id)
      return el ? pointsBox(el.points && el.points.length > 0 ? el.points : [{ x: el.x, y: el.y }]) : null
    }
    if (kind === 'connector') {
      const c = diagram!.connectors.find(x => x.id === id)
      return c && c.points.length > 0 ? pointsBox(c.points) : null
    }
    const node = renderedRef.current?.querySelector(`[data-editor-kind="${kind}"][id="${id}"]`) as SVGGraphicsElement | null
    if (!node) return null
    try {
      const b = node.getBBox()
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    } catch {
      return null
    }
  }

  // The one dashed box drawn around a multi-selection: the union of its
  // items' own boxes.
  function selectionBox(): Box | null {
    const boxes = [...selection].map(([id, kind]) => itemBox(id, kind)).filter((b): b is Box => b !== null)
    if (boxes.length === 0) return null
    const x = Math.min(...boxes.map(b => b.x))
    const y = Math.min(...boxes.map(b => b.y))
    const right = Math.max(...boxes.map(b => b.x + b.width))
    const bottom = Math.max(...boxes.map(b => b.y + b.height))
    return {
      x: x - BOX_HIGHLIGHT_PAD,
      y: y - BOX_HIGHLIGHT_PAD,
      width: right - x + BOX_HIGHLIGHT_PAD * 2,
      height: bottom - y + BOX_HIGHLIGHT_PAD * 2,
    }
  }

  // What a selection frame from start to current picks: left-to-right,
  // only what lies fully inside; right-to-left ("crossing"), anything it
  // touches (a wire by any segment crossing it, not just its bounding box).
  function marqueeHits(start: Point, current: Point): Map<number, SelectionKind> {
    const rect = pointsBox([start, current])
    const crossing = current.x < start.x
    const hits = new Map<number, SelectionKind>()
    const test = (box: Box | null) => (box ? (crossing ? boxesIntersect(box, rect) : boxInside(box, rect)) : false)
    for (const el of diagram!.elements) if (!isHidden(el) && test(itemBox(el.id, 'element'))) hits.set(el.id, 'element')
    for (const c of diagram!.connectors) {
      if (c.points.length === 0 || isHidden(c)) continue
      const hit = crossing
        ? c.points.some(p => pointInBox(p, rect)) ||
          c.points.some((p, i) => i < c.points.length - 1 && segmentCrossesBox(p, c.points[i + 1], rect))
        : c.points.every(p => pointInBox(p, rect))
      if (hit) hits.set(c.id, 'connector')
    }
    for (const l of diagram!.labels) if (!isHidden(l) && test(itemBox(l.id, 'label'))) hits.set(l.id, 'label')
    for (const dd of diagram!.digitalDevices)
      if (!isHidden(dd) && test(itemBox(dd.id, 'digitaldevice'))) hits.set(dd.id, 'digitaldevice')
    return hits
  }

  // A left-drag from empty canvas: draws the selection frame and, on
  // release, selects what it picked (added to the current selection with
  // Shift/Ctrl/Cmd). A release within a few pixels of the press is a plain
  // click on empty canvas instead: it clears the selection, as before.
  function startMarquee(point: Point, clientX: number, clientY: number, additive: boolean) {
    const base = additive ? new Map(selection) : new Map<number, SelectionKind>()
    const onMove = (ev: MouseEvent) => {
      if (Math.hypot(ev.clientX - clientX, ev.clientY - clientY) < MARQUEE_MIN_DRAG) return
      setMarquee({ start: point, current: toPoint(ev.clientX, ev.clientY) })
    }
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setMarquee(null)
      if (Math.hypot(ev.clientX - clientX, ev.clientY - clientY) < MARQUEE_MIN_DRAG) {
        if (!additive) selectElement(null)
        return
      }
      for (const [id, kind] of marqueeHits(point, toPoint(ev.clientX, ev.clientY))) base.set(id, kind)
      selectMany(base)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Every item in after that before didn't have: what a paste/duplicate
  // just added, to select it.
  function addedItems(before: Diagram, after: Diagram): Map<number, SelectionKind> {
    const added = new Map<number, SelectionKind>()
    const had = (list: { id: number }[]) => new Set(list.map(x => x.id))
    const els = had(before.elements)
    const cons = had(before.connectors)
    const labs = had(before.labels)
    const dds = had(before.digitalDevices)
    for (const e of after.elements) if (!els.has(e.id)) added.set(e.id, 'element')
    for (const c of after.connectors) if (!cons.has(c.id)) added.set(c.id, 'connector')
    for (const l of after.labels) if (!labs.has(l.id)) added.set(l.id, 'label')
    for (const dd of after.digitalDevices) if (!dds.has(dd.id)) added.set(dd.id, 'digitaldevice')
    return added
  }

  // A just-drawn Picture's image: the hidden file input below, opened for
  // the Picture whose id is in pictureTargetRef.
  const pictureInputRef = useRef<HTMLInputElement>(null)
  const pictureTargetRef = useRef<number | null>(null)
  function choosePictureImage(id: number) {
    pictureTargetRef.current = id
    pictureInputRef.current?.click()
  }
  function handlePictureFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const id = pictureTargetRef.current
    e.target.value = ''
    if (!file || id === null) return
    readImageFile(file)
      .then(href => updateDiagram(d => diagramOps.setPictureHref(d, id, href)))
      .catch(err => setWarning((err as Error).message))
  }

  // Places template's copy so its centroid lands on point, then selects
  // the copy.
  function placeCopy(template: Diagram, point: Point, snap: (p: Point) => Point) {
    const before = diagram!
    const after = diagramOps.placeCustomElement(before, template, point, elements, snap, defaultVoltage)
    if (after === before) return
    updateDiagram(() => after)
    selectMany(addedItems(before, after))
  }

  function copySelectionToClipboard() {
    if (selection.size === 0) return
    const template = diagramOps.extractSelection(diagram!, selection, gridSpacing)
    const centroid = diagramOps.selectionCentroid(diagram!, selection)
    if (template && centroid) setClipboard({ template, centroid, pastes: 0 })
  }

  // Ctrl/Cmd+V: pastes offset PASTE_OFFSET_STEPS grid steps right and down
  // from the copied original, a step further on each repeat.
  function pasteClipboardOffset() {
    if (!clipboard) return
    const offset = gridSpacing * PASTE_OFFSET_STEPS * (clipboard.pastes + 1)
    placeCopy(clipboard.template, { x: clipboard.centroid.x + offset, y: clipboard.centroid.y + offset }, snapPoint)
    setClipboard({ ...clipboard, pastes: clipboard.pastes + 1 })
  }

  // Alt/Option-drag: a see-through copy of the group (clones of its
  // rendered nodes, with their ids/data-editor-kind stripped so they can't
  // be hit-tested) follows the cursor while the originals stay put; on
  // release the real copy is placed there. No movement leaves no copy.
  function startDuplicateDrag(point: Point, clickedId: number, clickedKind: SelectionKind) {
    const moving = movingGroup(clickedId, clickedKind)
    const group = new Map<number, SelectionKind>([
      ...[...moving.elementIds].map(id => [id, 'element'] as const),
      ...[...moving.connectorIds].map(id => [id, 'connector'] as const),
      ...[...moving.labelIds].map(id => [id, 'label'] as const),
      ...[...moving.digitalDeviceIds].map(id => [id, 'digitaldevice'] as const),
    ])
    const template = diagramOps.extractSelection(diagram!, group, gridSpacing)
    const centroid = diagramOps.selectionCentroid(diagram!, group)
    const root = renderedRef.current?.querySelector('svg')
    if (!template || !centroid || !root) return

    const preview = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    preview.setAttribute('opacity', '0.6')
    for (const [id, kind] of group) {
      const node = root.querySelector(`[data-editor-kind="${kind}"][id="${id}"]`)
      if (!node) continue
      const clone = node.cloneNode(true) as Element
      for (const n of [clone, ...clone.querySelectorAll('*')]) {
        n.removeAttribute('id')
        n.removeAttribute('data-editor-kind')
      }
      preview.appendChild(clone)
    }
    root.appendChild(preview)

    const delta = (ev: MouseEvent) => {
      const p = toPoint(ev.clientX, ev.clientY)
      return { dx: snapValue(p.x - point.x, gridSpacing, snapEnabled), dy: snapValue(p.y - point.y, gridSpacing, snapEnabled) }
    }
    const onMove = (ev: MouseEvent) => {
      const { dx, dy } = delta(ev)
      preview.setAttribute('transform', `translate(${dx},${dy})`)
    }
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      preview.remove()
      const { dx, dy } = delta(ev)
      if (dx === 0 && dy === 0) return
      placeCopy(template, { x: centroid.x + dx, y: centroid.y + dy }, p => p)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    if (!diagram) {
      setSvg('')
      setWarning(null)
      lastRenderedRef.current = null
      return
    }
    let cancelled = false
    const handle = setTimeout(() => {
      const baseline = lastRenderedRef.current
      const diff = baseline ? diagramOps.diffDiagramForRender(baseline, diagram) : { kind: 'full' as const }

      if (diff.kind === 'none') {
        // Nothing rendering-relevant actually changed (e.g. a no-op
        // updateDiagram) — skip the round trip entirely, but still adopt
        // diagram as the new baseline so a *later* diff doesn't end up
        // comparing against an increasingly stale reference.
        lastRenderedRef.current = diagram
        return
      }

      if (diff.kind === 'patch') {
        api
          .renderPreviewFragments(diagram, diff.targets.map(target => target.id))
          .then(res => {
            if (cancelled) return
            const root = wrapperRef.current
            if (root) patchFragmentsInDom(root, diff.targets, res.fragments)
            lastRenderedRef.current = diagram
            setWarning(res.warning ?? null)
            setPatchVersion(v => v + 1)
          })
          .catch(e => {
            if (!cancelled) setWarning((e as Error).message)
          })
        return
      }

      api
        .renderPreview(diagram)
        .then(res => {
          if (cancelled) return
          setSvg(res.svg)
          lastRenderedRef.current = diagram
          setWarning(res.warning ?? null)
        })
        .catch(e => {
          if (!cancelled) setWarning((e as Error).message)
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [diagram])

  // Recomputes every symbol element's own real bounding box straight from
  // the backend-rendered markup, once it's actually in the DOM — the fix
  // for a fixed-radius circle (this editor's previous approach, both for
  // the backend's own invisible hit-target circle and this component's own
  // selection-highlight circle) not working for a shape that's large,
  // small, or — like VoltageTransformer's own terminal-at-the-top — has
  // its anchor sitting nowhere near its own drawn body's center. A <g>'s
  // own getBBox() returns its geometry in local, pre-transform coordinates
  // (the same space a shape's template/Terminals are authored in), so its
  // 4 corners are pushed through diagramOps.placeLocalPoint — the same
  // rotate-by-orient-then-translate-by-anchor math internal/slddoc.Render
  // itself used to place that same geometry — to get the element's real
  // diagram-space footprint. BusBarSection is skipped entirely: it renders
  // as a bare <polyline> with no fill at all, and its own thin line is
  // already covered by its points-based selection highlight/hit-testing, no
  // click-tolerance box needed — a Road/Line (also a bare, no-fill
  // <polyline>) is skipped for the identical reason. A Rectangle, Circle,
  // or Arrow, unlike a busbar, is skipped in the DOM-lookup sense (each is a bare
  // <rect>/<ellipse>/<path>, not a <g>) but *does* still get a real box
  // here, computed straight from its own diagram-state Points instead of
  // getBBox — a Rectangle's/Circle's own fill is very often "none"
  // (transparent), and an SVG shape with fill:none simply doesn't receive
  // pointer events over its own interior at all (only its stroke does), so
  // without this a click anywhere but the exact 1px border would silently
  // miss it entirely, unlike every filled shape; an Arrow has no interior
  // in the first place, just a thin stroke, so it needs the same
  // click-tolerance box even more. A Circle's own box is its bounding
  // box, not a true ellipse hit-test — close enough for a click-tolerance
  // fallback, same as everywhere else this project favors a simple box
  // over per-shape-accurate hit geometry. A PostPole (also a bare
  // <rect>/<circle>, also often unfilled) gets the identical treatment,
  // just computed from its own X/Y/Radius instead of Points, since it's a
  // single anchor, not a Points-based shape. Table (312, wrapped in a real
  // <g> like Button, but still treated the same Points-based way as an
  // optimization — no DOM query needed when the geometry's already known
  // from diagram state) and Table2 (313, a single X/Y anchor plus the sum
  // of its own rowHeights/columnWidths, computed the same
  // straight-from-diagram-state way PostPole's own is) get matching
  // treatment below too.
  useEffect(() => {
    const root = wrapperRef.current
    if (!root || !diagram) {
      setElementBoxes(new Map())
      return
    }
    const boxes = new Map<number, ElementBox>()
    for (const el of diagram.elements) {
      if (hiddenLayers.has(el.layer)) continue
      if (el.class === 'BusBarSection' || el.class === 'Road' || el.class === 'Line') continue
      if (el.class === 'Arc') {
        // A thin bare <path>, fill always none — same click-tolerance
        // treatment as Polygon, from the curve's own sampled extent.
        const arc = elementArc(el)
        if (arc) boxes.set(el.id, arcBounds(arc))
        continue
      }
      if ((el.class === 'Polygon' || el.class === 'Container') && el.points && el.points.length > 0) {
        // A bare <polygon> whose own Fill is often "none" (like
        // Rectangle's), so it gets the same click-tolerance box: its own
        // vertices' bounding box.
        const xs = el.points.map(p => p.x)
        const ys = el.points.map(p => p.y)
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        boxes.set(el.id, { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y })
        continue
      }
      if (
        (el.class === 'Rectangle' || el.class === 'SmallWindow' || el.class === 'Picture' || el.class === 'Circle' || el.class === 'Arrow' || el.class === 'Button' || el.class === 'WindowIcon' || el.class === 'AutomationDevice' || el.class === 'Table') &&
        el.points
      ) {
        const [p0, p1] = el.points
        const x = Math.min(p0.x, p1.x)
        const y = Math.min(p0.y, p1.y)
        boxes.set(el.id, { x, y, width: Math.abs(p1.x - p0.x), height: Math.abs(p1.y - p0.y) })
        continue
      }
      if (el.class === 'PostPole') {
        // Same reasoning as Rectangle/Circle/Button just above — a bare
        // <rect>/<circle>, not a <g>, so it's skipped in the DOM-lookup
        // sense below, and its own Fill is very often "none" (see
        // diagramOps.POLE_DEFAULTS), so it needs this same click-tolerance
        // box. Computed directly from X/Y/Radius rather than el.points
        // (PostPole is a single anchor, not Points-based) — Orient is
        // never applied here since it's visually inert for this shape
        // either way (see slddoc's own ClassPostPole doc comment), so the
        // box is always just a plain square centered on the anchor,
        // whether the drawn marker itself is round or square.
        const radius = el.radius || 10
        boxes.set(el.id, { x: el.x - radius, y: el.y - radius, width: radius * 2, height: radius * 2 })
        continue
      }
      if (el.class === 'PowerflowIndicator') {
        // Same reasoning as PostPole just above — a bare <text> tag whose
        // own x/y are already the real diagram anchor (writePowerflowIndicator
        // draws transform="rotate(...)" only, no translate), so getBBox()
        // would double-count position if run through the generic
        // placeLocalPoint path below. Half-width matches half the drawn
        // glyph's own fixed 26px font-size, a plain square around the
        // anchor regardless of Orient, same as PostPole's own box.
        const half = 13
        boxes.set(el.id, { x: el.x - half, y: el.y - half, width: half * 2, height: half * 2 })
        continue
      }
      if (el.class === 'Table2') {
        // Also computed directly from diagram state rather than DOM
        // geometry — a Table2's own real footprint (unlike a symbol's
        // local-frame template) is simply its own X,Y anchor plus the sum
        // of its own rowHeights/columnWidths, no rotation/local-frame
        // translation involved at all.
        const width = (el.columnWidths ?? []).reduce((sum, w) => sum + w, 0)
        const height = (el.rowHeights ?? []).reduce((sum, h) => sum + h, 0)
        boxes.set(el.id, { x: el.x, y: el.y, width, height })
        continue
      }
      // No tag restriction (not just `g[...]`) — PackageSubstation's own
      // NType 1 (triangle) variant renders as a bare <path>, the same
      // "no wrapping <g>" convention Rectangle/Circle/Arrow already use,
      // so it needs this same generic getBBox() fallback to be reachable
      // at all (its NType 0/box variant already was, since that one does
      // render as a real <g>).
      const node = root.querySelector(`[data-editor-kind="element"][id="${el.id}"]`) as SVGGraphicsElement | null
      if (!node) continue
      let local: DOMRect
      try {
        local = node.getBBox()
      } catch {
        continue // an element with no drawn geometry at all (getBBox can throw)
      }
      // getBBox() is in the template's own frame, before its size step's
      // scale().
      const f = diagramOps.elementSizeFactor(el, elements)
      const corners = [
        { x: local.x, y: local.y },
        { x: local.x + local.width, y: local.y },
        { x: local.x, y: local.y + local.height },
        { x: local.x + local.width, y: local.y + local.height },
      ].map(p => diagramOps.placeLocalPoint(el, { x: p.x * f, y: p.y * f }))
      const xs = corners.map(p => p.x)
      const ys = corners.map(p => p.y)
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      boxes.set(el.id, { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY })
    }
    setElementBoxes(boxes)
  }, [svg, diagram, patchVersion, hiddenLayers])

  // Pictures render without their image (see lib/picture.ts); put each
  // one's href back into the DOM after every render or patch.
  useLayoutEffect(() => {
    if (renderedRef.current && diagram) fillPictureHrefs(renderedRef.current, diagram)
  }, [svg, diagram, patchVersion])

  /** Finds the smallest (by area) symbol element whose own real bounding
   * box — padded by BOX_HIT_PAD for click tolerance — contains point;
   * null if none does. The smallest-wins tie-break matches sld-viewer's
   * own equivalent fallback, favoring the more precise match on overlap. */
  function findElementBoxHit(point: Point): number | null {
    let bestId: number | null = null
    let bestArea = Infinity
    // A Container frames a whole group of equipment, so only its edge
    // counts: a press on the empty space inside it still starts a
    // selection frame instead of grabbing the container.
    const containerIds = new Set(diagram!.elements.filter(el => el.class === 'Container').map(el => el.id))
    for (const [id, box] of elementBoxes) {
      if (
        point.x < box.x - BOX_HIT_PAD ||
        point.x > box.x + box.width + BOX_HIT_PAD ||
        point.y < box.y - BOX_HIT_PAD ||
        point.y > box.y + box.height + BOX_HIT_PAD
      )
        continue
      if (
        containerIds.has(id) &&
        point.x > box.x + BOX_HIT_PAD &&
        point.x < box.x + box.width - BOX_HIT_PAD &&
        point.y > box.y + BOX_HIT_PAD &&
        point.y < box.y + box.height - BOX_HIT_PAD
      )
        continue
      const area = box.width * box.height
      if (area < bestArea) {
        bestArea = area
        bestId = id
      }
    }
    return bestId
  }

  // Delete/Backspace removes the current selection, except while focus is
  // in a text field (e.g. editing the Name field in Properties) — there it
  // must edit the text, not delete the element out from under it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (polygonDraft && (e.key === 'Backspace' || e.key === 'Delete')) {
        // Removes the draft's last vertex (the whole draft once none are
        // left) rather than deleting the selection underneath it.
        e.preventDefault()
        setPolygonDraft(polygonDraft.length > 1 ? polygonDraft.slice(0, -1) : null)
        return
      }
      if (polygonDraft && e.key === 'Enter') {
        e.preventDefault()
        finishPolygon(polygonDraft)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedVertex) {
          e.preventDefault()
          updateDiagram(d => diagramOps.removeConnectorVertex(d, selectedVertex.connectorId, selectedVertex.index))
          setSelectedVertex(null)
        } else if (
          selectedElementId !== null ||
          selectedConnectorId !== null ||
          selectedLabelId !== null ||
          selectedDigitalDeviceId !== null
        ) {
          e.preventDefault()
          deleteSelected()
        }
      } else if (e.key === 'Escape') {
        if (topologyPick) {
          setTopologyPick(null)
          setConnectTarget(null)
        } else if (routing) {
          setRouting(null)
          setRoutingCursor(null)
        } else if (selectedVertex) setSelectedVertex(null)
        else if (contextMenu) setContextMenu(null)
        else if (armedSymbol) armSymbol(null)
        else if (armedWireKind) armWireKind(null)
        else if (armedLabel) armLabel(false)
        else if (armedDigitalDevice) armDigitalDevice(false)
        else if (armedCustomElement) armCustomElement(null)
        else selectElement(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    selectedElementId,
    selectedConnectorId,
    selectedLabelId,
    selectedDigitalDeviceId,
    armedSymbol,
    armedWireKind,
    armedLabel,
    armedDigitalDevice,
    armedCustomElement,
    deleteSelected,
    armSymbol,
    armWireKind,
    armLabel,
    armDigitalDevice,
    armCustomElement,
    selectElement,
    contextMenu,
    routing,
    selectedVertex,
    updateDiagram,
    polygonDraft,
  ])

  // Ctrl/Cmd+C copies the selection, Ctrl/Cmd+V pastes it offset from the
  // original; Space held turns left-drag into panning. Ignored while typing
  // in a field. Re-subscribed on every render (no dependency list) so the
  // handlers always see the current selection and clipboard.
  useEffect(() => {
    const typing = () => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      return tag === 'input' || tag === 'textarea' || tag === 'select'
    }
    function onKeyDown(e: KeyboardEvent) {
      if (typing() || !diagram) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) setSpaceHeld(true)
        return
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      const key = e.key.toLowerCase()
      if (key === 'c' && selection.size > 0) {
        e.preventDefault()
        copySelectionToClipboard()
      } else if (key === 'v' && clipboard) {
        e.preventDefault()
        pasteClipboardOffset()
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') setSpaceHeld(false)
    }
    const onBlur = () => setSpaceHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  })

  if (!diagram) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-500 px-8 text-center">
        {t('canvas.noDiagram')}
      </div>
    )
  }

  const gridSpacing = diagram.editor?.gridSpacing ?? config?.editor.gridSpacing ?? 10
  const snapEnabled = diagram.editor?.snap ?? config?.editor.snap ?? true
  const showGrid = diagram.editor?.showGrid ?? config?.editor.showGrid ?? true
  const showNodes = diagram.editor?.showNodes ?? true

  function toPoint(clientX: number, clientY: number): Point {
    const rect = wrapperRef.current!.getBoundingClientRect()
    return clientToDiagramPoint(rect, diagram!.width, diagram!.height, clientX, clientY)
  }

  function snapPoint(p: Point): Point {
    return { x: snapValue(p.x, gridSpacing, snapEnabled), y: snapValue(p.y, gridSpacing, snapEnabled) }
  }

  // A Rectangle/Circle/Arrow/Button/Road/PostPole/Line/PowerflowIndicator/
  // Table/Table2 is a purely decorative annotation, never a valid wire
  // endpoint — unlike every other class, none even falls back to its own
  // anchor. Shared
  // between findConnectionTarget's own search and the context menu's
  // "Start buswork" item, which must offer it only for a routable element.
  const NON_ROUTABLE_ELEMENT_CLASSES = new Set([
    'Rectangle',
    'SmallWindow',
    'Picture',
    'Circle',
    'Arrow',
    'Button',
    'WindowIcon',
    'AutomationDevice',
    'Road',
    'PostPole',
    'LampOnPole',
    'Line',
    'Polygon',
    'Container',
    'Arc',
    'PowerflowIndicator',
    'Table',
    'Table2',
  ])

  // The nearest connectable point on el to point — a busbar's own polyline,
  // or the nearest of a symbol's own declared Terminals (its bare anchor
  // when it has none) — with no distance gate of its own; el is assumed
  // already known routable (NON_ROUTABLE_ELEMENT_CLASSES already excluded).
  // Shared by findConnectionTarget's own radius-gated search and the
  // context menu's "Start buswork" item, which already knows exactly which
  // element it means and needs the nearest point on it regardless of how
  // far the right-click itself landed from a real terminal.
  function nearestTargetOnElement(el: DiagramElement, point: Point): ConnectTarget {
    if (el.class === 'BusBarSection' && el.points && el.points.length >= 2) {
      const { index, point: nearest } = nearestSegmentOnPolyline(el.points, point)
      const p = snapPointOnSegment(el.points[index], el.points[index + 1], nearest, gridSpacing, snapEnabled)
      return { kind: 'element', elementId: el.id, point: p }
    }
    const terminals = diagramOps.symbolTerminals(el, elements) ?? [{ x: el.x, y: el.y }]
    let best = terminals[0]
    let bestDist = Infinity
    for (const term of terminals) {
      const dist = Math.hypot(term.x - point.x, term.y - point.y)
      if (dist < bestDist) {
        bestDist = dist
        best = term
      }
    }
    return { kind: 'element', elementId: el.id, point: best }
  }

  // The nearest connectable point on c to point — an OverheadLine only
  // offers its own two true begin/end points (see findConnectionTarget's
  // own doc comment on why), every other kind anywhere along its line — no
  // distance gate of its own. Shared the same way nearestTargetOnElement is.
  function nearestTargetOnConnector(c: Connector, point: Point): ConnectTarget {
    if (c.kind === 'OverheadLine') {
      const ends: [Point, number][] = [
        [c.points[0], 0],
        [c.points[c.points.length - 1], c.points.length - 2],
      ]
      let best = ends[0]
      let bestDist = Infinity
      for (const end of ends) {
        const dist = Math.hypot(end[0].x - point.x, end[0].y - point.y)
        if (dist < bestDist) {
          bestDist = dist
          best = end
        }
      }
      return { kind: 'connector', connectorId: c.id, segmentIndex: best[1], point: best[0] }
    }
    const { index, point: nearest } = nearestSegmentOnPolyline(c.points, point)
    const p = snapPointOnSegment(c.points[index], c.points[index + 1], nearest, gridSpacing, snapEnabled)
    return { kind: 'connector', connectorId: c.id, segmentIndex: index, point: p }
  }

  // Finds the nearest terminal-like point to a raw (unsnapped) cursor
  // position, within TERMINAL_HIT_RADIUS — used both to decide whether a
  // plain (or, for a busbar/connector, Ctrl/Cmd-) click should start a
  // route (includeBusbars: false for a plain click — a busbar or an
  // existing connector has no discrete pin of its own, so clicking one
  // still just selects/drags it as before; true when Ctrl/Cmd is held, or
  // whenever already mid-route, per "any point along a busbar, or along an
  // already-drawn connector, counts as a terminal") and, mid-route, to
  // find a valid point to complete onto. exclude keeps a route from
  // completing back onto its own starting element/connector.
  function findConnectionTarget(point: Point, exclude: RouteStart | null, includeBusbars: boolean): ConnectTarget | null {
    let best: ConnectTarget | null = null
    let bestDist = TERMINAL_HIT_RADIUS
    for (const el of diagram!.elements) {
      if (exclude?.kind === 'element' && el.id === exclude.elementId) continue
      if (NON_ROUTABLE_ELEMENT_CLASSES.has(el.class) || isHidden(el)) continue
      // A busbar with fewer than 2 points (mid-creation, before its second
      // point exists) falls through to the plain-anchor terminal search
      // below regardless of includeBusbars, same as any other element —
      // only a real, drawable busbar is gated by it.
      if (el.class === 'BusBarSection' && el.points && el.points.length >= 2 && !includeBusbars) continue
      const candidate = nearestTargetOnElement(el, point)
      const dist = Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y)
      if (dist < bestDist) {
        bestDist = dist
        best = candidate
      }
    }
    if (includeBusbars) {
      for (const c of diagram!.connectors) {
        if (exclude?.kind === 'connector' && c.id === exclude.connectorId) continue
        if (isHidden(c)) continue
        // A wire with fewer than two points has no segment to tap (one can
        // still exist in a diagram saved before removeDegenerateConnectors).
        if (c.points.length < 2) continue
        const candidate = nearestTargetOnConnector(c, point)
        const dist = Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y)
        if (dist < bestDist) {
          bestDist = dist
          best = candidate
        }
      }
    }
    return best
  }

  // Starts the click-to-route tool from a specific already-known anchor
  // (an element's/connector's own nearest point, computed by the context
  // menu's "Start buswork" item — see nearestTargetOnElement/
  // nearestTargetOnConnector) rather than from a live mousedown hit-test.
  // Forces the kind to BusWork regardless of whatever's currently armed
  // from the palette (armedWireKind, if any is stale-armed from an earlier
  // unfinished pick), since this is the one explicit way to start a wire
  // without visiting the palette at all — handleRoutingClick/
  // handleWrapperDoubleClick's own `armedWireKind ?? 'BusWork'` fallback
  // isn't enough on its own, since a stale non-BusWork arm would otherwise
  // win over it.
  function startBusworkFrom(from: RouteStart) {
    armWireKind('BusWork')
    setRouting({ from, path: [from.point] })
    setRoutingCursor(from.point)
    setConnectTarget(null)
  }

  // Tracks connectTarget continuously (both for idle hover-discovery of a
  // pin to start a route from, and for live target-snapping while
  // routing) — skipped during any other drag gesture, which already owns
  // mousemove via its own temporary window listener. Outside of an
  // already-in-progress route, this only shows a hover target at all
  // while a wire kind is armed (armedWireKind) — with nothing armed, a
  // plain click anywhere, including right on a terminal, is always just
  // select/drag, so highlighting a "connect here" target with no way to
  // act on it would be misleading.
  function handleWrapperMouseMove(e: React.MouseEvent) {
    if (polygonDraft) {
      setPolygonCursor(snapPoint(toPoint(e.clientX, e.clientY)))
      return
    }
    if (armedSymbol || ghost || pointDrag || newBusbar || labelDrag || digitalDeviceDrag) return
    const point = toPoint(e.clientX, e.clientY)
    if (topologyPick) {
      setConnectTarget(findConnectionTarget(point, topologyPick.from, true))
    } else if (routing) {
      setConnectTarget(findConnectionTarget(point, routing.from, true))
      setRoutingCursor(point)
    } else if (armedWireKind) {
      setConnectTarget(findConnectionTarget(point, null, e.ctrlKey || e.metaKey))
    } else {
      setConnectTarget(null)
    }
  }

  // Pen-tool Polygon drawing: each click adds a (grid-snapped) vertex; a
  // click back on the first vertex, once there are at least 3, closes the
  // path and places the Polygon. A click landing on the last vertex again
  // (e.g. the second click of a double-click) is ignored rather than
  // adding a zero-length side.
  function handlePolygonClick(point: Point) {
    const p = snapPoint(point)
    const draft = polygonDraft ?? []
    if (draft.length >= 3 && isPolygonClosePoint(draft, p)) {
      finishPolygon(draft)
      return
    }
    const last = draft[draft.length - 1]
    if (last && last.x === p.x && last.y === p.y) return
    setPolygonDraft([...draft, p])
    setPolygonCursor(p)
  }

  function isPolygonClosePoint(draft: Point[], p: Point): boolean {
    return draft.length >= 3 && Math.hypot(p.x - draft[0].x, p.y - draft[0].y) <= POLYGON_CLOSE_RADIUS
  }

  // Places the draft as a real Polygon or Container, whichever is armed
  // (when it has at least 3 vertices), and disarms, single-shot like every
  // other armed symbol.
  function finishPolygon(draft: Point[]) {
    if (draft.length < 3) return
    const container = armedSymbol?.shape === CONTAINER_SHAPE
    updateDiagram(d => (container ? diagramOps.placeContainer(d, draft) : diagramOps.placePolygon(d, draft)))
    setPolygonDraft(null)
    setPolygonCursor(null)
    armSymbol(null)
  }

  // A click while routing either completes the route (when connectTarget
  // is a genuine target — any other element's terminal, any point along a
  // busbar, or any point along an already-drawn connector, tapping into it
  // as a junction) or anchors a new bend point and keeps routing. Six
  // combinations of routing.from/target kind are possible (from: element,
  // connector, or a bare mid-air point; target: element or connector);
  // each maps to its own diagramOps creator (see their own doc comments).
  function handleRoutingClick(point: Point) {
    if (!routing) return
    const target = findConnectionTarget(point, routing.from, true)
    if (target) {
      commitRoute(routing.from, target, appendOrthogonalPoint(routing.path, target.point), armedWireKind ?? 'BusWork')
      setRouting(null)
      setRoutingCursor(null)
      setConnectTarget(null)
      if (armedWireKind) armWireKind(null)
      return
    }
    setRouting({ ...routing, path: appendOrthogonalPoint(routing.path, snapPoint(point)) })
  }

  // Completes "Topology → Connect to… / Create wire to…" on the terminal
  // (device terminal, busbar point, or wire point) nearest the click; a
  // click on nothing connectable keeps waiting (Esc cancels).
  function handleTopologyPickClick(point: Point) {
    if (!topologyPick) return
    const target = findConnectionTarget(point, topologyPick.from, true)
    if (!target) return
    const { mode, from } = topologyPick
    if (mode === 'join') {
      updateDiagram(d => diagramOps.joinTopologyTargets(d, from, target))
    } else {
      commitRoute(from, target, appendOrthogonalPoint([from.point], target.point), 'BusWork')
    }
    setTopologyPick(null)
    setConnectTarget(null)
  }

  // Creates a wire along path from `from` to target, each end attached the
  // way its kind needs (see the diagramOps creators' own doc comments) —
  // shared by a completed route and "Topology → Create wire to…".
  function commitRoute(from: RouteStart, target: ConnectTarget, path: Point[], kind: ConnectorKind) {
    updateDiagram(d => {
      if (from.kind === 'element') {
        return target.kind === 'element'
          ? diagramOps.drawConnectorPath(d, from.elementId, target.elementId, path, defaultVoltage, kind)
          : diagramOps.drawConnectorPathToConnector(
              d,
              from.elementId,
              target.connectorId,
              target.segmentIndex,
              path,
              defaultVoltage,
              kind,
            )
      }
      if (from.kind === 'connector') {
        return target.kind === 'element'
          ? diagramOps.drawConnectorPathFromConnector(
              d,
              from.connectorId,
              from.segmentIndex,
              target.elementId,
              path,
              defaultVoltage,
              kind,
            )
          : diagramOps.drawConnectorBetweenConnectors(
              d,
              from.connectorId,
              from.segmentIndex,
              target.connectorId,
              target.segmentIndex,
              path,
              defaultVoltage,
              kind,
            )
      }
      return target.kind === 'element'
        ? diagramOps.drawConnectorPathFromPoint(d, path, target.elementId, defaultVoltage, kind)
        : diagramOps.drawConnectorPathFromPointToConnector(
            d,
            path,
            target.connectorId,
            target.segmentIndex,
            defaultVoltage,
            kind,
          )
    })
  }

  // Double-click either ends an in-progress route "in mid-air" at wherever
  // it currently reaches — even with no second element anywhere near,
  // rather than requiring one (the double-click's own two mousedowns
  // already ran through handleRoutingClick first, anchoring at most one
  // more bend point since both land on the same spot, so this just
  // finalizes whatever routing.path already is) — or, when not routing,
  // either adds a new bend point directly at wherever it landed on an
  // existing connector's own line (projected onto the exact segment
  // double-clicked, so the new point starts out perfectly straight-through
  // until dragged elsewhere), or, on truly empty canvas *while a wire kind
  // is armed* (armedWireKind — same gate the plain-click terminal-start
  // check uses, so double-clicking empty canvas is a no-op otherwise, not
  // an implicit way to start drawing), *starts* a brand new route from a
  // bare mid-air point (RouteStart's own 'point' kind) — the
  // double-click-to-start counterpart of double-click-to-end, letting a
  // diagram be drawn wire-first instead of always needing an element to
  // exist before a wire can touch it.
  function handleWrapperDoubleClick(e: React.MouseEvent) {
    // Each click of a double-click already reached handlePolygonClick (the
    // second as a duplicate vertex, ignored), so there's nothing more to do
    // here — and it must not fall through to add a connector bend point.
    if (PEN_DRAWN_SHAPES.has(armedSymbol?.shape ?? '')) {
      e.stopPropagation()
      return
    }
    if (routing) {
      e.stopPropagation()
      const from = routing.from
      const kind = armedWireKind ?? 'BusWork'
      updateDiagram(d => {
        if (from.kind === 'element') {
          return diagramOps.drawDanglingConnectorPath(d, from.elementId, routing.path, defaultVoltage, kind)
        }
        if (from.kind === 'connector') {
          return diagramOps.drawDanglingConnectorPathFromConnector(
            d,
            from.connectorId,
            from.segmentIndex,
            routing.path,
            defaultVoltage,
            kind,
          )
        }
        return diagramOps.drawDanglingConnectorPathFromPoint(d, routing.path, defaultVoltage, kind)
      })
      setRouting(null)
      setRoutingCursor(null)
      setConnectTarget(null)
      if (armedWireKind) armWireKind(null)
      return
    }
    const hit = (e.target as HTMLElement).closest('[data-editor-kind="connector"]') as HTMLElement | null
    if (hit) {
      const connectorId = Number(hit.id)
      const connector = diagram!.connectors.find(c => c.id === connectorId)
      if (!connector || connector.points.length < 2) return
      e.stopPropagation()
      const { index, point } = nearestSegmentOnPolyline(connector.points, toPoint(e.clientX, e.clientY))
      updateDiagram(d => diagramOps.insertConnectorVertex(d, connectorId, index, snapPoint(point)))
      selectConnector(connectorId)
      return
    }
    if (armedSymbol || !armedWireKind) return
    e.stopPropagation()
    const point = snapPoint(toPoint(e.clientX, e.clientY))
    setRouting({ from: { kind: 'point', point }, path: [point] })
    setRoutingCursor(point)
    setConnectTarget(null)
  }

  // Drags the real backend-rendered symbol(s) by (dx, dy) directly in the
  // DOM, rather than waiting on the debounced re-render — so the user sees
  // the actual placed element follow the cursor while dragging, not just
  // an abstract highlight. Reads each element's own current x/y/points from
  // diagram state (unchanged until mouseup) and offsets from there; a
  // BusBarSection/Rectangle/Circle/Button/Road/Line/Table (see
  // diagramOps.POINTS_BASED_CLASSES) has no single anchor to translate via
  // a transform, so its own points-derived attributes are set directly
  // instead — a busbar's, road's, or line's <polyline points>, a
  // rectangle's <rect x y> (its width/height are unaffected by a plain
  // translate, only x/y shift), a circle's <ellipse cx cy> (its own
  // rx/ry likewise unaffected), or a button's/table's own <rect x y>/
  // <text x y> pair. PostPole and PowerflowIndicator, though each a single
  // anchor (not Points-based), get the identical bare-tag treatment for
  // the identical reason — no wrapping <g> a translate() could shift (see
  // writePole/writePowerflowIndicator). Table2 is the one exception that
  // *does* get a translate(): its own wrapping <g> normally carries no
  // transform of its own either, but with potentially many per-cell
  // children, adding one temporarily during the drag is simpler than
  // shifting every child individually — see its own branch below.
  function dragElementsInDom(ids: number[], dx: number, dy: number) {
    const root = wrapperRef.current
    if (!root) return
    // render.go's sizeStepScale (rounded the same way).
    const sizeStepScale = (el: DiagramElement) => {
      const f = diagramOps.elementSizeFactor(el, elements)
      return f === 1 ? '' : ` scale(${Math.round(f * 1e6) / 1e6})`
    }
    for (const id of ids) {
      const el = diagram!.elements.find(e => e.id === id)
      const node = root.querySelector(`[data-editor-kind="element"][id="${id}"]`)
      if (!el || !node) continue
      if ((el.class === 'BusBarSection' || el.class === 'Road' || el.class === 'Line' || el.class === 'Polygon') && el.points) {
        node.setAttribute('points', el.points.map(p => `${p.x + dx},${p.y + dy}`).join(' '))
      } else if ((el.class === 'Container' || el.class === 'Picture') && el.points) {
        // A <g> of absolute-coordinate children (outline path and
        // caption) with no transform of its own, so the group is shifted
        // as a whole until the re-render on mouseup replaces it.
        node.setAttribute('transform', `translate(${dx},${dy})`)
      } else if (el.class === 'Arc' && el.points) {
        const arc = elementArc(el)
        if (arc) {
          const shift = (p: Point) => ({ x: p.x + dx, y: p.y + dy })
          node.setAttribute('d', arcPathD({ ...arc, start: shift(arc.start), end: shift(arc.end) }))
        }
      } else if ((el.class === 'Rectangle' || el.class === 'SmallWindow') && el.points) {
        node.setAttribute('x', String(Math.min(el.points[0].x, el.points[1].x) + dx))
        node.setAttribute('y', String(Math.min(el.points[0].y, el.points[1].y) + dy))
      } else if (el.class === 'Circle' && el.points) {
        node.setAttribute('cx', String((el.points[0].x + el.points[1].x) / 2 + dx))
        node.setAttribute('cy', String((el.points[0].y + el.points[1].y) / 2 + dy))
      } else if (el.class === 'Arrow' && el.points) {
        // writeArrow's own <path> d is in local coordinates relative to
        // Points[0] (unaffected by a plain whole-shape translate), so only
        // the transform's translate portion needs updating — its own
        // rotate angle, derived from the two (both moving together, so
        // still-unchanged-relative-to-each-other) Points, stays the same.
        const [p0, p1] = el.points
        const angle = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI
        node.setAttribute('transform', `translate(${p0.x + dx},${p0.y + dy}) rotate(${angle})`)
      } else if ((el.class === 'Button' || el.class === 'WindowIcon' || el.class === 'AutomationDevice') && el.points) {
        // Unlike Rectangle's bare <rect>, a Button's own <rect>/<text> live
        // inside a wrapping <g> with no transform of its own (matching real
        // xsde2svg's own absolute-coordinate markup — see writeButton), so
        // both children need their own x/y updated directly. A Window
        // icon's label sits 2 units below center (writeWindowIcon).
        const x = Math.min(el.points[0].x, el.points[1].x) + dx
        const y = Math.min(el.points[0].y, el.points[1].y) + dy
        const w = Math.abs(el.points[1].x - el.points[0].x)
        const h = Math.abs(el.points[1].y - el.points[0].y)
        const rect = node.querySelector('rect')
        rect?.setAttribute('x', String(x))
        rect?.setAttribute('y', String(y))
        const text = node.querySelector('text')
        text?.setAttribute('x', String(x + w / 2))
        text?.setAttribute('y', String(y + h / 2 + (el.class === 'WindowIcon' || el.class === 'AutomationDevice' ? 2 : 0)))
      } else if (el.class === 'Table' && el.points) {
        // Same wrapping-<g>-of-absolute-coordinate-children structure as
        // Button just above (see writeTable) — its own label additionally
        // rotates around the box's own center when el.orient is set (see
        // ClassTable's own doc comment), so unlike Button's own the
        // text's own transform needs updating too, not just its x/y.
        const x = Math.min(el.points[0].x, el.points[1].x) + dx
        const y = Math.min(el.points[0].y, el.points[1].y) + dy
        const w = Math.abs(el.points[1].x - el.points[0].x)
        const h = Math.abs(el.points[1].y - el.points[0].y)
        const rect = node.querySelector('rect')
        rect?.setAttribute('x', String(x))
        rect?.setAttribute('y', String(y))
        const text = node.querySelector('text')
        if (text) {
          const cx = x + w / 2
          const cy = y + h / 2
          text.setAttribute('x', String(cx))
          text.setAttribute('y', String(cy))
          if (el.orient) text.setAttribute('transform', `rotate(${el.orient},${cx},${cy})`)
        }
      } else if (el.class === 'Table2') {
        // A Table2's own children (one bare <path> per cell, plus an
        // optional <text> per labeled one — see writeTable2) are all drawn
        // in absolute coordinates too, but there can be many of them; far
        // simpler to give the whole wrapping <g> itself a translate()
        // during the drag preview (it carries none normally) than to walk
        // and shift every child individually — the eventual mouseup commit
        // re-renders from the authoritative backend markup either way, so
        // this only ever needs to look right for the duration of the drag.
        node.setAttribute('transform', `translate(${dx},${dy})`)
      } else if (el.class === 'PostPole') {
        // Also a bare tag with no wrapping <g> (see writePole) — its own
        // x/y are absolute, not a local-frame origin a translate() could
        // shift, so its own cx/cy (round) or x/y (square) are set
        // directly instead, the same way Rectangle's/Circle's own do.
        const x = el.x + dx
        const y = el.y + dy
        if (el.square) {
          const radius = el.radius || 10
          node.setAttribute('x', String(x - radius))
          node.setAttribute('y', String(y - radius))
        } else {
          node.setAttribute('cx', String(x))
          node.setAttribute('cy', String(y))
        }
        if (el.orient) node.setAttribute('transform', `rotate(${el.orient},${x},${y})`)
      } else if (el.class === 'PowerflowIndicator') {
        // Also a bare <text> tag with no wrapping <g> (see
        // writePowerflowIndicator) — its own x/y are absolute, with the
        // tag's own y offset +3 from the real anchor (the glyph's own
        // vertical shift) while the rotate() transform's own center stays
        // at the unshifted anchor, matching writePowerflowIndicator's own
        // split exactly.
        const x = el.x + dx
        const y = el.y + dy
        node.setAttribute('x', String(x))
        node.setAttribute('y', String(y + 3))
        node.setAttribute('transform', `rotate(${el.orient ?? 0},${x},${y})`)
      } else {
        // Keep render.go's mirrorScale and size step, or a Mirror'd or
        // resized element changes for the drag (and stays so when the drop
        // re-renders nothing).
        node.setAttribute(
          'transform',
          `translate(${el.x + dx},${el.y + dy}) rotate(${el.orient ?? 0})${el.mirror ? ' scale(-1,1)' : ''}${sizeStepScale(el)}`,
        )
      }
    }
  }

  // Drags a selected label's own <text> (and its <tspan> continuation
  // lines, each of which repeats the same x) directly in the DOM by (dx,
  // dy), the same instant-feedback approach dragElementsInDom uses for an
  // element.
  function dragLabelInDom(id: number, dx: number, dy: number) {
    const root = wrapperRef.current
    const label = diagram!.labels.find(l => l.id === id)
    const node = root?.querySelector(`[data-editor-kind="label"][id="${id}"]`)
    if (!label || !node) return
    const x = label.x + dx
    const y = label.y + dy
    node.setAttribute('x', String(x))
    node.setAttribute('y', String(y))
    node.querySelectorAll('tspan').forEach(tspan => tspan.setAttribute('x', String(x)))
  }

  // Same instant-DOM-first move as dragLabelInDom, for a selected
  // DigitalDevice's own <text> instead of a Label's.
  function dragDigitalDeviceInDom(id: number, dx: number, dy: number) {
    const root = wrapperRef.current
    const digitalDevice = diagram!.digitalDevices.find(dd => dd.id === id)
    const node = root?.querySelector(`[data-editor-kind="digitaldevice"][id="${id}"]`)
    if (!digitalDevice || !node) return
    const x = digitalDevice.x + dx
    const y = digitalDevice.y + dy
    node.setAttribute('x', String(x))
    node.setAttribute('y', String(y))
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    // Space + left-drag pans (the TransformWrapper handles it).
    if (spaceHeld) return
    const point = toPoint(e.clientX, e.clientY)
    // Reached only by a click that didn't land on a vertex/midpoint handle
    // (those stop propagation before this ever runs), so any such click
    // deselects whichever specific bend point was selected.
    if (selectedVertex) setSelectedVertex(null)

    if (topologyPick) {
      e.stopPropagation()
      handleTopologyPickClick(point)
      return
    }

    if (routing) {
      e.stopPropagation()
      handleRoutingClick(point)
      return
    }

    if (armedSymbol) {
      e.stopPropagation()
      if (PEN_DRAWN_SHAPES.has(armedSymbol.shape)) {
        handlePolygonClick(point)
        return
      }
      if (DRAG_TO_DRAW_SHAPES.has(armedSymbol.shape)) {
        const shape = armedSymbol.shape
        setNewBusbar({ start: point, current: point })
        const onMove = (ev: MouseEvent) => {
          setNewBusbar(nb => (nb ? { ...nb, current: toPoint(ev.clientX, ev.clientY) } : nb))
        }
        const onUp = (ev: MouseEvent) => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          const end = toPoint(ev.clientX, ev.clientY)
          setNewBusbar(null)
          const start = snapPoint(point)
          const snappedEnd = snapPoint(end)
          if (shape === PICTURE_SHAPE && Math.hypot(snappedEnd.x - start.x, snappedEnd.y - start.y) > 1) {
            // Placed, selected, and the file picker opened right away
            // (still within this mouseup's user activation).
            const before = diagram!
            const after = diagramOps.placePicture(before, start, snappedEnd)
            updateDiagram(() => after)
            const added = addedItems(before, after)
            selectMany(added)
            const [id] = added.keys()
            if (id !== undefined) choosePictureImage(id)
            return
          }
          if (Math.hypot(snappedEnd.x - start.x, snappedEnd.y - start.y) > 1) {
            updateDiagram(d =>
              shape === RECTANGLE_SHAPE
                ? diagramOps.placeRectangle(d, start, snappedEnd)
                : shape === SMALL_WINDOW_SHAPE
                  ? diagramOps.placeSmallWindow(d, start, snappedEnd)
                : shape === CIRCLE_SHAPE
                  ? diagramOps.placeCircle(d, start, snappedEnd)
                  : shape === ARROW_SHAPE
                    ? diagramOps.placeArrow(d, start, snappedEnd)
                    : shape === BUTTON_SHAPE
                      ? diagramOps.placeButton(d, start, snappedEnd)
                      : shape === WINDOW_ICON_SHAPE
                        ? diagramOps.placeWindowIcon(d, start, snappedEnd)
                      : shape === AUTOMATION_DEVICE_SHAPE
                        ? diagramOps.placeAutomationDevice(d, start, snappedEnd)
                      : shape === ROAD_SHAPE
                        ? diagramOps.placeRoad(d, start, snappedEnd)
                        : shape === LINE_SHAPE
                          ? diagramOps.placeLine(d, start, snappedEnd)
                          : shape === ARC_SHAPE
                            ? diagramOps.placeArc(d, start, snappedEnd)
                            : shape === TABLE_SHAPE
                              ? diagramOps.placeTable(d, start, snappedEnd)
                              : diagramOps.placeBusbar(d, start, snappedEnd, defaultVoltage),
            )
          }
          armSymbol(null)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return
      }
      updateDiagram(d => diagramOps.placeElement(d, armedSymbol, snapPoint(point), defaultVoltage, config?.defaultFpiText))
      armSymbol(null)
      return
    }

    if (armedLabel) {
      e.stopPropagation()
      updateDiagram(d => diagramOps.placeLabel(d, snapPoint(point)))
      armLabel(false)
      return
    }

    if (armedDigitalDevice) {
      e.stopPropagation()
      updateDiagram(d => diagramOps.placeDigitalDevice(d, snapPoint(point)))
      armDigitalDevice(false)
      return
    }

    if (armedCustomElement) {
      e.stopPropagation()
      updateDiagram(d =>
        diagramOps.placeCustomElement(d, armedCustomElement.diagram, snapPoint(point), elements, snapPoint, defaultVoltage, true),
      )
      armCustomElement(null)
      return
    }

    // A plain click landing on an element's own terminal (or, for a shape
    // with none defined, its bare anchor) starts a route from there
    // instead of the usual select/drag — but only while a wire kind is
    // armed from the Elements palette's own "Wires" section
    // (armedWireKind, shown pressed/highlighted there while active).
    // With nothing armed, the default behavior is always select/drag,
    // even for a click landing squarely on a terminal: drawing a
    // connection is something explicitly opted into, not something that
    // happens implicitly just from where the click landed. Holding
    // Ctrl/Cmd additionally accepts any point along a busbar or an
    // already-drawn connector's own line as a start too — without the
    // modifier, a plain click on either of those still means select/drag
    // (busbar) or select/reshape (connector), same as before, since a
    // busbar/connector has no discrete pin of its own (every point along
    // it would otherwise count, swallowing the click). A click anywhere
    // else on the same element's body still falls through to the ordinary
    // hit-test/select/drag logic below, since TERMINAL_HIT_RADIUS is
    // deliberately tight.
    const startTarget = armedWireKind ? findConnectionTarget(point, null, e.ctrlKey || e.metaKey) : null
    if (startTarget) {
      e.stopPropagation()
      setRouting({ from: startTarget, path: [startTarget.point] })
      setRoutingCursor(startTarget.point)
      setConnectTarget(null)
      return
    }

    const target = e.target as HTMLElement
    const hit = target.closest('[data-editor-kind]') as HTMLElement | null
    // A plain click that doesn't land on any real rendered node (e.g. a
    // thin unfilled stroke, or a shape whose anchor sits far from its own
    // drawn body, like VoltageTransformer's terminal-at-the-top) still
    // counts as an element hit if it falls within that element's own real
    // computed bounding box — see elementBoxes' own doc comment. Elements
    // only: a connector/label/digital device's own click area is already
    // its real drawn geometry, no fallback needed.
    let hitKind = hit?.dataset.editorKind
    let hitId = hit ? Number(hit.id) : NaN
    // Shift or Ctrl/Cmd adds to/removes from the selection.
    const toggles = e.shiftKey || e.ctrlKey || e.metaKey
    if (!hit) {
      const boxHit = findElementBoxHit(point)
      if (boxHit === null) {
        // Inside a multi-selection's group box (between its items):
        // drags the whole group. Anywhere else: starts a selection frame.
        const box = selection.size > 1 ? selectionBox() : null
        if (box && !toggles && pointInBox(point, box)) {
          e.stopPropagation()
          const [id, kind] = [...selection][0]
          startGroupDrag(point, id, kind)
          return
        }
        startMarquee(point, e.clientX, e.clientY, toggles)
        return
      }
      hitKind = 'element'
      hitId = boxHit
    }
    e.stopPropagation()

    // Alt/Option-drag duplicates: the whole selection when the item is part
    // of it, otherwise just this item.
    if (e.altKey && (hitKind === 'element' || hitKind === 'connector' || hitKind === 'label' || hitKind === 'digitaldevice')) {
      startDuplicateDrag(point, hitId, hitKind)
      return
    }

    if (hitKind === 'connector') {
      if (toggles) {
        toggleSelection(hitId, 'connector')
        return
      }
      startGroupDrag(point, hitId, 'connector')
      return
    }

    if (hitKind === 'label') {
      if (toggles) {
        toggleSelection(hitId, 'label')
        return
      }
      startGroupDrag(point, hitId, 'label')
      return
    }

    if (hitKind === 'digitaldevice') {
      if (toggles) {
        toggleSelection(hitId, 'digitaldevice')
        return
      }
      startGroupDrag(point, hitId, 'digitaldevice')
      return
    }

    const elementId = hitId

    // Shift- or Ctrl/Cmd-click toggles this element in/out of the
    // multi-selection instead of replacing it or starting a drag.
    if (toggles) {
      toggleSelection(elementId, 'element')
      return
    }

    startGroupDrag(point, elementId, 'element')
  }

  // Starts dragging one endpoint of a selected busbar's Points, from its
  // own handle (a small red square drawn only while that busbar is
  // selected — see the render below). Kept independent of the
  // whole-element drag in handleMouseDown: this moves only one point,
  // recomputing the element's anchor as the new midpoint (see
  // diagramOps.updateBusbarPoint).
  function handlePointMouseDown(e: React.MouseEvent, elementId: number, pointIndex: number) {
    e.stopPropagation()
    const onMove = (ev: MouseEvent) => {
      setPointDrag({ elementId, pointIndex, point: snapPoint(toPoint(ev.clientX, ev.clientY)) })
    }
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const point = snapPoint(toPoint(ev.clientX, ev.clientY))
      setPointDrag(null)
      updateDiagram(d =>
        pointIndex === ARC_BULGE_INDEX && d.elements.find(el => el.id === elementId)?.class === 'Arc'
          ? diagramOps.updateArcBulge(d, elementId, point)
          : diagramOps.updateBusbarPoint(d, elementId, pointIndex, point),
      )
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Drags an existing interior vertex of a selected connector's own
  // geometry (diagramOps.moveConnectorVertex handles keeping it
  // orthogonal). A mousedown that never actually moves is instead treated
  // as selecting that one bend point — distinct from the connector as a
  // whole — so Delete/Backspace can remove just it (see the keydown
  // handler above).
  function handleVertexMouseDown(e: React.MouseEvent, connectorId: number, index: number) {
    e.stopPropagation()
    const start = toPoint(e.clientX, e.clientY)
    let moved = false
    const onMove = (ev: MouseEvent) => {
      const p = toPoint(ev.clientX, ev.clientY)
      if (Math.hypot(p.x - start.x, p.y - start.y) > 1) moved = true
      setVertexDrag({ connectorId, kind: 'vertex', index, point: snapPoint(p) })
    }
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setVertexDrag(null)
      if (!moved) {
        setSelectedVertex({ connectorId, index })
        return
      }
      const point = snapPoint(toPoint(ev.clientX, ev.clientY))
      updateDiagram(d => diagramOps.moveConnectorVertex(d, connectorId, index, point))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Drags a segment's midpoint handle to reshape it: speculatively insert
  // a new vertex right there (diagramOps.insertConnectorVertex) and, once
  // the drag actually lands somewhere, run it through the exact same
  // orthogonality logic as moving any other vertex (moveConnectorVertex).
  // A drop with no real movement re-collapses to nothing —
  // simplifyOrthogonalPath drops a "straight-through" point on its own —
  // so this needs no separate click-vs-drag handling the way a vertex
  // handle does.
  function handleMidpointMouseDown(e: React.MouseEvent, connectorId: number, segmentIndex: number) {
    e.stopPropagation()
    const onMove = (ev: MouseEvent) => {
      setVertexDrag({ connectorId, kind: 'midpoint', segmentIndex, point: snapPoint(toPoint(ev.clientX, ev.clientY)) })
    }
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setVertexDrag(null)
      const point = snapPoint(toPoint(ev.clientX, ev.clientY))
      updateDiagram(d => {
        const withInsert = diagramOps.insertConnectorVertex(d, connectorId, segmentIndex, point)
        return diagramOps.moveConnectorVertex(withInsert, connectorId, segmentIndex + 1, point)
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Drags one of a connector's own two true endpoints — offered only while
  // Canvas has already confirmed (via diagramOps.isConnectorEndpointDangling)
  // that this particular end isn't wired to anything, so there's nothing to
  // silently tear loose. diagramOps.moveConnectorEndpoint keeps the touching
  // segment orthogonal the same projection-lock way a vertex drag does.
  function handleEndpointMouseDown(e: React.MouseEvent, connectorId: number, end: 'from' | 'to') {
    e.stopPropagation()
    const onMove = (ev: MouseEvent) => {
      setVertexDrag({ connectorId, kind: 'endpoint', end, point: snapPoint(toPoint(ev.clientX, ev.clientY)) })
    }
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setVertexDrag(null)
      const point = snapPoint(toPoint(ev.clientX, ev.clientY))
      updateDiagram(d => diagramOps.moveConnectorEndpoint(d, connectorId, end, point))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // The live shape of a connector while one of its own vertices/midpoints/
  // endpoints is being dragged: runs the same pure functions the eventual
  // mouseup will commit, purely to compute what to draw right now — no
  // updateDiagram call, so nothing (lastId included) actually changes
  // until the drag ends. Falls back to the connector's real points
  // whenever it isn't the one currently being dragged.
  function connectorPreviewPoints(connectorId: number, points: Point[]): Point[] {
    if (!vertexDrag || vertexDrag.connectorId !== connectorId) return points
    if (vertexDrag.kind === 'vertex') {
      const preview = diagramOps.moveConnectorVertex(diagram!, connectorId, vertexDrag.index, vertexDrag.point)
      return preview.connectors.find(c => c.id === connectorId)?.points ?? points
    }
    if (vertexDrag.kind === 'endpoint') {
      const preview = diagramOps.moveConnectorEndpoint(diagram!, connectorId, vertexDrag.end, vertexDrag.point)
      return preview.connectors.find(c => c.id === connectorId)?.points ?? points
    }
    const inserted = diagramOps.insertConnectorVertex(diagram!, connectorId, vertexDrag.segmentIndex, vertexDrag.point)
    const preview = diagramOps.moveConnectorVertex(inserted, connectorId, vertexDrag.segmentIndex + 1, vertexDrag.point)
    return preview.connectors.find(c => c.id === connectorId)?.points ?? points
  }

  // Right-click either an element/connector (selecting it, same as a plain
  // click, so Copy/Delete act on it) or empty canvas (selection untouched)
  // and opens a menu positioned at the cursor. diagramPoint is snapped up
  // front so Paste always lands on-grid the same way a click-to-place
  // would.
  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    if (
      armedSymbol ||
      armedWireKind ||
      armedLabel ||
      armedDigitalDevice ||
      armedCustomElement ||
      newBusbar ||
      pointDrag ||
      ghost ||
      routing ||
      vertexDrag ||
      labelDrag ||
      digitalDeviceDrag
    )
      return

    const point = toPoint(e.clientX, e.clientY)
    const diagramPoint = snapPoint(point)
    const hit = (e.target as HTMLElement).closest('[data-editor-kind]') as HTMLElement | null

    // Right-clicking anything that's already part of a multi-selection
    // holding more than one entry keeps that whole selection (so Copy/
    // Delete act on all of it, whatever mix of kinds it holds), matching
    // the usual desktop convention; right-clicking anything else replaces
    // the selection with just that one item, the same as a plain click.
    const keepsSelection = (id: number, kind: SelectionKind) => selection.get(id) === kind && selection.size > 1

    let elementId: number | null = null
    let connectorId: number | null = null
    if (hit) {
      const id = Number(hit.id)
      if (hit.dataset.editorKind === 'connector') {
        connectorId = id
        if (!keepsSelection(id, 'connector')) selectConnector(id)
      } else if (hit.dataset.editorKind === 'label') {
        if (!keepsSelection(id, 'label')) selectLabel(id)
      } else if (hit.dataset.editorKind === 'digitaldevice') {
        if (!keepsSelection(id, 'digitaldevice')) selectDigitalDevice(id)
      } else {
        elementId = id
        if (!keepsSelection(id, 'element')) selectElement(id)
      }
    } else {
      // Same real-bounding-box fallback handleMouseDown's own plain click
      // uses — a right-click that misses the real drawn geometry but still
      // lands within the element's own computed footprint still selects it.
      const boxHit = findElementBoxHit(point)
      if (boxHit !== null) {
        elementId = boxHit
        if (!keepsSelection(boxHit, 'element')) selectElement(boxHit)
      }
    }
    setContextMenu({ x: e.clientX, y: e.clientY, diagramPoint, elementId, connectorId })
  }

  // The context menu's "Topology" submenu: both items start a pick of the
  // second terminal from the first, the one nearest the right-click.
  function topologyMenu(first: () => ConnectTarget | null): ContextMenuItem {
    const start = (mode: 'join' | 'wire') => () => {
      const from = first()
      if (!from) return
      setRouting(null)
      setTopologyPick({ mode, from })
      setConnectTarget(null)
    }
    return {
      label: t('contextMenu.topology'),
      children: [
        { label: t('contextMenu.connectTo'), onSelect: start('join') },
        { label: t('contextMenu.createWireTo'), onSelect: start('wire') },
      ],
    }
  }

  const contextMenuItems: ContextMenuItem[] = contextMenu
    ? [
        ...(selection.size > 0
          ? [
              {
                label: t('contextMenu.copy'),
                onSelect: () => {
                  copySelectionToClipboard()
                },
              },
              { label: t('contextMenu.delete'), onSelect: deleteSelected },
              {
                label: t('contextMenu.saveCustomElement'),
                onSelect: () =>
                  setCustomElementTemplate(
                    diagramOps.extractSelection(diagram, selection, gridSpacing),
                  ),
              },
            ]
          : []),
        // Starts the click-to-route tool right from this element/connector
        // without needing a wire kind armed from the palette first — always
        // BusWork (see startBusworkFrom's own doc comment). Only offered
        // for an element that's actually a valid wire endpoint (same
        // exclusion findConnectionTarget's own search already applies).
        ...(contextMenu.elementId !== null &&
        !NON_ROUTABLE_ELEMENT_CLASSES.has(diagram.elements.find(e => e.id === contextMenu.elementId)?.class ?? '')
          ? [
              {
                label: t('contextMenu.startBuswork'),
                onSelect: () => {
                  const el = diagram.elements.find(e => e.id === contextMenu.elementId)
                  if (!el) return
                  startBusworkFrom(nearestTargetOnElement(el, contextMenu.diagramPoint))
                },
              },
              topologyMenu(() => {
                const el = diagram.elements.find(e => e.id === contextMenu.elementId)
                return el ? nearestTargetOnElement(el, contextMenu.diagramPoint) : null
              }),
            ]
          : []),
        ...(contextMenu.connectorId !== null &&
        (diagram.connectors.find(c => c.id === contextMenu.connectorId)?.points.length ?? 0) >= 2
          ? [
              {
                label: t('contextMenu.startBuswork'),
                onSelect: () => {
                  const connector = diagram.connectors.find(c => c.id === contextMenu.connectorId)
                  if (!connector) return
                  startBusworkFrom(nearestTargetOnConnector(connector, contextMenu.diagramPoint))
                },
              },
              topologyMenu(() => {
                const connector = diagram.connectors.find(c => c.id === contextMenu.connectorId)
                return connector ? nearestTargetOnConnector(connector, contextMenu.diagramPoint) : null
              }),
            ]
          : []),
        // "Delete segment" removes just the segment right-clicked
        // (diagramOps.deleteConnectorSegment splits the rest into up to
        // two independent, possibly-dangling connectors) — always acts on
        // this one connector regardless of the rest of the selection,
        // unlike the generic Delete above (which already covers "delete
        // the whole wire" whenever this connector is part of the current
        // selection, so there's no separate "Delete wire" item any more).
        ...(contextMenu.connectorId !== null &&
        (diagram.connectors.find(c => c.id === contextMenu.connectorId)?.points.length ?? 0) >= 2
          ? [
              {
                label: t('contextMenu.deleteSegment'),
                onSelect: () => {
                  const connector = diagram.connectors.find(c => c.id === contextMenu.connectorId)
                  if (!connector) return
                  const { index } = nearestSegmentOnPolyline(connector.points, contextMenu.diagramPoint)
                  updateDiagram(d => diagramOps.deleteConnectorSegment(d, contextMenu.connectorId!, index))
                },
              },
            ]
          : []),
        {
          label: t('contextMenu.paste'),
          disabled: clipboard === null,
          onSelect: () => {
            if (clipboard) placeCopy(clipboard.template, contextMenu.diagramPoint, snapPoint)
          },
        },
      ]
    : []

  // Only meaningful for a single selection — a multi-selection (size > 1,
  // of any mix of kinds) has no one busbar to show draggable endpoint
  // handles for, so this collapses to null the moment a second item joins
  // the selection.
  const selectedElement =
    selectedElementId !== null && selection.size <= 1
      ? diagram.elements.find(el => el.id === selectedElementId)
      : null
  const selectedElements = diagram.elements.filter(el => elementSelection.has(el.id))
  // Only computed when a terminal or node mark is actually drawn.
  const connectedNodes =
    showNodes || selectedElements.length > 0 ? diagramOps.connectedNodeIds(diagram) : new Set<number>()
  const selectedConnector =
    selectedConnectorId !== null ? diagram.connectors.find(c => c.id === selectedConnectorId) : null

  // The not-yet-anchored tail of an in-progress route: snaps exactly onto
  // connectTarget when one's detected (so the preview shows precisely
  // where a click would land), otherwise follows the grid-snapped cursor.
  const routingPreviewEnd = connectTarget
    ? connectTarget.point
    : routingCursor
      ? snapPoint(routingCursor)
      : null
  const routingPreviewPath =
    routing && routingPreviewEnd ? appendOrthogonalPoint(routing.path, routingPreviewEnd) : null

  // The selection frame, what it would pick if released now (highlighted
  // live), and the one dashed box around a settled multi-selection.
  const marqueeRect = marquee ? pointsBox([marquee.start, marquee.current]) : null
  const marqueeCrossing = marquee ? marquee.current.x < marquee.start.x : false
  const marqueePreview = marquee ? marqueeHits(marquee.start, marquee.current) : null
  const groupBox = !marquee && !ghost && selection.size > 1 ? selectionBox() : null

  return (
    <div className="flex-1 relative overflow-hidden bg-surface-900">
      {warning && (
        <div className="absolute top-2 left-2 z-10 max-w-md rounded bg-state-warning/90 text-black text-xs px-2 py-1">
          {warning}
        </div>
      )}
      <TransformWrapper
        minScale={0.1}
        maxScale={8}
        limitToBounds={false}
        panning={{ allowLeftClickPan: spaceHeld, allowMiddleClickPan: true, allowRightClickPan: false }}
        disabled={
          !spaceHeld &&
          (!!marquee ||
          !!armedSymbol ||
          !!armedWireKind ||
          !!armedLabel ||
          !!armedDigitalDevice ||
          !!armedCustomElement ||
          !!ghost ||
          !!pointDrag ||
          !!routing ||
          !!vertexDrag ||
          !!labelDrag ||
          !!digitalDeviceDrag)
        }
        doubleClick={{ disabled: true }}
      >
        <ZoomControls width={diagram.width} height={diagram.height} />
        <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
          <div
            ref={wrapperRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleWrapperMouseMove}
            onDoubleClick={handleWrapperDoubleClick}
            onContextMenu={handleContextMenu}
            style={{
              position: 'relative',
              width: diagram.width,
              height: diagram.height,
              cursor: spaceHeld
                ? 'grab'
                : armedSymbol || armedWireKind || armedLabel || armedDigitalDevice || armedCustomElement || routing || topologyPick
                  ? 'crosshair'
                  : 'default',
            }}
          >
            {hiddenLayers.size > 0 && <style>{hiddenLayerCss(hiddenLayers)}</style>}
            <div
              ref={renderedRef}
              className="sld-rendered"
              style={{ position: 'absolute', inset: 0 }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <input ref={pictureInputRef} type="file" accept="image/*" className="hidden" onChange={handlePictureFile} />
            {/* Drawn as an overlay above the content, not behind it: the
                backend-rendered SVG paints its own opaque background rect
                (Diagram.Editor.Background), which would otherwise hide a
                grid placed underneath it entirely. Low-opacity dots at each
                intersection keep it a subtle alignment guide rather than a
                distraction. Dots are batched GRID_TILE_FACTOR-per-side into
                one larger pattern tile, rather than one dot per tile at
                gridSpacing itself: a diagram this size (thousands of units)
                at the default 10-unit spacing tiles a single-dot pattern
                tens of thousands of times, and re-zooming this whole layer
                via react-zoom-pan-pinch's own CSS transform (rather than a
                native SVG viewBox zoom) hits a real Chromium quirk where a
                densely-tiled <pattern> under a live scale shows hairline
                seams at scattered tile boundaries — worse mid-gesture, since
                the scale changes every frame. Batching many dots into fewer,
                bigger tiles (same dots, same spacing, identical static
                appearance) cuts the number of tile boundaries by roughly
                GRID_TILE_FACTOR², which is what actually reduces how often a
                seam has a boundary to appear on. */}
            {showGrid && (
              <svg
                width={diagram.width}
                height={diagram.height}
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                <defs>
                  <pattern
                    id="grid"
                    width={gridSpacing * GRID_TILE_FACTOR}
                    height={gridSpacing * GRID_TILE_FACTOR}
                    patternUnits="userSpaceOnUse"
                  >
                    {GRID_TILE_DOTS.map(([row, col]) => (
                      <circle
                        key={`${row}-${col}`}
                        cx={col * gridSpacing}
                        cy={row * gridSpacing}
                        r={0.5}
                        fill="rgba(255,255,255,0.25)"
                      />
                    ))}
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>
            )}
            <svg
              width={diagram.width}
              height={diagram.height}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            >
              {marqueePreview &&
                [...marqueePreview].map(([id, kind]) => {
                  if (kind === 'connector') {
                    const c = diagram.connectors.find(x => x.id === id)
                    return c ? (
                      <polyline
                        key={`mq-${id}`}
                        points={c.points.map(p => `${p.x},${p.y}`).join(' ')}
                        fill="none"
                        stroke={HIGHLIGHT}
                        strokeWidth={2}
                        strokeOpacity={0.7}
                      />
                    ) : null
                  }
                  const box = itemBox(id, kind)
                  return box ? (
                    <rect
                      key={`mq-${id}`}
                      x={box.x - 2}
                      y={box.y - 2}
                      width={box.width + 4}
                      height={box.height + 4}
                      fill={HIGHLIGHT}
                      fillOpacity={0.15}
                      stroke={HIGHLIGHT}
                      strokeWidth={0.5}
                    />
                  ) : null
                })}
              {marqueeRect && (
                <rect
                  x={marqueeRect.x}
                  y={marqueeRect.y}
                  width={marqueeRect.width}
                  height={marqueeRect.height}
                  fill={HIGHLIGHT}
                  fillOpacity={0.08}
                  stroke={HIGHLIGHT}
                  strokeWidth={0.75}
                  strokeDasharray={marqueeCrossing ? '4 3' : undefined}
                />
              )}
              {groupBox && (
                <rect
                  x={groupBox.x}
                  y={groupBox.y}
                  width={groupBox.width}
                  height={groupBox.height}
                  fill="none"
                  stroke={HIGHLIGHT}
                  strokeWidth={0.75}
                  strokeDasharray="6 3"
                />
              )}
              {/* A small X at each of a selected shape's own real
                  terminal positions (base.xml's <terminals>, rotated/
                  translated for this element's own orient/x/y) — purely a
                  visual aid showing where its fixed ports sit, which is
                  where a wire attaches: green when its port's node is
                  connected (diagramOps.connectedNodeIds), red when it's
                  free. Terminal i is port i (fixed ports). Only drawn
                  for the current selection, to keep a busy diagram
                  readable. Hidden for whichever element(s) are mid-drag:
                  dragElementsInDom moves the real symbol directly in the
                  DOM, so a mark still drawn from (unchanged-until-mouseup)
                  diagram state would lag behind it. */}
              {!ghost &&
                selectedElements.flatMap(el => {
                  const points = diagramOps.symbolTerminals(el, elements)
                  if (!points) return []
                  return points.map((p, i) => (
                    <path
                      key={`${el.id}-${i}`}
                      d={`M ${p.x - TERMINAL_MARK_SIZE} ${p.y - TERMINAL_MARK_SIZE} L ${p.x + TERMINAL_MARK_SIZE} ${p.y + TERMINAL_MARK_SIZE} M ${p.x - TERMINAL_MARK_SIZE} ${p.y + TERMINAL_MARK_SIZE} L ${p.x + TERMINAL_MARK_SIZE} ${p.y - TERMINAL_MARK_SIZE}`}
                      stroke={connectedNodes.has(el.ports?.[i]?.node ?? 0) ? TERMINAL_CONNECTED_COLOR : TERMINAL_FREE_COLOR}
                      strokeWidth={0.5}
                    />
                  ))
                })}
              {/* Debug overlay (Settings' "Show nodes"): a small X at
                  every Diagram.Node's own position (green connected, red
                  free, as the terminal marks above), regardless of
                  selection — unlike the selected-terminal marks above,
                  which only show a symbol's own declared Terminals, this
                  shows the real electrical graph (wherever a connector end
                  or an element's Port actually lands), whether or not a
                  symbol happens to draw anything there. */}
              {showNodes &&
                diagram.nodes.map(n => (
                  <path
                    key={`node-${n.id}`}
                    d={`M ${n.x - TERMINAL_MARK_SIZE} ${n.y - TERMINAL_MARK_SIZE} L ${n.x + TERMINAL_MARK_SIZE} ${n.y + TERMINAL_MARK_SIZE} M ${n.x - TERMINAL_MARK_SIZE} ${n.y + TERMINAL_MARK_SIZE} L ${n.x + TERMINAL_MARK_SIZE} ${n.y - TERMINAL_MARK_SIZE}`}
                    stroke={connectedNodes.has(n.id) ? TERMINAL_CONNECTED_COLOR : TERMINAL_FREE_COLOR}
                    strokeWidth={0.25}
                  />
                ))}
              {!ghost &&
                selectedElements.map(el => {
                  if (
                    (el.class === 'BusBarSection' || el.class === 'Arrow' || el.class === 'Road' || el.class === 'Line') &&
                    el.points
                  ) {
                    return (
                      <polyline
                        key={el.id}
                        points={el.points.map(p => `${p.x},${p.y}`).join(' ')}
                        fill="none"
                        stroke={HIGHLIGHT}
                        strokeWidth={6}
                        strokeOpacity={0.5}
                      />
                    )
                  }
                  if (el.class === 'Arc') {
                    const arc = elementArc(el)
                    return arc ? (
                      <path
                        key={el.id}
                        d={arcPathD(arc)}
                        fill="none"
                        stroke={HIGHLIGHT}
                        strokeWidth={6}
                        strokeOpacity={0.5}
                      />
                    ) : null
                  }
                  if ((el.class === 'Polygon' || el.class === 'Container') && el.points) {
                    return (
                      <polygon
                        key={el.id}
                        points={el.points.map(p => `${p.x},${p.y}`).join(' ')}
                        fill="none"
                        stroke={HIGHLIGHT}
                        strokeWidth={6}
                        strokeOpacity={0.5}
                      />
                    )
                  }
                  if ((el.class === 'Rectangle' || el.class === 'SmallWindow' || el.class === 'Picture' || el.class === 'Button' || el.class === 'WindowIcon' || el.class === 'AutomationDevice' || el.class === 'Table') && el.points) {
                    const [p0, p1] = el.points
                    return (
                      <rect
                        key={el.id}
                        x={Math.min(p0.x, p1.x) - BOX_HIGHLIGHT_PAD}
                        y={Math.min(p0.y, p1.y) - BOX_HIGHLIGHT_PAD}
                        width={Math.abs(p1.x - p0.x) + BOX_HIGHLIGHT_PAD * 2}
                        height={Math.abs(p1.y - p0.y) + BOX_HIGHLIGHT_PAD * 2}
                        fill="none"
                        stroke={HIGHLIGHT}
                        strokeWidth={2}
                      />
                    )
                  }
                  if (el.class === 'Circle' && el.points) {
                    const [p0, p1] = el.points
                    return (
                      <ellipse
                        key={el.id}
                        cx={(p0.x + p1.x) / 2}
                        cy={(p0.y + p1.y) / 2}
                        rx={Math.abs(p1.x - p0.x) / 2 + BOX_HIGHLIGHT_PAD}
                        ry={Math.abs(p1.y - p0.y) / 2 + BOX_HIGHLIGHT_PAD}
                        fill="none"
                        stroke={HIGHLIGHT}
                        strokeWidth={2}
                      />
                    )
                  }
                  const box = elementBoxes.get(el.id)
                  // Falls back to the old fixed circle only for the brief
                  // window before elementBoxes' own effect has run for a
                  // just-placed element (e.g. the very first render after
                  // placement) — every other case has a real box.
                  return box ? (
                    <rect
                      key={el.id}
                      x={box.x - BOX_HIGHLIGHT_PAD}
                      y={box.y - BOX_HIGHLIGHT_PAD}
                      width={box.width + BOX_HIGHLIGHT_PAD * 2}
                      height={box.height + BOX_HIGHLIGHT_PAD * 2}
                      fill="none"
                      stroke="red"
                      strokeWidth={0.5}
                      strokeDasharray="4 2"
                    />
                  ) : (
                    <circle
                      key={el.id}
                      cx={el.x}
                      cy={el.y}
                      r={24}
                      fill="none"
                      stroke="red"
                      strokeWidth={0.5}
                      strokeDasharray="4 2"
                    />
                  )
                })}
              {/* Every selected connector gets this basic highlight
                  (including selectedConnector itself) — full reshape/
                  vertex handles below stay singular, tied to
                  selectedConnector alone, since reshaping only ever makes
                  sense for one connector at a time. */}
              {[...connectorSelection]
                .map(id => diagram!.connectors.find(c => c.id === id))
                .filter((c): c is Connector => !!c)
                .map(c => (
                  <polyline
                    key={c.id}
                    points={c.points.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={HIGHLIGHT}
                    strokeWidth={6}
                    strokeOpacity={0.5}
                  />
                ))}
              {/* Every selected label gets a red X at its own anchor point
                  (x,y — where text-anchor/the first line's baseline
                  actually starts), the same X-mark shape a terminal/node
                  uses (TERMINAL_MARK_SIZE), rather than measuring the
                  rendered text's real DOM bounding box; only whichever one
                  is actually being drag-previewed (at most one — see
                  startGroupDrag) gets labelDrag's own live offset. */}
              {[...labelSelection]
                .map(id => diagram!.labels.find(l => l.id === id))
                .filter((l): l is Label => !!l)
                .map(l => {
                  const lx = l.x + (labelDrag?.id === l.id ? labelDrag.dx : 0)
                  const ly = l.y + (labelDrag?.id === l.id ? labelDrag.dy : 0)
                  return (
                    <path
                      key={l.id}
                      d={`M ${lx - SELECTION_MARK_SIZE} ${ly - SELECTION_MARK_SIZE} L ${lx + SELECTION_MARK_SIZE} ${ly + SELECTION_MARK_SIZE} M ${lx - SELECTION_MARK_SIZE} ${ly + SELECTION_MARK_SIZE} L ${lx + SELECTION_MARK_SIZE} ${ly - SELECTION_MARK_SIZE}`}
                      stroke="red"
                      strokeWidth={1}
                    />
                  )
                })}
              {/* Same red X anchor-point marker convention as a selected
                  label, one per selected digital device. */}
              {[...digitalDeviceSelection]
                .map(id => diagram!.digitalDevices.find(dd => dd.id === id))
                .filter((dd): dd is DigitalDevice => !!dd)
                .map(dd => {
                  const dx = dd.x + (digitalDeviceDrag?.id === dd.id ? digitalDeviceDrag.dx : 0)
                  const dy = dd.y + (digitalDeviceDrag?.id === dd.id ? digitalDeviceDrag.dy : 0)
                  return (
                    <path
                      key={dd.id}
                      d={`M ${dx - SELECTION_MARK_SIZE} ${dy - SELECTION_MARK_SIZE} L ${dx + SELECTION_MARK_SIZE} ${dy + SELECTION_MARK_SIZE} M ${dx - SELECTION_MARK_SIZE} ${dy + SELECTION_MARK_SIZE} L ${dx + SELECTION_MARK_SIZE} ${dy - SELECTION_MARK_SIZE}`}
                      stroke="red"
                      strokeWidth={1}
                    />
                  )
                })}
              {selectedConnector &&
                (() => {
                  const points = connectorPreviewPoints(selectedConnector.id, selectedConnector.points)
                  const dragging = vertexDrag?.connectorId === selectedConnector.id
                  return (
                    <>
                      {/* Live preview while a vertex/midpoint is being
                          dragged — the real line (drawn above from
                          selectedConnector.points, and the backend-rendered
                          one underneath it) only updates once the drag
                          commits on mouseup. */}
                      {dragging && (
                        <polyline
                          points={points.map(p => `${p.x},${p.y}`).join(' ')}
                          fill="none"
                          stroke={HIGHLIGHT}
                          strokeWidth={2}
                          strokeDasharray="6 4"
                        />
                      )}
                      {/* One filled square per interior bend point —
                          draggable (diagramOps.moveConnectorVertex keeps
                          both adjoining segments orthogonal), or a plain
                          click selects just that vertex for
                          Delete/Backspace instead of the whole wire. The
                          two true endpoints get no handle here at all when
                          they're a real electrical connection (an element's
                          own Port, or a junction shared with another
                          connector) — only a genuinely dangling one gets
                          the separate unfilled-square handle below. */}
                      {points.slice(1, -1).map((p, i) => {
                        const index = i + 1
                        const isSelected =
                          selectedVertex?.connectorId === selectedConnector.id && selectedVertex.index === index
                        return (
                          <g
                            key={`vertex-${index}`}
                            style={{ pointerEvents: 'auto', cursor: 'move' }}
                            onMouseDown={e => handleVertexMouseDown(e, selectedConnector.id, index)}
                          >
                            <circle cx={p.x} cy={p.y} r={8} fill="transparent" />
                            <rect
                              x={p.x - 4}
                              y={p.y - 4}
                              width={8}
                              height={8}
                              fill={isSelected ? HIGHLIGHT : 'white'}
                              stroke={HIGHLIGHT}
                              strokeWidth={1}
                            />
                          </g>
                        )
                      })}
                      {/* One semi-transparent circle per segment's own
                          midpoint — dragging one splits that segment into
                          two around a brand new bend point
                          (diagramOps.insertConnectorVertex +
                          moveConnectorVertex); a drop with no real
                          movement collapses back to nothing. */}
                      {points.slice(0, -1).map((p, i) => {
                        const next = points[i + 1]
                        const mid = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 }
                        return (
                          <g
                            key={`midpoint-${i}`}
                            style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
                            onMouseDown={e => handleMidpointMouseDown(e, selectedConnector.id, i)}
                          >
                            <circle cx={mid.x} cy={mid.y} r={7} fill="transparent" />
                            <circle cx={mid.x} cy={mid.y} r={3} fill={HIGHLIGHT} fillOpacity={0.5} />
                          </g>
                        )
                      })}
                      {/* An unfilled square handle at either true endpoint,
                          but only while diagramOps.isConnectorEndpointDangling
                          says that end isn't a real electrical connection —
                          dragging it moves the endpoint itself (see
                          handleEndpointMouseDown/moveConnectorEndpoint),
                          unlike the filled squares above which only ever
                          move an interior bend. */}
                      {(['from', 'to'] as const).map(end => {
                        if (!diagramOps.isConnectorEndpointDangling(diagram!, selectedConnector, end)) return null
                        const p = end === 'from' ? points[0] : points[points.length - 1]
                        return (
                          <g
                            key={`endpoint-${end}`}
                            style={{ pointerEvents: 'auto', cursor: 'move' }}
                            onMouseDown={e => handleEndpointMouseDown(e, selectedConnector.id, end)}
                          >
                            <circle cx={p.x} cy={p.y} r={9} fill="transparent" />
                            <rect x={p.x - 4} y={p.y - 4} width={8} height={8} fill="none" stroke={HIGHLIGHT} strokeWidth={1.5} />
                          </g>
                        )
                      })}
                    </>
                  )
                })()}
              {newBusbar &&
              (armedSymbol?.shape === RECTANGLE_SHAPE ||
                armedSymbol?.shape === SMALL_WINDOW_SHAPE ||
                armedSymbol?.shape === PICTURE_SHAPE ||
                armedSymbol?.shape === BUTTON_SHAPE ||
                armedSymbol?.shape === WINDOW_ICON_SHAPE ||
                armedSymbol?.shape === AUTOMATION_DEVICE_SHAPE ||
                armedSymbol?.shape === TABLE_SHAPE) ? (
                <rect
                  x={Math.min(newBusbar.start.x, newBusbar.current.x)}
                  y={Math.min(newBusbar.start.y, newBusbar.current.y)}
                  width={Math.abs(newBusbar.current.x - newBusbar.start.x)}
                  height={Math.abs(newBusbar.current.y - newBusbar.start.y)}
                  fill="none"
                  stroke={HIGHLIGHT}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
              ) : newBusbar && armedSymbol?.shape === ARC_SHAPE ? (
                (() => {
                  const start = snapPoint(newBusbar.start)
                  const end = snapPoint(newBusbar.current)
                  const params = circularArcThrough(start, end, defaultArcBulge(start, end))
                  return (
                    <path
                      d={
                        params
                          ? arcPathD({ start, end, ...params })
                          : `M${newBusbar.start.x},${newBusbar.start.y} L${newBusbar.current.x},${newBusbar.current.y}`
                      }
                      fill="none"
                      stroke={HIGHLIGHT}
                      strokeWidth={2}
                      strokeDasharray="6 4"
                    />
                  )
                })()
              ) : newBusbar && armedSymbol?.shape === CIRCLE_SHAPE ? (
                <ellipse
                  cx={(newBusbar.start.x + newBusbar.current.x) / 2}
                  cy={(newBusbar.start.y + newBusbar.current.y) / 2}
                  rx={Math.abs(newBusbar.current.x - newBusbar.start.x) / 2}
                  ry={Math.abs(newBusbar.current.y - newBusbar.start.y) / 2}
                  fill="none"
                  stroke={HIGHLIGHT}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
              ) : (
                newBusbar && (
                  <line
                    x1={newBusbar.start.x}
                    y1={newBusbar.start.y}
                    x2={newBusbar.current.x}
                    y2={newBusbar.current.y}
                    stroke={HIGHLIGHT}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                  />
                )
              )}
              {selectedElement &&
                (selectedElement.class === 'BusBarSection' ||
                  selectedElement.class === 'Rectangle' ||
                  selectedElement.class === 'SmallWindow' ||
                  selectedElement.class === 'Picture' ||
                  selectedElement.class === 'Circle' ||
                  selectedElement.class === 'Arrow' ||
                  selectedElement.class === 'Button' ||
                  selectedElement.class === 'WindowIcon' ||
                  selectedElement.class === 'AutomationDevice' ||
                  selectedElement.class === 'Road' ||
                  selectedElement.class === 'Line' ||
                  selectedElement.class === 'Polygon' ||
                  selectedElement.class === 'Container' ||
                  selectedElement.class === 'Arc' ||
                  selectedElement.class === 'Table') &&
                selectedElement.points && (
                <>
                  {/* Live preview while a corner/endpoint handle is being
                      dragged — the actual points only update (via
                      updateBusbarPoint) on mouseup. A Rectangle previews as
                      an actual rect outline, a Circle as an actual ellipse
                      outline, rather than the diagonal line a plain 2-point
                      polyline would draw. */}
                  {pointDrag &&
                    pointDrag.elementId === selectedElement.id &&
                    (() => {
                      const pts = selectedElement.points!.map((p, i) => (i === pointDrag.pointIndex ? pointDrag.point : p))
                      if (selectedElement.class === 'Rectangle' || selectedElement.class === 'SmallWindow' || selectedElement.class === 'Picture' || selectedElement.class === 'Button' || selectedElement.class === 'WindowIcon' || selectedElement.class === 'AutomationDevice' || selectedElement.class === 'Table') {
                        const [p0, p1] = pts
                        return (
                          <rect
                            x={Math.min(p0.x, p1.x)}
                            y={Math.min(p0.y, p1.y)}
                            width={Math.abs(p1.x - p0.x)}
                            height={Math.abs(p1.y - p0.y)}
                            fill="none"
                            stroke={HIGHLIGHT}
                            strokeWidth={2}
                            strokeDasharray="6 4"
                          />
                        )
                      }
                      if (selectedElement.class === 'Circle') {
                        const [p0, p1] = pts
                        return (
                          <ellipse
                            cx={(p0.x + p1.x) / 2}
                            cy={(p0.y + p1.y) / 2}
                            rx={Math.abs(p1.x - p0.x) / 2}
                            ry={Math.abs(p1.y - p0.y) / 2}
                            fill="none"
                            stroke={HIGHLIGHT}
                            strokeWidth={2}
                            strokeDasharray="6 4"
                          />
                        )
                      }
                      if (selectedElement.class === 'Arc') {
                        const arc = elementArc(selectedElement, { index: pointDrag.pointIndex, point: pointDrag.point })
                        return arc ? (
                          <path d={arcPathD(arc)} fill="none" stroke={HIGHLIGHT} strokeWidth={2} strokeDasharray="6 4" />
                        ) : null
                      }
                      if (selectedElement.class === 'Polygon' || selectedElement.class === 'Container') {
                        return (
                          <polygon
                            points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                            fill="none"
                            stroke={HIGHLIGHT}
                            strokeWidth={2}
                            strokeDasharray="6 4"
                          />
                        )
                      }
                      return (
                        <polyline
                          points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                          fill="none"
                          stroke={HIGHLIGHT}
                          strokeWidth={2}
                          strokeDasharray="6 4"
                        />
                      )
                    })()}
                  {/* One draggable handle per endpoint: an unfilled red
                      square, plus a larger invisible circle around it for an
                      easier grab target. */}
                  {selectedElement.points.map((p, i) => {
                    const dragging = pointDrag?.elementId === selectedElement.id && pointDrag.pointIndex === i
                    const pos = dragging ? pointDrag!.point : p
                    return (
                      <g
                        key={i}
                        style={{ pointerEvents: 'auto', cursor: 'move' }}
                        onMouseDown={e => handlePointMouseDown(e, selectedElement.id, i)}
                      >
                        <circle cx={pos.x} cy={pos.y} r={10} fill="transparent" />
                        <rect x={pos.x - 5} y={pos.y - 5} width={10} height={10} fill="none" stroke="red" strokeWidth={1} />
                      </g>
                    )
                  })}
                  {/* An Arc's own bulge handle, at its curve's midpoint
                      (a circle, unlike the square start/end handles):
                      dragging it reshapes the arc into the circular one
                      through start, the handle, and end. */}
                  {selectedElement.class === 'Arc' &&
                    (() => {
                      const dragging =
                        pointDrag?.elementId === selectedElement.id && pointDrag.pointIndex === ARC_BULGE_INDEX
                      const arc = elementArc(
                        selectedElement,
                        pointDrag?.elementId === selectedElement.id
                          ? { index: pointDrag.pointIndex, point: pointDrag.point }
                          : undefined,
                      )
                      if (!arc) return null
                      const pos = dragging ? pointDrag!.point : arcMidpoint(arc)
                      return (
                        <g
                          style={{ pointerEvents: 'auto', cursor: 'move' }}
                          onMouseDown={e => handlePointMouseDown(e, selectedElement.id, ARC_BULGE_INDEX)}
                        >
                          <circle cx={pos.x} cy={pos.y} r={10} fill="transparent" />
                          <circle cx={pos.x} cy={pos.y} r={5} fill="none" stroke="red" strokeWidth={1} />
                        </g>
                      )
                    })()}
                </>
              )}
              {/* An in-progress pen-tool Polygon: the vertices placed so
                  far drawn solid, the rubber-band segment to the cursor
                  dashed, and a circle on the first vertex that grows and
                  turns green while a click there would close the path. */}
              {polygonDraft && (
                <>
                  <polyline
                    points={polygonDraft.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={HIGHLIGHT}
                    strokeWidth={2}
                  />
                  {polygonCursor && (
                    <line
                      x1={polygonDraft[polygonDraft.length - 1].x}
                      y1={polygonDraft[polygonDraft.length - 1].y}
                      x2={polygonCursor.x}
                      y2={polygonCursor.y}
                      stroke={HIGHLIGHT}
                      strokeWidth={2}
                      strokeOpacity={0.6}
                      strokeDasharray="6 4"
                    />
                  )}
                  {polygonDraft.map((p, i) => (
                    <rect key={i} x={p.x - 1.5} y={p.y - 1.5} width={3} height={3} fill={HIGHLIGHT} />
                  ))}
                  {(() => {
                    const closing = !!polygonCursor && isPolygonClosePoint(polygonDraft, polygonCursor)
                    return (
                      <circle
                        cx={polygonDraft[0].x}
                        cy={polygonDraft[0].y}
                        r={closing ? 5 : 3}
                        fill="none"
                        stroke={closing ? CONNECT_TARGET_COLOR : HIGHLIGHT}
                        strokeWidth={closing ? 1.5 : 1}
                      />
                    )
                  })()}
                </>
              )}
              {/* An in-progress click-to-route: routing.path (already
                  anchored by earlier clicks) drawn solid, the not-yet-
                  anchored tail to the cursor (or, once one's found, right
                  onto connectTarget) drawn dashed — matching the "anchored
                  vs. still-live" convention a real routing tool uses. */}
              {routing && (
                <polyline
                  points={routing.path.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={HIGHLIGHT}
                  strokeWidth={2}
                />
              )}
              {routing && routingPreviewPath && (
                <polyline
                  points={routingPreviewPath.slice(routing.path.length - 1).map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={HIGHLIGHT}
                  strokeWidth={2}
                  strokeOpacity={0.6}
                  strokeDasharray="6 4"
                />
              )}
              {/* connectTarget doubles as an idle "here's a pin you could
                  start a route from" hover cue (blue X) and, mid-route, a
                  "click now to complete here" cue (green X, larger than the
                  plain red per-selection terminal marks above) — both the
                  same shape per the same convention, just recolored/resized
                  for what a click would do right now. */}
              {/* A pending Topology pick: its first terminal ringed, and a
                  dashed line to the second while one is under the cursor. */}
              {topologyPick && (
                <circle
                  cx={topologyPick.from.point.x}
                  cy={topologyPick.from.point.y}
                  r={TERMINAL_MARK_SIZE * 2}
                  fill="none"
                  stroke={CONNECT_TARGET_COLOR}
                  strokeWidth={1}
                />
              )}
              {topologyPick && connectTarget && (
                <line
                  x1={topologyPick.from.point.x}
                  y1={topologyPick.from.point.y}
                  x2={connectTarget.point.x}
                  y2={connectTarget.point.y}
                  stroke={CONNECT_TARGET_COLOR}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
              )}
              {connectTarget && (
                <path
                  d={`M ${connectTarget.point.x - TERMINAL_MARK_SIZE * 2} ${connectTarget.point.y - TERMINAL_MARK_SIZE * 2} L ${connectTarget.point.x + TERMINAL_MARK_SIZE * 2} ${connectTarget.point.y + TERMINAL_MARK_SIZE * 2} M ${connectTarget.point.x - TERMINAL_MARK_SIZE * 2} ${connectTarget.point.y + TERMINAL_MARK_SIZE * 2} L ${connectTarget.point.x + TERMINAL_MARK_SIZE * 2} ${connectTarget.point.y - TERMINAL_MARK_SIZE * 2}`}
                  stroke={routing || topologyPick ? CONNECT_TARGET_COLOR : HIGHLIGHT}
                  strokeWidth={1}
                />
              )}
            </svg>
          </div>
        </TransformComponent>
      </TransformWrapper>
      {topologyPick && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded bg-surface-700/90 px-3 py-1 text-xs text-gray-200 shadow">
          {t(topologyPick.mode === 'join' ? 'canvas.connectToHint' : 'canvas.createWireToHint')}
        </div>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
      {customElementTemplate && (
        <SaveCustomElementDialog template={customElementTemplate} onClose={() => setCustomElementTemplate(null)} />
      )}
    </div>
  )
}
