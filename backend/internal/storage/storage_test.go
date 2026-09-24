package storage

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/PVKonovalov/slddoc"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	lib := slddoc.NewSymbolLibrary(map[string]string{
		"41": `<path d="M 0 0" style="stroke:{color}"/>`,
	})
	s, err := New(t.TempDir(), lib, "", nil)
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

	if _, err := os.Stat(filepath.Join(s.dir, "substation-1.xsld")); err != nil {
		t.Errorf("expected the diagram to be written as .xsld: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.dir, "substation-1.svg")); err != nil {
		t.Errorf("expected a companion .svg to be written: %v", err)
	}
}

func TestList_IgnoresLegacyXML(t *testing.T) {
	s := newTestStore(t)
	if err := os.WriteFile(filepath.Join(s.dir, "old.xml"), []byte("<diagram/>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create("new", &slddoc.Diagram{Width: 1, Height: 1}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	entries, err := s.List("")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 1 || entries[0].Name != "new" {
		t.Errorf("List = %+v, want only the .xsld diagram \"new\"", entries)
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

func TestList_OrdersAlphabetically(t *testing.T) {
	s := newTestStore(t)
	d := &slddoc.Diagram{Width: 1, Height: 1}
	if _, err := s.Create("second", d); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create("first", d); err != nil {
		t.Fatal(err)
	}

	entries, err := s.List("")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].Name != "first" || entries[1].Name != "second" {
		t.Errorf("List(\"\") = %+v, want [first, second]", entries)
	}
}

// TestList_SubdirectoriesFirst covers List's own directories-before-files
// ordering (each group sorted alphabetically), and that it never recurses
// into a subdirectory on its own — a diagram inside one is invisible from
// the root listing, only found by a separate List call for that
// subdirectory.
func TestList_SubdirectoriesFirst(t *testing.T) {
	s := newTestStore(t)
	d := &slddoc.Diagram{Width: 1, Height: 1}
	if _, err := s.Create("zzz-diagram", d); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create("region1/sub-1", d); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create("aaa-region/sub-2", d); err != nil {
		t.Fatal(err)
	}

	root, err := s.List("")
	if err != nil {
		t.Fatal(err)
	}
	if len(root) != 3 {
		t.Fatalf("List(\"\") = %+v, want 3 entries", root)
	}
	if !root[0].IsDir || root[0].Name != "aaa-region" || !root[1].IsDir || root[1].Name != "region1" {
		t.Errorf("List(\"\") = %+v, want subdirectories first, alphabetical", root)
	}
	if root[2].IsDir || root[2].Name != "zzz-diagram" {
		t.Errorf("List(\"\")[2] = %+v, want the one diagram last", root[2])
	}

	sub, err := s.List("region1")
	if err != nil {
		t.Fatal(err)
	}
	if len(sub) != 1 || sub[0].IsDir || sub[0].Name != "sub-1" {
		t.Errorf("List(\"region1\") = %+v, want one diagram named sub-1 (List must not recurse)", sub)
	}
}

// TestCreateSaveLoad_Subdirectory covers a name with a folder segment that
// doesn't exist on disk yet — Save's own os.MkdirAll is the only way a
// subdirectory is created, there's no separate "New Folder" action.
func TestCreateSaveLoad_Subdirectory(t *testing.T) {
	s := newTestStore(t)
	d := &slddoc.Diagram{Width: 1, Height: 1}

	if _, err := s.Create("region1/sub-1", d); err != nil {
		t.Fatalf("Create into a not-yet-existing subdirectory: %v", err)
	}
	got, err := s.Load("region1/sub-1")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.Width != 1 {
		t.Errorf("Width = %v, want 1", got.Width)
	}
	if _, err := os.Stat(filepath.Join(s.dir, "region1", "sub-1.svg")); err != nil {
		t.Errorf("expected a companion .svg to be written: %v", err)
	}
}

func TestSafeName_RejectsPathTraversal(t *testing.T) {
	s := newTestStore(t)
	for _, name := range []string{
		"", "../escape", "a/../../b", `a\b`, " padded", "padded ",
		"a//b", "/a", "a/", "./a", "a/./b", "a/../b",
	} {
		if _, err := s.xmlPath(name); err == nil {
			t.Errorf("xmlPath(%q) should be rejected", name)
		}
	}
}

func TestSafeName_AllowsSubdirectorySegments(t *testing.T) {
	s := newTestStore(t)
	for _, name := range []string{"region1/sub-1", "a/b/c"} {
		if _, err := s.xmlPath(name); err != nil {
			t.Errorf("xmlPath(%q) should be allowed, got %v", name, err)
		}
	}
}
