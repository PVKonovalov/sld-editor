package rsdu

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"sync"
	"time"

	_ "github.com/lib/pq"
	oracle "github.com/sijms/go-ora/v2"

	"sld-editor/internal/config"
)

// queryTimeout is a watchdog: a query still running after it fails with an error.
const queryTimeout = 30 * time.Second

const (
	// oraclePrefetchRows is how many rows go-ora fetches per round trip (its default 25 makes big lists slow).
	oraclePrefetchRows = "1000"
	maxOpenConns       = 4
	maxIdleConns       = 2
	connMaxIdleTime    = 5 * time.Minute
)

// Rows is the part of *sql.Rows the provider reads.
type Rows interface {
	Next() bool
	Scan(dest ...any) error
	Close() error
	Err() error
}

// Querier runs a query already in the database's dialect.
type Querier interface {
	Query(ctx context.Context, query string, args ...any) (Rows, error)
}

// conn is one lazily opened connection pool. It is opened on the first query and dropped after a connection
// failure, so the next query reconnects.
type conn struct {
	driver string
	dsn    config.DSN

	mu sync.Mutex
	db *sql.DB
}

func newConn(driver string, dsn config.DSN) *conn {
	return &conn{driver: driver, dsn: dsn}
}

// Query runs query with args under queryTimeout; the returned Rows must be closed.
func (c *conn) Query(ctx context.Context, query string, args ...any) (Rows, error) {
	db, err := c.open()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		cancel()
		c.dropOnConnError(db, err)
		return nil, fmt.Errorf("rsdu %s: %w", c.dsnString(), err)
	}
	return &cancelRows{Rows: rows, cancel: cancel}, nil
}

type cancelRows struct {
	*sql.Rows
	cancel context.CancelFunc
}

func (r *cancelRows) Close() error {
	err := r.Rows.Close()
	r.cancel()
	return err
}

func (c *conn) open() (*sql.DB, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.db != nil {
		return c.db, nil
	}
	var db *sql.DB
	var err error
	switch c.driver {
	case config.DriverOracle:
		db, err = sql.Open("oracle", oracleURL(c.dsn))
	case config.DriverPostgres:
		db, err = sql.Open("postgres", postgresURL(c.dsn))
	default:
		err = fmt.Errorf("unknown driver %q", c.driver)
	}
	if err != nil {
		return nil, fmt.Errorf("rsdu %s: %w", c.dsnString(), err)
	}
	db.SetMaxOpenConns(maxOpenConns)
	db.SetMaxIdleConns(maxIdleConns)
	db.SetConnMaxIdleTime(connMaxIdleTime)
	c.db = db
	return db, nil
}

// dropOnConnError closes db after a connection-level failure so the next query opens a new pool.
func (c *conn) dropOnConnError(db *sql.DB, err error) {
	var netErr net.Error
	if !errors.Is(err, driver.ErrBadConn) && !errors.Is(err, io.EOF) && !errors.As(err, &netErr) {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.db == db {
		_ = c.db.Close()
		c.db = nil
	}
}

// Close closes the pool, if open.
func (c *conn) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.db != nil {
		_ = c.db.Close()
		c.db = nil
	}
}

// dsnString describes the connection without its password.
func (c *conn) dsnString() string {
	db := c.dsn.Database
	if c.dsn.Sid != "" {
		db = c.dsn.Sid
	}
	return fmt.Sprintf("%s://%s@%s:%d/%s", c.driver, c.dsn.User, c.dsn.Host, c.dsn.Port, db)
}

// oracleURL builds a go-ora URL as ctrlroom does: a SID, when given, wins over the service name in Database.
func oracleURL(d config.DSN) string {
	opts := map[string]string{"PREFETCH_ROWS": oraclePrefetchRows}
	service := d.Database
	if d.Sid != "" {
		service = ""
		opts["SID"] = d.Sid
	}
	if d.Trace {
		opts["TRACE FILE"] = fmt.Sprintf("ora-trace-%s.log", time.Now().Format("20060102150405"))
	}
	return oracle.BuildUrl(d.Host, d.Port, service, d.User, d.Password, opts)
}

func postgresURL(d config.DSN) string {
	u := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(d.User, d.Password),
		Host:     fmt.Sprintf("%s:%d", d.Host, d.Port),
		Path:     "/" + d.Database,
		RawQuery: "sslmode=disable&application_name=sld-editor",
	}
	return u.String()
}
