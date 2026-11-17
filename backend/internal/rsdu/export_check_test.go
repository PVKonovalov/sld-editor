package rsdu

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
)

func exportDB() *fakeDB {
	return &fakeDB{rows: func(q string, args []any) [][]any {
		switch {
		case strings.Contains(q, "VS_TYPE_V"):
			return [][]any{{int64(518), "MODUS"}, {int64(520), "TOPAZ"}}
		case strings.Contains(q, "FROM rsduadmin.VS_TCOMP"):
			if args[0].(int64) != 518 {
				return nil
			}
			return [][]any{{int64(6), int64(41)}, {int64(567), int64(134)}}
		case strings.Contains(q, "FROM rsduadmin.VS_FORM f"):
			return [][]any{
				{int64(10), int64(2), int64(518), "Sub", "MODUS", `region\sub.xsde`, nil},
				{int64(11), int64(2), int64(518), "Other sub", "MODUS", `other\SUB.xsde`, nil},
				{int64(12), int64(3), int64(520), "Topaz", "TOPAZ", `t/topaz.sde`, nil},
				{int64(13), int64(3), int64(518), "New one", "MODUS", `a/new.svg`, nil},
			}
		}
		return nil
	}}
}

func codes(c *binding.ExportCheck) []string {
	var out []string
	for _, i := range c.Issues {
		out = append(out, i.Code)
	}
	return out
}

func boundDiagram() *slddoc.Diagram {
	rsdu := []slddoc.Binding{{Source: "rsdu", Kind: "equipment", Ref: "1:2"}}
	return &slddoc.Diagram{
		Elements: []slddoc.Element{
			{ID: 1, Shape: "41", Bindings: rsdu},
			{ID: 2, Shape: "999", Bindings: rsdu},
			{ID: 3, Shape: "41", Bindings: []slddoc.Binding{{Source: "other", Kind: "equipment", Ref: "x"}}},
			{ID: 4, Shape: "41"},
			{ID: 0, Shape: "41", Bindings: rsdu},
		},
		DigitalDevices: []slddoc.DigitalDevice{{ID: 5, Bindings: rsdu}},
	}
}

func TestCheckExport(t *testing.T) {
	ctx := context.Background()
	p := newFakeProvider(t, exportDB())
	p.cfg.SchemeType = 518
	p.cfg.SVG.Dir = "/srv/sld"
	p.cfg.SVG.FullPath = true

	c, err := p.CheckExport(ctx, "region/sub", boundDiagram(), &slddoc.SchemeRef{Source: "rsdu", Ref: "10"})
	if err != nil {
		t.Fatal(err)
	}
	if c.OK || c.Scheme == nil || c.Scheme.Ref != "10" || c.SchemeType == nil || c.SchemeType.ID != "518" || c.Bound != 4 {
		t.Fatalf("check %+v", c)
	}
	if c.SVGPath != "/srv/sld/region/sub.svg" || c.FileName != `region\sub.xsde` {
		t.Errorf("svg %q file %q", c.SVGPath, c.FileName)
	}
	if got, want := codes(c), []string{binding.IssueNoComponentType, binding.IssueOtherSource, binding.IssueBadID}; !slices.Equal(got, want) {
		t.Errorf("issues %v, want %v", got, want)
	}
	if c.Issues[0].Item != 2 || c.Issues[0].Shape != "999" || c.Issues[1].Detail != "other" || c.Issues[2].Severity != binding.SeverityError {
		t.Errorf("issues %+v", c.Issues)
	}

	// Without full paths, scheme 11's base name is the same, letter case aside.
	p.cfg.SVG.FullPath = false
	c, _ = p.CheckExport(ctx, "region/sub", &slddoc.Diagram{}, &slddoc.SchemeRef{Source: "rsdu", Ref: "10"})
	i := slices.IndexFunc(c.Issues, func(i binding.ExportIssue) bool { return i.Code == binding.IssueSVGClash })
	if c.OK || i < 0 || len(c.Issues[i].Schemes) != 1 || c.Issues[i].Schemes[0].Ref != "11" || c.SVGPath != "/srv/sld/sub.svg" {
		t.Errorf("base-name clash: %+v", c)
	}

	// A new scheme: its file name is the diagram path, which scheme 13 already resolves to.
	p.cfg.SVG.FullPath = true
	p.cfg.SVG.Dir = ""
	c, _ = p.CheckExport(ctx, "a/new", &slddoc.Diagram{}, nil)
	if c.Scheme != nil || c.FileName != "a/new.svg" || c.SVGPath != "a/new.svg" {
		t.Errorf("new scheme %+v", c)
	}
	if got, want := codes(c), []string{binding.IssueNotLinked, binding.IssueNothingBound, binding.IssueNoSVGDir, binding.IssueSVGClash}; !slices.Equal(got, want) {
		t.Errorf("new scheme issues %v, want %v", got, want)
	}

	// A free new path is fine; warnings don't fail it.
	ok := boundDiagram()
	ok.Elements = ok.Elements[:4]
	c, _ = p.CheckExport(ctx, "b/new", ok, nil)
	if !c.OK || c.Bound != 3 {
		t.Errorf("free path: %v", codes(c))
	}

	// Gone scheme, other type, bad file name.
	c, _ = p.CheckExport(ctx, "x", &slddoc.Diagram{}, &slddoc.SchemeRef{Source: "rsdu", Ref: "99"})
	if !slices.Contains(codes(c), binding.IssueSchemeMissing) || c.OK {
		t.Errorf("missing: %v", codes(c))
	}
	c, _ = p.CheckExport(ctx, "x", &slddoc.Diagram{}, &slddoc.SchemeRef{Source: "rsdu", Ref: "12"})
	if got := codes(c); !slices.Contains(got, binding.IssueSchemeTypeDiffers) || !slices.Contains(got, binding.IssueBadFileName) || c.OK {
		t.Errorf("topaz: %v", got)
	}

	// Scheme type not configured, or not a scheme type.
	p.cfg.SchemeType = 0
	c, _ = p.CheckExport(ctx, "b/new", boundDiagram(), nil)
	if c.OK || c.Issues[0].Code != binding.IssueNoSchemeType || slices.Contains(codes(c), binding.IssueNoComponentType) {
		t.Errorf("no type: %v", codes(c))
	}
	p.cfg.SchemeType = 7
	c, _ = p.CheckExport(ctx, "b/new", boundDiagram(), nil)
	if c.OK || c.Issues[0].Code != binding.IssueUnknownSchemeType {
		t.Errorf("unknown type: %v", codes(c))
	}
}

func TestSVGFile(t *testing.T) {
	for _, tc := range []struct {
		name string
		full bool
		want string
		bad  bool
	}{
		{`a\b\c.xsde`, true, "a/b/c.svg", false},
		{`a\b\c.XSDE`, false, "c.svg", false},
		{"/abs/c.svg", true, "abs/c.svg", false},
		{"c.sde", true, "", true},
		{"../up.svg", true, "", true},
		{"../up.svg", false, "up.svg", false},
		{"", true, "", true},
	} {
		got, err := svgFile(tc.name, tc.full)
		if (err != nil) != tc.bad || got != tc.want {
			t.Errorf("svgFile(%q, %v) = %q, %v", tc.name, tc.full, got, err)
		}
	}
}

func TestSchemeTypesAndGroups(t *testing.T) {
	p := newFakeProvider(t, exportDB())
	types, err := p.SchemeTypes(context.Background())
	if err != nil || len(types) != 2 || types[0].ID != "518" || types[1].Name != "TOPAZ" {
		t.Errorf("types %+v, %v", types, err)
	}
	p = newFakeProvider(t, schemesDB())
	groups, err := p.SchemeGroups(context.Background())
	if err != nil || len(groups) != 3 || groups[0].Name != "A root" {
		t.Errorf("groups %+v, %v", groups, err)
	}
}
