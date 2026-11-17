package storage

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/PVKonovalov/slddoc"
)

// Scheme link statuses of a diagram (Entry.SchemeStatus).
const (
	SchemeLinked   = "linked"   // linked, never exported
	SchemeExported = "exported" // not changed since the export
	SchemeChanged  = "changed"  // saved after the export
)

// ErrSchemeLinked is returned by a save that would link a scheme another diagram, Holder, already holds.
type ErrSchemeLinked struct {
	Scheme slddoc.SchemeRef
	Holder string
}

func (e *ErrSchemeLinked) Error() string {
	return fmt.Sprintf("storage: scheme %s:%s is linked to diagram %s", e.Scheme.Source, e.Scheme.Ref, e.Holder)
}

// linkIndex maps each linked scheme to its diagram and back. Guarded by Store.mu.
type linkIndex struct {
	byScheme  map[string]string
	byDiagram map[string]slddoc.SchemeRef
}

func schemeKey(s slddoc.SchemeRef) string { return s.Source + "\x00" + s.Ref }

func newLinkIndex() *linkIndex {
	return &linkIndex{byScheme: map[string]string{}, byDiagram: map[string]slddoc.SchemeRef{}}
}

func (x *linkIndex) set(name string, s *slddoc.SchemeRef) {
	x.drop(name)
	if s == nil || s.Ref == "" {
		return
	}
	x.byScheme[schemeKey(*s)] = name
	x.byDiagram[name] = *s
}

func (x *linkIndex) drop(name string) {
	if old, ok := x.byDiagram[name]; ok {
		delete(x.byDiagram, name)
		if x.byScheme[schemeKey(old)] == name {
			delete(x.byScheme, schemeKey(old))
		}
	}
}

// rename moves the links of from, or of every diagram under folder from when dir, to to.
func (x *linkIndex) rename(from, to string, dir bool) {
	for name, s := range x.byDiagram {
		var next string
		switch {
		case !dir && name == from:
			next = to
		case dir && strings.HasPrefix(name, from+"/"):
			next = to + strings.TrimPrefix(name, from)
		default:
			continue
		}
		x.drop(name)
		x.set(next, &s)
	}
}

// buildIndex reads the <scheme> of every diagram under s.dir. It returns a warning per diagram that could not be
// read or links a scheme an earlier diagram (by path) already holds; such a diagram is left out.
func (s *Store) buildIndex() []string {
	x := newLinkIndex()
	var names []string
	_ = filepath.WalkDir(s.dir, func(path string, e fs.DirEntry, err error) error {
		if err == nil && !e.IsDir() && filepath.Ext(path) == xmlExt && !strings.HasPrefix(e.Name(), ".") {
			rel, _ := filepath.Rel(s.dir, path)
			names = append(names, strings.TrimSuffix(filepath.ToSlash(rel), xmlExt))
		}
		return nil
	})
	sort.Strings(names)
	var warnings []string
	for _, name := range names {
		ref, err := s.readScheme(name)
		switch {
		case err != nil:
			warnings = append(warnings, fmt.Sprintf("%s: %v", name, err))
		case ref == nil:
		case x.byScheme[schemeKey(*ref)] != "":
			warnings = append(warnings, fmt.Sprintf("%s: scheme %s:%s is already linked to %s; link ignored", name, ref.Source, ref.Ref, x.byScheme[schemeKey(*ref)]))
		default:
			x.set(name, ref)
		}
	}
	s.links = x
	return warnings
}

func (s *Store) readScheme(name string) (*slddoc.SchemeRef, error) {
	path, err := s.xmlPath(name)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return slddoc.ReadScheme(f)
}

// IndexWarnings returns the problems found while indexing scheme links at startup.
func (s *Store) IndexWarnings() []string { return s.indexWarnings }

// checkLink returns ErrSchemeLinked when scheme is held by a diagram other than name. Call with s.mu held.
func (s *Store) checkLink(name string, scheme *slddoc.SchemeRef) error {
	if scheme == nil || scheme.Ref == "" {
		return nil
	}
	if holder := s.links.byScheme[schemeKey(*scheme)]; holder != "" && holder != name {
		return &ErrSchemeLinked{Scheme: *scheme, Holder: holder}
	}
	return nil
}

// SchemeOf returns the scheme the diagram name is linked to, nil when none.
func (s *Store) SchemeOf(name string) *slddoc.SchemeRef {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ref, ok := s.links.byDiagram[name]; ok {
		return &ref
	}
	return nil
}

// LinkedDiagrams returns, for every scheme of source linked to a diagram, its ref → the diagram's name.
func (s *Store) LinkedDiagrams(source string) map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]string{}
	for name, ref := range s.links.byDiagram {
		if ref.Source == source {
			out[ref.Ref] = name
		}
	}
	return out
}

// schemeStatus returns the link status of a diagram linked to ref whose file was last written at mod.
func schemeStatus(ref slddoc.SchemeRef, mod time.Time) string {
	switch {
	case ref.Exported == nil:
		return SchemeLinked
	case mod.Truncate(time.Second).After(ref.Exported.Truncate(time.Second)):
		return SchemeChanged
	default:
		return SchemeExported
	}
}
