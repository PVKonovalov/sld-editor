# Release notes

2026-09-13: Stage 1 — backend core. Go 1.26 module (`backend/go.mod`) with
a Gin HTTP API. Ported `internal/slddoc` from sld-svg's XML/SVG diagram
format (Diagram/Layer/VoltageClass/Node/Element/Connector/Label, XML
Load/Save, SVG Render), adding JSON tags and an optional per-diagram
`Editor` settings block (grid spacing/snap/background). Added
`internal/elements`, a config-driven element-library loader that merges
one or more shape/class/name/category XML files (bundled default at
`backend/assets/elements/base.xml`, ported from sld-svg's symbols.xml)
into the Elements palette and a render-ready symbol library — a site adds
equipment by writing its own library file and listing it in
`elements.libraries`, no code change required. Added `internal/storage`
(filesystem-backed diagram CRUD: List/Create/Load/Save, each Save writing
both the `.xml` source of truth and a rendered `.svg`). Added
`internal/config` (YAML configuration, read via the existing
`pkg/configuration`) covering server bind address, log level, diagrams
directory, element-library paths, editor defaults, and a default
voltage-level-to-color palette. Wired it all together in
`internal/api` (diagram list/create/get/save/render endpoints, elements
catalog endpoint, config endpoint) and `cmd/sld-editor/main.go`.

2026-09-13: Stage 2 — frontend shell. Vite + React 18 + TypeScript +
Tailwind + lucide-react (matching sld-viewer's stack), with an i18n
scaffold (`en.ts` dictionary + `t()`) and a `DiagramContext` holding the
open diagram, dirty flag, diagrams list, elements catalog, and config
defaults, backed by an `api.ts` client that normalizes the backend's
nil-slice-as-null JSON into always-arrays. Built the icon-rail `Sidebar`
and its four docked panels: File (New/Open/Save/Save As, wired to the
Stage 1 API), Elements (read-only palette catalog grouped by category),
Settings (grid spacing/snap/background, stored on the diagram's own
`editor` block), and Properties (element name/voltage class/orientation
editing; shows a "no selection" placeholder until Stage 3 wires up
canvas selection). Built `Canvas`, which live-renders the current
in-memory diagram via `POST /api/render` and displays it through
`react-zoom-pan-pinch` for pan/zoom — no selection/drag/connect
interactivity yet, that's Stage 3. Fixed a backend bug found while
testing this in a browser: `GET /api/diagrams` returned JSON `null`
(a Go nil slice) instead of `[]` for an empty diagrams directory, which
crashed the frontend's diagram list.

2026-09-13: Stage 3 — canvas interactivity. Backend: `internal/slddoc.Render`
now writes a stable `id="el-<elementId>"`/`id="conn-<connectorId>"` on every
element/busbar/connector (previously busbars and connectors had no id at
all), plus a wider invisible hit-target (a circle around small symbols, a
thicker transparent line under thin polylines) so the editor can reliably
hit-test and select them by clicking the rendered SVG. Frontend: `Canvas`
hit-tests clicks against those ids to support select (click; highlighted
with a dashed/solid overlay drawn from diagram state, not the DOM), drag-move
(grid-snapped, with an instant local "ghost" overlay so dragging doesn't wait
on the debounced server re-render), click-to-place from the Elements palette
(click a palette entry to "arm" it, then click the canvas — drag instead for
a busbar, which has no single anchor), click-to-connect (Ctrl/Cmd-click a
second element while one is selected, wiring up a new Node/Ports/Connector
between them — a simplified stand-in for real port geometry, which the
symbol library doesn't record), and delete (Delete/Backspace, or a button in
Properties; removing an element also drops any connector left dangling on
one of its now-unused nodes). Elements panel shows an arm/place hint;
Properties panel gained a connector view (kind, voltage, delete) alongside
the existing element view, and a delete button for both. Moved the
Properties panel to dock on the right side of the canvas (an inspector,
Figma/Illustrator-style) instead of sharing the left File/Elements/Settings
slot, so it can stay open at the same time as the palette while placing and
wiring up elements.

2026-09-13: Autoincrement element/node/connector ids. Added `Diagram.LastID`
(backend/internal/slddoc, XML attribute `lastId`) — the highest integer id
this editor has ever assigned in that diagram, persisted so a reopened
diagram keeps handing out fresh ids rather than restarting from 1 and
risking a collision. The frontend (`lib/diagramOps.ts`'s new `IdSequence`)
is still the only thing that actually assigns an id (the backend never
does), now as a plain incrementing integer shared across
elements/nodes/connectors instead of the previous session-local
timestamp-ish string; `ensureLastId` backfills a sensible starting value
(the highest existing numeric id already in the file) for a diagram saved
before this existed, so opening one of those never reuses or collides with
an id already on disk. Also exposed each element library symbol's SVG
`template` through `/api/elements` and used it in the Elements panel to
render each palette button's actual symbol shape as a small icon
(`lib/elementIcon.ts` substitutes placeholder values sensible for a
static, state-less preview) instead of text-only buttons.

2026-09-13: Canvas alignment grid. `Canvas` now draws a subtle grid overlay
at the diagram's own (or config-default) grid spacing, live-updating as
the Settings panel's Grid spacing field changes. Drawn as an SVG `<pattern>`
layered *above* the server-rendered content rather than behind it — the
backend's rendered SVG paints its own opaque background rect
(`Diagram.Editor.Background`), which would otherwise hide a grid placed
underneath it entirely.

2026-09-13: Busbar rendering matches real xsde2svg conventions. A rendered
busbar polyline now draws at 4px (was 1px, same as an ordinary wire) and
carries `data-name` (its own Name), `data-voltage` (its resolved color —
this schema has no separate id for one on a bare polyline), and `data-type`
(its shape code), matching what a real xsde2svg-exported busbar carries.
`writePolyline` (`internal/slddoc/render.go`) gained `strokeWidth`/`dataAttrs`
parameters for this; connectors keep the previous 1px/no-extra-attrs
behavior.

2026-09-13: Voltage-class management, default element names, and ids
matching real xsde2svg conventions.

Settings panel gained a "Voltage classes" section: a diagram starts with
none (there was previously no way to add one at all, so the Properties
panel's voltage dropdown always had nothing to select), and this lets you
pick from the server's default voltage-color presets or edit/delete a
diagram's own classes (`diagramOps.addVoltageClass`/`updateVoltageClass`/
`removeVoltageClass`). Newly placed elements now default their name to
"<type>-<id>" (e.g. "Breaker-3") instead of the bare symbol name, so
placing several of the same type doesn't leave them all identically
labeled.

Every id (Element/Node/Connector/VoltageClass/Layer, and every field that
references one) is now a plain integer end to end — Go `int`, TypeScript
`number`, XML/JSON accordingly — instead of a string. `Diagram.LastID`
continues to persist the high-water mark; `lib/diagramOps.ts`'s
`IdSequence` (unchanged in spirit, now returns `number`) is still the only
place that assigns one, and `ensureLastId` still backfills a diagram saved
before ids existed. `BaseLayer` is now the untyped int `0`. Every id's
zero value doubles as "unset" for an optional reference (`voltage`, `for`)
since a real id is never 0. One legacy file with non-numeric string ids
from before the earlier autoincrement change (`diagrams/Test44.xml`) was
migrated to sequential integers so it keeps loading.

Rendering also dropped the synthetic `el-`/`conn-` DOM-id prefixing and
the wrapping `<g>` + duplicate invisible hit-target polyline around a
busbar/connector — a real xsde2svg busbar is a single flat `<polyline>`
with its own bare id, so ours is now too. The frontend's canvas hit-testing
no longer depends on that prefix scheme; every selectable element now
carries a `data-editor-kind="element"` or `"connector"` attribute instead
(this editor's own addition, not part of the xsde2svg format), and
`Canvas.tsx` reads the plain `id` attribute as the bare integer id
directly. A symbol element's outer `<g>` also gained `data-voltage`/
`data-type` (alongside the existing `data-name`), matching a real
xsde2svg element's own outer `<g>` — confirmed against a real corpus file,
`sld-viewer/assets/sld/PS_110kV_Example.svg`.

2026-09-13: Split rendering (Static vs Interactive), and busbar point
editing.

`internal/slddoc.Render` now takes a `RenderMode` (`Static` or
`Interactive`): `Static` renders a clean, xsde2svg-faithful document — no
`data-editor-kind`, no invisible hit-target circle around a symbol's
geometry — while `Interactive` adds both, as before. `data-voltage`/
`data-type`/`data-name` and a bare integer `id` are unaffected by mode,
since a real xsde2svg document carries those regardless. `Store.Save`
(the on-disk `.svg`) and `GET /diagrams/:name/svg` (a direct download of
that same artifact) now render `Static`; `POST /render` (what the live
canvas actually displays) renders `Interactive`. This closes a gap: the
`data-editor-kind` marker (added earlier this session, purely for the
frontend's own click-to-select) was leaking into the saved `.svg` file,
which is meant to be a faithful export.

Properties panel: a selected BusBarSection now shows its two Points as
editable X/Y number fields (replacing the Orientation field, which doesn't
apply to a busbar) instead of only being movable as a whole by dragging —
answers "how do I change an individual busbar endpoint". New
`diagramOps.updateBusbarPoint` updates one point in place and recomputes
the element's anchor (X/Y) as the new midpoint, the same convention
`placeBusbar` establishes when first drawing one.

2026-09-13: Properties' voltage-class dropdown seeded with the server's
default presets, and draggable busbar endpoint handles.

Previously the only way to get a voltage class into a diagram's dropdown
was a separate trip to Settings to "Add" it first — a diagram starts with
none, so a freshly opened one always showed only "— none —". Now
Properties' Voltage class `<select>` (`diagramOps.voltageClassOptions`)
lists every one of the server's default `voltage_colors` presets directly,
alongside whatever's already on the diagram; picking a preset not yet
present (`diagramOps.resolveVoltageSelection`) creates it on the fly and
assigns it in the same action — one click instead of two steps. Settings'
own "Voltage classes" section is unchanged (still how you rename/recolor/
delete one, or pre-add several before assigning any).

`Canvas` now draws each of a selected busbar's Points as a draggable,
unfilled red square handle (plus a larger invisible circle around it for
an easier grab target), independent of the whole-element drag — dragging
one moves just that endpoint (via `diagramOps.updateBusbarPoint`, live-
previewed with a dashed line while dragging, same pattern as the existing
whole-element ghost) instead of requiring the Properties panel's numeric
X/Y fields for that.

2026-09-13: `data-type="21"` on an ObjectLink connector.

`internal/slddoc.Render` now writes `data-type="21"` on a `KindObjectLink`
connector's `<polyline>` (a new `connectorTypeCode` map, mirroring how an
Element's Shape already doubles as its own `data-type`) — 21 is the real
xsde2svg type code for a generic object-to-object connection, matching two
real corpus examples the user supplied. `diagramOps.connectElements` (what
Ctrl/Cmd-click-to-connect creates) is currently the only thing that
produces a `KindObjectLink` connector, so every connector drawn through the
canvas now carries this attribute; any other `ConnectorKind` still renders
with no `data-type`, same as before this existed.

2026-09-13: Right-click context menu with Copy/Delete/Paste.

New `components/ContextMenu.tsx` (generic, reusable) and `Canvas`'s own
`onContextMenu` handler: right-clicking an element or connector selects it
(same as a left click) and opens a menu positioned at the cursor; right-
clicking empty canvas leaves the current selection alone. `diagramOps`
gained `copyElement`/`pasteElement`: Copy captures an element's own data
minus its `id` and `Ports` (a pasted copy starts unconnected — its old
Ports referenced Node ids a copy has no claim to); Paste places it at the
right-clicked point (translating a BusBarSection's whole shape to preserve
its length/angle, the same start/end -> anchor convention `placeBusbar`
already uses) and names it like any other new element — `"<type>-<id>"`
(e.g. `"Busbar-5"`) — rather than `"<original name> copy"`, so repeated
pastes don't accumulate "copy" suffixes.

2026-09-13: New elements/busbars default to the last-picked voltage class;
paste snaps to grid even when its anchor wasn't itself on-grid.

`DiagramContext` gained `defaultVoltage`, updated whenever Properties'
Voltage class `<select>` assigns one to an element, and read by
`placeElement`/`placeBusbar` to seed a freshly placed element's own
voltage — placing several elements in a row no longer requires
re-assigning the same voltage to each one. This is session-only UI state,
never persisted with the diagram.

Separately: `pasteElement` now takes an optional `snap` function, applied
to a pasted BusBarSection's translated endpoints (its anchor is then
re-derived as their midpoint, mirroring `updateBusbarPoint`'s own
convention) — without it, a busbar whose original anchor wasn't itself
exactly on-grid (two on-grid endpoints spaced an odd multiple of the grid
apart have a midpoint that isn't itself a grid point) carried that same
off-grid remainder into the pasted copy's endpoints even though the paste
target itself was on-grid, making Paste look like it ignored Snap to grid.
`Canvas` passes its own `snapPoint` in.

2026-09-13: Real xsde2svg `data-fill`/`data-state` attributes on switching
devices, and a configurable, install-wide state->color legend.

A real xsde2svg breaker/switch carries two attributes this editor's
templates didn't: `data-fill="0:red,1:lawngreen,2:yellow"` on its
state-driven fill path (a fixed legend of what the three colors mean) and
`data-state="<value>"` on its state-indicator path (the element's own raw
`State`) — confirmed against a real corpus example. `base.xml`'s templates
for shapes 41/43/42 (Breaker, Breaker withdrawable, Load-break switch) and
71/162 (Disconnector) now reference two new placeholders, `{fillAttr}` and
`{stateAttr}`, that `internal/slddoc.Render` expands from a new
`stateColorSet` built once per render call.

The state->color legend itself is no longer hardcoded — `config.Config`
gained `StateColors` (`state_colors` in `sld-editor.yaml`, seeded with the
same Open/0/red, Close/1/lawngreen, Intermediate/2/yellow triple), threaded
through `storage.Store` into every `slddoc.Render` call. It's global for
the whole install, not per-diagram (unlike voltage classes): an element
only ever records a raw `State` value, never a color, so there's nothing
for a diagram to have "already saved" here to fall back to. `GET
/api/config` now also serves it as `stateColors`, and Properties shows a
State dropdown (Open/Close/Intermediate, built from that same config) for
every switching-device class (Breaker, Disconnector, LoadBreakSwitch,
GroundSwitch) — the first way to set an element's State from the UI at
all.

2026-09-13: Multi-select (shift-click), and drag-move shows the real
symbol instead of an abstract ghost.

`DiagramContext` gained `selectedElementIds` (a `Set<number>`, always a
superset of `selectedElementId`) and `toggleElementSelection` — shift-click
an element to add/remove it from the selection instead of replacing it
(Ctrl/Cmd-click stays reserved for click-to-connect). Dragging any element
already part of a multi-selection moves the whole set together;
right-clicking one preserves the set (so Copy/Delete act on all of it)
unless the click lands outside it. New `diagramOps.copyElements`/
`pasteElements` capture/place a whole selection as a rigid group — point
becomes where the group's own centroid lands, and each entry keeps its
original offset from it (each entry's own target point is snapped
individually for the same reason a single busbar paste needs it: the
centroid of two or more on-grid anchors isn't necessarily itself on-grid).
Properties shows "N elements selected" plus a bulk delete instead of any
per-field editor once the set holds more than one id; everything that only
makes sense for one element (the full field editor, a busbar's point
handles, the connect anchor) keys off `selectedElementId` and ignores the
set once it's grown past one.

Separately, dragging an element (or a multi-selected group) no longer
shows a dashed abstract circle/polyline while moving — `Canvas` now
mutates the real backend-rendered symbol's own `transform` (or a busbar's
`points`) directly in the DOM as the cursor moves, so what's visibly
dragged is the actual placed element, snapping into its real final
position exactly where the debounced re-render will confirm it.

2026-09-13: Settings gained a "Show grid" toggle; selection markers thinned
to 1px.

`EditorSettings`/`config.Config.Editor` gained `showGrid` (`show_grid` in
`sld-editor.yaml`, default `true`), the same diagram-overrides-config
pattern as `snap`/`gridSpacing` — `Canvas`'s alignment-grid overlay now
only renders when it's on. Also: the busbar endpoint handle's red square
and the single-element selection circle both went from a 2-2.5px stroke to
1px, a lighter-weight highlight less likely to be mistaken for diagram
content.

2026-09-13: Real per-shape terminal geometry, starting with the Breaker.

A symbol can now declare its own real electrical connection points — a new
optional `<terminals><terminal x="…" y="…"/>…</terminals>` block per
`<symbol>` in a library XML file (local, unrotated coordinates, same
convention as `<template>`). `elements.Symbol` gained `Terminals
[]slddoc.Point`, parsed from that block and included in `/api/elements`'s
response like `Template` already was. The Breaker (shape 41) is the first
shape to define any: `(0,-10)` and `(0,10)`, the outer ends of its two stem
strokes — where a real wire actually meets the symbol.

`diagramOps.connectElements` now takes the elements catalog and, for each
side of a new connection, uses its shape's own terminals (rotated by the
element's `orient`, translated by its `x`/`y`) instead of always its bare
anchor — falling back to that same anchor for every shape without
`Terminals` defined yet, so nothing else changed behavior. When a shape has
more than one terminal, it picks whichever pair (one per element) ends up
closest together, rather than an arbitrary one. `Canvas` also draws a red
1px "X" at every element's own real terminal positions (hidden on whichever
element is mid-drag, since `dragElementsInDom` moves the real symbol
directly in the DOM without touching this state-derived overlay) — a
visible answer to "where can I actually connect to this thing", not just
internal bookkeeping.

Still a simplified stand-in for full port geometry (see
`diagramOps.connectElements`'s own doc comment): a shape's terminal
positions are fixed regardless of which one two particular elements would
most naturally join, and moving or rotating an element afterward doesn't
drag its already-connected wire's endpoint along with it. Disconnector,
Breaker (withdrawable), Load-break switch, Ground switch, and Power
transformer are reasonable next candidates for their own `<terminals>`,
using the same mechanism.

2026-09-13: Terminal markers shrunk and now only shown on the current
selection.

The red "X" at each of a shape's own terminal positions is now a third its
original size and drawn at 0.5px instead of 1px, and — rather than every
element in the diagram all the time — only for whichever element(s) are
currently selected, matching what "am I about to Ctrl/Cmd-click-connect
this thing" actually needs: you always have something selected first, so
this loses no information for that flow while cutting a lot of clutter
from an otherwise-busy diagram.

2026-09-13: Reverted per-shape terminal geometry — didn't connect
correctly, removed at the user's request.

Everything from the two "terminal" entries above is reverted:
`elements.Symbol.Terminals`/`base.xml`'s `<terminals>` block (the Breaker's
own `(0,-10)`/`(0,10)`), `ElementSymbol.terminals`, `diagramOps`'s
`symbolTerminals`/nearest-terminal-pair logic, and `Canvas`'s red "X"
markers are all gone. `connectElements` is back to its original signature
and behavior — anchor-to-anchor, no elements-catalog parameter — matching
what shipped before those two entries. Real per-shape terminal geometry
remains on the "not yet built" list.

2026-09-13: Terminals brought back as a visual-only aid; connecting two
elements is unchanged.

Clarified after the revert above: the actual complaint was the *connect*
behavior (Ctrl/Cmd-click picking a terminal, not always the two elements'
bare anchors), not the terminals themselves. So `elements.Symbol.Terminals`/
`base.xml`'s `<terminals>` (the Breaker's `(0,-10)`/`(0,10)`),
`ElementSymbol.terminals`, and `diagramOps.symbolTerminals` (rotates each
by the element's own `orient`, translates by its `x`/`y`) are all back, and
`Canvas` again draws a small red 0.5px "X" at each one for the current
selection. `connectElements` itself is untouched from the revert above —
still its original signature and behavior, anchor-to-anchor, no
elements-catalog parameter, no per-shape terminal involved in picking a
connection point. Terminals are now purely informational: a visual answer
to "where could a real connection go here", decoupled from what
Ctrl/Cmd-click actually does.

2026-09-13: Click-to-route wiring tool (Phase 1) — orthogonal routing,
click-to-bend, busbar-as-continuous-terminal, double-click to end in
mid-air.

A plain click on an element's own terminal (or a shape with none, its
bare anchor — busbars excluded, see below) now starts a proper routing
mode instead of the instant anchor-to-anchor Ctrl/Cmd-click-connect
(unchanged, still available): the cursor shows a live orthogonal
rubber-band preview (`Canvas`'s `appendOrthogonalPoint`, auto-picking
H-then-V or V-then-H by whichever axis moves further, no manual toggle
yet) from the last anchored point to the grid-snapped cursor; a further
click anchors a bend and keeps routing; clicking a valid target — another
element's terminal, or (per explicit request) any point along a busbar's
own drawn length, not just its two endpoints (`nearestPointOnPolyline`,
new in `lib/geometry.ts`) — completes it as a real, possibly multi-segment
Connector (new `diagramOps.drawConnectorPath`, `connectElements`'s
counterpart for an explicit path rather than a straight two-point line).
Double-click ends the route "in mid-air" instead, even with nothing
nearby to attach to (new `diagramOps.drawDanglingConnectorPath` — a Node
still anchors that end, just with no Port/element referencing it). Esc
cancels the whole in-progress route.

A green "X" marks a valid completion target while routing; the same X in
blue marks a start/target candidate under the cursor even at rest, so a
pin is discoverable by hovering alone, not just once its element is
selected (`Canvas`'s new `connectTarget` state, tracked on every
mousemove via `findConnectionTarget`). `TERMINAL_HIT_RADIUS` (5 diagram
units) keeps this tight enough that it doesn't swallow the rest of an
element's body — clicking anywhere else on it still selects/drags exactly
as before.

Not yet built (see CLAUDE.md's Project state): re-routing a connector's
segments when either endpoint's element later moves or rotates, a 45°
routing mode, a manual bend-axis toggle, and editing an already-drawn
connector's own geometry (dragging a vertex/segment, adding/removing a
bend point, deleting one segment vs. the whole wire).

2026-09-13: Fixed — a wire drawn with the new routing tool rendered with no
color at all once completed.

`diagramOps.drawConnectorPath`/`drawDanglingConnectorPath` never set the
new Connector's own `voltage`, so it stayed unset — `Render` falls back to
a bare, uncolored stroke for that case, same as any other connector
without one. Both now take an optional `voltage` param, and `Canvas`
passes `defaultVoltage` (the same last-picked-voltage-class value
`placeElement`/`placeBusbar` already seed a new element/busbar from) —
matching the fact that the in-progress preview line was never actually
showing a voltage color to begin with (it's a fixed UI highlight color,
unrelated to any voltage), so this is what makes a drawn wire keep a
color after finishing at all, not just an appearance carried over from
the preview.

2026-09-13: "Piece A" — editing an already-drawn connector's own geometry
(vertex/midpoint handles, add/remove a bend point).

Selecting a connector now shows a filled square handle at each of its
interior bend points and a smaller semi-transparent circle at each
segment's own midpoint, on top of the existing highlight. New
`diagramOps` functions:

- `moveConnectorVertex` drags an interior vertex while keeping both
  segments meeting there orthogonal — a "projection-lock" rule (each
  movable neighbor slides along whichever single axis keeps its own
  segment parallel to what it always was; a neighbor that's a fixed
  endpoint instead gets a new Z/U-shaped bend inserted next to it, since
  it can't move itself) — the standard local-adjustment-with-collapse
  approach real schematic/PCB routers use, confirmed against a detailed
  reference the user provided rather than guessed at.
- `insertConnectorVertex` adds a raw new point between two existing ones —
  double-clicking a connector's line adds a bend directly there (projected
  onto the exact segment clicked); dragging a midpoint handle does the
  same then immediately runs the new point through `moveConnectorVertex`,
  so a live drag reshapes it in place rather than just planting a static
  point.
- `removeConnectorVertex` deletes one selected interior vertex outright,
  connecting its former neighbors directly (matching the user's own spec:
  "removes only that angle, connecting the adjacent points directly" — if
  the two neighbors don't happen to already share an axis, the resulting
  direct join is a diagonal segment, which is the intended behavior for
  this specific removal method, not a bug).
- `simplifyOrthogonalPath` collapses a "straight-through" point (its two
  neighbors already share its X or Y, so it contributes no real bend) or
  an exact duplicate — run after every move/removal to clean up whatever
  they leave behind.

A connector's own two true endpoints are never touched by any of this —
they're what its Nodes/Ports actually point at (re-routing them when their
element moves is the deferred "Piece C"). Clicking a vertex without
dragging selects just that one bend point (`Canvas`'s new `selectedVertex`
state) so Delete/Backspace removes it specifically instead of the whole
wire; Escape (or clicking anywhere else) deselects it the same way the
rest of the selection model already works.

Also fixed along the way: `internal/slddoc.Render`'s type-comment for an
ObjectLink connector read `<!-- Object link -->` with no code, unlike an
element's own `<!-- Breaker:41 -->` convention — it's now `<!-- Buswork:21
-->`, matching both the requested name and the existing name:code pattern
(`connectorTypeCode`'s "21" was already computed for the `data-type`
attribute but never passed into the comment). And: `Canvas`'s
`appendOrthogonalPoint` now treats a delta under `ALIGNMENT_EPSILON` (1
diagram unit) as exactly zero — a route completed onto a busbar lands via
floating-point projection (`nearestPointOnPolyline`), which essentially
never produces a clean whole number, so without this almost every
busbar-attached wire grew an invisible sub-unit "spur" segment at its very
end (confirmed and cleaned up in the user's own `test 7.xml` — six
connectors each had exactly this artifact, both in their own `points` and
in the fractional coordinate baked into the busbar Node they attached to).

2026-09-13: "Piece B" — per-segment wire deletion, and a one-click cleanup
for dangling connectors.

Right-clicking a connector's line now offers two distinct deletions
instead of one: "Delete segment" removes just the segment under the
cursor (new `diagramOps.deleteConnectorSegment` — the side before the cut
keeps the connector's original `from` end and gets a fresh, unreferenced
Node at the cut; the side after mirrors this with the original `to` end;
either side is dropped outright if the cut leaves it a single point, e.g.
deleting the first/last segment, or both segments of a straight two-point
wire, which is equivalent to just deleting the whole thing), while "Delete
wire" is the existing whole-connector removal, now labeled to disambiguate
it from the new option.

A connector left with an end nothing's actually attached to — either from
"Delete segment" or from the routing tool's own double-click-to-end-in-
mid-air — is no longer just invisible bookkeeping: `Canvas` now draws a
thin dashed red outline along its whole length and a small filled red
circle right at each dangling end (new `diagramOps.usedNodeIds`/
`danglingConnectorEnds`, computed once per render — a Node counts as
attached the same way `removeElement`'s own orphan check already does, by
whether some element's Port references it), and clicking that circle
removes the whole connector in one step — a direct answer to "I have a
stray half-wire, how do I get rid of it" without needing to first select
it precisely enough to trigger Delete/Backspace.

Deferred (see CLAUDE.md's Project state): re-routing when an element
moves, a 45°/manual-bend-axis mode.

2026-09-13: "Piece C" — a connector re-routes to follow whichever
element(s) it's attached to when they're dragged, endpoint-follows-only
(the simplest useful version, approved over full accordion re-layout).

New `diagramOps.moveElements(diagram, ids, dx, dy)` replaces the plain
per-id `moveElement` reduce Canvas's own element-drag mouseup handler used
to call. Beyond translating the moved element(s) themselves exactly as
before, it now also re-routes every connector with a Port on one of them:
if *both* its ends belong to elements moving together in the same drag
(e.g. two elements in a multi-selection joined by a wire), the whole
connector translates as a rigid whole — every point keeps the same
relative position, so nothing about its shape needs to change; if only
one end is attached to a moving element, just that end is dragged to its
new position and the segment touching it is kept orthogonal the same way
an interior vertex drag already is (Piece A's `moveConnectorVertex`): an
ordinary interior neighbor slides along whichever axis preserves that
segment's own orientation, while a neighbor that's actually the
connector's other (unmoving) true endpoint — a plain two-point wire, most
commonly — instead gets a new bend inserted next to it, leaving that
still-attached end's own approach direction undisturbed. A connector
dangling at its far end (from ending a route in mid-air, or a Piece B
segment cut) follows this same rule with no special-casing: its dangling
node was never a Port's node, so it's simply never in the moving set,
exactly like a real unmoving attachment.

Applies to a plain whole-element drag only — a BusBarSection's own single-
endpoint drag handle (`updateBusbarPoint`) isn't rerouted; there's no
single (dx, dy) for the rest of that shape to hand a reroute the way a
whole-element move can, and reworking that is out of scope for now.

Verified live: a bent multi-segment wire between two breakers correctly
kept its middle unchanged and only re-angled the segment touching whichever
breaker moved; dragging both breakers together as a multi-selection
translated the whole wire rigidly with no new bends; a plain straight
two-point wire correctly grew a new bend at the still-fixed end when its
other end's breaker was dragged diagonally.

2026-09-13: Fixed a wire connecting a breaker to a busbar sometimes
rendering black instead of the voltage color both were already carrying
(reported directly: a breaker-to-busbar jumper drawn with the routing tool
showed "Voltage class — none —" in Properties even though both endpoints
already had one), and renamed the connector kind the routing tool and
Ctrl/Cmd-click-connect both produce from `ObjectLink` to `BusWork`.

The voltage bug: `drawConnectorPath`/`drawDanglingConnectorPath` colored a
newly finished wire from `defaultVoltage` alone — a purely session-level
"last voltage class picked in Properties" value (see `DiagramContext`) —
never from what the wire was actually connecting. A wire drawn before
touching Properties this session (or right after reopening a diagram, when
nothing's been picked yet) came out with no voltage at all, even joining
two elements that already plainly shared one. Both functions (and
`connectElements`, which never set a connector's voltage to begin with)
now take it from whichever of the wire's own `from`/`to` elements already
has one, falling back to `defaultVoltage` only when neither end does.

The rename: `kind="ObjectLink"` was the one thing left still saying
"Object link" rather than "Buswork" — the SVG type-comment (`<!--
Buswork:21 -->`) was already fixed to read that way earlier, but the
underlying stored value the frontend/backend/XML file itself all still
used was untouched. `ConnectorKind`'s `KindObjectLink = "ObjectLink"` is
now `KindBusWork = "BusWork"` (`backend/internal/slddoc/model.go`, mirrored
in `frontend/src/types/index.ts`), and every place that creates one
(`drawConnectorPath`, `drawDanglingConnectorPath`, `connectElements`) was
updated to match. This changes what's actually persisted in a saved
diagram's XML, so `slddoc.Load` now transparently rewrites any connector
still carrying the old `"ObjectLink"` value to `"BusWork"` the moment it's
read from disk — every diagram already saved with the old value keeps
loading and rendering correctly, and simply picks up the new value for
real the next time it's saved.

2026-09-16: Grid dots instead of grid lines, and the click-to-route tool
can now tap a new wire straight into an already-drawn connector's own
line, not just onto a real BusBarSection.

The grid overlay (`Canvas`'s `<pattern id="grid">`) now tiles a single
0.25px-radius dot at each grid intersection instead of the previous
crosshatched lines — a subtler alignment guide.

Previously, finishing a route (`Canvas.findConnectionTarget`) only
recognized another element's own terminal or any point along a real
BusBarSection as a valid endpoint; an ordinary drawn connector (e.g. a
buswork jumper already running to the bus) had no way to accept a new
wire joining it partway along its length. `findConnectionTarget` now also
searches every connector's own points polyline (`nearestSegmentOnPolyline`)
when `includeBusbars` is set, reported as a new `ConnectTarget` variant
(`kind: 'connector'`, carrying the target connector's id and the segment
index the tap point falls on) alongside the existing `'element'` variant.
Completing a route onto one now calls a new
`diagramOps.drawConnectorPathToConnector`: it splits the target connector
into up to two new ones at the tap point (mirroring
`deleteConnectorSegment`'s own split, just inserting a junction instead of
cutting one out) and gives all three connectors — both new halves and the
freshly drawn tap wire — a shared Node there, so it's a real electrical
junction rather than a merely-visual touch. `usedNodeIds` was updated to
match: a Node referenced by two-or-more connector ends now counts as
"attached" even with no element Port on it at all, so a tap's own junction
node doesn't spuriously get flagged with the dangling-end marker.

Verified via a backend `/api/render` smoke test (browser automation
wasn't available in this environment): a hand-built diagram with the
exact three-connectors-sharing-one-node shape this produces rendered
cleanly with no warning, all three segments meeting at the junction point
in the shared voltage color.

2026-09-16: The click-to-route tool can now also *start* a route from a
point along a busbar or an already-drawn connector, not just finish one
there — closing the other half of the tap-into-buswork feature above
(reported directly: a route could tap into an existing wire to finish,
but couldn't be drawn starting from the bus/wire itself).

A plain click on a busbar or connector still means select/drag or
select/reshape, same as always — a busbar/connector has no discrete pin
of its own, so treating every click along its length as a route start
would swallow the ordinary interaction entirely. Holding Ctrl/Cmd is what
disambiguates "start a route from this exact point" (`Canvas.
handleMouseDown`'s `startTarget` check now passes `e.ctrlKey || e.metaKey`
as `findConnectionTarget`'s `includeBusbars` flag, instead of always
`false`); the live hover indicator (`connectTarget`) follows the same
rule outside of an active route, so holding Ctrl/Cmd previews a valid
start point before you click.

`Routing` (`Canvas`) now stores its start as a full anchor (`from:
ConnectTarget`, the same element-or-connector-tap union the finish target
already used) instead of a bare element id, and `diagramOps` grew the two
missing route-creator combinations to match: `drawConnectorPathFromConnector`
(a connector-tap start, element finish — the mirror of the already-existing
`drawConnectorPathToConnector`) and `drawConnectorBetweenConnectors` (both
ends are taps into two different — guarded against the same one —
connectors). Both are built on a new shared private helper,
`spliceConnectorAt`, pulled out of `drawConnectorPathToConnector`'s own
splitting logic so all three (plus the existing one, now rewritten against
it) share one implementation of "cut a connector at a point and give the
new junction Node to whoever needs it." A route that starts on a tap and
still ends in mid-air (double-click) gets its own
`drawDanglingConnectorPathFromConnector`, the connector-start counterpart
of `drawDanglingConnectorPath`.

One behavior change: Ctrl/Cmd-clicking a busbar while something else is
selected previously ran the older instant `connectElements` (anchor-to-
anchor); it now starts a route from that exact clicked point instead,
which takes priority since the check runs first. `connectElements` itself
is unchanged and still reachable for two ordinary elements.

Verified via two backend `/api/render` smoke tests (browser automation
still unavailable in this environment): one hand-built diagram matching
`drawConnectorPathFromConnector`'s output (an element tied into a tap on
an existing run), and one matching `drawConnectorBetweenConnectors`'s —
two independent buswork runs joined by a new wire tapping into both, no
elements involved at either end at all. Both rendered cleanly with every
segment meeting exactly at its shared junction node.

2026-09-16: A route's tap point onto a busbar or an existing connector is
now grid-aligned when snapping is on, at both its start and its finish
(reported directly: the very first point of a route tapped from the bus
wasn't landing on the grid).

Previously `Canvas.findConnectionTarget`'s busbar/connector branches used
the cursor's raw projection onto the line (`nearestPointOnPolyline`/
`nearestSegmentOnPolyline`) unchanged — essentially never a whole number —
for both the finish-side tap (already the case before today) and the
new start-side tap (added earlier today). New `geometry.snapPointOnSegment`
snaps that projected point to the grid along whichever axis the tapped
segment runs freely on (a horizontal segment snaps x and keeps y fixed at
the segment's own y-coordinate; vertical is the reverse), re-clamping to
the segment afterward so the point can't be snapped past whichever
endpoint it was nearest to. A diagonal segment can't be grid-aligned while
staying exactly on the line in general, so it's left as the raw
projection — matching how the rest of the app already only grid-snaps
orthogonal geometry. An element's own terminal is unaffected either way —
it has to land exactly on the real pin, not wherever the nearest grid
line happens to be.

2026-09-16: Removed a duplicate "Disconnector" palette entry, and gave the
remaining one real `<terminals>` matching the Breaker's own convention
(reported directly: two identical-looking "Disconnector" buttons in the
Elements palette, and separately, a Disconnector's terminal not lining up
with its actual drawn pins).

`backend/assets/elements/base.xml` had two shapes — `71` and `162` —
both `class="Disconnector"`, both `name="Disconnector"`, both rendering
byte-for-byte the same template; this was inherited as-is from
`sld-svg/symbols.xml` (its own comment reads "71 / 162: Disconnector"),
which the palette showed as two indistinguishable buttons. Shape `71` is
now removed from `base.xml` at the user's direction (keeping only `162`)
— its `shapeName` entry in `internal/slddoc/render.go` (used for the
render-time type-comment/legend, not the palette) is deliberately left in
place, so a diagram that already has an element on shape `71` — from
before this change, or loaded from an external source — still renders
with the right label.

Shape `162`'s own template draws its stems ending at exactly `(0,-10)`/
`(0,10)` in local coordinates — the same two points the Breaker (shape
`41`) already declares as its own `<terminals>` — but had no `<terminals>`
block of its own, so it fell back to a single terminal at its bare anchor
(its own center) rather than its two real drawn pins. It now declares the
same `<terminals>` pair the Breaker does, so routing/connecting to a
Disconnector snaps to its actual pins instead of its center.

Verified by loading `base.xml` directly in a scratch Go test (not
`/api/elements` — the user's own already-running dev server has the old
library cached in memory from before this change, and re-loading it
myself would have collided with their listening port): shape `71` is gone,
and shape `162` now parses `Terminals: [{0 -10} {0 10}]`, matching shape
`41`'s own. The user needs to restart their backend dev server to pick
this up, same as the earlier Disconnector-duplicate fix.

2026-09-16: Fixed `slddoc: symbol library missing shape(s): 71`, hit after
the shape-71 removal above — an already-saved diagram (`diagrams/test
7.xml`, element id 61) still had a Disconnector on shape `71`, and once
`base.xml` no longer carried that shape, every render of that diagram
(the debounced `POST /api/render` the live canvas depends on) failed with
this error.

`slddoc.Load` already had exactly this kind of fixup for a renamed stored
value — `kindObjectLinkLegacy`, rewriting a Connector's old `"ObjectLink"`
Kind to `"BusWork"` on the way in. Added the same pattern for the shape
removal: two new constants, `shapeDisconnector = "162"` and
`shapeDisconnectorLegacy = "71"` (`internal/slddoc/model.go`), and `Load`
now rewrites any Element still carrying the legacy shape to the current
one, transparently, the moment a diagram is read from disk — an
already-saved diagram keeps loading and rendering correctly, and picks up
the new shape for real the next time it's saved (also matching the
`ObjectLink` precedent exactly). This only fires on `Load` (i.e.
`storage.Load`, opening a saved diagram) — the live canvas's own
`POST /api/render` binds JSON straight into a `slddoc.Diagram` and never
goes through `Load`, so a diagram already open in the browser with a
stale shape `71` still needs reopening (or the backend restarting and the
diagram being reopened) to pick this up, not just a backend restart alone.

Verified against the real file: loading `diagrams/test 7.xml` in a
scratch Go test now reports element 61 as `shape="162"` instead of `"71"`.

2026-09-16: Removed the "dangling connector end" indicator entirely
(reported directly: double-clicking to end a route in mid-air produced a
jarring red dashed outline down the whole wire plus a big red dot at the
end, and clicking that dot to "clean it up" felt like it deleted more
than intended). Leaving a wire's end unconnected — to finish routing it
later, or simply on purpose — turned out to be a normal, intentional
thing to do in this editor's actual use, not something that needed a
warning treatment at all.

Removed `Canvas`'s whole dangling-marker render block (the dashed
`<polyline>` plus the red-dot `onMouseDown` that called
`removeConnector`) and the `usedNodes` computation feeding it, along with
the two `diagramOps` functions that only existed to support it,
`usedNodeIds` and `danglingConnectorEnds`. An unconnected connector end
now looks exactly like any other — no outline, no dot — and is deleted
the same ordinary way as always: select it and press Delete/Backspace, or
right-click it for "Delete wire". Every connector-tap function added
earlier today (`drawConnectorPathToConnector` and friends) is unaffected
— the shared junction Node they give a tap is still correct data, just no
longer double-duty as this now-removed indicator's own "is this attached"
check.

2026-09-16: A diagram now has its own persisted default voltage level,
used to seed newly placed elements/wires instead of leaving them
unassigned ("— none —"), and File > New is now a proper dialog asking for
size and this default voltage up front, instead of just a name.

`slddoc.EditorSettings` (`backend/internal/slddoc/model.go`) gained a
`DefaultVoltage int` field (XML `defaultVoltage` attribute, JSON
`defaultVoltage`) — a `VoltageClass.ID` reference, round-tripped exactly
like `Diagram.LastID` (never assigned or interpreted by the backend
itself). Mirrored on the frontend's own `EditorSettings` type.

New `frontend/src/components/NewDiagramDialog.tsx` — a centered modal
(File panel's "New" button now opens it instead of a bare name field)
collecting name, width, height, and a default voltage picked from the
server's voltage-color presets (`config.voltageColors`, the same list
Settings' "Voltage classes" section already offers). `DiagramProvider`'s
`newDiagram` (`state/DiagramContext.tsx`) grew an optional
`defaultVoltageName` param: when given, it turns the chosen preset into
the new diagram's first `VoltageClass` and its own `editor.defaultVoltage`
— then, since the user asked for this to be "written while creating"
rather than left dirty for a later Save, immediately does a second save
call so the very first `.xml` written to disk already has it, not just an
in-memory value waiting on the next explicit Save.

The default voltage is also editable after creation — Settings gained its
own "Default voltage" `<select>` (reusing `diagramOps.voltageClassOptions`/
`resolveVoltageSelection`, the exact same preset-or-existing-class pattern
Properties' own voltage select already uses), right above the existing
"Voltage classes" section.

To actually apply it to newly placed elements: `DiagramContext`'s
`defaultVoltage` (the *session*-only "last voltage class picked" value
`placeElement`/`placeBusbar`/`drawConnectorPath`/etc. already read from)
is now seeded from the diagram's own persisted `editor.defaultVoltage`
whenever a diagram is opened or created (`openDiagram`/`newDiagram`), so
a fresh diagram's very first placed element already gets a real voltage
instead of needing a trip to Properties/Settings first — while the
session value it's seeding remains the one source of truth for what a
placement actually uses, so a mid-session pick in Properties/Settings
still overrides it exactly as before.

Verified: a Go round-trip test (JSON → `Diagram` → XML `Save` → XML
`Load`) confirms `defaultVoltage="1"` survives the full path unchanged.

2026-09-16: Added a "Show nodes" toggle to Settings (a small red X, 0.25
stroke width, at every `Diagram.Node`'s own position, regardless of
selection) — a debug overlay showing the diagram's real electrical graph
(wherever a connector end or an element's Port actually lands) rather
than just a symbol's own drawn geometry or declared Terminals.

`slddoc.EditorSettings` gained `ShowNodes bool` (XML/JSON `showNodes`,
persisted per diagram, defaulting to off — no server-level default the
way grid spacing/snap/etc. have, since this is a debug aid rather than an
installation preference). While in that struct: also added `ShowGrid
bool`, fixing a pre-existing bug spotted while adding `DefaultVoltage`
earlier today — the Settings panel's "Show grid" checkbox has always
written to `diagram.editor.showGrid`, but the Go struct had no matching
field, so a diagram's own explicit "Show grid" choice was silently
dropped on every save/reload (falling back to the server's config
default instead). Both are now real, round-tripped fields.

`Canvas` renders the new overlay unconditionally over every node when the
setting's on (`diagram.nodes.map(...)`, the same red-X path shape the
selected-terminal marks already use, just a thinner 0.25 stroke instead
of 0.5, and with no selection/ghost-drag exclusion — a node's own
position doesn't change mid-drag the way a symbol's drawn terminal would,
so there's nothing here that could visibly lag behind a live drag the way
the selected-terminal marks' own doc comment explains for themselves).

Also, per a follow-up request mid-session: the grid-dot radius from
earlier today's "dots instead of lines" change went from 0.25 to 0.5.

Verified: a Go round-trip test confirms `showNodes="true"` survives
JSON → XML `Save` → XML `Load` unchanged, the same way `defaultVoltage`
was verified earlier.

2026-09-16: Added a Russian UI locale, picked at build time (no runtime
language switcher) — the same architecture a sibling project already uses
for this, adapted to this app's existing `i18n/en.ts`+`i18n/index.ts`
setup.

New `frontend/src/i18n/ru.ts`: a full Russian translation, typed
`Record<keyof Dictionary, string>` against `en.ts`'s own `Dictionary`
type (not `Dictionary` itself — `en.ts`'s dictionary is `as const`, so its
values are literal English strings a translation obviously can't reuse;
only the key set needs to match) — every key `en.ts` currently has is
translated, and a future key added there and left untranslated here is
now a compile error (verified directly: temporarily deleting one
translation from `ru.ts` and running `tsc --noEmit` fails with "Property
... is missing", confirmed, then restored).

New `frontend/scripts/generate-active-locale.mjs <locale>`: writes
`src/i18n/active.ts` to re-export the requested locale's `dictionary`
(always alongside `Dictionary`'s type from `en.ts`, the canonical
source, regardless of which locale). `i18n/index.ts` now imports from
`./active` instead of `./en` directly, so `TranslationKey` and the
runtime `t()` lookup both follow whichever locale was last generated —
the app never imports a specific locale file itself, so an unselected
locale's strings never even reach the bundle (confirmed: a `build:ru`
bundle greps for a Russian string but not the English one, and vice versa
for `build:en`).

`package.json` gained `dev:en`/`dev:ru` and `build:en`/`build:ru`
alongside the existing bare `dev`/`build` (which stay English-only,
unchanged in behavior/output path — `dist/`): each variant runs the
generator for its own locale first. `build:en`/`build:ru` additionally
write to their own `dist-en`/`dist-ru` output directories (`vite build
--outDir`) rather than the shared `dist/`, so building both locales back
to back for a dual-locale deployment doesn't have one overwrite the
other — this detail, and the exact script names, came from a README.md
edit the user made directly while this was in progress, which I
reconciled the implementation against rather than my own initial (simpler,
single-`dist/`) version.

`active.ts` is committed with English as its checked-in default (the
state left by the last `npm run build`), so the repo type-checks/builds
even before anyone runs a locale-specific script first; both `dist-en/`
and `dist-ru/` were added to `.gitignore` alongside the existing
`frontend/dist/`.
