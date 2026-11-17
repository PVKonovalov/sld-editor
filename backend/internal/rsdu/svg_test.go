package rsdu

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"

	"sld-editor/internal/config"
)

// fileNamesDB answers a scheme by id, or all of them, with its file name.
func fileNamesDB(files map[int64]string) *fakeDB {
	return &fakeDB{rows: func(q string, args []any) [][]any {
		if !strings.Contains(q, "FROM rsduadmin.VS_FORM f") {
			return nil
		}
		if len(args) == 0 {
			var all [][]any
			for id, f := range files {
				all = append(all, []any{id, int64(2), int64(518), "S", nil, "MODUS", f, nil})
			}
			return all
		}
		id := args[0].(int64)
		if f, ok := files[id]; ok {
			return [][]any{{id, int64(2), int64(518), "S", nil, "MODUS", f, nil}}
		}
		return nil
	}}
}

func TestDeliverSVG(t *testing.T) {
	files := map[int64]string{1: `C:\Modus\north\sub.xsde`, 2: "south/sub.svg", 3: "north/Sub-2.SVG", 4: "bad.sde"}
	for _, c := range []struct {
		fullPath bool
		want     map[string]string
	}{
		{true, map[string]string{"1": "C:/Modus/north/sub.svg", "2": "south/sub.svg", "3": "north/Sub-2.svg"}},
		{false, map[string]string{"3": "Sub-2.svg"}},
	} {
		dir := t.TempDir()
		cfg := config.RSDUBindings{}
		cfg.SVG.Dir, cfg.SVG.FullPath = dir, c.fullPath
		p := newProvider(cfg, mustDialect(t), fileNamesDB(files))
		p.sinks, _ = svgSinks(cfg)
		for _, ref := range []string{"1", "2", "3"} {
			if c.want[ref] == "" {
				if _, err := p.DeliverSVG(context.Background(), ref, nil); err == nil || !strings.Contains(err.Error(), "also the SVG of") {
					t.Errorf("full_path %v, scheme %s: a shared file name was delivered: %v", c.fullPath, ref, err)
				}
				continue
			}
			where, err := p.DeliverSVG(context.Background(), ref, []byte("<svg id='"+ref+"'/>"))
			want := filepath.Join(dir, filepath.FromSlash(c.want[ref]))
			if err != nil || !slices.Equal(where, []string{want}) {
				t.Fatalf("full_path %v, scheme %s: %v, %v; want %s", c.fullPath, ref, where, err, want)
			}
			if b, _ := os.ReadFile(want); string(b) != "<svg id='"+ref+"'/>" {
				t.Errorf("full_path %v, scheme %s: file holds %q", c.fullPath, ref, b)
			}
		}
		if _, err := p.DeliverSVG(context.Background(), "4", nil); err == nil {
			t.Errorf("full_path %v: a .sde file name was delivered", c.fullPath)
		}
		if _, err := p.DeliverSVG(context.Background(), "99", nil); err == nil {
			t.Errorf("full_path %v: a missing scheme was delivered", c.fullPath)
		}
		left, _ := filepath.Glob(filepath.Join(dir, "*.tmp"))
		if len(left) > 0 {
			t.Errorf("temporary files left: %v", left)
		}
	}

	// No destination configured: nothing is delivered and RSDU is not asked.
	db := fileNamesDB(files)
	p := newProvider(config.RSDUBindings{}, mustDialect(t), db)
	if where, err := p.DeliverSVG(context.Background(), "1", nil); where != nil || err != nil || len(db.queries) != 0 {
		t.Errorf("no destination: %v, %v, %d queries", where, err, len(db.queries))
	}
}

// fakeS3 keeps the objects put to it; it answers a bucket location request as us-east-1.
type fakeS3 struct {
	mu      sync.Mutex
	objects map[string]string
	types   map[string]string
}

func (f *fakeS3) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if _, ok := r.URL.Query()["location"]; ok {
		w.Header().Set("Content-Type", "application/xml")
		_, _ = io.WriteString(w, `<?xml version="1.0" encoding="UTF-8"?><LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">us-east-1</LocationConstraint>`)
		return
	}
	if r.Method != http.MethodPut {
		http.Error(w, "unexpected", http.StatusBadRequest)
		return
	}
	if strings.Contains(r.Header.Get("X-Amz-Content-Sha256"), "STREAMING") {
		http.Error(w, "signed aws-chunked payloads are not implemented", http.StatusNotImplemented)
		return
	}
	b, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	f.objects[r.URL.Path] = string(b)
	f.types[r.URL.Path] = r.Header.Get("Content-Type")
	f.mu.Unlock()
	w.Header().Set("ETag", `"0"`)
}

func TestDeliverSVGMinio(t *testing.T) {
	s3 := &fakeS3{objects: map[string]string{}, types: map[string]string{}}
	srv := httptest.NewServer(s3)
	defer srv.Close()
	cfg := config.RSDUBindings{}
	cfg.SVG.FullPath = true
	cfg.SVG.Dir = t.TempDir()
	host, port, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))
	portNo, _ := strconv.Atoi(port)
	cfg.SVG.UseObjectStorage = "minio"
	cfg.SVG.ObjectStorage.Minio = config.Minio{Username: "u", Password: "p", Bucket: map[string]string{"sld": "sld"},
		Endpoint: []config.Endpoint{{Host: host, Port: portNo}}}
	p := newProvider(cfg, mustDialect(t), fileNamesDB(map[int64]string{1: `north\sub.xsde`}))
	var err error
	if p.sinks, err = svgSinks(cfg); err != nil {
		t.Fatal(err)
	}
	where, err := p.DeliverSVG(context.Background(), "1", []byte("<svg/>"))
	if err != nil || len(where) != 2 || where[1] != "minio:sld/north/sub.svg" {
		t.Fatalf("%v, %v", where, err)
	}
	if got := s3.objects["/sld/north/sub.svg"]; got != "<svg/>" || s3.types["/sld/north/sub.svg"] != "image/svg+xml" {
		t.Errorf("objects %v, types %v", s3.objects, s3.types)
	}
}

func mustDialect(t *testing.T) Dialect {
	t.Helper()
	d, err := NewDialect(config.DriverPostgres, "")
	if err != nil {
		t.Fatal(err)
	}
	return d
}
