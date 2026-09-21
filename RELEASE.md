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

2026-09-16: Added real support for `KindOverheadLine` ("Overhead line"),
a `ConnectorKind` the model already declared but never fully wired up —
prompted by the user supplying a real xsde2svg snippet
(`<!-- Overhead line:22 --><g id="302" data-type="22" data-name="Line2"
data-voltage="#962896"><polyline .../></g>`) and clarifying it should
draw like buswork, but only accept a connection at its own begin/end.

Backend (`internal/slddoc`): `connectorTypeCode` gained `KindOverheadLine:
"22"` (confirmed against both the user's snippet and a real corpus file,
`sld-viewer/assets/sld/IEEE9bus.svg`'s own xsde2svg-catalog-code
documentation — previously only `KindBusWork` had a code at all). New
`writeOverheadLine` renders this kind with a `<g id data-type data-name
data-voltage>` wrapper around its polyline — unlike every other connector
kind (and a busbar), which stays a single flat `<polyline>`, no `<g>` —
at a fixed 1.5 stroke width (`overheadLineStrokeWidth`), matching the real
convention exactly (verified: rendering the user's own example
reproduces their snippet byte-for-byte). `Connector` gained an optional
`Name` field (mirroring `Element.Name`) since the real format's
`data-name="Line2"` needed somewhere to come from — every other connector
kind still renders with no `data-name` at all.
`TestRender_AnnotatesTypeGroups` updated for the type-comment format
change this implies (`<!-- Overhead line -->` → `<!-- Overhead line:22
-->`, now that a code exists to append).

Frontend: a connector's Kind is now an actual editable `<select>` in
Properties (BusWork/Overhead line/Cable line/Busbar wire, plus a new
Name field above it) instead of read-only text — draw it with the
routing tool as usual (still creates `BusWork` by default; there's no
separate "draw an overhead line" tool/mode), then switch its kind
afterward.

The "begin/end only" restriction: `Canvas.findConnectionTarget` now
special-cases `'OverheadLine'` connectors — instead of
`nearestSegmentOnPolyline`'s "anywhere along the line" search every other
connector kind gets, it only offers the connector's own two true
endpoints, within the same tight `TERMINAL_HIT_RADIUS` an element's own
terminal uses. This applies uniformly to both ends of a route (starting
*or* finishing on an overhead line), since both funnel through the same
function. Landing exactly on an endpoint this way is also, correctly, not
really a "tap" at all: `diagramOps.spliceConnectorAt` gained a
short-circuit — tapPoint landing exactly on a connector's own from/to
Node position now reuses that already-existing Node directly (and leaves
the connector itself untouched) instead of spawning a redundant junction
Node plus a zero-length duplicate connector, which is what the general
mid-span-tap path would otherwise have produced for this exact-endpoint
case. This is a correctness improvement for *any* connector kind, not
overhead-line-specific — it just happens to be the only path an overhead
line's own restricted target-set can ever reach.

Verified: a Go test builds a breaker tapped onto an overhead line's own
begin point (node id reused directly, no extra node/connector) and
confirms the rendered SVG — both wires meet exactly at the shared
coordinate, the overhead line as its own `<g>`-wrapped block, the tap as
an ordinary flat `Buswork:21` polyline.

2026-09-16: Replaced the just-added Properties Kind dropdown with an
up-front palette choice instead (reported directly: a connector's type
shouldn't be changeable after the fact, same as an element's own
shape/class can't be — it should be picked before drawing, like an
equipment symbol, from its own icon in the palette).

Removed: Properties' connector Kind `<select>` and the now-dead
`properties.kind`/`connectorKind.*` (Properties-only) i18n keys and
`CONNECTOR_KIND_LABELS` map added earlier today.

Added instead: a "Wires" section at the top of the Elements palette with
three entries — Overhead line, Cable line, Busbar wire (`BusWork` itself
needs no button, since it's already the routing tool's own default with
nothing armed) — each with its own small icon (new
`lib/wireKindIcon.ts`), styled to hint at how each kind differs: Overhead
line's icon has tower-like tick marks at both ends (matching its real
heavier `<g>`-wrapped render), Cable line's is dashed (the conventional
SLD symbol for an underground cable), Busbar wire's is a thicker line
with a small dot at each end.

New `armedWireKind` state (`DiagramContext`, mutually exclusive with
`armedSymbol`/selection, exactly like arming an equipment symbol —
clicking a palette wire-kind button, selecting anything, or Esc all
clear it) — a *single-shot* arm: the routing tool's next completed route
uses it, then `Canvas` clears it back to `null` itself once that route
finishes (on-target completion or double-click-to-end-in-mid-air alike),
so arming applies to exactly one wire, not every subsequent one.

Every `diagramOps` route-creator (`drawConnectorPath`,
`drawConnectorPathToConnector`, `drawConnectorPathFromConnector`,
`drawConnectorBetweenConnectors`, `drawDanglingConnectorPath`,
`drawDanglingConnectorPathFromConnector`) grew a trailing `kind:
ConnectorKind = 'BusWork'` parameter — appended after the existing
`defaultVoltage` param specifically so no existing call site needed
updating, only `Canvas`'s own six call sites, which now pass `armedWireKind
?? 'BusWork'`. `connectElements` (the older, separate instant
Ctrl/Cmd-click-connect) is deliberately untouched and still always
produces `BusWork`, unaffected by any armed wire kind — it was never part
of the routing tool this applies to.

2026-09-16: Fixed "impossible to draw new wires — canvas is moving",
introduced by the wire-kind-arming feature just above. `TransformWrapper`'s
own `disabled` prop (which locks `react-zoom-pan-pinch`'s pan/zoom while
`armedSymbol`/`routing`/etc. are active, so a click-to-place or an
in-progress route doesn't fight the canvas panning under it) never got
`armedWireKind` added alongside `armedSymbol` — so with a wire kind armed
but the route not yet started (the moment between clicking a palette
Wires button and clicking a terminal to begin), panning stayed active,
and any incidental mouse movement during that first click got grabbed as
a pan instead of registering as the route's start. Added `armedWireKind`
to that condition, matching `armedSymbol`.

2026-09-16: The user reported "the same bug" after the fix above, so
this time verified directly in a real browser (Claude in Chrome, against
the actual running dev servers) instead of reasoning about it — and it
wasn't panning at all. `armedWireKind` was correctly locking pan/zoom the
whole time; the real problem was that arming a wire kind was far too
fragile to use in the first place.

Starting a route is a tight-radius hit on a terminal specifically
(`findConnectionTarget`, `TERMINAL_HIT_RADIUS`), much smaller than an
element's own wider click target — so a click meant to start a route very
commonly lands a few pixels off the terminal and instead selects the
whole element, exactly as a plain click would. `selectElement`/
`selectConnector`/`toggleElementSelection` all cleared `armedWireKind` as
a side effect of that selection (mirroring how they already clear
`armedSymbol`) — so *every* near-miss silently cancelled the armed wire
kind, forcing a trip back to the palette to re-arm before trying again.
Reproduced directly: with "Overhead line" armed, a click 6 screenshot
pixels off the breaker's own terminal selected the breaker (Properties
opened on it) and un-highlighted the Overhead line button.

Fix: `selectElement`/`selectConnector`/`toggleElementSelection` no longer
touch `armedWireKind` at all — it now only ever clears via `armSymbol`
(genuine mutual exclusion between the two "arm" mechanisms), `armWireKind`
itself, `Canvas`'s own Esc handler, or a route actually completing. A
near-miss now just selects the element under the cursor, same as always,
while leaving the armed kind intact to simply try again.

Verified the full corrected flow live: armed "Overhead line", a
deliberate near-miss click selected the breaker without losing the arm,
then a precise click on the same terminal started a route (dashed preview
tracked the cursor, canvas didn't move), and double-click-to-end-in-mid-
air produced a real `<g data-type="22">` element in the rendered SVG at
stroke-width 1.5 — confirming the whole path end-to-end, not just the
one symptom originally reported.

2026-09-16: A batch of smaller requests, all implemented and verified in
the same session:

**The routing tool can now start in mid-air too**, not just end there —
double-clicking empty canvas (not already routing, and not on an existing
connector's own line, which still means "add a bend point" as before)
starts a brand new route from a bare point with nothing attached, the
same way double-click-to-end already works. `RouteStart` (`Canvas.tsx`)
adds a third `'point'` kind alongside `ConnectTarget`'s existing
`'element'`/`'connector'`; three new `diagramOps` creators —
`drawConnectorPathFromPoint`, `drawConnectorPathFromPointToConnector`,
`drawDanglingConnectorPathFromPoint` — cover every combination this
implies. `react-zoom-pan-pinch`'s own default double-click-to-zoom is now
explicitly disabled (`doubleClick={{disabled: true}}`), since empty-canvas
double-click has real meaning now and the two would otherwise fight.
Verified live: double-click, drag, double-click again produced a
two-segment wire with both ends genuinely unattached (no element, no
Port) — exactly what a hand-built "just a wire" diagram like
`overhead-line-only` already looked like, now reachable from the UI
itself.

**Deleting a connector now prunes its own now-orphaned nodes.**
`removeConnector` previously only filtered the connector itself, leaving
any endpoint Node nothing else referenced (no element Port, no other
connector's from/to) to accumulate as dead `<node>` cruft in the saved
XML forever. It now prunes exactly those — never a node still shared by
another connector or an element, which is a normal, intentional dangling
end, not orphaned. `deleteConnectorSegment` deliberately keeps using a
plain filter instead of the updated `removeConnector`, since it reuses
the same connector's own from/to for whichever side keeps the original
endpoint — pruning first would leave that side pointing at a node that no
longer exists. Verified live: drew a mid-air-to-mid-air wire, saved
(`<nodes>` had both), deleted it, saved again (`<nodes/>` empty).

**The browser tab title now follows the open diagram** — `${name}${dirty
? ' *' : ''} — SLD Editor`, the same "*" convention FilePanel's own Save
button already uses, via a `document.title` effect in `DiagramProvider`
keyed on `diagramName`/`dirty`. Verified live (tab title updated on
create and again once a wire was drawn, dirtying it).

**Breaker/Disconnector now default to Close (state 1)** when placed,
instead of starting unset — `placeElement`'s own `DEFAULT_CLOSED_CLASSES`
set, checked against the element's Class (covers both the fixed and
withdrawable shape of either, since they share a Class). LoadBreakSwitch/
GroundSwitch — Properties' other two switching-device classes with a
State dropdown — deliberately keep starting unset; only breakers/
disconnectors were asked for. Verified live: a freshly placed breaker
rendered lawngreen (Close) immediately, no separate trip to Properties.

**Cable line gained its own xsde2svg code, 23** (`connectorTypeCode`),
alongside Overhead line's 22 and Buswork's 21. `writeOverheadLine` was
generalized to `writeNamedLine` and now also handles `KindCableLine` —
the same `<g id data-type data-name data-voltage>` wrapper Overhead line
already got, rather than the flat, name-less polyline every other
connector kind still renders as. `TestRender_AnnotatesTypeGroups` updated
for the resulting type-comment change (`<!-- Cable line -->` → `<!-- Cable
line:23 -->`).

**A newly drawn Overhead line/Cable line connector now gets an
auto-generated Name** ("Overhead line-12"), the same "`<kind label>-<id>`"
convention `placeElement` already uses for equipment ("Breaker-3") — this
is what actually makes `writeNamedLine`'s own `data-name` attribute
non-empty by default, matching a real xsde2svg-exported line's own
data-name (e.g. the `sld-viewer` corpus's "Line2"). New
`defaultConnectorName`/`NAMED_CONNECTOR_KIND_LABEL` in `diagramOps.ts`,
threaded through all 8 `kind`-parameterized route-creator functions (every
one except `connectElements`, which is always `BusWork` and never took a
`kind` param). BusWork/BusbarWire connectors stay unnamed, same as
before. Verified live: a Cable line drawn from a breaker's terminal to
mid-air came back from Properties as "Cable line-7"; a matching Go-level
render of that same connector reproduced `data-name="Cable line-7"`
byte-for-byte (the live session's own backend process hadn't been
restarted yet to pick up the Go-side changes, so this was confirmed via a
direct render call rather than the live SVG, which was still on the old
binary).

**"Busbar wire" removed from the Wires palette** — it had no rendering
(or other) distinction from an ordinary `BusWork` wire to justify its own
button, unlike Overhead line/Cable line, which now have real
xsde2svg-catalog identity (kind, data-type code, auto-name). Removed from
`wireKindIcon.ts`'s `WIRE_KIND_ICONS`/`WIRE_KINDS` and
`ElementsPanel.tsx`'s `WIRE_KIND_LABELS`, plus the now-dead
`connectorKind.BusbarWire` i18n key. `ConnectorKind.BusbarWire` itself is
untouched in the model (`types/index.ts`) — an existing diagram already
using it still loads/renders/saves correctly, it's just no longer
offered as a fresh choice. Verified live: the Wires section now shows
only two buttons.

**"Show nodes" now defaults to on** — `Canvas`/`SettingsPanel`'s own
fallback changed from `?? false` to `?? true` wherever
`diagram.editor?.showNodes` is read. Verified live: a freshly placed
breaker's own terminal node showed its red X mark immediately, with
Settings never opened.

**Properties now prints an element's own type name** ("Breaker",
"Breaker (withdrawable)") above its Name field — the same label its own
Elements-panel palette button shows (looked up from the `elements`
catalog by the element's own `shape`, not just its `class`, since the
latter doesn't distinguish a fixed shape from a withdrawable one sharing
it), falling back to the bare `class` for an element whose shape isn't in
the current library. Verified live: selecting a placed breaker now shows
"Breaker" at the top of Properties.

2026-09-16: The click-to-route tool's default behavior is now select, not
draw — a plain click, even one landing squarely on a terminal, only
starts a route while a wire kind is armed from the Elements palette's own
"Wires" section (shown pressed/highlighted while active); with nothing
armed, it's always select/drag, exactly like clicking anywhere else on
the element. Previously, being *near* a terminal was enough on its own to
start drawing regardless of any armed state, which is what made it so
easy to accidentally start (or fail to start) a route while just trying
to select something.

New "Wire" button added to the Wires palette section (`wireKindIcon.ts`'s
`WIRE_KIND_ICONS`/`WIRE_KINDS` gained `'BusWork'`, listed first) — since
drawing at all now requires an explicit arm, there needed to be one for
the plain/default kind too, not just Overhead line/Cable line.
`handleMouseDown`'s plain-click terminal-start check, `handleWrapperDoubleClick`'s
empty-canvas mid-air-start check, and `handleWrapperMouseMove`'s hover
target-highlight (`connectTarget`) are all now gated behind `armedWireKind`
when not already routing — the hover highlight in particular no longer
shows a "you could connect here" indicator with nothing armed, since it
would be misleading now that nothing happens if you click it.
Ctrl/Cmd-click-instant-connect (`connectElements`) and reshaping an
already-selected connector's own geometry are both untouched — neither
was ever part of the routing tool this gate applies to.

Verified live: with nothing armed, clicking directly on a breaker
terminal already wired to a connector selected that connector instead of
starting a route (previously this would have started one); arming "Wire"
and clicking the same terminal correctly started a route (dashed preview
appeared).

2026-09-16: Text/label element, with all its real parameters (Text, Size,
Anchor, Bold, For), editable through Properties the same way an
element's fields are. `Label` gained its own `ID` (backend `model.go`,
frontend `types/index.ts`) so one specific label can be individually
selected/dragged/deleted, the same as an Element/Connector already could
be — previously a Label only ever round-tripped through the XML, with no
editor support at all. `writeLabel` (`render.go`) now takes the same
`RenderMode` every other selectable node does, always emitting the
label's own `id` and, in `Interactive` mode only, `data-editor-kind="label"`
on its `<text>` (its `<tspan>` continuation lines aren't separately
marked — `closest()` hit-testing against the ancestor `<text>` already
covers a click landing on one).

Frontend: a new "Text" section in the Elements palette (armed the same
click-to-arm way a wire kind is — `armedLabel`/`armLabel`, mutually
exclusive with `armedSymbol`/`armedWireKind`/selection); clicking the
canvas places a standalone `"Label"` text at that point
(`diagramOps.placeLabel`). Clicking an existing label selects it
(`selectedLabelId`/`selectLabel`) — Properties auto-opens the same way it
already does for a first element/connector selection — and dragging it
moves its own anchor (`diagramOps.moveLabel`), following the same
instant-DOM-first, commit-on-mouseup pattern `dragElementsInDom` already
uses for an element (`dragLabelInDom` sets the live `<text>`'s own `x`/`y`,
plus each `<tspan>`'s `x`, directly). A selected label gets a simple
circle drawn at its own anchor point, not a measured text bounding box —
the same minimal-marker convention a connector/busbar's own highlight
already uses. Delete/Backspace and Properties' own delete button both
remove it (`diagramOps.removeLabel`). Properties' new label section:
a multi-line Text field, numeric Size, an Anchor dropdown
(start/middle/end), a Bold checkbox, and a For dropdown listing every
element in the diagram (default "— none —") — For is saved as a plain
reference (`Label.for`, an element id), not a live link: dragging the
referenced element does not move the label along with it, and this is
deliberately out of scope for now.

Also: a freshly placed Lamp now starts with real defaults (`state: 0`,
`fillOff: 'none'`, `fillOn: 'red'`, `radius: 11`) instead of all three
left unset, which previously rendered as an invisible `r="0"` circle
until a trip to Properties (`diagramOps.placeElement`'s `LAMP_DEFAULTS`);
a Lamp also no longer inherits `defaultVoltage` the way every other
placed symbol does — it's a plain indicator read by its own fixed
FillOff/FillOn colors, not something with a primary voltage of its own.

Verified live: placed a Lamp (rendered as an unlit slategray-stroked
circle, radius 11, no voltage assigned) and a Text label; edited the
label's Text (multi-line), Size, Anchor (start -> middle, recentered
live), and Bold (live bold) in Properties; set For to the placed Lamp;
dragged the label to a new position; deleted it via Properties' own
Delete button. Saved and reloaded the diagram from disk — the label's
`id`/`for` and the Lamp's `state`/`fillOff`/`fillOn`/`radius` (and
absent `voltage`) all round-tripped correctly through the `.xml`.

2026-09-16: A selected Lamp now gets its own Properties section instead
of the ordinary element fields it made no sense for: no Voltage class
`<select>` (a Lamp reads its own fixed Off/On colors, not a voltage
class color) and no Orientation `<select>` (its own template is a plain
circle — rotating it changes nothing visually) — both skipped the same
way via `PropertiesPanel`'s `isLamp` check — and in their place a State
dropdown (Off/On, plain text labels rather than reusing the
switching-device Open/Close/Intermediate legend, since a lamp isn't
one), an Off color/On color picker pair (`<input type="color">`, bound
to `FillOff`/`FillOn`), and a numeric Radius, all three previously only
ever set once, at placement, with no way to change them afterward. The
color pickers fall back to a plain black/red swatch (`swatchColor`) when
the stored value isn't a `#rrggbb` hex — covers `LAMP_DEFAULTS`' own
`fillOff: 'none'`, which a color picker can't represent directly, or any
older diagram carrying a plain CSS color name; picking a color always
commits a real hex regardless of what was there before.

Verified live: placed a Lamp, confirmed Properties showed State/Off
color/On color/Radius with no Voltage class or Orientation field;
switched State to On and set On color via the picker to `#00ff00` — the
lamp rendered solid green live.

2026-09-16: A label's own text can now be colored and vertically
anchored, not just white with a fixed baseline. `Label` gained `Color`
(`FillOff`/`FillOn`-style, empty means the original hardcoded white, so
an already-saved label with no `color` attribute keeps rendering exactly
as before) and `VAlign` (`"top"`/`"middle"`, empty means the original
baseline-at-Y behavior, i.e. "bottom" — `writeLabel` maps this to a
`dominant-baseline` style, `hanging`/`middle`, added only when set).
Properties' Label section gained a Color picker (`<input type="color">`,
same `swatchColor` black/red-style fallback the Lamp's own pickers use —
here falling back to white for an already-white/legacy label) and a
Vertical anchor dropdown (Top/Middle/Bottom) alongside the existing
horizontal Anchor.

While verifying this, found the backend dev server had silently stayed
on stale code through an earlier restart attempt (`kill` matched the
wrong process name, the new `go run` then failed on "address already in
use" and was never checked) — its still-running old binary predated
even the earlier Color/`swatchColor` work, so a save through it silently
dropped both new fields entirely (JSON unmarshaling ignores keys a
struct doesn't have). Fixed by killing whatever's actually bound to
:8090 (`lsof -ti:8090`) rather than trying to match the process by name,
and confirming the fix with a direct `curl -X POST /api/render` round
trip before touching the browser again.

Verified live: opened a saved diagram's existing label, set Color to
`#00ccff` via the picker and Vertical anchor to Middle — text recolored
live; saved and confirmed the `.xml` on disk now reads
`color="#00ccff" valign="middle"`.

2026-09-16: A label's own font-family is now editable too. `Label`
gained `Font` (empty means the original hardcoded Arial, same
already-saved-label-keeps-rendering-as-before convention `Color`/
`VAlign` already use); Properties' Label section gained a Font dropdown
(`LABEL_FONTS`: Arial/Times New Roman/Courier New/Verdana/Georgia — a
handful of common web-safe SVG fonts, Arial first so it maps back to
"unset" the same way Vertical anchor's own "Bottom" does).

Verified live: set a label's Font to Courier New and Size to 32 —
rendered in the picked monospace-serif font live; saved and confirmed
the `.xml` reads `font="Courier New"`.

2026-09-16: Fixed every label in a diagram saved before Label had its
own `id` (any diagram from before this session's Label feature work —
`diagrams/PS_110kV_Example.xml`, 303 of them) all silently sharing id 0,
which made per-label select/drag/edit/delete break in a hard-to-spot
way: clicking any one of them showed the right text in Properties but
`ID: 0`, and `diagramOps.updateLabel`/`removeLabel` (which key off
`l.id === id`) would have applied to *every* label sharing that id at
once. `ensureLastId` now always backfills a fresh, real id for any label
still at 0 via `IdSequence`, independent of whether the diagram's own
`lastId` needed backfilling too (this diagram already had one, from its
elements/connectors, which is exactly why the label gap went unnoticed
— `ensureLastId`'s old single early-return skipped everything once
`lastId` was already set). `DiagramContext.openDiagram` now also flags
the diagram dirty when `ensureLastId` actually changed anything (it
returns the same object reference otherwise, so `d !== raw` is enough
to tell) — without this, the fix only fixed a diagram for the current
browser session; it was never re-saved to disk, so reopening it
reintroduced the same shared id 0.

Verified live: opened `PS_110kV_Example`, confirmed via a DOM query that
all 303 `data-editor-kind="label"` elements now carry distinct ids (no
longer all 0); clicked the "1СР-110" label specifically and confirmed
Properties showed a real, single `ID` matching only that one; the title
bar and Save button both picked up the dirty flag on open, without any
further edit; saved, and confirmed the `.xml` on disk now carries a
unique `id="…"` on every one of its 303 `<label>` elements, with
`lastId` bumped to cover them.

2026-09-17: The right Properties panel now shows and lets you edit a
diagram's own Width/Height (plus its read-only file name) whenever a
diagram is open and nothing else is selected — before this, those two
fields could only ever be set once, at creation time, in the New Diagram
dialog. Selecting/opening a diagram from the File panel now also brings
the Properties panel forward automatically, the same null -> non-null
transition trick already used for canvas selection (`App.tsx`'s
`hadDiagram` ref), so the fields are visible immediately without an extra
click.

2026-09-17: A `KindCableLine` connector ("Cable line", data-type 23) now
renders dashed by default (`stroke-dasharray: 6,5`, `render.go`'s new
`cableLineDash`), matching the real xsde2svg cable-line renderer
(`xsde2svg/internal/modus/element_23.go`'s own "штриховая" dash pattern)
instead of the plain solid stroke it shared with `KindOverheadLine`
before this — overhead line itself is untouched and still renders solid
unless the general `Connector.Dashed` flag is set. The Elements panel's
own "Cable line" wire-kind icon (`wireKindIcon.ts`) is updated to the
same `6 5` dasharray so the palette preview now matches the real render
exactly, rather than a placeholder dash pattern.

2026-09-17: A `KindCableLine` connector's dash pattern is now a real,
per-instance choice instead of the single hardcoded default from
earlier today. Added `Connector.LineStyle` (`ConnectorLineStyle`: empty/
unset, `solid`, `dashed`, `dashDot`, `dotted`), mirroring xsde2svg's own
line-style switch (`xsde2svg/internal/modus/element_23.go`) exactly —
`render.go`'s `resolveCableLineDash` maps it to the real
stroke-dasharray value, with unset/unrecognized falling back to
`dashed` (6,5) so an already-saved diagram keeps rendering the same way
it did before this field existed. Meaningless for every other
`ConnectorKind`, which keeps its old behavior untouched (the legacy
`Dashed` boolean still governs `KindOverheadLine`/`KindBusWork`, exactly
as before). The Properties panel now shows a "Line style" dropdown for
a selected connector, but only when its Kind is Cable line — the four
choices carry plain English labels (Solid/Dashed/Dash-dot/Dotted), not
the Russian names the reference implementation itself uses internally.
`diagramOps.ts`'s two connector-splitting functions (`spliceConnectorAt`,
`deleteConnectorSegment`) now carry `lineStyle` over to each half, the
same way they already do for `dashed`.

2026-09-17: The Elements panel's own equipment/wire/text palette buttons
now use a 10%-tighter padding around each preview icon (`p-1` → the
Tailwind arbitrary value `p-[3.6px]`) so the icon sits a little closer
to its button's border.

2026-09-17: A selected element's own type line in Properties
(`PropertiesPanel.tsx`) now reads "Name:shape" (e.g. "Breaker:41",
"Load-break switch:42") for every element, not just the ones — Breaker,
Disconnector — whose palette name already happened to distinguish a
withdrawable variant from a plain one. Matches render.go's own
`typeComment`/`shapeName` "Breaker:41"-style SVG comment convention
exactly, just surfaced in the UI too.

2026-09-17: The Elements panel's "Wires" section renames its plain/
default `KindBusWork` button from "Wire" to "Buswork" (English locale
only, `connectorKind.BusWork` in `en.ts`) — matching the name
`render.go`'s own `connectorKindName` map has always used for this kind
internally (its SVG comment already reads `<!-- Buswork:21 -->`).

2026-09-17: A selected connector's own two true endpoints can now be
dragged directly — but only when genuinely dangling (not an element's
own Port, and not shared with another connector as a junction; see
`diagramOps.isConnectorEndpointDangling`) — closing a real gap where a
wire's length/position could previously only change by moving whatever
it was attached to, or by deleting and redrawing it. New
`diagramOps.moveConnectorEndpoint` keeps the touching segment orthogonal
via the same projection-lock rule `moveConnectorVertex` already uses for
an interior vertex, just with a single neighbor: that neighbor slides to
match when it's itself free to move, or gets a new bend inserted next to
it when it's the connector's other true endpoint (a straight two-point
wire) and can't. Canvas shows the new handle as an unfilled square
(`handleEndpointMouseDown`), distinct from an interior vertex's filled
one and a segment midpoint's translucent circle, appearing only on a
dangling end.

2026-09-17: Added zoom in/zoom out/fit-to-view buttons overlaid on the
canvas, bottom-right (`Canvas.tsx`'s new `ZoomControls`), matching
sld-viewer's own control layout and styling. "Fit to view" scales and
centers the whole diagram to the wrapper's current size (a "contain" fit
computed from `diagram.width`/`height`, with `animationTime: 0` on the
underlying `setTransform` call to avoid `react-zoom-pan-pinch`'s default
rAF-driven animation getting stuck on a backgrounded tab) rather than
resetting to a fixed scale.

2026-09-17: Ground switch (shape 54) read backwards at its raw, unrotated
default — earth/ground plates at the top, switch stub at the bottom —
confirmed by comparing byte-for-byte against a real xsde2svg corpus
export (`sld-viewer/assets/sld/*.svg`, 497 occurrences), which always
places this shape pre-rotated (orient 90/180, never 0); the template
geometry itself is correct and was left untouched. Fixed two things that
sat on top of it instead: the Elements panel's own preview icon for
Ground switch is now spun 180° just for display (`elementIcon.ts`'s new
`ICON_ROTATION`, keyed by shape, wraps the icon body in a `rotate(180)`
group — doesn't touch the real render template), and a freshly placed
Ground switch now defaults to `orient: 180` instead of unset/0
(`diagramOps.placeElement`), so it already reads the conventional way —
stub up toward whatever it taps off of, earth symbol dangling below —
without a separate trip to Properties' Orientation field.

2026-09-17: Ground switch's own State is no longer inert — Properties
already offered a State dropdown for it, but `base.xml`'s shape-54
template never consumed the value, so nothing visually changed when it
was set. Its moving-blade path now uses the same `{state:a|b|c}`/
`{stateAttr}` mechanism Breaker/Disconnector already use, reusing
Disconnector's own Close(vertical)/Open(horizontal)/Intermediate(diagonal)
convention — Open is the template's own existing fixed line
(`M 6 -8 h -12`), Close (`M 0 -2 v -12`) was cross-checked byte-for-byte
against real corpus exports actually carrying `data-state="1"` for this
shape (`PS_110kV_Lubnisa.svg`, `Shema PO VES.svg`), and Intermediate
(`M -4.6 -12.6 l 9.2 9.2`) borrows Disconnector's own diagonal
proportions, recentered to Ground switch's blade pivot, since no real
corpus example of that state exists for this shape. Since an unset State
now renders as Close (`applyStateLine`'s own nil-maps-to-first-option
rule), `placeElement` also gives a freshly placed Ground switch a default
State of 0/Open (`GROUND_SWITCH_DEFAULT_STATE`) — matching both the real
corpus (~92% of a real substation export's own Ground switch elements are
Open) and the template's own pre-existing fixed appearance, so nothing
about a freshly placed one's default look actually changes. Every existing
saved Ground switch already carries an explicit `state="0"` (confirmed:
all local diagrams, and 92% of the reference corpus), so this is a pure
render-side addition with no visual regression for anything already
saved.

Ground switch also gained a real `<terminals>` entry — `<terminal x="0"
y="10"/>` — the first it's ever had; previously the click-to-route tool
and Ctrl/Cmd-click-to-connect could only fall back to its bare anchor
(`el.x`/`el.y`), which sits in the middle of the switch mechanism, not
where a wire actually belongs. Only one terminal, not two like Breaker/
Disconnector: a real xsde2svg corpus diagram's own Ground switch elements
each carry exactly one `<port>`, since the symbol's other end is the
earth/ground-plate symbol — a dead end representing "connected to the
physical earth", not a node anything else can attach to. The terminal is
placed at the grid-aligned y=10 rather than the drawn stub's own true tip
(y=12), so a wire landing on it stays exactly on a 10-unit grid, matching
Breaker/Disconnector's own ±10 terminals.

2026-09-17: The default grid spacing is now 10 units (was 20) — the
server config default (`grid_spacing` in `sld-editor.yaml`) and both
frontend fallback constants (`Canvas.tsx`, `SettingsPanel.tsx`) that apply
before a diagram's own `editor.gridSpacing` or the server config loads.

2026-09-17: Ground switch's own stub is now shortened to end exactly at
its terminal (y=10) instead of overshooting 2 units past it to the real
corpus's own y=12 tip — visible on selection as the drawn line sticking
out past the terminal's own red "X" marker (a deliberate, minor deviation
from that byte-for-byte corpus match, this time on purpose, since the
terminal itself is already grid-aligned to y=10 rather than the corpus's
y=12). Every downstream coordinate (contact bars, ground plates) is
unchanged, since they're all relative moves from the same point the stub
still ends at.

2026-09-17: Load-break switch (shape 42) now defaults to State Close on
placement, same as Breaker/Disconnector (`diagramOps`'s
`DEFAULT_CLOSED_CLASSES` now includes it), and gained a real `<terminals>`
entry — `<terminal x="0" y="-10"/>`/`<terminal x="0" y="10"/>` — matching
Breaker/Disconnector's own convention exactly, since its template's stem
already ends at precisely those two points (no geometry change needed,
unlike Ground switch). Previously Canvas's click-to-route tool and
Ctrl/Cmd-click-to-connect could only fall back to its bare anchor for a
Load-break switch; now both real terminals show as selection markers and
are proper wiring targets.

2026-09-17: Breaker/Disconnector (withdrawable) — shapes 43/49 — gained a
second, independent status axis: Position status (Service/Normal/Test),
their own racking position, alongside their existing Operational Status
(open/closed/intermediate — the Properties State dropdown, now relabeled
"Operational Status" for these two shapes specifically so it isn't
confused with the new field). Modeled on `sld-viewer`'s own Pattern D
(`applyTrolleyState`/`data-trolley`), not the real xsde2svg exporter's own
per-shape behavior — a deliberate choice: the real source only offsets the
body for "Service" and leaves "Test" at the same x-origin (a per-element
`xMirror`-aware nuance), where this editor (and sld-viewer's own live
telemetry handler) offsets both the same simple way, since there's no
per-instance mirroring concept here.

New `Element.Position *int` (`model.go`, mirrors `State` exactly), a new
`config.PositionStates`/`position_states` legend (Service/Normal/Test —
no color, since Position drives a geometric offset, not a fill), and two
new `render.go` placeholders, `{positionAttr}` (a live `data-trolley="N"`
on the movable body's own wrapping `<g>`) and `{positionOffset}` (the
x-shift applied via that `<g>`'s own `transform`). `base.xml`'s shape
43/49 templates now wrap everything except their own fixed far
isolating-throw chevrons in that `<g>` — those chevrons stay in place
outside it, matching both a real xsde2svg export's own fixed disconnect-
contact stubs and sld-viewer's own Pattern D DOM shape. Both shapes also
gained real `<terminals>` for the first time — `(0,-30)`/`(0,30)`, the far
chevron tips, which the file's own preexisting comment already identified
as the true connection points (the gap out to them is "the isolating
throw distance," not a missing connector) — previously neither had any
terminals at all. Shape 49's own `{state:...}` blade options were
re-derived from the real xsde2svg source
(`xsde2svg/internal/modus/element_49.go`): the symbol's pre-existing
geometry turned out to already be that source's exact "Normal position,
Closed" output, confirmed byte-for-byte by re-deriving the formula from
the source's own constants; Open was derived the same way, and
Intermediate (which the real exporter doesn't model for this shape at
all) was invented for consistency with every other switching device's own
3-way State — the same kind of deliberate deviation Ground switch's own
Intermediate option already is. Existing saved diagrams are unaffected:
every already-placed shape-43/49 element carries no Position, which
renders as offset 0 with no `data-trolley` attribute — visually identical
to before this change (confirmed against `PS_110kV_Example.xml`'s own 30
such elements).

2026-09-17: Breaker/Disconnector (withdrawable) — shapes 43/49 — now
default to Position status Normal on placement (`diagramOps.placeElement`'s
new `WITHDRAWABLE_SHAPES`/`POSITION_NORMAL`), the same racked-in/connected
position every such device starts service in. Doesn't change how a freshly
placed one renders (base.xml's `{positionOffset}` already treats nil the
same as 1/Normal), just gives Properties' own Position status dropdown a
real starting value instead of "— none —".

2026-09-17: Disconnector (withdrawable):49's own invented Intermediate
Operational Status animation is now the plain Disconnector's (162) own
diagonal, verbatim — `l 9.2 9.2`, the exact same segment 162 itself uses —
instead of a separately-invented diagonal shape. The surrounding
"m -8.6 5.4"/"m -8.6 5.4" stubs are shape 49's own (its contact gap is
bigger than 162's), chosen so that diagonal still runs from (-4.6,-4.6) to
(4.6,4.6) relative to the switch's own gap center, exactly like 162's own
diagonal does relative to its center, while still meeting the fixed
contact bars on either side.

2026-09-17: Ground terminal (shape 31) gained a real `<terminals>` entry —
a single `<terminal x="0" y="-10"/>` — its stem's own far tip, which was
already exactly grid-aligned (unlike Ground switch's own stub, this needed
no shortening). Only one terminal, same reasoning as Ground switch: the
plate fan below is a dead end representing the physical earth, not a node
anything else attaches to.

2026-09-17: Current transformer (shape 34) shortened from height 22 (its
primary-conductor line spanning ±11) to height 20 (±10), so it's
grid-aligned, and gained two real `<terminals>` — `(0,-10)`/`(0,10)`, the
line's own new tips — its coil-loop geometry (already ±8, height 16) was
left as-is.

2026-09-17: Choke coil (shape 33) and Capacitor (shape 388) each gained
two real `<terminals>` at their own stem's two ends — `(0,-20)`/`(0,20)`
for Choke coil, `(0,-10)`/`(0,10)` for Capacitor — both already exactly
grid-aligned, so no geometry change was needed for either.

2026-09-17: Fuse (shape 203) and Surge arrester (shape 35) each gained two
real `<terminals>` at `(0,-10)`/`(0,10)` — both symbols' own stems already
ended exactly there, so no geometry change was needed for either.

2026-09-17: Fault passage indicator (shape 320003) — its own circle+"FPI"
text template already existed, but its ring/text color now tracks State
via a brand new, separate config legend, `fpi_state_colors`
(`config.Config.FPIStateColors`, served as `GET /api/config`'s
`fpiStateColors`) — deliberately its own legend rather than reusing
`state_colors`, since an FPI's Open/Close meaning is inverted from a
switching device's own (Open/lawngreen = no fault, Close/red = fault
passed, vs. a breaker's Open/red, Close/lawngreen). New `render.go`
placeholder `{fpiColor}` (a `stateColorSet.fpiColor` method, defaulting an
unrecorded State to 0/Open rather than the generic `{fill}`'s "none",
since the ring is always colored) replaces the template's own previously
hardcoded `stroke:lime`/`fill:lime`. `slddoc.Render`'s own signature grew
a new `fpiStateColorLegend []StateColor` parameter (before the existing
variadic `stateColorLegend`), threaded through `storage.Store` the same
way the switching-device legend already was. Gained two real `<terminals>`
at `(0,-10)`/`(0,10)` and, in Properties, its own State dropdown (sourced
from `fpiStateColors`, not `stateColors`) — previously not shown at all,
since FaultPassageIndicator wasn't in `SWITCHING_DEVICE_CLASSES`. A
freshly placed one now also defaults to State 0 (Open) and Radius 10
(`diagramOps`'s `FPI_DEFAULTS`, matching the terminals above and the
default 10-unit grid) instead of leaving both unset — an unset Radius
rendered as an invisible `r="0"` circle, the same gap Lamp had before its
own defaults were added; existing saved diagrams with an already-placed,
radius-less FaultPassageIndicator are unaffected by this (their own
circle stays invisible, only their "FPI" text — never radius-dependent —
picks up the new default-Open color). The template's own "FPI" text also
shrank from 13px to 8px, so it fits inside a ring this size. Also stopped
offering a Voltage class field for it in Properties, matching Lamp's own
treatment (neither reads a voltage color) — but, unlike Lamp, it keeps
Orientation: Lamp's template has no terminals at all, so rotating it does
nothing either way, while a FaultPassageIndicator's own two real terminals
(top/bottom by default) do need Orientation to land on a horizontal wire
instead of only ever a vertical one. Rotating it would have carried its
own "FPI" text sideways too, so that text is now wrapped in its own `<g
transform="rotate({counterRotate})">` — a new `render.go` placeholder,
the negated Orient, that cancels the outer element-level rotation for
just that one fragment — keeping the label upright at any Orientation
while the ring and its terminals still rotate normally.

2026-09-17: Canvas's own grid-dot overlay (`Canvas.tsx`) now batches
`GRID_TILE_FACTOR` (10) grid cells per side into one SVG `<pattern>` tile
instead of one dot per tile — same dots, same spacing, identical static
appearance, just ~100x fewer pattern-tile boundaries for a diagram at the
default 10-unit spacing. A single-dot-per-tile pattern this densely tiled
(tens of thousands of tiles for a diagram thousands of units across) hit a
real Chromium rendering quirk: stray hairline seams at scattered tile
boundaries while the whole canvas is under a live CSS scale
(`react-zoom-pan-pinch`'s own zoom mechanism), worst while actively
zooming since the scale changes every frame. Batching dots into fewer,
bigger tiles doesn't eliminate the underlying quirk, but cuts how often a
seam has a boundary to appear on by roughly `GRID_TILE_FACTOR²`.

2026-09-17: `backend/internal/slddoc` is no longer this editor's own
package — it's replaced by a new standalone Go module,
`github.com/PVKonovalov/slddoc` (sibling repo at `../slddoc`, required
via a local `replace` in `backend/go.mod` for now), shared with `sld-svg`
(which owns `Extract`, reconstructing a `Diagram` from a real
xsde2svg-exported SVG). This editor's own model/render code — JSON tags,
`Diagram.LastID`/`Editor`, `Element.Position`, `Connector.Name`/
`LineStyle`, `Label.ID`/`Color`/`VAlign`/`Font`, the `RenderMode`
(Static/Interactive) mechanism, the configurable `StateColor`/`fpiColor`
legends, `positionAttr`/`positionOffset`/`{counterRotate}`, and
`writeNamedLine` for `OverheadLine`/`CableLine` — became the shared
module's own model/render code verbatim, since it was already a strict
superset of `sld-svg`'s simpler, corpus-fidelity-only version; `sld-svg`'s
own `extract.go` picked up the one real rename this required
(`KindObjectLink` → `KindBusWork`) and its CLI (`cmd/svg-sld`) now passes
an explicit `RenderMode`/`StateColor` legend to `Render` instead of
relying on that behavior being hardcoded in the package. Nothing about
this editor's own behavior changes — every caller (`internal/storage`,
`internal/api`, `internal/elements`, `cmd/sld-editor`) just imports the
new module path instead; `go build`/`vet`/`test` all pass unchanged, and
several already-saved diagrams (`test1`, `test 11-`,
`overhead-line-demo`) render byte-identical SVG through the API before
and after the switch (two other saved diagrams did come back different,
but only because their own on-disk `.svg` predates later feature commits
— the Fault Passage Indicator's counter-rotate wrapper, the
shape-71-to-162 disconnector migration — unrelated to this module
switch).

2026-09-17: Added two new equipment shapes to the palette, both
stateless (no `{fill}`/`{state:...}`, unlike the switching devices):
Reactor (37) and Reactor (shunt) (397), ported from xsde2svg's own
`element_37.go`/`element_397.go`. Reactor's own template (`M 0 -20 v 9 a
11 11 0 1 1 -11 11 h 11 v 20`, terminals at ±20) is confirmed
byte-for-byte against a real corpus instance's own drawn path once
re-centered on the coil's own midpoint the way every other two-port
symbol here is (xsde2svg's own anchor for this shape is its top
terminal, not the center). Reactor (shunt) only exists here in its
grounded form (`FReactorShuntType != "NoGround"` in the source; this
schema doesn't model that type switch or the source's own mirroring flag
as per-instance fields, and a shunt reactor is, in practice, essentially
always earthed on one side) — its own earth symbol reuses the exact same
three-bar (16/12/8-wide) fan Ground terminal (31) and Ground switch (54)
already draw, so it gets only one real terminal (top, ±20), the earthed
side being a dead end the same way theirs is. Both added under the
existing "Other equipment" category, next to Choke coil (33).

2026-09-17: `Extract` (the shared `slddoc` module, sld-svg's own
side) now also recognizes Reactor (37) and Reactor (shunt) (397) — they
were previously silently counted in `Report.Skipped`, which is why
`svg-sld extract` never picked them up from a real corpus SVG even
though `sld-editor` could already draw them. Reactor drops straight
into the existing generic `parseTwoPortDevice` (its two ports are just
the extremes along its own dominant axis, same as Choke coil); Reactor
(shunt) got its own new one-port parser, `parseReactorShunt`, mirroring
`parseGround`'s own fallback convention (rotate() center when present,
else the combined path's own first point) since real instances appear
both rotated and unrotated. That surfaced a real anchor mismatch in
`base.xml`'s own Reactor (shunt) template, fixed here: it had been
centered on the coil's own midpoint like Reactor (37) is, but
`parseReactorShunt` reports the coil's own *top* as the anchor (matching
where the real source's combined path starts drawing) — so the
template's local origin (0,0) is now that top terminal itself, not a
centered point 20 units below it; its one `<terminal>` moved from
`(0,-20)` to `(0,0)` to match. Verified with a real extract→render round
trip against `sld-svg/examples/sld/Examples.svg`: the re-rendered
Reactor's path lands byte-for-byte on the same absolute coordinates as
the original corpus instance's own drawn path. `sld-svg`'s own
`symbols.xml` (its independent, simpler reference library) picked up
matching templates for both shapes too, so `svg-sld render` doesn't
regress against a diagram containing either.

2026-09-17: Added 7 more equipment shapes to the palette, all stateless
except Starter — Surge arrester (29, a body-box-with-diagonal variant of
35), Starter (76, uses the existing `{state:...}` mechanism for its own
moving contact, no `{fill}`/data-fill legend of its own), Fuse
(withdrawable) (154, reuses the existing Service/Normal/Test Position
mechanism built for Breaker (43)/Disconnector (49) — `WITHDRAWABLE_SHAPES`
in both `PropertiesPanel.tsx` and `diagramOps.ts` now include it), Surge
arrester (grounded) (168, a one-port variant of 29/35 with the same
three-bar earth fan as Ground terminal/Ground switch/Reactor shunt),
Capacitor bank (172, one-port, the "БСК" default-CustomView geometry only
— this schema doesn't model that per-instance variant switch), Generator
(173, one-port, a circle-and-sine-wave symbol), and Non-intersection /
"Wire jump" (14, a purely decorative wire-crossing hop mark — modeled with
two real ports anyway, one on each side, since each is still a genuine
node a wire can land on). All of them also picked up `Extract` support in
the shared `slddoc` module (previously only Reactor/Reactor shunt had
it) — Surge arrester/Starter/Fuse/Wire jump reuse the existing
`parseTwoPortDevice`; Surge arrester (grounded)/Capacitor bank/Generator
share a new `parseOnePortDevice`, alongside Reactor shunt (whose own
dedicated parser was folded into it).

Fixed a real anchor bug this surfaced: `parseOnePortDevice` (and Reactor
shunt's own prior parser) used to treat a found `rotate()` transform's own
center *as* the anchor directly — correct for Ground (31), where the
transform's center and the path's own first point are always the same
value, but wrong for these four shapes, whose real source rotates around
a different reference point than the drawn terminal (confirmed against a
real corpus instance, `vres.svg` id 148791225: a Generator's own
`rotate(-270,3630,600)` pivots on its circle's center, 25 units from its
own terminal at `M 3630 575`). Fixed by always reading the path's own
first point first, then rotating *that* through the found transform — the
same thing `parseTwoPortDevice` already does for its own two ports —
rather than substituting the transform's center in its place.

Chasing that fix down also exposed a real gap in `parseSubpaths` (the
shared module's own minimal SVG path parser): it didn't understand SVG's
own shorthand repeated-parameter convention (e.g. `h -15 0` is two
implicit horizontal linetos, not one command followed by a stray `0`),
which several real Reactor shunt (`397`) instances use for their own
earth-fan geometry — previously this either raised a "no <path> geometry"
tokenizing error or, worse, corrupted the anchor computation, since it
silently misinterpreted the parser's own internal state instead. Fixed
generally (any command's parameters now repeat for as long as another
group follows without a fresh command letter — not just `397`'s own case)
rather than special-cased; also had to teach the tokenizer to recognize
curve commands (C/S/Q/T) explicitly as unsupported, so the new
repeat-until-next-command-letter logic doesn't silently swallow one's own
numeric arguments as extra points instead of raising the same
"unsupported command" error it always has.

Verified all of this against the full `sld-svg/examples/sld` corpus (145
files): every one of the 7 new shapes' data-type codes is gone from
`Report.Skipped`, `Report.Failed`'s own total count went *down* (from 362
before this session's reactor work to 359 now — the anchor/parser fixes
above resolved 3 pre-existing failures along the way, after briefly
regressing to 367 mid-fix), and a full extract-then-render round trip
produces no missing-shape errors anywhere in the corpus. Spot-checked
several real rotated instances (a Generator, a Reactor shunt) by hand
against the fixed anchor math and confirmed exact agreement.

2026-09-18: Digital device (shape 134) — a live SCADA-style analog readout,
distinct from both a plain equipment symbol and a Label. Backend
(`slddoc` module): a new `DigitalDevice` entity (`Diagram.DigitalDevices`)
shares Label's own text-styling fields (Anchor/Bold/Color/VAlign/Font/Size)
but adds `Name` (the SCADA tag, written as `data-name`), `Value` (a
placeholder/default display value, e.g. `"0.00"` — this editor has no live
data source, only the layout), and an optional `Unit` (`data-unit`, plus
its own inline `<tspan>` right after Value on the same line — unlike
Label's own tspans, which each start a new stacked line). `writeDigitalDevice`
renders it as a bare `<text data-type="134" ...>`, no wrapping `<g>` or
transform, matching a real xsde2svg-exported one exactly; the unit
attribute/tspan are omitted entirely when Unit is empty. Also added
`parseDigitalDevice`/`Report.DigitalDevices` to the shared module's
`Extract` (SVG import) path for `data-type="134"`, mirroring `parseLabel`'s
own scope, so a real xsde2svg file's digital-device readouts round-trip
instead of landing in `Report.Skipped`. Frontend: a `DigitalDevice` type,
`placeDigitalDevice`/`moveDigitalDevice`/`updateDigitalDevice`/
`removeDigitalDevice` in `diagramOps.ts`, a new mutually-exclusive
selection/arm pair (`selectedDigitalDeviceId`/`armedDigitalDevice`) in
`DiagramContext` alongside the existing element/connector/label/symbol/
wire-kind ones, a "Digital device" click-to-place button in the Elements
panel's own "Text" section (next to "Text"/Label), full hit-test/select/
drag support in `Canvas.tsx` (`data-editor-kind="digitaldevice"`, following
the same DOM-first-move pattern as a Label's own `dragLabelInDom`), and a
Properties editor (SCADA tag name/Default value/Unit/Size/Anchor/Vertical
anchor/Bold/Color/Font/delete). New i18n keys added to both `en.ts`/`ru.ts`.

2026-09-18: Two `slddoc` (shared module) fixes surfaced by inspecting
`sld-svg/cmd/svg-sld`'s own `extract` output on real corpus files. (1)
`Extract`'s `parseLabel`/`parseDigitalDevice` never parsed a real source
`id="..."` attribute at all, so every extracted Label/DigitalDevice always
carried `id="0"` (only the frontend's own client-side `ensureLastId`
backfill masked this for a diagram opened through the editor UI — the
standalone `svg-sld` CLI, which saves `Extract`'s output directly with no
such fixup, wrote `id="0"` for all of them). Added `parseOptionalID`
(lenient — 0 only when the source truly has no numeric id, unlike
`parseElementID`'s hard error for an Element/Connector/Node) and wired it
into both; confirmed against a real corpus file that every extracted label
now keeps its own real source id (e.g. `id="2674"`), matching how an
Element/Connector already did. (2) `Diagram.Save` was writing a
meaningless empty wrapper tag (e.g. `<geometry/>` for any non-BusBarSection
Element, since only a busbar populates `Points`) for every "parent>child"
xml-tagged slice field whenever it was empty — a long-standing
`encoding/xml` limitation where `omitempty` is silently ignored for such
chained tags (Go issue #4256), affecting `Element.Points`
("geometry>point") and every one of `Diagram`'s own list wrappers
(`layers`/`voltageClasses`/`nodes`/`elements`/`connectors`/`labels`/
`digitalDevices`). Added `emptyPathWrapperLine`, a second regex pass in
`Save` (before the existing empty-tag-to-self-closing collapse) that
strips these specific always-attribute-less wrapper lines entirely when
they have no children, rather than merely collapsing them to self-closing
— confirmed against the same real corpus file (no more `<geometry/>` on
any non-busbar element) and covered by new round-trip tests, including
one confirming a genuinely populated `<geometry>` (a real busbar's own
points) still round-trips untouched.

2026-09-18: `Extract`'s `parseLabel`/`parseDigitalDevice` (`slddoc` module)
never read a source `<text>`'s own `fill`/`font-family`/`dominant-baseline`
style properties at all, so every extracted Label/DigitalDevice silently
lost its own real color/font/vertical-alignment and rendered with
`writeLabel`/`writeDigitalDevice`'s own hardcoded defaults instead (white/
Arial/baseline) — caught on a real digital device (`id="148701988"`,
`U 2СШ 35`) that's `fill:yellow;dominant-baseline:middle` in the source
SVG but came out white/baseline in the extracted XML, which matters a lot
more for a DigitalDevice than a Label since its whole point is a
per-instance status color. Added `parseVAlign` (reverses
`dominant-baseline` back into the model's own "top"/"middle"/""
convention) and wired `Color`/`Font`/`VAlign` extraction into both
functions via the existing `styleProp` helper. Verified against the real
source (`sld-svg/examples/sld/Examples.svg`) that `id="148701988"` now
extracts as `color="yellow" valign="middle" font="Arial"`, and added
corresponding assertions to `TestExtract_EndToEnd`.

2026-09-18: `PropertiesPanel`'s `swatchColor` (the Label/DigitalDevice/Lamp
color-picker fallback) only recognized an already-`#rrggbb` value —
anything else, including a real CSS named color like `"yellow"` or
`"darkturquoise"` (exactly what the previous fix now correctly extracts
from a real xsde2svg source), fell back to a plain white/black swatch,
misrepresenting the stored color as unset even though rendering it was
already correct. Added `resolveCssColor`, which normalizes any
browser-parseable CSS color into its `#rrggbb` form via a detached
`<canvas>`'s 2D context (whose `fillStyle` getter always serializes a
fully-opaque color that way) rather than hardcoding the 147 CSS named
colors; a genuinely invalid value (e.g. `LAMP_DEFAULTS`' own `fillOff:
'none'`) still falls back to the plain swatch as before. Verified live
against `diagrams/Examples.xml`'s own `id="148701988"` digital device: the
color picker now shows yellow instead of white.

2026-09-18: Voltage transformer (shape 55) added to the palette —
`ClassVoltageTransformer` (`slddoc` module). Ported from xsde2svg's own
`element_55.go`, 2-winding case only: a real instance's own winding count
(2, 3, or 4 circles) is a source-config detail the rendered SVG doesn't
otherwise distinguish by shape/data-type code, so this picks the classic
2-circle look (user's own choice over the 3-circle alternative), the same
simplification already made for Power transformer's own 2-winding-only
case. A one-port "drop" device (single terminal at its own stub's free
end, `(0,0)`) hanging off a bus, same convention as Capacitor bank's
single terminal; the primary winding (top circle) takes the element's
voltage color, the secondary (bottom circle) a fixed `#D2D2D2` gray,
matching a real corpus instance exactly (`sld-viewer/assets/sld/
PS_110kV_Example.svg`, `id="4473"`) — verified live via `/api/render`.
Also wired into the shared module's `Extract` (SVG import) path the same
way every prior shape addition was (`elementDataTypes`, a `parseOnePortDevice`
case, `shapeName`'s own `<!-- Name:code -->` comment entry): verified
against the real source (`sld-svg/examples/sld/Examples.svg`) that all 10
of its own Voltage transformers now extract as real elements instead of
landing in `Report.Skipped["55"]`.

2026-09-18: Replaced element selection/click-tolerance's fixed-radius-circle
approach with each element's own real computed bounding box — surfaced by
the new Voltage transformer (whose anchor sits at its own terminal, far
from where its actual body is drawn) but a real gap for any shape that's
large, small, or off-center from its own anchor, since a single global
circle radius can't fit all of them. Backend (`slddoc`): removed the
invisible `<circle r="18">` `Render` used to add around every symbol
element in Interactive mode as a click-target workaround. Frontend
(`Canvas.tsx`): after each render, computes and caches a real diagram-space
bounding box per symbol element from the backend-rendered `<g>`'s own
`getBBox()` (local, pre-transform geometry) pushed through
`diagramOps.placeLocalPoint`'s existing rotate-then-translate math (now
exported — the same math a shape's own declared `Terminals` already use);
BusBarSection is skipped since it already has its own points-based
highlight. This real box now drives both the selection-highlight rect
(replacing the old fixed `r=24` circle centered on the raw anchor) and a
click-tolerance fallback (`findElementBoxHit`, smallest-box-wins on
overlap, both `handleMouseDown` and the right-click context menu) for a
plain click that lands within a shape's own real footprint but not on any
actually-drawn geometry (e.g. the empty interior of an unfilled stroke-only
shape). Verified live: Voltage transformer's own highlight now tightly
wraps its real two-circle body instead of floating near its anchor, an
existing shape (Breaker) still highlights/selects/drags correctly, and
clicking dead-center in an unfilled circle's own empty interior (no real
geometry there) now correctly selects it via the new fallback.

2026-09-18: Selection marker styling tweaks (`Canvas.tsx`). A selected
symbol element's own real-bounding-box highlight rect is now a thin dashed
red line (0.5px, `stroke-dasharray: 4 2`) instead of the previous solid
blue — the fixed-radius fallback circle (for the brief window before an
element's own box has been computed) matches. A selected Label/
DigitalDevice's own anchor-point marker is now a red "X" (the same shape
convention `TERMINAL_MARK_SIZE` already uses for a terminal/node mark, at
its own larger `SELECTION_MARK_SIZE`) instead of a plain blue circle.

2026-09-18: Fixed Voltage transformer (shape 55)'s own voltage color never
extracting — every real instance came out gray regardless of its true
color. `Extract`'s shape-55 case reused the shared `parseOnePortDevice`,
which reads voltage from a `data-voltage` attribute — but confirmed against
the full `sld-svg/examples/sld` corpus, a real shape-55 instance never
carries one anywhere on its own `<g>` or descendants (unlike every other
one-port device, e.g. Capacitor bank's own `data-voltage` directly on its
`<path>`); its true color only ever lives in the primary winding's own
`style="stroke:..."`. Added a dedicated `parseVoltageTransformer` that
reads voltage from that same first `<path>`'s own stroke instead (the
same path whose first point already served as the anchor), covered by a
new `TestParseVoltageTransformer` using the exact real markup that
surfaced this. Re-extracted `diagrams/Examples.xml`/`.svg` from the real
source (`sld-svg/examples/sld/Examples.svg`) to pick up the fix: all 10 of
its own Voltage transformers now resolve to their real voltage class
(previously all unset) and render in their true color instead of gray.

2026-09-18: Half-chassis (shape 52) added to the palette —
`ClassHalfChassis` (`slddoc` module). Ported from xsde2svg's own
`element_52.go`: a withdrawable device's own racking indicator, a short
stem topped by an arrow-chevron at its own free end (the real electrical
connection point, and this shape's own single terminal, at local `(0,0)`
— same one-port convention as Capacitor bank's own terminal), plus a
second chevron floating disconnected further down with no drawn line
reaching it, representing the coupling's other half now racked out.
Unlike Voltage transformer, a real instance does carry a normal
`data-voltage` attribute, so `Extract`'s shape-52 case reuses the shared
`parseOnePortDevice` unchanged. Verified against the real corpus
(`sld-svg/examples/sld/PS_110kV_Valdai.svg`): the anchor `parseOnePortDevice`
computes for a real rotated instance (`id="4346"`, `x="782" y="1340"
orient="180"`) was hand-derived and confirmed to exactly match this
symbol's own local template coordinates before choosing them, and a full
extract-then-render round trip on that file reproduces all 3 of its own
instances with no missing-shape errors.

2026-09-18: Upgraded `react-zoom-pan-pinch` from `^3.4.4` (installed 3.7.0)
to `^4.2.0`, to fix an intermittent bug where ordinary zoom/pan/select
interaction could suddenly push the whole diagram far off-screen (a wildly
wrong `translate()`, appearing as a black/blank canvas — Reset View
recovers it, confirming nothing was actually lost). Root cause: a known
class of gesture/position bug in the pre-4.x library — GitHub issue #408
("rapid interaction causes the element to pan to a random position",
closed as Released) and the v4.0.x changelog's own "prevented NaN
propagation from invalid mouse/touch positions" among 30+ other
gesture/bounds/pointer fixes. `Canvas.tsx`'s own usage
(`useControls()`'s `zoomIn`/`zoomOut`/`setTransform`/`instance.
wrapperComponent`, `TransformWrapper`'s `disabled`/`doubleClick={{disabled:
true}}`) needed no changes — it already type-checked and built cleanly
against v4's only named breaking change (a `wheel` options restructuring
this app doesn't use). Smoke-tested zoom/pan/drag/select in the browser
post-upgrade with sane transform values throughout; the bug's own
intermittent nature means it can't be proven fully gone in one session, but
this upgrades past the versions containing the matching fixes. The same
upgrade (plus one required source fix — see `sld-viewer`'s own RELEASE.md)
was applied to the sibling `sld-viewer` project, which shares this same
pre-4.x version.

2026-09-18: Chassis (shape 51) added to the palette — `ClassChassis`
(`slddoc` module), Half-chassis's (52) own full-sized sibling: both ends of
the same withdrawable racking-carriage symbol connected by a continuous
stem, instead of one end left disconnected. Own two terminals sit at ±30
(confirmed against two real corpus instances, one rotated one not — the
true anchor always lands exactly at the midpoint between the two outer
marker chevrons), matching Breaker (withdrawable)/Disconnector
(withdrawable)'s own convention exactly. Reuses the same
`{positionOffset}`/`{positionAttr}` withdrawable-racking mechanism those
two shapes already have (the real xsde2svg source's own "trolley" concept
these placeholders were originally named after) — the movable body (the
inner chevron-stem-chevron path, carrying the real source's own
`data-trolley` attribute) slides sideways while the two outer marker
chevrons stay fixed. Added `'51'` to `WITHDRAWABLE_SHAPES` in both
`PropertiesPanel.tsx` (shows "Position status", no State — matching Fuse
(withdrawable)'s (154) own precedent, since a real instance never carries
`data-state`) and `diagramOps.ts` (defaults a freshly placed one to
Position "Normal"). Wired into `Extract` via the shared `parseTwoPortDevice`
the same way as every other two-port withdrawable shape. Verified live:
placing one from the palette shows Position status defaulting to Normal;
switching it to Service visibly shifts the inner body sideways relative to
the fixed outer terminals; a full extract-then-render round trip on the
real corpus reproduces the source geometry with byte-exact math (confirmed
by hand) and no missing-shape errors.

2026-09-18: Object link (shape 28, "Связь с объектом" in the xsde2svg
catalog) added as a placeable connector kind — full scope (backend render
fix plus frontend palette placement), per the user's own request after
describing it as "just line with an arrow" and supplying a real xsde2svg
instance to match. New `KindLinkToObject` `ConnectorKind` (`slddoc` module)
— deliberately *not* reusing the string `"ObjectLink"`, since that value is
already `kindObjectLinkLegacy`, silently rewritten to `KindBusWork` on
every `Load()` for backward compatibility with diagrams saved before this
editor's own Connector.Kind convention existed; reusing it here would have
made every freshly drawn Object link connector revert itself to a plain
Buswork the next time its diagram loaded. `connectorKindByType["28"]` fixed
to map to the new kind instead of `KindBusWork` (`elements.go`), so
`Extract`ing a real xsde2svg document now correctly classifies this shape
rather than silently downgrading it. Renders (`render.go`'s new
`writeObjectLink`) as the same flat, un-wrapped `<polyline>` convention as
Buswork, just at a heavier 2px stroke, plus a separate triangular arrowhead
`<path>` at the connector's own final point, rotated to continue pointing
in the direction its last segment was travelling
(`atan2(from.X-to.X, dy)`, reverse-engineered from the real instance's own
effective angle — computed as `from.X-to.X` rather than the more obvious
`-(to.X-from.X)` specifically so IEEE754's sign-of-zero doesn't flip a
straight run into the wrong 180° twin of the correct angle). The arrowhead
is placed via this codebase's own `translate(x,y) rotate(angle)` local-
origin convention (matching every symbol template's own transform, the one
`renderElement` already uses everywhere else) rather than literally
reproducing the real source's own single `rotate(angle,cx,cy)` around an
absolute-coordinate path — those two aren't interchangeable once the path
data itself is local rather than pre-rotation-absolute, and an earlier
version of this function, written to match the real markup literally, was
caught rendering the arrowhead thousands of units away from its own wire; a
regression test (`TestRender_ObjectLinkMatchesXsde2svgFormat`) now
independently recomputes the arrowhead's own on-screen corner positions
from its rendered transform and checks them against the real instance's
own known screen coordinates, rather than trusting a hand-derived expected
string the way an earlier, passing-but-wrong version of this same test did.
Frontend: `LinkToObject` added to `ConnectorKind` (`types/index.ts`), a new
palette icon (`wireKindIcon.ts`, a short line plus a filled triangle
arrowhead) and `WIRE_KIND_LABELS` entry (`ElementsPanel.tsx`) put an
"Object link" button in the Elements panel's own "Wires" section alongside
Buswork/Overhead line/Cable line — arming it and drawing a route with the
click-to-route tool now produces a real `LinkToObject` connector the same
way the other three kinds already work, with no special-casing needed
elsewhere (it taps/targets/reroutes exactly like an ordinary Buswork
connector; only its own rendering differs). i18n keys added to both
`en.ts` ("Object link") and `ru.ts` ("Связь с объектом"). Verified live in
an isolated instance (backend :8099, frontend :5183 — the user's own
:8090/:5173 dev servers were left untouched throughout): placed two
Breakers, armed Object link, drew a route from one's terminal to the
other's — the heavy black line and its arrowhead rendered with the
arrowhead's apex landing exactly on the target terminal, pointing in the
direction of the route; selecting the connector highlighted it and showed
the expected Properties fields (Name/Voltage class/ID/Delete, no Kind
field, matching every other connector kind); saved and reopened the
diagram to confirm the XML round-trip persists `kind="LinkToObject"`
verbatim rather than falling into the legacy `"ObjectLink"`-rewrite path.

2026-09-18: A freshly drawn Object link connector now gets an
auto-generated Name ("Object link-12"), matching Overhead line/Cable
line's own existing convention — added `LinkToObject: 'Object link'` to
`diagramOps.ts`'s `NAMED_CONNECTOR_KIND_LABEL`. Unlike Overhead line/Cable
line, this Name is editor-only bookkeeping: a real xsde2svg Object link
instance (`element_28.go`) never carries a `data-name` attribute the way
an Overhead/Cable line does (`writeNamedLine`'s own `<g id data-type
data-name data-voltage>` wrapper), so `writeObjectLink` still never reads
`Connector.Name` back out — it only shows up in Properties and round-trips
through the saved XML.

2026-09-18: Power transformer (shape 47) rebuilt into a full nameplate/
winding properties model, at the user's own request quoting a detailed
real-world requirements list (designation, autotransformer flag,
2/3/4-winding, per-winding voltage/connection scheme/neutral grounding/
regulation/terminal orientation, vector-group label) and asking that it
"use all from element_47.go" — the real xsde2svg source, ~835 lines of
procedural geometry. Read that source end to end and cross-checked it
against 105 real Power transformer instances across 9 `sld-viewer` corpus
files, plus a dedicated `xsde2svg/examples/test/{xsde,svg}` test suite
covering autotransformer/4-winding/connection-scheme/size variants with
real input-XML/output-SVG pairs — this is what made confidently
implementing the autotransformer and 4-winding cases possible at all
(0 of the 105 corpus instances were autotransformers, so without that
second test suite they'd have shipped unverified). Old v1 support (a
single hardcoded 2-winding wye/wye base.xml template, `parsePowerTransformer`
capped at exactly 2 leads) is replaced by a fully procedural renderer,
matching how `writeObjectLink`/connector kinds already work rather than
template substitution — `renderElement` now special-cases
`ClassPowerTransformer` the same way it already does `ClassBusBarSection`,
bypassing the template lookup entirely (base.xml's own shape-47 template
is kept, but only for the Elements panel's own static preview icon).

New `slddoc` types: `WindingScheme` (wye/wyeN/delta — the three real
`TransformerWinding.WindingType` values with an actual connection glyph in
element_47.go; rarer ones like zigzag/open_delta aren't offered),
`NeutralGrounding` (solid/isolated/resistor), `TerminalDirection`
(top/bottom/left/right), and `TransformerWinding` (voltage/scheme/
grounding/tapChanger/terminal) — `Element.Windings []TransformerWinding`
(length = winding count), `Element.Autotransformer bool`, and
`Element.VectorGroupLabel string` round out `Element`. Several of these
are this editor's own deliberate simplifications over the real source,
each a considered tradeoff rather than an oversight:
- `TerminalDirection` replaces real xsde2svg's own opaque `Chassis` 1-7
  switch (leg direction tied combinatorially to winding index/count/
  mirroring) with a clean per-winding "pick a side" control — every leg
  now draws at one consistent length (13 units) regardless of direction,
  rather than porting the real source's differing h/hLegs/hLegsTop
  constants per position.
- The real `Size` 11-24 magic lookup table (named presets silently
  overriding baseRadius/hLegs/hLegsTop) isn't ported at all — every
  transformer always uses the true `sde.Size==0` default geometry
  (confirmed against the source directly, since most of the real corpus
  turned out to use non-default Size presets and so couldn't serve as a
  default-path reference — one corpus instance was traced to Size 24's own
  override to explain why its own hLegs/hLegsTop didn't match the naive
  default assumption at first).
- A 2-real-winding autotransformer needs only 2 `Windings` entries here,
  each with a real circle — real xsde2svg's own convention is 3
  `TransformerWinding` entries for a WindingNo=3 autotransformer, the
  first never drawn as a circle at all (only supplying the tap
  decoration's own color). Reusing that would force this editor's own
  Properties UI to always show one more winding than physically exists.
  `writeAutotransformerTap` instead draws a simplified tap stub+arc
  directly on `Windings[0]`'s own real circle.
- The real source's regulation arrow is drawn with a literal no-op
  `translate(0,0)`, so it never actually rotates with its own transformer
  even when Orient is 90/180/270 (confirmed by reading the source — this
  reads as an unintentional quirk, not deliberate). This editor's own
  arrow is drawn inside the same rotated `<g>` as everything else, so it
  rotates naturally with the symbol — a deliberate improvement over the
  source, not a byte-for-byte port.
- `GroundingIsolated`/`GroundingResistor` get invented marks (a small ring;
  a resistor zigzag) next to the wye-with-neutral glyph's own neutral
  spoke — real xsde2svg has no glyph for either state at all, only for
  `GroundingSolid` (its own "neutral_ground" WindingType, its own separate
  ground-hatch marks, approximated here with a plain IEC earth pictogram
  rather than ported stroke-for-stroke). The choice to invent marks for
  all three rather than leave two of them visually identical was the
  user's own, after being told the real source draws no distinction.
- "Show connection diagram label" is a plain freeform text field, not an
  auto-computed string — real xsde2svg never computes a vector-group
  label like "Yn/Δ-11" anywhere, and the schema's own `<TransformerWinding>`
  elements carry no phase-displacement/clock-hour data to compute one
  from even in principle (confirmed by reading the real `.xsde` test
  files directly), so there's nothing to derive it from.

A real regression was caught during live verification and fixed before
this shipped: `Windings`' own `xml:"windings>winding,omitempty"` tag hit
the same long-standing `encoding/xml` limitation `Element.Points`
("geometry>point") was already worked around for (golang/go#4256 —
omitempty is silently ignored for a chained "parent>child" tag) — every
*non*-transformer element was briefly saving a meaningless empty
`<windings></windings>` wrapper (caught by opening a saved diagram's own
XML and finding it on a plain `Breaker`). Fixed by adding `windings` to
`model.go`'s existing `emptyPathWrapperLine` regex (the same mechanism
`geometry` already used), with a new assertion added to
`TestSave_OmitsEmptyPathWrapperTags` guarding against a repeat.

Frontend: `frontend/src/types/index.ts` mirrors the new slddoc types;
`diagramOps.ts` gets `powerTransformerDefaults` (a freshly placed
transformer starts 2-winding wye/wye, matching the palette icon's own
static preview) and a from-scratch TypeScript port of the backend's own
winding-offset/default-terminal/leg-endpoint math
(`transformerWindingOffset`/`defaultTransformerTerminal`/
`transformerLegEndpoint`, hand-kept in sync with render.go's own constants
of the same name) — `symbolTerminals` now special-cases
`ClassPowerTransformer` to compute its own per-instance terminal positions
this way instead of the static per-shape `Symbol.Terminals` every other
class uses, since a transformer's own terminal count/positions depend on
its own Windings, not anything base.xml can declare once per shape;
without this, the click-to-route tool would only ever find a
transformer's own bare center anchor as a connection target. The
Properties panel gets a full winding editor (Autotransformer checkbox,
Number-of-windings selector that grows/shrinks the Windings array, one
`WindingEditor` block per winding with Voltage class/Connection scheme/
(wyeN-only) Neutral grounding/Terminal orientation/Regulation checkbox,
and the vector-group checkbox+text field) plus matching i18n keys in both
`en.ts` and `ru.ts`.

Verified live in an isolated instance (backend :8099, frontend :5183 —
the user's own :8090/:5173 dev servers were left untouched throughout, as
in every prior shape's own verification this session): placed a
transformer (2-winding wye/wye default), confirmed its own terminal
markers render at the correct dynamic positions and a Buswork route drawn
from one to a nearby Breaker created a real Port/Node/Connector, correct
in the saved XML down to the exact expected coordinates; grew it to 3
windings live and confirmed the new top/right/left circles and their own
default terminals render correctly; enabled Autotransformer and a
winding's own Regulation checkbox and confirmed the tap decoration and a
single centered regulation arrow both rendered; set a winding to
Star-with-neutral plus Isolated grounding and confirmed the invented ring
mark rendered next to the wye-with-neutral glyph; checked "Show connection
diagram label," typed "Yn/Δ-11," and confirmed it rendered as a text label
under the symbol; saved, reloaded the diagram fresh, and confirmed every
field (Autotransformer, all three Windings' own Scheme/Grounding/
TapChanger, VectorGroupLabel, the drawn connector) round-tripped exactly,
and that the Breaker element's own saved XML carried no `<windings/>`
regression.

2026-09-18: Power transformer extraction/Properties bug fixes, reported by
the user against a real corpus diagram (`diagrams/PS_110kV_Valdai.xml`,
whose own already-extracted `PowerTransformer` elements carry 2 or 3
`<port>` entries each but no `<windings>` tag at all — exactly what these
fixes address):
- **`parsePowerTransformer` never populated `Element.Windings` at all**,
  only `Ports` — and `writePowerTransformer` derives its own drawn circle
  count from `len(Windings)`, not `len(Ports)`, defaulting to 2 whenever
  it's empty. A real 3-winding transformer therefore silently re-rendered
  as 2-winding after every import, regardless of how many real leads
  extraction had actually found. Fixed: `Windings` now always has one
  entry per real lead.
- **Per-winding voltage color was never resolved into a `VoltageClass`
  id.** Each real xsde2svg winding circle already carries its own
  `data-voltage` color (confirmed straight from `element_47.go`'s own
  `canvas.Circle(..., dataVoltage)` call) — `extract.go` gets a new
  `windingColors` side-channel (parallel to the existing
  `elementVoltage`/`connectorVoltage` one) so each winding's own raw color
  now participates in `buildVoltageClasses` and resolves to its own real
  class id, the same as every other shape's single color already did.
- **Connection scheme (wye/wyeN/delta) is now recovered from the glyph
  geometry** already present in real markup — matched structurally (three
  2-point subpaths / four 2-point subpaths / one closed 4-point subpath),
  not by exact coordinates, since a real instance's own shift constant can
  vary with its `Size` preset. Only the one path slot immediately
  following a winding's own lead is ever inspected, which is what keeps a
  regulation arrow's own closed-triangle arrowhead — the same "one
  subpath, four points, closed" shape a delta glyph has — from being
  misread as the last winding's own delta scheme.
- **Autotransformer is now recovered too**, from the one reliable signal
  real xsde2svg's own markup gives without a dedicated attribute: its tap
  arc+stub for the (uncircled) first winding entry is drawn *before* the
  transformer's first `<circle>` at all.
- **A transformer at 0° (no `rotate()` transform at all — real xsde2svg
  omits it, same as every other shape)** previously failed extraction
  outright (`parsePowerTransformer` required a `rotate()` match
  unconditionally, unlike `parseTwoPortDevice`/`parseOnePortDevice`, which
  already handle a missing one). Fixed the same way those two do: when no
  `rotate()` is present, the untransformed anchor is now recovered by
  reversing `transformerWindingOffset` against the first circle's own
  absolute center once the real winding count is known.
- **Properties' own per-winding Voltage class `<select>` was silently
  broken** for any option that was a server preset not yet on the diagram
  (`voltageClassOptions`' own `"preset:<name>"` values) — `WindingEditor`
  called `Number(e.target.value)` directly instead of going through
  `diagramOps.resolveVoltageSelection` the way the plain Element/Connector
  Voltage class selects already do, so picking a preset silently stored
  `NaN` and the field appeared to do nothing. `WindingEditor` now takes a
  separate `onVoltageChange(rawValue)` prop wired through
  `resolveVoltageSelection`, same pattern as everywhere else.

New regression tests: `TestExtract_PowerTransformerAutotransformerAndVoltages`
(real `xsde2svg/examples/test/svg/Test_47_AutoTransformer2-1.svg` markup,
run through the full `Extract()` pipeline — checks winding count,
Autotransformer, and that each winding's own distinct color resolves to
its own distinct voltage class) and
`TestParsePowerTransformer_SkipsTrailingDecoration`'s own assertions
extended to cover scheme detection; `TestParsePowerTransformer` extended
to check colors/schemes/Autotransformer on its own existing fixture.

Known remaining gap, not fixable by better geometry-matching alone (see
`parsePowerTransformer`'s own doc comment): which winding has TapChanger
set, and a wye-with-neutral winding's own NeutralGrounding, aren't
recovered from rendered markup at all — genuinely closing these would mean
adding dedicated `data-*` attributes to xsde2svg's own SVG output
(`data-autotransformer`, `data-tap-changer`, `data-winding-type`), a
cross-repo change discussed but not yet started.

2026-09-18: `parsePowerTransformer` extraction made robust against real
document-order quirks, found by the user comparing a real xsde2svg
rendering byte-for-byte against this package's own extract-then-render
round trip on the same source file
(`xsde2svg/examples/test/svg/Test_47_AutoTransformer3Text.svg`) and
noticing a visibly different third winding:
- **A strict "circle, then its own trailing lead" document-order grouping
  was wrong.** Real xsde2svg's own `element_47.go` (its case-3 branch, the
  last real winding of a `WindingNo==4` autotransformer) draws that one
  winding's own leg *before* its own `<circle>`, unlike every other
  winding of every other shape. The previous grouping silently
  under-counted that winding's own real lead entirely and misread the
  next real lead as a (non-matching, discarded) connection-scheme glyph
  instead — exactly the "different autowinding curve" the user spotted.
  Replaced with a two-pass, distance-based match instead: every
  lead-shaped candidate `<path>` in the whole element is collected first,
  then assigned to whichever `<circle>` its own start point is closest to
  (a lead always starts within about one radius of its own circle's own
  edge) — correct regardless of document order, not just for this one
  known quirk.
- That same distance-based matcher initially mis-bound leads on some real
  instances by including an autotransformer's own tap arc+stub as a lead
  candidate too (its own endpoint can land closer to a winding's circle
  than that winding's real lead does) — fixed by excluding every
  candidate before the transformer's first `<circle>` (already the same
  signal Autotransformer detection uses) from lead-candidate
  consideration entirely.
- The lead-to-circle distance threshold was also hardcoded to this
  package's own default `transformerRadius` (22), rejecting a real
  instance found using a much larger real `Size` preset (radius 62,
  nearly 3× the default) as "too far to be a real lead." Now scales with
  each candidate circle's own real `r` attribute instead of a fixed
  constant.
- Verified by running `Extract` against every real corpus `.svg` file
  under both `sld-viewer/assets/sld` and `xsde2svg/examples/test/svg`
  (105+ real Power transformer instances, including the file that
  surfaced this bug — all 51 of its own 3-real-winding autotransformers
  now extract with the correct winding count and no `report.Failed`
  entries). Two categories of real corpus instance remain genuinely
  unsupported, both pre-existing limitations rather than new regressions:
  a real single-winding transformer (`WindingNo==1` — this package, like
  its own v1 predecessor, only ever supported 2-4), and a handful of
  extreme-miniature-icon test instances whose own circles (radius 2-4
  units) sit so close together that "nearest circle" genuinely can't
  disambiguate which lead belongs to which winding.

Also, at the user's own request ("fit/align transformer nodes/connectors
to the grid 10x10"): a transformer's own extracted anchor and each
winding's own extracted lead tip are now snapped to this editor's own
10-unit default grid (`EditorSettings.GridSpacing`'s own default).
Real xsde2svg source diagrams place an element's own anchor on a grid
this fine almost universally already, but a lead tip's own position is
derived from that anchor by fixed, non-grid-multiple internal offsets
(`transformerRadius`, the leg-length/shift constants, ...), so it
essentially never lands on the grid on its own even when the anchor does.
The resulting shift (at most half the grid spacing, so ≤5 units here) is
well within `topology.go`'s own existing `snapTolerance` — its own doc
comment already specifically cites "observed on a PowerTransformer's
leads" as the reason that 5-unit connectivity tolerance exists at all —
so this doesn't risk a wire failing to bind to its own newly-snapped
port.

New regression tests: `TestExtract_PowerTransformerLeadBeforeCircle` (the
real lead-before-circle markup, checking the third winding's own lead
lands on the third winding, not discarded as a false glyph on the
second); manual, ad hoc full-corpus verification runs (not checked in as
tests, since they read real files from sibling repos outside this
module) confirmed the fix and the grid-snap change against every real
`.svg` file in both corpora.

2026-09-18: A *freshly placed* (not just extracted) PowerTransformer's own
lead tips now land on the 10-unit grid too — the user's own screenshot
showed a hand-placed transformer connected to a Breaker producing a short
non-orthogonal jog right at the transformer's own terminal, since its
anchor was grid-snapped (the editor's own generic click-to-place snap,
same as every other shape) but the lead tip itself wasn't: it's computed
as anchor + a fixed offset (transformerXShift/TopShift/SideShift/
VertShift) + transformerRadius(22) + one shared leg length (13), and
none of that combination was a multiple of 10.

`transformerLegLength` (`render.go`) replaces the old flat 13-unit
constant with a value chosen *per winding position* (8, 9, 10, or 13,
depending on winding count and index) so that
offset+transformerRadius+length is always an exact multiple of 10 for
that winding's own default TerminalDirection — e.g. a 2-winding
transformer's own legs now measure 10 units (18+22+10=50) instead of 13
(18+22+13=53); a 3-winding one's own top winding still measures 13
(25+22+13=60, already a coincidental multiple of 10) while its own
side windings drop to 10; a 4-winding one uses 8/10/9/9 for its own
top/bottom/left/right windings. `diagramOps.ts`'s own TypeScript mirror
(`transformerLegLength`) was updated to match by hand, the same way its
sibling functions already are. A winding whose own Terminal is
explicitly overridden away from its own default direction can still land
off-grid on the axis perpendicular to its own chosen direction (that axis
inherits the winding's own raw, non-grid-multiple position offset
instead) — a real but narrower residual gap than the one this fixes,
matching the same caveat already noted for extraction's own grid-snap.

While auditing every shape's own base.xml `<terminals>` for the user's
own broader "every element's connectors, regardless of source, should
land on the grid" request, found that every other shape's own declared
terminal offsets already are exact multiples of 10 — except Fuse
(withdrawable, shape 154), whose own terminals sit at y=±31 to match a
real xsde2svg chevron-tip position exactly (documented in base.xml's own
comment there). Left as-is rather than rounding to ±30, since unlike
PowerTransformer's own from-scratch geometry, base.xml's declared value
is a deliberate real-source match, not an accidental one — flagged here
rather than silently changed, in case the 1-unit-off grid alignment
still matters enough to trade that fidelity away.

Verified live in an isolated instance (backend :8099, frontend :5183 —
the user's own :8090/:5173 dev servers were left untouched throughout):
placed a fresh 2-winding transformer and a Breaker from the palette,
drew a Buswork route between them, and confirmed the routed wire is
fully orthogonal with no jog at either end — the saved XML's own Node
for the transformer's own lead landed at exactly anchor+50 on both axes,
an exact multiple of the diagram's own 10-unit grid.

Updated regression tests (`TestRender_PowerTransformer2Winding`,
`...3WindingAutotransformer`, `...4Winding`) to assert the new
per-position leg lengths directly, rather than only checking circle
positions.

2026-09-18: An autotransformer's own tap arc now ends in a real,
connectable terminal — the user pointed out (with a real xsde2svg
reference image and a genuine source snippet, `<path d="M 450 80 a 40 40
0 0 1 41 40" .../><path d="M 450 68 v 12" .../>`) that the arc must end
with a connector; until now `writeAutotransformerTap`'s own stub+arc was
pure decoration with no terminal at all, so a wire could never actually
be drawn to it, even though a real autotransformer's own tap point is a
genuine, separate electrical connection (real xsde2svg source models it
as its own `TransformerWinding` entry, distinct from every circle-drawing
one — see `writeAutotransformerTap`'s own doc comment, already updated
for this shape's earlier work, for why this package still doesn't add a
matching extra `Windings` entry for it).

New `transformerTapOffsetY` (`render.go`, `-50`): the tap's own real
terminal, always directly above the transformer's own *anchor* (local
x=0) — not `Windings[0]`'s own circle position, which the real source's
own tap isn't anchored to either (confirmed by reading `element_47.go`'s
own `isAutoTrans` `i==0` branch: its own `dX`/`dY` default to 0 regardless
of which real winding ends up at `Windings[0]`). Anchoring the terminal to
the anchor rather than the circle is also what keeps it grid-aligned by
construction for every winding count, including a 2-winding
transformer's own `Windings[0]` (`dX=18` — not itself grid-safe on its
own). `writeAutotransformerTap` now draws a short stub down to the
terminal's own connection point, then a real SVG elliptical arc curving
from there to `Windings[0]`'s own circle edge — radius derived from the
horizontal distance to that circle (floored at 20 so a directly-below
target, e.g. a 3/4-winding transformer's own top-positioned `Windings[0]`,
doesn't collapse into a degenerate zero-width arc), sweep direction
mirroring which side the circle sits on.

`diagramOps.ts`'s `transformerLocalTerminals` gets a matching
`TRANSFORMER_TAP_OFFSET_Y` and appends this same point (only when
`el.autotransformer` is set) after the per-winding leads — without this,
the click-to-route tool would still never find the tap as a valid
target, even with the backend now drawing it correctly, since terminal
hit-testing is computed independently on the frontend.

New test `TestRender_PowerTransformer2WindingAutotransformerTap` checks
the terminal's own exact position and the arc's own endpoint/sweep for
the 2-winding (off-center `Windings[0]`) case specifically, since that's
the one that actually exercises the anchor-vs-circle distinction; the
existing 3-winding autotransformer test's own assertions were updated to
match the new stub+arc shape.

Verified live in an isolated instance (backend :8099, frontend :5183 —
the user's own :8090/:5173 dev servers were left untouched): enabled
Autotransformer on a fresh 2-winding transformer, confirmed a real red
terminal marker now renders at the tap's own stub tip (matching the
reference screenshot's own convention), drew a Buswork route from it,
and confirmed the saved XML carries a real `<port>`/`<node>` at exactly
anchor+(0,-50) with a real `<connector>` attached — not just a
decoration.

2026-09-18: Tap arc visual polish, from the user's own hand-annotated
screenshot of the previous version's own tight, awkward loop: drawn at
`stroke-width:1` (thinner than every regular winding lead's own `2`,
making it read as a lesser/decorative line rather than a real electrical
one) and landing dead-center on `Windings[0]`'s own circle top via a
small, distance-floored radius that produced a cramped loop rather than a
smooth curve, especially for an off-center winding (the 2-winding
default, `dX=18`).

Fixed both in `writeAutotransformerTap`: the stub+arc now draws at
`stroke-width:2`, matching every regular lead; and the arc's own radius
is now a fixed, generous 40 units (matching real xsde2svg's own `r3`
constant for this same decoration, rather than this package's own
ad hoc distance-based floor), landing on a point 50° around
`Windings[0]`'s own circle rim — offset toward whichever side the circle
sits on, not dead-center-top — for a broad, natural-reading sweep instead
of a tight loop, closer to both the user's own hand-drawn reference curve
and real xsde2svg's own visual style. New/updated assertions in
`TestRender_PowerTransformer2WindingAutotransformerTap` and
`...3WindingAutotransformer` check the new stroke-width and the arc's own
exact landing coordinates for both the off-center (2-winding) and
directly-above (3-winding top winding) cases. Verified live in an
isolated instance (:8099/:5183, the user's own :8090/:5173 dev servers
untouched) that the new curve reads as a smooth, natural sweep rather
than the earlier version's own cramped loop.

2026-09-18: A winding's own connection-scheme glyph (and its grounding
mark) no longer rotates along with the rest of the transformer when its
own Orientation is changed, at the user's own request. Real electrical
leads/circles still rotate normally — only the Y/Δ/Yn glyph itself now
stays visually upright, the same `{counterRotate}` idea already used
elsewhere in this codebase (a FaultPassageIndicator's own "FPI" label
inside its base.xml template), reimplemented directly in `writePowerTransformer`
since a transformer has no template to add a placeholder to: the glyph
(plus its own grounding mark, when present) is now wrapped in a
`<g transform="rotate(-Orient,cx,cy)">`, canceling the outer `<g>`'s own
`rotate(Orient)` for anything drawn at an offset from the winding's own
circle center, while the center itself — the rotation's own pivot — is
untouched and still moves with the winding exactly as before. Omitted
entirely (no wrapper `<g>` at all) when Orient is 0, so the common case
emits no extra markup.

New `TestRender_PowerTransformerGlyphStaysUprightWhenRotated` checks the
wrapper's own exact transform string, and — rather than trusting that
string is correct by construction, the same lesson learned from an
earlier bug in this shape's own regulation-arrow rendering — independently
recomputes a wye glyph's own first spoke tip through both composed
rotations by hand and confirms it lands exactly on the winding's own
global circle center plus its own *unrotated* local offset. Verified
directly against the render API (`POST /api/render`) with a 90°-rotated
2-winding transformer: the circles/legs rotate with the transformer as
expected, while each winding's own Y/Δ glyph renders inside its own
counter-rotating `<g>`, keeping the glyph itself upright.

2026-09-18: Production build — a single self-contained binary per (OS/
arch, locale) combination, with the frontend's own already-built
production bundle embedded directly into the Go binary via `go:embed`,
so a deployment needs no separate static file host, reverse proxy, or
Node runtime at all — just the one binary and a config file. Day-to-day
development is untouched: `npm run dev`/`dev:ru` from `frontend/` and
`go run ./cmd/sld-editor` from `backend/` work exactly as before.

New `backend/internal/webui` package: `//go:embed all:dist` embeds
whatever's currently in its own `dist/` directory. Since `go:embed`
can't pick a directory at build time based on which locale is wanted,
the build script instead copies the desired locale's already-built
frontend (`frontend/dist-en`/`dist-ru`) into this fixed `dist/` path
immediately before invoking `go build` — this package always embeds
"whatever's currently there." A committed placeholder `dist/index.html`
keeps `go build`/`go vet`/`go test` (and a plain `go run`) working
outside that build script, where `dist/` was never populated with a real
frontend at all — confirmed live: a plain `go run` still starts and
serves the placeholder, `/api/*` routes unaffected.

`internal/api/server.go` wires the embedded filesystem in via
`router.NoRoute`, not a Gin route pattern, since Gin's own routing tree
doesn't cleanly let a wildcard static mount coexist with the sibling
`/api` route group registered above; NoRoute still returns a JSON 404 for
an unmatched `/api/*` path specifically, rather than silently falling
through to the frontend's own `index.html` for a broken API call. No SPA
fallback routing was needed — the frontend has no client-side router of
its own (confirmed by checking for one), so a plain `http.FileServer`
already serves `index.html` correctly for `/` and the JS/CSS asset paths
correctly for everything else.

New root `Makefile`: `make linux`/`make windows`/`make macos` (or
`make all` for all three), each producing both an `-en` and `-ru`
binary; `make macos` builds both `arm64` and `amd64`. sld-editor has no
cgo dependencies, so every target cross-compiles natively via
`GOOS`/`GOARCH` — no Docker required for that part, though `docker-build`
(Linux/Windows targets only — a Linux container's own Go toolchain can't
codesign a macOS binary) runs the same Makefile inside a pinned
Go+Node container via `Dockerfile.build`, for anyone who'd rather not
install either locally. Every native target's own recipe also mounts
the sibling `../../slddoc` checkout `backend/go.mod`'s own `replace`
directive already requires for ordinary development — `docker-build`
bind-mounts this repo's own *parent* directory specifically so that
relative path still resolves correctly inside the container.

A real bug was caught and fixed while building this Makefile itself:
GNU Make only runs a given `.PHONY` target's own recipe once per
top-level `make` invocation, even when several sibling targets list it
as a prerequisite — so `make all`'s own `windows-en` target silently
ended up embedding whichever locale's frontend build had run *last*
(Russian, from `linux-ru`) instead of its own English one, since its own
`frontend-en` prerequisite was considered "already satisfied" from
`linux-en`'s earlier run in the same invocation. Caught by grepping the
compiled binaries for a locale-exclusive UI string and finding English
and Russian text in the *same* binary — first with a flawed check
(`strings`, which doesn't reliably extract multi-byte UTF-8 like
Cyrillic, and an English marker that turned out to also appear in the
Russian bundle), then confirmed properly with a byte-safe `grep -a`
against a marker independently verified absent from the *other* locale's
own real build output first. Fixed by having every locale/OS/arch
target's own recipe invoke `$(MAKE) frontend-en`/`frontend-ru` as its own
first step — a recursive `$(MAKE)` call is its own fresh invocation with
its own once-per-target bookkeeping, so it reliably reruns every time,
rather than listing the frontend target as an ordinary shared
prerequisite. Verified by rebuilding all 8 binaries (2 locales × 4
platforms) from scratch and confirming each one's own locale-exclusive
marker is present and the *other* locale's own marker is absent, and by
actually running the native `macos-arm64-en` binary end to end (isolated
port, the user's own dev servers untouched) — API calls, and the real
UI loading in a browser — from that one binary alone.

2026-09-18: Save/load a diagram directly to/from the user's own machine,
independent of the server's own diagrams directory. Backend: three new
endpoints alongside the existing `/api/render` (all operate on the posted
diagram JSON directly, not a name in server storage, so they work on the
current in-memory — possibly unsaved — diagram): `POST /api/export/xml`
(raw XML via `slddoc.Diagram.Save`), `POST /api/export/svg` (raw
Static-mode SVG, the same xsde2svg-faithful rendering the on-disk `.svg`
gets, not the canvas's own Interactive markup), and `POST /api/import/xml`
(raw XML body -> parsed diagram JSON via `slddoc.Load`, 400 on malformed
XML). Frontend: `FilePanel`'s new "Export" section (Download XML/Download
SVG — a client-side blob download, no navigation away from the app) and
"Import" section (a "Load from file…" picker restricted to `.xml`), plus a
window-wide drag-and-drop zone (`App.tsx`'s `Shell`, with a visual overlay
while dragging) so a `.xml` file can be dropped anywhere in the app, not
just onto a specific control. Both routes into the app funnel through one
new `DiagramContext` action, `loadDiagramFromXML` — parses via the new
import endpoint, runs the result through the same `ensureLastId` backfill
`openDiagram` already applies, and makes it the working diagram (named
after the source file, marked dirty so Save persists it server-side under
that name — the same upsert semantics Save As already has, not a separate
"import" concept the rest of the app needs to know about). New i18n keys
in both `en.ts`/`ru.ts`. Verified: a Go test round-trips export XML ->
import XML end to end and checks both export content types; live browser
verification against an isolated instance (the user's own dev servers
untouched) confirmed the File panel's buttons render/enable correctly,
Download XML/SVG each fire their own request and return 200 with no
console errors, and picking a file through the hidden file input
(drag-and-drop's own event simulation isn't reachable through the
available browser automation tools, but it shares the same
`loadDiagramFromXML` code path the file-picker button already exercised)
correctly loads it as a new, dirty, correctly-named working diagram with
its element rendered on canvas.

2026-09-18: Graceful shutdown for the backend, since it's a long-running
service (systemd unit, Docker container, etc.), not a one-shot script —
being killed mid-request previously just dropped the connection.
`api.Server.Run` now takes a `context.Context` and builds its own
`*http.Server` (instead of Gin's own `router.Run`, which blocks on
`http.ListenAndServe` directly with no way to call `Shutdown`): on context
cancellation it calls `Shutdown`, letting any in-flight request finish (up
to a 10s `shutdownTimeout`) before returning, rather than aborting it.
`main.go` derives that context with `signal.NotifyContext(...,
os.Interrupt, syscall.SIGTERM)`, so both Ctrl-C and a `kill`/systemd
stop (SIGTERM) now shut the process down cleanly instead of the OS just
tearing down open connections. `Run` had exactly one caller (`main.go`),
so this was a contained signature change. New test:
`TestRun_GracefulShutdown` starts the real server on a free port, confirms
a request succeeds, cancels the context, and asserts `Run` returns
(without error) within the shutdown timeout and the port stops accepting
new connections afterward. Also manually verified against a real built
binary: sent it a real `SIGTERM` and confirmed the "sld-editor shut down"
log line and a clean process exit, on an isolated port, the user's own dev
server untouched.

2026-09-18: Elements palette category headings and per-element names are
now translated in the Russian build — previously they were the bundled
`backend/assets/elements/base.xml` catalog's own raw English `name`/
`category` XML attributes, shown as-is regardless of locale, since they
come from the backend's `/api/elements` response rather than through the
frontend's own build-time i18n dictionary at all. New dictionary keys,
`elementCatalog.name.<shape>` (per-symbol; two shapes can share a `class`
but never a `shape`, so this is a safe stable key — e.g. `Breaker` (41) vs
`Breaker (withdrawable)` (43) both being `class="Breaker"`) and
`elementCatalog.category.<category>` (there are 10, e.g. `Switching
devices` -> `Коммутационные аппараты`), added for all 29 bundled shapes in
both `en.ts`/`ru.ts` — `ru.ts`'s own `Record<keyof Dictionary, string>`
typing means a 30th bundled shape added later without its own Russian
translation is a compile error, same guarantee every other UI string
already has. A new `lib/elementCatalogI18n.ts`
(`elementDisplayName`/`categoryDisplayName`) and `i18n/index.ts`'s new
`tOrFallback` helper look these up by a runtime-built key (not a literal
`TranslationKey`, since the shape comes from server data) and fall back to
the server's own raw string unchanged when no key matches — which is what
happens for anything from a site's own config-added element library file
(`elements.libraries` in config): this app's own translations were only
ever going to cover the bundled default catalog, and a site adding its own
equipment shapes gets its own raw label rather than a build error. Wired
into `ElementsPanel.tsx` (category headings, each palette button's own
label/tooltip, and the "click the canvas to place a {{name}}" armed hint)
and `PropertiesPanel.tsx` (the "TypeName:shape" label shown above a
selected element's own editable Name field) — deliberately *not* into
`diagramOps.placeElement`'s own default-name generator
(`` `${symbol.name}-${id}` ``, which stays the raw English catalog name),
since that becomes the persisted `Element.Name` written to the diagram's
own XML, and a diagram saved under one locale's build should read
identically when later opened under the other's, not have its actual data
follow whichever locale happened to place it. Verified: both `build:en`
and `build:ru` type-check clean (confirming `ru.ts`'s exhaustiveness
check), and a live browser pass against an isolated Russian-locale
instance (the user's own dev servers untouched) confirmed every one of
the 10 category headings and all ~29 element labels render in Russian
with no leftover English, the armed-hint interpolates the Russian name
correctly, the Properties type label shows the Russian name while the
underlying persisted `Name` field correctly stays the raw English
`"Breaker-1"`-style default, and no console errors.

2026-09-21: Sectionalizer (shape 164) added to the Switching
devices palette — a two-terminal device drawn as a fixed pivot rod plus a
small pointer arm+arrowhead that swings between Open and Close, geometry
initially reverse-derived from the real xsde2svg source
(`internal/modus/element_164.go`) and cross-checked against a real
corpus-rendered instance, but Open's own final look was changed at the
user's own explicit request/reference icons: the real source's own rod
replaced by a short stub near the top terminal (rather than the same
full-length rod merely tilted) reads wrong for this device, so Open
instead tilts the same full-length rod to a diagonal, pivoting at the
bottom terminal — this template's own original Intermediate option, before
the device was found to have no real Intermediate state at all (below).
The bottom terminal's own fixed tick — present for Closed — is replaced by
a small circle marking that pivot point for Open, since the blade
physically rotates around it; this part *is* kept from the real source
(top tick unaffected either way). The real
source's Closed/Open toggle is a pair of visibility-swapped `<g>` groups, a
mechanism this project doesn't use elsewhere — folded instead into the
existing single-path `{state:closed|open|other}` convention every other
switching device here already uses; unlike every other switching device
here, this one has no real Intermediate position at all, so its own
"other" option is deliberately just a copy of "open" (an Intermediate
State value reads as Open, not as some invented third position) and
Properties' own State dropdown (`PropertiesPanel.tsx`'s new
`TWO_STATE_CLASSES`) offers only Open/Close for this class, not the
Open/Close/Intermediate every other switching device gets. The real
source's xMirror flag
and its `sde.Distance`-driven leg extension (external busbar-spacing
dependent) were both dropped — this schema has no equivalent for either,
the same simplification every other ported shape already makes; terminals
sit at (0,±10), matching where that leg would have attached anyway.
`Extract` support was added too (`parseSectionalizer`, shared `slddoc`
module): State is read from whichever of the real source's two
visibility-swapped `<g data-state="0|1">` child groups is actually
visible. The two terminal points are derived as fixed (0,∓10) local
offsets from the element's own anchor rather than from raw path-point
extremes, since this shape's two states draw too differently from each
other (a full-length rod vs. a short swung-open stub plus an
open-contact circle) for a reliable "extreme points" source the way most
other two-port shapes get one — when a rotate() transform is present
(Orient != 0) its own center is that anchor, same as every other two-port
shape; when it's absent (Orient 0 — confirmed to be the common real-world
case, both of `PS_110kV_Lubnisa.svg`'s own Sectionalizer instances are
unrotated) a first attempt punted on this the same way Ground switch
(54)'s own `Extract` support does, but that turned out to drop both real
instances entirely (`Report.Failed`) — so `sectionalizerAnchorFromTick`
was added instead, deriving the anchor from the shape's own "top tick", a
fixed 10-unit segment identical in both states and always the topmost
point in whichever one's active. Regenerated `sld-svg/xml/
PS_110kV_Lubnisa.xml` and its `sld-editor/diagrams/` copy (both untracked/
gitignored, `svg-sld extract` re-run against the same source SVG) —
confirmed both Sectionalizer instances now extract as fully-connected
elements instead of being silently dropped. New `ClassSectionalizer`
constant (shared `slddoc` module, a separate sibling repo) plus a
`shapeName["164"]` entry for the rendered SVG's own comment; frontend
`ElementClass`/`SWITCHING_DEVICE_CLASSES`/`DEFAULT_CLOSED_CLASSES` updated
so it gets a State dropdown in Properties and defaults to Closed on
placement, like Breaker/Disconnector; i18n label added for both locales.
Verified live in the browser (placed from the palette, defaulted to Close,
Open/Close render distinctly correct, Intermediate now correctly renders
identical to Open) and via a direct `Extract` test against the real
corpus-example markup (both a Closed and an Open instance correctly
recover State and identical (1560,505)/(1560,525) terminal Nodes).

2026-09-21: A new `Mirror` property (shared `slddoc` module, a separate
sibling repo) — every ordinary templated element (everything `internal/
elements`' library covers, including the freshly-added Sectionalizer) can
now be flipped horizontally in its own local frame, independent of its own
Orient rotation, matching real xsde2svg's own xMirror concept (see
render.go's own `mirrorScale`: an extra ` scale(-1,1)` in the outer `<g
transform="translate(x,y) rotate(orient)...">`, applied before Orient's
own rotation via ordinary SVG transform composition order, the same way
real xsde2svg's own xMirror flips local x before its own Orient-driven
rotate()). `PowerTransformer` (shape 47), which renders through its own
separate path (`writePowerTransformer`) rather than template substitution,
gets the same `scale(-1,1)` on its own outer `<g>` too — mirroring the
whole transformer including its per-winding connection-scheme glyphs
(Y/Δ/Yn), a deliberate choice (simpler than preserving glyph orientation
under mirroring the way they already stay upright under rotation) rather
than an oversight. `BusBarSection` (shape 24) has no template of its own
(its geometry is its own drawn Points, already absolute) — Mirror is a
no-op there, same as Orient already is. Unlike Orient, `Extract` never
sets Mirror: a real xsde2svg-exported SVG bakes xMirror straight into
absolute path coordinates with no attribute of its own preserved in the
output (confirmed while investigating why `PS_110kV_Lubnisa.svg`'s own two
Sectionalizer instances render mirrored — xMirror there traces back to
either the equipment type's own catalog default or a per-instance
override in the original `.xsde` source, neither reconstructable from the
exported SVG alone) — so every already-extracted element simply defaults
to false/unmirrored, same as before this existed. Frontend:
`DiagramElement.mirror`, and `diagramOps.placeLocalPoint` (the shared
local-point-to-diagram-space math terminal markers/connection targets/
`elementBoxes` all go through) now flips local X before rotating when
`el.mirror` is set, matching the backend's own transform order exactly —
without this, a mirrored element's own terminal markers/hit-targets would
stay at their unmirrored positions while the rendered geometry itself
moved. A "Mirror" checkbox was added to Properties right below
Orientation, shown under the exact same condition (skipped for
BusBarSection, which shows its own Points editor instead, and for Lamp,
whose plain-circle template looks identical either way — same reasoning
Orientation itself already uses); i18n label added for both locales.
Verified live in the browser: a mirrored Sectionalizer's arm/arrowhead
correctly flip to the opposite side while its terminal markers stay
exactly on the (unmoved) rod; a 2-winding PowerTransformer with
Δ (winding 1) / Y (winding 2) correctly swaps which side each winding (and
its own glyph) renders on when mirrored, terminals included.

2026-09-21: `scripts/deploy.sh` — builds (`make linux-ru`) and deploys the
Russian-locale Linux build to the ctrlroom server (`root@192.168.20.23`,
key `~/.ssh/id_rsa_ctrlroom`): stops the `sld-editor` systemd service over
ssh, scp's `build/sld-editor-linux-ru` and `backend/assets/elements/
base.xml` into `/usr/lib/sld-editor/`, restores the executable bit scp
doesn't preserve, then restarts the service. `set -euo pipefail` so a
failed build or copy stops the script before touching the remote
service — a failed build in particular never gets as far as stopping it.
Host/key (`DEPLOY_HOST`/`DEPLOY_SSH_KEY`) name this specific deployment
target, so they're no longer hardcoded in the script at all — they live in
`scripts/.env` instead (gitignored, sourced automatically; `scripts/
.env.example` is the tracked template) and the script fails with a clear
message if neither `.env` nor the environment sets them.
`DEPLOY_REMOTE_DIR` stays an optional override with its own built-in
default (`/usr/lib/sld-editor`), same as before.

2026-09-21: Upgraded `vite` (`^5.4.21` -> `^8.3.0`) and `@vitejs/plugin-
react` (`^4.3.3` -> `^6.1.1`, the version that supports vite 8) in
`frontend/package.json`, fixing the two `npm audit` findings (both the
same underlying esbuild advisory, GHSA-67mh-4wv8-2f99 — dev-server-only,
not present in the production build's own output — that `vite@5.4.21`,
itself already the newest 5.x release, had no non-breaking fix for).
`npm audit` now reports 0 vulnerabilities. `vite.config.ts` needed no
changes (a plain plugin+server/proxy config, nothing version-specific).
Verified: `tsc --noEmit` clean, both `build:en`/`build:ru` succeed with no
new warnings, `npm run dev` starts cleanly and the app loads/renders/opens
a real diagram correctly against the live backend through Vite 8's own dev
server + proxy, no console errors.

2026-09-21: Every group in the Elements palette (`ElementsPanel.tsx`) is
now collapsible — the fixed Wires/Text sections and every dynamic
equipment category (Switching devices, Transformers, ...) alike, via a
shared `GroupHeader` (a clickable heading with a chevron that swaps
open/closed, `lucide-react`'s `ChevronDown`/`ChevronRight`) replacing each
section's own plain `<h3>`. Every group starts collapsed by default — the
component tracks which groups are *expanded* (`expandedGroups`, a
`Set<string>` keyed by 'wires'/'text'/the raw category string, starting
empty) rather than which are collapsed, so a freshly opened/loaded diagram
doesn't need to know the full list of category keys up front (they only
exist once `elements` has loaded from the backend) to default every one of
them closed. Not persisted anywhere — it resets to all-collapsed again the
next time the panel itself mounts, a deliberate simplification (a
session-only UI convenience doesn't need its own storage). Collapsing a
group doesn't touch
armedSymbol/armedWireKind/etc. — an element already armed from a group
that then gets collapsed stays armed, same as any other panel state.
Verified live in the browser: each group toggles independently, collapsing
one doesn't affect its neighbors, no console errors.

2026-09-21: `Extract` (shared `slddoc` module) no longer silently drops an
xsde2svg element it can't turn into a real Element/Connector — both an
unrecognized data-type (a `Report.Skipped` call site) and a recognized
data-type whose own specific instance failed to parse (a `Report.Failed`
one) now also get a red diagnostic `Label` in the extracted diagram, at
the user's own request, reading "Missing: `<name>` (`<code>`) #`<id>`" —
so a diagram author sees exactly where and what wasn't carried over
instead of an unexplained topology gap. New `missingElementAnchor` makes a
best-effort guess at the element's own position (its `rotate()`
transform's own center, then a descendant `<path>`'s own first point, a
`<circle>`'s own cx/cy, or a `<rect>`'s own center — checking the node
itself too, not just its descendants, since an untyped Rectangle/Circle
primitive isn't wrapped in its own outer `<g>` the way a real equipment
shape is) — no Label is added when none of these apply, though
Report.Skipped/Failed still record it either way. `<name>` comes from
`shapeName` (every code this package already renders) or else the new
`unrecognizedShapeName` (English names for the codes it doesn't, sourced
from the xsde2svg catalog's own object-type list), falling back to the
bare code when neither has it. Caught and fixed a real bug surfaced while
building this: `Extract` unconditionally did `d.Labels = matchLabels(...)`
near the end, which would have silently clobbered every diagnostic Label
just added — changed to append. Regenerated `sld-svg/xml/
PS_110kV_Lubnisa.xml` and its `sld-editor/diagrams/` copy again (both
untracked/gitignored) — verified live in the browser: all 7 of that
diagram's own skipped elements (2 Short-circuiter, 2 Arrow, 1 Cable
connector, 1 Rectangle, 1 3D button) now show a correctly positioned red
"Missing: ..." label, no console errors.

2026-09-21: Rectangle (shape 3) implemented full-scope, at
the user's own request — a purely decorative annotation box, unlike every
other shape here not real electrical equipment at all: new
`ClassRectangle` (shared `slddoc` module) never gets a Voltage/State/
Orientation/Ports, and is never a valid `connectElements` or routing-tool
target (both now explicitly guard against/skip it — Canvas.tsx's own
`findConnectionTarget` and diagramOps' `connectElements`). Its size varies
per instance and it isn't part of the electrical network, so like
`BusBarSection` it's drawn from its own two `Points` (opposite corners,
order-independent) rather than a fixed local-coordinate template — new
`Element.Fill`/`Stroke` fields hold its own literal CSS colors (free text,
not a `VoltageClass` reference, the same pattern a Lamp's own FillOff/
FillOn already uses; empty falls back to "none"/"white"). `Extract`'s new
`parseRectangle` reads a real xsde2svg `<rect x y width height style>`
(confirmed against `internal/modus/element_3.go`) — Rectangle (shape 3) no
longer shows up as a red "Missing: ..." placeholder, it's a real element
now. Frontend: `placeRectangle` (drag-to-draw, same as `placeBusbar`);
`diagramOps.POINTS_BASED_CLASSES` new shared constant generalizing every
BusBarSection-specific points-editing helper (`moveElement`,
`pasteElement`, `updateBusbarPoint`) to cover Rectangle too, so dragging a
corner handle resizes it the same way it repositions a busbar endpoint;
Canvas.tsx's own drag-to-draw dispatch, live corner-drag preview
(an actual rect outline, not a diagonal line), selection highlight, and
DOM-direct drag-move all got a Rectangle-specific branch alongside their
existing BusBarSection one. New "Annotations" palette category (not forced
into an electrical one); Properties gets fill/border color pickers + a
points editor, no Voltage/State/Orientation shown. Caught and fixed a real
hit-testing bug while testing this live: a `fill:none` (the freshly-placed
default) SVG shape receives no pointer events at all over its own
interior, only its stroke — a click anywhere but the exact 1px border
silently missed it; fixed by giving Rectangle a real entry in Canvas.tsx's
own `elementBoxes` (computed from its diagram-state Points directly,
unlike every other shape's DOM-`getBBox()`-derived one), which the
existing click-tolerance fallback (`findElementBoxHit`) already knew how
to use. Verified live in the browser end to end: drag-place, select
(inside the shape, not just its border), resize via corner handle, move
the whole shape, recolor both fill and border, Ctrl/Cmd-click-to-connect
correctly refuses to wire it to a Breaker, right-click Copy/Delete, and
Paste — all correct, no console errors.

2026-09-21: Rectangle (shape 3) gets a real, editable border width — new
`Element.StrokeWidth` (shared `slddoc` module), 0/unset falling back to 1
(the fixed value every other shape's own template hardcodes, and the real
xsde2svg source's own minimum), same convention Radius already uses for a
Lamp/FaultPassageIndicator. `writeRectangle` now emits the resolved value
instead of a hardcoded `stroke-width:1`; `Extract`'s `parseRectangle` reads
it from a real `<rect>`'s own style. Frontend: `strokeWidth` added to
`DiagramElement` and `RECTANGLE_DEFAULTS` (1, so Properties' own new
number field — "Border width", alongside the existing fill/border color
pickers — shows a real value immediately); no Canvas.tsx changes needed
(its own selection-highlight/corner-drag-preview strokes are a fixed UI
convention, unrelated to the element's own real one). Verified live: the
field defaults to 1, and setting it to 8 visibly thickens the rendered
border; a direct `/api/render` check confirmed both the explicit value and
the unset-falls-back-to-1 case.

2026-09-21: Rectangle's own Properties Fill color picker gets a
"Transparent" button next to its label — `type="color"` only ever
produces a real #rrggbb value, so once any color's been picked there was
no way back to the "none" default through the picker itself. New
`properties.transparent` i18n key, reusable for any future free-text
color field with the same gap (e.g. Lamp's own FillOff/FillOn have it
too, not addressed here).

2026-09-21: Arrow (shape 2, Стрелка) implemented full-scope, the same way
Rectangle was — a decorative annotation line, not real electrical
equipment (new `ClassArrow`, shared `slddoc` module; no Voltage/State/
Orientation/Ports, `connectElements`/`findConnectionTarget` both refuse it
as an endpoint the same way they already refuse Rectangle). Reuses
Rectangle's own `Stroke`/`StrokeWidth` fields (no `Fill` — an arrow has no
interior) plus a new `DoubleHeaded` bool. `writeArrow` draws it as a
single flat `<path>`, local-frame `M 0 0 h length` plus new
`arrowChevron`'s own open two-stroke chevron at the end (and, when
DoubleHeaded, a mirrored one at the start), wrapped in
`transform="translate(x0,y0) rotate(angle)"` — matching the real xsde2svg
source (`element_2.go`) exactly, confirmed against a real corpus instance
byte-for-byte, but collapsing that source's own five separate draw
branches (four axis-aligned special cases plus one generic/rotated one)
into this one local-frame formula, since a horizontal chevron rotated
0°/180° by the wrapping transform is pixel-identical to what those special
cases compute directly. Dashed/dash-dot line styles and StrokeWidth-scaled
arrowhead size were both left unported (documented simplifications).
`Extract`'s new `parseArrow` recovers the two true endpoints via a
"farthest two points in the path" heuristic (every arrowhead wing sits
only a few units from the tip, nowhere near as far as the arrow's own
real length) rather than replicating the real source's own five draw
branches — verified against the real corpus (`PS_110kV_Lubnisa.svg`, a
diagonal instance drawn via the generic/rotated branch, `rotate(-45,...)`)
by hand-computing the expected rotated endpoint and confirming it matched
exactly; can't reliably tell a double-headed instance apart from a
single-headed one from geometry alone, so `DoubleHeaded` always comes back
false from `Extract` (documented limitation). Frontend: reuses
`diagramOps.POINTS_BASED_CLASSES`/`placeArrow` (mirroring `placeRectangle`)
end to end — Canvas.tsx's drag-to-draw dispatch, `elementBoxes`
click-tolerance box, DOM-direct whole-shape drag (recomputing the
transform's own rotate angle from the two Points, since the local path
itself doesn't change), polyline selection-highlight (shared with
BusBarSection), and the same generic corner-handle reshape/resize
Rectangle already gets, no Arrow-specific Canvas.tsx branch needed beyond
the drag-to-draw dispatch and box computation. New "Annotations"-category
palette entry (alongside Rectangle) with its own diagonal-chevron icon;
Properties gets line color/width fields plus a Double-headed checkbox, no
Voltage/State/Orientation. Caught and fixed a real bug while testing this
live: `arrowChevron`'s own start-chevron formula string-concatenated a
literal "-" with an already-negative value, producing invalid SVG path
syntax ("l --7 -3") whenever DoubleHeaded was set — the whole element
silently failed to render (no console error). Fixed by computing the
signed x-delta as a real number before formatting, not string-level sign
juggling. Verified live in the browser end to end: drag-place, select
(inside/near the thin line, via the click-tolerance box — the exact
click-tolerance gap Rectangle's own fill:none fix already addressed
applies even more to a stroke-only shape), single- and double-headed
render correctly, corner-drag reshape keeps both arrowheads correct, no
console errors after the fix.
