// Package slddoc models a single-line diagram (SLD) as a standalone XML
// document — elements, their coordinates, and the electrical topology
// connecting them — that an editor can load, mutate, save, and render back
// into SVG using a symbol library.
//
// The schema (Diagram/Layer/VoltageClass/Node/Element/Connector/Label) and
// the render pipeline are ported from sld-svg's internal/slddoc package
// (github.com/PVKonovalov/sld-svg), which defines the canonical XML format
// shared with that project's extract/render tooling; it is copied in
// rather than imported because it lives under sld-svg's own internal/ and
// so cannot be imported across module boundaries. This copy adds JSON
// struct tags (for the HTTP API) and an optional Editor settings block
// (grid spacing/snap/background) that sld-svg's format has no use for.
package slddoc
