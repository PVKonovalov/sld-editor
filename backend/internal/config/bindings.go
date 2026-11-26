package config

import (
	"errors"
	"fmt"
	"maps"
	"net"
	"slices"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/PVKonovalov/slddoc"
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
	// DSN is the connection to the RSDU database, for reading and for export.
	DSN DSN `yaml:"dsn"`
	// Export enables export to RSDU; the account of DSN must then be allowed to write.
	Export bool `yaml:"export" env:"true"`
	// LegacyRead and LegacyWrite catch the former separate connections, replaced by DSN.
	LegacyRead  any `yaml:"read"`
	LegacyWrite any `yaml:"write"`
	// SchemeType is VS_FORM.ID_TYPE / VS_TCOMP.ID_DTYP of exported schemes.
	SchemeType int `yaml:"scheme_type" env:"true"`
	// WireTypes is the VS_TCOMP.ID a bound wire of each connector kind is exported as (wires have no MODUS_TYPE);
	// absent: DefaultWireTypes.
	WireTypes map[string]int64 `yaml:"wire_types"`
	// ComponentTypes is the VS_TCOMP.ID an item of a shape is exported as when no component type of the scheme type
	// has that MODUS_TYPE and the item has no type of its own.
	ComponentTypes map[string]int64 `yaml:"component_types"`
	// Sections limits the Objects panel to these SYS_TREE21 paths, each the node ids from a top node down to the node
	// shown with its whole subtree; absent: the whole tree from node 1.
	Sections [][]int64 `yaml:"sections"`
	SVG      struct {
		// Dir is where ctrlroom reads scheme SVGs (its backend.path_to_sld).
		Dir string `yaml:"dir" env:"true"`
		// FullPath mirrors ctrlroom's backend.use_full_path_for_sld.
		FullPath bool `yaml:"full_path" env:"true"`
		// UseObjectStorage and ObjectStorage are ctrlroom's backend.use_object_storage and backend.object_storage, so
		// the lines can be copied: "minio" delivers the SVG to ObjectStorage.Minio as well; "", "n", "local" or
		// "file": no object storage.
		UseObjectStorage string `yaml:"use_object_storage" env:"true"`
		ObjectStorage    struct {
			Minio Minio `yaml:"minio"`
		} `yaml:"object_storage"`
	} `yaml:"svg"`
}

// DefaultWireTypes are RSDU's standard wire component types: bus work, overhead line, cable line, object link, bus.
var DefaultWireTypes = map[string]int64{
	string(slddoc.KindBusWork): 1489, string(slddoc.KindOverheadLine): 112, string(slddoc.KindCableLine): 115,
	string(slddoc.KindLinkToObject): 1014, string(slddoc.KindBusbarWire): 113,
}

// WireType returns the VS_TCOMP.ID a wire of kind is exported as.
func (r RSDUBindings) WireType(kind string) (int64, bool) {
	types := r.WireTypes
	if types == nil {
		types = DefaultWireTypes
	}
	id, ok := types[kind]
	return id, ok
}

// UsesMinio reports whether the SVG is delivered to the Minio bucket too.
func (r RSDUBindings) UsesMinio() bool { return strings.EqualFold(r.SVG.UseObjectStorage, "minio") }

// Minio is ctrlroom's object_storage.minio. The keys are better kept in .env
// (BINDINGS_RSDU_SVG_OBJECT_STORAGE_MINIO_USER, ..._PASSWORD).
type Minio struct {
	Secure Flag   `yaml:"secure" env:"true"`
	User   string `yaml:"user" env:"true"`
	// Username is ctrlroom's name for User.
	Username string            `yaml:"username" env:"true"`
	Password string            `yaml:"password" env:"true"`
	Bucket   map[string]string `yaml:"bucket"`
	Endpoint []Endpoint        `yaml:"endpoint"`
}

// Endpoint is one server of an object storage.
type Endpoint struct {
	Host string `yaml:"host"`
	Port int    `yaml:"port"`
}

// AccessKey is User, or Username when User is empty.
func (m Minio) AccessKey() string {
	if m.User != "" {
		return m.User
	}
	return m.Username
}

// Address is the first endpoint as host:port, the one ctrlroom reads from; "" when none.
func (m Minio) Address() string {
	if len(m.Endpoint) == 0 {
		return ""
	}
	return net.JoinHostPort(m.Endpoint[0].Host, strconv.Itoa(m.Endpoint[0].Port))
}

// SLDBucket is the bucket of scheme pictures, bucket.sld.
func (m Minio) SLDBucket() string { return m.Bucket["sld"] }

// Flag is a bool written as in ctrlroom's YAML: true/false, y/n or yes/no.
type Flag bool

func (f *Flag) UnmarshalYAML(n *yaml.Node) error {
	switch strings.ToLower(n.Value) {
	case "true", "y", "yes", "1":
		*f = true
	case "false", "n", "no", "0", "":
		*f = false
	default:
		return fmt.Errorf("line %d: %q is not true/false, y/n or yes/no", n.Line, n.Value)
	}
	return nil
}

// DSN is one database connection, with the field names of an entry of ctrlroom's database.dsn. Every connection field
// can come from the environment or .env (BINDINGS_RSDU_DSN_PASSWORD, ...).
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
	for shape, id := range r.ComponentTypes {
		if _, err := strconv.Atoi(shape); err != nil || id <= 0 {
			return fmt.Errorf("bindings.rsdu.component_types: %q: %d, want a shape code and a VS_TCOMP id", shape, id)
		}
	}
	for kind, id := range r.WireTypes {
		if _, ok := DefaultWireTypes[kind]; !ok {
			return fmt.Errorf("bindings.rsdu.wire_types: %q is not a wire kind (%s)", kind, strings.Join(slices.Sorted(maps.Keys(DefaultWireTypes)), ", "))
		}
		if id <= 0 {
			return fmt.Errorf("bindings.rsdu.wire_types.%s: %d is not a VS_TCOMP id", kind, id)
		}
	}
	if err := validateSections(r.Sections); err != nil {
		return err
	}
	if r.LegacyRead != nil || r.LegacyWrite != nil {
		return errors.New("bindings.rsdu.read / write: replaced by one connection, bindings.rsdu.dsn (environment: BINDINGS_RSDU_DSN_*), and bindings.rsdu.export: true to enable export")
	}
	if !r.DSN.IsSet() {
		return errors.New("bindings.rsdu.dsn: required")
	}
	if err := r.DSN.validate(r.Driver); err != nil {
		return fmt.Errorf("bindings.rsdu.dsn: %w", err)
	}
	switch u := strings.ToLower(r.SVG.UseObjectStorage); u {
	case "", "n", "no", "local", "file":
	case "minio":
		m := r.SVG.ObjectStorage.Minio
		switch {
		case len(m.Endpoint) == 0 || m.Endpoint[0].Host == "" || m.Endpoint[0].Port <= 0:
			return errors.New("bindings.rsdu.svg.object_storage.minio.endpoint: a host and port are required")
		case m.SLDBucket() == "":
			return errors.New("bindings.rsdu.svg.object_storage.minio.bucket.sld: required")
		case m.AccessKey() == "":
			return errors.New("bindings.rsdu.svg.object_storage.minio.user: required (environment: BINDINGS_RSDU_SVG_OBJECT_STORAGE_MINIO_USER)")
		}
	default:
		return fmt.Errorf("bindings.rsdu.svg.use_object_storage: unknown object storage %q (known: minio)", r.SVG.UseObjectStorage)
	}
	return nil
}

// validateSections checks that every path is non-empty, of positive ids without repeats, and listed once.
func validateSections(paths [][]int64) error {
	for i, path := range paths {
		if len(path) == 0 {
			return fmt.Errorf("bindings.rsdu.sections[%d]: empty path", i)
		}
		for k, id := range path {
			if id <= 0 {
				return fmt.Errorf("bindings.rsdu.sections[%d]: %d is not a positive SYS_TREE21 id", i, id)
			}
			if slices.Contains(path[:k], id) {
				return fmt.Errorf("bindings.rsdu.sections[%d]: node %d repeats", i, id)
			}
		}
		if j := slices.IndexFunc(paths[:i], func(p []int64) bool { return slices.Equal(p, path) }); j >= 0 {
			return fmt.Errorf("bindings.rsdu.sections[%d]: same path as sections[%d]", i, j)
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
