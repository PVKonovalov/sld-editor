// Package elements loads the element libraries an sld-editor deployment is
// configured with (see config/sld-editor.yaml's elements.libraries) into a
// palette catalog for the frontend and a symbol library for
// internal/slddoc.Render.
//
// Each library file is XML in the same shape/template format sld-svg's
// symbols.xml uses, extended with class/name attributes this editor needs
// to label shapes in the Elements palette (where each one shows up in
// that palette is a separate, config-side concern — see
// config.Config.Palette). A site adds equipment sld-editor doesn't already
// know about by writing its own library file in this format and adding
// its path to elements.libraries — no code change required. When two
// configured libraries define the same shape, the later one in the list
// wins, for both its template and its catalog metadata.
package elements

import (
	"encoding/xml"
	"fmt"
	"os"
	"strings"

	"sld-editor/internal/config"

	"github.com/PVKonovalov/slddoc"
)

// Symbol is one equipment shape a library defines: how to render it
// (Template) and how to present it in the Elements palette (Class, Name).
// Template is included in the JSON encoding (unlike a plain internal
// detail) because the frontend's Elements palette reuses it as-is to draw
// each button's preview icon, substituting placeholder values ({color},
// {fill}, ...) that make sense for a static, state-less preview rather
// than a real placed element — see the frontend's lib/elementIcon.ts. A
// Symbol carries no opinion on where it shows up in the palette (that was
// this field's own former Category attribute) — see config.Config's own
// Palette field, the single source of truth for that now.
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

// PaletteConnectorKinds maps a wire-kind palette item's own xsde2svg
// ObjectType code to the slddoc.ConnectorKind it arms — the same 4 codes
// internal/slddoc/render.go's own connectorTypeCode maps the other
// direction for rendering ("21"/"22"/"23"/"28"), so a config.Palette item
// and a rendered connector's own data-type agree on what these codes mean.
// 'BusbarWire' is a real slddoc.ConnectorKind but was deliberately never
// offered as a palette choice (no rendering distinction to justify one),
// so it has no code here either. The frontend keeps its own copy of this
// same mapping (frontend/src/lib/paletteItem.ts) to classify a
// PaletteGroup.Items string it gets back from /api/config — exported here
// so this Go-side copy is the one other Go code (this file's own
// ValidatePalette) reads from, not a private implementation detail.
var PaletteConnectorKinds = map[string]string{
	"21": "BusWork",
	"22": "OverheadLine",
	"23": "CableLine",
	"28": "LinkToObject",
}

// PaletteLabelShape/PaletteDigitalDeviceShape are the xsde2svg ObjectType
// codes for this editor's own two built-in non-Element palette widgets —
// "5" (Текст/Text, armedLabel) and "134" (Прибор цифровой/Digital
// instrument, armedDigitalDevice) — real codes, but neither is ever a real
// elements.Symbol (Label/DigitalDevice are each their own top-level
// Diagram entity, not an Element), so neither can ever collide with one.
const (
	PaletteLabelShape         = "5"
	PaletteDigitalDeviceShape = "134"
)

// ValidatePalette checks every config.PaletteGroup.Items string — always a
// real xsde2svg ObjectType code, never a name, the same convention every
// item kind already follows — against the fixed wireKind/label/
// digitalDevice codes above or this Library's own loaded Symbols, failing
// loud at startup rather than letting a typo in config.Palette silently
// produce a palette button that does nothing when clicked — the same
// "fail loud on misconfiguration" reasoning cmd/sld-editor/main.go already
// applies to Elements.Libraries itself.
func (l *Library) ValidatePalette(groups []config.PaletteGroup) error {
	shapes := make(map[string]bool, len(l.Symbols))
	for _, s := range l.Symbols {
		shapes[s.Shape] = true
	}
	for _, g := range groups {
		for _, it := range g.Items {
			if _, ok := PaletteConnectorKinds[it]; ok {
				continue
			}
			if it == PaletteLabelShape || it == PaletteDigitalDeviceShape {
				continue
			}
			if !shapes[it] {
				return fmt.Errorf("elements: palette group %q: %q is neither a recognized wireKind/label/digitalDevice code nor an element shape in the loaded element libraries", g.Name, it)
			}
		}
	}
	return nil
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
