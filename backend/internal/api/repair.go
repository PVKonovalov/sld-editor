package api

import (
	"strings"

	"github.com/PVKonovalov/slddoc"
)

// prepareDiagram repairs d in place: ids backfilled and made unique (slddoc.EnsureIDs), voltage classes still named
// after their color renamed to the configured preset, and the topology repaired (slddoc.Repair). It runs only where
// a diagram is first produced from an .svg or .xsde import (extracted, which also gets its most-used voltage class
// as the default voltage and its elements' size steps, slddoc.InferSizeSteps) and on the client's explicit request
// (POST /repair); opening a diagram only runs slddoc.EnsureIDs. Returns whether d changed.
func (s *Server) prepareDiagram(d *slddoc.Diagram, extracted bool) bool {
	changed := false
	if extracted && (d.Editor == nil || d.Editor.DefaultVoltage == 0) {
		if v := slddoc.MostUsedVoltage(d); v != 0 {
			if d.Editor == nil {
				d.Editor = &slddoc.EditorSettings{}
			}
			d.Editor.DefaultVoltage = v
			changed = true
		}
	}
	terminals := s.lib.Terminals()
	changed = slddoc.EnsureIDs(d) || changed
	changed = s.applyPresetVoltageNames(d) || changed
	if extracted {
		changed = slddoc.InferSizeSteps(d, terminals) || changed
	}
	return slddoc.Repair(d, terminals) || changed
}

// applyPresetVoltageNames renames every voltage class still named after its own color (or not named at all) to the
// configured voltage_colors preset of the same color, compared case-insensitively. A class the user renamed, or a
// preset name another class already carries, is left alone. Returns whether anything changed.
func (s *Server) applyPresetVoltageNames(d *slddoc.Diagram) bool {
	presets := s.voltageColors()
	if len(presets) == 0 {
		return false
	}
	norm := func(v string) string { return strings.ToLower(strings.TrimSpace(v)) }
	taken := map[string]bool{}
	for _, vc := range d.VoltageClasses {
		taken[norm(vc.Name)] = true
	}
	changed := false
	for i := range d.VoltageClasses {
		vc := &d.VoltageClasses[i]
		color, name := norm(vc.Color), norm(vc.Name)
		if name != "" && name != color {
			continue
		}
		for _, p := range presets {
			if norm(p.Color) != color {
				continue
			}
			if p.Name != vc.Name && !taken[norm(p.Name)] {
				taken[norm(p.Name)] = true
				vc.Name = p.Name
				changed = true
			}
			break
		}
	}
	return changed
}
