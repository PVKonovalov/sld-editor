# TODO

Open tasks only. Finished work is recorded in RELEASE.md.

## Editor features

- [ ] 45°/manual-bend-axis routing mode (the click-to-route tool is orthogonal-only today).
- [ ] Re-route attached connectors when a BusBarSection's single-endpoint drag handle moves (today only a
      whole-element drag re-routes, via `diagramOps.moveElements`).
- [ ] Light theme: a light UI (panels, dialogs, canvas chrome, the user guide window) alongside today's dark one,
      switched in Settings or following the OS (`prefers-color-scheme`). Needs the Tailwind `surface-*`/`gray-*`
      colours turned into theme tokens, and a decision on the diagram itself: keep each diagram's own background, or
      offer a light default for new ones.
- [+] Rotate and mirror shortcuts: `R` turns the selection 90°, `M` mirrors it (today only through Properties).
- [ ] Align and distribute a multi-selection: left/centre/right, top/middle/bottom, equal spacing (rows of feeder
      bays).
- [ ] Bulk edit a multi-selection: voltage class, state, size step (today only the layer can be set for several
      items at once).
- [ ] Rename in series: number selected devices automatically ("QS-1, QS-2, …"), and find-and-replace in names.
- [ ] Status bar: selection count, zoom %, the armed tool, next to the cursor coordinates readout.
- [ ] Minimap in a canvas corner for large diagrams , showing and moving the visible area.
- [ ] Links between diagrams: Ctrl/Cmd-click on an Object link (28) or Connector arrow (83) opens the diagram it
      points to.

## Diagram checking

- [ ] Check diagram: one command listing problems as Find-style results that select and centre each item: free
      terminals and dangling wire ends (Find's "Not connected only" already has these), devices without a voltage
      class or with one differing from their wires, wires crossing a busbar or another wire without a junction,
      duplicate names, unnamed switching devices, zero-length or diagonal wires, labels linked to deleted elements.

## Custom elements

Placing one from the palette works (see RELEASE.md, 2026-09-29). Still to do:

- [ ] Auto-connect a custom element's open wire ends when it's dropped with one on a terminal, busbar or connector.
- [ ] Show a live preview of the custom element under the cursor while it's armed.
- [ ] Optionally, live-linked instances that update when their definition changes.

## Ports and topology

- [ ] Joining on drop (`joinPortNodes`) only catches exact coincidence; a terminal dropped a few units off a wire
      still needs a wire drawn to it.
- [ ] A BusBarSection's ports still grow per tap (it has no fixed terminals); tapping the same point twice adds a
      second port.

## SVG import/export

- [ ] `Extract` doesn't read every Static-rendered shape back at its own anchor and orientation; the list (with the
      reason for each) is `extractRoundTripGaps` in `backend/internal/elements/static_render_test.go`. In the
      diagrams corpus the ones that actually show up are cable joint (32, 1 unit low), ground switch (54, 2/3 unit
      low) and package substation (385, 18 units up-left). `Extract` also reads Mirror for only a few shapes.
- [ ] `Extract` links a caption (`data-type="5"`) only to an element whose name matches its `data-name`, never to a
      connector, so a named line's or load link's caption imports unattached.
- [ ] A Container (310) in an xsde2svg export made before the `element_310.go` grouping patch imports only when it has
      a caption (its outline is then the bare `<path>` right after the caption group); an uncaptioned one carries no
      `data-type` there and stays unimported until the diagram is re-exported.
- [ ] PNG/PDF export of the page or the selection, for documentation.
- [ ] Re-import keeping edits: re-run `Extract` on a diagram's source .svg and carry over names, layers and manual
      changes, so diagrams imported before an import fix (T-taps, capacitor/starter/substation ports, half-chassis
      terminals) pick it up without losing work.
- [ ] Diagram compare: two versions of a diagram (or before/after a re-import) side by side, listing added, removed
      and moved items.
- [ ] Topology export (CIM/CGMES or JSON) for the downstream topology processor.
- [x] Import xsde diagrams


## CIM import - export
- [x] Element Object link:28 should be used with CIM class EnergyConsumer or cim:EnergySource

## Shapes not yet ported

xsde2svg `ObjectType` codes still marked not done in `elements.md`. Each one needs a template in
`backend/assets/elements/base.xml`, `Extract` support in the sibling `slddoc` module, and a `palette` entry.

- [+] 6 Booster/voltage regulator (single-winding power transformer)
- [+] 10 Connector
- [+] 11 Backdrop, image file
- [+] 19 Metal anchor/angle pole
- [+] 38 Thermal power plant (pictogram)
- [+] 39 Synchronous motor
- [+] 44 Knife switch
- [+] 50 Withdrawable sectionalizer
- [ ] 60 Zone division
- [ ] 71 Custom connection, disconnector. Porting it as its own type means removing the legacy `71` → `162` rewrite in
      `slddoc.Load` (`shapeDisconnectorLegacy`).
- [+] 83 Connector arrow
- [ ] 102 Panel/board
- [+] 103 Automation device
- [ ] 130 Device (generic placeholder; check what it actually draws first)
- [+] 146 Power pole
- [+] 156 Resistor
- [+] 157 Thyristor
- [+] 163 Short-circuiter without ground
- [+] 166 Disconnector-fuse
- [+] 174 Synchronous compensator
- [+] 175 3-position knife switch
- [+] 302 Window icon
- [+] 310 Container
- [+] 319 Small window
- [!] 320 Custom element - it's a common group name for elements started from type id 320XXX
- [+] 360 Substation (pictogram)
- [+] 389 Blocking filter
- [+] 391 RTF text (imported as a plain Text label (5); not drawn or saved as 391)
- [ ] 3206 Customer connection, disconnector, arc-extinguishing contacts
- [+] 320002 Lamp on pole


## Gaps in already-ported shapes

- [ ] Table 2 (313): per-cell Fill/TextColor overrides aren't editable in Properties yet (they are stored, rendered
      and extracted).
- [ ] Table 2 (313): cell merging and multi-paragraph cell text aren't modeled (merged cells render separately;
      text is reduced to one line).
- [ ] Cable joint (32): the alternate CustomView appearance and the optional phase-color triangle fill aren't
      modeled (no corpus instance found to confirm them).
- [ ] Junction point (7): its extracted label is a standalone Label (`For` = junction id) and doesn't move when the
      junction is dragged.

## Editing
- [x] Group/Ungroup elements

## Reducing frontend/backend traffic: a working copy on the server

Today every edit uploads the whole diagram (`/api/render/fragments` or `/api/render`, about 105 KB gzipped for a
2,500-element diagram), because the backend is stateless and the unsaved working copy lives only in the browser.
Opening is already one request (the server repairs and renders it). The goal: the server keeps each tab's working
copy and receives only what changed.

Server:

- [ ] `internal/workspace`: an in-memory registry, tab session → `{name, version, diagram}`, one per tab, guarded by
      a per-session lock. The session id is the one presence already sends (`PresenceBanner.tsx`), moved to a
      shared module (`lib/session.ts`).
- [ ] `GET /api/diagrams/open?name=&session=` also stores the repaired diagram as that tab's working copy and returns
      its `version`.
- [ ] `PUT /api/workspace?session=`: the whole diagram (New, import, draft restore, and the resend fallback). Returns
      the new `version` and the full SVG.
- [ ] `POST /api/workspace/apply?session=`: `{base, changes}`. `changes` holds upserted and deleted elements,
      connectors, labels, digital devices and nodes (whole items, by id), plus the small top-level fields when they
      changed (`width`, `height`, `lastId`, `editor`, `layers`, `voltageClasses`). The
      server applies them, decides patch vs full render itself (the rules of today's `diffDiagramForRender`), and
      returns `{version, fragments}` or `{version, svg}`.
- [ ] A `base` that isn't the server's current version, or an unknown session (server restart), answers 409
      `{resend: true}`; the frontend then sends the whole diagram once with `PUT /api/workspace`.
- [ ] Item order: an upserted existing item keeps its place, a new one is appended, as the frontend's arrays do. If
      the surviving ids of an array come in a different order (a reorder), the frontend sends the whole diagram.
- [ ] `PUT /api/diagrams/save?name=&session=&version=` writes the working copy (Save and Save As) instead of an
      uploaded body; a version mismatch answers 409 and the frontend resends, then saves.
- [ ] Export XML/SVG and "Save as custom element" for the whole diagram read the working copy too.
- [ ] Freeing memory: the presence `leave` (pagehide) drops the tab's copy; a copy not touched for the presence TTL
      is dropped as the fallback for a tab that vanished without notice. Optionally a cap on copies
      (`workspace.max_sessions`, documented in the guides' Configuration section).
- [ ] Pictures: the working copy keeps the image (`href`), so the Static .svg written on Save has it; an image goes
      up only when its Picture changes, so `lib/picture.ts`'s stripping is no longer needed for rendering.

Frontend:

- [ ] `lib/workspace.ts`: the last state the server acknowledged (`acked`, `version`) and `changesBetween(acked,
      current)`, by id and object reference (untouched items keep their reference, as `diffDiagramForRender`
      already relies on). Undo/redo needs nothing extra: it is just another current state.
- [ ] Event-driven sync, no timers (replaces the 150 ms render delay): at most one request in flight; a change
      while one is in flight is only noted, and when the response arrives one request goes out for the latest
      state. The response's fragments or SVG update the canvas as today.
- [ ] `commitDiagram` resets (open, New, import, restore) set `acked` from the open response or send the whole
      diagram with `PUT /api/workspace`.
- [ ] Save sends only `name` and `version`; on 409 it resends and retries once.
- [ ] Remove `/api/render`, `/api/render/fragments` and their callers once nothing uses them; keep
      `/api/diagrams/svg` (downloads).

Tests and checks:

- [ ] Go: applying changes (upsert, delete, top-level fields, order), version mismatch, unknown session, save from
      the working copy, memory release on leave.
- [ ] API: open → apply a move → fragments only; apply with a stale base → 409; save → file on disk equals the
      working copy.
- [ ] Measure a move on the 2,500-element diagram: request size (expected under 1 KB) and round trip.

Order: (1) workspace + open + apply + resend (edits stop uploading the diagram); (2) save and exports from the
working copy; (3) remove the old render endpoints.

## User can create new elements

A new element is a new template symbol (SVG with `{color}`/`{fill}`/`{state:…}`/`{stateAttr}` placeholders plus
`<terminals>`) kept in a library the editor writes itself. Canvas, ports, wiring, rotate and mirror then work
without code changes. Custom elements (`custom-elements/*.xsld`) stay as they are: reusable sets of existing parts,
not one device.

- [ ] User library: config key `elements.user_library` (e.g. `../user-elements.xml`), loaded after `base.xml`.
- [ ] `GET/PUT/DELETE /api/symbols`: write the library atomically, then reload the catalog and symbol library
      without restarting the server (both are loaded only at startup now).
- [ ] Palette: a final "User elements" group filled automatically, no `palette:` edit needed.
- [ ] Symbol editor dialog: name, category, class (an existing one, e.g. Breaker/Disconnector/Load; it decides
      states, voltage and topology export; a new class needs slddoc code).
- [ ] Symbol editor: SVG template in a text box, live preview on a grid around the anchor in states 0/1/2 and at
      0/90/180/-90.
- [ ] Symbol editor: terminals placed by clicking on the preview, snapped to the grid.
- [ ] "Duplicate as new" on a built-in shape: copies its template under a new code.
- [ ] Optional override of a built-in code (e.g. 41), behind an explicit warning: it changes every diagram and
      export using it, which then no longer match xsde2svg.
- [ ] `<symbols>` section in `.xsld` with copies of the user symbols a diagram uses, so it opens and imports
      correctly on another installation or after a symbol is deleted.
- [ ] Drawing tools in the symbol editor (line, rectangle, circle, arc, text) instead of raw SVG.

Open questions:

- Code range for user symbols, so they never clash with xsde2svg codes (`data-type` is numeric), e.g. 900001+.
- Whether to allow overriding built-in codes at all.

Notes:

- Importing a saved SVG with user symbols needs those symbols known (user library or the diagram's `<symbols>`).
- Two users editing the library at once: the later save wins, as for diagrams.
- Shapes drawn by Go code (Rectangle, Table, Substation…) can't be edited this way, only templates.

## Elements
- [x] A Rectangle With Rounded Corners

# Errors
- [x] Circle is invisible
- [x] Circle is not movable, only I can change it size