package storage

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/PVKonovalov/slddoc"
)

// ErrNotImage is returned by SaveTracingImage for data that isn't a supported image.
var ErrNotImage = errors.New("storage: not a supported image")

// tracingInfix sits between a diagram's base name and its tracing image's extension: "name.tracing.png".
const tracingInfix = ".tracing"

// tracingTypes maps a sniffed image content type to its file extension.
var tracingTypes = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/gif":  ".gif",
	"image/webp": ".webp",
	"image/bmp":  ".bmp",
}

// tracingExt is data's file extension, or "" when it isn't a supported image (an SVG is recognized by its root).
func tracingExt(data []byte) string {
	ct := http.DetectContentType(data)
	if ext, ok := tracingTypes[ct]; ok {
		return ext
	}
	if strings.HasPrefix(ct, "text/xml") || strings.HasPrefix(ct, "text/plain") {
		if bytes.Contains(data[:min(len(data), 4096)], []byte("<svg")) {
			return ".svg"
		}
	}
	return ""
}

// checkDiagramName refuses a diagram name ending in ".tracing" (any case): its rendered .svg would be the SVG
// tracing image of the diagram without that suffix.
func checkDiagramName(name string) error {
	if len(name) >= len(tracingInfix) && strings.EqualFold(name[len(name)-len(tracingInfix):], tracingInfix) {
		return fmt.Errorf("%w: a diagram name must not end in %q", ErrInvalidName, tracingInfix)
	}
	return nil
}

func isTracingExt(ext string) bool {
	if ext == ".svg" {
		return true
	}
	for _, e := range tracingTypes {
		if e == ext {
			return true
		}
	}
	return false
}

// tracingFiles lists the paths of the tracing image files of the diagram whose .xsld is xmlPath.
func tracingFiles(xmlPath string) ([]string, error) {
	dir := filepath.Dir(xmlPath)
	prefix := strings.TrimSuffix(filepath.Base(xmlPath), xmlExt) + tracingInfix + "."
	items, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("storage: listing %s: %w", dir, err)
	}
	var out []string
	for _, e := range items {
		if e.IsDir() || !strings.HasPrefix(e.Name(), prefix) || !isTracingExt("."+e.Name()[len(prefix):]) {
			continue
		}
		path := filepath.Join(dir, e.Name())
		// The rendered picture of a diagram named "<name>.tracing" saved before such names were refused.
		if before, ok := strings.CutSuffix(path, svgExt); ok {
			if _, err := os.Stat(before + xmlExt); err == nil {
				continue
			}
		}
		out = append(out, path)
	}
	return out, nil
}

// removeTracingFiles deletes the tracing image files of the diagram whose .xsld is xmlPath, except keep.
func removeTracingFiles(xmlPath, keep string) error {
	files, err := tracingFiles(xmlPath)
	if err != nil {
		return err
	}
	for _, f := range files {
		if f == keep {
			continue
		}
		if err := os.Remove(f); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("storage: deleting %s: %w", f, err)
		}
	}
	return nil
}

// SaveTracingImage stores data as the tracing image of the existing diagram name, replacing any earlier one, and
// returns its file name. It fails with ErrNotFound for a missing diagram and ErrNotImage for data that isn't one.
func (s *Store) SaveTracingImage(name string, data []byte) (string, error) {
	xmlPath, err := s.xmlPath(name)
	if err != nil {
		return "", err
	}
	ext := tracingExt(data)
	if ext == "" {
		return "", ErrNotImage
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := os.Stat(xmlPath); os.IsNotExist(err) {
		return "", ErrNotFound
	}
	path := strings.TrimSuffix(xmlPath, xmlExt) + tracingInfix + ext
	if err := replaceFile(path, data); err != nil {
		return "", err
	}
	if err := removeTracingFiles(xmlPath, path); err != nil {
		return "", err
	}
	return filepath.Base(path), nil
}

// TracingImagePath is the path of the tracing image file of diagram name, failing with ErrNotFound when it has none.
func (s *Store) TracingImagePath(name string) (string, error) {
	xmlPath, err := s.xmlPath(name)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	files, err := tracingFiles(xmlPath)
	if err != nil {
		return "", err
	}
	if len(files) == 0 {
		return "", ErrNotFound
	}
	return files[0], nil
}

// CopyTracingImage copies the tracing image of diagram from, when it has one, to diagram to (Save As), replacing
// to's own.
func (s *Store) CopyTracingImage(from, to string) error {
	if err := checkDiagramName(to); err != nil {
		return err
	}
	fromXML, err := s.xmlPath(from)
	if err != nil {
		return err
	}
	toXML, err := s.xmlPath(to)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	files, err := tracingFiles(fromXML)
	if err != nil || len(files) == 0 {
		return err
	}
	data, err := os.ReadFile(files[0])
	if err != nil {
		return fmt.Errorf("storage: reading %s: %w", files[0], err)
	}
	if err := os.MkdirAll(filepath.Dir(toXML), 0o755); err != nil {
		return fmt.Errorf("storage: creating directory for %s: %w", to, err)
	}
	path := strings.TrimSuffix(toXML, xmlExt) + tracingInfix + filepath.Ext(files[0])
	if err := replaceFile(path, data); err != nil {
		return err
	}
	return removeTracingFiles(toXML, path)
}

// syncTracingImage makes d's tracing image name the file stored for the diagram whose .xsld is xmlPath: a reference
// with no file is dropped, and with no reference the files are deleted.
func syncTracingImage(xmlPath string, d *slddoc.Diagram) error {
	if d.TracingImage == nil {
		return removeTracingFiles(xmlPath, "")
	}
	files, err := tracingFiles(xmlPath)
	if err != nil {
		return err
	}
	if len(files) == 0 {
		d.TracingImage = nil
		return nil
	}
	d.TracingImage.File = filepath.Base(files[0])
	return nil
}

// renameTracingImage moves the tracing image of the diagram fromXML to the diagram toXML (both .xsld paths, the
// diagram itself already moved) and rewrites the file name in toXML, keeping its modification time.
func renameTracingImage(fromXML, toXML string) error {
	files, err := tracingFiles(fromXML)
	if err != nil || len(files) == 0 {
		return err
	}
	to := strings.TrimSuffix(toXML, xmlExt) + tracingInfix + filepath.Ext(files[0])
	if err := os.Rename(files[0], to); err != nil {
		return fmt.Errorf("storage: renaming %s: %w", files[0], err)
	}
	if err := removeTracingFiles(fromXML, ""); err != nil {
		return err
	}
	info, err := os.Stat(toXML)
	if err != nil {
		return fmt.Errorf("storage: %w", err)
	}
	f, err := os.Open(toXML)
	if err != nil {
		return fmt.Errorf("storage: opening %s: %w", toXML, err)
	}
	d, err := slddoc.Load(f)
	f.Close()
	if err != nil {
		return fmt.Errorf("storage: loading %s: %w", toXML, err)
	}
	if d.TracingImage == nil || d.TracingImage.File == filepath.Base(to) {
		return nil
	}
	d.TracingImage.File = filepath.Base(to)
	var buf bytes.Buffer
	if err := d.Save(&buf); err != nil {
		return fmt.Errorf("storage: saving %s: %w", toXML, err)
	}
	if err := replaceFile(toXML, buf.Bytes()); err != nil {
		return err
	}
	return os.Chtimes(toXML, info.ModTime(), info.ModTime())
}
