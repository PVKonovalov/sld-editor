package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
	"sld-editor/internal/config"
	_ "sld-editor/internal/rsdu"
)

type fakeProvider struct{}

func (fakeProvider) Name() string { return "fake" }
func (fakeProvider) Dictionaries(context.Context) (*binding.Dictionaries, error) {
	return &binding.Dictionaries{Kinds: []binding.KindInfo{{Kind: slddoc.BindingEquipment, Name: "Equipment"}}}, nil
}
func (fakeProvider) Sections(context.Context) ([]binding.Section, error) { return nil, nil }
func (fakeProvider) Catalog(context.Context, string) ([]binding.Node, error) {
	return nil, nil
}
func (fakeProvider) List(context.Context, string, string) ([]binding.Object, error) {
	return nil, nil
}
func (fakeProvider) Search(context.Context, string, string, int) (*binding.SearchResult, error) {
	return nil, nil
}
func (fakeProvider) Resolve(context.Context, string) (*binding.Resolved, error) {
	return nil, binding.ErrNotImplemented
}
func (fakeProvider) Suggest(context.Context, string, binding.Element) ([]slddoc.Binding, error) {
	return nil, nil
}

type fakeExporter struct{ fakeProvider }

func (fakeExporter) Export(context.Context, string, *slddoc.Diagram, binding.ExportRequest) (*binding.ExportResult, error) {
	return nil, nil
}

func rsduBindings(export bool) config.Bindings {
	b := config.Bindings{Provider: config.ProviderRSDU}
	b.RSDU.Driver = config.DriverOracle
	b.RSDU.DSN = config.DSN{Host: "db", Port: 1521, User: "u", Sid: "S"}
	b.RSDU.Export = export
	return b
}

func TestConfigBindings(t *testing.T) {
	cases := []struct {
		name     string
		provider binding.Provider
		cfg      config.Bindings
		want     bindingsConfig
		dictCode int
	}{
		{"off", nil, config.Bindings{}, bindingsConfig{}, http.StatusNotFound},
		{"provider without export", fakeProvider{}, rsduBindings(true), bindingsConfig{Provider: "fake"}, http.StatusOK},
		{"exporter without export", fakeExporter{}, rsduBindings(false), bindingsConfig{Provider: "fake"}, http.StatusOK},
		{"exporter with write", fakeExporter{}, rsduBindings(true), bindingsConfig{Provider: "fake", CanExport: true}, http.StatusOK},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := newTestServerWithBindings(t, c.provider, c.cfg)
			rec := doJSON(t, s, http.MethodGet, "/api/config", nil)
			var resp struct {
				Bindings bindingsConfig `json:"bindings"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || rec.Code != http.StatusOK {
				t.Fatalf("config: status = %d, body = %s", rec.Code, rec.Body.String())
			}
			if resp.Bindings != c.want {
				t.Errorf("bindings = %+v, want %+v", resp.Bindings, c.want)
			}
			if rec := doJSON(t, s, http.MethodGet, "/api/bindings/dictionaries", nil); rec.Code != c.dictCode {
				t.Errorf("dictionaries: status = %d, want %d", rec.Code, c.dictCode)
			}
		})
	}
}

func TestBindingsDataSourceDown(t *testing.T) {
	cfg := rsduBindings(false)
	cfg.RSDU.DSN.Host, cfg.RSDU.DSN.Port = "127.0.0.1", 1
	p, err := binding.New(cfg)
	if err != nil || p == nil || p.Name() != config.ProviderRSDU {
		t.Fatalf("rsdu provider not registered: %v %v", p, err)
	}
	s := newTestServerWithBindings(t, p, cfg)
	if rec := doJSON(t, s, http.MethodGet, "/api/bindings/dictionaries", nil); rec.Code != http.StatusBadGateway {
		t.Errorf("unreachable database: status = %d, want 502, body = %s", rec.Code, rec.Body.String())
	}
}

type refreshingProvider struct {
	fakeProvider
	refreshed int
}

func (p *refreshingProvider) Refresh() { p.refreshed++ }

func TestBindingDictionariesRefresh(t *testing.T) {
	p := &refreshingProvider{}
	s := newTestServerWithBindings(t, p, rsduBindings(false))
	doJSON(t, s, http.MethodGet, "/api/bindings/dictionaries", nil)
	if p.refreshed != 0 {
		t.Errorf("refreshed without ?refresh=1")
	}
	if rec := doJSON(t, s, http.MethodGet, "/api/bindings/dictionaries?refresh=1", nil); rec.Code != http.StatusOK || p.refreshed != 1 {
		t.Errorf("refresh: status = %d, refreshed = %d", rec.Code, p.refreshed)
	}
}

// resolvingProvider knows the objects in objs; "bad:*" refs can't be bound, "down" fails like a lost database.
type resolvingProvider struct {
	fakeProvider
	objs map[string]binding.Resolved
}

func (p resolvingProvider) Resolve(_ context.Context, ref string) (*binding.Resolved, error) {
	switch {
	case ref == "down":
		return nil, errors.New("connection refused")
	case strings.HasPrefix(ref, "bad:"):
		return nil, fmt.Errorf("%w: %s", binding.ErrInvalid, ref)
	}
	if o, ok := p.objs[ref]; ok {
		return &o, nil
	}
	return nil, fmt.Errorf("%w: %s", binding.ErrNotFound, ref)
}

func TestBindingObject(t *testing.T) {
	p := resolvingProvider{objs: map[string]binding.Resolved{
		"1:2": {Ref: "1:2", Name: "Q1", Kind: slddoc.BindingEquipment, Option: "OPT"},
	}}
	s := newTestServerWithBindings(t, p, rsduBindings(false))
	rec := doJSON(t, s, http.MethodGet, "/api/bindings/object?ref=1:2", nil)
	var got binding.Resolved
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || rec.Code != http.StatusOK || got != p.objs["1:2"] {
		t.Errorf("object: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	for ref, want := range map[string]int{"1:3": http.StatusNotFound, "bad:1": http.StatusBadRequest, "down": http.StatusBadGateway} {
		if rec := doJSON(t, s, http.MethodGet, "/api/bindings/object?ref="+ref, nil); rec.Code != want {
			t.Errorf("%s: status = %d, want %d", ref, rec.Code, want)
		}
	}
}

func TestBindingObjects(t *testing.T) {
	p := resolvingProvider{objs: map[string]binding.Resolved{
		"1:2": {Ref: "1:2", Name: "Q1", Kind: slddoc.BindingEquipment},
		"5:6": {Ref: "5:6", Name: "Ia", Kind: slddoc.BindingMeas1},
	}}
	s := newTestServerWithBindings(t, p, rsduBindings(false))
	rec := doJSON(t, s, http.MethodPost, "/api/bindings/objects", map[string]any{"refs": []string{"1:2", "1:3", "5:6", "bad:1", "1:2"}})
	var got struct {
		Objects map[string]binding.Resolved `json:"objects"`
		Missing []string                    `json:"missing"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("objects: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if len(got.Objects) != 2 || got.Objects["5:6"].Name != "Ia" || strings.Join(got.Missing, ",") != "1:3,bad:1" {
		t.Errorf("objects = %+v", got)
	}
	if rec := doJSON(t, s, http.MethodPost, "/api/bindings/objects", map[string]any{"refs": []string{"1:2", "down"}}); rec.Code != http.StatusBadGateway {
		t.Errorf("data source down: status = %d", rec.Code)
	}
	if rec := doJSON(t, s, http.MethodPost, "/api/bindings/objects", map[string]any{"refs": make([]string, maxResolveRefs+1)}); rec.Code != http.StatusBadRequest {
		t.Errorf("too many refs: status = %d", rec.Code)
	}
}

// suggestingProvider proposes an equipment binding for "1:2" and records the element it was asked for.
type suggestingProvider struct {
	fakeProvider
	got *binding.Element
}

func (p suggestingProvider) Suggest(_ context.Context, ref string, el binding.Element) ([]slddoc.Binding, error) {
	*p.got = el
	switch ref {
	case "1:2":
		return []slddoc.Binding{{Source: "fake", Kind: slddoc.BindingEquipment, Ref: "1:2", Name: "Q1"}}, nil
	case "bad":
		return nil, fmt.Errorf("%w: bad", binding.ErrInvalid)
	}
	return nil, nil
}

func TestBindingSuggest(t *testing.T) {
	p := suggestingProvider{got: &binding.Element{}}
	s := newTestServerWithBindings(t, p, rsduBindings(false))
	rec := doJSON(t, s, http.MethodPost, "/api/bindings/suggest", map[string]any{"ref": "1:2", "element": map[string]string{"shape": "41", "class": "Breaker"}})
	var got struct {
		Bindings []slddoc.Binding `json:"bindings"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || rec.Code != http.StatusOK || len(got.Bindings) != 1 || got.Bindings[0].Name != "Q1" {
		t.Errorf("suggest: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if *p.got != (binding.Element{Shape: "41", Class: "Breaker"}) {
		t.Errorf("element = %+v", *p.got)
	}
	rec = doJSON(t, s, http.MethodPost, "/api/bindings/suggest", map[string]any{"ref": "5:6"})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"bindings":[]`) {
		t.Errorf("nothing proposed: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(t, s, http.MethodPost, "/api/bindings/suggest", map[string]any{"ref": "bad"}); rec.Code != http.StatusBadRequest {
		t.Errorf("bad ref: status = %d", rec.Code)
	}
}

func TestBindingPath(t *testing.T) {
	p := resolvingProvider{objs: map[string]binding.Resolved{
		"9:1": {Ref: "9:1", Name: "Root"},
		"9:2": {Ref: "9:2", Name: "Substation", ParentRef: "9:1"},
		"5:6": {Ref: "5:6", Name: "Ia", ParentRef: "9:2"},
		"5:7": {Ref: "5:7", Name: "Orphan", ParentRef: "9:99"},
		"8:1": {Ref: "8:1", Name: "Loop", ParentRef: "8:2"},
		"8:2": {Ref: "8:2", Name: "Back", ParentRef: "8:1"},
	}}
	s := newTestServerWithBindings(t, p, rsduBindings(false))
	path := func(ref string) (int, string) {
		rec := doJSON(t, s, http.MethodGet, "/api/bindings/path?ref="+ref, nil)
		var got struct {
			Path []PathNode `json:"path"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &got)
		var names []string
		for _, n := range got.Path {
			names = append(names, n.Name)
		}
		return rec.Code, strings.Join(names, "/")
	}
	for ref, want := range map[string]string{"5:6": "Root/Substation/Ia", "5:7": "Orphan", "8:1": "Back/Loop"} {
		if code, got := path(ref); code != http.StatusOK || got != want {
			t.Errorf("%s: %d %q, want %q", ref, code, got, want)
		}
	}
	if code, _ := path("1:3"); code != http.StatusNotFound {
		t.Errorf("missing object: %d", code)
	}
}
