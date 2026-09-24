package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/PVKonovalov/slddoc"
	"sld-editor/internal/config"
	"sld-editor/internal/elements"
	"sld-editor/internal/storage"
)

func newTestServer(t *testing.T) *Server {
	t.Helper()
	gin.SetMode(gin.TestMode)

	lib := &elements.Library{Symbols: []elements.Symbol{
		{Shape: "41", Class: "Breaker", Name: "Breaker", Template: `<path style="stroke:{color}"/>`},
	}}
	store, err := storage.New(t.TempDir(), lib.SymbolLibrary(), "", nil)
	if err != nil {
		t.Fatal(err)
	}

	cfg := &config.Config{}
	cfg.Editor.GridSpacing = 20
	cfg.Editor.Snap = true
	cfg.Editor.Background = "#12161d"
	cfg.VoltageColors = []config.VoltageColor{{Name: "10 kV", Color: "#962896"}}

	return NewServer(store, lib, cfg)
}

func doJSON(t *testing.T, s *Server, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(b)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func TestDiagramLifecycle(t *testing.T) {
	s := newTestServer(t)

	rec := doJSON(t, s, http.MethodPost, "/api/diagrams", createDiagramRequest{Name: "sub-1"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	rec = doJSON(t, s, http.MethodPost, "/api/diagrams", createDiagramRequest{Name: "sub-1"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("re-create: status = %d, want 409, body = %s", rec.Code, rec.Body.String())
	}

	rec = doJSON(t, s, http.MethodGet, "/api/diagrams", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: status = %d", rec.Code)
	}
	var entries []storage.Entry
	if err := json.Unmarshal(rec.Body.Bytes(), &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name != "sub-1" || entries[0].IsDir {
		t.Fatalf("list = %+v, want one diagram named sub-1", entries)
	}

	rec = doJSON(t, s, http.MethodGet, "/api/diagrams/open?name=sub-1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var d slddoc.Diagram
	if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil {
		t.Fatal(err)
	}
	d.Elements = append(d.Elements, slddoc.Element{ID: 1, Class: slddoc.ClassBreaker, Shape: "41", Layer: slddoc.BaseLayer, X: 5, Y: 5})

	rec = doJSON(t, s, http.MethodPut, "/api/diagrams/save?name=sub-1", d)
	if rec.Code != http.StatusOK {
		t.Fatalf("save: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	rec = doJSON(t, s, http.MethodGet, "/api/diagrams/svg?name=sub-1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("svg: status = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `id="1"`) {
		t.Errorf("rendered svg missing saved element: %s", rec.Body.String())
	}

	rec = doJSON(t, s, http.MethodGet, "/api/diagrams/open?name=missing", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("get missing: status = %d, want 404", rec.Code)
	}
}

// TestDiagramLifecycle_Subdirectory covers a name with a folder segment
// (e.g. "region1/sub-2") end to end through the HTTP layer — the one thing
// the old :name-path-segment routes could never do at all (Gin never
// matches a literal "/" inside a single :name segment), and the whole
// point of moving name to a query parameter.
func TestDiagramLifecycle_Subdirectory(t *testing.T) {
	s := newTestServer(t)

	rec := doJSON(t, s, http.MethodPost, "/api/diagrams", createDiagramRequest{Name: "region1/sub-2"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	rec = doJSON(t, s, http.MethodGet, "/api/diagrams", nil)
	var root []storage.Entry
	if err := json.Unmarshal(rec.Body.Bytes(), &root); err != nil {
		t.Fatal(err)
	}
	if len(root) != 1 || root[0].Name != "region1" || !root[0].IsDir {
		t.Fatalf("root list = %+v, want one subdirectory named region1", root)
	}

	rec = doJSON(t, s, http.MethodGet, "/api/diagrams?dir=region1", nil)
	var sub []storage.Entry
	if err := json.Unmarshal(rec.Body.Bytes(), &sub); err != nil {
		t.Fatal(err)
	}
	if len(sub) != 1 || sub[0].Name != "sub-2" || sub[0].IsDir {
		t.Fatalf("region1 list = %+v, want one diagram named sub-2", sub)
	}

	rec = doJSON(t, s, http.MethodGet, "/api/diagrams/open?name=region1/sub-2", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get: status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestRenderPreview_DoesNotPersist(t *testing.T) {
	s := newTestServer(t)
	d := slddoc.Diagram{
		Width: 10, Height: 10,
		Elements: []slddoc.Element{{ID: 1, Class: slddoc.ClassBreaker, Shape: "41", X: 1, Y: 1}},
	}

	rec := doJSON(t, s, http.MethodPost, "/api/render", d)
	if rec.Code != http.StatusOK {
		t.Fatalf("render: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		SVG string `json:"svg"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(resp.SVG, `id="1"`) {
		t.Errorf("preview svg missing element: %s", resp.SVG)
	}

	rec = doJSON(t, s, http.MethodGet, "/api/diagrams", nil)
	var entries []storage.Entry
	_ = json.Unmarshal(rec.Body.Bytes(), &entries)
	if len(entries) != 0 {
		t.Errorf("render preview should not persist a diagram: %+v", entries)
	}
}

// TestRenderPreviewFragments covers /api/render/fragments end to end: only
// the requested ids come back, an id no longer in the posted diagram is
// silently skipped (not an error), and nothing is persisted — the same
// "preview, never touches storage" contract /api/render itself has.
func TestRenderPreviewFragments(t *testing.T) {
	s := newTestServer(t)
	d := slddoc.Diagram{
		Width: 10, Height: 10,
		Elements: []slddoc.Element{
			{ID: 1, Class: slddoc.ClassBreaker, Shape: "41", X: 1, Y: 1},
			{ID: 2, Class: slddoc.ClassBreaker, Shape: "41", X: 2, Y: 2},
		},
	}

	rec := doJSON(t, s, http.MethodPost, "/api/render/fragments", gin.H{
		"diagram": d,
		"ids":     []int{1, 999},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("render fragments: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Fragments map[string]string `json:"fragments"`
		Warning   string            `json:"warning"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Warning != "" {
		t.Errorf("unexpected warning: %s", resp.Warning)
	}
	if len(resp.Fragments) != 1 {
		t.Fatalf("fragments = %+v, want exactly one entry (id 999 names nothing in the diagram)", resp.Fragments)
	}
	if !strings.Contains(resp.Fragments["1"], `id="1"`) {
		t.Errorf("fragment for id 1 missing its own id: %q", resp.Fragments["1"])
	}
	if _, ok := resp.Fragments["2"]; ok {
		t.Errorf("element 2 wasn't requested, should not be in the response: %+v", resp.Fragments)
	}

	rec = doJSON(t, s, http.MethodGet, "/api/diagrams", nil)
	var entries []storage.Entry
	_ = json.Unmarshal(rec.Body.Bytes(), &entries)
	if len(entries) != 0 {
		t.Errorf("render fragments should not persist a diagram: %+v", entries)
	}
}

func TestExportImportXML(t *testing.T) {
	s := newTestServer(t)
	d := slddoc.Diagram{
		Width: 10, Height: 10,
		Elements: []slddoc.Element{{ID: 1, Class: slddoc.ClassBreaker, Shape: "41", X: 1, Y: 1}},
	}

	rec := doJSON(t, s, http.MethodPost, "/api/export/xml", d)
	if rec.Code != http.StatusOK {
		t.Fatalf("export xml: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/xml" {
		t.Errorf("export xml: content-type = %q", ct)
	}
	xmlBody := rec.Body.Bytes()
	if !strings.Contains(string(xmlBody), `id="1"`) {
		t.Errorf("exported xml missing element: %s", xmlBody)
	}

	rec = doJSON(t, s, http.MethodPost, "/api/export/svg", d)
	if rec.Code != http.StatusOK {
		t.Fatalf("export svg: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/svg+xml" {
		t.Errorf("export svg: content-type = %q", ct)
	}
	if !strings.Contains(rec.Body.String(), `id="1"`) {
		t.Errorf("exported svg missing element: %s", rec.Body.String())
	}

	req := httptest.NewRequest(http.MethodPost, "/api/import/xml", bytes.NewReader(xmlBody))
	req.Header.Set("Content-Type", "application/xml")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("import xml: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var imported slddoc.Diagram
	if err := json.Unmarshal(rec.Body.Bytes(), &imported); err != nil {
		t.Fatal(err)
	}
	if len(imported.Elements) != 1 || imported.Elements[0].ID != 1 {
		t.Errorf("imported diagram = %+v, want one element with id 1", imported)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/import/xml", strings.NewReader("not xml"))
	req.Header.Set("Content-Type", "application/xml")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("import malformed xml: status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestImportDiagramSVG(t *testing.T) {
	s := newTestServer(t)

	svgBody := `<?xml version="1.0"?>
<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
<polyline points="10,40 300,40" style="fill:none;stroke:#962896;stroke-width:2" data-voltage="#962896" data-name="Bus" data-type="24" id="1" />
<g id="2" data-type="310"><rect x="0" y="0" width="10" height="10"/></g>
</svg>`
	req := httptest.NewRequest(http.MethodPost, "/api/import/svg", strings.NewReader(svgBody))
	req.Header.Set("Content-Type", "image/svg+xml")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("import svg: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Diagram slddoc.Diagram `json:"diagram"`
		Report  importReport   `json:"report"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Diagram.Elements) != 1 || resp.Diagram.Elements[0].ID != 1 {
		t.Errorf("imported elements = %+v, want the one busbar with id 1", resp.Diagram.Elements)
	}
	// The server's own "10 kV" preset (#962896) names the extracted class.
	if len(resp.Diagram.VoltageClasses) != 1 || resp.Diagram.VoltageClasses[0].Name != "10 kV" {
		t.Errorf("voltage classes = %+v, want one named from the 10 kV preset", resp.Diagram.VoltageClasses)
	}
	if len(resp.Report.Skipped) != 1 || resp.Report.Skipped[0] != (importSkippedEntry{Code: "310", Name: "Container", Count: 1}) {
		t.Errorf("report.skipped = %+v, want one 310 Container", resp.Report.Skipped)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/import/svg", strings.NewReader("<html/>"))
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("import non-svg: status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestRun_GracefulShutdown(t *testing.T) {
	s := newTestServer(t)

	// Reserve a free port, then release it immediately for Run's own
	// http.Server to bind — a small, accepted race in this pattern, but
	// the alternative (a fixed hardcoded port) risks colliding with a
	// concurrently running test or the developer's own dev server.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	if err := ln.Close(); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	runErr := make(chan error, 1)
	go func() { runErr <- s.Run(ctx, addr) }()

	deadline := time.Now().Add(2 * time.Second)
	for {
		conn, dialErr := net.Dial("tcp", addr)
		if dialErr == nil {
			conn.Close()
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("server never started listening on %s: %v", addr, dialErr)
		}
		time.Sleep(10 * time.Millisecond)
	}

	resp, err := http.Get("http://" + addr + "/api/config")
	if err != nil {
		t.Fatalf("request before shutdown: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	cancel()

	select {
	case err := <-runErr:
		if err != nil {
			t.Fatalf("Run returned error after graceful shutdown: %v", err)
		}
	case <-time.After(shutdownTimeout + 2*time.Second):
		t.Fatal("Run did not return after its context was cancelled")
	}

	if conn, dialErr := net.Dial("tcp", addr); dialErr == nil {
		conn.Close()
		t.Error("server still accepting connections after Run returned")
	}
}

func TestListElementsAndConfig(t *testing.T) {
	s := newTestServer(t)

	rec := doJSON(t, s, http.MethodGet, "/api/elements", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("elements: status = %d", rec.Code)
	}
	var syms []elements.Symbol
	if err := json.Unmarshal(rec.Body.Bytes(), &syms); err != nil {
		t.Fatal(err)
	}
	if len(syms) != 1 || syms[0].Shape != "41" {
		t.Errorf("elements = %+v, want the one configured Breaker symbol", syms)
	}

	rec = doJSON(t, s, http.MethodGet, "/api/config", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("config: status = %d", rec.Code)
	}
	var cfgResp struct {
		Editor        editorDefaults        `json:"editor"`
		VoltageColors []config.VoltageColor `json:"voltageColors"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &cfgResp); err != nil {
		t.Fatal(err)
	}
	if cfgResp.Editor.GridSpacing != 20 || !cfgResp.Editor.Snap {
		t.Errorf("editor defaults = %+v", cfgResp.Editor)
	}
	if len(cfgResp.VoltageColors) != 1 || cfgResp.VoltageColors[0].Color != "#962896" {
		t.Errorf("voltage colors = %+v", cfgResp.VoltageColors)
	}
}
