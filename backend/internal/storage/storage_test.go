package storage

import (
	"os"
	"path/filepath"
	"testing"

	"sld-editor/internal/slddoc"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	lib := slddoc.NewSymbolLibrary(map[string]string{
		"41": `<path d="M 0 0" style="stroke:{color}"/>`,
	})
	s, err := New(t.TempDir(), lib)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestCreateSaveLoad(t *testing.T) {
	s := newTestStore(t)
	d := &slddoc.Diagram{Width: 100, Height: 100}

	if warn, err := s.Create("substation-1", d); err != nil {
		t.Fatalf("Create: %v (warning: %v)", err, warn)
	}

	if _, err := s.Create("substation-1", d); err != ErrExists {
		t.Fatalf("Create of an existing name = %v, want ErrExists", err)
	}

	got, err := s.Load("substation-1")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.Width != 100 {
		t.Errorf("Width = %v, want 100", got.Width)
	}

	if _, err := os.Stat(filepath.Join(s.dir, "substation-1.svg")); err != nil {
		t.Errorf("expected a companion .svg to be written: %v", err)
	}
}

func TestLoad_NotFound(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Load("missing"); err != ErrNotFound {
		t.Fatalf("Load(missing) = %v, want ErrNotFound", err)
	}
}

func TestSave_ReportsMissingShapeWithoutFailing(t *testing.T) {
	s := newTestStore(t)
	d := &slddoc.Diagram{
		Width: 10, Height: 10,
		Elements: []slddoc.Element{{ID: 1, Class: slddoc.ClassBreaker, Shape: "999", X: 1, Y: 1}},
	}

	warn, err := s.Save("has-gap", d)
	if err != nil {
		t.Fatalf("Save should not fail for a missing shape: %v", err)
	}
	if warn == nil {
		t.Fatal("expected a render warning naming the missing shape")
	}

	if _, err := s.Load("has-gap"); err != nil {
		t.Fatalf("diagram XML should still be saved and loadable: %v", err)
	}
}

func TestList_OrdersMostRecentFirst(t *testing.T) {
	s := newTestStore(t)
	d := &slddoc.Diagram{Width: 1, Height: 1}
	if _, err := s.Create("first", d); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create("second", d); err != nil {
		t.Fatal(err)
	}

	infos, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(infos) != 2 || infos[0].Name != "second" {
		t.Errorf("List() = %+v, want [second, first]", infos)
	}
}

func TestSafeName_RejectsPathTraversal(t *testing.T) {
	s := newTestStore(t)
	for _, name := range []string{"", "../escape", "a/b", `a\b`, " padded", "padded "} {
		if _, err := s.xmlPath(name); err == nil {
			t.Errorf("xmlPath(%q) should be rejected", name)
		}
	}
}
