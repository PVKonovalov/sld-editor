package storage

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/PVKonovalov/slddoc"
)

var (
	pngData  = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
	jpegData = []byte("\xff\xd8\xff\xe0\x00\x10JFIF\x00")
)

func exists(t *testing.T, path string) bool {
	t.Helper()
	_, err := os.Stat(path)
	return err == nil
}

func TestSaveTracingImage(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.SaveTracingImage("a", pngData); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing diagram: err = %v, want ErrNotFound", err)
	}
	if _, err := s.Create("a", &slddoc.Diagram{Width: 10, Height: 10}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveTracingImage("a", []byte("plain text")); !errors.Is(err, ErrNotImage) {
		t.Fatalf("text: err = %v, want ErrNotImage", err)
	}
	svg := []byte(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`)
	if file, err := s.SaveTracingImage("a", svg); err != nil || file != "a.tracing.svg" {
		t.Fatalf("svg: file %q, err %v", file, err)
	}
	file, err := s.SaveTracingImage("a", pngData)
	if err != nil || file != "a.tracing.png" {
		t.Fatalf("png: file %q, err %v", file, err)
	}
	if file, _ = s.SaveTracingImage("a", jpegData); file != "a.tracing.jpg" {
		t.Fatalf("jpeg: file %q", file)
	}
	if exists(t, filepath.Join(s.dir, "a.tracing.png")) {
		t.Error("replaced png still there")
	}
	if p, err := s.TracingImagePath("a"); err != nil || filepath.Base(p) != "a.tracing.jpg" {
		t.Errorf("TracingImagePath = %q, %v", p, err)
	}
}

func TestTracingImageFollowsSaves(t *testing.T) {
	s := newTestStore(t)
	d := &slddoc.Diagram{Width: 10, Height: 10, TracingImage: &slddoc.TracingImage{File: "x.png", Width: 10, Height: 10, Opacity: 0.4}}
	if _, err := s.Create("a", d); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Load("a"); got.TracingImage != nil {
		t.Error("a reference with no file is kept")
	}
	if _, err := s.SaveTracingImage("a", pngData); err != nil {
		t.Fatal(err)
	}
	d.TracingImage = &slddoc.TracingImage{File: "x.png", Width: 10, Height: 10, Opacity: 0.4}
	if _, err := s.Save("a", d); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Load("a"); got.TracingImage == nil || got.TracingImage.File != "a.tracing.png" {
		t.Fatalf("saved reference = %+v", got.TracingImage)
	}

	if err := s.CopyTracingImage("a", "dir/b"); err != nil {
		t.Fatal(err)
	}
	if !exists(t, filepath.Join(s.dir, "dir", "b.tracing.png")) {
		t.Error("Save As copy missing")
	}
	if _, err := s.Save("dir/b", &slddoc.Diagram{Width: 10, Height: 10, TracingImage: &slddoc.TracingImage{}}); err != nil {
		t.Fatal(err)
	}

	old := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	if err := os.Chtimes(filepath.Join(s.dir, "a.xsld"), old, old); err != nil {
		t.Fatal(err)
	}
	if err := s.Rename("a", "c"); err != nil {
		t.Fatal(err)
	}
	if exists(t, filepath.Join(s.dir, "a.tracing.png")) || !exists(t, filepath.Join(s.dir, "c.tracing.png")) {
		t.Error("rename did not move the tracing image")
	}
	got, _ := s.Load("c")
	if got.TracingImage == nil || got.TracingImage.File != "c.tracing.png" {
		t.Errorf("renamed reference = %+v", got.TracingImage)
	}
	if info, _ := os.Stat(filepath.Join(s.dir, "c.xsld")); !info.ModTime().Equal(old) {
		t.Errorf("rename changed the modification time to %v", info.ModTime())
	}

	got.TracingImage = nil
	if _, err := s.Save("c", got); err != nil {
		t.Fatal(err)
	}
	if exists(t, filepath.Join(s.dir, "c.tracing.png")) {
		t.Error("saving without a tracing image kept its file")
	}

	if err := s.Delete("dir/b"); err != nil {
		t.Fatal(err)
	}
	if exists(t, filepath.Join(s.dir, "dir", "b.tracing.png")) {
		t.Error("delete kept the tracing image")
	}
}

func TestTracingNameRefused(t *testing.T) {
	s := newTestStore(t)
	for _, name := range []string{"a.tracing", "dir/B.Tracing"} {
		if _, err := s.Create(name, &slddoc.Diagram{Width: 10, Height: 10}); !errors.Is(err, ErrInvalidName) {
			t.Errorf("Create(%q): err = %v, want ErrInvalidName", name, err)
		}
	}
	if _, err := s.Create("a", &slddoc.Diagram{Width: 10, Height: 10}); err != nil {
		t.Fatal(err)
	}
	if err := s.Rename("a", "a.tracing"); !errors.Is(err, ErrInvalidName) {
		t.Errorf("Rename: err = %v, want ErrInvalidName", err)
	}
	if err := s.CopyTracingImage("a", "b.tracing"); !errors.Is(err, ErrInvalidName) {
		t.Errorf("CopyTracingImage: err = %v, want ErrInvalidName", err)
	}
}

// TestTracingFilesSkipOldDiagram checks that the files of a diagram named "a.tracing", saved before such names were
// refused, are never taken for diagram a's tracing image.
func TestTracingFilesSkipOldDiagram(t *testing.T) {
	s := newTestStore(t)
	for _, f := range []string{"a.tracing.xsld", "a.tracing.svg"} {
		if err := os.WriteFile(filepath.Join(s.dir, f), []byte("<svg/>"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Create("a", &slddoc.Diagram{Width: 10, Height: 10}); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"a.tracing.xsld", "a.tracing.svg"} {
		if !exists(t, filepath.Join(s.dir, f)) {
			t.Errorf("%s deleted as a tracing image", f)
		}
	}
	if _, err := s.TracingImagePath("a"); !errors.Is(err, ErrNotFound) {
		t.Errorf("TracingImagePath: err = %v, want ErrNotFound", err)
	}
}
