package rsdu

import (
	"encoding/hex"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"sld-editor/internal/config"
)

// DefaultSchema is the RSDU schema when bindings.rsdu.schema is empty (as ctrlroom).
const DefaultSchema = "rsduadmin"

var identifierRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_$]*$`)

// Dialect is the only per-database code. Queries are written once, with unquoted identifiers (upper-cased by
// Oracle, lower-cased by PostgreSQL), "{s}." before every table and "?" for every parameter; SQL turns them into the
// database's text.
type Dialect struct {
	Driver string
	Schema string
}

// NewDialect checks schema (default DefaultSchema) and returns the dialect of driver.
func NewDialect(driver, schema string) (Dialect, error) {
	if schema == "" {
		schema = DefaultSchema
	}
	if !identifierRe.MatchString(schema) {
		return Dialect{}, fmt.Errorf("bindings.rsdu.schema: %q is not a plain identifier", schema)
	}
	if driver != config.DriverOracle && driver != config.DriverPostgres {
		return Dialect{}, fmt.Errorf("bindings.rsdu.driver: unknown driver %q", driver)
	}
	return Dialect{Driver: driver, Schema: schema}, nil
}

// SQL replaces "{s}" with the schema and each "?" outside a string literal with the bind parameter: Oracle :pr1,
// :pr2…, PostgreSQL $1, $2….
func (d Dialect) SQL(q string) string {
	q = strings.ReplaceAll(q, "{s}", d.Schema)
	var b strings.Builder
	n := 0
	inLiteral := false
	for _, r := range q {
		switch {
		case r == '\'':
			inLiteral = !inLiteral
		case r == '?' && !inLiteral:
			n++
			if d.Driver == config.DriverOracle {
				b.WriteString(":pr" + strconv.Itoa(n))
			} else {
				b.WriteString("$" + strconv.Itoa(n))
			}
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// NextVal is the SQL expression taking the next value of the schema's sequence seq.
func (d Dialect) NextVal(seq string) string {
	if d.Driver == config.DriverOracle {
		return d.Schema + "." + seq + ".NEXTVAL"
	}
	return "nextval('" + d.Schema + "." + strings.ToLower(seq) + "')"
}

// NextVals is the query returning n values of the schema's sequence seq, one per row.
func (d Dialect) NextVals(seq string, n int) string {
	if d.Driver == config.DriverOracle {
		return "SELECT " + d.NextVal(seq) + " FROM DUAL CONNECT BY LEVEL <= " + strconv.Itoa(n)
	}
	return "SELECT " + d.NextVal(seq) + " FROM generate_series(1, " + strconv.Itoa(n) + ")"
}

// InsertRows is the statement inserting n rows of cols into the schema's table, with "?" parameters row by row:
// PostgreSQL a multi-row VALUES, Oracle INSERT ALL.
func (d Dialect) InsertRows(table string, cols []string, n int) string {
	into := "{s}." + table + " (" + strings.Join(cols, ", ") + ")"
	values := "(" + strings.TrimSuffix(strings.Repeat("?, ", len(cols)), ", ") + ")"
	if d.Driver == config.DriverOracle {
		return "INSERT ALL" + strings.Repeat(" INTO "+into+" VALUES "+values, n) + " SELECT 1 FROM DUAL"
	}
	return "INSERT INTO " + into + " VALUES " + strings.TrimSuffix(strings.Repeat(values+", ", n), ", ")
}

// ColumnsQuery returns the query listing the column names of table, with its arguments.
func (d Dialect) ColumnsQuery(table string) (string, []any) {
	if d.Driver == config.DriverOracle {
		return d.SQL("SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER = ? AND TABLE_NAME = ?"),
			[]any{strings.ToUpper(d.Schema), strings.ToUpper(table)}
	}
	return d.SQL("SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?"),
		[]any{strings.ToLower(d.Schema), strings.ToLower(table)}
}

// GUID returns a GUID column value (Oracle RAW(16), PostgreSQL uuid or bytea) in canonical lower-case form; "" for
// NULL or an unrecognised value.
func GUID(v any) string {
	var raw []byte
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		raw = []byte(x)
	case []byte:
		raw = x
	default:
		return ""
	}
	switch len(raw) {
	case 16:
		h := hex.EncodeToString(raw)
		return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
	case 32, 36:
		s := strings.ToLower(strings.ReplaceAll(string(raw), "-", ""))
		if len(s) != 32 {
			return ""
		}
		if _, err := hex.DecodeString(s); err != nil {
			return ""
		}
		return s[0:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:32]
	}
	return ""
}

// Bool reads a flag stored as an Oracle NUMBER 0/1 or a PostgreSQL boolean/smallint.
func Bool(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case int64:
		return x != 0
	case float64:
		return x != 0
	case string:
		return x != "" && x != "0" && !strings.EqualFold(x, "false") && !strings.EqualFold(x, "f")
	case []byte:
		return Bool(string(x))
	}
	return false
}
