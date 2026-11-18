# sld-editor
Single Line Diagram Editor

A SCADA-style Single Line Diagram editor for Power/Energy control engineers: a Go
backend (diagram model, XML storage, SVG rendering) and a React/TypeScript frontend
(interactive canvas editing).

For how to use the editor, see [the user guide](backend/assets/USER_GUIDE.md), also shown in the app by the
sidebar's Help button.

# Development

Run the backend from `backend/` (it listens on `server.bind`, `0.0.0.0:8099` in the shipped config). The configuration is local and not in git: create
it once from the tracked example, and put secrets such as database passwords in `backend/.env` (also not in git):

```
cp config/sld-editor.example.yaml config/sld-editor.yaml
```

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

The RSDU binding provider's integration tests (`internal/rsdu`) run only against a real RSDU database given as a
DSN URL, read-only: `RSDU_TEST_ORACLE=oracle://user:password@host:1521/service?sid=SID`,
`RSDU_TEST_POSTGRES=postgres://user:password@host:5432/rsdu` (both may add `&schema=` / `?schema=`).

The backend depends on the sibling `slddoc` module (`../../slddoc` relative to this
repo, via a `replace` directive in `backend/go.mod`) — check that repo out next to
this one before building. It also depends on the `xsde2svg` converter (the `.xsde` import), resolved the same way
from `../../../EMA/xsde2svg` (i.e. `EMA/xsde2svg` next to the folder holding this repo). Its `xsde:` config section
points at `assets/xsde2svg.yml` and `assets/workplace.xml`, bundled copies of that repo's files (empty values use the
converter's built-in settings). Every configuration key is described in [Configuration](#configuration).

Run the frontend from `frontend/` (Vite dev server on `:5173`, proxying `/api` to
`:8099` — the backend must already be running):

```
npm install   # once
npm run dev
```

# Configuration

The editor reads one YAML file, given by `-config` (default `config/sld-editor.yaml`, relative to the folder the
editor is started in). In the source tree it is local and not in git: copy `backend/config/sld-editor.example.yaml`,
the shipped configuration (`make package` puts it into the archive as `config/sld-editor.yaml`). Add or change keys
in the example, then copy them into your local file. The user guide's [Configuration](backend/assets/USER_GUIDE.md)
section describes the same keys for whoever runs the editor.

## How it is read

- **Order.** `sld-editor.yaml`, then `.env`, then the process environment. Each overrides the one before.
- **Environment variables.** A single value whose key is marked as overridable below can be set by a variable
  named after its key path in capitals, joined by `_`: `server.bind` → `SERVER_BIND`,
  `bindings.rsdu.dsn.password` → `BINDINGS_RSDU_DSN_PASSWORD`. An empty variable doesn't override. Booleans are
  true for `true`, `1` or `y` (any case), false otherwise. A list (`ELEMENTS_LIBRARIES`) is comma-separated and is
  **appended** to the list in the YAML. Maps and lists of objects (`palette`, `cim`, `voltage_colors`, …) can't be
  set this way.
- **`.env`.** `NAME=value` lines in `.env` in the folder the editor is started in, not in git. Blank lines, `#`
  comments, an `export ` prefix, quoted values and trailing ` # comments` are allowed. Secrets (database and object
  storage credentials) belong here or in the environment, never in either YAML file.
- **Paths.** Relative paths in the file are resolved from the folder the editor is started in, not from the file's
  own folder.
- **When.** Everything is read once at startup: restart the editor, then reload the page. The exceptions are
  `user_guide` and the files named by `xsde.config` / `xsde.workplace`, which are read again on every use. The editor
  itself rewrites the file only to append entries to `voltage_colors` (see below), keeping its comments.
- **Validation.** A mistake in `elements.libraries`, `palette`, `hot_keys`, `editor.voltage_order`, `line_halos`,
  `cim` or `bindings`, or a diagrams/custom elements folder that can't be opened, stops the editor at startup with a
  message naming the key. An invalid `logging.level` only logs a warning and uses `info`.

## Keys

The **Env** column says whether a key can be overridden by an environment variable.

### server, logging

| Key | Type | Env | Default | Meaning |
|---|---|---|---|---|
| `server.bind` | string | yes | none | Address and port to listen on, `host:port`, e.g. `0.0.0.0:8099` (shipped). Required: there is no built-in port, and an empty value listens on port 80. The Vite dev server proxies `/api` to `:8099`. |
| `logging.level` | string | yes | `info` | `trace`, `debug`, `info`, `warn` or `error`. |

### diagrams, custom_elements, user_guide

| Key | Type | Env | Default | Meaning |
|---|---|---|---|---|
| `diagrams.dir` | path | yes | none | Root folder of the diagrams (the File panel's root); `.xsld`, rendered `.svg` and history live here. Shipped: `../diagrams` (`diagrams` in the release archive). |
| `custom_elements.dir` | path | yes | none | Folder whose `.xsld` files (directly inside it, not in subfolders) make the palette's **Custom elements** group, each placed as a copy of its whole contents. Shipped: `../custom-elements`. |
| `user_guide` | path | yes | empty | Markdown file shown by **Help**, converted on every request. The Russian build shows `USER_GUIDE.ru.md` next to it. Pictures come from `images/` next to it; a translated guide shows `x.ru.png` in place of `x.png` when it exists. Empty hides **Help**. |

### xsde

The Modus `.xsde` import (File → Load from file…) runs the in-process xsde2svg converter with these files, read on
every import. Both are copies of the files in the xsde2svg repository; the user guide's `#configuration-xsde` and
`#configuration-workplace` sections describe their contents.

| Key | Type | Env | Default | Meaning |
|---|---|---|---|---|
| `xsde.config` | path | yes | empty | `xsde2svg.yml`: Modus color names → SVG colors, fonts, units, page defaults. Keep its `element_id_prefix` empty. Empty uses the converter's built-in copy. |
| `xsde.workplace` | path | yes | empty | A Modus `workplace.xml` whose `<Colors>` palette the import uses (a document's own colors override it). Empty: each document's own colors only. |

### elements

| Key | Type | Env | Default | Meaning |
|---|---|---|---|---|
| `elements.libraries` | list of paths | yes (comma-separated, appended) | none | Element-library XML files (symbol templates, terminals, CIM classes), merged in order; a later file's shape overrides an earlier one's. Add a site's own library here to extend the palette without code changes; `backend/assets/elements/base.xml` documents the format. |

### editor

Defaults of the Settings panel for a diagram that hasn't saved its own.

| Key | Type | Env | Default | Meaning |
|---|---|---|---|---|
| `editor.grid_spacing` | number | yes | 0 | Grid step. Shipped: 10. |
| `editor.snap` | bool | yes | false | Snap to grid. |
| `editor.show_grid` | bool | yes | false | Show the grid. |
| `editor.background` | color | yes | empty | Canvas background, e.g. `#12161d`. |
| `editor.jump_same_voltage` | bool | yes | false | Wire jumps also where two buswork wires of the same voltage class cross. A new diagram keeps its own copy. |
| `editor.voltage_order` | string | yes | `ascending` | Order of voltage lists by the voltage a class name reads as (`110 kV`, `6,3 kV`, `400 V`): `ascending` or `descending`. Names that aren't a voltage come last. Any other value stops the editor. |

### voltage_colors, voltage_color_tolerance

| Key | Type | Env | Default | Meaning |
|---|---|---|---|---|
| `voltage_colors` | list of `{name, color}` | no | empty | Standard voltage classes offered when adding a class to a diagram and by **Match preset colors…**. A diagram's own classes never change it. A CIM import whose voltages no entry names offers to append them; the editor then rewrites the file after the last entry, keeping its comments. |
| `voltage_color_tolerance` | number | no | 24 | How close (Euclidean RGB distance, 0–441) a diagram's class color must be to a preset to be offered for replacement; each color matches only its nearest preset. 0 = exact only. Shipped: 60. |

### state_colors, fpi_state_colors, position_states

| Key | Type | Env | Default | Meaning |
|---|---|---|---|---|
| `state_colors` | list of `{state, label, color}` | no | empty | Legend of a switching device's state fill (`data-state`, `data-fill` in the SVG) and the Properties **State** list: 0 Open, 1 Close, 2 Intermediate, 3 Faulty. Must match rdss-dms's state mapping. Only the starting colors of a diagram: one saved without its own takes them into its `.xsld` (`<stateColors>`). |
| `fpi_state_colors` | list of `{state, label, color}` | no | empty | The same for fault passage indicators (320003), whose meaning is inverted: Open (no fault) green, Close (fault passed) red. |
| `position_states` | list of `{position, label}` | no | empty | Labels of a withdrawable device's racking position (shapes 43, 49; `data-trolley`): 0 Service, 1 Normal, 2 Test. Position moves the body; it has no color. |

### line_halos

Modus composite styles of a line (type 1) drawn as a colored halo under it. A style not listed is kept on the line
but not drawn. An empty or missing list draws no halos.

| Key | Type | Required | Meaning |
|---|---|---|---|
| `style` | string | yes | Style name as Modus writes it (case matters), e.g. `BadQuality`. Unique, without `,` or `:`. |
| `color` | color | yes | Default halo color; a line can change it in Properties (stored as `haloColors` in the `.xsld`). |
| `gap` | bool | no | `true` draws a background-colored stripe inside the halo. |

The shipped list holds the six styles xsde2svg draws, in its colors. A missing `style`/`color`, a duplicate or a
`,`/`:` in a style stops the editor.

### indicators

| Key | Type | Env | Default | Meaning |
|---|---|---|---|---|
| `indicators.default_fpi_text` | string | yes | `FPI` | Text a fault passage indicator draws when it has none of its own. |

### palette

A list of `{name, items}`: the Elements panel's groups in display order, the only source of palette layout. `name`
is looked up as `elementCatalog.category.<name>` in the frontend's i18n dictionary (the raw name when untranslated).
Each item is an xsde2svg object type code, as a string:

- a shape of a loaded element library (`"41"` breaker, `"330001"` load, …);
- `"21"`, `"22"`, `"23"`, `"28"`: buswork, overhead line, cable line, link to object (arms the routing tool);
- `"5"` text label, `"134"` digital instrument (the editor's built-in widgets).

An item that is none of these stops the editor.

### hot_keys

A map of key → palette item code: pressing the key without Ctrl/Cmd/Alt arms the item, pressing it again disarms it.
A key is one letter or digit, case-insensitive, given once; `r` and `m` are reserved for rotate and mirror. The item
must be in `palette`. Mistakes stop the editor. Leave the section out for no hot keys.

### cim

The whole mapping between symbols and CIM classes, both ways; slddoc has no built-in table. Checked at startup.

| Key | Type | Meaning |
|---|---|---|
| `cim.classes` | map of shape code → list of CIM classes | Export: the classes an element of the shape can stand for, its default first; the others are offered in Properties' CIM class list. A shape left out is not exported as equipment (logged at startup and reported in the export's notes). A shape can only stand for classes the export writes alike: switches (`Breaker`, `DisconnectingCircuitBreaker`, `Disconnector`, `LoadBreakSwitch`, `GroundDisconnector`, `Switch`, `Fuse`, `Jumper`), machines (`SynchronousMachine`, `AsynchronousMachine`), injections (`EnergyConsumer`, `ConformLoad`, `NonConformLoad`, `ExternalNetworkInjection`, `EquivalentInjection`, `EnergySource`), shunts (`LinearShuntCompensator`, `PetersenCoil`), auxiliary equipment (`CurrentTransformer`, `PotentialTransformer`, `SurgeArrester`, `FaultIndicator`, `WaveTrap`), or its own class (`BusbarSection`, `PowerTransformer`, `Ground`, `SeriesCompensator`, `StaticVarCompensator`). |
| `cim.import` | map of CIM class → shape code | Import: the symbol a class is drawn with. `Class.variant` picks by the object's attributes: `SynchronousMachine.condenser` (type condenser), `SynchronousMachine.motor` (motor or motorOrCondenser), `AsynchronousMachine.generator` (a generator type), `LinearShuntCompensator.reactor` / `NonlinearShuntCompensator.reactor` (`bPerSection < 0`); without its row a variant takes its class's. A class left out is drawn as a red box with its class name, connected to nothing, and listed under Skipped. `ACLineSegment` and links to object are connectors and are not listed. |

A new exported symbol needs a `classes` row; a new CIM class needs an `import` row.

### bindings

Links of diagram items to objects of a SCADA provider. `provider: ""` (or absent) turns bindings off and hides the
binding controls; `rsdu` reads objects from an RSDU database and can export schemes to it. Checked at startup; the
database is contacted only on the first binding action.

| Key | Type | Env | Default | Meaning |
|---|---|---|---|---|
| `bindings.provider` | string | yes | empty | `""` (off) or `rsdu`. |
| `bindings.rsdu.driver` | string | yes | none | `oracle` or `postgres`; required with `rsdu`. |
| `bindings.rsdu.schema` | string | yes | `rsduadmin` | Schema (owner) of the RSDU tables, not the database; on PostgreSQL a schema inside `dsn.database`. Letters, digits, `_`, `$`. |
| `bindings.rsdu.dsn` | object | per field | none | The connection, for reading and export; required with `rsdu`. Same fields as an entry of ctrlroom's `database.dsn` (table below). |
| `bindings.rsdu.export` | bool | yes | false | `true` enables export to RSDU; the `dsn` account must be allowed to write. |
| `bindings.rsdu.scheme_type` | int | yes | 0 | Scheme type of exported schemes (`VS_FORM.ID_TYPE`, `VS_TCOMP.ID_DTYP`), usually 518 (MODUS). 0 = not set: the export check refuses to export. Negative stops the editor. |
| `bindings.rsdu.component_types` | map of shape code → int | no | empty | `VS_TCOMP.ID` an item of a shape is exported as when the scheme type has no `VS_TCOMP.MODUS_TYPE` for the shape and the item has no component type of its own, e.g. `"385": 2000023`. Keys must be numeric, ids positive. |
| `bindings.rsdu.wire_types` | map of wire kind → int | no | see meaning | `VS_TCOMP.ID` a bound wire is exported as, by kind: `BusWork`, `OverheadLine`, `CableLine`, `LinkToObject`, `BusbarWire`. Absent: `1489`, `112`, `115`, `1014`, `113`. A configured map replaces the defaults entirely; a bound wire of a kind it lacks is skipped by the export. Unknown kinds or non-positive ids stop the editor. |
| `bindings.rsdu.svg.dir` | path | yes | empty | Folder ctrlroom reads scheme SVGs from (its `backend.path_to_sld`); export and later saves write the SVG there. Needs write access. |
| `bindings.rsdu.svg.full_path` | bool | yes | false | As ctrlroom's `backend.use_full_path_for_sld`: `true` stores the picture under the scheme's file path in RSDU, below `dir`; `false` by file name only, directly in `dir`. The same for the MinIO object name. |
| `bindings.rsdu.svg.use_object_storage` | string | yes | empty | As ctrlroom's `backend.use_object_storage`: `minio` also uploads the SVG to MinIO; empty, `n`, `no`, `local` or `file`: none. Anything else stops the editor. |
| `bindings.rsdu.svg.object_storage.minio.endpoint` | list of `{host, port}` | no | none | MinIO servers; the first is used. Required with `minio`. |
| `bindings.rsdu.svg.object_storage.minio.bucket.sld` | string | no | none | Bucket of scheme pictures; required with `minio`. Other buckets (`avatar`, `report`) are ignored. |
| `bindings.rsdu.svg.object_storage.minio.user` (or `username`) | string | yes | none | Access key; required with `minio`. Put it in `.env`: `BINDINGS_RSDU_SVG_OBJECT_STORAGE_MINIO_USER`. |
| `bindings.rsdu.svg.object_storage.minio.password` | string | yes | empty | Secret key; in `.env`: `BINDINGS_RSDU_SVG_OBJECT_STORAGE_MINIO_PASSWORD`. |
| `bindings.rsdu.svg.object_storage.minio.secure` | flag | yes | false | HTTPS: `y`/`n`, `yes`/`no`, `true`/`false`, `1`/`0`. |

`bindings.rsdu.dsn` (environment variables `BINDINGS_RSDU_DSN_<FIELD>`):

| Field | Type | Env | Required | Meaning |
|---|---|---|---|---|
| `host` | string | yes | yes | Database server. |
| `port` | int | yes | yes | e.g. `1521` (Oracle), `5432` (PostgreSQL). |
| `user` | string | yes | yes | Account; keep it in `.env`. |
| `password` | string | yes | no | Plain text; keep it in `.env`. |
| `sid` / `database` | string | yes | one of them | Oracle: the SID in `sid`, or the service name in `database`. PostgreSQL: the database name in `database` (`sid` is used when `database` is empty). |
| `engine` | string | yes | no | If given, must equal `driver`. |
| `trace` | bool | no | no | Accepted for compatibility with ctrlroom; unused. |
| `password_encrypted` | bool | no | no | Must be `false`: encrypted passwords are not supported. |

The former `bindings.rsdu.read` / `write` sections stop the editor with a message pointing to `dsn` and `export`.

Example (PostgreSQL; for Oracle use `driver: oracle`, `port: 1521` and `sid:` or `database:` with the service name):

```yaml
bindings:
  provider: rsdu
  rsdu:
    driver: postgres
    schema: rsduadmin
    dsn:
      host: 10.0.0.6
      port: 5432
      database: rsdu
    export: true
    scheme_type: 518
    svg:
      dir: /opt/ctrlroom/sld
      full_path: true
```

with `backend/.env` (or `.env` next to the release binary):

```sh
BINDINGS_RSDU_DSN_USER=rsduadmin
BINDINGS_RSDU_DSN_PASSWORD=secret
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
for the frontend build, plus the sibling `slddoc` and `EMA/xsde2svg` checkouts (same
requirement as plain `go build`; `make docker-build` mounts the latter from `XSDE2SVG_DIR`). If you'd rather not install those locally,
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
make package         # pack build/ into build/sld-editor-<version>.tar.gz
make release         # make (all targets) + make package
make clean
```

Binaries are written to `build/`. Each one is a normal, standalone executable —
run it directly (`./sld-editor-linux-en -config config/sld-editor.yaml`, or
double-click the `.exe` on Windows) and it serves both the API and the embedded UI
on its own bind address.

### Distribution archive

`make package` packs every binary currently in `build/` into
`build/sld-editor-<version>.tar.gz` (older archives and stray `*.gz` files are
left out). Everything sits under one `sld-editor-<version>/` folder, together
with what the binaries need at runtime: `config/sld-editor.yaml` (a copy of
`backend/config/sld-editor.example.yaml`, never the local config, with its diagrams dir set to `diagrams`) and
`assets/elements/` (taken from `backend/`) and an empty `diagrams/` folder. Unpack it and run a binary from
inside that folder, e.g. `./sld-editor-linux-en`. `make release` builds every
target first, then packages.

### Version

The version is the git tag the build comes from (`git describe --tags --always
--dirty`: `v1.0.0`, `v1.0.0-3-gabc1234` for commits after the tag, `-dirty` for
uncommitted changes, `dev` without git). To release, tag first
(`git tag v1.1.0`), then `make`; the tag is the only source (`make VERSION=…` is
ignored). It is
shown in the UI's About dialog (sidebar, bottom) and printed by
`./sld-editor-linux-en -version`.

# Behind nginx

The editor sends the whole diagram to the server on every save and full redraw
(`/api/diagrams/save`, `/api/render`), and imports upload the file itself. Large
diagrams (several MB, more with embedded pictures) exceed nginx's default
`client_max_body_size` of 1 MB, and nginx answers `413 Request Entity Too Large`
before the request reaches the editor. The editor itself has no request size
limit. Raise nginx's limit in the `server` (or `location`) block that proxies the
editor:

```nginx
server {
    # ...
    client_max_body_size 50m;    # default 1m; large diagrams and embedded pictures exceed it

    location / {
        proxy_pass http://127.0.0.1:8099;
        proxy_read_timeout 120s; # rendering a large diagram can take a few seconds
    }
}
```

Then check and reload: `sudo nginx -t && sudo nginx -s reload`. Use
`client_max_body_size 0;` to switch the check off when nginx serves only the
editor.

# RSDU clients after export

Export to RSDU (bindings with `bindings.rsdu.export: true`, see [Configuration](#configuration)) writes the scheme
and its bindings to the RSDU database and delivers the SVG for ctrlroom, but **notifies no one**. RSDU's own scheme
editor publishes `SchemeEvent(SAVE)` to the MQ exchange `Events` so running clients reload the scheme; the editor has
no MQ connection and publishes nothing.

- **RSDU clients** that have the scheme open keep showing its old bindings until the scheme is reopened.
- **ctrlroom** gets the new SVG on every save of an exported diagram (into `bindings.rsdu.svg.dir` and/or MinIO) and
  the bindings from RSDU on export. It keeps each scheme's file name (`VS_FORM.FILE_NAME`) until it restarts: when a
  scheme the editor registered follows a renamed or moved diagram, the next export writes the SVG under the new name
  and ctrlroom needs a restart to read it. The SVG under the old name is left in place.
- **New schemes** are not visible in ctrlroom until they are added to users' menus (`US_MENU`) with RSDU's tools.

The user guide's [Export to RSDU](backend/assets/USER_GUIDE.md) and "The SVG for ctrlroom" sections describe the same
from the user's side.

# CIM with other tools

[`docs/CIM_INTEROP.md`](docs/CIM_INTEROP.md) shows how to view the editor's CGMES export in the CGMES
DiagramLayout Editor (through Apache Jena Fuseki) and how to check, render and produce CGMES files with PowSyBl,
using the example command-line tool in `tools/cim-tools` (Maven, not part of `make`).
