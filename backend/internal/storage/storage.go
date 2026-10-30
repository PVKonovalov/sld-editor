// Package storage persists diagrams as a pair of files on disk: a
// <name>.xsld source of truth (slddoc's XML format, see
// slddoc XSLD_FORMAT.md) and a companion
// <name>.svg rendering, kept alongside it for anything that just wants to
// display the diagram without understanding the XML.
package storage

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/PVKonovalov/slddoc"
)

// ErrExists is returned by Create when a diagram with that name already
// exists.
var ErrExists = errors.New("storage: diagram already exists")

// ErrNotFound is returned by Load/Rename when the named diagram doesn't
// exist.
var ErrNotFound = errors.New("storage: diagram not found")

// ErrNotEmpty is returned by DeleteDir when the folder still holds anything.
var ErrNotEmpty = errors.New("storage: folder is not empty")

// ErrInvalidName is returned by any call whose name/dir argument fails
// safeName/safePathSegments' own validation (path traversal, an empty
// segment, ...) — distinct from ErrExists/ErrNotFound so the API layer can
// map it to 400 Bad Request rather than a generic 500.
var ErrInvalidName = errors.New("storage: invalid name")

// xmlExt is a diagram source file's own extension. The content is plain XML
// (slddoc's format); the dedicated extension just tells a diagram apart from
// any other XML file (e.g. an element library).
const xmlExt = ".xsld"
const svgExt = ".svg"

// MaxHistory is how many of a diagram's most recent revisions SaveRevision
// keeps in its history.
const MaxHistory = 200

// Store is a directory of diagram files.
type Store struct {
	dir            string
	lib            *slddoc.SymbolLibrary
	stateColors    []slddoc.StateColor
	fpiColors      []slddoc.StateColor
	defaultFPIText string
	// mu serializes writes, so Create's existence check and SaveRevision's
	// read-modify-write of the history see no concurrent save.
	mu sync.Mutex
}

// New opens (creating if necessary) dir as a diagram store. lib is used to
// render each saved diagram's companion .svg. defaultFPIText, when given, is
// the install-wide default label a FaultPassageIndicator with no own
// PropertyText draws (config.Config.Indicators.DefaultFPIText); fpiColors,
// when given, is the install-wide FaultPassageIndicator color legend
// (config.Config.FPIStateColors, converted); stateColors, when given, is the
// install-wide switching-device state->color legend (config.Config.
// StateColors, converted) — all three are carried through to every
// slddoc.Render call. Pass "" for defaultFPIText, nil for
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

// Load reads and parses a diagram's .xsld file.
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
// returned renderWarning.
func (s *Store) Create(name string, d *slddoc.Diagram) (renderWarning, err error) {
	path, err := s.xmlPath(name)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := os.Stat(path); err == nil {
		return nil, ErrExists
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("storage: checking %s: %w", path, err)
	}
	return s.write(name, d)
}

// Save writes d as name's .xsld file — the diagram's authoritative record —
// then renders and writes its companion .svg. A shape the configured
// element libraries don't cover is reported back as renderWarning (naming
// every missing shape), but never fails the save: err is non-nil only for
// an actual I/O failure.
func (s *Store) Save(name string, d *slddoc.Diagram) (renderWarning, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.write(name, d)
}

// SaveRevision is Save that also records rev in d.History: the history
// already on disk for name (d's own when name doesn't exist yet), plus rev,
// trimmed to the newest MaxHistory entries. d.History is updated in place.
func (s *Store) SaveRevision(name string, d *slddoc.Diagram, rev slddoc.Revision) (renderWarning, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	old, err := s.Load(name)
	switch {
	case errors.Is(err, ErrNotFound):
	case err != nil:
		return nil, err
	default:
		d.History = old.History
	}
	d.History = append(slices.Clone(d.History), rev)
	if n := len(d.History) - MaxHistory; n > 0 {
		d.History = d.History[n:]
	}
	return s.write(name, d)
}

// write saves d's .xsld and .svg, each replacing the old file atomically. A diagram with no state colors of its own
// takes the store's legend.
func (s *Store) write(name string, d *slddoc.Diagram) (renderWarning, err error) {
	xmlPath, err := s.xmlPath(name)
	if err != nil {
		return nil, err
	}
	svgPath, err := s.svgPath(name)
	if err != nil {
		return nil, err
	}
	// A name with subdirectory segments (e.g. "region1/substation-5") may
	// name a folder that doesn't exist on disk yet: saving into it makes it.
	if err := os.MkdirAll(filepath.Dir(xmlPath), 0o755); err != nil {
		return nil, fmt.Errorf("storage: creating directory for %s: %w", name, err)
	}

	slddoc.SeedStateColors(d, s.stateColors)
	var xml bytes.Buffer
	if err := d.Save(&xml); err != nil {
		return nil, fmt.Errorf("storage: saving %s: %w", name, err)
	}
	if err := replaceFile(xmlPath, xml.Bytes()); err != nil {
		return nil, err
	}

	// Always Static: the saved .svg is a downloadable artifact, meant to
	// stay a clean, xsde2svg-faithful document — never carries this
	// editor's own interactivity-only markup.
	var svg bytes.Buffer
	renderWarning = slddoc.Render(d, s.lib, &svg, slddoc.Static, s.defaultFPIText, s.fpiColors, s.stateColors...)
	if err := replaceFile(svgPath, svg.Bytes()); err != nil {
		return nil, err
	}
	return renderWarning, nil
}

// CreateDir creates the empty folder dir (its missing parents too), failing with ErrExists when something already has
// that path.
func (s *Store) CreateDir(dir string) error {
	full, err := s.folderPath(dir)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return fmt.Errorf("storage: creating %s: %w", dir, err)
	}
	if err := os.Mkdir(full, 0o755); err != nil {
		if os.IsExist(err) {
			return ErrExists
		}
		return fmt.Errorf("storage: creating %s: %w", dir, err)
	}
	return nil
}

// Rename renames or moves the diagram from to to (its .xsld and .svg), creating to's missing folders. It fails with
// ErrNotFound when from doesn't exist and ErrExists when to does.
func (s *Store) Rename(from, to string) error {
	fromXML, err := s.xmlPath(from)
	if err != nil {
		return err
	}
	fromSVG, _ := s.svgPath(from)
	toXML, err := s.xmlPath(to)
	if err != nil {
		return err
	}
	toSVG, _ := s.svgPath(to)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := checkMove(fromXML, toXML, false); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(toXML), 0o755); err != nil {
		return fmt.Errorf("storage: creating directory for %s: %w", to, err)
	}
	if err := os.Rename(fromXML, toXML); err != nil {
		return fmt.Errorf("storage: renaming %s: %w", from, err)
	}
	if err := os.Rename(fromSVG, toSVG); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("storage: renaming %s: %w", from, err)
	}
	return nil
}

// RenameDir renames or moves the folder from, with everything in it, to to, creating to's missing parents. It fails
// with ErrNotFound when from isn't a folder, ErrExists when to exists, and ErrInvalidName when to lies inside from.
func (s *Store) RenameDir(from, to string) error {
	fromPath, err := s.folderPath(from)
	if err != nil {
		return err
	}
	toPath, err := s.folderPath(to)
	if err != nil {
		return err
	}
	if strings.HasPrefix(to+"/", from+"/") {
		return fmt.Errorf("%w: %q is inside %q", ErrInvalidName, to, from)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := checkMove(fromPath, toPath, true); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(toPath), 0o755); err != nil {
		return fmt.Errorf("storage: creating %s: %w", to, err)
	}
	if err := os.Rename(fromPath, toPath); err != nil {
		return fmt.Errorf("storage: renaming %s: %w", from, err)
	}
	return nil
}

// checkMove reports ErrNotFound unless from exists (a folder when dir, a file otherwise) and ErrExists when to
// exists, unless to is from itself under another letter case (a case-insensitive file system).
func checkMove(from, to string, dir bool) error {
	fi, err := os.Stat(from)
	if os.IsNotExist(err) || err == nil && fi.IsDir() != dir {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("storage: checking %s: %w", from, err)
	}
	ti, err := os.Stat(to)
	switch {
	case os.IsNotExist(err):
		return nil
	case err != nil:
		return fmt.Errorf("storage: checking %s: %w", to, err)
	case from != to && os.SameFile(fi, ti):
		return nil
	default:
		return ErrExists
	}
}

// Delete removes the diagram name (its .xsld and .svg), failing with ErrNotFound when it doesn't exist.
func (s *Store) Delete(name string) error {
	xmlPath, err := s.xmlPath(name)
	if err != nil {
		return err
	}
	svgPath, _ := s.svgPath(name)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(xmlPath); err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return fmt.Errorf("storage: deleting %s: %w", name, err)
	}
	if err := os.Remove(svgPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("storage: deleting %s: %w", name, err)
	}
	return nil
}

// DeleteDir removes the folder dir, failing with ErrNotFound when it isn't a folder and ErrNotEmpty when it holds
// any file or folder.
func (s *Store) DeleteDir(dir string) error {
	full, err := s.folderPath(dir)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if fi, err := os.Stat(full); os.IsNotExist(err) || err == nil && !fi.IsDir() {
		return ErrNotFound
	}
	items, err := os.ReadDir(full)
	if err != nil {
		return fmt.Errorf("storage: reading %s: %w", dir, err)
	}
	if len(items) > 0 {
		return ErrNotEmpty
	}
	if err := os.Remove(full); err != nil {
		return fmt.Errorf("storage: deleting %s: %w", dir, err)
	}
	return nil
}

// replaceFile writes data to a temporary file next to path and renames it
// over path, so a reader never sees a partly written file.
func replaceFile(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return fmt.Errorf("storage: creating %s: %w", path, err)
	}
	tmp := f.Name()
	_, err = f.Write(data)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chmod(tmp, 0o644)
	}
	if err == nil {
		err = os.Rename(tmp, path)
	}
	if err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("storage: writing %s: %w", path, err)
	}
	return nil
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

// folderPath is dirPath for a folder that is not the store's root.
func (s *Store) folderPath(dir string) (string, error) {
	if dir == "" {
		return "", fmt.Errorf("%w: folder name must not be empty", ErrInvalidName)
	}
	return s.dirPath(dir)
}
