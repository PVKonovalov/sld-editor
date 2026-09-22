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
		{Shape: "41", Class: "Breaker", Name: "Breaker", Category: "Switching devices", Template: `<path style="stroke:{color}"/>`},
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
	var infos []storage.Info
	if err := json.Unmarshal(rec.Body.Bytes(), &infos); err != nil {
		t.Fatal(err)
	}
	if len(infos) != 1 || infos[0].Name != "sub-1" {
		t.Fatalf("list = %+v, want one diagram named sub-1", infos)
	}

	rec = doJSON(t, s, http.MethodGet, "/api/diagrams/sub-1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var d slddoc.Diagram
	if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil {
		t.Fatal(err)
	}
	d.Elements = append(d.Elements, slddoc.Element{ID: 1, Class: slddoc.ClassBreaker, Shape: "41", Layer: slddoc.BaseLayer, X: 5, Y: 5})

	rec = doJSON(t, s, http.MethodPut, "/api/diagrams/sub-1", d)
	if rec.Code != http.StatusOK {
		t.Fatalf("save: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	rec = doJSON(t, s, http.MethodGet, "/api/diagrams/sub-1/svg", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("svg: status = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `id="1"`) {
		t.Errorf("rendered svg missing saved element: %s", rec.Body.String())
	}

	rec = doJSON(t, s, http.MethodGet, "/api/diagrams/missing", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("get missing: status = %d, want 404", rec.Code)
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
	var infos []storage.Info
	_ = json.Unmarshal(rec.Body.Bytes(), &infos)
	if len(infos) != 0 {
		t.Errorf("render preview should not persist a diagram: %+v", infos)
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
