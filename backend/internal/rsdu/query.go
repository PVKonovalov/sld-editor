package rsdu

// All SQL of the provider. Queries are written once for both databases: unquoted identifiers, "{s}." before every
// table of the schema and "?" for every bound parameter; Dialect.SQL turns them into the database's text. A "%s" or
// "%d" is filled with fmt.Sprintf before that, only with validated table names (Tables.Table), column expressions
// built by the caller or generated placeholder lists, never with user input.

// Navigation tree and sections (browse.go).
const (
	// sqlTableID returns SYS_TBLLST.ID of a table. Parameter: TABLE_NAME. Used to build the "tableId:id" refs.
	sqlTableID = "SELECT ID FROM {s}.SYS_TBLLST WHERE TABLE_NAME = ?"

	// sqlTree returns every node of the RSDU navigation tree SYS_TREE21: ID, ID_PARENT (0 for a root), ID_LSTTBL
	// (the section's list table in SYS_TABL_V, 0 for a plain folder), NAME and ID_ICON (0 for none).
	sqlTree = "SELECT ID, COALESCE(ID_PARENT, 0), COALESCE(ID_LSTTBL, 0), NAME, COALESCE(ID_ICON, 0) FROM {s}.SYS_TREE21"

	// sqlSection returns the tables of one section from SYS_TABL_V: the list table name R_TABLE, the catalog id
	// ID_DIRTBL (0 for none), the catalog table name and the catalog's types table name (both from SYS_TBLLST,
	// NULL when absent). Parameter: the section's SYS_TABL_V.ID.
	sqlSection = "SELECT v.R_TABLE, COALESCE(v.ID_DIRTBL, 0), d.TABLE_NAME, td.TABLE_NAME FROM {s}.SYS_TABL_V v LEFT JOIN {s}.SYS_TBLLST d ON d.ID = v.ID_DIRTBL LEFT JOIN {s}.SYS_TBLLST td ON td.ID = v.ID_TDIRTBL WHERE v.ID = ?"

	// sqlTypesTable returns the name of the types table linked to a list table: SYS_TBLREF rows with ID_LINK = 4
	// (the "types" link) point from the list (ID_TBL) to its types table (ID_TBLREF). Parameter: the list's
	// SYS_TBLLST.ID.
	sqlTypesTable = "SELECT tl.TABLE_NAME FROM {s}.SYS_TBLREF tr JOIN {s}.SYS_TBLLST tl ON tl.ID = tr.ID_TBLREF WHERE tr.ID_TBL = ? AND tr.ID_LINK = 4"

	// sqlCatalogNodes returns every node of a section's catalog. Fills: the column list (a.ID, a.ID_PARENT, a.NAME,
	// type name, type icon, a.ALIAS, with NULL or 0 for missing columns) and the FROM clause (the catalog as "a",
	// optionally with sqlJoinCatalogTypes).
	sqlCatalogNodes = "SELECT %s FROM %s"

	// sqlJoinCatalogTypes joins a catalog "a" with its types table "b" by ID_TYPE, for the node type name and icon.
	// Fill: the types table.
	sqlJoinCatalogTypes = " JOIN %s b ON a.ID_TYPE = b.ID"

	// sqlNodeObjects returns the objects of one catalog node from a section's list table, once per object even when
	// a join repeats it. Fills: the column list (id, name, guid, type alias, user class, DA validity and scale, with
	// NULL for missing ones) and the FROM clause (the list as "a" with the optional joins below). Parameter: the
	// catalog node id (a.ID_NODE).
	sqlNodeObjects = "SELECT DISTINCT %s FROM %s WHERE a.ID_NODE = ?"

	// sqlJoinTypes joins a list or catalog "a" with its types table "b" by ID_TYPE; the object may have no type.
	// Fill: the types table.
	sqlJoinTypes = " LEFT JOIN %s b ON b.ID = a.ID_TYPE"

	// sqlJoinUserClass joins a list "a" with its user class SYS_UCLS "c" by ID_UCLASS. Fill: the SYS_UCLS table.
	sqlJoinUserClass = " LEFT JOIN %s c ON c.ID = a.ID_UCLASS"

	// sqlJoinDAPoint joins a data acquisition list "a" with its parameter DA_PARAM "e" (same ID, for SCALE) and the
	// parameter's device DA_DEV_DESC "d" (by ID_POINT, for CVALIF). Fills: the DA_PARAM and DA_DEV_DESC tables.
	sqlJoinDAPoint = " LEFT JOIN %s e ON e.ID = a.ID LEFT JOIN %s d ON d.ID = e.ID_POINT"

	// sqlSearchByName returns the rows of a catalog or list "a" whose name contains a pattern, case-insensitively,
	// sorted by name and id: ID, the parent (catalog node or parent node, 0 for none), NAME and the type name.
	// Fills: the parent column, the type name expression ("NULL" or "b.<column>"), the table, an optional
	// sqlJoinTypes and the row limit (one more than wanted, to detect truncation). Parameter: the LIKE pattern,
	// lower-cased, with "\" escaping "%" and "_".
	sqlSearchByName = `SELECT a.ID, COALESCE(a.%s, 0), a.NAME, %s FROM %s a%s WHERE LOWER(a.NAME) LIKE ? ESCAPE '\' ORDER BY a.NAME, a.ID FETCH FIRST %d ROWS ONLY`
)

// Schemes (schemes.go).
const (
	// sqlSchemeGroups returns every scheme folder VS_GROUP: ID, ID_PARENT and NAME.
	sqlSchemeGroups = "SELECT ID, ID_PARENT, NAME FROM {s}.VS_GROUP"

	// sqlSchemes returns every scheme VS_FORM: ID, its folder ID_NODE, its scheme type ID_TYPE, NAME, ALIAS, the
	// type's name (SYS_OTYP.NAME, NULL when unknown), FILE_NAME and LAST_UPDATE (Unix seconds).
	sqlSchemes = "SELECT f.ID, f.ID_NODE, f.ID_TYPE, f.NAME, f.ALIAS, t.NAME, f.FILE_NAME, f.LAST_UPDATE FROM {s}.VS_FORM f LEFT JOIN {s}.SYS_OTYP t ON t.ID = f.ID_TYPE"

	// sqlSchemeByID is sqlSchemes for one scheme. Parameter: VS_FORM.ID.
	sqlSchemeByID = sqlSchemes + " WHERE f.ID = ?"

	// sqlSchemesIn returns which of the given scheme ids still exist in VS_FORM. Fill: the "?" list (at most
	// existChunk). Parameters: the ids.
	sqlSchemesIn = "SELECT ID FROM {s}.VS_FORM WHERE ID IN (%s)"
)

// Binding dictionaries (dictionaries.go).
const (
	// sqlRegims returns the binding modes VS_REGIM: ID, ALIAS and DEFINE_ALIAS (the kind: equipment, meas1, ...).
	sqlRegims = "SELECT ID, ALIAS, DEFINE_ALIAS FROM {s}.VS_REGIM ORDER BY ID"

	// sqlOptions returns the binding options SYS_GTOPT with their global type SYS_GTYP: the option's ID, NAME and
	// DEFINE_ALIAS, the global type's DEFINE_ALIAS and NAME; by global type, then option.
	sqlOptions = "SELECT o.ID, o.NAME, o.DEFINE_ALIAS, g.DEFINE_ALIAS, g.NAME FROM {s}.SYS_GTOPT o JOIN {s}.SYS_GTYP g ON g.ID = o.ID_GTYPE ORDER BY g.ID, o.ID"

	// sqlFeatures returns the component features VS_COMP_FEATURE: the bit MASK, NAME and DEFINE_ALIAS.
	sqlFeatures = "SELECT MASK, NAME, DEFINE_ALIAS FROM {s}.VS_COMP_FEATURE ORDER BY MASK"
)

// Export checks (export_check.go).
const (
	// sqlSchemeTypes returns the object types SYS_OTYP that are scheme types (listed in VS_TYPE_V): ID and NAME.
	sqlSchemeTypes = "SELECT ot.ID, ot.NAME FROM {s}.SYS_OTYP ot, {s}.VS_TYPE_V vt WHERE ot.ID = vt.ID"

	// sqlComponentTypes returns the component types VS_TCOMP of one scheme type: ID, NAME and MODUS_TYPE (the
	// Modus symbol code a diagram element's shape maps to). Parameter: the scheme type (ID_DTYP).
	sqlComponentTypes = "SELECT ID, NAME, MODUS_TYPE FROM {s}.VS_TCOMP WHERE ID_DTYP = ? ORDER BY ID"
)

// Export writes (export.go). Every statement runs in the export's transaction.
const (
	// sqlInsertForm creates a scheme in VS_FORM. Parameters: ID (from seqForm), ID_NODE (folder), ID_TYPE (scheme
	// type), NAME, ALIAS, FILE_NAME and LAST_UPDATE (Unix seconds).
	sqlInsertForm = "INSERT INTO {s}.VS_FORM (ID, ID_NODE, ID_TYPE, NAME, ALIAS, FILE_NAME, LAST_UPDATE) VALUES (?, ?, ?, ?, ?, ?, ?)"

	// sqlUpdateForm rewrites an existing scheme in VS_FORM. Parameters: ID_NODE, ID_TYPE, NAME, ALIAS, FILE_NAME,
	// LAST_UPDATE, then the scheme's ID.
	sqlUpdateForm = "UPDATE {s}.VS_FORM SET ID_NODE = ?, ID_TYPE = ?, NAME = ?, ALIAS = ?, FILE_NAME = ?, LAST_UPDATE = ? WHERE ID = ?"

	// sqlReadCompsByName returns the components VS_COMP of a scheme with the given names (the diagram item ids):
	// ID, NAME, ID_TCTRL (component type), FEATURE and PRECISION. Fill: the "?" list of names. Parameters: the
	// scheme id, then the names.
	sqlReadCompsByName = "SELECT ID, NAME, ID_TCTRL, FEATURE, PRECISION FROM {s}.VS_COMP WHERE ID_FORM = ? AND NAME IN %s"

	// sqlReadTunesByName returns the bindings VS_REGIM_TUNE of a scheme's components with the given names:
	// ID_OWNLST (component id), ID_REGIM (mode), ID_TABLE and ID_PARAM (the bound object), ID_GTOPT (option) and
	// SCALE. Fill: the "?" list of names. Parameters: the scheme id, then the names.
	sqlReadTunesByName = "SELECT t.ID_OWNLST, t.ID_REGIM, t.ID_TABLE, t.ID_PARAM, t.ID_GTOPT, t.SCALE FROM {s}.VS_REGIM_TUNE t JOIN {s}.VS_COMP c ON c.ID = t.ID_OWNLST WHERE c.ID_FORM = ? AND c.NAME IN %s"

	// sqlReadObj returns the object bound to a scheme as a whole (VS_OBJ_TUNE): ID_TABLE and ID_PARAM. Parameter:
	// the scheme id.
	sqlReadObj = "SELECT ID_TABLE, ID_PARAM FROM {s}.VS_OBJ_TUNE WHERE ID_FORM = ?"

	// sqlDeleteObj removes the scheme's object binding. Parameter: the scheme id.
	sqlDeleteObj = "DELETE FROM {s}.VS_OBJ_TUNE WHERE ID_FORM = ?"

	// sqlUpdateObj rebinds the scheme to another object. Parameters: ID_TABLE, ID_PARAM, then the scheme id.
	sqlUpdateObj = "UPDATE {s}.VS_OBJ_TUNE SET ID_TABLE = ?, ID_PARAM = ? WHERE ID_FORM = ?"

	// sqlInsertObj binds the scheme to an object. Parameters: the scheme id, ID_TABLE and ID_PARAM.
	sqlInsertObj = "INSERT INTO {s}.VS_OBJ_TUNE (ID_FORM, ID_TABLE, ID_PARAM) VALUES (?, ?, ?)"

	// sqlDeleteOwned removes every binding of the given components, before the components themselves. Fill: the
	// "(?, ...)" list. Parameters: the component ids.
	sqlDeleteOwned = "DELETE FROM {s}.VS_REGIM_TUNE WHERE ID_OWNLST IN %s"

	// sqlDeleteCompID removes the given components. Fill: the "(?, ...)" list. Parameters: the component ids.
	sqlDeleteCompID = "DELETE FROM {s}.VS_COMP WHERE ID IN %s"

	// sqlDeleteTune removes single bindings by their key (component, mode, table). Fill: the "((?, ?, ?), ...)"
	// list. Parameters: the keys, three values each.
	sqlDeleteTune = "DELETE FROM {s}.VS_REGIM_TUNE WHERE (ID_OWNLST, ID_REGIM, ID_TABLE) IN %s"

	// sqlUpdateComp rewrites a component. Parameters: ID_TCTRL, FEATURE, PRECISION, then the component id.
	sqlUpdateComp = "UPDATE {s}.VS_COMP SET ID_TCTRL = ?, FEATURE = ?, PRECISION = ? WHERE ID = ?"

	// sqlUpdateTune rewrites a binding. Parameters: ID_PARAM, ID_GTOPT, SCALE, then its key ID_OWNLST, ID_REGIM and
	// ID_TABLE.
	sqlUpdateTune = "UPDATE {s}.VS_REGIM_TUNE SET ID_PARAM = ?, ID_GTOPT = ?, SCALE = ? WHERE ID_OWNLST = ? AND ID_REGIM = ? AND ID_TABLE = ?"
)

// Import (import.go).
const (
	// sqlImportComponents returns the components VS_COMP of a scheme with their type's Modus symbol code: ID, NAME,
	// PRECISION, FEATURE, VS_TCOMP.MODUS_TYPE (NULL for an unknown type) and ID_TCTRL; by id. Parameter: the
	// scheme id.
	sqlImportComponents = "SELECT c.ID, c.NAME, c.PRECISION, c.FEATURE, t.MODUS_TYPE, c.ID_TCTRL FROM {s}.VS_COMP c " +
		"LEFT JOIN {s}.VS_TCOMP t ON t.ID = c.ID_TCTRL WHERE c.ID_FORM = ? ORDER BY c.ID"

	// sqlImportTunes returns the bindings of a scheme's components with mode and option by alias: ID_OWNLST, the
	// mode's VS_REGIM.DEFINE_ALIAS, ID_TABLE, ID_PARAM, the option's SYS_GTOPT.DEFINE_ALIAS (NULL for none) and
	// SCALE; by component, mode, table. Parameter: the scheme id.
	sqlImportTunes = "SELECT t.ID_OWNLST, r.DEFINE_ALIAS, t.ID_TABLE, t.ID_PARAM, o.DEFINE_ALIAS, t.SCALE " +
		"FROM {s}.VS_REGIM_TUNE t JOIN {s}.VS_COMP c ON c.ID = t.ID_OWNLST JOIN {s}.VS_REGIM r ON r.ID = t.ID_REGIM " +
		"LEFT JOIN {s}.SYS_GTOPT o ON o.ID = t.ID_GTOPT WHERE c.ID_FORM = ? ORDER BY t.ID_OWNLST, t.ID_REGIM, t.ID_TABLE"

	// sqlImportObject is sqlReadObj for import: the scheme's own object binding. Parameter: the scheme id.
	sqlImportObject = "SELECT ID_TABLE, ID_PARAM FROM {s}.VS_OBJ_TUNE WHERE ID_FORM = ?"
)

// Object lookups by id (import.go, resolve.go).
const (
	// sqlObjectsByID returns the given objects of one table "o". Fills: the column list (built from the columns the
	// table has, NULL for missing ones), the FROM clause (the table as "o", optionally with sqlJoinObjectTypes) and
	// the "?" list (at most existChunk). Parameters: the ids.
	sqlObjectsByID = "SELECT %s FROM %s WHERE o.ID IN (%s)"

	// sqlJoinObjectTypes joins objects "o" with their types table "t" by ID_TYPE; the object may have no type.
	// Fill: the types table.
	sqlJoinObjectTypes = " LEFT JOIN %s t ON t.ID = o.ID_TYPE"
)

// Table metadata and measurement types (resolve.go).
const (
	// sqlTableInfo describes one table of SYS_TBLLST: its DEFINE_ALIAS and TABLE_NAME, its kind (the SYS_OTYP alias,
	// e.g. LST or DIR), its catalog id from SYS_TABL_V (0 for none) and its types table name: for a catalog (DIR)
	// SYS_TABL_V.ID_TDIRTBL, for a list SYS_TABL_V.ID_TBLREF. Parameter: SYS_TBLLST.ID.
	sqlTableInfo = "SELECT tbl.DEFINE_ALIAS, tbl.TABLE_NAME, ot.DEFINE_ALIAS, COALESCE(tv.ID_DIRTBL, 0), tt.TABLE_NAME " +
		"FROM {s}.SYS_TBLLST tbl JOIN {s}.SYS_OTYP ot ON ot.ID = tbl.ID_TYPE " +
		"LEFT JOIN {s}.SYS_TABL_V tv ON tv.ID = tbl.ID " +
		"LEFT JOIN {s}.SYS_TBLLST tt ON tt.ID = CASE ot.DEFINE_ALIAS WHEN 'DIR' THEN tv.ID_TDIRTBL ELSE tv.ID_TBLREF END " +
		"WHERE tbl.ID = ?"

	// sqlMeasGlobalType returns the global type SYS_GTYP.DEFINE_ALIAS of a measurement type, through its parameter
	// type SYS_PTYP. Parameter: SYS_MEAS_TYPES.DEFINE_ALIAS.
	sqlMeasGlobalType = "SELECT g.DEFINE_ALIAS FROM {s}.SYS_MEAS_TYPES m JOIN {s}.SYS_PTYP p ON p.ID = m.ID_TYPE " +
		"JOIN {s}.SYS_GTYP g ON g.ID = p.ID_GTYP WHERE m.DEFINE_ALIAS = ?"

	// sqlDATypeGlobalType returns the global type SYS_GTYP.DEFINE_ALIAS of a data acquisition type. Parameter:
	// SYS_DTYP.ID.
	sqlDATypeGlobalType = "SELECT g.DEFINE_ALIAS FROM {s}.SYS_DTYP d JOIN {s}.SYS_GTYP g ON g.ID = d.ID_GTYPE WHERE d.ID = ?"
)

// Binding suggestions (suggest.go).
const (
	// sqlObjectTypes returns every object type SYS_OTYP: ID, ID_PARENT (0 for a root) and DEFINE_ALIAS; the
	// parents give each type's ancestors.
	sqlObjectTypes = "SELECT ID, COALESCE(ID_PARENT, 0), DEFINE_ALIAS FROM {s}.SYS_OTYP"

	// sqlMeasGlobalTypes returns every measurement type with its global type: SYS_MEAS_TYPES.DEFINE_ALIAS and
	// SYS_GTYP.DEFINE_ALIAS (through SYS_PTYP).
	sqlMeasGlobalTypes = "SELECT m.DEFINE_ALIAS, g.DEFINE_ALIAS FROM {s}.SYS_MEAS_TYPES m JOIN {s}.SYS_PTYP p ON p.ID = m.ID_TYPE JOIN {s}.SYS_GTYP g ON g.ID = p.ID_GTYP"

	// sqlEquipTable finds the equipment table in SYS_TBLLST by alias or by name: ID, upper-cased DEFINE_ALIAS and
	// TABLE_NAME. Parameters: the alias (OBJ_TREE_GEN) and the name (OBJ_TREE), upper-cased.
	sqlEquipTable = "SELECT ID, UPPER(DEFINE_ALIAS), UPPER(TABLE_NAME) FROM {s}.SYS_TBLLST WHERE UPPER(DEFINE_ALIAS) = ? OR UPPER(TABLE_NAME) = ?"

	// sqlMeasListTables returns the measurement list tables: those SYS_TBLREF links with ID_LINK to the generic
	// measurement list, as ID and TABLE_NAME by id. Parameters: the link kind (measListLink) and the generic list's
	// alias (MEAS_LIST_GEN), upper-cased.
	sqlMeasListTables = "SELECT ID, TABLE_NAME FROM {s}.SYS_TBLLST WHERE ID IN (SELECT ID_TBL FROM {s}.SYS_TBLREF WHERE ID_LINK = ? AND ID_TBLREC IN (SELECT ID FROM {s}.SYS_TBLLST WHERE UPPER(DEFINE_ALIAS) = ?)) ORDER BY ID"

	// sqlSwitchMeasOfObj returns the switch and drawer state measurements of an object found in one measurement
	// list table "v": the table id, MEAS_LIST.ID, its GUID, NAME, the measurement type's DEFINE_ALIAS and NAME.
	// Fills: the table id, the GUID expression ("NULL" or "meas.GUID") and the table. Parameters: the object id
	// (MEAS_LIST.ID_OBJ) and the two state type aliases.
	sqlSwitchMeasOfObj = "SELECT %d, meas.ID, %s, meas.NAME, mt.DEFINE_ALIAS, mt.NAME FROM %s v JOIN {s}.MEAS_LIST meas ON meas.ID = v.ID JOIN {s}.SYS_MEAS_TYPES mt ON mt.ID = meas.ID_MEAS_TYPE WHERE meas.ID_OBJ = ? AND mt.DEFINE_ALIAS IN (?, ?)"

	// sqlUnionAll joins the sqlSwitchMeasOfObj of every measurement list table into one query.
	sqlUnionAll = " UNION ALL "

	// sqlOrderByTableMeas sorts the united switch measurements by table id, then measurement id.
	sqlOrderByTableMeas = " ORDER BY 1, 2"

	// sqlOwnerOfMeas returns the equipment OBJ_TREE owning a measurement: its ID, GUID, NAME, the type's
	// SYS_OTYP.DEFINE_ALIAS and NAME. Fill: the GUID expression ("NULL" or "obj.GUID"). Parameter: MEAS_LIST.ID.
	sqlOwnerOfMeas = "SELECT obj.ID, %s, obj.NAME, t.DEFINE_ALIAS, t.NAME FROM {s}.OBJ_TREE obj JOIN {s}.SYS_OTYP t ON t.ID = obj.ID_TYPE JOIN {s}.MEAS_LIST meas ON meas.ID_OBJ = obj.ID WHERE meas.ID = ?"
)

// Per-database SQL (dialect.go). These are already in the database's own text.
const (
	// sqlOracleNextVal takes the next value of a sequence. Fills: the schema and the sequence.
	sqlOracleNextVal = "%s.%s.NEXTVAL"

	// sqlPostgresNextVal takes the next value of a sequence. Fills: the schema and the lower-cased sequence.
	sqlPostgresNextVal = "nextval('%s.%s')"

	// sqlOracleNextVals returns n values of a sequence, one per row. Fills: the NEXTVAL expression and n.
	sqlOracleNextVals = "SELECT %s FROM DUAL CONNECT BY LEVEL <= %d"

	// sqlPostgresNextVals returns n values of a sequence, one per row. Fills: the nextval expression and n.
	sqlPostgresNextVals = "SELECT %s FROM generate_series(1, %d)"

	// sqlOracleInsertAll inserts several rows in one statement. Fill: the sqlOracleInsertInto clauses, one per row.
	sqlOracleInsertAll = "INSERT ALL%s SELECT 1 FROM DUAL"

	// sqlOracleInsertInto is one row of sqlOracleInsertAll. Fills: "{s}.TABLE (COLUMNS)" and "(?, ...)".
	sqlOracleInsertInto = " INTO %s VALUES %s"

	// sqlPostgresInsertRows inserts several rows in one statement. Fills: "{s}.TABLE (COLUMNS)" and the
	// comma-separated "(?, ...)" rows.
	sqlPostgresInsertRows = "INSERT INTO %s VALUES %s"

	// sqlOracleColumns returns the column names of a table. Parameters: the upper-cased schema (OWNER) and table.
	sqlOracleColumns = "SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER = ? AND TABLE_NAME = ?"

	// sqlPostgresColumns returns the column names of a table. Parameters: the lower-cased schema and table.
	sqlPostgresColumns = "SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?"
)
