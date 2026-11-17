package api

import (
	"context"
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
