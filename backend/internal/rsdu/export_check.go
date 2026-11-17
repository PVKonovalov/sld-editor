package rsdu

import (
	"context"
	"database/sql"
	"fmt"
	"path"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
)

const (
	sqlSchemeTypes    = "SELECT ot.ID, ot.NAME FROM {s}.SYS_OTYP ot, {s}.VS_TYPE_V vt WHERE ot.ID = vt.ID"
	sqlComponentTypes = "SELECT ID, MODUS_TYPE FROM {s}.VS_TCOMP WHERE ID_DTYP = ? AND MODUS_TYPE IS NOT NULL"
	// deviceShape is the Modus symbol code of a digital device (VS_TCOMP.MODUS_TYPE), labelShape a text label's.
	deviceShape = "134"
	labelShape  = "5"
	// wireShape prefixes a wire's connector kind as the shape key of its component type (see componentTypes).
	wireShape = "wire:"
)

// SchemeTypes returns SYS_OTYP rows that are scheme types (VS_TYPE_V), sorted by name.
func (p *Provider) SchemeTypes(ctx context.Context) ([]binding.SchemeType, error) {
	types := []binding.SchemeType{}
	err := each(ctx, p.read, p.d.SQL(sqlSchemeTypes), func(r Rows) error {
		var id int64
		var name sql.NullString
		if err := r.Scan(&id, &name); err != nil {
			return err
		}
		types = append(types, binding.SchemeType{ID: strconv.FormatInt(id, 10), Name: name.String})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.SliceStable(types, func(i, j int) bool { return strings.ToLower(types[i].Name) < strings.ToLower(types[j].Name) })
	return types, nil
}

// componentTypes returns VS_TCOMP.ID by MODUS_TYPE for the scheme type dtyp, and by wireShape + connector kind as
// configured.
func (p *Provider) componentTypes(ctx context.Context, dtyp int) (map[string]int64, error) {
	out := map[string]int64{}
	err := each(ctx, p.read, p.d.SQL(sqlComponentTypes), func(r Rows) error {
		var id int64
		var modus sql.NullInt64
		if err := r.Scan(&id, &modus); err != nil {
			return err
		}
		if modus.Valid {
			out[strconv.FormatInt(modus.Int64, 10)] = id
		}
		return nil
	}, int64(dtyp))
	for _, kind := range []slddoc.ConnectorKind{slddoc.KindBusWork, slddoc.KindOverheadLine, slddoc.KindCableLine, slddoc.KindLinkToObject, slddoc.KindBusbarWire} {
		if id, ok := p.cfg.WireType(string(kind)); ok {
			out[wireShape+string(kind)] = id
		}
	}
	return out, err
}

// svgFile returns the file a viewer reads for the scheme file name fileName, relative to its SVG folder, as ctrlroom's
// PathToSld resolves it: "\" read as "/", the base name only unless fullPath, the extension (.svg or .xsde) swapped
// for .svg. It fails for another extension or a path leaving the folder.
func svgFile(fileName string, fullPath bool) (string, error) {
	p := strings.ReplaceAll(strings.TrimSpace(fileName), `\`, "/")
	ext := path.Ext(p)
	if e := strings.ToLower(ext); e != ".svg" && e != ".xsde" {
		return "", fmt.Errorf("%q is not an .svg or .xsde file", fileName)
	}
	if !fullPath {
		p = path.Base(p)
	}
	p = path.Clean(strings.TrimSuffix(p, ext) + ".svg")
	if p == ".." || strings.HasPrefix(p, "../") {
		return "", fmt.Errorf("%q leaves the SVG folder", fileName)
	}
	return strings.TrimPrefix(p, "/"), nil
}

// CheckExport checks the diagram name, d, for an export to scheme (nil: a new one, its file name the diagram's path
// with .svg): the configured scheme type, the linked scheme, a component type per bound item by its shape, the item
// ids and the SVG file, which no other scheme may resolve to.
func (p *Provider) CheckExport(ctx context.Context, name string, d *slddoc.Diagram, scheme *slddoc.SchemeRef) (*binding.ExportCheck, error) {
	c := &binding.ExportCheck{OK: true, Issues: []binding.ExportIssue{}, FileName: name + ".svg"}
	types, err := p.SchemeTypes(ctx)
	if err != nil {
		return nil, err
	}
	dtyp := strconv.Itoa(p.cfg.SchemeType)
	if p.cfg.SchemeType <= 0 {
		c.Add(binding.ExportIssue{Code: binding.IssueNoSchemeType, Severity: binding.SeverityError})
	} else if i := slices.IndexFunc(types, func(t binding.SchemeType) bool { return t.ID == dtyp }); i < 0 {
		c.Add(binding.ExportIssue{Code: binding.IssueUnknownSchemeType, Severity: binding.SeverityError, Detail: dtyp})
	} else {
		c.SchemeType = &types[i]
	}

	schemes, err := p.allSchemes(ctx)
	if err != nil {
		return nil, err
	}
	if scheme == nil {
		c.Add(binding.ExportIssue{Code: binding.IssueNotLinked, Severity: binding.SeverityWarning})
	} else {
		for i := range schemes {
			if schemes[i].Ref == scheme.Ref {
				c.Scheme = &schemes[i]
			}
		}
		switch {
		case c.Scheme == nil:
			c.Add(binding.ExportIssue{Code: binding.IssueSchemeMissing, Severity: binding.SeverityError, Detail: scheme.Ref})
		default:
			if !scheme.Registered {
				c.FileName = c.Scheme.FileName
			}
			if c.SchemeType != nil && c.Scheme.TypeID != c.SchemeType.ID {
				c.Add(binding.ExportIssue{Code: binding.IssueSchemeTypeDiffers, Severity: binding.SeverityWarning, Detail: c.Scheme.Type})
			}
		}
	}

	if err := p.checkItems(ctx, c, d); err != nil {
		return nil, err
	}
	p.checkSVG(c, schemes)
	return c, nil
}

// checkItems reports, per item with bindings of the provider, a shape without a component type and an id that is
// not positive, and per item the bindings of other sources.
func (p *Provider) checkItems(ctx context.Context, c *binding.ExportCheck, d *slddoc.Diagram) error {
	var tcomp map[string]int64
	if c.SchemeType != nil {
		var err error
		if tcomp, err = p.componentTypes(ctx, p.cfg.SchemeType); err != nil {
			return err
		}
	}
	item := func(kind string, id int, shape string, bs []slddoc.Binding) {
		var own int
		other := map[string]bool{}
		for _, b := range bs {
			if b.Source == p.Name() {
				own++
			} else {
				other[b.Source] = true
			}
		}
		for _, src := range sortedKeys(other) {
			c.Add(binding.ExportIssue{Code: binding.IssueOtherSource, Severity: binding.SeverityWarning, Item: id, Kind: kind, Shape: shape, Detail: src})
		}
		if own == 0 {
			return
		}
		c.Bound++
		if id <= 0 {
			c.Add(binding.ExportIssue{Code: binding.IssueBadID, Severity: binding.SeverityError, Item: id, Kind: kind, Shape: shape})
		}
		if tcomp != nil {
			if _, ok := tcomp[strings.TrimSpace(shape)]; !ok {
				c.Add(binding.ExportIssue{Code: binding.IssueNoComponentType, Severity: binding.SeverityWarning, Item: id, Kind: kind, Shape: shape})
			}
		}
	}
	for _, e := range d.Elements {
		item("element", e.ID, e.Shape, e.Bindings)
	}
	for _, dd := range d.DigitalDevices {
		item("device", dd.ID, deviceShape, dd.Bindings)
	}
	for _, l := range d.Labels {
		item("label", l.ID, labelShape, l.Bindings)
	}
	for _, w := range d.Connectors {
		item("wire", w.ID, wireShape+string(w.Kind), w.Bindings)
	}
	if d.Object != nil && d.Object.Source != p.Name() {
		c.Add(binding.ExportIssue{Code: binding.IssueOtherSource, Severity: binding.SeverityWarning, Detail: d.Object.Source})
	}
	if c.Bound == 0 {
		c.Add(binding.ExportIssue{Code: binding.IssueNothingBound, Severity: binding.SeverityWarning})
	}
	return nil
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// checkSVG sets where the scheme's SVG goes and refuses when another scheme resolves to the same file (letter case
// ignored): the same base name without svg.full_path, the same path with it.
func (p *Provider) checkSVG(c *binding.ExportCheck, schemes []binding.Scheme) {
	full := p.cfg.SVG.FullPath
	file, err := svgFile(c.FileName, full)
	if err != nil {
		c.Add(binding.ExportIssue{Code: binding.IssueBadFileName, Severity: binding.SeverityError, Detail: err.Error()})
		return
	}
	c.SVGPath = file
	if dir := p.cfg.SVG.Dir; dir != "" {
		c.SVGPath = path.Join(strings.ReplaceAll(dir, `\`, "/"), file)
	} else if p.cfg.UsesMinio() {
		c.SVGPath = "minio:" + path.Join(p.cfg.SVG.ObjectStorage.Minio.SLDBucket(), file)
	} else {
		c.Add(binding.ExportIssue{Code: binding.IssueNoSVGDir, Severity: binding.SeverityWarning})
	}
	self := ""
	if c.Scheme != nil {
		self = c.Scheme.Ref
	}
	if clash := svgClash(file, self, schemes, full); len(clash) > 0 {
		c.Add(binding.ExportIssue{Code: binding.IssueSVGClash, Severity: binding.SeverityError, Schemes: clash, Detail: file})
	}
}

// svgClash returns the schemes other than self whose SVG is file too (letter case ignored), by ref.
func svgClash(file, self string, schemes []binding.Scheme, fullPath bool) []binding.Scheme {
	var clash []binding.Scheme
	for _, s := range schemes {
		if s.Ref == self {
			continue
		}
		if other, err := svgFile(s.FileName, fullPath); err == nil && strings.EqualFold(other, file) {
			clash = append(clash, s)
		}
	}
	sort.Slice(clash, func(i, j int) bool { return clash[i].Ref < clash[j].Ref })
	return clash
}
