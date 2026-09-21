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
(173), Non-intersection/"Wire jump" (14), **164** Отделитель/Sectionalizer
(only Closed(1)/Open(0), so Properties' own State dropdown for this class
offers just those two, not the usual Open/Close/Intermediate — the real
source has no Intermediate position for this device at all, so this
shape's own `{state:closed|open|other}` template deliberately draws its
"other" option identical to "open" rather than inventing a third one; Open
itself is drawn as the same full-length rod tilted to a diagonal rather
than the real source's own literal geometry (a short stub near the top
terminal plus a bottom-terminal open-contact circle) — rejected as
visually wrong for this device, at the user's own request — and
`Extract`'s own `parseSectionalizer` reads
State from whichever of the real source's two visibility-swapped `<g
data-state="0|1">` child groups is actually visible, not from a `data-
state` attribute on a path the way every other switching device here
works; both the real source's xMirror flag and its `sde.Distance`-driven
leg extension were dropped, the same simplification every other shape here
already makes. Unlike Ground switch (54)'s own `Extract` support, an
unrotated (Orient 0) instance — the common real-world case for this shape,
confirmed against a real corpus (`PS_110kV_Lubnisa.svg`, both its own
Sectionalizer instances) — *is* supported: since the real source omits its
`rotate()` transform entirely at that angle, and this shape's own two
states draw too differently from each other for a reliable "extreme
points" anchor the way most other two-port shapes get one,
`sectionalizerAnchorFromTick` instead locates the shape's own "top tick" —
a fixed, always-identical-between-states 10-unit segment — and derives the
anchor from it directly), **3** Прямоугольник/Rectangle (unlike every
other shape here, not real electrical equipment at all — see slddoc's own
`ClassRectangle` doc comment: no Voltage/State/Orientation/Ports, never a
valid `connectElements`/routing-tool target, `Extract`'s own
`parseRectangle` never gives it a Port. Its size varies per instance and
isn't part of the electrical network, so — like `BusBarSection` — it's
drawn straight from its own two `Points` (opposite corners) rather than a
fixed local-coordinate template; its own literal `Fill`/`Stroke` colors are
free text, not a `VoltageClass` reference, the same pattern a Lamp's own
FillOff/FillOn already uses. Placed in the palette's own new "Annotations"
category rather than force-fit into an electrical one), **2** Стрелка/
Arrow (same non-electrical status as Rectangle just above — see slddoc's
own `ClassArrow` doc comment; also drawn from its own two `Points`, but
order matters here, unlike Rectangle's — the arrowhead is always at
`Points[1]`, or both ends when `DoubleHeaded`. Reuses Rectangle's own
`Stroke`/`StrokeWidth` fields rather than adding new ones — an arrow has
no interior, so no `Fill`. Its own open two-stroke chevron arrowhead
matches the real xsde2svg source (`element_2.go`) exactly, reproduced as a
single local-frame formula rather than that source's own five separate
draw branches — a horizontal chevron rotated by `writeArrow`'s own
wrapping transform is pixel-identical to what those branches compute
directly. Two real-source details were *not* ported: dashed/dash-dot line
styles, and scaling the arrowhead's own size by StrokeWidth — the latter
turned out to not really be a real relationship in the source either (see
`arrowChevron`'s own doc comment). `Extract`'s own `parseArrow` doesn't
replicate those five draw branches either — it recovers the two true
endpoints via a "farthest two points in the path" heuristic robust to all
of them, but can't reliably tell a double-headed instance's own doubled
starting chevron apart from an ordinary single-headed one from geometry
alone, so an extracted Arrow's own `DoubleHeaded` is always false), **4**
Круг/Circle (same non-electrical status and same two-opposite-corners
`Points` convention as Rectangle above — order-independent, unlike
Arrow's — just rendered as an `<ellipse>` instead of a `<rect>`; reuses
Rectangle's own `Fill`/`Stroke`/`StrokeWidth` fields rather than adding
new ones, including the same Properties "Transparent" fill-reset button.
`Extract`'s own `parseCircle` reads `cx`/`cy`/`rx`/`ry` straight off the
bare `<ellipse>` tag, the same direct-attribute approach Rectangle's own
`parseRectangle` uses).

Deferred — real xsde2svg shapes whose own source (`xsde2svg/internal/modus/
element_<code>.go`) is substantially more involved than the shapes above,
each needing its own dedicated pass rather than a quick port:

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
primitives, data-type 1/16 — Rectangle (3), Arrow (2), and Circle (4) are
the three generic primitives that *have* been ported, see above):
poles/pylons (19/146/292), power-plant/
substation pictogram icons (38/360), chassis/half-chassis cart graphics
(51/52), a cable-plug graphic (56), a decorative connector-arrow (83),
button/table/window HMI decoration (113/313/319), a road/geographic
background element (335), and a generic "Device" placeholder (130, too
vague to know what it actually draws).

## Known pre-existing extract gaps

- `PowerTransformer` (47) only supports the 2-winding case — a real
  corpus's 3-winding transformers land in `Report.Failed`, not
  `Report.Skipped` (2 such instances in `Examples.svg`).
