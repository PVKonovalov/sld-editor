# TODO

Open tasks only. Finished work is recorded in RELEASE.md.

## Editor features

- [ ] 45°/manual-bend-axis routing mode (the click-to-route tool is orthogonal-only today).
- [ ] Re-route attached connectors when a BusBarSection's single-endpoint drag handle moves (today only a
      whole-element drag re-routes, via `diagramOps.moveElements`).
- [ ] Undo/redo.

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

## Shapes not yet ported

xsde2svg `ObjectType` codes still marked not done in `elements.md`. Each one needs a template in
`backend/assets/elements/base.xml`, `Extract` support in the sibling `slddoc` module, and a `palette` entry.

- [+] 6 Booster/voltage regulator (single-winding power transformer)
- [+] 10 Connector
- [ ] 11 Backdrop, image file
- [ ] 19 Metal anchor/angle pole
- [ ] 38 Thermal power plant (pictogram)
- [ ] 39 Synchronous motor
- [ ] 44 Knife switch
- [ ] 50 Withdrawable sectionalizer
- [ ] 60 Zone division
- [ ] 71 Custom connection, disconnector. Porting it as its own type means removing the legacy `71` → `162` rewrite in
      `slddoc.Load` (`shapeDisconnectorLegacy`).
- [+] 83 Connector arrow
- [ ] 102 Panel/board
- [ ] 103 Automation device
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
- [ ] 360 Substation (pictogram)
- [ ] 389 Blocking filter
- [ ] 391 RTF text
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
