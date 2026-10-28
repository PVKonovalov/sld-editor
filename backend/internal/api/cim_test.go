package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"encoding/xml"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/PVKonovalov/slddoc"
	"github.com/gin-gonic/gin"
	"sld-editor/internal/config"
	"sld-editor/internal/elements"
	"sld-editor/internal/storage"
	"sld-editor/pkg/configuration"
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
// newCIMTestServer is a server with the shipped element library and the shipped configuration's cim mapping.
func newCIMTestServer(t *testing.T) (*Server, *elements.Library) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	lib, err := elements.LoadAll([]string{"../../assets/elements/base.xml"})
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.New(t.TempDir(), lib.SymbolLibrary(), "", nil)
	if err != nil {
		t.Fatal(err)
	}
	var shipped config.Config
	if err := configuration.ReadConfigFromYMLFile("../../config/sld-editor.yaml", &shipped); err != nil {
		t.Fatal(err)
	}
	if _, unlisted, err := slddoc.NewCIMClassTable(lib.Classes(), shipped.CIM.Classes, shipped.CIM.Import); err != nil || len(unlisted) > 0 {
		t.Fatalf("shipped cim configuration: %v, unlisted %v", err, unlisted)
	}
	cfg := &config.Config{}
	cfg.Editor.GridSpacing = 10
	cfg.CIM = shipped.CIM
	return NewServer(store, store, lib, cfg), lib
}

func TestCIMRoundTrip(t *testing.T) {
	s, lib := newCIMTestServer(t)

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
		Messages      []cimMessage `json:"messages"`
		ForeignLayout bool         `json:"foreignLayout"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &imported); err != nil {
		t.Fatal(err)
	}
	if imported.ForeignLayout {
		t.Error("an own export's layout is not foreign")
	}
	if len(imported.Pages) != 1 {
		t.Fatalf("pages = %d", len(imported.Pages))
	}
	if len(imported.Messages) != 0 {
		t.Errorf("an own export should need no guessing: %+v", imported.Messages)
	}
	back := imported.Pages[0].Diagram
	a, b := connections(t, s, orig), connections(t, s, back)
	if len(a) < 3 {
		t.Fatalf("too few connections to compare: %v", a)
	}
	if !slices.Equal(a, b) {
		t.Errorf("connections differ:\n%v\n%v", a, b)
	}

	// Laid out automatically instead of as drawn: the same connections.
	req = httptest.NewRequest(http.MethodPost, "/api/import/cim?layout=auto", bytes.NewReader(exported.File))
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("auto import: status %d, body %s", rec.Code, rec.Body.String())
	}
	imported.Pages = nil
	if err := json.Unmarshal(rec.Body.Bytes(), &imported); err != nil {
		t.Fatal(err)
	}
	if len(imported.Pages) != 1 {
		t.Fatalf("auto pages = %d", len(imported.Pages))
	}
	if auto := connections(t, s, imported.Pages[0].Diagram); !slices.Equal(a, auto) {
		t.Errorf("auto layout connections differ:\n%v\n%v", a, auto)
	}
}

// connections lists, for each ConnectivityNode of d's CIM export, the sorted "name/class/terminal" of the devices
// on it; the list itself is sorted.
func connections(t *testing.T, s *Server, d *slddoc.Diagram) []string {
	t.Helper()
	eq := slddoc.ExportCIM(d, slddoc.CIMOptions{Name: "t", Classes: s.cimClasses}).EQ
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

// sameVoltageCIM is a substation whose transformer writes one base voltage for both its ends, each on a busbar.
const sameVoltageCIM = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/CIM100#">
<cim:BaseVoltage rdf:ID="_bv"><cim:BaseVoltage.nominalVoltage>33</cim:BaseVoltage.nominalVoltage></cim:BaseVoltage>
<cim:Substation rdf:ID="_s"><cim:IdentifiedObject.name>S</cim:IdentifiedObject.name></cim:Substation>
<cim:VoltageLevel rdf:ID="_v"><cim:VoltageLevel.Substation rdf:resource="#_s"/><cim:VoltageLevel.BaseVoltage rdf:resource="#_bv"/></cim:VoltageLevel>
<cim:ConnectivityNode rdf:ID="_n1"><cim:ConnectivityNode.ConnectivityNodeContainer rdf:resource="#_v"/></cim:ConnectivityNode>
<cim:ConnectivityNode rdf:ID="_n2"><cim:ConnectivityNode.ConnectivityNodeContainer rdf:resource="#_v"/></cim:ConnectivityNode>
<cim:BusbarSection rdf:ID="_b1"><cim:IdentifiedObject.name>B1</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_v"/></cim:BusbarSection>
<cim:Terminal rdf:ID="_tb1"><cim:Terminal.ConductingEquipment rdf:resource="#_b1"/><cim:Terminal.ConnectivityNode rdf:resource="#_n1"/></cim:Terminal>
<cim:BusbarSection rdf:ID="_b2"><cim:IdentifiedObject.name>B2</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_v"/></cim:BusbarSection>
<cim:Terminal rdf:ID="_tb2"><cim:Terminal.ConductingEquipment rdf:resource="#_b2"/><cim:Terminal.ConnectivityNode rdf:resource="#_n2"/></cim:Terminal>
<cim:PowerTransformer rdf:ID="_t"><cim:IdentifiedObject.name>T</cim:IdentifiedObject.name><cim:Equipment.EquipmentContainer rdf:resource="#_s"/></cim:PowerTransformer>
<cim:Terminal rdf:ID="_tt1"><cim:Terminal.ConductingEquipment rdf:resource="#_t"/><cim:Terminal.ConnectivityNode rdf:resource="#_n1"/><cim:ACDCTerminal.sequenceNumber>1</cim:ACDCTerminal.sequenceNumber></cim:Terminal>
<cim:Terminal rdf:ID="_tt2"><cim:Terminal.ConductingEquipment rdf:resource="#_t"/><cim:Terminal.ConnectivityNode rdf:resource="#_n2"/><cim:ACDCTerminal.sequenceNumber>2</cim:ACDCTerminal.sequenceNumber></cim:Terminal>
<cim:PowerTransformerEnd rdf:ID="_e1"><cim:TransformerEnd.endNumber>1</cim:TransformerEnd.endNumber><cim:PowerTransformerEnd.PowerTransformer rdf:resource="#_t"/><cim:TransformerEnd.Terminal rdf:resource="#_tt1"/><cim:TransformerEnd.BaseVoltage rdf:resource="#_bv"/></cim:PowerTransformerEnd>
<cim:PowerTransformerEnd rdf:ID="_e2"><cim:TransformerEnd.endNumber>2</cim:TransformerEnd.endNumber><cim:PowerTransformerEnd.PowerTransformer rdf:resource="#_t"/><cim:TransformerEnd.Terminal rdf:resource="#_tt2"/><cim:TransformerEnd.BaseVoltage rdf:resource="#_bv"/></cim:PowerTransformerEnd>
</rdf:RDF>`

func TestImportCIMWindingVoltages(t *testing.T) {
	s, _ := newCIMTestServer(t)
	post := func(query string) (int, struct {
		Pages []struct {
			Diagram *slddoc.Diagram `json:"diagram"`
		} `json:"pages"`
		Same []slddoc.CIMSameVoltageTransformer `json:"sameVoltageTransformers"`
	}) {
		req := httptest.NewRequest(http.MethodPost, "/api/import/cim"+query, strings.NewReader(sameVoltageCIM))
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		var out struct {
			Pages []struct {
				Diagram *slddoc.Diagram `json:"diagram"`
			} `json:"pages"`
			Same []slddoc.CIMSameVoltageTransformer `json:"sameVoltageTransformers"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	classes := func(d *slddoc.Diagram) []string {
		var names []string
		for _, vc := range d.VoltageClasses {
			names = append(names, vc.Name)
		}
		slices.Sort(names)
		return names
	}

	code, asked := post("")
	if code != http.StatusOK || len(asked.Pages) != 0 || len(asked.Same) != 1 || len(asked.Same[0].Windings) != 2 {
		t.Fatalf("ask: %d %+v", code, asked)
	}
	code, kept := post("?windings=%7B%7D")
	if code != http.StatusOK || len(kept.Pages) != 1 || !slices.Equal(classes(kept.Pages[0].Diagram), []string{"33 kV"}) {
		t.Fatalf("keep: %d %+v", code, kept)
	}
	code, set := post("?windings=" + url.QueryEscape(`{"e2": 11}`))
	if code != http.StatusOK || len(set.Pages) != 1 || !slices.Equal(classes(set.Pages[0].Diagram), []string{"11 kV", "33 kV"}) {
		t.Fatalf("set: %d %+v", code, set)
	}
	if code, _ := post("?windings=oops"); code != http.StatusBadRequest {
		t.Errorf("bad windings: status %d", code)
	}
}
