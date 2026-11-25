package config

import (
	"fmt"
	"slices"
	"strings"
)

// Designations is the designations section: the letters of the functional hierarchy's voltage levels and units.
type Designations struct {
	// VoltageLevels gives a voltage level up to MaxKV (and above the previous row) its letter, ascending by MaxKV.
	VoltageLevels []VoltageLevelCode `yaml:"voltage_levels" json:"voltageLevels"`
	// FallbackVoltageCode is the letter of a voltage level no row matches.
	FallbackVoltageCode string `yaml:"fallback_voltage_code" json:"fallbackVoltageCode"`
	// Units maps each unit kind (DesignationUnitKinds) to its letter and number width.
	Units map[string]UnitCode `yaml:"units" json:"units"`
}

// VoltageLevelCode is one row of designations.voltage_levels.
type VoltageLevelCode struct {
	MaxKV float64 `yaml:"max_kv" json:"maxKv"`
	Code  string  `yaml:"code" json:"code"`
}

// UnitCode is a unit kind's letter and the zero-padded width of its number (0 is 1).
type UnitCode struct {
	Code   string `yaml:"code" json:"code"`
	Digits int    `yaml:"digits" json:"digits"`
}

// DesignationUnitKinds are the keys of designations.units, mapped to slddoc's function kinds.
var DesignationUnitKinds = map[string]string{
	"incoming_feeder": "incomingFeeder",
	"outgoing_feeder": "outgoingFeeder",
	"generator":       "generator",
	"transformer":     "transformer",
	"bus_coupler":     "busCoupler",
	"busbar":          "busbar",
	"measuring":       "measuring",
	"other":           "other",
}

// ValidLetterCode tells whether code is 1 to 3 capital letters other than I and O.
func ValidLetterCode(code string) bool {
	return len(code) >= 1 && len(code) <= 3 && strings.IndexFunc(code, func(r rune) bool {
		return r < 'A' || r > 'Z' || r == 'I' || r == 'O'
	}) < 0
}

// ValidateDesignations checks the designations section: voltage levels ascending by a positive max_kv, every unit
// kind listed once, every code a valid letter code and digits 0 to 3. Returns the first mistake found.
func (c *Config) ValidateDesignations() error {
	d := &c.Designations
	for i, v := range d.VoltageLevels {
		if v.MaxKV <= 0 || i > 0 && v.MaxKV <= d.VoltageLevels[i-1].MaxKV {
			return fmt.Errorf("designations.voltage_levels[%d]: max_kv %g: want positive and ascending", i, v.MaxKV)
		}
		if !ValidLetterCode(v.Code) {
			return fmt.Errorf("designations.voltage_levels[%d]: code %q: want 1 to 3 capital letters other than I and O", i, v.Code)
		}
	}
	if !ValidLetterCode(d.FallbackVoltageCode) {
		return fmt.Errorf("designations.fallback_voltage_code %q: want 1 to 3 capital letters other than I and O", d.FallbackVoltageCode)
	}
	for kind, u := range d.Units {
		if _, ok := DesignationUnitKinds[kind]; !ok {
			kinds := make([]string, 0, len(DesignationUnitKinds))
			for k := range DesignationUnitKinds {
				kinds = append(kinds, k)
			}
			slices.Sort(kinds)
			return fmt.Errorf("designations.units: unknown kind %q: want one of %s", kind, strings.Join(kinds, ", "))
		}
		if !ValidLetterCode(u.Code) {
			return fmt.Errorf("designations.units.%s: code %q: want 1 to 3 capital letters other than I and O", kind, u.Code)
		}
		if u.Digits < 0 || u.Digits > 3 {
			return fmt.Errorf("designations.units.%s: digits %d: want 0 to 3", kind, u.Digits)
		}
	}
	for kind := range DesignationUnitKinds {
		if _, ok := d.Units[kind]; !ok {
			return fmt.Errorf("designations.units: %s is missing", kind)
		}
	}
	return nil
}
