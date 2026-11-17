package storage

import (
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/PVKonovalov/slddoc"
)

func linked(ref string) *slddoc.Diagram {
	return &slddoc.Diagram{Width: 10, Height: 10, Scheme: &slddoc.SchemeRef{Source: "rsdu", Ref: ref}}
}

func wantLinks(t *testing.T, s *Store, want map[string]string) {
	t.Helper()
	if got := s.LinkedDiagrams("rsdu"); !maps.Equal(got, want) {
		t.Errorf("links = %v, want %v", got, want)
	}
}

// Two diagrams with the same file name in different folders link different schemes; every file operation keeps
// the index right, and a restart rebuilds it from the files.
func TestSchemeIndex(t *testing.T) {
	s := newTestStore(t)
	for name, ref := range map[string]string{"north/sub-2": "101", "south/sub-2": "102", "plain": ""} {
		d := linked(ref)
		if ref == "" {
			d.Scheme = nil
		}
		if _, err := s.Create(name, d); err != nil {
			t.Fatal(err)
		}
	}
	wantLinks(t, s, map[string]string{"101": "north/sub-2", "102": "south/sub-2"})

	_, err := s.Save("plain", linked("101"))
	var taken *ErrSchemeLinked
	if !errors.As(err, &taken) || taken.Holder != "north/sub-2" {
		t.Fatalf("taken scheme: %v", err)
	}
	if _, err := s.Create("other", linked("102")); !errors.As(err, &taken) || taken.Holder != "south/sub-2" {
		t.Fatalf("taken scheme on create: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.dir, "other.xsld")); !os.IsNotExist(err) {
		t.Error("a refused create wrote the file")
	}
	if _, err := s.Save("north/sub-2", linked("101")); err != nil {
		t.Errorf("saving the holder again: %v", err)
	}

	if err := s.Rename("north/sub-2", "east/sub-2"); err != nil {
		t.Fatal(err)
	}
	if err := s.RenameDir("south", "west/old-south"); err != nil {
		t.Fatal(err)
	}
	wantLinks(t, s, map[string]string{"101": "east/sub-2", "102": "west/old-south/sub-2"})

	// Relinking: the old scheme is free again.
	if _, err := s.Save("east/sub-2", linked("103")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Save("plain", linked("101")); err != nil {
		t.Errorf("free scheme refused: %v", err)
	}
	// Unlinking.
	if _, err := s.Save("plain", &slddoc.Diagram{Width: 10, Height: 10}); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete("west/old-south/sub-2"); err != nil {
		t.Fatal(err)
	}
	wantLinks(t, s, map[string]string{"103": "east/sub-2"})
	if s.SchemeOf("east/sub-2").Ref != "103" || s.SchemeOf("plain") != nil {
		t.Error("SchemeOf")
	}

	again, err := New(s.dir, s.lib, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	wantLinks(t, again, map[string]string{"103": "east/sub-2"})
	if len(again.IndexWarnings()) != 0 {
		t.Errorf("warnings %v", again.IndexWarnings())
	}
}

func TestSchemeIndexDuplicatesAtStartup(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	head := `<diagram width="1" height="1"><scheme source="rsdu" ref="%s"/></diagram>`
	write("a/x.xsld", fmt.Sprintf(head, "7"))
	write("b/x.xsld", fmt.Sprintf(head, "7"))
	write("c.xsld", "<diagram><editor>")
	s, err := New(dir, slddoc.NewSymbolLibrary(nil), "", nil)
	if err != nil {
		t.Fatal(err)
	}
	wantLinks(t, s, map[string]string{"7": "a/x"})
	if len(s.IndexWarnings()) != 2 {
		t.Errorf("warnings %q", s.IndexWarnings())
	}
}

func TestListSchemeStatus(t *testing.T) {
	s := newTestStore(t)
	exported := linked("1")
	at := time.Now().Add(-time.Hour)
	exported.Scheme.Exported = &at
	for name, d := range map[string]*slddoc.Diagram{"new": linked("2"), "changed": exported, "none": {Width: 1, Height: 1}} {
		if _, err := s.Create(name, d); err != nil {
			t.Fatal(err)
		}
	}
	same := linked("3")
	ok := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	same.Scheme.Exported = &ok
	if _, err := s.Create("exported", same); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(filepath.Join(s.dir, "exported.xsld"), ok, ok); err != nil {
		t.Fatal(err)
	}
	entries, err := s.List("")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, e := range entries {
		got[e.Name] = e.SchemeStatus
	}
	want := map[string]string{"new": SchemeLinked, "changed": SchemeChanged, "exported": SchemeExported, "none": ""}
	if !maps.Equal(got, want) {
		t.Errorf("statuses %v, want %v", got, want)
	}
}

// TestSchemeIndexBuildTime reports how long indexing takes for many diagrams with long bodies.
func TestSchemeIndexBuildTime(t *testing.T) {
	if testing.Short() {
		t.Skip()
	}
	dir := t.TempDir()
	body := make([]byte, 0, 200<<10)
	body = append(body, `<diagram width="1" height="1"><editor grid="10"/><scheme source="rsdu" ref="%d"/><layers><layer id="0" name="Base"/></layers><elements>`...)
	for len(body) < 200<<10 {
		body = append(body, `<element id="1" class="Breaker" shape="41" layer="0" x="1" y="1"/>`...)
	}
	body = append(body, `</elements></diagram>`...)
	const n = 3000
	for i := range n {
		sub := filepath.Join(dir, fmt.Sprintf("f%d", i%30))
		_ = os.MkdirAll(sub, 0o755)
		if err := os.WriteFile(filepath.Join(sub, fmt.Sprintf("d%d.xsld", i)), fmt.Appendf(nil, string(body), i), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	start := time.Now()
	s, err := New(dir, slddoc.NewSymbolLibrary(nil), "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.LinkedDiagrams("rsdu")) != n {
		t.Fatalf("indexed %d", len(s.LinkedDiagrams("rsdu")))
	}
	t.Logf("indexed %d diagrams of %d KB in %v", n, len(body)>>10, time.Since(start))
}
