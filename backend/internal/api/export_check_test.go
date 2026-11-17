package api

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
)

// checkingProvider checks nothing but the link: a nil scheme is a new one.
type checkingProvider struct{ linkingProvider }

func (checkingProvider) CheckExport(_ context.Context, name string, _ *slddoc.Diagram, scheme *slddoc.SchemeRef) (*binding.ExportCheck, error) {
	c := &binding.ExportCheck{OK: true, Issues: []binding.ExportIssue{}, FileName: name + ".svg"}
	if scheme == nil {
		c.Add(binding.ExportIssue{Code: binding.IssueNotLinked, Severity: binding.SeverityWarning})
		return c, nil
	}
	for _, s := range testSchemes {
		if s.Ref == scheme.Ref {
			c.Scheme = &s
		}
	}
	return c, nil
}
func (checkingProvider) SchemeGroups(context.Context) ([]binding.SchemeGroup, error) {
	return []binding.SchemeGroup{{ID: "g", Name: "G"}}, nil
}
func (checkingProvider) SchemeTypes(context.Context) ([]binding.SchemeType, error) {
	return []binding.SchemeType{{ID: "518", Name: "MODUS"}}, nil
}

func TestExportCheck(t *testing.T) {
	s := newTestServerWithBindings(t, checkingProvider{}, rsduBindings(false))
	if cfg := doJSON(t, s, http.MethodGet, "/api/config", nil); !strings.Contains(cfg.Body.String(), `"exportCheck":true`) {
		t.Errorf("config: %s", cfg.Body.String())
	}
	check := func(name string) binding.ExportCheck {
		t.Helper()
		rec := doJSON(t, s, http.MethodGet, "/api/bindings/export/check?name="+name, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("check %s: %d %s", name, rec.Code, rec.Body.String())
		}
		return decode[binding.ExportCheck](t, rec.Body.String())
	}
	codesOf := func(c binding.ExportCheck) []string {
		var out []string
		for _, i := range c.Issues {
			out = append(out, i.Code)
		}
		return out
	}

	at := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	save := func(name string, scheme *slddoc.SchemeRef) {
		t.Helper()
		rec := doJSON(t, s, http.MethodPut, "/api/diagrams/save?name="+name, slddoc.Diagram{Width: 10, Height: 10, Scheme: scheme})
		if rec.Code != http.StatusOK {
			t.Fatalf("save %s: %d %s", name, rec.Code, rec.Body.String())
		}
	}
	for _, n := range []string{"a/x", "b/new", "c/other"} {
		doJSON(t, s, http.MethodPost, "/api/diagrams", map[string]any{"name": n})
	}

	// No export yet: a new scheme gets no default group.
	if c := check("b/new"); c.Scheme != nil || c.DefaultGroup != "" || !slices.Equal(codesOf(c), []string{binding.IssueNotLinked}) || !c.OK {
		t.Errorf("new before any export: %+v", c)
	}
	save("a/x", &slddoc.SchemeRef{Source: "fake", Ref: "1", Exported: &at})
	if c := check("b/new"); c.DefaultGroup != "g" {
		t.Errorf("default group: %+v", c)
	}
	if c := check("a/x"); c.Scheme == nil || c.Scheme.Diagram != "a/x" || c.DefaultGroup != "" || !c.OK {
		t.Errorf("linked: %+v", c)
	}
	save("c/other", &slddoc.SchemeRef{Source: "elsewhere", Ref: "9"})
	if c := check("c/other"); c.OK || !slices.Equal(codesOf(c), []string{binding.IssueOtherSourceScheme}) || c.Issues[0].Detail != "elsewhere" {
		t.Errorf("other provider's scheme: %+v", c)
	}
	if rec := doJSON(t, s, http.MethodGet, "/api/bindings/export/check?name=nope", nil); rec.Code != http.StatusNotFound {
		t.Errorf("missing diagram: %d", rec.Code)
	}
	for _, path := range []string{"/api/bindings/scheme-groups", "/api/bindings/scheme-types"} {
		if rec := doJSON(t, s, http.MethodGet, path, nil); rec.Code != http.StatusOK || !strings.HasPrefix(rec.Body.String(), "[{") {
			t.Errorf("%s: %d %s", path, rec.Code, rec.Body.String())
		}
	}
}

func TestExportCheckNeedsChecker(t *testing.T) {
	s := newTestServerWithBindings(t, linkingProvider{}, rsduBindings(false))
	if rec := doJSON(t, s, http.MethodGet, "/api/bindings/scheme-types", nil); rec.Code != http.StatusNotFound {
		t.Errorf("scheme-types without a checker: %d", rec.Code)
	}
	if cfg := doJSON(t, s, http.MethodGet, "/api/config", nil); !strings.Contains(cfg.Body.String(), `"exportCheck":false`) {
		t.Errorf("config: %s", cfg.Body.String())
	}
}

// exportingProvider registers scheme "77" or exports to the linked one.
type exportingProvider struct{ checkingProvider }

func (exportingProvider) Export(_ context.Context, _ string, d *slddoc.Diagram, req binding.ExportRequest) (*binding.ExportResult, error) {
	at := time.Now().UTC().Truncate(time.Second)
	if req.Register || d.Scheme == nil {
		return &binding.ExportResult{Scheme: slddoc.SchemeRef{Source: "fake", Ref: "77", Exported: &at, Registered: true}, Registered: true, Skipped: []binding.ExportIssue{}}, nil
	}
	ref := *d.Scheme
	ref.Exported = &at
	return &binding.ExportResult{Scheme: ref, Components: 1, Bindings: 2, Skipped: []binding.ExportIssue{}}, nil
}

func TestExport(t *testing.T) {
	off := newTestServerWithBindings(t, exportingProvider{}, rsduBindings(false))
	doJSON(t, off, http.MethodPost, "/api/diagrams", map[string]any{"name": "a"})
	if rec := doJSON(t, off, http.MethodPost, "/api/bindings/export?name=a", map[string]any{"register": true}); rec.Code != http.StatusForbidden {
		t.Errorf("export off: %d %s", rec.Code, rec.Body.String())
	}

	s := newTestServerWithBindings(t, exportingProvider{}, rsduBindings(true))
	if cfg := doJSON(t, s, http.MethodGet, "/api/config", nil); !strings.Contains(cfg.Body.String(), `"canExport":true`) {
		t.Errorf("config: %s", cfg.Body.String())
	}
	for _, n := range []string{"a/new", "north/sub-2", "x/other"} {
		doJSON(t, s, http.MethodPost, "/api/diagrams", map[string]any{"name": n})
	}
	rec := doJSON(t, s, http.MethodPost, "/api/bindings/export?name=a/new", map[string]any{"register": true, "name": "New", "group": "g"})
	if rec.Code != http.StatusOK {
		t.Fatalf("register: %d %s", rec.Code, rec.Body.String())
	}
	res := decode[binding.ExportResult](t, rec.Body.String())
	if res.Scheme.Ref != "77" || !res.Registered {
		t.Errorf("result %+v", res)
	}
	opened := doJSON(t, s, http.MethodGet, "/api/diagrams/open?name=a/new", nil).Body.String()
	if !strings.Contains(opened, `"ref":"77"`) || !strings.Contains(opened, `"registered":true`) || !strings.Contains(opened, `"history":[{`) {
		t.Errorf("saved diagram: %.400s", opened)
	}
	list := doJSON(t, s, http.MethodGet, "/api/diagrams?dir=a", nil).Body.String()
	if !strings.Contains(list, `"schemeStatus":"exported"`) {
		t.Errorf("status after export: %s", list)
	}
	// The new scheme's group is now the default of the next new one.
	if c := decode[binding.ExportCheck](t, doJSON(t, s, http.MethodGet, "/api/bindings/export/check?name=x/other", nil).Body.String()); c.DefaultGroup != "" {
		t.Logf("default group %q (scheme 77 is unknown to the fake, so none)", c.DefaultGroup)
	}

	// Registering anew while the linked scheme exists is refused; so is a scheme whose file is another diagram's.
	save := func(name string, scheme *slddoc.SchemeRef) {
		t.Helper()
		if rec := doJSON(t, s, http.MethodPut, "/api/diagrams/save?name="+name, slddoc.Diagram{Width: 10, Height: 10, Scheme: scheme}); rec.Code != http.StatusOK {
			t.Fatalf("save %s: %d %s", name, rec.Code, rec.Body.String())
		}
	}
	save("x/other", &slddoc.SchemeRef{Source: "fake", Ref: "1"})
	rec = doJSON(t, s, http.MethodPost, "/api/bindings/export?name=x/other", map[string]any{"register": true, "name": "N", "group": "g"})
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), binding.IssueSchemeExists) {
		t.Errorf("register while linked: %d %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(t, s, http.MethodPost, "/api/bindings/export?name=x/other", map[string]any{})
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), binding.IssueFileOfDiagram) || !strings.Contains(rec.Body.String(), `"detail":"north/sub-2"`) {
		t.Errorf("file of another diagram: %d %s", rec.Code, rec.Body.String())
	}
	// Linked to the scheme whose file is its own path: exported, link kept, not registered.
	save("x/other", nil)
	save("north/sub-2", &slddoc.SchemeRef{Source: "fake", Ref: "1"})
	rec = doJSON(t, s, http.MethodPost, "/api/bindings/export?name=north/sub-2", map[string]any{})
	if rec.Code != http.StatusOK {
		t.Fatalf("linked export: %d %s", rec.Code, rec.Body.String())
	}
	if res := decode[binding.ExportResult](t, rec.Body.String()); res.Scheme.Ref != "1" || res.Registered || res.Bindings != 2 {
		t.Errorf("linked result %+v", res)
	}
}

// deliveringProvider records the SVGs delivered, by scheme; fail makes a delivery fail.
type deliveringProvider struct {
	exportingProvider
	got  map[string]string
	fail *bool
}

func (p deliveringProvider) DeliverSVG(_ context.Context, ref string, svg []byte) ([]string, error) {
	if *p.fail {
		return nil, errors.New("viewer folder unreachable")
	}
	p.got[ref] = string(svg)
	return []string{"/sld/" + ref + ".svg"}, nil
}

func TestDeliverSVGOnExportAndSave(t *testing.T) {
	fail := false
	p := deliveringProvider{got: map[string]string{}, fail: &fail}
	s := newTestServerWithBindings(t, p, rsduBindings(true))
	doJSON(t, s, http.MethodPost, "/api/diagrams", map[string]any{"name": "d/one"})

	rec := doJSON(t, s, http.MethodPost, "/api/bindings/export?name=d/one", map[string]any{"register": true, "name": "One", "group": "g"})
	res := decode[binding.ExportResult](t, rec.Body.String())
	if rec.Code != http.StatusOK || len(res.SVG) != 1 || res.SVGError != "" || !strings.Contains(p.got["77"], "<svg") {
		t.Fatalf("export: %d %s; delivered %v", rec.Code, rec.Body.String(), p.got)
	}

	opened := decode[struct{ Diagram slddoc.Diagram }](t, doJSON(t, s, http.MethodGet, "/api/diagrams/open?name=d/one", nil).Body.String())
	d := opened.Diagram
	d.Width = 1234
	delete(p.got, "77")
	if rec := doJSON(t, s, http.MethodPut, "/api/diagrams/save?name=d/one", d); rec.Code != http.StatusOK || !strings.Contains(p.got["77"], `width="1234"`) {
		t.Errorf("save of an exported diagram: %d %s; delivered %.80q", rec.Code, rec.Body.String(), p.got["77"])
	}

	fail = true
	rec = doJSON(t, s, http.MethodPut, "/api/diagrams/save?name=d/one", d)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "not delivered") {
		t.Errorf("failed delivery: %d %s", rec.Code, rec.Body.String())
	}
	fail = false

	// Never exported, or export off: nothing is delivered.
	delete(p.got, "5")
	doJSON(t, s, http.MethodPut, "/api/diagrams/save?name=d/two", slddoc.Diagram{Width: 10, Height: 10, Scheme: &slddoc.SchemeRef{Source: "fake", Ref: "5"}})
	off := newTestServerWithBindings(t, p, rsduBindings(false))
	at := time.Now()
	doJSON(t, off, http.MethodPut, "/api/diagrams/save?name=d/three", slddoc.Diagram{Width: 10, Height: 10, Scheme: &slddoc.SchemeRef{Source: "fake", Ref: "6", Exported: &at}})
	if _, ok := p.got["5"]; ok {
		t.Error("a never exported diagram was delivered")
	}
	if _, ok := p.got["6"]; ok {
		t.Error("delivered with export off")
	}
}
