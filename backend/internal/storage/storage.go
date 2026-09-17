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

const xmlExt = ".xml"
const svgExt = ".svg"

// Store is a directory of diagram files.
type Store struct {
	dir         string
	lib         *slddoc.SymbolLibrary
	stateColors []slddoc.StateColor
	fpiColors   []slddoc.StateColor
}

// New opens (creating if necessary) dir as a diagram store. lib is used to
// render each saved diagram's companion .svg. fpiColors, when given, is the
// install-wide FaultPassageIndicator color legend (config.Config.
// FPIStateColors, converted); stateColors, when given, is the install-wide
// switching-device state->color legend (config.Config.StateColors,
// converted) — both are carried through to every internal/slddoc.Render
// call. Pass nil for fpiColors, or omit stateColors entirely, for a store
// that doesn't need one (e.g. a test not exercising that state).
func New(dir string, lib *slddoc.SymbolLibrary, fpiColors []slddoc.StateColor, stateColors ...slddoc.StateColor) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("storage: creating diagrams directory %s: %w", dir, err)
	}
	return &Store{dir: dir, lib: lib, stateColors: stateColors, fpiColors: fpiColors}, nil
}

// Info describes one stored diagram, for the File > Open listing.
type Info struct {
	Name    string    `json:"name"`
	ModTime time.Time `json:"modTime"`
}

// List returns every diagram in the store, most recently modified first.
func (s *Store) List() ([]Info, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, fmt.Errorf("storage: listing %s: %w", s.dir, err)
	}
	infos := []Info{}
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != xmlExt {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			return nil, err
		}
		infos = append(infos, Info{
			Name:    strings.TrimSuffix(e.Name(), xmlExt),
			ModTime: fi.ModTime(),
		})
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].ModTime.After(infos[j].ModTime) })
	return infos, nil
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
	renderWarning = slddoc.Render(d, s.lib, sf, slddoc.Static, s.fpiColors, s.stateColors...)
	return renderWarning, nil
}

// Render renders d to SVG without touching the store, for a live preview
// the caller doesn't intend to persist yet. mode is the caller's call:
// Interactive for the in-app canvas, Static for anything served as if it
// were the saved artifact (e.g. a download link).
func (s *Store) Render(d *slddoc.Diagram, w io.Writer, mode slddoc.RenderMode) error {
	return slddoc.Render(d, s.lib, w, mode, s.fpiColors, s.stateColors...)
}

// safeName rejects a diagram name that could escape the store's directory
// or collide with the .xml/.svg extensions the store manages itself.
func safeName(name string) error {
	if name == "" {
		return fmt.Errorf("storage: diagram name must not be empty")
	}
	if strings.ContainsAny(name, "/\\") || name == "." || name == ".." {
		return fmt.Errorf("storage: invalid diagram name %q", name)
	}
	if strings.TrimSpace(name) != name {
		return fmt.Errorf("storage: diagram name %q must not have leading/trailing whitespace", name)
	}
	return nil
}

func (s *Store) xmlPath(name string) (string, error) {
	if err := safeName(name); err != nil {
		return "", err
	}
	return filepath.Join(s.dir, name+xmlExt), nil
}

func (s *Store) svgPath(name string) (string, error) {
	if err := safeName(name); err != nil {
		return "", err
	}
	return filepath.Join(s.dir, name+svgExt), nil
}
