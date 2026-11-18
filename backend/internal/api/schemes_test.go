package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
)

// linkingProvider has schemes 1 (north/sub-2.svg), 2 (south/sub-2.svg) and 3 (other.svg).
type linkingProvider struct{ fakeProvider }

var testSchemes = []binding.Scheme{
	{Ref: "1", Group: "g", Name: "North", FileName: "north/sub-2.svg"},
	{Ref: "2", Group: "g", Name: "South", FileName: `south\sub-2.svg`},
	{Ref: "3", Group: "g", Name: "Other", FileName: "other.svg"},
}

func (linkingProvider) Schemes(context.Context) (*binding.SchemeTree, error) {
	return &binding.SchemeTree{Groups: []binding.SchemeGroup{{ID: "g", Name: "G"}}, Schemes: append([]binding.Scheme(nil), testSchemes...)}, nil
}
func (linkingProvider) Scheme(_ context.Context, ref string) (*binding.Scheme, error) {
	for _, s := range testSchemes {
		if s.Ref == ref {
			return &s, nil
		}
	}
	return nil, fmt.Errorf("%w: scheme %s", binding.ErrNotFound, ref)
}
func (linkingProvider) SchemesExist(_ context.Context, refs []string) (map[string]bool, error) {
	out := map[string]bool{}
	for _, r := range refs {
		out[r] = r == "1" || r == "2" || r == "3"
	}
	return out, nil
}

func decode[T any](t *testing.T, body string) T {
	t.Helper()
	var v T
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		t.Fatalf("%v: %s", err, body)
	}
	return v
}

// Two diagrams named sub-2 in different folders: each is offered its own scheme as a path match, linked to it, and
// a second diagram can't take a linked scheme.
func TestSchemeLinks(t *testing.T) {
	s := newTestServerWithBindings(t, linkingProvider{}, rsduBindings(false))
	if cfg := doJSON(t, s, http.MethodGet, "/api/config", nil); !strings.Contains(cfg.Body.String(), `"schemes":true`) {
		t.Errorf("config: %s", cfg.Body.String())
	}
	type candidates struct {
		Candidates []binding.Candidate `json:"candidates"`
	}
	for _, c := range []struct{ name, ref string }{{"north/sub-2", "1"}, {"south/sub-2", "2"}} {
		rec := doJSON(t, s, http.MethodGet, "/api/bindings/schemes/suggest?name="+c.name, nil)
		got := decode[candidates](t, rec.Body.String()).Candidates
		if len(got) != 2 || got[0].Ref != c.ref || got[0].Match != binding.MatchPath || got[1].Match != binding.MatchName {
			t.Errorf("%s: %+v", c.name, got)
		}
		rec = doJSON(t, s, http.MethodPost, "/api/diagrams", map[string]any{"name": c.name, "scheme": map[string]string{"source": "fake", "ref": c.ref}})
		if rec.Code != http.StatusCreated {
			t.Fatalf("create %s: %d %s", c.name, rec.Code, rec.Body.String())
		}
	}
	rec := doJSON(t, s, http.MethodPost, "/api/diagrams", map[string]any{"name": "third", "scheme": map[string]string{"source": "fake", "ref": "1"}})
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"linkedTo":"north/sub-2"`) {
		t.Errorf("taken on create: %d %s", rec.Code, rec.Body.String())
	}
	d := slddoc.Diagram{Width: 10, Height: 10, Scheme: &slddoc.SchemeRef{Source: "fake", Ref: "2"}}
	rec = doJSON(t, s, http.MethodPut, "/api/diagrams/save?name=north/sub-2", d)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"linkedTo":"south/sub-2"`) {
		t.Errorf("taken on save: %d %s", rec.Code, rec.Body.String())
	}

	tree := decode[binding.SchemeTree](t, doJSON(t, s, http.MethodGet, "/api/bindings/schemes", nil).Body.String())
	linked := map[string]string{}
	for _, sc := range tree.Schemes {
		linked[sc.Ref] = sc.Diagram
	}
	if linked["1"] != "north/sub-2" || linked["2"] != "south/sub-2" || linked["3"] != "" {
		t.Errorf("linked %v", linked)
	}
	// A linked candidate carries its diagram, so the picker can disable it.
	got := decode[candidates](t, doJSON(t, s, http.MethodGet, "/api/bindings/schemes/suggest?name=east/sub-2", nil).Body.String()).Candidates
	if len(got) != 2 || got[0].Diagram == "" || got[0].Match != binding.MatchName {
		t.Errorf("east: %+v", got)
	}
	if rec := doJSON(t, s, http.MethodPost, "/api/diagrams/rename?from=north/sub-2&to=east/sub-2", nil); rec.Code != http.StatusOK {
		t.Fatalf("rename: %d", rec.Code)
	}
	one := decode[binding.Scheme](t, doJSON(t, s, http.MethodGet, "/api/bindings/scheme?ref=1", nil).Body.String())
	if one.Diagram != "east/sub-2" {
		t.Errorf("after rename: %+v", one)
	}
	if rec := doJSON(t, s, http.MethodGet, "/api/bindings/scheme?ref=9", nil); rec.Code != http.StatusNotFound {
		t.Errorf("missing scheme: %d", rec.Code)
	}
	list := doJSON(t, s, http.MethodGet, "/api/diagrams?dir=east", nil).Body.String()
	if !strings.Contains(list, `"scheme":{"source":"fake","ref":"1"}`) || !strings.Contains(list, `"schemeStatus":"linked"`) {
		t.Errorf("list: %s", list)
	}
	exist := doJSON(t, s, http.MethodPost, "/api/bindings/schemes/exist", map[string]any{"refs": []string{"1", "9"}}).Body.String()
	if exist != `{"exist":{"1":true,"9":false}}` {
		t.Errorf("exist: %s", exist)
	}
}

// A provider without schemes has no scheme routes.
func TestSchemeRoutesNeedLinker(t *testing.T) {
	s := newTestServerWithBindings(t, fakeProvider{}, rsduBindings(false))
	if rec := doJSON(t, s, http.MethodGet, "/api/bindings/schemes", nil); rec.Code != http.StatusNotFound {
		t.Errorf("status %d", rec.Code)
	}
}

// fetchingProvider holds the picture of scheme 1 at north/sub-2.svg (full path) and none of scheme 3.
type fetchingProvider struct{ linkingProvider }

func (fetchingProvider) FetchSVG(_ context.Context, ref string) (*binding.FetchedSVG, error) {
	if ref != "1" {
		return nil, fmt.Errorf("%w: the SVG of scheme %s", binding.ErrNotFound, ref)
	}
	svg := `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
<g id="7" data-type="71" >
<path d="M 50 106 v -13" data-state="1" style="fill:none;stroke:white;stroke-width:1" data-voltage="white" />
<path d="M 46 91 h 8 m 0 18 h -8" style="fill:none;stroke:white;stroke-width:1" data-voltage="white" />
<path d="M 50 91 v -1 M 50 109 v 1" style="fill:none;stroke:white;stroke-width:1" data-voltage="white" />
</g>
</svg>`
	return &binding.FetchedSVG{Scheme: testSchemes[0], File: "C:/north/sub-2.svg", FullPath: true, SVG: []byte(svg)}, nil
}

func TestFetchScheme(t *testing.T) {
	s := newTestServerWithBindings(t, fetchingProvider{}, rsduBindings(false))
	if cfg := s.bindingsConfig(); !cfg.Fetch {
		t.Errorf("config %+v", cfg)
	}
	rec := doJSON(t, s, http.MethodPost, "/api/bindings/schemes/fetch?ref=1", nil)
	got := decode[struct {
		Diagram slddoc.Diagram
		Folder  string
		Name    string
		File    string
	}](t, rec.Body.String())
	if rec.Code != http.StatusOK || got.Folder != "north" || got.Name != "sub-2" || got.File != "C:/north/sub-2.svg" ||
		len(got.Diagram.Elements) != 1 || got.Diagram.Elements[0].Shape != "162" {
		t.Fatalf("fetch: %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(t, s, http.MethodPost, "/api/bindings/schemes/fetch?ref=3", nil); rec.Code != http.StatusNotFound {
		t.Errorf("missing picture: %d %s", rec.Code, rec.Body.String())
	}

	doJSON(t, s, http.MethodPut, "/api/diagrams/save?name=north/sub-2", slddoc.Diagram{Width: 10, Height: 10, Scheme: &slddoc.SchemeRef{Source: "fake", Ref: "1"}})
	rec = doJSON(t, s, http.MethodPost, "/api/bindings/schemes/fetch?ref=1", nil)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"diagram":"north/sub-2"`) {
		t.Errorf("linked scheme: %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(t, s, http.MethodPost, "/api/bindings/schemes/fetch?ref=1&diagram=north/sub-2", nil); rec.Code != http.StatusOK {
		t.Errorf("re-fetch: %d %s", rec.Code, rec.Body.String())
	}

	plain := newTestServerWithBindings(t, linkingProvider{}, rsduBindings(false))
	if rec := doJSON(t, plain, http.MethodPost, "/api/bindings/schemes/fetch?ref=1", nil); rec.Code != http.StatusNotFound {
		t.Errorf("without the capability: %d", rec.Code)
	}
}
