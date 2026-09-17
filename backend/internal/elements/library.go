// Package elements loads the element libraries an sld-editor deployment is
// configured with (see config/sld-editor.yaml's elements.libraries) into a
// palette catalog for the frontend and a symbol library for
// internal/slddoc.Render.
//
// Each library file is XML in the same shape/template format sld-svg's
// symbols.xml uses, extended with class/name/category attributes this
// editor needs to group and label shapes in the Elements palette. A site
// adds equipment sld-editor doesn't already know about by writing its own
// library file in this format and adding its path to elements.libraries —
// no code change required. When two configured libraries define the same
// shape, the later one in the list wins, for both its template and its
// catalog metadata.
package elements

import (
	"encoding/xml"
	"fmt"
	"os"
	"strings"

	"github.com/PVKonovalov/slddoc"
)

// Symbol is one equipment shape a library defines: how to render it
// (Template) and how to present it in the Elements palette (Class, Name,
// Category). Template is included in the JSON encoding (unlike a plain
// internal detail) because the frontend's Elements palette reuses it
// as-is to draw each button's preview icon, substituting placeholder
// values ({color}, {fill}, ...) that make sense for a static, state-less
// preview rather than a real placed element — see the frontend's
// lib/elementIcon.ts.
//
// Terminals is optional (a shape like a busbar simply has none) and, when
// present, is also in local/unrotated coordinates. It's purely
// informational for now — the frontend draws a marker at each one on the
// current selection, but Ctrl/Cmd-click-to-connect still just joins two
// elements' bare anchors, not these.
type Symbol struct {
	Shape     string         `xml:"shape,attr" json:"shape"`
	Class     string         `xml:"class,attr" json:"class"`
	Name      string         `xml:"name,attr" json:"name"`
	Category  string         `xml:"category,attr,omitempty" json:"category,omitempty"`
	Terminals []slddoc.Point `xml:"terminals>terminal,omitempty" json:"terminals,omitempty"`
	Template  string         `xml:"template" json:"template"`
}

type rawLibrary struct {
	XMLName xml.Name `xml:"symbols"`
	Symbol  []Symbol `xml:"symbol"`
}

// Library is a merged, in-memory set of Symbols, keyed by Shape.
type Library struct {
	// Symbols is in the order symbols were first seen across the merged
	// files, for a stable palette listing.
	Symbols []Symbol
}

// Load parses a single library file's XML content.
func Load(data []byte) (*Library, error) {
	var raw rawLibrary
	if err := xml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("elements: parsing library: %w", err)
	}
	lib := &Library{}
	for _, s := range raw.Symbol {
		s.Template = strings.TrimSpace(s.Template)
		if s.Shape == "" {
			return nil, fmt.Errorf("elements: symbol %q missing shape attribute", s.Name)
		}
		lib.Symbols = append(lib.Symbols, s)
	}
	return lib, nil
}

// LoadFile reads and parses a single library file from disk.
func LoadFile(path string) (*Library, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("elements: reading library %s: %w", path, err)
	}
	return Load(data)
}

// LoadAll reads every path in order and merges them (see the package doc
// comment for the override rule). paths must contain at least one entry.
func LoadAll(paths []string) (*Library, error) {
	if len(paths) == 0 {
		return nil, fmt.Errorf("elements: no element libraries configured")
	}
	merged := &Library{}
	index := map[string]int{} // shape -> index in merged.Symbols
	for _, p := range paths {
		lib, err := LoadFile(p)
		if err != nil {
			return nil, err
		}
		for _, s := range lib.Symbols {
			if i, ok := index[s.Shape]; ok {
				merged.Symbols[i] = s
			} else {
				index[s.Shape] = len(merged.Symbols)
				merged.Symbols = append(merged.Symbols, s)
			}
		}
	}
	return merged, nil
}

// SymbolLibrary builds an internal/slddoc.SymbolLibrary from this Library's
// templates, for rendering.
func (l *Library) SymbolLibrary() *slddoc.SymbolLibrary {
	templates := make(map[string]string, len(l.Symbols))
	for _, s := range l.Symbols {
		if s.Template != "" {
			templates[s.Shape] = s.Template
		}
	}
	return slddoc.NewSymbolLibrary(templates)
}
