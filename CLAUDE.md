# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common requirements

- Before implementing anything, always first briefly describe what you'll be doing and ask for my consent.
- After implementation, write down in RELEASE.md file what was implemented in the format "Date: Implementation
  Description"
- Use i18n
- When changing an API (a REST endpoint's path/params, or a request/response shape), find and check every caller of it —
  both backend (other handlers/services) and frontend — and update them too.
- Use Go 1.26

## What this is

A monorepo SCADA-style Single Line Diagram (SLD) editor for Power/Energy control engineers: a Go backend (diagram
storage, SVG rendering, xsde2svg SVG import) and a React + Vite + TypeScript + Tailwind + lucide-react frontend
(interactive canvas editing). Its diagram files follow the xsde2svg/slddoc conventions.

Other docs in this repo: `README.md` (build/run/packaging), `RELEASE.md` (dated changelog, where each feature's full
history lives), `TODO.md` (planned work, incl. the "Reducing frontend/backend traffic" design), `elements.md` (the
xsde2svg shape list being ported one shape at a time).

## Commands

Backend (from `backend/`):

```
go run ./cmd/sld-editor -config config/sld-editor.yaml                 # binds 0.0.0.0:8090
go run ./cmd/sld-editor -config config/sld-editor.yaml -open-browser   # also opens the UI
go build ./... && go vet ./... && go test ./...
go test ./internal/storage/... -run TestName                           # single test
```

The diagram model lives in the sibling module `github.com/PVKonovalov/slddoc` (`replace` → `../../slddoc` in
`backend/go.mod`). That repo must be checked out next to this one. Its own tests run from `../slddoc`
(`go test ./... -run TestName`), and `../slddoc/FORMAT.md` documents the `.xsld` format.

Frontend (from `frontend/`): `npm install` once, then `npm run dev` (Vite on `:5173`, proxies `/api` to `:8090`; the
backend must be running) or `npm run dev:ru` for the Russian UI. `npm run build` (`tsc` + `vite build`) is the only
check: there are no frontend tests and no linter. `build:en`/`build:ru` write to `dist-en/`/`dist-ru/`.

Production (from the repo root): `make` cross-compiles one self-contained binary per (OS/arch, locale) with the
frontend embedded (`backend/internal/webui`, `//go:embed all:dist`). Targets: `make linux|windows|macos`,
`make linux-en`/`macos-arm64-ru`/…, `make docker-build` (linux+windows in a pinned container), `make package`
(tarball of `build/` + config + assets), `make release`, `make clean`. `VERSION` comes from `git describe`
(override with `make VERSION=…`), is passed to Vite as `APP_VERSION` (`__APP_VERSION__`, shown in the About dialog)
and to Go as `-X main.version` (printed by `-version`).

Generated files are never committed: `frontend/src/i18n/active.ts` and `backend/internal/webui/dist/*` (only
`dist/.gitkeep` is tracked; the Makefile recreates it).

## Architecture

### Backend (`backend/`)

`cmd/sld-editor/main.go` loads the YAML config, loads the element libraries, validates the palette, and wires up
storage and the Gin API.

- `internal/config`: the `Config` struct (`config/sld-editor.yaml`), read by `pkg/configuration` (YAML plus `env:"true"`
  env-var overrides). It holds editor defaults, `voltage_colors` presets, `state_colors`/FPI/position/indicator legends,
  and `palette`.
- `internal/elements`: merges the XML symbol libraries listed in `elements.libraries` (later files override shapes)
  into the palette catalog and a `slddoc.SymbolLibrary`. `backend/assets/elements/base.xml` is the bundled one. A
  symbol may declare `<terminals>`, real connection points in local coordinates, drawn by the canvas.
  `Library.ValidatePalette` checks every `palette` item at startup, so a typo fails loudly.
- `internal/storage`: filesystem store under `diagrams.dir`. `Save` always writes `.xsld` (source of truth) plus a
  rendered `.svg`. A missing symbol is a non-fatal render warning. Names are `/`-separated paths (subfolders), and
  every segment is validated (`ErrInvalidName`). `List(dir)` returns one folder level only.
- `internal/api`: routes under `/api` — `diagrams` (list/create), `diagrams/open`, `diagrams/save`, `diagrams/svg`,
  `render`, `render/fragments`, `import/xml`, `import/svg` (runs `slddoc.Extract`, returns `{diagram, report}`),
  `elements`, `custom-elements`, `config`. **A diagram name/dir is always a query parameter, never a path segment**, because Gin params
  can't carry `/`. Errors map as `ErrInvalidName`→400, `ErrNotFound`→404, `ErrExists`→409.
- Custom elements: `custom_elements.dir` (`../custom-elements`, tracked in git; `CB.xsld` is the example) holds
  ordinary `.xsld` diagrams used as predefined fragments. `main.go` opens it as a second `storage.Store`, and
  `GET /api/custom-elements` (`internal/api/custom_elements.go`) returns every file directly inside it as
  `[{name, diagram, svg}]`, where `svg` is a Static render used as the palette icon. `PUT /api/custom-elements?name=`
  saves one (bare file name only; 409 on an existing name unless `&overwrite=1`). `make package` ships the folder.
- `pkg/configuration`, `pkg/llog`: shared MIT-licensed utilities carried over from other projects.

### The `slddoc` model (sibling module)

- `Diagram`/`Layer`/`VoltageClass`/`Node`/`Element`/`Connector`/`Label`, XML `Load`/`Save`, SVG `Render`,
  `RenderFragments`, and `Extract` (xsde2svg SVG → diagram).
- **Ids are plain `int`s in one shared id space. 0 means "unset"**, since real ids start at 1. `Element.Shape` is the
  exception: it's a symbol-library key string like `"41"`. The backend never assigns ids. The frontend's `IdSequence`
  does, seeded from the round-tripped `Diagram.LastID`.
- `Editor` block: grid, snap, show grid/nodes, background, defaultVoltage. It round-trips, but only the background
  affects rendering.
- `Load` rewrites legacy values: connector kind `"ObjectLink"` → BusWork, and shape `"71"` → `"162"`. See memory: the
  71→162 rewrite must go once shape 71 is ported as its own type.
- `RenderMode`: `Static` is a clean, xsde2svg-faithful document (the saved `.svg` and its downloads). `Interactive`
  also adds `data-editor-kind="element|connector|label|digitaldevice"` and wider hit targets, and is used only by the
  live canvas. `id`/`data-name`/`data-voltage`/`data-type`/`data-fill`/`data-state` are emitted in both modes.
- Connector kinds render with xsde2svg type codes `21`/`22`/`23`/`28` (BusWork/OverheadLine/CableLine/LinkToObject).
  Overhead and cable lines are wrapped in a named `<g>`.
- When matching xsde2svg output, verify against real corpus files (e.g. `sld-viewer/assets/sld/*.svg`).

### Frontend (`frontend/src/`)

- `state/DiagramContext.tsx` + `useDiagramContext.ts`: the single source of truth. It holds the open diagram, dirty
  flag, folder browser (`currentDir`/`diagrams`, set together only via `browseDir`), catalog/config, and selection.
  Selection and "armed" tools are mutually exclusive: selecting or arming any of element/connector/label/symbol/wire
  kind clears the others. The exception is that selecting does *not* clear `armedWireKind`. Also here: import flows
  (single file → `pendingImport` confirm when the name exists; multi-file → `batchImport`) and the default-voltage
  prompt. Split into two files to keep Vite Fast Refresh working.
- `lib/api.ts`: the only backend caller. It normalizes Go `null` slices to arrays.
- `lib/diagramOps.ts`: pure, immutable `Diagram → Diagram` editing functions (place/move/connect/route/splice/
  reshape/delete/copy-paste/voltage classes/layers). Every edit goes through these via `updateDiagram`. Untouched
  entries keep their object reference, which `diffDiagramForRender` relies on. `placeCustomElement` copies a whole
  custom element with fresh ids while keeping its node topology (unlike `pasteGroup`, which drops wire-to-wire
  junctions), and maps voltages by class name, falling back to the default voltage. `extractSelection` is its
  inverse, used by the canvas context menu's "Save as custom element…" (`SaveCustomElementDialog`). Copy/Paste
  use the same pair: the clipboard is an `extractSelection` diagram, pasted with `placeCustomElement`.
- **Ports are fixed per shape** (the "Fixed ports and node topology" section at the end of `diagramOps.ts`). A
  device whose shape declares N terminals (`symbolTerminals`: base.xml `<terminals>`, or a transformer's windings)
  always has exactly N ports, `"1"`…`"N"` in terminal order, each on its own node at the terminal. Wiring never adds
  a port (`attachElementEnd` picks the terminal's port node, so wires on one terminal share it); only a
  `BusBarSection` still gets a new port per tap. `placeElement` creates them (`fitElementPorts`), Properties edits
  re-fit them with `moveNodes` (orientation/mirror/position/size carry port nodes and wire ends along), and
  `moveSelection` joins a zero-length wire's ends (`removeDegenerateConnectors`) and a dropped terminal to whatever
  lies exactly under it (`joinPortNodes`: merges a node, splits a wire, or taps a busbar). `normalizeTopology`
  repairs older diagrams on open/import and when a copied group lands, never moving an existing node (an imported
  diagram may use one node for a whole busbar).
- `components/Canvas.tsx`: pan/zoom (`react-zoom-pan-pinch`, double-click zoom disabled) and all interaction.
  - **Hit-testing:** reads `data-editor-kind` + `Number(id)` from the server-rendered SVG.
  - **Rendering:** debounced. Each change is diffed against the last render: `'patch'` fetches `/api/render/fragments`
    and swaps just those DOM nodes, `'full'` refetches `/api/render`, `'none'` skips.
  - **Dragging:** mutates the rendered DOM directly and commits to diagram state on mouseup.
  - **Overlays:** selection marks, terminals, nodes, and the grid are separate `<svg>` layers drawn from diagram
    state. The grid must sit above the server markup, which paints an opaque background.
  - **Routing:** only starts while a wire kind is armed from the palette. It starts from a terminal, from
    Ctrl/Cmd-click on a busbar or connector, or from a double-click on empty canvas. A tap on a connector splits it
    into two halves sharing a junction Node.
- `components/panels/*`: File (New/Open/Import, folder browser), Elements (renders `config.palette`; item
  classification in `lib/paletteItem.ts` mirrors `ValidatePalette`; a final "Custom elements" group comes from
  `DiagramContext.customElements`, armed via `armCustomElement`), Settings, and Properties (right-docked, can stay
  open with the palette; its nothing-selected view holds the diagram's Save/Export, Layers and Voltage classes).
- `types/index.ts`: hand-kept mirror of the Go JSON shapes. Update it whenever a backend shape changes.
- `i18n/`: build-time locale, no runtime switcher. `en.ts` is canonical (`as const`), `ru.ts` is typed
  `Record<keyof Dictionary, string>` (a missing translation fails to compile), and `index.ts`'s `t(key, params)`
  imports only the generated `active.ts`. Every user-facing string goes through a key.

## Reference repos (siblings on disk)

- `slddoc`: the diagram model this backend depends on.
- `sld-svg`: the canonical slddoc format and its `svg-sld` CLI.
- `sld-viewer`: the UI/UX and backend-stack reference (a heavier, DB-backed SCADA viewer), plus real xsde2svg corpus
  SVGs under `assets/sld/`.
