package rsdu

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
)

// Table kinds (SYS_OTYP.DEFINE_ALIAS of SYS_TBLLST.ID_TYPE): a list of objects, or a catalog tree.
const (
	tableList    = "LST"
	tableCatalog = "DIR"
)

// Default options as RSDU's scheme editor sets them (_tuneGltOptionRelation, SchemeTuneService).
const (
	optionComplex = "GLT_OBJECT_OPT_COMPLEX"
	optionBool    = "GLT_BOOL_OPT_INSTANT"
	optionAnalog  = "GLT_ANALOG_OPT_INSTANT"
)

// jumpTables are the SYS_TBLLST.DEFINE_ALIAS of the tables whose objects are opened from an item: schemes, frames,
// panels, reports.
var jumpTables = map[string]bool{"VS_FORM_LST": true, "R_KADR_LST": true, "VP_PANEL_LST": true, "RPT_LST_LST": true}

// boolGlobalTypes are the SYS_GTYP.DEFINE_ALIAS whose measurements read as GLT_BOOL_OPT_INSTANT.
var boolGlobalTypes = map[string]bool{"GLOBAL_TYPE_BOOL": true, "GLOBAL_TYPE_ENUMERATION": true}

const (
	equipmentTypes = "SYS_OTYP"
	daTypesPrefix  = "SYS_DTYP"

	sqlTableInfo = "SELECT tbl.DEFINE_ALIAS, tbl.TABLE_NAME, ot.DEFINE_ALIAS, COALESCE(tv.ID_DIRTBL, 0), tt.TABLE_NAME " +
		"FROM {s}.SYS_TBLLST tbl JOIN {s}.SYS_OTYP ot ON ot.ID = tbl.ID_TYPE " +
		"LEFT JOIN {s}.SYS_TABL_V tv ON tv.ID = tbl.ID " +
		"LEFT JOIN {s}.SYS_TBLLST tt ON tt.ID = CASE ot.DEFINE_ALIAS WHEN 'DIR' THEN tv.ID_TDIRTBL ELSE tv.ID_TBLREF END " +
		"WHERE tbl.ID = ?"
	sqlMeasGlobalType = "SELECT g.DEFINE_ALIAS FROM {s}.SYS_MEAS_TYPES m JOIN {s}.SYS_PTYP p ON p.ID = m.ID_TYPE " +
		"JOIN {s}.SYS_GTYP g ON g.ID = p.ID_GTYP WHERE m.DEFINE_ALIAS = ?"
	sqlDATypeGlobalType = "SELECT g.DEFINE_ALIAS FROM {s}.SYS_DTYP d JOIN {s}.SYS_GTYP g ON g.ID = d.ID_GTYPE WHERE d.ID = ?"
)

// tableInfo is what resolving needs of a table: its alias, physical name, kind (LST/DIR), the catalog its objects
// hang under (LST) and its types table. Names are as stored, not yet validated.
type tableInfo struct {
	alias, name, kind string
	dirID             int64
	types             string
}

// tableInfos caches tableInfo per table id; reset by Refresh.
type tableInfos struct {
	mu sync.Mutex
	m  map[int64]*tableInfo
}

// parseRef splits an RSDU ref "tableId:id".
func parseRef(r string) (table, id int64, err error) {
	t, i, ok := strings.Cut(strings.TrimSpace(r), ":")
	if !ok {
		return 0, 0, fmt.Errorf("%w: ref %q is not tableId:id", binding.ErrInvalid, r)
	}
	if table, err = parseID("table id", t); err != nil {
		return 0, 0, err
	}
	if id, err = parseID("object id", i); err != nil {
		return 0, 0, err
	}
	return table, id, nil
}

func (p *Provider) tableInfo(ctx context.Context, id int64) (*tableInfo, error) {
	p.infos.mu.Lock()
	ti, ok := p.infos.m[id]
	p.infos.mu.Unlock()
	if ok {
		return ti, nil
	}
	err := each(ctx, p.read, p.d.SQL(sqlTableInfo), func(r Rows) error {
		var alias, name, kind, types sql.NullString
		var dirID int64
		if err := r.Scan(&alias, &name, &kind, &dirID, &types); err != nil {
			return err
		}
		ti = &tableInfo{
			alias: strings.ToUpper(strings.TrimSpace(alias.String)), name: name.String,
			kind: strings.ToUpper(strings.TrimSpace(kind.String)), dirID: dirID, types: types.String,
		}
		return nil
	}, id)
	if err != nil {
		return nil, err
	}
	if ti == nil {
		return nil, fmt.Errorf("%w: table %d", binding.ErrNotFound, id)
	}
	p.infos.mu.Lock()
	if p.infos.m == nil {
		p.infos.m = map[int64]*tableInfo{}
	}
	p.infos.m[id] = ti
	p.infos.mu.Unlock()
	return ti, nil
}

// Resolve reads the object of an RSDU ref from its LST or DIR table, as RSDU's object information service does:
// name, type (from the table's types table), GUID when the table has one, and the parent (an LST object's catalog
// node ID_NODE, a DIR node's ID_PARENT). It suggests jump for schemes, frames, panels and reports, equipment for
// objects typed by SYS_OTYP, else meas1, with RSDU's default option for each.
func (p *Provider) Resolve(ctx context.Context, r string) (*binding.Resolved, error) {
	tableID, id, err := parseRef(r)
	if err != nil {
		return nil, err
	}
	ti, err := p.tableInfo(ctx, tableID)
	if err != nil {
		return nil, err
	}
	var parentCol string
	var parentTable int64
	switch ti.kind {
	case tableList:
		parentCol, parentTable = "ID_NODE", ti.dirID
	case tableCatalog:
		parentCol, parentTable = "ID_PARENT", tableID
	default:
		return nil, fmt.Errorf("%w: objects of table %d (%s) can't be bound", binding.ErrInvalid, tableID, ti.name)
	}
	table, err := p.tables.Table(ctx, ti.name)
	if err != nil {
		return nil, err
	}
	cols, err := p.tables.Columns(ctx, ti.name)
	if err != nil {
		return nil, err
	}

	sel := []string{"o.NAME"}
	opt := func(col, expr string) {
		if cols[col] {
			sel = append(sel, expr)
		} else {
			sel = append(sel, "NULL")
		}
	}
	opt("GUID", "o.GUID")
	opt(parentCol, "o."+parentCol)
	opt("ID_TYPE", "o.ID_TYPE")
	from := table + " o"
	typed := false
	if ti.types != "" && cols["ID_TYPE"] {
		types, err := p.tables.Table(ctx, ti.types)
		if err != nil {
			return nil, err
		}
		tcols, err := p.tables.Columns(ctx, ti.types)
		if err != nil {
			return nil, err
		}
		if tcols["ID"] {
			typed = true
			from += " LEFT JOIN " + types + " t ON t.ID = o.ID_TYPE"
			for _, c := range []string{"DEFINE_ALIAS", "NAME"} {
				if tcols[c] {
					sel = append(sel, "t."+c)
				} else {
					sel = append(sel, "NULL")
				}
			}
		}
	}
	if !typed {
		sel = append(sel, "NULL", "NULL")
	}
	query := "SELECT " + strings.Join(sel, ", ") + " FROM " + from + " WHERE o.ID = ?"

	var res *binding.Resolved
	var typeID int64
	err = each(ctx, p.read, p.d.SQL(query), func(row Rows) error {
		var name, typeAlias, typeName sql.NullString
		var guid any
		var parent, idType sql.NullInt64
		if err := row.Scan(&name, &guid, &parent, &idType, &typeAlias, &typeName); err != nil {
			return err
		}
		res = &binding.Resolved{
			Ref: ref(tableID, id), Name: name.String, UID: GUID(guid),
			Type: strings.TrimSpace(typeAlias.String), TypeName: typeName.String,
		}
		if parent.Int64 > 0 && parentTable > 0 {
			res.ParentRef = ref(parentTable, parent.Int64)
		}
		typeID = idType.Int64
		return nil
	}, id)
	if err != nil {
		return nil, err
	}
	if res == nil {
		return nil, fmt.Errorf("%w: object %s", binding.ErrNotFound, ref(tableID, id))
	}

	switch {
	case jumpTables[ti.alias]:
		res.Kind, res.Option = slddoc.BindingJump, optionComplex
	case strings.EqualFold(ti.types, equipmentTypes):
		res.Kind, res.Option = slddoc.BindingEquipment, optionComplex
	default:
		res.Kind, res.Option = slddoc.BindingMeas1, optionAnalog
		global, err := p.globalType(ctx, ti.types, res.Type, typeID)
		if err != nil {
			return nil, err
		}
		if boolGlobalTypes[global] {
			res.Option = optionBool
		}
	}
	return res, nil
}

// globalType returns SYS_GTYP.DEFINE_ALIAS of a measurement's type: through SYS_DTYP for data acquisition types,
// else through SYS_MEAS_TYPES and SYS_PTYP by the type's alias; "" when neither knows it.
func (p *Provider) globalType(ctx context.Context, types, typeAlias string, typeID int64) (string, error) {
	var query string
	var arg any
	switch {
	case strings.HasPrefix(strings.ToUpper(types), daTypesPrefix) && typeID > 0:
		query, arg = sqlDATypeGlobalType, typeID
	case typeAlias != "":
		query, arg = sqlMeasGlobalType, typeAlias
	default:
		return "", nil
	}
	var global string
	err := each(ctx, p.read, p.d.SQL(query), func(r Rows) error {
		var g sql.NullString
		if err := r.Scan(&g); err != nil {
			return err
		}
		if global == "" {
			global = strings.ToUpper(strings.TrimSpace(g.String))
		}
		return nil
	}, arg)
	return global, err
}
