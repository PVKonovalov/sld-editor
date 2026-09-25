# TODO

## Editor features (see CLAUDE.md's own "Project state" for full context)

- A 45°/manual-bend-axis routing mode (the click-to-route tool is
  orthogonal-only today).
- Re-routing when a BusBarSection's own single-endpoint drag handle moves,
  instead of only on a whole-element drag (`diagramOps.moveElements`
  handles the latter already).
- Undo/redo.

## Reducing frontend/backend traffic

Raised by the user: a big diagram over a bad connection has a long delay
on every add/edit, since `Canvas.tsx` POSTs the *whole* Diagram JSON to
`/api/render` (debounced) and gets back the *whole* rendered SVG document
on every change — for a large diagram this round trip is big regardless
of how small the actual edit was.

Done: **gzip response compression** (`internal/api/server.go`,
`gin-contrib/gzip`) — see RELEASE.md's own 2026-09-21 entry. Cuts the
`/api/render` response size by ~89% on a real 2530×1610 diagram (verified
via the Performance API), with zero frontend change, since every browser
already negotiates and decompresses gzip transparently. Doesn't touch the
request direction (the diagram JSON posted up) at all.

Done: **incremental/patch-based re-rendering** instead of a full
diagram-in/full-SVG-out round trip on every edit — the real fix for the
"big diagram, small edit" case (gzip helps bandwidth, not the fact that a
full document is generated/transferred/DOM-replaced for a one-element
change).

Backend: `internal/slddoc.RenderFragments` (`slddoc/render.go`) — a
sibling to `Render` that runs the same whole-diagram voltage/topology
resolution pass but only writes markup for a requested `ids []int`
(elements/connectors/labels/digital devices are one shared id space, so a
plain int works as the lookup key regardless of which kind an id turns
out to be — see `Diagram.LastID`'s own doc comment), returned as
`map[int]string` rather than written to an `io.Writer`. No type-comment
headers and no `elementZOrder` tiering (both only meaningful for a full,
ordered document) — a fragment is meant to replace one already-positioned
DOM node in place. An id no longer present in the diagram at all is
silently skipped, not an error. New `POST /api/render/fragments`
(`internal/api/diagrams.go`'s `renderPreviewFragments`) exposes it the
same "preview only, never touches storage" way `POST /api/render`
already does, taking `{diagram, ids}` and returning `{fragments: {id:
markup}, warning?}`.

Frontend: `Canvas.tsx`'s debounced commit path now diffs the latest
diagram against `lastRenderedRef` (the diagram as of the last successful
render) on every firing, via `diagramOps.diffDiagramForRender` — cheap
reference-inequality per id across `elements`/`connectors`/`labels`/
`digitalDevices`, since every `diagramOps` mutator already does
immutable, per-id array updates (an untouched entry keeps its old object
reference, so no field-by-field comparison or mutator instrumentation is
needed). Three outcomes: `'none'` (nothing rendering-relevant changed —
skip the round trip entirely), `'patch'` (only a fixed set of
already-existing ids changed in place — `api.renderPreviewFragments` +
`patchFragmentsInDom`, which looks up each `[data-editor-kind][id=X]`
node the same way `dragElementsInDom`/`elementBoxes` already do and
swaps it via `parseSvgFragment`+`replaceWith`, keeping whatever DOM
position the prior full render gave it), or `'full'` (an id added/
removed, or `width`/`height`/`voltageClasses`/`editor`/`layers` changed
by reference — a VoltageClass's own color edit repaints every element
that references it, not just one, and an add/remove raises the question
of *where* a brand-new node belongs relative to `elementZOrder`'s own
tiers, which only exist as document order in a full `Render` — the
existing `api.renderPreview`/`setSvg`/`dangerouslySetInnerHTML` path,
unchanged). A `patchVersion` counter, bumped after each successful patch,
gives the `elementBoxes` effect (which depends on `svg`, unchanged by a
patch) a signal to recompute click-tolerance boxes against the
just-patched geometry. The initial diagram open and Save still use the
full-document endpoints they already did — this only ever optimizes the
interactive-editing hot path once a diagram is already loaded. Verified
live: dragging/editing an existing element's state/reassigning it to an
already-on-the-diagram VoltageClass each fire exactly one
`/api/render/fragments` call and patch correctly in place; placing a new
element, or editing a VoltageClass's own color (repainting every element
sharing it), each still fire the original full `/api/render`; Save +
reload round-trips correctly either way.

## Equipment shapes not yet ported

Ported so far (render templates in `backend/assets/elements/base.xml` +
`Extract` support in the shared `slddoc` module): Reactor (37), Reactor
shunt (397), Surge arrester variant (29), Starter (76), Fuse withdrawable
(154), Surge arrester grounded (168), Capacitor bank (172), Generator
(173), Non-intersection/"Wire jump" (14), **56** Кабельный разъем/Cable
connector (a real two-terminal electrical device — a cable termination/
splice symbol, not decorative — drawn from a plain fixed local-coordinate
template the same "Junction point (7)/Wire jump (14)" way, terminals at
(0,-10)/(0,10) like Breaker/Disconnector; decoded by hand from the real
source's own relative-path formula (`element_56.go`) into an open
two-line chevron flaring outward from each terminal, matching Arrow's own
open-chevron style but at both ends unconditionally; fits `Extract`'s own
existing `parseTwoPortDevice` helper exactly, same as Junction point/Wire
jump, so no new parse function was needed), **32** Cable joint/coupling (a
real two-terminal electrical device marking where two cable segments are
spliced, drawn the same plain fixed local-coordinate way Cable connector
(56) is: a vertical stem split by a gap, with an unfilled triangle mark
in the gap — terminals at (0,-12)/(0,14), asymmetric around the anchor by
design (the real source's own default branch shifts its drawn geometry
one unit below the element's true anchor before drawing), confirmed
against 500+ real corpus instances across 17 files, all using this same
plain look; also fits `parseTwoPortDevice` exactly, no new parse function
needed. The real source's own alternate CustomView appearance (a
distinct non-English string value selects a single line plus a
differently-shaped triangle) and its own optional phase-color fill on the
triangle have no real corpus instance to confirm either against, so
neither is modeled — a real instance using either extracts with this
same plain look instead), **7** Junction point (already ported before
this session's own tracked history, but gained real per-instance
Radius/Fill after checking corpus: this project's own long-standing
hardcoded r=3/unfilled look is kept as the *default* (an already-placed/
-saved instance with neither field set doesn't change), but both are now
real Element fields a user can edit — real xsde2svg usually draws a
filled dot (own voltage color, ~65% of 9895 real instances checked) or a
"hollow" one (filled with the page's own background instead, the
`bussed_link` case, ~35%) at a genuinely varying radius (2/3/4/5/8/11 all
seen), and Extract now captures both explicitly from a real instance
rather than discarding them. Also gained an attached text label: some
real instances carry a ParamText/SubscriptName `<text>` beside the dot
(9 distinct position/alignment combos found in real corpus, not just one
fixed style) — rather than inventing a bespoke position-matrix field,
Extract synthesizes an ordinary standalone Label (`For` = the junction's
own id) from it, reusing this schema's already-built Label
position/anchor/valign/font/color editing wholesale; the trade-off,
accepted at the user's own explicit choice, is that (like every other
Label already) it doesn't move when the junction point itself is dragged,
unlike the real source's own attached-to-the-point look. Recovering the
label at all required a real source change: every real xsde2svg export
found still draws a junction point as a bare `<circle data-type="7">`
with its own optional `<text>` as a separate, unlinked top-level
sibling — Extract has no reliable way to associate the two, so
`internal/modus/element_7.go` was restructured (at the user's own
request) to wrap both in a shared `<g id data-type="7">`, the same fix
already made for PackageSubstation/EnclosedSubstation (385/386);
`parseJunctionPoint` supports both the older bare-circle form (every real
corpus instance currently on disk) and this new wrapped one, since real
instances of the older one will presumably keep showing up for a while
yet). Lamp (106) — already ported before this session's own tracked
history — gained the identical attached-label fix for the identical
reason: real corpus shows the same bare `<circle data-type="106">` plus
an unlinked top-level `<text>` sibling pattern, so `element_106.go` got
the same shared-`<g>` restructuring and `parseLamp` the same
`firstCircleChild`/`parseAttachedLabel` treatment `parseJunctionPoint`
already uses (both factored into shared helpers rather than duplicated,
since the two shapes' own fix is now identical in every particular except
which class/shape code owns it). FaultPassageIndicator (320003) —
already ported before this session's own tracked history — gained an
editable overlay text: its own centered "FPI" label was always a fixed
literal in base.xml's template, unlike Junction point's/Lamp's own
attached labels this has no real source counterpart to recover at all
(element_320.go's own custom-element case for this shape draws no text
of any kind — a "FPI" label is purely this project's own long-standing
convention). Now backed by Element.PropertyText, the same free-text
field 385/386 already use, defaulting to a new admin-configured
`config.Config.Indicators.DefaultFPIText` (`indicators.default_fpi_text`
in `config/sld-editor.yaml`, exposed via `GET /api/config` as
`defaultFpiText`, "FPI" out of the box) rather than a hardcoded literal —
`internal/slddoc.Render` gained a new `defaultFPIText` parameter threaded
through from `config.Config` (`cmd/sld-editor/main.go` ->
`storage.Store`), and `diagramOps.placeElement` seeds a freshly placed
instance's own PropertyText from that same server value explicitly
(`fpiDefaults`), rather than leaving it unset and relying on Render's own
fallback silently. An i18n-dictionary-based default (varying by locale
build) was considered and explicitly rejected in favor of this, since
every other config-driven legend in this project (state_colors,
position_states, ...) is already a single install-wide value, not
locale-aware, and this should be consistent with that established
precedent rather than introduce a new one, **398** Short-circuiter (a
single-terminal grounding-type switching device, structurally close to
Ground switch (54): a fixed tapered earth symbol at the top, one real
electrical terminal at the bottom, and a State-driven pivot rod bridging
the gap between them — Closed bridges the terminal straight to the earth
symbol, an intentional short to ground (with a fixed-contact tick where
the rod meets the earth symbol); Open pivots the rod away at that same
end, marked with a circle there instead of the tick, same pivot-circle
convention as Sectionalizer. This template's own default uses
element_398.go's own xMirror==1 geometry rather than its xMirror==0 one
(the blade swings counter-clockwise, at the user's own explicit
request), since this schema's generic Mirror property already covers the
xMirror==0 look for whichever placed instance needs it. Only two real
states exist, same as Sectionalizer, so its own State dropdown offers
only Open/Close. Unlike most switching devices, this shape's own real
xsde2svg export encodes State via two sibling
`<g data-state="0|1" visibility="visible|hidden">` groups rather than a
plain `data-state` attribute on a path — `parseShortCircuiter`'s own
state-reading mirrors `parseSectionalizer`'s own visible-group-scanning
logic, not the generic `parseState` helper every other two-port device
uses, since that helper only looks at path-level attributes and would
silently return no State at all for a real exported instance of this
shape. The arrowhead itself sits on a short arm off the rod's own
midpoint (matching Sectionalizer's own arm+arrowhead-at-the-tip
composition) rather than element_398.go's own compact
arrowhead-near-the-rod placement — another deliberate departure at the
user's own request, kept at its own xMirror==0 orientation (unlike the
rod above it) since the shape's own default 180-degree placement
orientation flips which way that reads. The rod's own Open deflection
(dx:dy) also uses Sectionalizer's own 6:18 ratio rather than
element_398.go's own 7:16 one, for the same "reads the same way as
Sectionalizer" reason — both states' rod now spans the full 18 units
from the pivot circle to the terminal-adjacent end (was 16), so the arm
moved from y=-8 to y=-9 to stay centered on it. The palette icon gets the same
cosmetic 180-degree spin Ground switch's own icon already has (see
elementIcon.ts's `ICON_ROTATION`), since its raw unrotated template also
reads backwards in a preview with no orient of its own to lean on. Still
requires the real source's own rotate() transform to
recover the element's anchor, same known gap as Ground switch's own
unrotated-instance limitation), **385** Package substation (KTP) (a
facility-level pictogram, not switchgear in the usual sense, but the real
source still gives it a genuine voltage-driven color and exactly one real
electrical terminal — despite this class having been previously judged
out of scope for exactly the opposite reason, see the "deliberately out
of scope" list below's own history — grid-aligned to y=-22, the real
source's own lead stub. Two real appearance variants exist (NType): 0
(the common case) draws a 36-unit outer square, an 18-unit inner
rectangle, and the lead stub; 1 draws a plain downward-pointing triangle
instead, its own apex at local (0,18), not at the anchor — confirmed
against a real xsde2svg v1.4.12 corpus export
(sld-svg/examples/sld/Shema_sety_VRES.svg) after an initial hand-derived
transcription of the real source's own path formula got this wrong.
NType was originally only recoverable on Extract via a data-ntype export
attribute that a real corpus file already independently carried —
confirming this project's own first choice of attribute name matched an
already-deployed convention — but this repo's own local xsde2svg checkout
(an older version) didn't yet have it; added there too (element_385.go)
so this repo's own tooling had something to read. Superseded at the
user's own explicit request by a generic `data-property="key:value;..."`
export attribute (element_385.go/element_id386.go — the same lightweight
grammar `style="..."` already uses), which now also carries Tech.Closed
(key "closed") for both shapes; the older single-purpose data-ntype is
still read as a fallback so the already-independently-deployed real
corpus file above keeps extracting correctly. Abonent (fills the inner
rectangle/triangle solid) reuses this schema's ordinary Fill field
instead of a dedicated boolean; Tech.Closed (dashes the outline) reuses
the ordinary State field the same way Short-circuiter's own dashing
convention does — both were wired into rendering from the start but,
until a user-reported real instance (id 148788827, its own Abonent-filled
inner rectangle silently dropped) surfaced the gap, Extract never
actually recovered either; both are now read back (`substationFill`,
`substationState`, `substationDataProperty`), State only for an instance
whose own data-property already carries "closed" (nil/unrecovered
otherwise, same known gap as before for an older export). Unlike Ground
switch, a real unrotated instance (no
rotate() transform at all — the real source only emits one when angle !=
0) is directly confirmed to exist in production (a user-reported Extract
failure on a real element from sld-svg/examples/sld/Distributed
grid.svg), so Extract falls back to a geometry-derived anchor
(`substationAnchorFromGeometry`: the outer `<rect>`'s own center for the
box variant, the bare `<path>`'s own first "M x y" point for the triangle
one) whenever no rotate() is present, rather than requiring one
unconditionally the way most other shapes still do. Its own
bypass-template rendering (a bare `<g>`/`<path>`, not a symbol template)
needed Canvas.tsx's own click-tolerance `elementBoxes` fallback widened
to match on any `data-editor-kind` element regardless of tag, not just
`<g>`, since its own NType 1 (triangle) variant renders as a bare
`<path>` the same way Rectangle/Circle/Arrow already do), **386**
Enclosed transformer substation (ZTP) (the same facility-level-pictogram
family as 385 — a fixed 36-unit outer square around an always-drawn,
always-unfilled-by-default downward triangle, apex at local (0,18), the
same corrected formula 385's own triangle variant uses — but with only
one appearance (no NType) and no drawn lead stub at all (confirmed
against the real source, element_id386.go: no `canvas.Line` call
anywhere). Reuses Fill (the triangle's own interior) and State
(dashes the outline) identically to 385, and the same
`substationAnchorFromGeometry` unrotated-instance fallback. Terminal
placed at local (0,-20), just outside the outer square's own top edge —
confirmed by direct user answer (one real electrical terminal, same as
385) rather than derived from the real source, which draws no stub to
anchor it to. Both 385 and 386 also carry an optional PropertyText overlay
label (e.g. a transformer's own power rating), matching a real source
update the user made to xsde2svg's own element_385.go/element_id386.go:
a short centered white/17px/Arial `<text>` that stays upright regardless
of Orientation/Mirror — this editor's own Render achieves that with a
local counter-transform on the `<text>` rather than the real source's own
nested-group split, since every other symbol element already relies on a
single combined transform for Canvas.tsx's own click-tolerance box and
drag-in-DOM logic. Fixing this also surfaced a real Extract bug: both
parsers only checked the outer node's own `transform` attribute for
Orientation, but the real source now nests rotate() one level inside (the
same pattern `parseTwoPortDevice` already handles for other shapes) —
every real rotated instance was silently losing its Orientation; fixed by
searching descendants for the transform instead, always deriving the
anchor from geometry), **164** Отделитель/Sectionalizer
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
`parseRectangle` uses), **113** Объемная кнопка/3D button (an earlier "out
of scope" call for this one turned out to be wrong — see
[[project_xsde2svg_porting]]'s own "earlier judgments can be stale" note —
the user asked for it anyway; same non-electrical status and same
two-opposite-corners `Points`/`Fill`/`Stroke`/`StrokeWidth` convention as
Rectangle, but unlike Rectangle/Arrow/Circle it's `<g>`-wrapped, not a bare
tag, since it also draws its own centered label (reuses `PropertyText`,
plus two new fields, `TextColor`/`Bold`, since real corpus shows both
genuinely varying — a dark box with plain white text vs. a light box with
bold dark text — unlike 385/386/FPI's own fixed-style overlay text).
Real corpus (`grep -rl 'data-type="113"' EMA/ctrlroom/var/ctrlroom/sld/`)
never shows a `data-state`/real voltage on one despite `element_113.go`
computing both — every real instance found uses one fixed look, not a
Closed-driven toggle, confirming this is a static navigation/action
button (e.g. "Журнал событий"/Event log), not anything reflecting live
switching state, so State/data-fill/data-voltage were deliberately not
modeled. `Extract`'s own `parseButton` reads the `<rect>` child directly
(same as `parseRectangle`) plus the sibling `<text>` (bold detected via
`font-weight: bold` in its own style, the same `parseDigitalDevice`
convention) — verified against both real corpus variants found, extracting
byte-for-byte matching Fill/Stroke/TextColor/Bold/text. **335** Дорога/Road
(another earlier "out of scope" call that turned out to be wrong — same
note as 113 above): a purely decorative geographic background line, drawn
as an arbitrary multi-vertex `Points` polyline — `BusBarSection`'s own
convention, not Rectangle/Circle's two-opposite-corners one or Arrow's own
two-ordered-endpoints one — reusing `Stroke`/`StrokeWidth` (both genuinely
vary per real instance: orangered/blue/royalblue/white, widths 8/10/12),
no new fields needed at all. Real instances are a bare `<polyline>`, no
wrapping `<g>` and — unlike a real busbar's own bare polyline — no
`data-name` either (`element_335.go` never emits one), so `writeRoad`/
`parseRoad` reuse `writePolyline`/`parsePointList` directly rather than
each needing their own bespoke geometry code the way Button's did. This
editor can only draw a *fresh* Road as a straight two-point line (same
limitation a fresh Busbar section already has — no way yet to add a bend
point to a freshly-placed points-based element mid-edit, only drag
existing ones); a Road extracted from a real multi-bend file keeps every
one of its own original vertices, each individually draggable. **292**
Опора стоечная/Post-type pole (another earlier "out of scope" call that
turned out to be wrong — same note as 113/335 above): a purely decorative
structural marker on a pole-by-pole layout diagram, not real electrical
equipment — unlike the five generic primitives above, it's a single
anchor+orient shape (click-to-place, like Lamp/JunctionPoint), not
Points-based, drawn as a bare `<rect>` or `<circle>` (`Square` selects
which — the real source's own three-way Material/StyleTow/FillTow
branching always collapses to just those two visual outcomes either way)
with no wrapping `<g>` and no `data-name` (same gap Road's own source has).
Reuses `Radius` (doubling as the square variant's own half-width — the
real source's own Radius/w constants always share one value) and
`Fill`/`Stroke` (unset falls back to "none"/"gray", the real corpus's own
dominant look) — `StrokeWidth` isn't modeled, the real source hardcodes 1
with no per-instance variance to justify a field. `Orient` still
round-trips a real instance's own `rotate(angle,x,y)` for fidelity, but is
visually inert either way (a circle has no orientation; an axis-aligned
square is 4-fold symmetric, and this editor only ever places one at
0/90/180/-90) — Properties hides both Orientation and Mirror entirely, the
same treatment Lamp's own equally-inert Orientation already gets. Verified
against 2961 real corpus instances (zero shape-292 extraction failures,
geometry/fill/stroke/square/orient all matching) — the 4 total extraction
failures found across that same corpus run were pre-existing PowerTransformer
(shape 47) edge cases, unrelated. **1** Линия/Line (the very first
xsde2svg `ObjectType` code — originally the canonical example of "a
generic draw primitive," explicitly excluded by name in this same
section's own header, until the user asked for it anyway, same as
113/335/292 above): a purely decorative generic line, not real electrical
equipment — its own geometry is an arbitrary multi-vertex `Points`
polyline, `BusBarSection`'s/Road's own convention, reusing `Stroke`/
`StrokeWidth` (both genuinely vary per real instance — real corpus shows
black/gray/white/red/yellow/hex colors, widths 1-10) with no `Fill` of its
own (an open line, like Arrow/Road). Unlike Road, its own color is never
even loosely voltage-like in the real source — it comes purely from a
line-style table — so there's no ambiguity there. Also gained a new
`LineStyle` field (reusing `ConnectorLineStyle`, the same solid/dashed/
dashDot enum a `CableLine` connector's own `lineStyle` already uses, but
resolved through its own real dash values — `"6,5"`/`"9 2 2 2"`, different
literal numbers than `CableLine`'s own `"70 20 25 20"` — confirmed
genuinely used in ~10% of real corpus instances found; `dotted` has no
real source counterpart for this shape and is never produced by
`Extract`). No wrapping `<g>` and no `data-name` (same gap Road's own
source has); `writeLine`/`parseLine` don't reuse `writePolyline` for the
dash portion — the same "resolve the real dash string first, don't rely
on a generic bool flag" approach `writeNamedLine` already uses for a
`CableLine` connector's own dash. Verified against both real corpus
directories found on disk (`sld`/`sld1`, ~25,900 real Line instances
combined): zero shape-1 extraction failures, and the dash-pattern
breakdown (25078 solid / 775 dashed / 2 dashDot) matches the real
`stroke-dasharray` counts found by direct search almost exactly. **399** Автомат силовой/Power circuit breaker (a real two-terminal
switching device with its own new two-state class, `PowerCircuitBreaker`:
Disconnector's own body plus a state-driven blade and a small filled
square beside it that moves with it, checked against 1,245 real corpus
instances; the template defaults to the real source's own, more common
xMirror==1 geometry, and `Extract`'s `parsePowerCircuitBreaker` sets
Mirror=true for an xMirror==0 instance; `parseSubpaths` now tolerates the
bare trailing `m` every real closed instance's blade path ends with). **16** Многоугольник/Polygon (a decorative closed
shape, new `Polygon` class reusing Points/Fill/Stroke/StrokeWidth/
LineStyle — a bare `<polygon>` exactly as the real source draws it; only
the real source's own dotted/dash-dot styles are offered; drawn
pen-tool style — one click per vertex, click the first vertex (or Enter)
to close, Backspace removes the last vertex, Esc cancels — then edited one
vertex at a time; all 169
real instances across 64 files extract, none fail).

**320001** Направление перетока/Powerflow direction — a purely decorative
annotation glyph (no Ports/Voltage, never a connectElements/routing
endpoint), not the usual template-substitution shape: a single bold arrow
character ("→"/"←", selected by State the same nil-defaults-to-0
convention every other State field uses) drawn at its own anchor, rotated
by the ordinary Orient mechanism. Reuses two existing Element fields
rather than adding new ones — State for the two-way direction, TextColor
(previously Button-only) for the glyph's own fill color, resolved from
the real source's own Color1, not from any VoltageClass. No wrapping `<g>`
and no `data-name`, same convention Line/Road/PostPole already use; a
dedicated `writePowerflowIndicator`/`parsePowerflowIndicator` bypass the
template lookup/generic parse the same way those do. Unlike PostPole's
own conditional rotate, the real source always emits both the `rotate()`
transform and its own `data-angle` attribute even at angle 0, so Orient is
read directly from `data-angle` on Extract rather than via `parseRotate`.
Verified against both real corpus directories found on disk (`sld`/`sld1`,
5,872 real instances combined): zero shape-320001 extraction failures,
matching the raw `data-type="320001"` count found by direct search
exactly.

**312** Таблица/Table — a purely decorative annotation box, drag-two-corners
like Rectangle/Button. Real source (`element_312.go`) only actually draws
the simple case modeled here (≤2 corner Points; a real instance with more
than that — an attempt at a real multi-cell grid via this shape — is
explicitly skipped by the real exporter itself, telling the operator to
use 313 instead) — found **zero** real corpus instances of `data-type="312"`
in either corpus directory, so this one's correctness rests on matching
the real source's own formula exactly rather than corpus confirmation.
Reuses existing fields entirely, no new ones: Fill/Stroke/StrokeWidth/
Points (Rectangle/Button's own convention), LineStyle (Line's own dash
enum, but its own real dash values — `"6,5"`/`"70 20 25 20"`, a
coincidental partial overlap with Line's own and a `CableLine` connector's
own respectively, not a pattern), PropertyText/TextColor (Button's own
centered-label convention), and — new reuse — Orient, which (uniquely
among every Points-based shape so far) rotates just the label around the
box's own center, not the box itself.

**313** Таблица 2/Table 2 — a purely decorative multi-row/multi-column
grid, click-to-place (starts as a small default 2×2 grid — see
`diagramOps.table2Defaults`) since its own real geometry can't be
expressed as two dragged corners. New `RowHeights`/`ColumnWidths`/`Cells`
Element fields (a genuinely new "resizable grid" concept, unlike anything
ported before this) — deliberately **not modeled**: the real source's own
cell-merging (a real instance using it still extracts, its own
would-be-merged cells just render separately) and multi-paragraph cell
text (reduced to one line). Found 916 real `data-type="313"` cell
instances across 16 corpus files, but with **no id and no
table-membership marker of any kind** on a real cell — at this project's
own request, the real xsde2svg source itself (`element_312.go`/
`element_313.go`/`modus.go`) was changed to wrap a whole table's own
output in a single `<g id data-type="312"|"313">`, the same fix already
made for shapes 7/106/385/386, so Extract can recognize one at all — a
diagram exported by an xsde2svg build from before that fix simply doesn't
have its own table(s) recognized (same "not yet understood, skipped"
treatment 313 already implicitly had before this session, not a
regression). Within that wrapping `<g>`, row/column boundaries (and so
each cell's own position) are reconstructed purely from the cells' own
real drawn rectangle geometry — there's still no row/col index anywhere
in the format itself — verified end to end via a dedicated round-trip
test (render a known grid, parse the result straight back, confirm every
field matches) rather than real corpus, for the same reason 312 relies on
one. Properties UI covers row/column count (resizing preserves every
still-valid cell), per-row height/per-column width, and per-cell text;
per-cell Fill/TextColor overrides aren't editable there yet (still
correctly stored/rendered for anything Extract recovers).

Deferred — real xsde2svg shapes whose own source (`xsde2svg/internal/modus/
element_<code>.go`) is substantially more involved than the shapes above,
each needing its own dedicated pass rather than a quick port:

- **55** Трансформатор напряжения (voltage transformer) — not a simple
  symbol: variable winding count (2/3/4), per-winding color, and six
  different connection-type geometries (wye/delta/zigzag/...). Porting it
  faithfully means adding a real winding-configuration concept to the
  schema, closer in scope to redesigning `PowerTransformer` support than
  adding a shape.

Deliberately out of scope (decorative/structural, not real electrical
equipment — same reasoning that already excludes every shape below;
Rectangle (3), Arrow (2), Circle (4), Line (1), Button (113), Road (335),
and Table (312) are the seven generic draw primitives, Table2 (313) the
one resizable-grid shape, and Post-type pole (292) the one anchor-based
marker, that *have* been ported, see above): Polygon
(16, the one remaining generic draw primitive — a closed, filled shape,
structurally closer to Rectangle than Line, but not yet checked against
real corpus), other poles/pylons (19/146 — anchor/angle pole, power pole —
neither confirmed to share 292's own simple round-or-square geometry),
power-plant/substation pictogram icons (38/360), chassis/half-chassis cart
graphics (51/52), a decorative connector-arrow (83),
a small-window HMI decoration (319, structurally unrelated to Table2 despite
the "table/window" grouping this line used to lump them under), and a
generic "Device" placeholder (130, too vague to know what it actually
draws).

## Known pre-existing extract gaps

None currently known. The one gap previously listed here —
`PowerTransformer` (47) only supporting the 2-winding case, with a real
corpus's 3-winding transformers landing in `Report.Failed` — was already
fixed in an earlier session without this section being updated to say
so; re-verified against `sld-svg/translated/Examples.svg` (the real
corpus file the old note's own "2 such instances" count came from):
`parsePowerTransformer` now supports 2/3/4 windings, `Report.Failed` is
empty, and both of that file's own 3-winding transformers (ids 1267,
4438) extract with `len(Windings) == 3` correctly.
