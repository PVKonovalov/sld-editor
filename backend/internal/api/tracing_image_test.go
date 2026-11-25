package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PVKonovalov/slddoc"
)

func TestTracingImageAPI(t *testing.T) {
	s := newTestServer(t)
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
	put := func(name string, body []byte) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPut, "/api/diagrams/tracing-image?name="+name, bytes.NewReader(body))
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		return rec
	}
	if rec := put("a", png); rec.Code != http.StatusNotFound {
		t.Fatalf("missing diagram: status %d", rec.Code)
	}
	if rec := doJSON(t, s, http.MethodPost, "/api/diagrams", createDiagramRequest{Name: "a"}); rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	if rec := put("a", []byte("plain text")); rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("text: status %d", rec.Code)
	}
	rec := put("a", png)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"a.tracing.png"`)) {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}

	req := httptest.NewRequest(http.MethodGet, "/api/diagrams/tracing-image?name=a&v=1", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), png) {
		t.Fatalf("get: %d", rec.Code)
	}

	d := slddoc.Diagram{Width: 10, Height: 10, TracingImage: &slddoc.TracingImage{File: "a.tracing.png", Width: 10, Height: 10, Opacity: 0.5}}
	if rec := doJSON(t, s, http.MethodPut, "/api/diagrams/save?name=b&from=a", d); rec.Code != http.StatusOK {
		t.Fatalf("save as: %d %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(t, s, http.MethodGet, "/api/diagrams/open?name=b", nil)
	var opened struct{ Diagram slddoc.Diagram }
	if err := json.Unmarshal(rec.Body.Bytes(), &opened); err != nil {
		t.Fatal(err)
	}
	if ti := opened.Diagram.TracingImage; ti == nil || ti.File != "b.tracing.png" || ti.Opacity != 0.5 {
		t.Errorf("saved as b: tracing image %+v", ti)
	}
}
