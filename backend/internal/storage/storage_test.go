package storage

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

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

func TestSaveRevision_KeepsHistoryOnDisk(t *testing.T) {
	s := newTestStore(t)
	t0 := time.Date(2026, 10, 15, 10, 0, 0, 0, time.UTC)
	rev := func(i int) slddoc.Revision {
		return slddoc.Revision{Time: t0.Add(time.Duration(i) * time.Minute), IP: "10.0.0.1"}
	}

	// A new name starts from the diagram's own history (Save As keeps it).
	d := &slddoc.Diagram{Width: 10, Height: 10, History: []slddoc.Revision{rev(0)}}
	if _, err := s.SaveRevision("a", d, rev(1)); err != nil {
		t.Fatal(err)
	}
	// An existing one ignores the client's history.
	forged := &slddoc.Diagram{Width: 10, Height: 10, History: []slddoc.Revision{rev(9)}}
	if _, err := s.SaveRevision("a", forged, rev(2)); err != nil {
		t.Fatal(err)
	}
	got, err := s.Load("a")
	if err != nil {
		t.Fatal(err)
	}
	if want := []slddoc.Revision{rev(0), rev(1), rev(2)}; !slices.Equal(got.History, want) || !slices.Equal(forged.History, want) {
		t.Errorf("History = %v (in place %v), want %v", got.History, forged.History, want)
	}

	for i := range MaxHistory {
		if _, err := s.SaveRevision("a", &slddoc.Diagram{Width: 10, Height: 10}, rev(10+i)); err != nil {
			t.Fatal(err)
		}
	}
	got, _ = s.Load("a")
	if len(got.History) != MaxHistory || got.History[0] != rev(10) {
		t.Errorf("trimmed history: %d entries, first %v", len(got.History), got.History[0])
	}

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Errorf("temporary files left behind: %v", entries)
	}
}

func TestFolderActions(t *testing.T) {
	s := newTestStore(t)
	d := &slddoc.Diagram{Width: 100, Height: 100}
	if _, err := s.Create("a/one", d); err != nil {
		t.Fatal(err)
	}

	if err := s.CreateDir("b/c"); err != nil {
		t.Fatalf("CreateDir: %v", err)
	}
	if err := s.CreateDir("b/c"); !errors.Is(err, ErrExists) {
		t.Errorf("CreateDir existing: %v, want ErrExists", err)
	}
	if err := s.CreateDir(""); !errors.Is(err, ErrInvalidName) {
		t.Errorf("CreateDir root: %v, want ErrInvalidName", err)
	}

	if err := s.Rename("a/one", "b/c/two"); err != nil {
		t.Fatalf("Rename: %v", err)
	}
	if _, err := s.Load("b/c/two"); err != nil {
		t.Errorf("Load renamed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.dir, "b", "c", "two.svg")); err != nil {
		t.Errorf("svg not moved: %v", err)
	}
	if _, err := s.Load("a/one"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Load old name: %v, want ErrNotFound", err)
	}
	if err := s.Rename("a/one", "x"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Rename missing: %v, want ErrNotFound", err)
	}
	if _, err := s.Create("three", d); err != nil {
		t.Fatal(err)
	}
	if err := s.Rename("three", "b/c/two"); !errors.Is(err, ErrExists) {
		t.Errorf("Rename onto existing: %v, want ErrExists", err)
	}

	if err := s.RenameDir("b", "b/c/d"); !errors.Is(err, ErrInvalidName) {
		t.Errorf("RenameDir into itself: %v, want ErrInvalidName", err)
	}
	if err := s.RenameDir("b", "a"); !errors.Is(err, ErrExists) {
		t.Errorf("RenameDir onto existing: %v, want ErrExists", err)
	}
	if err := s.RenameDir("three", "z"); !errors.Is(err, ErrNotFound) {
		t.Errorf("RenameDir of a diagram: %v, want ErrNotFound", err)
	}
	if err := s.RenameDir("b", "x/y"); err != nil {
		t.Fatalf("RenameDir: %v", err)
	}
	if _, err := s.Load("x/y/c/two"); err != nil {
		t.Errorf("Load after RenameDir: %v", err)
	}

	if err := s.DeleteDir("x/y/c"); !errors.Is(err, ErrNotEmpty) {
		t.Errorf("DeleteDir non-empty: %v, want ErrNotEmpty", err)
	}
	if err := s.Delete("x/y/c/two"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if err := s.Delete("x/y/c/two"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Delete again: %v, want ErrNotFound", err)
	}
	if err := s.DeleteDir("x/y/c"); err != nil {
		t.Fatalf("DeleteDir: %v", err)
	}
	if err := s.DeleteDir("x/y/c"); !errors.Is(err, ErrNotFound) {
		t.Errorf("DeleteDir again: %v, want ErrNotFound", err)
	}
	entries, err := s.List("x/y")
	if err != nil || len(entries) != 0 {
		t.Errorf("List(x/y) = %v, %v; want empty", entries, err)
	}
}

func TestSave_SeedsStateColorsFromLegend(t *testing.T) {
	lib := slddoc.NewSymbolLibrary(nil)
	legend := []slddoc.StateColor{{State: 0, Label: "Open", Color: "red"}, {State: 1, Label: "Close", Color: "lawngreen"}}
	s, err := New(t.TempDir(), lib, "", nil, legend...)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.Create("new", &slddoc.Diagram{Width: 10, Height: 10}); err != nil {
		t.Fatal(err)
	}
	own := []slddoc.DiagramStateColor{{State: 0, Color: "#ff8800"}}
	if _, err := s.Create("own", &slddoc.Diagram{Width: 10, Height: 10, StateColors: own}); err != nil {
		t.Fatal(err)
	}

	got, err := s.Load("new")
	if err != nil {
		t.Fatal(err)
	}
	want := []slddoc.DiagramStateColor{{State: 0, Color: "red"}, {State: 1, Color: "lawngreen"}}
	if !slices.Equal(got.StateColors, want) {
		t.Errorf("a diagram without state colors should take the legend's, got %+v", got.StateColors)
	}
	got, err = s.Load("own")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(got.StateColors, own) {
		t.Errorf("a diagram's own state colors should be kept, got %+v", got.StateColors)
	}
}
