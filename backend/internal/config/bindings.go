package config

import (
	"errors"
	"fmt"
)

// Binding providers known to ValidateBindings.
const (
	ProviderRSDU = "rsdu"
)

// RSDU database drivers.
const (
	DriverOracle   = "oracle"
	DriverPostgres = "postgres"
)

// Bindings selects the SCADA data provider diagram items are bound to; an empty Provider turns bindings off.
type Bindings struct {
	Provider string       `yaml:"provider" env:"true"`
	RSDU     RSDUBindings `yaml:"rsdu"`
}

// RSDUBindings are the settings of the rsdu provider.
type RSDUBindings struct {
	Driver string `yaml:"driver" env:"true"`
	Schema string `yaml:"schema" env:"true"`
	// Read is the connection objects are read through; Write, when set, enables export.
	Read  DSN `yaml:"read"`
	Write DSN `yaml:"write"`
	// SchemeType is VS_FORM.ID_TYPE / VS_TCOMP.ID_DTYP of exported schemes.
	SchemeType int `yaml:"scheme_type" env:"true"`
	SVG        struct {
		// Dir is where ctrlroom reads scheme SVGs (its backend.path_to_sld).
		Dir string `yaml:"dir" env:"true"`
		// FullPath mirrors ctrlroom's backend.use_full_path_for_sld.
		FullPath bool `yaml:"full_path" env:"true"`
	} `yaml:"svg"`
}

// DSN is one database connection, with the field names of an entry of ctrlroom's database.dsn. Every connection field
// can come from the environment or .env (BINDINGS_RSDU_READ_PASSWORD, ...).
type DSN struct {
	Engine            string `yaml:"engine" env:"true"`
	User              string `yaml:"user" env:"true"`
	Password          string `yaml:"password" env:"true"`
	Database          string `yaml:"database" env:"true"`
	Host              string `yaml:"host" env:"true"`
	Port              int    `yaml:"port" env:"true"`
	Sid               string `yaml:"sid" env:"true"`
	Trace             bool   `yaml:"trace"`
	PasswordEncrypted bool   `yaml:"password_encrypted"`
}

// IsSet reports whether any connection field is given.
func (d DSN) IsSet() bool { return d != DSN{} }

// ValidateBindings checks the bindings section: a known provider and complete settings for it. It returns nil when
// bindings are off. No database is contacted.
func (c *Config) ValidateBindings() error {
	b := &c.Bindings
	switch b.Provider {
	case "":
		return nil
	case ProviderRSDU:
	default:
		return fmt.Errorf("bindings.provider: unknown provider %q (known: %q)", b.Provider, ProviderRSDU)
	}
	r := &b.RSDU
	if r.Driver != DriverOracle && r.Driver != DriverPostgres {
		return fmt.Errorf("bindings.rsdu.driver: %q, want %q or %q", r.Driver, DriverOracle, DriverPostgres)
	}
	if r.SchemeType < 0 {
		return fmt.Errorf("bindings.rsdu.scheme_type: %d is negative", r.SchemeType)
	}
	if !r.Read.IsSet() {
		return errors.New("bindings.rsdu.read: required")
	}
	if err := r.Read.validate(r.Driver); err != nil {
		return fmt.Errorf("bindings.rsdu.read: %w", err)
	}
	if r.Write.IsSet() {
		if err := r.Write.validate(r.Driver); err != nil {
			return fmt.Errorf("bindings.rsdu.write: %w", err)
		}
	}
	return nil
}

func (d DSN) validate(driver string) error {
	switch {
	case d.Engine != "" && d.Engine != driver:
		return fmt.Errorf("engine %q differs from driver %q", d.Engine, driver)
	case d.Host == "":
		return errors.New("host is required")
	case d.Port <= 0:
		return errors.New("port is required")
	case d.User == "":
		return errors.New("user is required")
	case d.Database == "" && d.Sid == "":
		return errors.New("database or sid is required")
	case d.PasswordEncrypted:
		return errors.New("password_encrypted is not supported; give the password in plain text or by environment variable")
	}
	return nil
}
