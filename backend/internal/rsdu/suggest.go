package rsdu

import (
	"cmp"
	"context"
	"database/sql"
	"fmt"
	"slices"
	"strings"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
)

// Type aliases RSDU's automatic binding (SchemeTuneService) decides by.
const (
	otypPrefix          = "OTYP_"
	measPrefix          = "MEAS_"
	otypSwitch          = "OTYP_SWITCH"
	otypDevicePanel     = "OTYP_DEVICE_PANEL"
	otypInformationView = "OTYP_INFORMATION_VIEW"
	withdrawableSuffix  = "_WITHDRAWABLE"
	measSwitchState     = "MEAS_SWITCH_STATE"
	measSwitchStateDraw = "MEAS_SWITCH_STATE_DRAWER"
	measListGen         = "MEAS_LIST_GEN"
	equipTableAlias     = "OBJ_TREE_GEN"
	equipTableName      = "OBJ_TREE"
	measListTableName   = "MEAS_LIST"
	measListLink        = 5
)

// switchStateTypes are the measurement types of a switch's position (RSDU's _measSwitchStateAliases).
var switchStateTypes = map[string]bool{
	measSwitchState: true, measSwitchState + "_A": true, measSwitchState + "_B": true, measSwitchState + "_C": true,
	measSwitchStateDraw: true,
}

// model is what RSDU's scheme editor takes from its model cache, read from the database: each object type's
// ancestors (SYS_OTYP.ID_PARENT), each measurement type's global type, the measurement list tables (in id order)
// and the equipment table.
type model struct {
	ancestors  map[string][]string
	measGlobal map[string]string
	measTables []measTable
	equipID    int64
}

type measTable struct {
	id   int64
	name string
}

func (p *Provider) loadModel(ctx context.Context) (*model, error) {
	p.mu.Lock()
	m := p.model
	p.mu.Unlock()
	if m != nil {
		return m, nil
	}
	m = &model{ancestors: map[string][]string{}, measGlobal: map[string]string{}}

	parent := map[int64]int64{}
	alias := map[int64]string{}
	err := each(ctx, p.read, p.d.SQL(sqlObjectTypes), func(r Rows) error {
		var id, par int64
		var a sql.NullString
		if err := r.Scan(&id, &par, &a); err != nil {
			return err
		}
		parent[id], alias[id] = par, strings.ToUpper(strings.TrimSpace(a.String))
		return nil
	})
	if err != nil {
		return nil, err
	}
	for id, a := range alias {
		if a == "" {
			continue
		}
		var chain []string
		seen := map[int64]bool{id: true}
		for par := parent[id]; par != 0 && !seen[par]; par = parent[par] {
			seen[par] = true
			if pa := alias[par]; pa != "" {
				chain = append(chain, pa)
			}
		}
		m.ancestors[a] = chain
	}

	err = each(ctx, p.read, p.d.SQL(sqlMeasGlobalTypes), func(r Rows) error {
		var meas, global sql.NullString
		if err := r.Scan(&meas, &global); err != nil {
			return err
		}
		if a := strings.TrimSpace(meas.String); a != "" {
			m.measGlobal[a] = strings.ToUpper(strings.TrimSpace(global.String))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	err = each(ctx, p.read, p.d.SQL(sqlMeasListTables), func(r Rows) error {
		var t measTable
		var name sql.NullString
		if err := r.Scan(&t.id, &name); err != nil {
			return err
		}
		t.name = name.String
		m.measTables = append(m.measTables, t)
		return nil
	}, measListLink, measListGen)
	if err != nil {
		return nil, err
	}

	// RSDU finds the equipment table by alias OBJ_TREE_GEN; some databases name it only OBJ_TREE.
	var byName int64
	err = each(ctx, p.read, p.d.SQL(sqlEquipTable), func(r Rows) error {
		var id int64
		var a, name sql.NullString
		if err := r.Scan(&id, &a, &name); err != nil {
			return err
		}
		if a.String == equipTableAlias {
			m.equipID = id
		} else if name.String == equipTableName && byName == 0 {
			byName = id
		}
		return nil
	}, equipTableAlias, equipTableName)
	if err != nil {
		return nil, err
	}
	if m.equipID == 0 {
		m.equipID = byName
	}

	p.mu.Lock()
	p.model = m
	p.mu.Unlock()
	return m, nil
}

// inherits reports whether object type a is typ or one of its descendants.
func (m *model) inherits(a, typ string) bool {
	return a == typ || slices.Contains(m.ancestors[a], typ)
}

// option is the option of a measurement of type alias: bool/enum → instant bool, else instant analog.
func (m *model) option(measType string) string {
	if boolGlobalTypes[m.measGlobal[measType]] {
		return optionBool
	}
	return optionAnalog
}

// Suggest ports RSDU's automatic binding (SchemeTuneService.GetTunesAsync). The element is not used, as in RSDU.
//   - An object (type OTYP_*) of a jump type (OTYP_DEVICE_PANEL or a descendant of OTYP_INFORMATION_VIEW) → jump.
//   - Another object → equipment; for a switch (OTYP_SWITCH or a descendant) also its switch state → meas1 and
//     drawer state → meas2 from the measurement list tables.
//   - A measurement (MEAS_*) → meas1; for a switch state also its owner → equipment and, for a *_WITHDRAWABLE owner,
//     the drawer state → meas2 (a dropped drawer state becomes meas2 and the switch state meas1).
//
// Anything else gets none. Two differences from RSDU's code: a measurement listed in several tables takes the
// first table by id (RSDU's query is unordered and keeps the last; real schemes store the first), and a dropped
// drawer state is paired with the MEAS_SWITCH_STATE measurement (RSDU's prefix search may find the drawer itself).
func (p *Provider) Suggest(ctx context.Context, r string, _ binding.Element) ([]slddoc.Binding, error) {
	obj, err := p.Resolve(ctx, r)
	if err != nil {
		return nil, err
	}
	m, err := p.loadModel(ctx)
	if err != nil {
		return nil, err
	}
	_, id, err := parseRef(r)
	if err != nil {
		return nil, err
	}
	typ := strings.ToUpper(obj.Type)
	b := func(kind slddoc.BindingKind, option string) slddoc.Binding {
		return p.binding(kind, option, obj.Ref, obj.Name, cmp.Or(obj.TypeName, obj.Type), obj.UID)
	}

	var out []slddoc.Binding
	switch {
	case strings.HasPrefix(typ, otypPrefix):
		if typ == otypDevicePanel || slices.Contains(m.ancestors[typ], otypInformationView) {
			return []slddoc.Binding{b(slddoc.BindingJump, optionComplex)}, nil
		}
		out = append(out, b(slddoc.BindingEquipment, optionComplex))
		if m.inherits(typ, otypSwitch) {
			meas, err := p.switchMeasurements(ctx, m, id)
			if err != nil {
				return nil, err
			}
			out = append(out, meas...)
		}
	case strings.HasPrefix(typ, measPrefix):
		measKind := slddoc.BindingMeas1
		out = append(out, slddoc.Binding{})
		if switchStateTypes[typ] {
			owner, ownerID, ownerType, err := p.ownerOf(ctx, m, id)
			if err != nil {
				return nil, err
			}
			if owner != nil {
				out = append(out, *owner)
				if strings.HasSuffix(ownerType, withdrawableSuffix) {
					meas, err := p.switchMeasurements(ctx, m, ownerID)
					if err != nil {
						return nil, err
					}
					if typ == measSwitchStateDraw {
						measKind = slddoc.BindingMeas2
						if s := find(meas, slddoc.BindingMeas1); s != nil {
							out = append(out, *s)
						}
					} else if d := find(meas, slddoc.BindingMeas2); d != nil {
						out = append(out, *d)
					}
				}
			}
		}
		out[0] = b(measKind, m.option(typ))
	default:
		return []slddoc.Binding{}, nil
	}
	slices.SortStableFunc(out, func(a, b slddoc.Binding) int {
		return slices.Index(kindOrder, a.Kind) - slices.Index(kindOrder, b.Kind)
	})
	return out, nil
}

func find(bs []slddoc.Binding, kind slddoc.BindingKind) *slddoc.Binding {
	for i := range bs {
		if bs[i].Kind == kind {
			return &bs[i]
		}
	}
	return nil
}

func (p *Provider) binding(kind slddoc.BindingKind, option, r, name, typ, uid string) slddoc.Binding {
	return slddoc.Binding{Source: p.Name(), Kind: kind, Ref: r, Option: option, Name: name, Type: typ, UID: uid}
}

// guidExpr selects col.GUID when table has the column, else NULL.
func (p *Provider) guidExpr(ctx context.Context, table, col string) (string, error) {
	ok, err := p.tables.HasColumn(ctx, table, "GUID")
	if err != nil || !ok {
		return "NULL", err
	}
	return col + ".GUID", nil
}

// switchMeasurements returns the switch state (meas1) and drawer state (meas2) of object id from the measurement
// list tables, in one query; tables in id order, the first found of each kind wins.
func (p *Provider) switchMeasurements(ctx context.Context, m *model, id int64) ([]slddoc.Binding, error) {
	if len(m.measTables) == 0 {
		return nil, nil
	}
	guid, err := p.guidExpr(ctx, measListTableName, "meas")
	if err != nil {
		return nil, err
	}
	parts := make([]string, 0, len(m.measTables))
	var args []any
	for _, t := range m.measTables {
		table, err := p.tables.Table(ctx, t.name)
		if err != nil {
			return nil, err
		}
		parts = append(parts, fmt.Sprintf(sqlSwitchMeasOfObj, t.id, guid, table))
		args = append(args, id, measSwitchState, measSwitchStateDraw)
	}
	var out []slddoc.Binding
	q := p.d.SQL(strings.Join(parts, sqlUnionAll) + sqlOrderByTableMeas)
	err = each(ctx, p.read, q, func(r Rows) error {
		var tid, mid int64
		var g any
		var name, typ, typeName sql.NullString
		if err := r.Scan(&tid, &mid, &g, &name, &typ, &typeName); err != nil {
			return err
		}
		a := strings.TrimSpace(typ.String)
		if _, known := m.measGlobal[a]; !known {
			return nil
		}
		kind := slddoc.BindingMeas1
		if a == measSwitchStateDraw {
			kind = slddoc.BindingMeas2
		}
		if find(out, kind) == nil {
			out = append(out, p.binding(kind, m.option(a), ref(tid, mid), name.String, typeName.String, GUID(g)))
		}
		return nil
	}, args...)
	return out, err
}

// ownerOf returns the equipment binding of the object measurement id belongs to (nil when none), its id and its type
// alias.
func (p *Provider) ownerOf(ctx context.Context, m *model, id int64) (*slddoc.Binding, int64, string, error) {
	if m.equipID == 0 {
		return nil, 0, "", nil
	}
	guid, err := p.guidExpr(ctx, equipTableName, "obj")
	if err != nil {
		return nil, 0, "", err
	}
	var owner *slddoc.Binding
	var ownerID int64
	var typ string
	err = each(ctx, p.read, p.d.SQL(fmt.Sprintf(sqlOwnerOfMeas, guid)), func(r Rows) error {
		if owner != nil {
			return nil
		}
		var oid int64
		var g any
		var name, a, typeName sql.NullString
		if err := r.Scan(&oid, &g, &name, &a, &typeName); err != nil {
			return err
		}
		b := p.binding(slddoc.BindingEquipment, optionComplex, ref(m.equipID, oid), name.String, typeName.String, GUID(g))
		owner, ownerID, typ = &b, oid, strings.ToUpper(strings.TrimSpace(a.String))
		return nil
	}, id)
	return owner, ownerID, typ, err
}
