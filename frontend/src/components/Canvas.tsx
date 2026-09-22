import { useCallback, useEffect, useRef, useState } from 'react'
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { useDiagramContext } from '../state/useDiagramContext'
import * as api from '../lib/api'
import * as diagramOps from '../lib/diagramOps'
import { clientToDiagramPoint, nearestSegmentOnPolyline, snapPointOnSegment, snapValue } from '../lib/geometry'
import { t } from '../i18n'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import type { Point } from '../types'

const BUSBAR_SHAPE = '24'
const RECTANGLE_SHAPE = '3'
const CIRCLE_SHAPE = '4'
const ARROW_SHAPE = '2'
// Shapes placed by dragging out two opposite points rather than a single
// click — see diagramOps.POINTS_BASED_CLASSES for the element-class
// equivalent used once one's already on the diagram.
const DRAG_TO_DRAW_SHAPES: ReadonlySet<string> = new Set([BUSBAR_SHAPE, RECTANGLE_SHAPE, CIRCLE_SHAPE, ARROW_SHAPE])
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
// Padding (diagram units) added around a symbol element's own real
// computed bounding box — see elementBoxes' own doc comment — for its
// selection-highlight rect, and, separately (and more tightly), for the
// click-tolerance fallback in findElementBoxHit. Matches sld-viewer's own
// equivalent constants (its own highlight pad and BBOX_HIT_PAD), the
// reference this project's UI/UX follows.
const BOX_HIGHLIGHT_PAD = 6
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

// Renders the current in-memory diagram by asking the backend to render it
// (POST /api/render, debounced), rather than reimplementing
// internal/slddoc's symbol-template rendering in the browser. Selection,
// drag, click-to-place and click-to-connect are all handled here by
// hit-testing a click against the data-editor-kind ("element" or
// "connector") marker Render writes on every selectable node, and reading
// its plain DOM id (the element/connector's own bare integer id, parsed
// back out of the string the DOM always represents it as) — then mutating
// diagram state directly. The resulting re-render (debounced) is what
// keeps the displayed SVG in sync; a lightweight local "ghost" overlay
// gives instant feedback for an in-progress drag/draw without waiting on
// that round trip.
export function Canvas() {
  const {
    diagram,
    config,
    elements,
    selectedElementId,
    selectedElementIds,
    toggleElementSelection,
    selectedConnectorId,
    selectedLabelId,
    selectedDigitalDeviceId,
    armedSymbol,
    armedWireKind,
    armedLabel,
    armedDigitalDevice,
    defaultVoltage,
    selectElement,
    selectConnector,
    selectLabel,
    selectDigitalDevice,
    armSymbol,
    armWireKind,
    armLabel,
    armDigitalDevice,
    deleteSelected,
    updateDiagram,
  } = useDiagramContext()

  const [svg, setSvg] = useState('')
  const [warning, setWarning] = useState<string | null>(null)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [newBusbar, setNewBusbar] = useState<NewBusbar | null>(null)
  const [pointDrag, setPointDrag] = useState<PointDrag | null>(null)
  const [labelDrag, setLabelDrag] = useState<LabelDrag | null>(null)
  const [digitalDeviceDrag, setDigitalDeviceDrag] = useState<DigitalDeviceDrag | null>(null)
  const [clipboard, setClipboard] = useState<diagramOps.ClipboardEntry[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [routing, setRouting] = useState<Routing | null>(null)
  const [routingCursor, setRoutingCursor] = useState<Point | null>(null)
  const [connectTarget, setConnectTarget] = useState<ConnectTarget | null>(null)
  const [vertexDrag, setVertexDrag] = useState<VertexDrag | null>(null)
  const [selectedVertex, setSelectedVertex] = useState<SelectedVertex | null>(null)
  const [elementBoxes, setElementBoxes] = useState<Map<number, ElementBox>>(new Map())
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!diagram) {
      setSvg('')
      setWarning(null)
      return
    }
    let cancelled = false
    const handle = setTimeout(() => {
      api
        .renderPreview(diagram)
        .then(res => {
          if (cancelled) return
          setSvg(res.svg)
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
  // click-tolerance box needed. A Rectangle, Circle, or Arrow, unlike a
  // busbar, is skipped in the DOM-lookup sense (each is a bare
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
  // over per-shape-accurate hit geometry.
  useEffect(() => {
    const root = wrapperRef.current
    if (!root || !diagram) {
      setElementBoxes(new Map())
      return
    }
    const boxes = new Map<number, ElementBox>()
    for (const el of diagram.elements) {
      if (el.class === 'BusBarSection') continue
      if ((el.class === 'Rectangle' || el.class === 'Circle' || el.class === 'Arrow') && el.points) {
        const [p0, p1] = el.points
        const x = Math.min(p0.x, p1.x)
        const y = Math.min(p0.y, p1.y)
        boxes.set(el.id, { x, y, width: Math.abs(p1.x - p0.x), height: Math.abs(p1.y - p0.y) })
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
      const corners = [
        { x: local.x, y: local.y },
        { x: local.x + local.width, y: local.y },
        { x: local.x, y: local.y + local.height },
        { x: local.x + local.width, y: local.y + local.height },
      ].map(p => diagramOps.placeLocalPoint(el, p))
      const xs = corners.map(p => p.x)
      const ys = corners.map(p => p.y)
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      boxes.set(el.id, { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY })
    }
    setElementBoxes(boxes)
  }, [svg, diagram])

  /** Finds the smallest (by area) symbol element whose own real bounding
   * box — padded by BOX_HIT_PAD for click tolerance — contains point;
   * null if none does. The smallest-wins tie-break matches sld-viewer's
   * own equivalent fallback, favoring the more precise match on overlap. */
  function findElementBoxHit(point: Point): number | null {
    let bestId: number | null = null
    let bestArea = Infinity
    for (const [id, box] of elementBoxes) {
      if (
        point.x < box.x - BOX_HIT_PAD ||
        point.x > box.x + box.width + BOX_HIT_PAD ||
        point.y < box.y - BOX_HIT_PAD ||
        point.y > box.y + box.height + BOX_HIT_PAD
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
        if (routing) {
          setRouting(null)
          setRoutingCursor(null)
        } else if (selectedVertex) setSelectedVertex(null)
        else if (contextMenu) setContextMenu(null)
        else if (armedSymbol) armSymbol(null)
        else if (armedWireKind) armWireKind(null)
        else if (armedLabel) armLabel(false)
        else if (armedDigitalDevice) armDigitalDevice(false)
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
    deleteSelected,
    armSymbol,
    armWireKind,
    armLabel,
    armDigitalDevice,
    selectElement,
    contextMenu,
    routing,
    selectedVertex,
    updateDiagram,
  ])

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
      // A Rectangle/Circle/Arrow is a purely decorative annotation, never
      // a valid wire endpoint — unlike every other class here, none even
      // falls back to its own anchor (see diagramOps.connectElements' own
      // matching guard).
      if (el.class === 'Rectangle' || el.class === 'Circle' || el.class === 'Arrow') continue
      if (el.class === 'BusBarSection' && el.points && el.points.length >= 2) {
        if (!includeBusbars) continue
        const { index, point: nearest } = nearestSegmentOnPolyline(el.points, point)
        const p = snapPointOnSegment(el.points[index], el.points[index + 1], nearest, gridSpacing, snapEnabled)
        const dist = Math.hypot(p.x - point.x, p.y - point.y)
        if (dist < bestDist) {
          bestDist = dist
          best = { kind: 'element', elementId: el.id, point: p }
        }
        continue
      }
      const terminals = diagramOps.symbolTerminals(el, elements) ?? [{ x: el.x, y: el.y }]
      for (const term of terminals) {
        const dist = Math.hypot(term.x - point.x, term.y - point.y)
        if (dist < bestDist) {
          bestDist = dist
          best = { kind: 'element', elementId: el.id, point: term }
        }
      }
    }
    if (includeBusbars) {
      for (const c of diagram!.connectors) {
        if (exclude?.kind === 'connector' && c.id === exclude.connectorId) continue
        if (c.kind === 'OverheadLine') {
          // Unlike every other connector kind (tappable anywhere along its
          // own line, via nearestSegmentOnPolyline below), an overhead
          // line only accepts a connection at its own two true begin/end
          // points — same tight TERMINAL_HIT_RADIUS an element's own
          // terminal uses, not the loose "anywhere on the line" search.
          // diagramOps.spliceConnectorAt already treats landing exactly on
          // one of these as a plain existing-Node reuse rather than a
          // real split, so this restriction is also what makes that the
          // only way to land here at all.
          const ends: [Point, number][] = [
            [c.points[0], 0],
            [c.points[c.points.length - 1], c.points.length - 2],
          ]
          for (const [p, segmentIndex] of ends) {
            const dist = Math.hypot(p.x - point.x, p.y - point.y)
            if (dist < bestDist) {
              bestDist = dist
              best = { kind: 'connector', connectorId: c.id, segmentIndex, point: p }
            }
          }
          continue
        }
        const { index, point: nearest } = nearestSegmentOnPolyline(c.points, point)
        const p = snapPointOnSegment(c.points[index], c.points[index + 1], nearest, gridSpacing, snapEnabled)
        const dist = Math.hypot(p.x - point.x, p.y - point.y)
        if (dist < bestDist) {
          bestDist = dist
          best = { kind: 'connector', connectorId: c.id, segmentIndex: index, point: p }
        }
      }
    }
    return best
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
    if (armedSymbol || ghost || pointDrag || newBusbar || labelDrag || digitalDeviceDrag) return
    const point = toPoint(e.clientX, e.clientY)
    if (routing) {
      setConnectTarget(findConnectionTarget(point, routing.from, true))
      setRoutingCursor(point)
    } else if (armedWireKind) {
      setConnectTarget(findConnectionTarget(point, null, e.ctrlKey || e.metaKey))
    } else {
      setConnectTarget(null)
    }
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
      const path = appendOrthogonalPoint(routing.path, target.point)
      const from = routing.from
      const kind = armedWireKind ?? 'BusWork'
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
      setRouting(null)
      setRoutingCursor(null)
      setConnectTarget(null)
      if (armedWireKind) armWireKind(null)
      return
    }
    setRouting({ ...routing, path: appendOrthogonalPoint(routing.path, snapPoint(point)) })
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
      if (!connector) return
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
  // BusBarSection/Rectangle/Circle (see diagramOps.POINTS_BASED_CLASSES)
  // has no single anchor to translate via a transform, so its own
  // points-derived attributes are set directly instead — a busbar's
  // <polyline points>, a rectangle's <rect x y> (its width/height are
  // unaffected by a plain translate, only x/y shift), or a circle's
  // <ellipse cx cy> (its own rx/ry likewise unaffected).
  function dragElementsInDom(ids: number[], dx: number, dy: number) {
    const root = wrapperRef.current
    if (!root) return
    for (const id of ids) {
      const el = diagram!.elements.find(e => e.id === id)
      const node = root.querySelector(`[data-editor-kind="element"][id="${id}"]`)
      if (!el || !node) continue
      if (el.class === 'BusBarSection' && el.points) {
        node.setAttribute('points', el.points.map(p => `${p.x + dx},${p.y + dy}`).join(' '))
      } else if (el.class === 'Rectangle' && el.points) {
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
      } else {
        node.setAttribute('transform', `translate(${el.x + dx},${el.y + dy}) rotate(${el.orient ?? 0})`)
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
    const point = toPoint(e.clientX, e.clientY)
    // Reached only by a click that didn't land on a vertex/midpoint handle
    // (those stop propagation before this ever runs), so any such click
    // deselects whichever specific bend point was selected.
    if (selectedVertex) setSelectedVertex(null)

    if (routing) {
      e.stopPropagation()
      handleRoutingClick(point)
      return
    }

    if (armedSymbol) {
      e.stopPropagation()
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
          if (Math.hypot(snappedEnd.x - start.x, snappedEnd.y - start.y) > 1) {
            updateDiagram(d =>
              shape === RECTANGLE_SHAPE
                ? diagramOps.placeRectangle(d, start, snappedEnd)
                : shape === CIRCLE_SHAPE
                  ? diagramOps.placeCircle(d, start, snappedEnd)
                  : shape === ARROW_SHAPE
                    ? diagramOps.placeArrow(d, start, snappedEnd)
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
    if (!hit) {
      const boxHit = findElementBoxHit(point)
      if (boxHit === null) {
        selectElement(null)
        return
      }
      hitKind = 'element'
      hitId = boxHit
    }
    e.stopPropagation()

    if (hitKind === 'connector') {
      selectConnector(hitId)
      return
    }

    if (hitKind === 'label') {
      const labelId = hitId
      selectLabel(labelId)
      const onMove = (ev: MouseEvent) => {
        const p = toPoint(ev.clientX, ev.clientY)
        const dx = snapValue(p.x - point.x, gridSpacing, snapEnabled)
        const dy = snapValue(p.y - point.y, gridSpacing, snapEnabled)
        setLabelDrag({ id: labelId, dx, dy })
        dragLabelInDom(labelId, dx, dy)
      }
      const onUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        const p = toPoint(ev.clientX, ev.clientY)
        const dx = snapValue(p.x - point.x, gridSpacing, snapEnabled)
        const dy = snapValue(p.y - point.y, gridSpacing, snapEnabled)
        setLabelDrag(null)
        if (dx !== 0 || dy !== 0) {
          dragLabelInDom(labelId, dx, dy)
          updateDiagram(d => diagramOps.moveLabel(d, labelId, dx, dy))
        }
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      return
    }

    if (hitKind === 'digitaldevice') {
      const digitalDeviceId = hitId
      selectDigitalDevice(digitalDeviceId)
      const onMove = (ev: MouseEvent) => {
        const p = toPoint(ev.clientX, ev.clientY)
        const dx = snapValue(p.x - point.x, gridSpacing, snapEnabled)
        const dy = snapValue(p.y - point.y, gridSpacing, snapEnabled)
        setDigitalDeviceDrag({ id: digitalDeviceId, dx, dy })
        dragDigitalDeviceInDom(digitalDeviceId, dx, dy)
      }
      const onUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        const p = toPoint(ev.clientX, ev.clientY)
        const dx = snapValue(p.x - point.x, gridSpacing, snapEnabled)
        const dy = snapValue(p.y - point.y, gridSpacing, snapEnabled)
        setDigitalDeviceDrag(null)
        if (dx !== 0 || dy !== 0) {
          dragDigitalDeviceInDom(digitalDeviceId, dx, dy)
          updateDiagram(d => diagramOps.moveDigitalDevice(d, digitalDeviceId, dx, dy))
        }
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      return
    }

    const elementId = hitId

    // Shift-click toggles this element in/out of the multi-selection
    // instead of replacing it or starting a drag — matches the common
    // desktop convention, and keeps Ctrl/Cmd-click free for
    // click-to-connect below.
    if (e.shiftKey) {
      toggleElementSelection(elementId)
      return
    }

    if ((e.ctrlKey || e.metaKey) && selectedElementId !== null && selectedElementId !== elementId) {
      updateDiagram(d => diagramOps.connectElements(d, selectedElementId, elementId))
      selectElement(elementId)
      return
    }

    // Dragging an element that's already part of a multi-selection moves
    // every selected element together; dragging anything else (including a
    // click on an unselected element while a multi-selection exists)
    // replaces the selection with just that one, like a plain click always
    // has.
    const movingIds = selectedElementIds.has(elementId) && selectedElementIds.size > 1 ? [...selectedElementIds] : [elementId]
    if (movingIds.length === 1) selectElement(elementId)

    const onMove = (ev: MouseEvent) => {
      const p = toPoint(ev.clientX, ev.clientY)
      const dx = snapValue(p.x - point.x, gridSpacing, snapEnabled)
      const dy = snapValue(p.y - point.y, gridSpacing, snapEnabled)
      setGhost({ ids: movingIds, dx, dy })
      dragElementsInDom(movingIds, dx, dy)
    }
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const p = toPoint(ev.clientX, ev.clientY)
      const dx = snapValue(p.x - point.x, gridSpacing, snapEnabled)
      const dy = snapValue(p.y - point.y, gridSpacing, snapEnabled)
      setGhost(null)
      if (dx !== 0 || dy !== 0) {
        dragElementsInDom(movingIds, dx, dy)
        updateDiagram(d => diagramOps.moveElements(d, movingIds, dx, dy))
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
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
      updateDiagram(d => diagramOps.updateBusbarPoint(d, elementId, pointIndex, point))
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

    let elementId: number | null = null
    let connectorId: number | null = null
    if (hit) {
      const id = Number(hit.id)
      if (hit.dataset.editorKind === 'connector') {
        connectorId = id
        selectConnector(id)
      } else if (hit.dataset.editorKind === 'label') {
        // No dedicated context-menu entries for a label yet (Delete/
        // Backspace and Properties' own delete button already cover it) —
        // just select it, same as a plain click would, rather than
        // misreading its id as an element's and showing element-only items.
        selectLabel(id)
      } else if (hit.dataset.editorKind === 'digitaldevice') {
        // Same treatment as a label — no dedicated context-menu entries yet.
        selectDigitalDevice(id)
      } else {
        elementId = id
        // Right-clicking an element that's already part of a multi-selection
        // keeps that whole selection (so Copy/Delete act on all of it),
        // matching the usual desktop convention; right-clicking anything
        // else replaces the selection with just that one element.
        if (!(selectedElementIds.has(id) && selectedElementIds.size > 1)) selectElement(id)
      }
    } else {
      // Same real-bounding-box fallback handleMouseDown's own plain click
      // uses — a right-click that misses the real drawn geometry but still
      // lands within the element's own computed footprint still selects it.
      const boxHit = findElementBoxHit(point)
      if (boxHit !== null) {
        elementId = boxHit
        if (!(selectedElementIds.has(boxHit) && selectedElementIds.size > 1)) selectElement(boxHit)
      }
    }
    setContextMenu({ x: e.clientX, y: e.clientY, diagramPoint, elementId, connectorId })
  }

  const contextMenuItems: ContextMenuItem[] = contextMenu
    ? [
        ...(contextMenu.elementId !== null
          ? [
              {
                label: t('contextMenu.copy'),
                onSelect: () => {
                  const ids = selectedElementIds.size > 0 ? selectedElementIds : new Set([contextMenu.elementId!])
                  setClipboard(diagramOps.copyElements(diagram.elements.filter(e => ids.has(e.id))))
                },
              },
            ]
          : []),
        ...(contextMenu.elementId !== null ? [{ label: t('contextMenu.delete'), onSelect: deleteSelected }] : []),
        // A connector gets two distinct deletions instead of the
        // element's single one: "Delete segment" removes just the segment
        // right-clicked (diagramOps.deleteConnectorSegment splits the rest
        // into up to two independent, possibly-dangling connectors),
        // "Delete wire" is the existing whole-connector removal.
        ...(contextMenu.connectorId !== null
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
              { label: t('contextMenu.deleteWire'), onSelect: deleteSelected },
            ]
          : []),
        {
          label: t('contextMenu.paste'),
          disabled: clipboard.length === 0,
          onSelect: () => {
            if (clipboard.length > 0)
              updateDiagram(d => diagramOps.pasteElements(d, clipboard, contextMenu.diagramPoint, snapPoint))
          },
        },
      ]
    : []

  // Only meaningful for a single selection — a multi-selection (size > 1)
  // has no one busbar to show draggable endpoint handles for, so this
  // collapses to null the moment a second element joins the selection.
  const selectedElement =
    selectedElementId !== null && selectedElementIds.size <= 1
      ? diagram.elements.find(el => el.id === selectedElementId)
      : null
  const selectedElements = diagram.elements.filter(el => selectedElementIds.has(el.id))
  const selectedConnector =
    selectedConnectorId !== null ? diagram.connectors.find(c => c.id === selectedConnectorId) : null
  const selectedLabel = selectedLabelId !== null ? diagram.labels.find(l => l.id === selectedLabelId) : null
  const selectedDigitalDevice =
    selectedDigitalDeviceId !== null
      ? diagram.digitalDevices.find(dd => dd.id === selectedDigitalDeviceId)
      : null

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
        disabled={
          !!armedSymbol ||
          !!armedWireKind ||
          !!armedLabel ||
          !!armedDigitalDevice ||
          !!ghost ||
          !!pointDrag ||
          !!routing ||
          !!vertexDrag ||
          !!labelDrag ||
          !!digitalDeviceDrag
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
              cursor:
                armedSymbol || armedWireKind || armedLabel || armedDigitalDevice || routing
                  ? 'crosshair'
                  : 'default',
            }}
          >
            <div style={{ position: 'absolute', inset: 0 }} dangerouslySetInnerHTML={{ __html: svg }} />
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
              {/* A small red X at each of a selected shape's own real
                  terminal positions (base.xml's <terminals>, rotated/
                  translated for this element's own orient/x/y) — purely a
                  visual aid showing where a real electrical connection
                  could be made; Ctrl/Cmd-click-to-connect itself still
                  joins two elements' bare anchors regardless. Only drawn
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
                      stroke="red"
                      strokeWidth={0.5}
                    />
                  ))
                })}
              {/* Debug overlay (Settings' "Show nodes"): a small red X at
                  every Diagram.Node's own position, regardless of
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
                    stroke="red"
                    strokeWidth={0.25}
                  />
                ))}
              {!ghost &&
                selectedElements.map(el => {
                  if ((el.class === 'BusBarSection' || el.class === 'Arrow') && el.points) {
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
                  if (el.class === 'Rectangle' && el.points) {
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
              {selectedConnector && (
                <polyline
                  points={selectedConnector.points.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={HIGHLIGHT}
                  strokeWidth={6}
                  strokeOpacity={0.5}
                />
              )}
              {/* A selected label gets a red X at its own anchor point (x,y
                  — where text-anchor/the first line's baseline actually
                  starts), the same X-mark shape a terminal/node uses
                  (TERMINAL_MARK_SIZE), rather than measuring the rendered
                  text's real DOM bounding box. */}
              {selectedLabel &&
                (() => {
                  const lx = selectedLabel.x + (labelDrag?.id === selectedLabel.id ? labelDrag.dx : 0)
                  const ly = selectedLabel.y + (labelDrag?.id === selectedLabel.id ? labelDrag.dy : 0)
                  return (
                    <path
                      d={`M ${lx - SELECTION_MARK_SIZE} ${ly - SELECTION_MARK_SIZE} L ${lx + SELECTION_MARK_SIZE} ${ly + SELECTION_MARK_SIZE} M ${lx - SELECTION_MARK_SIZE} ${ly + SELECTION_MARK_SIZE} L ${lx + SELECTION_MARK_SIZE} ${ly - SELECTION_MARK_SIZE}`}
                      stroke="red"
                      strokeWidth={1}
                    />
                  )
                })()}
              {/* Same red X anchor-point marker convention as a selected
                  label. */}
              {selectedDigitalDevice &&
                (() => {
                  const dx =
                    selectedDigitalDevice.x +
                    (digitalDeviceDrag?.id === selectedDigitalDevice.id ? digitalDeviceDrag.dx : 0)
                  const dy =
                    selectedDigitalDevice.y +
                    (digitalDeviceDrag?.id === selectedDigitalDevice.id ? digitalDeviceDrag.dy : 0)
                  return (
                    <path
                      d={`M ${dx - SELECTION_MARK_SIZE} ${dy - SELECTION_MARK_SIZE} L ${dx + SELECTION_MARK_SIZE} ${dy + SELECTION_MARK_SIZE} M ${dx - SELECTION_MARK_SIZE} ${dy + SELECTION_MARK_SIZE} L ${dx + SELECTION_MARK_SIZE} ${dy - SELECTION_MARK_SIZE}`}
                      stroke="red"
                      strokeWidth={1}
                    />
                  )
                })()}
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
              {newBusbar && armedSymbol?.shape === RECTANGLE_SHAPE ? (
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
                  selectedElement.class === 'Circle' ||
                  selectedElement.class === 'Arrow') &&
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
                      if (selectedElement.class === 'Rectangle') {
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
              {connectTarget && (
                <path
                  d={`M ${connectTarget.point.x - TERMINAL_MARK_SIZE * 2} ${connectTarget.point.y - TERMINAL_MARK_SIZE * 2} L ${connectTarget.point.x + TERMINAL_MARK_SIZE * 2} ${connectTarget.point.y + TERMINAL_MARK_SIZE * 2} M ${connectTarget.point.x - TERMINAL_MARK_SIZE * 2} ${connectTarget.point.y + TERMINAL_MARK_SIZE * 2} L ${connectTarget.point.x + TERMINAL_MARK_SIZE * 2} ${connectTarget.point.y - TERMINAL_MARK_SIZE * 2}`}
                  stroke={routing ? CONNECT_TARGET_COLOR : HIGHLIGHT}
                  strokeWidth={1}
                />
              )}
            </svg>
          </div>
        </TransformComponent>
      </TransformWrapper>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
