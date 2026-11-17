package rsdu

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"sld-editor/internal/binding"
)

// rootSection is the SYS_TREE21 node the object browser starts at (as Adjust).
const rootSection = 1

// Search limits: the default and largest number of hits, and the shortest query.
const (
	DefaultSearchLimit = 100
	MaxSearchLimit     = 500
	minSearchRunes     = 2
)

const (
	sqlTree        = "SELECT ID, COALESCE(ID_PARENT, 0), COALESCE(ID_LSTTBL, 0), NAME, COALESCE(ID_ICON, 0) FROM {s}.SYS_TREE21"
	sqlTableID     = "SELECT ID FROM {s}.SYS_TBLLST WHERE TABLE_NAME = ?"
	sqlSection     = "SELECT v.R_TABLE, COALESCE(v.ID_DIRTBL, 0), d.TABLE_NAME, td.TABLE_NAME FROM {s}.SYS_TABL_V v LEFT JOIN {s}.SYS_TBLLST d ON d.ID = v.ID_DIRTBL LEFT JOIN {s}.SYS_TBLLST td ON td.ID = v.ID_TDIRTBL WHERE v.ID = ?"
	sqlTypesTable  = "SELECT tl.TABLE_NAME FROM {s}.SYS_TBLREF tr JOIN {s}.SYS_TBLLST tl ON tl.ID = tr.ID_TBLREF WHERE tr.ID_TBL = ? AND tr.ID_LINK = 4"
	treeTableName  = "SYS_TREE21"
	userClassTable = "SYS_UCLS"
	daParamTable   = "DA_PARAM"
	daDeviceTable  = "DA_DEV_DESC"
)

// ref is the RSDU object key "tableId:id".
func ref(table, id int64) string {
	return strconv.FormatInt(table, 10) + ":" + strconv.FormatInt(id, 10)
}

func parseID(what, s string) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("%w: %s %q is not a positive integer", binding.ErrInvalid, what, s)
	}
	return id, nil
}

// tableID returns SYS_TBLLST.ID of the table name.
func (p *Provider) tableID(ctx context.Context, name string) (int64, error) {
	var id int64
	found := false
	err := each(ctx, p.read, p.d.SQL(sqlTableID), func(r Rows) error {
		found = true
		return r.Scan(&id)
	}, name)
	if err == nil && !found {
		err = fmt.Errorf("rsdu: %s is not in SYS_TBLLST", name)
	}
	return id, err
}

func (p *Provider) Sections(ctx context.Context) ([]binding.Section, error) {
	treeID, err := p.tableID(ctx, treeTableName)
	if err != nil {
		return nil, err
	}
	var ids, parents, lists, icons []int64
	var names []string
	err = each(ctx, p.read, p.d.SQL(sqlTree), func(r Rows) error {
		var id, parent, list, icon int64
		var name sql.NullString
		if err := r.Scan(&id, &parent, &list, &name, &icon); err != nil {
			return err
		}
		ids, parents, lists, icons, names = append(ids, id), append(parents, parent), append(lists, list), append(icons, icon), append(names, name.String)
		return nil
	})
	if err != nil {
		return nil, err
	}
	top, children := forest(ids, parents, names)
	roots := top
	for i, id := range ids {
		if id == rootSection {
			roots = []int{i}
			break
		}
	}
	return walk(roots, children, func(i int, kids []binding.Section) binding.Section {
		s := binding.Section{
			ID: strconv.FormatInt(ids[i], 10), Name: names[i], Icon: icons[i], Ref: ref(treeID, ids[i]), Children: kids,
		}
		if lists[i] != 0 {
			s.Section = strconv.FormatInt(lists[i], 10)
		}
		return s
	}), nil
}

// section is a section's tables (SYS_TABL_V): the list table LST with its id, the catalog DIR with its id and the
// catalog types TDIR. Names are as stored, not yet validated.
type section struct {
	lstID, dirID   int64
	lst, dir, tdir string
}

func (p *Provider) section(ctx context.Context, s string) (*section, error) {
	id, err := parseID("section", s)
	if err != nil {
		return nil, err
	}
	var sec *section
	err = each(ctx, p.read, p.d.SQL(sqlSection), func(r Rows) error {
		var lst, dir, tdir sql.NullString
		var dirID int64
		if err := r.Scan(&lst, &dirID, &dir, &tdir); err != nil {
			return err
		}
		sec = &section{lstID: id, dirID: dirID, lst: lst.String, dir: dir.String, tdir: tdir.String}
		return nil
	}, id)
	if err != nil {
		return nil, err
	}
	if sec == nil {
		return nil, fmt.Errorf("%w: section %d", binding.ErrNotFound, id)
	}
	return sec, nil
}

func (p *Provider) Catalog(ctx context.Context, s string) ([]binding.Node, error) {
	sec, err := p.section(ctx, s)
	if err != nil {
		return nil, err
	}
	if sec.dir == "" || sec.dirID == 0 {
		return nil, fmt.Errorf("%w: section %d has no catalog", binding.ErrNotFound, sec.lstID)
	}
	dir, err := p.tables.Table(ctx, sec.dir)
	if err != nil {
		return nil, err
	}
	hasAlias, err := p.tables.HasColumn(ctx, sec.dir, "ALIAS")
	if err != nil {
		return nil, err
	}
	hasType, err := p.tables.HasColumn(ctx, sec.dir, "ID_TYPE")
	if err != nil {
		return nil, err
	}
	cols := "a.ID, COALESCE(a.ID_PARENT, 0), a.NAME"
	from := dir + " a"
	if hasType && sec.tdir != "" {
		tdir, err := p.tables.Table(ctx, sec.tdir)
		if err != nil {
			return nil, err
		}
		icon := "0"
		if ok, err := p.tables.HasColumn(ctx, sec.tdir, "ID_ICON"); err != nil {
			return nil, err
		} else if ok {
			icon = "COALESCE(b.ID_ICON, 0)"
		}
		cols += ", b.NAME, " + icon
		from += " JOIN " + tdir + " b ON a.ID_TYPE = b.ID"
	} else {
		cols += ", NULL, 0"
	}
	if hasAlias {
		cols += ", a.ALIAS"
	} else {
		cols += ", NULL"
	}

	var ids, parents, icons []int64
	var names, typeNames, aliases []string
	err = each(ctx, p.read, p.d.SQL("SELECT "+cols+" FROM "+from), func(r Rows) error {
		var id, parent, icon int64
		var name, typeName, alias sql.NullString
		if err := r.Scan(&id, &parent, &name, &typeName, &icon, &alias); err != nil {
			return err
		}
		if id == 0 {
			return nil
		}
		ids, parents, icons = append(ids, id), append(parents, parent), append(icons, icon)
		names, typeNames, aliases = append(names, name.String), append(typeNames, typeName.String), append(aliases, alias.String)
		return nil
	})
	if err != nil {
		return nil, err
	}
	top, children := forest(ids, parents, names)
	return walk(top, children, func(i int, kids []binding.Node) binding.Node {
		return binding.Node{
			ID: strconv.FormatInt(ids[i], 10), Name: names[i], Alias: strings.TrimSpace(aliases[i]), TypeName: typeNames[i],
			Icon: icons[i], Ref: ref(sec.dirID, ids[i]), Children: kids,
		}
	}), nil
}

// fallbackTypesTable is Adjust's types table of a list without a SYS_TBLREF ID_LINK = 4 row, chosen by its name.
func fallbackTypesTable(lst string) string {
	u := strings.ToUpper(lst)
	switch {
	case strings.HasPrefix(u, "LO_"):
		return "SYS_MEAS_TYPES"
	case strings.HasPrefix(u, "DA"), strings.HasPrefix(u, "TMS"), strings.HasPrefix(u, "MCC"),
		strings.HasPrefix(u, "EA"), strings.HasPrefix(u, "EMD"), strings.HasPrefix(u, "ARC_DA"):
		return "SYS_DTYP"
	}
	return "SYS_OTYP"
}

// typesTable returns the validated types table of the list sec.lst (SYS_TBLREF ID_LINK = 4, else by the list's
// name); "" when it does not exist or has no ALIAS column.
func (p *Provider) typesTable(ctx context.Context, sec *section) (string, error) {
	name := ""
	err := each(ctx, p.read, p.d.SQL(sqlTypesTable), func(r Rows) error {
		var n sql.NullString
		if err := r.Scan(&n); err != nil {
			return err
		}
		if name == "" {
			name = n.String
		}
		return nil
	}, sec.lstID)
	if err != nil {
		return "", err
	}
	if name == "" {
		name = fallbackTypesTable(sec.lst)
	}
	if !identifierRe.MatchString(name) {
		return "", nil
	}
	if ok, err := p.tables.HasColumn(ctx, name, "ALIAS"); err != nil || !ok {
		return "", err
	}
	return p.tables.Table(ctx, name)
}

// hasColumns reports whether table has every column.
func (p *Provider) hasColumns(ctx context.Context, table string, columns ...string) (bool, error) {
	for _, c := range columns {
		if ok, err := p.tables.HasColumn(ctx, table, c); err != nil || !ok {
			return false, err
		}
	}
	return true, nil
}

func (p *Provider) List(ctx context.Context, s, n string) ([]binding.Object, error) {
	sec, err := p.section(ctx, s)
	if err != nil {
		return nil, err
	}
	node, err := parseID("node", n)
	if err != nil {
		return nil, err
	}
	lst, err := p.tables.Table(ctx, sec.lst)
	if err != nil {
		return nil, err
	}
	if ok, err := p.hasColumns(ctx, sec.lst, "ID", "NAME", "ID_NODE"); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("%w: section %d has no list by catalog node", binding.ErrNotFound, sec.lstID)
	}

	cols := "a.ID, a.NAME"
	from := lst + " a"
	hasType, err := p.tables.HasColumn(ctx, sec.lst, "ID_TYPE")
	if err != nil {
		return nil, err
	}
	types := ""
	if hasType {
		if types, err = p.typesTable(ctx, sec); err != nil {
			return nil, err
		}
	}
	if types != "" {
		cols += ", b.ALIAS"
		from += " LEFT JOIN " + types + " b ON b.ID = a.ID_TYPE"
	} else {
		cols += ", NULL"
	}

	if ok, err := p.tables.HasColumn(ctx, sec.lst, "ID_UCLASS"); err != nil {
		return nil, err
	} else if ok {
		ucls, err := p.tables.Table(ctx, userClassTable)
		if err != nil {
			return nil, err
		}
		cols += ", c.NAME"
		from += " LEFT JOIN " + ucls + " c ON c.ID = a.ID_UCLASS"
	} else {
		cols += ", NULL"
	}

	da := false
	if strings.HasPrefix(strings.ToUpper(sec.lst), "DA") {
		okParam, err := p.hasColumns(ctx, daParamTable, "ID", "ID_POINT", "SCALE")
		if err != nil {
			return nil, err
		}
		okDev, err := p.hasColumns(ctx, daDeviceTable, "ID", "CVALIF")
		if err != nil {
			return nil, err
		}
		if da = okParam && okDev; da {
			param, _ := p.tables.Table(ctx, daParamTable)
			dev, _ := p.tables.Table(ctx, daDeviceTable)
			cols += ", d.CVALIF, e.SCALE"
			from += " LEFT JOIN " + param + " e ON e.ID = a.ID LEFT JOIN " + dev + " d ON d.ID = e.ID_POINT"
		}
	}
	if !da {
		cols += ", NULL, NULL"
	}

	query := p.d.SQL("SELECT DISTINCT " + cols + " FROM " + from + " WHERE a.ID_NODE = ?")
	var objs []binding.Object
	var names []string
	var ids []int64
	err = each(ctx, p.read, query, func(r Rows) error {
		var id int64
		var name, alias, class sql.NullString
		var cvalif sql.NullInt64
		var scale sql.NullFloat64
		if err := r.Scan(&id, &name, &alias, &class, &cvalif, &scale); err != nil {
			return err
		}
		o := binding.Object{
			ID: strconv.FormatInt(id, 10), Ref: ref(sec.lstID, id), Name: name.String,
			TypeAlias: strings.TrimSpace(alias.String), Class: class.String,
		}
		if da && cvalif.Valid {
			o.Cvalif = &cvalif.Int64
		}
		if da && scale.Valid {
			o.Scale = &scale.Float64
		}
		objs, names, ids = append(objs, o), append(names, name.String), append(ids, id)
		return nil
	}, node)
	if err != nil {
		return nil, err
	}
	order, _ := forest(ids, make([]int64, len(ids)), names)
	out := make([]binding.Object, 0, len(objs))
	for _, i := range order {
		out = append(out, objs[i])
	}
	return out, nil
}

// shareLimit splits limit between catalog and list hits: half each, the rest of one side's half going to the other.
func shareLimit(catalog, list, limit int) (int, int) {
	c, l := (limit+1)/2, limit/2
	if catalog < c {
		l = limit - catalog
	}
	if list < l {
		c = limit - list
	}
	return min(catalog, c), min(list, l)
}

// likePattern is the LIKE pattern "contains q", lower-cased, with \ % _ escaped by \.
func likePattern(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(strings.ToLower(q)) + "%"
}

func (p *Provider) Search(ctx context.Context, s, q string, limit int) (*binding.SearchResult, error) {
	q = strings.TrimSpace(q)
	if utf8.RuneCountInString(q) < minSearchRunes {
		return nil, fmt.Errorf("%w: search needs at least %d characters", binding.ErrInvalid, minSearchRunes)
	}
	if limit <= 0 {
		limit = DefaultSearchLimit
	}
	limit = min(limit, MaxSearchLimit)
	sec, err := p.section(ctx, s)
	if err != nil {
		return nil, err
	}
	pattern := likePattern(q)

	search := func(table, parentCol string, tableID int64, kind string) ([]binding.Hit, error) {
		qualified, err := p.tables.Table(ctx, table)
		if err != nil {
			return nil, err
		}
		if ok, err := p.hasColumns(ctx, table, "ID", "NAME", parentCol); err != nil || !ok {
			return nil, err
		}
		query := p.d.SQL(fmt.Sprintf(`SELECT a.ID, COALESCE(a.%s, 0), a.NAME FROM %s a WHERE LOWER(a.NAME) LIKE ? ESCAPE '\' ORDER BY a.NAME, a.ID FETCH FIRST %d ROWS ONLY`,
			parentCol, qualified, limit+1))
		var hits []binding.Hit
		err = each(ctx, p.read, query, func(r Rows) error {
			var id, parent int64
			var name sql.NullString
			if err := r.Scan(&id, &parent, &name); err != nil {
				return err
			}
			node := parent
			if kind == binding.HitCatalog {
				node = id
			}
			hits = append(hits, binding.Hit{Ref: ref(tableID, id), Name: name.String, Kind: kind, Node: strconv.FormatInt(node, 10)})
			return nil
		}, pattern)
		return hits, err
	}
	var catalog []binding.Hit
	if sec.dir != "" && sec.dirID != 0 {
		if catalog, err = search(sec.dir, "ID_PARENT", sec.dirID, binding.HitCatalog); err != nil {
			return nil, err
		}
	}
	list, err := search(sec.lst, "ID_NODE", sec.lstID, binding.HitList)
	if err != nil {
		return nil, err
	}
	nc, nl := shareLimit(len(catalog), len(list), limit)
	res := &binding.SearchResult{Hits: append(catalog[:nc:nc], list[:nl]...), Truncated: nc+nl < len(catalog)+len(list)}
	if res.Hits == nil {
		res.Hits = []binding.Hit{}
	}
	return res, nil
}
