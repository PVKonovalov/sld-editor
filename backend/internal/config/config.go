// Package config defines sld-editor's own YAML-backed configuration
// struct, loaded through the generic reader in pkg/configuration.
package config

// Config is sld-editor's top-level configuration, read from a YAML file
// (see config/sld-editor.yaml) with per-field environment-variable
// overrides (env:"true" tags, read by pkg/configuration).
type Config struct {
	Server struct {
		// Bind is the address the HTTP API listens on, e.g. "0.0.0.0:8090".
		Bind string `yaml:"bind" env:"true"`
	} `yaml:"server"`

	Logging struct {
		Level string `yaml:"level" env:"true"`
	} `yaml:"logging"`

	Diagrams struct {
		// Dir is the directory diagrams are listed/loaded/saved from.
		Dir string `yaml:"dir" env:"true"`
	} `yaml:"diagrams"`

	Elements struct {
		// Libraries lists element-library XML files (see internal/elements),
		// merged in order — a later file's definition of a shape overrides
		// an earlier one's. A site adds equipment sld-editor doesn't ship
		// with by writing its own library file and adding its path here, no
		// code change required.
		Libraries []string `yaml:"libraries" env:"true"`
	} `yaml:"elements"`

	Editor struct {
		// GridSpacing/Snap/ShowGrid/Background are the Settings panel's
		// defaults for a diagram that hasn't saved its own (Diagram.Editor is
		// nil).
		GridSpacing float64 `yaml:"grid_spacing" env:"true"`
		Snap        bool    `yaml:"snap" env:"true"`
		ShowGrid    bool    `yaml:"show_grid" env:"true"`
		Background  string  `yaml:"background" env:"true"`
	} `yaml:"editor"`

	// VoltageColors is the default voltage-level -> color palette offered
	// when adding a voltage class to a diagram (or seeding a new one); it
	// has no effect on a diagram's own already-saved VoltageClasses.
	VoltageColors []VoltageColor `yaml:"voltage_colors"`

	// StateColors is the install-wide Open/Close/Intermediate legend a
	// switching device's state-driven fill (and its data-fill/data-state
	// attributes — see internal/slddoc.Render) are drawn from. Unlike
	// VoltageColors, this has no per-diagram override: a diagram's own
	// elements only ever carry a raw State value (0/1/2/...), never a
	// color, so there is nothing for a diagram to have "already saved"
	// here to fall back to.
	StateColors []StateColor `yaml:"state_colors"`

	// FPIStateColors is the install-wide Open/Close/Intermediate legend a
	// FaultPassageIndicator's own ring/text color (internal/slddoc.Render's
	// {fpiColor}) is drawn from — a separate legend from StateColors since
	// an FPI's Open/Close meaning is inverted from a switching device's own:
	// a switching device defaults to Close/lawngreen (in service, current
	// flowing), while an FPI defaults to Open/lawngreen (no fault detected)
	// and turns red on Close (a fault passed through it).
	FPIStateColors []StateColor `yaml:"fpi_state_colors"`

	// PositionStates is the install-wide Service/Normal/Test legend a
	// withdrawable device's own racking position (Element.Position, its own
	// data-trolley attribute — see internal/slddoc.Render) is labeled from.
	// Unlike State, position carries no color of its own — it only drives a
	// geometric offset — so there's no Color field here, just a label.
	PositionStates []PositionState `yaml:"position_states"`

	Indicators struct {
		// DefaultFPIText is the label a FaultPassageIndicator (320003)
		// draws centered on itself when its own Element.PropertyText is
		// unset (internal/slddoc.Render's defaultFPIText) — this shape's
		// own real source draws no text at all, so there's nothing to
		// derive a default from; it's admin-configurable per install
		// rather than hardcoded, the same reasoning VoltageColors/
		// StateColors already get their own config section for. Empty
		// falls back to the literal "FPI" this project has always shown.
		DefaultFPIText string `yaml:"default_fpi_text" env:"true"`
	} `yaml:"indicators"`
}

// VoltageColor is one default palette entry.
type VoltageColor struct {
	Name  string `yaml:"name" json:"name"`
	Color string `yaml:"color" json:"color"`
}

// StateColor is one entry of the global state->color legend: State is the
// raw value an Element's own State field records (0/1/2/...), Label is
// what the Properties panel's State dropdown shows for it, and Color is
// what internal/slddoc.Render fills a switching device's body with when
// State matches.
type StateColor struct {
	State int    `yaml:"state" json:"state"`
	Label string `yaml:"label" json:"label"`
	Color string `yaml:"color" json:"color"`
}

// PositionState is one entry of the global withdrawable-position legend:
// Position is the raw value an Element's own Position field records
// (0/1/2), and Label is what the Properties panel's Position status
// dropdown shows for it.
type PositionState struct {
	Position int    `yaml:"position" json:"position"`
	Label    string `yaml:"label" json:"label"`
}
