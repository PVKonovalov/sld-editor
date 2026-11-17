package api

import (
	"context"
	"encoding/json"
	"net/http"
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
func (fakeProvider) Resolve(context.Context, string) (*binding.Object, error) {
	return nil, binding.ErrNotImplemented
}
func (fakeProvider) Suggest(context.Context, string, string) ([]slddoc.Binding, error) {
	return nil, nil
}

type fakeExporter struct{ fakeProvider }

func (fakeExporter) Export(context.Context, string, *slddoc.Diagram) (*slddoc.SchemeRef, error) {
	return nil, nil
}

func rsduBindings(write bool) config.Bindings {
	b := config.Bindings{Provider: config.ProviderRSDU}
	b.RSDU.Driver = config.DriverOracle
	b.RSDU.Read = config.DSN{Host: "db", Port: 1521, User: "u", Sid: "S"}
	if write {
		b.RSDU.Write = b.RSDU.Read
	}
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
		{"exporter without write", fakeExporter{}, rsduBindings(false), bindingsConfig{Provider: "fake"}, http.StatusOK},
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
	cfg.RSDU.Read.Host, cfg.RSDU.Read.Port = "127.0.0.1", 1
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
