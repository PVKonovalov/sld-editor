package rsdu

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
)

const (
	sqlImportComponents = "SELECT c.ID, c.NAME, c.PRECISION, c.FEATURE, t.MODUS_TYPE FROM {s}.VS_COMP c " +
		"LEFT JOIN {s}.VS_TCOMP t ON t.ID = c.ID_TCTRL WHERE c.ID_FORM = ? ORDER BY c.ID"
	sqlImportTunes = "SELECT t.ID_OWNLST, r.DEFINE_ALIAS, t.ID_TABLE, t.ID_PARAM, o.DEFINE_ALIAS, t.SCALE " +
		"FROM {s}.VS_REGIM_TUNE t JOIN {s}.VS_COMP c ON c.ID = t.ID_OWNLST JOIN {s}.VS_REGIM r ON r.ID = t.ID_REGIM " +
		"LEFT JOIN {s}.SYS_GTOPT o ON o.ID = t.ID_GTOPT WHERE c.ID_FORM = ? ORDER BY t.ID_OWNLST, t.ID_REGIM, t.ID_TABLE"
	sqlImportObject = "SELECT ID_TABLE, ID_PARAM FROM {s}.VS_OBJ_TUNE WHERE ID_FORM = ?"
)

// objectInfo is what a binding caches of its object.
type objectInfo struct{ name, typ, uid string }

// SchemeBindings reads scheme schemeRef's components, their bindings (VS_REGIM_TUNE) and the scheme's object (VS_OBJ_TUNE):
// VS_COMP.NAME is the item id, VS_TCOMP.MODUS_TYPE its shape, FEATURE the feature aliases of its bits; the regime
// gives the kind, a parameter binding to a scheme, frame, panel or report with GLT_OBJECT_OPT_COMPLEX being a jump.
// Object names are read per table. What can't be read as a binding is skipped and listed.
func (p *Provider) SchemeBindings(ctx context.Context, schemeRef string) (*binding.SchemeBindings, error) {
	scheme, err := p.Scheme(ctx, schemeRef)
	if err != nil {
		return nil, err
	}
	form, _ := parseID("scheme id", schemeRef)
	dict, err := p.dictionaries(ctx)
	if err != nil {
		return nil, err
	}
	res := &binding.SchemeBindings{Scheme: *scheme, Components: []binding.Component{}, Issues: []binding.ExportIssue{}}
	warn := func(code string, item int, detail string) {
		res.Issues = append(res.Issues, binding.ExportIssue{Code: code, Severity: binding.SeverityWarning, Item: item, Detail: detail})
	}

	byID := map[int64]*binding.Component{}
	var order []int64
	err = each(ctx, p.read, p.d.SQL(sqlImportComponents), func(r Rows) error {
		var id int64
		var name sql.NullString
		var precision, feature, modus sql.NullInt64
		if err := r.Scan(&id, &name, &precision, &feature, &modus); err != nil {
			return err
		}
		item, err := strconv.Atoi(strings.TrimSpace(name.String))
		if err != nil || item <= 0 {
			warn(binding.IssueBadComponent, 0, name.String)
			return nil
		}
		c := &binding.Component{Item: item, Precision: int(precision.Int64), Features: featureAliases(dict, feature.Int64), Bindings: []slddoc.Binding{}}
		if modus.Valid {
			c.Shape = strconv.FormatInt(modus.Int64, 10)
		}
		byID[id] = c
		order = append(order, id)
		return nil
	}, form)
	if err != nil {
		return nil, err
	}

	type tune struct {
		comp  int64
		b     slddoc.Binding
		table int64
		param int64
	}
	var tunes []tune
	err = each(ctx, p.read, p.d.SQL(sqlImportTunes), func(r Rows) error {
		var comp, table, param int64
		var regim, option sql.NullString
		var scale sql.NullInt64
		if err := r.Scan(&comp, &regim, &table, &param, &option, &scale); err != nil {
			return err
		}
		c := byID[comp]
		if c == nil {
			return nil
		}
		kind, ok := regimKinds[strings.ToUpper(strings.TrimSpace(regim.String))]
		if !ok {
			warn(binding.IssueUnknownKind, c.Item, regim.String)
			return nil
		}
		b := slddoc.Binding{Source: p.Name(), Kind: kind, Ref: ref(table, param), Option: strings.TrimSpace(option.String)}
		if s := int(scale.Int64); s != 1 {
			b.Scale = s
		}
		tunes = append(tunes, tune{comp: comp, b: b, table: table, param: param})
		return nil
	}, form)
	if err != nil {
		return nil, err
	}

	var obj *slddoc.Binding
	var objTable, objParam int64
	err = each(ctx, p.read, p.d.SQL(sqlImportObject), func(r Rows) error {
		if obj != nil {
			return nil
		}
		if err := r.Scan(&objTable, &objParam); err != nil {
			return err
		}
		obj = &slddoc.Binding{Source: p.Name(), Kind: slddoc.BindingEquipment, Ref: ref(objTable, objParam), Option: optionComplex}
		return nil
	}, form)
	if err != nil {
		return nil, err
	}

	ids := map[int64][]int64{}
	for i := range tunes {
		t := &tunes[i]
		ids[t.table] = append(ids[t.table], t.param)
		if t.b.Kind == slddoc.BindingMeas1 && t.b.Option == optionComplex {
			ti, err := p.tableInfo(ctx, t.table)
			if err != nil && !errors.Is(err, binding.ErrNotFound) {
				return nil, err
			}
			if ti != nil && jumpTables[ti.alias] {
				t.b.Kind = slddoc.BindingJump
			}
		}
	}
	if obj != nil {
		ids[objTable] = append(ids[objTable], objParam)
	}
	infos := map[string]objectInfo{}
	for table, params := range ids {
		found, err := p.objectInfos(ctx, table, params)
		if err != nil {
			return nil, err
		}
		for id, info := range found {
			infos[ref(table, id)] = info
		}
	}
	named := func(b *slddoc.Binding, item int) {
		info, ok := infos[b.Ref]
		if !ok {
			warn(binding.IssueMissingObject, item, b.Ref)
			return
		}
		b.Name, b.Type, b.UID = info.name, info.typ, info.uid
	}

	for _, t := range tunes {
		c := byID[t.comp]
		if slices.ContainsFunc(c.Bindings, func(b slddoc.Binding) bool { return b.Kind == t.b.Kind }) {
			warn(binding.IssueDuplicate, c.Item, string(t.b.Kind)+" "+t.b.Ref)
			continue
		}
		b := t.b
		named(&b, c.Item)
		c.Bindings = append(c.Bindings, b)
	}
	for _, id := range order {
		c := byID[id]
		slices.SortStableFunc(c.Bindings, func(a, b slddoc.Binding) int {
			return slices.Index(kindOrder, a.Kind) - slices.Index(kindOrder, b.Kind)
		})
		res.Components = append(res.Components, *c)
	}
	slices.SortStableFunc(res.Components, func(a, b binding.Component) int { return a.Item - b.Item })
	if obj != nil {
		named(obj, 0)
		res.Object = obj
	}
	return res, nil
}

// featureAliases are the aliases of the VS_COMP_FEATURE masks set in feature, comma-separated in mask order.
func featureAliases(dict *dictionaries, feature int64) string {
	var out []string
	for _, f := range dict.public.Features {
		if f.Mask != 0 && f.Alias != "" && feature&f.Mask == f.Mask {
			out = append(out, f.Alias)
		}
	}
	return strings.Join(out, ",")
}

// objectInfos reads name, type alias and GUID of the objects ids of table, in chunks; ids that don't exist are left
// out, as is a table whose objects can't be bound.
func (p *Provider) objectInfos(ctx context.Context, tableID int64, ids []int64) (map[int64]objectInfo, error) {
	out := map[int64]objectInfo{}
	ti, err := p.tableInfo(ctx, tableID)
	if errors.Is(err, binding.ErrNotFound) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	if ti.kind != tableList && ti.kind != tableCatalog {
		return out, nil
	}
	table, err := p.tables.Table(ctx, ti.name)
	if err != nil {
		return nil, err
	}
	cols, err := p.tables.Columns(ctx, ti.name)
	if err != nil {
		return nil, err
	}
	sel := []string{"o.ID", "o.NAME", "NULL", "NULL"}
	if cols["GUID"] {
		sel[2] = "o.GUID"
	}
	from := table + " o"
	if ti.types != "" && cols["ID_TYPE"] {
		types, err := p.tables.Table(ctx, ti.types)
		if err != nil {
			return nil, err
		}
		tcols, err := p.tables.Columns(ctx, ti.types)
		if err != nil {
			return nil, err
		}
		if tcols["ID"] && tcols["DEFINE_ALIAS"] {
			from += " LEFT JOIN " + types + " t ON t.ID = o.ID_TYPE"
			sel[3] = "t.DEFINE_ALIAS"
		}
	}
	slices.Sort(ids)
	ids = slices.Compact(ids)
	for chunk := range slices.Chunk(ids, existChunk) {
		marks := strings.TrimSuffix(strings.Repeat("?, ", len(chunk)), ", ")
		args := make([]any, len(chunk))
		for i, id := range chunk {
			args[i] = id
		}
		q := fmt.Sprintf("SELECT %s FROM %s WHERE o.ID IN (%s)", strings.Join(sel, ", "), from, marks)
		err := each(ctx, p.read, p.d.SQL(q), func(r Rows) error {
			var id int64
			var name, typ sql.NullString
			var guid any
			if err := r.Scan(&id, &name, &guid, &typ); err != nil {
				return err
			}
			out[id] = objectInfo{name: name.String, typ: strings.TrimSpace(typ.String), uid: GUID(guid)}
			return nil
		}, args...)
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}
