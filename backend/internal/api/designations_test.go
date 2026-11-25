package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/config"
)

func TestPlanDesignations(t *testing.T) {
	s := newTestServer(t)
	s.cfg.LetterCodes = map[string]string{"41": "QA", "24": "WC"}
	s.cfg.Designations = config.Designations{
		VoltageLevels:       []config.VoltageLevelCode{{MaxKV: 10, Code: "K"}},
		FallbackVoltageCode: "V",
		Units:               map[string]config.UnitCode{},
	}
	for k := range config.DesignationUnitKinds {
		s.cfg.Designations.Units[k] = config.UnitCode{Code: "H", Digits: 2}
	}
	s.cfg.Designations.Units["busbar"] = config.UnitCode{Code: "W"}
	d := slddoc.Diagram{
		VoltageClasses: []slddoc.VoltageClass{{ID: 1, Name: "10 kV", Color: "#962896"}},
		Nodes:          []slddoc.Node{{ID: 2, X: 100, Y: 100}, {ID: 3, X: 100, Y: 140}},
		Elements: []slddoc.Element{
			{ID: 4, Class: slddoc.ClassBusBarSection, Shape: "24", Voltage: 1, Ports: []slddoc.Port{{Name: "1", Node: 2}},
				Points: []slddoc.Point{{X: 0, Y: 100}, {X: 200, Y: 100}}},
			{ID: 5, Class: slddoc.ClassBreaker, Shape: "41", Voltage: 1, X: 100, Y: 120,
				Ports: []slddoc.Port{{Name: "1", Node: 2}, {Name: "2", Node: 3}}},
		},
		LastID: 5,
	}
	rec := doJSON(t, s, http.MethodPost, "/api/designations", designationRequest{Diagram: d})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var plan slddoc.DesignationPlan
	if err := json.Unmarshal(rec.Body.Bytes(), &plan); err != nil {
		t.Fatal(err)
	}
	got := map[int]string{}
	for _, r := range plan.Rows {
		got[r.Element] = r.Name
	}
	if got[4] != "=K1=W1-WC1" || got[5] != "=K1=H01-QA1" || len(plan.Functions) != 3 {
		t.Errorf("plan = %+v", plan)
	}
}

func TestPlanDesignations_LevelMembers(t *testing.T) {
	s := newTestServer(t)
	s.cfg.LetterCodes = map[string]string{"41": "QA"}
	s.cfg.Designations = config.Designations{
		VoltageLevels:       []config.VoltageLevelCode{{MaxKV: 10, Code: "K"}},
		FallbackVoltageCode: "V",
		Units:               map[string]config.UnitCode{},
	}
	for k := range config.DesignationUnitKinds {
		s.cfg.Designations.Units[k] = config.UnitCode{Code: "H", Digits: 2}
	}
	d := slddoc.Diagram{
		VoltageClasses: []slddoc.VoltageClass{{ID: 1, Name: "10 kV", Color: "#962896"}},
		Nodes:          []slddoc.Node{{ID: 2, X: 100, Y: 100}, {ID: 3, X: 100, Y: 140}},
		Elements: []slddoc.Element{
			{ID: 4, Class: slddoc.ClassBusBarSection, Shape: "24", Voltage: 1, Ports: []slddoc.Port{{Name: "1", Node: 2}},
				Points: []slddoc.Point{{X: 0, Y: 100}, {X: 200, Y: 100}}},
			{ID: 5, Class: slddoc.ClassBreaker, Shape: "41", Voltage: 1, X: 100, Y: 120,
				Ports: []slddoc.Port{{Name: "1", Node: 2}, {Name: "2", Node: 3}}},
		},
		LastID: 5,
	}
	rec := doJSON(t, s, http.MethodPost, "/api/designations", designationRequest{Diagram: d})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var plan slddoc.DesignationPlan
	if err := json.Unmarshal(rec.Body.Bytes(), &plan); err != nil {
		t.Fatal(err)
	}
	if len(plan.Levels) != 1 || plan.Levels[0].Element != 4 || slddoc.FunctionDesignation(plan.Functions, plan.Levels[0].Function) != "=K1" {
		t.Errorf("the busbar should lie in =K1: %+v", plan)
	}
}
