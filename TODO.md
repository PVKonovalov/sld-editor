# TODO

## Editor features (see CLAUDE.md's own "Project state" for full context)

- A 45°/manual-bend-axis routing mode (the click-to-route tool is
  orthogonal-only today).
- Re-routing when a BusBarSection's own single-endpoint drag handle moves,
  instead of only on a whole-element drag (`diagramOps.moveElements`
  handles the latter already).
- Undo/redo.

## Equipment shapes not yet ported

Ported so far (render templates in `backend/assets/elements/base.xml` +
`Extract` support in the shared `slddoc` module): Reactor (37), Reactor
shunt (397), Surge arrester variant (29), Starter (76), Fuse withdrawable
(154), Surge arrester grounded (168), Capacitor bank (172), Generator
(173), Non-intersection/"Wire jump" (14).

Deferred — real xsde2svg shapes whose own source (`xsde2svg/internal/modus/
element_<code>.go`) is substantially more involved than the shapes above,
each needing its own dedicated pass rather than a quick port:

- **164** Отделитель (disconnector/isolator) — state-toggling dual
  geometry (visible/hidden `<g>` pairs), mirror-dependent, *and* depends on
  `sde.Distance` (external busbar spacing) that this schema has no
  equivalent field for at all.
- **398** Короткозамыкатель (short-circuiter) — same state-toggling
  dual-geometry + mirror complexity as 164, without the Distance
  dependency.
- **55** Трансформатор напряжения (voltage transformer) — not a simple
  symbol: variable winding count (2/3/4), per-winding color, and six
  different connection-type geometries (wye/delta/zigzag/...). Porting it
  faithfully means adding a real winding-configuration concept to the
  schema, closer in scope to redesigning `PowerTransformer` support than
  adding a shape.
- **385/386** КТП/ЗТП (package substation units) — these aren't switchgear
  with electrical ports at all; they're facility-level pictogram boxes
  (like a power-plant icon), so they don't fit this project's
  "equipment with terminals" model as-is.

Deliberately out of scope (decorative/structural, not real electrical
equipment — same reasoning that already excludes the generic draw
primitives, data-type 1/2/3/4/16): poles/pylons (19/146/292), power-plant/
substation pictogram icons (38/360), chassis/half-chassis cart graphics
(51/52), a cable-plug graphic (56), a decorative connector-arrow (83),
button/table/window HMI decoration (113/313/319), a road/geographic
background element (335), and a generic "Device" placeholder (130, too
vague to know what it actually draws).

## Known pre-existing extract gaps

- `PowerTransformer` (47) only supports the 2-winding case — a real
  corpus's 3-winding transformers land in `Report.Failed`, not
  `Report.Skipped` (2 such instances in `Examples.svg`).
