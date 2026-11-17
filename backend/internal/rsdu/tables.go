package rsdu

import (
	"context"
	"fmt"
	"strings"
	"sync"
)

// tables is the column dictionary, read per table on first use and kept for the process lifetime.
type tables struct {
	q Querier
	d Dialect

	mu   sync.Mutex
	cols map[string]map[string]bool
}

func newTables(q Querier, d Dialect) *tables {
	return &tables{q: q, d: d, cols: map[string]map[string]bool{}}
}

// Columns returns the upper-case column names of table; empty when the table does not exist.
func (t *tables) Columns(ctx context.Context, table string) (map[string]bool, error) {
	key := strings.ToUpper(table)
	t.mu.Lock()
	cols, ok := t.cols[key]
	t.mu.Unlock()
	if ok {
		return cols, nil
	}
	query, args := t.d.ColumnsQuery(table)
	rows, err := t.q.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols = map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		cols[strings.ToUpper(name)] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	t.mu.Lock()
	t.cols[key] = cols
	t.mu.Unlock()
	return cols, nil
}

// HasColumn reports whether table has column.
func (t *tables) HasColumn(ctx context.Context, table, column string) (bool, error) {
	cols, err := t.Columns(ctx, table)
	if err != nil {
		return false, err
	}
	return cols[strings.ToUpper(column)], nil
}

// Table returns name, read from the database (SYS_TBLLST.TABLE_NAME), as a schema-qualified table safe to put into
// SQL: it must be a plain identifier and exist in the column dictionary.
func (t *tables) Table(ctx context.Context, name string) (string, error) {
	if !identifierRe.MatchString(name) {
		return "", fmt.Errorf("rsdu: table name %q is not a plain identifier", name)
	}
	cols, err := t.Columns(ctx, name)
	if err != nil {
		return "", err
	}
	if len(cols) == 0 {
		return "", fmt.Errorf("rsdu: table %s.%s does not exist", t.d.Schema, name)
	}
	return t.d.Schema + "." + name, nil
}

// reset forgets the column dictionary.
func (t *tables) reset() {
	t.mu.Lock()
	t.cols = map[string]map[string]bool{}
	t.mu.Unlock()
}
