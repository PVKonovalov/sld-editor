package rsdu

import (
	"context"
	"errors"
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

	"sld-editor/internal/binding"
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
		{false, map[string]string{"1": "sub.svg", "2": "sub.svg", "3": "Sub-2.svg"}},
	} {
		dir := t.TempDir()
		cfg := config.RSDUBindings{}
		cfg.SVG.Dir, cfg.SVG.FullPath = dir, c.fullPath
		p := newProvider(cfg, mustDialect(t), fileNamesDB(files))
		p.sinks, _ = svgSinks(cfg)
		// Without full paths schemes 1 and 2 share sub.svg; each delivery writes it.
		for _, ref := range []string{"1", "2", "3"} {
			where, err := p.DeliverSVG(context.Background(), ref, []byte("<svg id='"+ref+"'/>"), false)
			want := filepath.Join(dir, filepath.FromSlash(c.want[ref]))
			if err != nil || !slices.Equal(where, []string{want}) {
				t.Fatalf("full_path %v, scheme %s: %v, %v; want %s", c.fullPath, ref, where, err, want)
			}
			if b, _ := os.ReadFile(want); string(b) != "<svg id='"+ref+"'/>" {
				t.Errorf("full_path %v, scheme %s: file holds %q", c.fullPath, ref, b)
			}
		}
		if _, err := p.DeliverSVG(context.Background(), "4", nil, false); err == nil {
			t.Errorf("full_path %v: a .sde file name was delivered", c.fullPath)
		}
		if _, err := p.DeliverSVG(context.Background(), "99", nil, false); err == nil {
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
	if where, err := p.DeliverSVG(context.Background(), "1", nil, false); where != nil || err != nil || len(db.queries) != 0 {
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
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		f.mu.Lock()
		b, ok := f.objects[r.URL.Path]
		f.mu.Unlock()
		if !ok {
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(http.StatusNotFound)
			if r.Method == http.MethodGet {
				_, _ = io.WriteString(w, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>no</Message></Error>`)
			}
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(b)))
		w.Header().Set("ETag", `"0"`)
		w.Header().Set("Last-Modified", "Mon, 02 Jan 2006 15:04:05 GMT")
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, b)
		}
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

// minioProvider is a provider of the schemes files that delivers to the folder dir (when set) and to s3's bucket "sld",
// with full paths.
func minioProvider(t *testing.T, s3 *fakeS3, dir string, files map[int64]string) *Provider {
	t.Helper()
	srv := httptest.NewServer(s3)
	t.Cleanup(srv.Close)
	cfg := config.RSDUBindings{}
	cfg.SVG.FullPath = true
	cfg.SVG.Dir = dir
	host, port, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))
	portNo, _ := strconv.Atoi(port)
	cfg.SVG.UseObjectStorage = "minio"
	cfg.SVG.ObjectStorage.Minio = config.Minio{Username: "u", Password: "p", Bucket: map[string]string{"sld": "sld"},
		Endpoint: []config.Endpoint{{Host: host, Port: portNo}}}
	p := newProvider(cfg, mustDialect(t), fileNamesDB(files))
	var err error
	if p.sinks, err = svgSinks(cfg); err != nil {
		t.Fatal(err)
	}
	return p
}

// TestDeliverSVGKeepsOriginal delivers twice with keep to a folder and a bucket that hold a picture already: the
// first delivery copies it to .orig.svg, the second leaves that copy alone. A place without a picture gets no copy.
func TestDeliverSVGKeepsOriginal(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	s3 := &fakeS3{objects: map[string]string{"/sld/north/sub.svg": "<svg>bucket</svg>"}, types: map[string]string{}}
	if err := os.MkdirAll(filepath.Join(dir, "north"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "north", "sub.svg"), []byte("<svg>folder</svg>"), 0o644); err != nil {
		t.Fatal(err)
	}
	p := minioProvider(t, s3, dir, map[int64]string{1: `north\sub.xsde`, 2: "south/new.svg"})
	for _, svg := range []string{"<svg>1</svg>", "<svg>2</svg>"} {
		if _, err := p.DeliverSVG(ctx, "1", []byte(svg), true); err != nil {
			t.Fatal(err)
		}
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "north", "sub.orig.svg")); string(b) != "<svg>folder</svg>" {
		t.Errorf("folder copy %q", b)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "north", "sub.svg")); string(b) != "<svg>2</svg>" {
		t.Errorf("folder picture %q", b)
	}
	if got := s3.objects["/sld/north/sub.orig.svg"]; got != "<svg>bucket</svg>" {
		t.Errorf("bucket copy %q (objects %v)", got, s3.objects)
	}
	if got := s3.objects["/sld/north/sub.svg"]; got != "<svg>2</svg>" {
		t.Errorf("bucket picture %q", got)
	}
	if _, err := p.DeliverSVG(ctx, "2", []byte("<svg/>"), true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "south", "new.orig.svg")); err == nil {
		t.Error("a copy was made of no picture")
	}
	if _, ok := s3.objects["/sld/south/new.orig.svg"]; ok {
		t.Error("a bucket copy was made of no picture")
	}
	if _, err := p.DeliverSVG(ctx, "2", []byte("<svg/>"), false); err != nil {
		t.Fatal(err)
	}
}

// TestFetchSVG reads a scheme's picture from the bucket first, then from the folder, and tells a missing picture and
// a missing place apart.
func TestFetchSVG(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	files := map[int64]string{1: `north\sub.xsde`, 2: "south/only-folder.svg", 3: "none.svg", 4: "bad.sde"}
	s3 := &fakeS3{objects: map[string]string{"/sld/north/sub.svg": "<svg>bucket</svg>"}, types: map[string]string{}}
	for f, b := range map[string]string{"north/sub.svg": "<svg>folder</svg>", "south/only-folder.svg": "<svg>south</svg>"} {
		target := filepath.Join(dir, filepath.FromSlash(f))
		_ = os.MkdirAll(filepath.Dir(target), 0o755)
		if err := os.WriteFile(target, []byte(b), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p := minioProvider(t, s3, dir, files)
	for ref, want := range map[string]string{"1": "<svg>bucket</svg>", "2": "<svg>south</svg>"} {
		got, err := p.FetchSVG(ctx, ref)
		if err != nil || string(got.SVG) != want || !got.FullPath || got.Scheme.Ref != ref {
			t.Errorf("scheme %s: %+v, %v; want %s", ref, got, err, want)
		}
	}
	if got, _ := p.FetchSVG(ctx, "1"); got == nil || got.File != "north/sub.svg" {
		t.Errorf("file %+v", got)
	}
	if _, err := p.FetchSVG(ctx, "3"); !errors.Is(err, binding.ErrNotFound) {
		t.Errorf("missing picture: %v", err)
	}
	if _, err := p.FetchSVG(ctx, "4"); !errors.Is(err, binding.ErrInvalid) {
		t.Errorf(".sde file name: %v", err)
	}
	if _, err := p.FetchSVG(ctx, "99"); !errors.Is(err, binding.ErrNotFound) {
		t.Errorf("missing scheme: %v", err)
	}
	none := newProvider(config.RSDUBindings{}, mustDialect(t), fileNamesDB(files))
	if _, err := none.FetchSVG(ctx, "1"); !errors.Is(err, binding.ErrNotConfigured) {
		t.Errorf("no place: %v", err)
	}
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
	where, err := p.DeliverSVG(context.Background(), "1", []byte("<svg/>"), false)
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
