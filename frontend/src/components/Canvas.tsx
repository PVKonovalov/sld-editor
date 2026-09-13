import { useEffect, useRef, useState } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { useDiagramContext } from '../state/useDiagramContext'
import * as api from '../lib/api'
import * as diagramOps from '../lib/diagramOps'
import { clientToDiagramPoint, nearestPointOnPolyline, nearestSegmentOnPolyline, snapValue } from '../lib/geometry'
import { t } from '../i18n'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import type { Point } from '../types'

const BUSBAR_SHAPE = '24'
const HIGHLIGHT = '#3b82f6'
const CONNECT_TARGET_COLOR = '#22c55e'
// Half-length of a terminal marker's "X", in diagram units.
const TERMINAL_MARK_SIZE = 4 / 3
// How close (diagram units) a click/hover needs to be to an element's own
// terminal (or, mid-route, any point along a busbar) to count as hitting
// it, rather than the element's ordinary body — deliberately tight (a
// Breaker's terminals sit 10 units out from a ±7-unit box) so it doesn't
// swallow the rest of the element and break plain select/drag there.
const TERMINAL_HIT_RADIUS = 5

type Ghost = { ids: number[]; dx: number; dy: number }
type NewBusbar = { start: Point; current: Point }
type PointDrag = { elementId: number; pointIndex: number; point: Point }
type ContextMenuState = { x: number; y: number; diagramPoint: Point; elementId: number | null; connectorId: number | null }
// An in-progress click-to-route: path always holds at least the start
// point (the from-element's own terminal/anchor), each further click
// appending one more anchored vertex (see appendOrthogonalPoint).
type Routing = { fromElementId: number; path: Point[] }
type ConnectTarget = { elementId: number; point: Point }
// An in-progress drag of an already-drawn connector's own geometry: either
// an existing interior vertex (kind 'vertex', index into its points array)
// or a segment's midpoint (kind 'midpoint', the index of that segment's
// first endpoint) — dragging a midpoint speculatively inserts a new vertex
// there, only committed to the diagram on mouseup (see
// handleMidpointMouseDown).
type VertexDrag =
  | { connectorId: number; kind: 'vertex'; index: number; point: Point }
  | { connectorId: number; kind: 'midpoint'; segmentIndex: number; point: Point }
// A specific bend point the user clicked (without dragging) on a selected
// connector, distinct from selecting the connector itself — lets
// Delete/Backspace remove just that one vertex instead of the whole wire.
type SelectedVertex = { connectorId: number; index: number }

// A delta smaller than this (diagram units) counts as "no real difference"
// rather than a genuine, if tiny, segment — needed because a busbar
// connect-target's coordinate (nearestPointOnPolyline's projection, plain
// floating-point arithmetic on wherever the cursor was) essentially never
// lands on a clean whole number, so comparing it to the previous point
// with exact equality would almost always see a "real" delta of a few
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
    armedSymbol,
    defaultVoltage,
    selectElement,
    selectConnector,
    armSymbol,
    deleteSelected,
    updateDiagram,
  } = useDiagramContext()

  const [svg, setSvg] = useState('')
  const [warning, setWarning] = useState<string | null>(null)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [newBusbar, setNewBusbar] = useState<NewBusbar | null>(null)
  const [pointDrag, setPointDrag] = useState<PointDrag | null>(null)
  const [clipboard, setClipboard] = useState<diagramOps.ClipboardEntry[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [routing, setRouting] = useState<Routing | null>(null)
  const [routingCursor, setRoutingCursor] = useState<Point | null>(null)
  const [connectTarget, setConnectTarget] = useState<ConnectTarget | null>(null)
  const [vertexDrag, setVertexDrag] = useState<VertexDrag | null>(null)
  const [selectedVertex, setSelectedVertex] = useState<SelectedVertex | null>(null)
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
        } else if (selectedElementId !== null || selectedConnectorId !== null) {
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
        else selectElement(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    selectedElementId,
    selectedConnectorId,
    armedSymbol,
    deleteSelected,
    armSymbol,
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

  const gridSpacing = diagram.editor?.gridSpacing ?? config?.editor.gridSpacing ?? 20
  const snapEnabled = diagram.editor?.snap ?? config?.editor.snap ?? true
  const showGrid = diagram.editor?.showGrid ?? config?.editor.showGrid ?? true

  function toPoint(clientX: number, clientY: number): Point {
    const rect = wrapperRef.current!.getBoundingClientRect()
    return clientToDiagramPoint(rect, diagram!.width, diagram!.height, clientX, clientY)
  }

  function snapPoint(p: Point): Point {
    return { x: snapValue(p.x, gridSpacing, snapEnabled), y: snapValue(p.y, gridSpacing, snapEnabled) }
  }

  // Finds the nearest terminal-like point to a raw (unsnapped) cursor
  // position, within TERMINAL_HIT_RADIUS — used both to decide whether a
  // plain click should start a route (includeBusbars: false — a busbar
  // has no discrete pin of its own, so clicking one still just
  // selects/drags it as before) and, mid-route, to find a valid point to
  // complete onto (includeBusbars: true, per "any point along a busbar
  // counts as a terminal"). excludeId keeps a route from completing back
  // onto its own starting element.
  function findConnectionTarget(point: Point, excludeId: number | null, includeBusbars: boolean): ConnectTarget | null {
    let best: ConnectTarget | null = null
    let bestDist = TERMINAL_HIT_RADIUS
    for (const el of diagram!.elements) {
      if (el.id === excludeId) continue
      if (el.class === 'BusBarSection' && el.points && el.points.length >= 2) {
        if (!includeBusbars) continue
        const p = nearestPointOnPolyline(el.points, point)
        const dist = Math.hypot(p.x - point.x, p.y - point.y)
        if (dist < bestDist) {
          bestDist = dist
          best = { elementId: el.id, point: p }
        }
        continue
      }
      const terminals = diagramOps.symbolTerminals(el, elements) ?? [{ x: el.x, y: el.y }]
      for (const term of terminals) {
        const dist = Math.hypot(term.x - point.x, term.y - point.y)
        if (dist < bestDist) {
          bestDist = dist
          best = { elementId: el.id, point: term }
        }
      }
    }
    return best
  }

  // Tracks connectTarget continuously (both for idle hover-discovery of a
  // pin to start a route from, and for live target-snapping while
  // routing) — skipped during any other drag gesture, which already owns
  // mousemove via its own temporary window listener.
  function handleWrapperMouseMove(e: React.MouseEvent) {
    if (armedSymbol || ghost || pointDrag || newBusbar) return
    const point = toPoint(e.clientX, e.clientY)
    setConnectTarget(findConnectionTarget(point, routing?.fromElementId ?? null, !!routing))
    if (routing) setRoutingCursor(point)
  }

  // A click while routing either completes the route (when connectTarget
  // is a genuine target — any other element's terminal, or any point along
  // a busbar) or anchors a new bend point and keeps routing.
  function handleRoutingClick(point: Point) {
    if (!routing) return
    const target = findConnectionTarget(point, routing.fromElementId, true)
    if (target) {
      const path = appendOrthogonalPoint(routing.path, target.point)
      updateDiagram(d => diagramOps.drawConnectorPath(d, routing.fromElementId, target.elementId, path, defaultVoltage))
      setRouting(null)
      setRoutingCursor(null)
      setConnectTarget(null)
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
  // adds a new bend point directly at wherever it landed on an existing
  // connector's own line (projected onto the exact segment double-clicked,
  // so the new point starts out perfectly straight-through until dragged
  // elsewhere).
  function handleWrapperDoubleClick(e: React.MouseEvent) {
    if (routing) {
      e.stopPropagation()
      updateDiagram(d => diagramOps.drawDanglingConnectorPath(d, routing.fromElementId, routing.path, defaultVoltage))
      setRouting(null)
      setRoutingCursor(null)
      setConnectTarget(null)
      return
    }
    const hit = (e.target as HTMLElement).closest('[data-editor-kind="connector"]') as HTMLElement | null
    if (!hit) return
    const connectorId = Number(hit.id)
    const connector = diagram!.connectors.find(c => c.id === connectorId)
    if (!connector) return
    e.stopPropagation()
    const { index, point } = nearestSegmentOnPolyline(connector.points, toPoint(e.clientX, e.clientY))
    updateDiagram(d => diagramOps.insertConnectorVertex(d, connectorId, index, snapPoint(point)))
    selectConnector(connectorId)
  }

  // Drags the real backend-rendered symbol(s) by (dx, dy) directly in the
  // DOM, rather than waiting on the debounced re-render — so the user sees
  // the actual placed element follow the cursor while dragging, not just
  // an abstract highlight. Reads each element's own current x/y/points from
  // diagram state (unchanged until mouseup) and offsets from there; a
  // BusBarSection has no single anchor to translate, so its polyline's own
  // points are each shifted instead of setting a transform.
  function dragElementsInDom(ids: number[], dx: number, dy: number) {
    const root = wrapperRef.current
    if (!root) return
    for (const id of ids) {
      const el = diagram!.elements.find(e => e.id === id)
      const node = root.querySelector(`[data-editor-kind="element"][id="${id}"]`)
      if (!el || !node) continue
      if (el.class === 'BusBarSection' && el.points) {
        node.setAttribute('points', el.points.map(p => `${p.x + dx},${p.y + dy}`).join(' '))
      } else {
        node.setAttribute('transform', `translate(${el.x + dx},${el.y + dy}) rotate(${el.orient ?? 0})`)
      }
    }
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
      if (armedSymbol.shape === BUSBAR_SHAPE) {
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
            updateDiagram(d => diagramOps.placeBusbar(d, start, snappedEnd, defaultVoltage))
          }
          armSymbol(null)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return
      }
      updateDiagram(d => diagramOps.placeElement(d, armedSymbol, snapPoint(point), defaultVoltage))
      armSymbol(null)
      return
    }

    // A plain click landing on an element's own terminal (or, for a shape
    // with none defined, its bare anchor) starts a route from there
    // instead of the usual select/drag — busbars excluded here (they have
    // no discrete pin), so clicking one is unaffected. A click anywhere
    // else on the same element's body still falls through to the ordinary
    // hit-test/select/drag logic below, since TERMINAL_HIT_RADIUS is
    // deliberately tight.
    const startTarget = findConnectionTarget(point, null, false)
    if (startTarget) {
      e.stopPropagation()
      setRouting({ fromElementId: startTarget.elementId, path: [startTarget.point] })
      setRoutingCursor(startTarget.point)
      setConnectTarget(null)
      return
    }

    const target = e.target as HTMLElement
    const hit = target.closest('[data-editor-kind]') as HTMLElement | null
    if (!hit) {
      selectElement(null)
      return
    }
    e.stopPropagation()

    const hitId = Number(hit.id)

    if (hit.dataset.editorKind === 'connector') {
      selectConnector(hitId)
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

  // The live shape of a connector while one of its own vertices/midpoints
  // is being dragged: runs the same pure functions the eventual mouseup
  // will commit, purely to compute what to draw right now — no
  // updateDiagram call, so nothing (lastId included) actually changes
  // until the drag ends. Falls back to the connector's real points
  // whenever it isn't the one currently being dragged.
  function connectorPreviewPoints(connectorId: number, points: Point[]): Point[] {
    if (!vertexDrag || vertexDrag.connectorId !== connectorId) return points
    if (vertexDrag.kind === 'vertex') {
      const preview = diagramOps.moveConnectorVertex(diagram!, connectorId, vertexDrag.index, vertexDrag.point)
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
    if (armedSymbol || newBusbar || pointDrag || ghost || routing || vertexDrag) return

    const diagramPoint = snapPoint(toPoint(e.clientX, e.clientY))
    const hit = (e.target as HTMLElement).closest('[data-editor-kind]') as HTMLElement | null

    let elementId: number | null = null
    let connectorId: number | null = null
    if (hit) {
      const id = Number(hit.id)
      if (hit.dataset.editorKind === 'connector') {
        connectorId = id
        selectConnector(id)
      } else {
        elementId = id
        // Right-clicking an element that's already part of a multi-selection
        // keeps that whole selection (so Copy/Delete act on all of it),
        // matching the usual desktop convention; right-clicking anything
        // else replaces the selection with just that one element.
        if (!(selectedElementIds.has(id) && selectedElementIds.size > 1)) selectElement(id)
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

  // Which connectors have an end nothing else is actually attached to —
  // ended in mid-air by the routing tool, or the cut side of a "Delete
  // segment" split (diagramOps.usedNodeIds/danglingConnectorEnds) — so
  // Canvas can flag them and offer a one-click way to clear them out.
  const usedNodes = diagramOps.usedNodeIds(diagram)

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
        disabled={!!armedSymbol || !!ghost || !!pointDrag || !!routing || !!vertexDrag}
      >
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
              cursor: armedSymbol || routing ? 'crosshair' : 'default',
            }}
          >
            <div style={{ position: 'absolute', inset: 0 }} dangerouslySetInnerHTML={{ __html: svg }} />
            {/* Drawn as an overlay above the content, not behind it: the
                backend-rendered SVG paints its own opaque background rect
                (Diagram.Editor.Background), which would otherwise hide a
                grid placed underneath it entirely. A low-opacity stroke
                keeps it a subtle alignment guide rather than a distraction. */}
            {showGrid && (
              <svg
                width={diagram.width}
                height={diagram.height}
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                <defs>
                  <pattern id="grid" width={gridSpacing} height={gridSpacing} patternUnits="userSpaceOnUse">
                    <path
                      d={`M ${gridSpacing} 0 L 0 0 0 ${gridSpacing}`}
                      fill="none"
                      stroke="rgba(255,255,255,0.12)"
                      strokeWidth={1}
                    />
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
              {!ghost &&
                selectedElements.map(el =>
                  el.class === 'BusBarSection' && el.points ? (
                    <polyline
                      key={el.id}
                      points={el.points.map(p => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke={HIGHLIGHT}
                      strokeWidth={6}
                      strokeOpacity={0.5}
                    />
                  ) : (
                    <circle key={el.id} cx={el.x} cy={el.y} r={24} fill="none" stroke={HIGHLIGHT} strokeWidth={1} />
                  ),
                )}
              {selectedConnector && (
                <polyline
                  points={selectedConnector.points.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={HIGHLIGHT}
                  strokeWidth={6}
                  strokeOpacity={0.5}
                />
              )}
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
                          two true endpoints aren't handles here at all —
                          they're what the connector's own Nodes/Ports
                          point at, not free-floating. */}
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
                    </>
                  )
                })()}
              {newBusbar && (
                <line
                  x1={newBusbar.start.x}
                  y1={newBusbar.start.y}
                  x2={newBusbar.current.x}
                  y2={newBusbar.current.y}
                  stroke={HIGHLIGHT}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
              )}
              {selectedElement && selectedElement.class === 'BusBarSection' && selectedElement.points && (
                <>
                  {/* Live preview of the line while a handle is being dragged
                      — the actual points only update (via updateBusbarPoint)
                      on mouseup. */}
                  {pointDrag && pointDrag.elementId === selectedElement.id && (
                    <polyline
                      points={selectedElement.points
                        .map((p, i) => (i === pointDrag.pointIndex ? pointDrag.point : p))
                        .map(p => `${p.x},${p.y}`)
                        .join(' ')}
                      fill="none"
                      stroke={HIGHLIGHT}
                      strokeWidth={2}
                      strokeDasharray="6 4"
                    />
                  )}
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
              {/* A dangling connector (an end nothing's actually attached
                  to — left mid-air by the routing tool, or the cut side of
                  a "Delete segment" split) gets a thin dashed red outline
                  the whole length of its line, plus a small filled X right
                  at each such end — clicking it removes the whole
                  connector in one step, the "quick cleanup" affordance for
                  a wire that isn't really connected to anything there. */}
              {diagram.connectors.flatMap(c => {
                const ends = diagramOps.danglingConnectorEnds(c, usedNodes)
                if (!ends.from && !ends.to) return []
                const markers: Point[] = []
                if (ends.from) markers.push(c.points[0])
                if (ends.to) markers.push(c.points[c.points.length - 1])
                return [
                  <polyline
                    key={`dangling-${c.id}`}
                    points={c.points.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="red"
                    strokeWidth={2}
                    strokeOpacity={0.5}
                    strokeDasharray="4 3"
                  />,
                  ...markers.map((p, i) => (
                    <g
                      key={`dangling-${c.id}-${i}`}
                      style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                      onMouseDown={e => {
                        e.stopPropagation()
                        updateDiagram(d => diagramOps.removeConnector(d, c.id))
                      }}
                    >
                      <circle cx={p.x} cy={p.y} r={8} fill="transparent" />
                      <circle cx={p.x} cy={p.y} r={4} fill="red" />
                    </g>
                  )),
                ]
              })}
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
