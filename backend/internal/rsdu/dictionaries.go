package rsdu

import (
	"context"
	"database/sql"
	"strings"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
)

// VS_REGIM.DEFINE_ALIAS of each binding kind; ADJUST_TOPOLOGY is unused and skipped. jump has no row: RSDU adds it
// virtually and stores it under ADJUST_REGIM's id.
const (
	regimEquipment = "EQUIPMENT"
	regimMeas1     = "ADJUST_REGIM"
	regimMeas2     = "ADJUST_ADDITIONAL"
)

var regimKinds = map[string]slddoc.BindingKind{
	regimEquipment: slddoc.BindingEquipment,
	regimMeas1:     slddoc.BindingMeas1,
	regimMeas2:     slddoc.BindingMeas2,
}

var kindOrder = []slddoc.BindingKind{slddoc.BindingEquipment, slddoc.BindingMeas1, slddoc.BindingMeas2, slddoc.BindingJump}

const (
	sqlRegims   = "SELECT ID, ALIAS, DEFINE_ALIAS FROM {s}.VS_REGIM ORDER BY ID"
	sqlOptions  = "SELECT o.ID, o.NAME, o.DEFINE_ALIAS, g.DEFINE_ALIAS, g.NAME FROM {s}.SYS_GTOPT o JOIN {s}.SYS_GTYP g ON g.ID = o.ID_GTYPE ORDER BY g.ID, o.ID"
	sqlFeatures = "SELECT MASK, NAME, DEFINE_ALIAS FROM {s}.VS_COMP_FEATURE ORDER BY MASK"
)

// dictionaries are the reference lists as served, plus the RSDU ids export needs.
type dictionaries struct {
	public binding.Dictionaries
	// regimID is VS_REGIM.ID per kind (jump → ADJUST_REGIM's).
	regimID map[slddoc.BindingKind]int64
	// optionID is SYS_GTOPT.ID per DEFINE_ALIAS.
	optionID map[string]int64
}

// loadDictionaries reads VS_REGIM, SYS_GTOPT (+ SYS_GTYP) and VS_COMP_FEATURE.
func loadDictionaries(ctx context.Context, q Querier, d Dialect) (*dictionaries, error) {
	dict := &dictionaries{
		public:   binding.Dictionaries{Kinds: []binding.KindInfo{}, Options: []binding.Option{}, Features: []binding.Feature{}},
		regimID:  map[slddoc.BindingKind]int64{},
		optionID: map[string]int64{},
	}

	names := map[slddoc.BindingKind]string{}
	err := each(ctx, q, d.SQL(sqlRegims), func(r Rows) error {
		var id int64
		var alias, define sql.NullString
		if err := r.Scan(&id, &alias, &define); err != nil {
			return err
		}
		kind, ok := regimKinds[strings.ToUpper(strings.TrimSpace(define.String))]
		if !ok {
			return nil
		}
		dict.regimID[kind] = id
		names[kind] = alias.String
		return nil
	})
	if err != nil {
		return nil, err
	}
	if id, ok := dict.regimID[slddoc.BindingMeas1]; ok {
		dict.regimID[slddoc.BindingJump] = id
		names[slddoc.BindingJump] = ""
	}
	for _, k := range kindOrder {
		if _, ok := dict.regimID[k]; ok {
			dict.public.Kinds = append(dict.public.Kinds, binding.KindInfo{Kind: k, Name: names[k]})
		}
	}

	err = each(ctx, q, d.SQL(sqlOptions), func(r Rows) error {
		var id int64
		var name, define, group, groupName sql.NullString
		if err := r.Scan(&id, &name, &define, &group, &groupName); err != nil {
			return err
		}
		if define.String == "" {
			return nil
		}
		dict.optionID[define.String] = id
		dict.public.Options = append(dict.public.Options, binding.Option{
			Alias: define.String, Name: name.String, Group: group.String, GroupName: groupName.String,
		})
		return nil
	})
	if err != nil {
		return nil, err
	}

	err = each(ctx, q, d.SQL(sqlFeatures), func(r Rows) error {
		var mask int64
		var name, define sql.NullString
		if err := r.Scan(&mask, &name, &define); err != nil {
			return err
		}
		dict.public.Features = append(dict.public.Features, binding.Feature{Alias: define.String, Name: name.String, Mask: mask})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return dict, nil
}

// each runs query and calls row for every row.
func each(ctx context.Context, q Querier, query string, row func(Rows) error, args ...any) error {
	rows, err := q.Query(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := row(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}
