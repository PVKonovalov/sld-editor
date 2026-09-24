# sld-editor
Single Line Diagram Editor

A SCADA-style Single Line Diagram editor for Power/Energy control engineers: a Go
backend (diagram model, XML storage, SVG rendering) and a React/TypeScript frontend
(interactive canvas editing).

# Development

Run the backend from `backend/` (binds `0.0.0.0:8090` by default):

```
go run ./cmd/sld-editor -config config/sld-editor.yaml
go run ./cmd/sld-editor -config config/sld-editor.yaml -open-browser
```

`-open-browser` opens the editor's URL in the default browser once the server
starts listening.

Build/vet/test the backend, all from `backend/`:

```
go build ./...
go vet ./...
go test ./...
```

The backend depends on the sibling `slddoc` module (`../../slddoc` relative to this
repo, via a `replace` directive in `backend/go.mod`) — check that repo out next to
this one before building.

Run the frontend from `frontend/` (Vite dev server on `:5173`, proxying `/api` to
`:8090` — the backend must already be running):

```
npm install   # once
npm run dev
```

# Frontend locale
UI strings are picked at build time (no runtime language switcher). Each dev/build
script runs `scripts/generate-active-locale.mjs <locale>` first, which (re)writes
`src/i18n/active.ts` to re-export that locale's dictionary — the app itself imports
only that one file, so an unselected locale's strings are never even part of the
bundle. Adding a new language is just: add `src/i18n/<locale>.ts` (typed against
`en.ts`'s own keys, like `ru.ts`) and one `dev:<locale>`/`build:<locale>` script pair.

```
npm run dev         # dev server, English (default)
npm run dev:en      # dev server, English
npm run dev:ru      # dev server, Russian

npm run build       # production build, English (default) -> dist/
npm run build:en    # production build, English -> dist-en/
npm run build:ru    # production build, Russian -> dist-ru/
```

# Production build

`make` (from the repo root) produces a single self-contained binary per
(OS/arch, locale) combination, with the frontend's own production build embedded
directly into the Go binary — no separate static file host or reverse proxy needed
to deploy it. This doesn't change day-to-day development at all: keep using
`npm run dev`/`npm run dev:ru` and `go run ./cmd/sld-editor` exactly as above.

Requires a Go toolchain able to cross-compile linux/windows/darwin (amd64 and
arm64 — sld-editor has no cgo dependencies, so no C toolchain is needed) and Node
for the frontend build, plus the sibling `slddoc` checkout next to this repo (same
requirement as plain `go build`). If you'd rather not install those locally,
`make docker-build` runs the same build inside a pinned container (Linux/Windows
targets only — a Linux container can't produce a codesigned macOS binary).

```
make                 # every OS/arch x locale combination
make linux           # linux/amd64, both locales
make windows         # windows/amd64, both locales
make macos           # darwin/arm64, both locales
make linux-en
make linux-ru
make windows-en
make windows-ru
make macos-arm64-en
make macos-arm64-ru
make docker-build    # linux+windows targets, run inside a pinned container
make clean
```

Binaries are written to `build/`. Each one is a normal, standalone executable —
run it directly (`./sld-editor-linux-en -config config/sld-editor.yaml`, or
double-click the `.exe` on Windows) and it serves both the API and the embedded UI
on its own bind address.

### Version

The version is the git tag the build comes from (`git describe --tags --always
--dirty`: `v1.0.0`, `v1.0.0-3-gabc1234` for commits after the tag, `-dirty` for
uncommitted changes, `dev` without git). To release, tag first
(`git tag v1.1.0`), then `make`. Override it with `make VERSION=v1.2.0`. It is
shown in the UI's About dialog (sidebar, bottom) and printed by
`./sld-editor-linux-en -version`.
