# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It is an
index plus what the code can't tell you; read the referenced files and their doc comments for how things work.
History lives in RELEASE.md.

## Common requirements

- Before implementing anything, always first briefly describe what you'll be doing and ask for my consent.
- After implementation, write down in RELEASE.md file what was implemented in the format "Date: Implementation
  Description"
- Use i18n
- When changing an API (a REST endpoint's path/params, or a request/response shape), find and check every caller of it —
  both backend (other handlers/services) and frontend — and update them too.
- Use Go 1.26
- Don't use a lot of code comments. For function describe arguments and results. The best comments is a code.
- use go fix ./...
- Do not use actual diagram names in comments or in files saved in Git

## What this is

SCADA-style Single Line Diagram editor: Go + Gin backend (diagram storage, SVG rendering, `.xsde`/SVG/CIM import, CIM
export) and React + Vite + TS + Tailwind frontend (interactive canvas). No database, no login (users known by IP).

## Sibling repositories

| Repo | Relationship |
|---|---|
| `PVKonovalov/slddoc` (`../slddoc`, `replace` in `backend/go.mod`) | **Required.** The diagram model: types, `.xsld` XML Load/Save (`XSLD_FORMAT.md`), SVG `Render`/`RenderFragments`, `Extract` (SVG → diagram), `Repair`, `EnsureIDs`, CIM export/import and layout. The root package re-exports the API of `internal/{model,svgtree,render,extract,repair,cim}` (`slddoc.go`); `internal/` can't be imported from here. Its tests run there. |
| `EMA/xsde2svg` (`~/repo/EMA/xsde2svg`, `replace` in `backend/go.mod`) | **Required.** Modus `.xsde` → SVG converter used in-process (`pkg/xsde2svg.Convert`). `backend/assets/xsde2svg.yml` and `workplace.xml` are copies of its files (shipped by `make package`); `make docker-build` mounts it from `XSDE2SVG_DIR`. |
| `OrxaGridMicroservices/rdss-dms` (formerly `sld-viewer`) | Consumer of the exported `.svg`: reads `id`, `data-type`, `data-name`, `data-voltage`, `data-state`, `data-fill`, `data-event`. **SVG markup problems are fixed here, not worked around in rdss-dms.** Its `assets/sld/*.svg` are real xsde2svg corpus files — verify output against them. State colors (`data-fill`, states 0–3) must match its state mapping. |
| `OrxaGridMicroservices/rdss-dms-nca` | Every symbol code (`data-type`, e.g. 6-digit `330001`) needs a `sld.sld_element_type` row (with its CIM class) in its `db/init/dms_schema_all.sql` + patch, or linking equipment in rdss-dms fails. |
| `PVKonovalov/sld-svg` | Reference: canonical slddoc format and its `svg-sld` CLI. |
| SOPTIM `CIMDiagramLayoutEditor`, PowSyBl (`tools/cim-tools`, Maven, outside `make`) | CIM export interop checks; see `docs/CIM_INTEROP.md`. |

## Commands

```
cd backend && go run ./cmd/sld-editor -config config/sld-editor.yaml [-open-browser]   # :8090
cd backend && go build ./... && go vet ./... && go test ./...
cd frontend && npm run dev | dev:ru     # :5173, proxies /api to :8090
cd frontend && npm run build            # the only frontend check (no tests, no linter)
make | make linux|windows|macos|linux-en|macos-arm64-ru|docker-build|package|release|clean
```

`make` builds one self-contained binary per OS/arch/locale with the frontend embedded (`backend/internal/webui`).
`VERSION` from `git describe` → `__APP_VERSION__` and `-X main.version`. Never commit `frontend/src/i18n/active.ts` or
`backend/internal/webui/dist/*` (only `.gitkeep`).

## Index

- Docs: `README.md` (build/run/packaging), `backend/assets/USER_GUIDE.md` + `.ru.md` (in-app guide), `TODO.md`,
  `elements.md` (xsde2svg shapes being ported), `docs/CIM_INTEROP.md`.
- Backend: `cmd/sld-editor/main.go`; `internal/config` (`config/sld-editor.yaml`: palette, hot keys, voltage/state
  colors, `cim`, `xsde:`), `internal/elements` (XML symbol libraries, `assets/elements/base.xml`,
  palette/hot-key validation at startup), `internal/storage` (filesystem store, `.xsld` + rendered `.svg`, history),
  `internal/api` (all routes; `repair.go`, `cim.go`, `folders.go`, `presence.go`, `custom_elements.go`,
  `user_guide.go`), `internal/presence`, `pkg/configuration`, `pkg/llog`.
- Custom elements: `custom-elements/` (tracked `.xsld` fragments, shipped by `make package`).
- Frontend `src/`: `state/DiagramContext.tsx` (+ `useDiagramContext.ts`; single source of truth, undo/redo,
  `confirmLeave`, drafts), `lib/api.ts` (only backend caller), `lib/diagramOps.ts` (pure `Diagram → Diagram` edits),
  `components/Canvas.tsx` (pan/zoom, rendering transactions, hit-testing, drag, routing, copy/paste),
  `components/panels/*`, `lib/paletteItem.ts`, `lib/drafts.ts`, `lib/picture.ts`, `lib/guide.ts`, `types/index.ts`
  (hand-kept mirror of Go JSON), `i18n/`.

## Rules not derivable from code

- **Diagram name/dir is always a query parameter, never a path segment** (Gin params can't carry `/`).
- `.xsld` is the source of truth; the `.svg` is rendered on save. Writes are atomic under a store-wide lock.
- Ids are ints in one shared space, 0 = unset; only the frontend's `IdSequence` assigns them (seeded from
  `Diagram.LastID`). `Element.Shape` is a string library key.
- Opening and `.xsld` import run only `EnsureIDs`; topology repair runs only after `.svg`/`.xsde` import and on explicit
  "Repair diagram". **`slddoc.Repair` (slddoc `internal/repair/repair.go`) is a rule-for-rule Go port of `diagramOps.ts`'s fixed-ports/topology
  functions — keep the two in step.** Repair never moves an existing node.
- Ports are fixed per shape (N terminals → ports `"1"…"N"`); a BusBarSection is the exception (one port per
  connection point; downstream topology merges them).
- `Load` rewrites shape `"71"` → `"162"`: drop that rewrite once shape 71 is ported as its own type.
- `RenderMode.Static` (saved `.svg`, downloads) must stay xsde2svg-faithful (absolute coordinates); `Interactive` is
  canvas-only (local frames, `data-editor-kind`, wider hit targets). Connector kinds use type codes 21/22/23/28.
- Every edit goes through `updateDiagram` + `diagramOps`; untouched entries keep their object reference
  (`diffDiagramForRender` relies on it). Other diagram writes go through `commitDiagram`. Selection and armed tools are
  mutually exclusive, except selecting doesn't clear `armedWireKind`.
- Canvas rendering is one request at a time, never cancelled, no timers. Plain left-drag pans and never moves items;
  the move/frame modifier is Ctrl/Cmd (Cmd only on macOS). The grid overlay must sit above the server markup.
- Guide heading ids (`{#id}`) must be identical in both languages and stable (dialogs link to them). Every config key
  and the xsde2svg files are documented in the guides' `#configuration` section — keep it in step.
- The symbol ↔ CIM class mapping, both ways, lives only in the YAML's `cim:` (`classes` for export, `import` for
  import); slddoc has no built-in table. A new exported symbol needs a `classes` row, a new CIM class an `import` row.
- Router trusts `X-Forwarded-For` only from loopback.
- `DiagramContext` is split into two files to keep Vite Fast Refresh working.
