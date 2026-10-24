package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"encoding/xml"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/PVKonovalov/slddoc"
	"github.com/gin-gonic/gin"
	"sld-editor/internal/config"
	"sld-editor/internal/elements"
	"sld-editor/internal/storage"
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

// TestCIMRoundTrip exports the bundled custom element to CIM and imports it back: the same devices, by name and
// class, come back with the same connections.
func TestCIMRoundTrip(t *testing.T) {
	gin.SetMode(gin.TestMode)
	lib, err := elements.LoadAll([]string{"../../assets/elements/base.xml"})
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.New(t.TempDir(), lib.SymbolLibrary(), "", nil)
	if err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{}
	cfg.Editor.GridSpacing = 10
	s := NewServer(store, store, lib, cfg)

	f, err := os.Open("../../../custom-elements/CB.xsld")
	if err != nil {
		t.Fatal(err)
	}
	orig, err := slddoc.Load(f)
	f.Close()
	if err != nil {
		t.Fatal(err)
	}
	slddoc.Repair(orig, lib.Terminals())

	rec := doJSON(t, s, http.MethodPost, "/api/export/cim?name=CB", orig)
	var exported cimExport
	if err := json.Unmarshal(rec.Body.Bytes(), &exported); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/import/cim", bytes.NewReader(exported.File))
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("import: status %d, body %s", rec.Code, rec.Body.String())
	}
	var imported struct {
		Pages []struct {
			Diagram *slddoc.Diagram `json:"diagram"`
		} `json:"pages"`
		Messages []cimMessage `json:"messages"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &imported); err != nil {
		t.Fatal(err)
	}
	if len(imported.Pages) != 1 {
		t.Fatalf("pages = %d", len(imported.Pages))
	}
	if len(imported.Messages) != 0 {
		t.Errorf("an own export should need no guessing: %+v", imported.Messages)
	}
	back := imported.Pages[0].Diagram
	a, b := connections(t, orig), connections(t, back)
	if len(a) < 3 {
		t.Fatalf("too few connections to compare: %v", a)
	}
	if !slices.Equal(a, b) {
		t.Errorf("connections differ:\n%v\n%v", a, b)
	}
}

// connections lists, for each ConnectivityNode of d's CIM export, the sorted "name/class/terminal" of the devices
// on it; the list itself is sorted.
func connections(t *testing.T, d *slddoc.Diagram) []string {
	t.Helper()
	eq := slddoc.ExportCIM(d, slddoc.CIMOptions{Name: "t"}).EQ
	type object struct {
		class string
		props map[string]string
	}
	objs := map[string]*object{}
	var order []string
	dec := xml.NewDecoder(bytes.NewReader(eq))
	var cur *object
	var prop string
	depth := 0
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		switch tk := tok.(type) {
		case xml.StartElement:
			depth++
			if depth == 2 {
				cur = &object{class: tk.Name.Local, props: map[string]string{}}
				for _, a := range tk.Attr {
					if a.Name.Local == "ID" {
						objs[a.Value] = cur
						order = append(order, a.Value)
					}
				}
			} else if depth == 3 {
				prop = tk.Name.Local
				for _, a := range tk.Attr {
					if a.Name.Local == "resource" {
						cur.props[prop] = strings.TrimPrefix(a.Value, "#")
					}
				}
			}
		case xml.CharData:
			if depth == 3 && strings.TrimSpace(string(tk)) != "" {
				cur.props[prop] = string(tk)
			}
		case xml.EndElement:
			depth--
		}
	}
	nodes := map[string][]string{}
	for _, id := range order {
		o := objs[id]
		if o.class != "Terminal" {
			continue
		}
		eq := objs[o.props["Terminal.ConductingEquipment"]]
		key := eq.props["IdentifiedObject.name"] + "/" + eq.class + "/" + o.props["ACDCTerminal.sequenceNumber"]
		cn := o.props["Terminal.ConnectivityNode"]
		nodes[cn] = append(nodes[cn], key)
	}
	var out []string
	for _, keys := range nodes {
		slices.Sort(keys)
		out = append(out, strings.Join(keys, ","))
	}
	slices.Sort(out)
	return out
}

// TestCIMDocumentsSkipsHidden reads a zip as macOS Finder makes it: the "._" files beside each document are skipped.
func TestCIMDocumentsSkipsHidden(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, data := range map[string]string{
		"Model/EQ.xml":             "<rdf:RDF/>",
		"Model/notes.txt":          "notes",
		"Model/.hidden.xml":        "\x00",
		"__MACOSX/Model/._EQ.xml":  "\x00\x05\x16\x07",
		"__MACOSX/Model/other.xml": "\x00",
		"Model/sub/DL.rdf":         "<rdf:RDF></rdf:RDF>",
	} {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	docs, err := cimDocuments(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, d := range docs {
		got = append(got, string(d))
	}
	slices.Sort(got)
	if want := []string{"<rdf:RDF/>", "<rdf:RDF></rdf:RDF>"}; !slices.Equal(got, want) {
		t.Errorf("documents = %q, want %q", got, want)
	}
}
