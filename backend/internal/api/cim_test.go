package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"github.com/PVKonovalov/slddoc"
)

func TestExportDiagramCIM(t *testing.T) {
	s := newTestServer(t)
	d := slddoc.Diagram{
		Width: 100, Height: 100,
		VoltageClasses: []slddoc.VoltageClass{{ID: 1, Name: "10 kV"}},
		Nodes:          []slddoc.Node{{ID: 2, X: 0, Y: 0}, {ID: 3, X: 0, Y: 50}},
		Connectors: []slddoc.Connector{{ID: 4, Kind: slddoc.KindCableLine, Voltage: 1, From: 2, To: 3,
			Points: []slddoc.Point{{X: 0, Y: 0}, {X: 0, Y: 50}}}},
	}
	rec := doJSON(t, s, http.MethodPost, "/api/export/cim?name=folder/Sub", d)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out cimExport
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Filename != "Sub_CGMES.zip" {
		t.Errorf("filename = %q", out.Filename)
	}
	if len(out.Warnings) != 1 || out.Warnings[0].ID != 4 || !slices.Equal(out.Warnings[0].Fields, []string{"r", "x", "bch", "length"}) {
		t.Errorf("warnings = %+v", out.Warnings)
	}
	zr, err := zip.NewReader(bytes.NewReader(out.File), int64(len(out.File)))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	if !slices.Equal(names, []string{"Sub_EQ.xml", "Sub_DL.xml"}) {
		t.Errorf("zip entries = %v", names)
	}
}
