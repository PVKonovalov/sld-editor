# TODO

Open tasks only. Finished work is recorded in RELEASE.md.

## Editor features

- [ ] 45°/manual-bend-axis routing mode (the click-to-route tool is orthogonal-only today).
- [ ] Re-route attached connectors when a BusBarSection's single-endpoint drag handle moves (today only a
      whole-element drag re-routes, via `diagramOps.moveElements`).
- [ ] Placement hot keys from the YAML config: a single key arms a palette item, e.g. `t` a power transformer, `c` a
      circuit breaker, `d` a disconnector, `b` a busbar, `w` buswork. Configured per palette item (say, a `key:` next
      to it in `palette`, checked by `ValidatePalette` for duplicates and clashes with existing shortcuts such as
      Ctrl/Cmd+C/V/Z/F, Space and Esc), served by `/api/config`, shown in the Elements panel's tooltips and the user
      guide's shortcut table, and ignored while typing in a field.
- [ ] Light theme: a light UI (panels, dialogs, canvas chrome, the user guide window) alongside today's dark one,
      switched in Settings or following the OS (`prefers-color-scheme`). Needs the Tailwind `surface-*`/`gray-*`
      colours turned into theme tokens, and a decision on the diagram itself: keep each diagram's own background, or
      offer a light default for new ones.
- [ ] Rotate and mirror shortcuts: `R` turns the selection 90°, `M` mirrors it (today only through Properties).
- [ ] Align and distribute a multi-selection: left/centre/right, top/middle/bottom, equal spacing (rows of feeder
      bays).
- [ ] Bulk edit a multi-selection: voltage class, state, size step (today only the layer can be set for several
      items at once).
- [ ] Rename in series: number selected devices automatically ("QS-1, QS-2, …"), and find-and-replace in names.
- [ ] Status bar: selection count, zoom %, the armed tool, next to the cursor coordinates readout.
- [ ] Minimap in a canvas corner for large diagrams (e.g. CUS_Novgorodenergo), showing and moving the visible area.
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
