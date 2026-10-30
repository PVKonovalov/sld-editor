package config

import "testing"

func TestValidateVoltageOrder(t *testing.T) {
	for _, c := range []struct {
		in, want string
		ok       bool
	}{
		{"", VoltageAscending, true},
		{VoltageAscending, VoltageAscending, true},
		{VoltageDescending, VoltageDescending, true},
		{"numeric", "numeric", false},
	} {
		var cfg Config
		cfg.Editor.VoltageOrder = c.in
		err := cfg.ValidateVoltageOrder()
		if (err == nil) != c.ok || cfg.Editor.VoltageOrder != c.want {
			t.Errorf("%q: order %q, err %v", c.in, cfg.Editor.VoltageOrder, err)
		}
	}
}
