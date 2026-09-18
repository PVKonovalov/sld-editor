// Package webui embeds the frontend's own production build (an already
// locale-baked dist-en/dist-ru — see frontend/package.json's own build:en/
// build:ru scripts) into the backend binary, so a single executable can
// serve both the API and the UI with no separate static file host or
// reverse proxy needed.
//
// go:embed can't pick a directory at build time based on an environment
// variable or build tag alone without maintaining two near-identical
// embed directives, so instead the production build script (see the
// repo root Makefile) copies whichever locale's built frontend it wants
// into this package's own dist/ directory immediately before invoking
// `go build` — this file always embeds "whatever's currently in dist/".
// dist/ itself always carries at least a placeholder index.html (see its
// own comment) so `go:embed` never fails for an ordinary `go run`/
// `go build`/`go vet`/`go test` outside that build script, where dist/
// was never populated with a real frontend build at all.
package webui

import "embed"

//go:embed all:dist
var Dist embed.FS
