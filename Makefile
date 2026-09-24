# Production build for sld-editor: a single self-contained binary per
# (OS/arch, locale) combination, with the frontend's own production build
# embedded directly into the Go binary (see backend/internal/webui's own
# doc comment) — no separate static file host or reverse proxy needed to
# deploy it. Day-to-day development is untouched by any of this: keep
# running `npm run dev`/`npm run dev:ru` from frontend/ and
# `go run ./cmd/sld-editor -config config/sld-editor.yaml` from backend/
# exactly as before (see CLAUDE.md).
#
# Requires a Go toolchain able to cross-compile linux/windows/darwin amd64
# and arm64 (the standard library alone; sld-editor has no cgo
# dependencies, so no C toolchain is needed for any target) and Node for
# the frontend build. If you'd rather not install those locally,
# `make docker-build` runs this same Makefile inside a container with
# both pinned — see Dockerfile.build (Linux/Windows targets only: a
# Linux container's own Go toolchain can't produce a codesigned macOS
# binary, and this project doesn't attempt to).
#
# sld-editor's own backend/go.mod points its "github.com/PVKonovalov/
# slddoc" dependency at the sibling ../../slddoc checkout (a separate
# repo, not vendored into this one) via a replace directive — every
# target below assumes that sibling directory already exists next to
# this repo's own checkout, the same way `go run`/`go build` already
# require for ordinary development.
#
# Each locale/OS/arch target's own recipe re-invokes `$(MAKE) frontend-*`
# as its own first step, rather than listing frontend-en/frontend-ru as an
# ordinary prerequisite shared across sibling targets: GNU Make only runs
# a given .PHONY target's own recipe once per top-level `make` invocation,
# even when several other targets depend on it, so `make all`'s own
# windows-en and linux-en (say) would otherwise silently share whichever
# locale's frontend build happened to run *last* instead of each getting
# its own correct one — a real bug this project hit building the very
# first version of this Makefile, verified by grepping the compiled
# binaries for a locale-exclusive UI string. A recursive `$(MAKE)` call is
# its own fresh invocation with its own once-per-target bookkeeping, so it
# reliably reruns every time.
#
# Usage:
#   make                 # every OS/arch x locale combination
#   make linux           # linux/amd64, both locales
#   make windows         # windows/amd64, both locales
#   make macos           # darwin/arm64, both locales
#   make linux-en
#   make linux-ru
#   make windows-en
#   make windows-ru
#   make macos-arm64-en
#   make macos-arm64-ru
#   make docker-build    # linux+windows targets, run inside a pinned container
#   make package         # build/sld-editor-<VERSION>.tar.gz from whatever is built
#   make release         # all + package
#   make clean

.PHONY: all linux windows macos \
        linux-en linux-ru windows-en windows-ru \
        macos-arm64-en macos-arm64-ru \
        frontend-en frontend-ru docker-build package release clean

# VERSION is the build's own version, from the git tag it was built from
# (e.g. v1.0.0, v1.0.0-3-gabc1234 for commits after it, a -dirty suffix
# for uncommitted changes), "dev" without git. Override with
# `make VERSION=v1.2.0`. Baked into both the frontend (APP_VERSION, read
# by frontend/vite.config.ts) and the Go binary (-X main.version).
ifeq ($(origin VERSION),undefined)
VERSION      := $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
endif
export VERSION
GO_LDFLAGS   := -X main.version=$(VERSION)

BUILD_DIR    := build
FRONTEND_DIR := frontend
BACKEND_DIR  := backend
WEBUI_DIST   := $(BACKEND_DIR)/internal/webui/dist
DOCKER_IMAGE := sld-editor-build
PACKAGE_NAME := sld-editor-$(VERSION)
PACKAGE_DIR  := $(BUILD_DIR)/.package

all: linux windows macos

linux: linux-en linux-ru

windows: windows-en windows-ru

macos: macos-arm64-en macos-arm64-ru

linux-en: $(BUILD_DIR)
	$(MAKE) frontend-en
	cd $(BACKEND_DIR) && GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "$(GO_LDFLAGS)" -o ../$(BUILD_DIR)/sld-editor-linux-en ./cmd/sld-editor

linux-ru: $(BUILD_DIR)
	$(MAKE) frontend-ru
	cd $(BACKEND_DIR) && GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "$(GO_LDFLAGS)" -o ../$(BUILD_DIR)/sld-editor-linux-ru ./cmd/sld-editor

windows-en: $(BUILD_DIR)
	$(MAKE) frontend-en
	cd $(BACKEND_DIR) && GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$(GO_LDFLAGS)" -o ../$(BUILD_DIR)/sld-editor-windows-en.exe ./cmd/sld-editor

windows-ru: $(BUILD_DIR)
	$(MAKE) frontend-ru
	cd $(BACKEND_DIR) && GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$(GO_LDFLAGS)" -o ../$(BUILD_DIR)/sld-editor-windows-ru.exe ./cmd/sld-editor

macos-arm64-en: $(BUILD_DIR)
	$(MAKE) frontend-en
	cd $(BACKEND_DIR) && GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags "$(GO_LDFLAGS)" -o ../$(BUILD_DIR)/sld-editor-macos-arm64-en ./cmd/sld-editor

macos-arm64-ru: $(BUILD_DIR)
	$(MAKE) frontend-ru
	cd $(BACKEND_DIR) && GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags "$(GO_LDFLAGS)" -o ../$(BUILD_DIR)/sld-editor-macos-arm64-ru ./cmd/sld-editor

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

# Builds one locale's frontend and copies it into the backend's own
# webui/dist/ so the very next `go build` embeds it. Always invoked via a
# recursive `$(MAKE)` call (see this file's own top comment), never as a
# plain shared prerequisite.
frontend-en:
	cd $(FRONTEND_DIR) && npm install && APP_VERSION=$(VERSION) npm run build:en
	rm -rf $(WEBUI_DIST)
	mkdir -p $(WEBUI_DIST)
	cp -r $(FRONTEND_DIR)/dist-en/. $(WEBUI_DIST)/

frontend-ru:
	cd $(FRONTEND_DIR) && npm install && APP_VERSION=$(VERSION) npm run build:ru
	rm -rf $(WEBUI_DIST)
	mkdir -p $(WEBUI_DIST)
	cp -r $(FRONTEND_DIR)/dist-ru/. $(WEBUI_DIST)/

# Runs this same Makefile's own linux/windows targets inside a container
# with Go/Node pinned (see Dockerfile.build), rather than requiring either
# on the host — macOS targets are deliberately excluded, since a Linux
# container's own Go toolchain, while able to *cross-compile* a darwin
# binary, can't codesign one, and this project doesn't attempt to build
# unsigned macOS binaries this way. Mounts the *parent* of this repo, not
# just this repo, so the sibling ../../slddoc checkout backend/go.mod's
# own replace directive needs is visible inside the container at the same
# relative path — the build artifacts land in this repo's own build/
# directly via that mount, no extraction step needed afterward.
docker-build:
	docker build -t $(DOCKER_IMAGE) -f Dockerfile.build .
	docker run --rm -v "$(abspath ..)":/workspace -w /workspace/sld-editor $(DOCKER_IMAGE) make linux windows VERSION=$(VERSION)

# Packs whatever binaries are in build/ (every OS/arch x locale built so
# far; older archives and stray *.gz files are left out) into
# build/sld-editor-<VERSION>.tar.gz, under one top-level
# sld-editor-<VERSION>/ folder, together with what they need at runtime:
# config/sld-editor.yaml and assets/elements/ fresh from backend/ (the
# config's diagrams dir rewritten from "../diagrams" — relative to
# backend/ during development — to "diagrams", next to the binaries) and
# an empty diagrams/ folder. Run a binary from inside that folder so its
# default -config config/sld-editor.yaml resolves.
package:
	@ls $(BUILD_DIR)/sld-editor-* 2>/dev/null | grep -v -e '\.gz$$' >/dev/null || \
		{ echo "no binaries in $(BUILD_DIR)/ - run make (or a platform target) first" >&2; exit 1; }
	rm -rf $(PACKAGE_DIR)
	mkdir -p $(PACKAGE_DIR)/$(PACKAGE_NAME)/config $(PACKAGE_DIR)/$(PACKAGE_NAME)/assets $(PACKAGE_DIR)/$(PACKAGE_NAME)/diagrams
	for f in $(BUILD_DIR)/sld-editor-*; do \
		case "$$f" in *.gz) ;; *) cp "$$f" $(PACKAGE_DIR)/$(PACKAGE_NAME)/ ;; esac; \
	done
	cp -R $(BACKEND_DIR)/assets/elements $(PACKAGE_DIR)/$(PACKAGE_NAME)/assets/
	sed 's|dir: "\.\./diagrams"|dir: "diagrams"|' $(BACKEND_DIR)/config/sld-editor.yaml > $(PACKAGE_DIR)/$(PACKAGE_NAME)/config/sld-editor.yaml
	COPYFILE_DISABLE=1 tar -czf $(BUILD_DIR)/$(PACKAGE_NAME).tar.gz -C $(PACKAGE_DIR) $(PACKAGE_NAME)
	rm -rf $(PACKAGE_DIR)
	@echo "created $(BUILD_DIR)/$(PACKAGE_NAME).tar.gz"

# Builds every target, then packages them.
release: all
	$(MAKE) package

clean:
	rm -rf $(BUILD_DIR)
	rm -rf $(WEBUI_DIST)
	mkdir -p $(WEBUI_DIST)
	git -C $(BACKEND_DIR)/internal/webui checkout -- dist/index.html 2>/dev/null || true
