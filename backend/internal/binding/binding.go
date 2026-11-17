// Package binding is the source-neutral side of SCADA bindings: the Provider interface every data provider
// implements, and the registry the configured one is built from.
package binding

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/config"
)

// ErrNotImplemented is returned by a provider method not available yet; the API answers 501.
var ErrNotImplemented = errors.New("not implemented by the binding provider")

// ErrNotFound wraps a provider error for an unknown section, node or object; the API answers 404.
var ErrNotFound = errors.New("not found")

// ErrInvalid wraps a provider error for a malformed argument; the API answers 400.
var ErrInvalid = errors.New("invalid argument")

// KindInfo is one binding kind as a provider offers it, with the option a new binding of it gets. An empty Name
// leaves naming to the frontend.
type KindInfo struct {
	Kind          slddoc.BindingKind `json:"kind"`
	Name          string             `json:"name"`
	DefaultOption string             `json:"defaultOption,omitempty"`
}

// Option is one way of reading a value (RSDU: SYS_GTOPT), of the value type Group (RSDU: SYS_GTYP).
type Option struct {
	Alias     string `json:"alias"`
	Name      string `json:"name"`
	Group     string `json:"group,omitempty"`
	GroupName string `json:"groupName,omitempty"`
}

// Feature is one display feature (RSDU: VS_COMP_FEATURE), a bit of the item's feature Mask.
type Feature struct {
	Alias string `json:"alias"`
	Name  string `json:"name"`
	Mask  int64  `json:"mask"`
}

// Dictionaries are a provider's reference lists.
type Dictionaries struct {
	Kinds    []KindInfo `json:"kinds"`
	Options  []Option   `json:"options"`
	Features []Feature  `json:"features"`
}

// Section is one node of the provider's top-level object tree (RSDU: SYS_TREE21). Section, when set, is the id
// Catalog, List and Search take; the node itself can be bound by its Ref.
type Section struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Icon     int64     `json:"icon,omitempty"`
	Section  string    `json:"section,omitempty"`
	Ref      string    `json:"ref"`
	Children []Section `json:"children,omitempty"`
}

// Node is one catalog node of a section (RSDU: a row of the section's DIR table); ID is what List takes as node.
type Node struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Alias    string `json:"alias,omitempty"`
	TypeName string `json:"typeName,omitempty"`
	Icon     int64  `json:"icon,omitempty"`
	Ref      string `json:"ref"`
	Children []Node `json:"children,omitempty"`
}

// Object is one bindable object of a catalog node's list (RSDU: a row of the section's LST table). Class is empty
// when the object has none; Cvalif and Scale are set for data acquisition parameters only.
type Object struct {
	ID        string   `json:"id"`
	Ref       string   `json:"ref"`
	Name      string   `json:"name"`
	TypeAlias string   `json:"typeAlias,omitempty"`
	Class     string   `json:"class,omitempty"`
	UID       string   `json:"uid,omitempty"`
	Cvalif    *int64   `json:"cvalif,omitempty"`
	Scale     *float64 `json:"scale,omitempty"`
}

// Resolved is an object found by its ref, with what a binding caches of it (Name, Type as the type's alias,
// TypeName, UID), its parent, and the binding kind and option the provider suggests for it.
type Resolved struct {
	Ref       string             `json:"ref"`
	Name      string             `json:"name"`
	Type      string             `json:"type,omitempty"`
	TypeName  string             `json:"typeName,omitempty"`
	UID       string             `json:"uid,omitempty"`
	ParentRef string             `json:"parentRef,omitempty"`
	Kind      slddoc.BindingKind `json:"kind"`
	Option    string             `json:"option,omitempty"`
}

// Element is the diagram item an object is dropped on, as Suggest sees it.
type Element struct {
	Shape string `json:"shape"`
	Class string `json:"class"`
}

// Hit kinds of a SearchResult.
const (
	HitCatalog = "catalog"
	HitList    = "list"
)

// Hit is one search match: a catalog node or a list object. Node is the catalog node to reveal: the node itself, or
// the one the object is listed under.
type Hit struct {
	Ref  string `json:"ref"`
	Name string `json:"name"`
	Kind string `json:"kind"`
	Node string `json:"node"`
}

// SearchResult holds at most the asked number of hits; Truncated tells that more matched.
type SearchResult struct {
	Hits      []Hit `json:"hits"`
	Truncated bool  `json:"truncated"`
}

// Provider is a SCADA data source diagram items are bound to. A ref is the provider's own object key, opaque
// outside it.
type Provider interface {
	// Name is the provider's name, written to Binding.Source.
	Name() string
	Dictionaries(ctx context.Context) (*Dictionaries, error)
	Sections(ctx context.Context) ([]Section, error)
	// Catalog returns the catalog tree of section.
	Catalog(ctx context.Context, section string) ([]Node, error)
	// List returns the objects of a catalog node of section.
	List(ctx context.Context, section, node string) ([]Object, error)
	// Search finds catalog nodes and objects of section whose name contains q, case-insensitively.
	Search(ctx context.Context, section, q string, limit int) (*SearchResult, error)
	// Resolve finds the object ref; ErrNotFound when it does not exist, ErrInvalid when it can't be bound.
	Resolve(ctx context.Context, ref string) (*Resolved, error)
	// Suggest returns the bindings an element gets when bound to the object ref automatically, at most one per kind;
	// none when the provider proposes nothing for that object.
	Suggest(ctx context.Context, ref string, el Element) ([]slddoc.Binding, error)
}

// Refresher is a Provider caching its data source's reference data; Refresh makes the next calls re-read it.
type Refresher interface {
	Refresh()
}

// Exporter is a Provider that can write a diagram's bindings to its scheme name; it returns the scheme written.
type Exporter interface {
	Export(ctx context.Context, name string, d *slddoc.Diagram) (*slddoc.SchemeRef, error)
}

// Importer is a Provider that can read a scheme's bindings, returned as a diagram holding only bound items.
type Importer interface {
	Import(ctx context.Context, scheme string) (*slddoc.Diagram, error)
}

// Constructor builds a provider from its configuration. It must not contact the data source.
type Constructor func(cfg config.Bindings) (Provider, error)

var (
	mu       sync.RWMutex
	registry = map[string]Constructor{}
)

// Register adds a provider constructor under name; registering a name twice panics.
func Register(name string, c Constructor) {
	mu.Lock()
	defer mu.Unlock()
	if _, ok := registry[name]; ok {
		panic("binding: provider registered twice: " + name)
	}
	registry[name] = c
}

// Registered returns the registered provider names, sorted.
func Registered() []string {
	mu.RLock()
	defer mu.RUnlock()
	names := make([]string, 0, len(registry))
	for n := range registry {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// New builds the configured provider; nil, nil when bindings are off.
func New(cfg config.Bindings) (Provider, error) {
	if cfg.Provider == "" {
		return nil, nil
	}
	mu.RLock()
	c, ok := registry[cfg.Provider]
	mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("binding provider %q is not built in (have %v)", cfg.Provider, Registered())
	}
	return c(cfg)
}

// CanExport reports whether p can export and cfg has a connection to write through.
func CanExport(p Provider, cfg config.Bindings) bool {
	if p == nil {
		return false
	}
	if _, ok := p.(Exporter); !ok {
		return false
	}
	switch cfg.Provider {
	case config.ProviderRSDU:
		return cfg.RSDU.Write.IsSet()
	}
	return false
}

// ResolveAll resolves every distinct ref with p. Refs that don't exist or can't be bound (ErrNotFound, ErrInvalid)
// are listed in missing; any other error (the data source failing) stops it.
func ResolveAll(ctx context.Context, p Provider, refs []string) (map[string]*Resolved, []string, error) {
	found := map[string]*Resolved{}
	missing := []string{}
	seen := map[string]bool{}
	for _, r := range refs {
		if seen[r] {
			continue
		}
		seen[r] = true
		obj, err := p.Resolve(ctx, r)
		switch {
		case err == nil:
			found[r] = obj
		case errors.Is(err, ErrNotFound), errors.Is(err, ErrInvalid):
			missing = append(missing, r)
		default:
			return nil, nil, err
		}
	}
	return found, missing, nil
}
