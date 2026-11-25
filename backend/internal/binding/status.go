package binding

import (
	"slices"

	"github.com/PVKonovalov/slddoc"
)

// boundItem is the export view of an element, digital device, label or wire.
type boundItem struct {
	id       int
	edited   *bool
	bindings []slddoc.Binding
}

func boundItems(d *slddoc.Diagram) []boundItem {
	var out []boundItem
	for i := range d.Elements {
		e := &d.Elements[i]
		out = append(out, boundItem{e.ID, &e.ComponentEdited, e.Bindings})
	}
	for i := range d.DigitalDevices {
		dd := &d.DigitalDevices[i]
		out = append(out, boundItem{dd.ID, &dd.ComponentEdited, dd.Bindings})
	}
	for i := range d.Labels {
		l := &d.Labels[i]
		out = append(out, boundItem{l.ID, &l.ComponentEdited, l.Bindings})
	}
	for i := range d.Connectors {
		c := &d.Connectors[i]
		out = append(out, boundItem{c.ID, &c.ComponentEdited, c.Bindings})
	}
	return out
}

// Touched returns the ids of the items of d whose bindings of source changed since the last export (by their
// status, ComponentEdited and DeletedBindings), and whether the diagram's object did.
func Touched(d *slddoc.Diagram, source string) (items map[int]bool, object bool) {
	items = map[int]bool{}
	for _, it := range boundItems(d) {
		own := slices.ContainsFunc(it.bindings, func(b slddoc.Binding) bool { return b.Source == source })
		if own && *it.edited || slices.ContainsFunc(it.bindings, func(b slddoc.Binding) bool { return b.Source == source && b.Status != "" }) {
			items[it.id] = true
		}
	}
	for _, del := range d.DeletedBindings {
		if del.Source != source {
			continue
		}
		if del.Item == 0 {
			object = true
		} else {
			items[del.Item] = true
		}
	}
	if d.Object != nil && d.Object.Source == source && d.Object.Status != "" {
		object = true
	}
	return items, object
}

// Pending reports whether d has binding changes of source not yet exported.
func Pending(d *slddoc.Diagram, source string) bool {
	items, object := Touched(d, source)
	return object || len(items) > 0
}

// ClearExported marks d as exported to its scheme for source: statuses, ComponentEdited and the deleted bindings of
// source are cleared, except the statuses of the items keep (what the export skipped, to retry next time).
func ClearExported(d *slddoc.Diagram, source string, keep map[int]bool) {
	for _, it := range boundItems(d) {
		if keep[it.id] {
			continue
		}
		*it.edited = false
		for i := range it.bindings {
			if it.bindings[i].Source == source {
				it.bindings[i].Status = ""
			}
		}
	}
	if d.Object != nil && d.Object.Source == source {
		d.Object.Status = ""
	}
	d.DeletedBindings = slices.DeleteFunc(d.DeletedBindings, func(del slddoc.DeletedBinding) bool { return del.Source == source })
	if len(d.DeletedBindings) == 0 {
		d.DeletedBindings = nil
	}
}
