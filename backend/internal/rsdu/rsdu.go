// Package rsdu is the binding provider reading and writing an RSDU database (Oracle or PostgreSQL). It is the only
// place that parses an RSDU ref ("tableId:id").
package rsdu

import (
	"context"
	"sync"

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
	infos  tableInfos
	sinks  []svgSink

	mu    sync.Mutex
	dict  *dictionaries
	model *model
}

// New builds the provider from cfg.RSDU without connecting to the database.
func New(cfg config.Bindings) (binding.Provider, error) {
	d, err := NewDialect(cfg.RSDU.Driver, cfg.RSDU.Schema)
	if err != nil {
		return nil, err
	}
	sinks, err := svgSinks(cfg.RSDU)
	if err != nil {
		return nil, err
	}
	p := newProvider(cfg.RSDU, d, newConn(cfg.RSDU.Driver, cfg.RSDU.DSN))
	p.sinks = sinks
	return p, nil
}

// newProvider builds a provider reading through q.
func newProvider(cfg config.RSDUBindings, d Dialect, q Querier) *Provider {
	return &Provider{cfg: cfg, d: d, read: q, tables: newTables(q, d)}
}

func (p *Provider) Name() string { return config.ProviderRSDU }

// Refresh drops the cached dictionaries, type model, column dictionary and table information.
func (p *Provider) Refresh() {
	p.mu.Lock()
	p.dict = nil
	p.model = nil
	p.mu.Unlock()
	p.tables.reset()
	p.infos.mu.Lock()
	p.infos.m = nil
	p.infos.mu.Unlock()
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
	out := dict.public
	if out.ComponentTypes, err = p.ComponentTypes(ctx); err != nil {
		return nil, err
	}
	return &out, nil
}
