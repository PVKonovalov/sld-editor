// Package storage persists diagrams as a pair of files on disk: a
// <name>.xml source of truth (internal/slddoc's format) and a companion
// <name>.svg rendering, kept alongside it for anything that just wants to
// display the diagram without understanding the XML.
package storage

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/PVKonovalov/slddoc"
)

// ErrExists is returned by Create when a diagram with that name already
// exists.
var ErrExists = errors.New("storage: diagram already exists")

// ErrNotFound is returned by Load/Rename when the named diagram doesn't
// exist.
var ErrNotFound = errors.New("storage: diagram not found")

// ErrInvalidName is returned by any call whose name/dir argument fails
// safeName/safePathSegments' own validation (path traversal, an empty
// segment, ...) — distinct from ErrExists/ErrNotFound so the API layer can
// map it to 400 Bad Request rather than a generic 500.
var ErrInvalidName = errors.New("storage: invalid name")

const xmlExt = ".xml"
const svgExt = ".svg"

// Store is a directory of diagram files.
type Store struct {
	dir            string
	lib            *slddoc.SymbolLibrary
	stateColors    []slddoc.StateColor
	fpiColors      []slddoc.StateColor
	defaultFPIText string
}

// New opens (creating if necessary) dir as a diagram store. lib is used to
// render each saved diagram's companion .svg. defaultFPIText, when given, is
// the install-wide default label a FaultPassageIndicator with no own
// PropertyText draws (config.Config.Indicators.DefaultFPIText); fpiColors,
// when given, is the install-wide FaultPassageIndicator color legend
// (config.Config.FPIStateColors, converted); stateColors, when given, is the
// install-wide switching-device state->color legend (config.Config.
// StateColors, converted) — all three are carried through to every
// internal/slddoc.Render call. Pass "" for defaultFPIText, nil for
// fpiColors, or omit stateColors entirely, for a store that doesn't need
// one (e.g. a test not exercising that state).
func New(dir string, lib *slddoc.SymbolLibrary, defaultFPIText string, fpiColors []slddoc.StateColor, stateColors ...slddoc.StateColor) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("storage: creating diagrams directory %s: %w", dir, err)
	}
	return &Store{dir: dir, lib: lib, stateColors: stateColors, fpiColors: fpiColors, defaultFPIText: defaultFPIText}, nil
}

// Entry describes one item in a single directory's listing, for the File >
// Open browser: either a subdirectory (IsDir true, ModTime the directory's
// own, not especially meaningful) the browser can navigate into, or a
// stored diagram (IsDir false). Name is always the bare last path segment —
// never the full path from the store's root — matching what List's own dir
// argument is relative to.
type Entry struct {
	Name    string    `json:"name"`
	IsDir   bool      `json:"isDir"`
	ModTime time.Time `json:"modTime"`
}

// List returns one directory's immediate contents — dir is a path relative
// to the store's own root ("" for the root itself) — subdirectories first,
// then diagrams, each group sorted alphabetically (case-insensitive) by
// Name. A subdirectory entry's own IsDir lets the caller navigate into it;
// List itself never recurses.
func (s *Store) List(dir string) ([]Entry, error) {
	full, err := s.dirPath(dir)
	if err != nil {
		return nil, err
	}
	items, err := os.ReadDir(full)
	if err != nil {
		return nil, fmt.Errorf("storage: listing %s: %w", full, err)
	}
	var dirs, files []Entry
	for _, e := range items {
		fi, err := e.Info()
		if err != nil {
			return nil, err
		}
		if e.IsDir() {
			dirs = append(dirs, Entry{Name: e.Name(), IsDir: true, ModTime: fi.ModTime()})
			continue
		}
		if filepath.Ext(e.Name()) != xmlExt {
			continue
		}
		files = append(files, Entry{Name: strings.TrimSuffix(e.Name(), xmlExt), ModTime: fi.ModTime()})
	}
	byName := func(entries []Entry) func(i, j int) bool {
		return func(i, j int) bool {
			return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
		}
	}
	sort.Slice(dirs, byName(dirs))
	sort.Slice(files, byName(files))
	entries := make([]Entry, 0, len(dirs)+len(files))
	entries = append(entries, dirs...)
	entries = append(entries, files...)
	return entries, nil
}

// Load reads and parses a diagram's .xml file.
func (s *Store) Load(name string) (*slddoc.Diagram, error) {
	path, err := s.xmlPath(name)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("storage: opening %s: %w", path, err)
	}
	defer f.Close()

	d, err := slddoc.Load(f)
	if err != nil {
		return nil, fmt.Errorf("storage: loading %s: %w", name, err)
	}
	return d, nil
}

// Create writes a brand-new diagram, failing with ErrExists if name is
// already taken (New in the frontend's File menu). See Save for the
// meaning of the returned renderWarning.
func (s *Store) Create(name string, d *slddoc.Diagram) (renderWarning, err error) {
	path, err := s.xmlPath(name)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(path); err == nil {
		return nil, ErrExists
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("storage: checking %s: %w", path, err)
	}
	return s.Save(name, d)
}

// Save writes d as name's .xml file — the diagram's authoritative record —
// then renders and writes its companion .svg. A shape the configured
// element libraries don't cover is reported back as renderWarning (naming
// every missing shape), but never fails the save: err is non-nil only for
// an actual I/O failure, in which case the diagram was not fully written.
func (s *Store) Save(name string, d *slddoc.Diagram) (renderWarning, err error) {
	xmlPath, err := s.xmlPath(name)
	if err != nil {
		return nil, err
	}
	// A name with subdirectory segments (e.g. "region1/substation-5") may
	// name a folder that doesn't exist on disk yet — this is the only way
	// a new one is created (no separate "New Folder" action): saving into
	// it just makes it. A no-op when the directory already exists.
	if err := os.MkdirAll(filepath.Dir(xmlPath), 0o755); err != nil {
		return nil, fmt.Errorf("storage: creating directory for %s: %w", name, err)
	}

	xf, err := os.Create(xmlPath)
	if err != nil {
		return nil, fmt.Errorf("storage: creating %s: %w", xmlPath, err)
	}
	defer xf.Close()
	if err := d.Save(xf); err != nil {
		return nil, fmt.Errorf("storage: saving %s: %w", name, err)
	}

	svgPath, err := s.svgPath(name)
	if err != nil {
		return nil, err
	}
	sf, err := os.Create(svgPath)
	if err != nil {
		return nil, fmt.Errorf("storage: creating %s.svg: %w", name, err)
	}
	defer sf.Close()
	// Always Static: the saved .svg is a downloadable artifact, meant to
	// stay a clean, xsde2svg-faithful document — never carries this
	// editor's own interactivity-only markup.
	renderWarning = slddoc.Render(d, s.lib, sf, slddoc.Static, s.defaultFPIText, s.fpiColors, s.stateColors...)
	return renderWarning, nil
}

// Render renders d to SVG without touching the store, for a live preview
// the caller doesn't intend to persist yet. mode is the caller's call:
// Interactive for the in-app canvas, Static for anything served as if it
// were the saved artifact (e.g. a download link).
func (s *Store) Render(d *slddoc.Diagram, w io.Writer, mode slddoc.RenderMode) error {
	return slddoc.Render(d, s.lib, w, mode, s.defaultFPIText, s.fpiColors, s.stateColors...)
}

// RenderFragments is Render's incremental-editing counterpart (see
// slddoc.RenderFragments' own doc comment) — renders only ids' own markup,
// not a whole document, for the live canvas to patch in place after a small
// edit instead of replacing its whole injected SVG on every change.
func (s *Store) RenderFragments(d *slddoc.Diagram, ids []int, mode slddoc.RenderMode) (map[int]string, error) {
	return slddoc.RenderFragments(d, s.lib, ids, mode, s.defaultFPIText, s.fpiColors, s.stateColors...)
}

// safePathSegments splits a "/"-separated relative path (a diagram name, or
// a List dir argument) into its individual segments, rejecting any that
// could escape the store's own root: empty (a leading/trailing/doubled
// "/"), ".", "..", a literal backslash (Windows' own separator — never
// meaningful here, and accepting it would make "a\..\b" ambiguous), or
// carrying leading/trailing whitespace. path itself may be "" (the store's
// own root — only List ever passes that; a diagram name never resolves to
// the root), in which case this returns no segments and no error.
func safePathSegments(path string) ([]string, error) {
	if path == "" {
		return nil, nil
	}
	if strings.TrimSpace(path) != path {
		return nil, fmt.Errorf("%w: %q must not have leading/trailing whitespace", ErrInvalidName, path)
	}
	segments := strings.Split(path, "/")
	for _, seg := range segments {
		if seg == "" || seg == "." || seg == ".." || strings.ContainsRune(seg, '\\') {
			return nil, fmt.Errorf("%w: %q", ErrInvalidName, path)
		}
		if strings.TrimSpace(seg) != seg {
			return nil, fmt.Errorf("%w: %q", ErrInvalidName, path)
		}
	}
	return segments, nil
}

// safeName rejects a diagram name that could escape the store's directory,
// same as safePathSegments, but additionally never accepts "" — unlike a
// List dir argument, a diagram always names a real file, never the root
// itself.
func safeName(name string) ([]string, error) {
	if name == "" {
		return nil, fmt.Errorf("%w: diagram name must not be empty", ErrInvalidName)
	}
	return safePathSegments(name)
}

func (s *Store) xmlPath(name string) (string, error) {
	segments, err := safeName(name)
	if err != nil {
		return "", err
	}
	return filepath.Join(s.dir, filepath.Join(segments...)+xmlExt), nil
}

func (s *Store) svgPath(name string) (string, error) {
	segments, err := safeName(name)
	if err != nil {
		return "", err
	}
	return filepath.Join(s.dir, filepath.Join(segments...)+svgExt), nil
}

// dirPath resolves a List dir argument ("" for the store's own root) to a
// real filesystem path, with the same traversal protection xmlPath/svgPath
// give a diagram name.
func (s *Store) dirPath(dir string) (string, error) {
	segments, err := safePathSegments(dir)
	if err != nil {
		return "", err
	}
	return filepath.Join(s.dir, filepath.Join(segments...)), nil
}
