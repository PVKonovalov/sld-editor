// Package rsdu is the binding provider reading and writing an RSDU database (Oracle or PostgreSQL). It is the only
// place that parses an RSDU ref ("tableId:id").
package rsdu

import (
	"context"
	"sync"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
	"sld-editor/internal/config"
)

func init() {
	binding.Register(config.ProviderRSDU, New)
}

// Provider is the rsdu binding provider. Reference data is read on first use and kept until Refresh.
type Provider struct {
	cfg    config.RSDUBindings
	d      Dialect
	read   Querier
	tables *tables

	mu   sync.Mutex
	dict *dictionaries
}

// New builds the provider from cfg.RSDU without connecting to the database.
func New(cfg config.Bindings) (binding.Provider, error) {
	d, err := NewDialect(cfg.RSDU.Driver, cfg.RSDU.Schema)
	if err != nil {
		return nil, err
	}
	return newProvider(cfg.RSDU, d, newConn(cfg.RSDU.Driver, cfg.RSDU.Read)), nil
}

// newProvider builds a provider reading through q.
func newProvider(cfg config.RSDUBindings, d Dialect, q Querier) *Provider {
	return &Provider{cfg: cfg, d: d, read: q, tables: newTables(q, d)}
}

func (p *Provider) Name() string { return config.ProviderRSDU }

// Refresh drops the cached dictionaries and column dictionary.
func (p *Provider) Refresh() {
	p.mu.Lock()
	p.dict = nil
	p.mu.Unlock()
	p.tables.reset()
}

func (p *Provider) dictionaries(ctx context.Context) (*dictionaries, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.dict != nil {
		return p.dict, nil
	}
	dict, err := loadDictionaries(ctx, p.read, p.d)
	if err != nil {
		return nil, err
	}
	p.dict = dict
	return dict, nil
}

func (p *Provider) Dictionaries(ctx context.Context) (*binding.Dictionaries, error) {
	dict, err := p.dictionaries(ctx)
	if err != nil {
		return nil, err
	}
	return &dict.public, nil
}

func (p *Provider) Sections(context.Context) ([]binding.Section, error) {
	return nil, binding.ErrNotImplemented
}

func (p *Provider) Catalog(context.Context, string) ([]binding.Node, error) {
	return nil, binding.ErrNotImplemented
}

func (p *Provider) List(context.Context, string, string) ([]binding.Object, error) {
	return nil, binding.ErrNotImplemented
}

func (p *Provider) Resolve(context.Context, string) (*binding.Object, error) {
	return nil, binding.ErrNotImplemented
}

func (p *Provider) Suggest(context.Context, string, string) ([]slddoc.Binding, error) {
	return nil, binding.ErrNotImplemented
}
