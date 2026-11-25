package config

import (
	"testing"

	"sld-editor/pkg/configuration"
)

func validDesignations() Designations {
	units := map[string]UnitCode{}
	for k := range DesignationUnitKinds {
		units[k] = UnitCode{Code: "N", Digits: 2}
	}
	return Designations{
		VoltageLevels:       []VoltageLevelCode{{MaxKV: 10, Code: "K"}, {MaxKV: 110, Code: "E"}},
		FallbackVoltageCode: "V",
		Units:               units,
	}
}

func TestValidateDesignations(t *testing.T) {
	for _, c := range []struct {
		name   string
		change func(d *Designations)
		ok     bool
	}{
		{"valid", func(*Designations) {}, true},
		{"descending", func(d *Designations) { d.VoltageLevels[1].MaxKV = 6 }, false},
		{"zero kV", func(d *Designations) { d.VoltageLevels[0].MaxKV = 0 }, false},
		{"letter O", func(d *Designations) { d.VoltageLevels[0].Code = "O" }, false},
		{"no fallback", func(d *Designations) { d.FallbackVoltageCode = "" }, false},
		{"unknown kind", func(d *Designations) { d.Units["feeder"] = UnitCode{Code: "H"} }, false},
		{"missing kind", func(d *Designations) { delete(d.Units, "busbar") }, false},
		{"lower case", func(d *Designations) { d.Units["busbar"] = UnitCode{Code: "w"} }, false},
		{"digits", func(d *Designations) { d.Units["busbar"] = UnitCode{Code: "W", Digits: 4} }, false},
	} {
		cfg := Config{Designations: validDesignations()}
		c.change(&cfg.Designations)
		if err := cfg.ValidateDesignations(); (err == nil) != c.ok {
			t.Errorf("%s: err %v", c.name, err)
		}
	}
}

// TestShippedDesignations checks the shipped configuration's designations load and validate.
func TestShippedDesignations(t *testing.T) {
	var cfg Config
	if err := configuration.ReadConfigFromYMLFile("../../config/sld-editor.example.yaml", &cfg); err != nil {
		t.Fatal(err)
	}
	d := cfg.Designations
	if err := cfg.ValidateDesignations(); err != nil || len(d.VoltageLevels) != 11 || d.Units["incoming_feeder"] != (UnitCode{Code: "N", Digits: 2}) {
		t.Errorf("designations = %+v, err %v", d, err)
	}
}
