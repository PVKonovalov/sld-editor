package api

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/PVKonovalov/slddoc"
)

// cimExport is POST /api/export/cim's answer: a zip of the CGMES 3.0 EQ and DL documents and what the export
// had to fill in or leave out.
type cimExport struct {
	Filename string              `json:"filename"`
	File     []byte              `json:"file"`
	Warnings []slddoc.CIMWarning `json:"warnings"`
}

// exportDiagramCIM converts the posted diagram (unsaved edits included) to CGMES 3.0. The name query
// parameter is the diagram's name: it seeds the mRIDs and names the files.
func (s *Server) exportDiagramCIM(c *gin.Context) {
	var d slddoc.Diagram
	if err := c.ShouldBindJSON(&d); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	name := c.Query("name")
	base := path.Base(name)
	if name == "" {
		base = "diagram"
	}
	created := time.Now()
	// A voltage class still named after its colour is named after the configured voltage of that colour, so its
	// equipment gets a real voltage.
	s.applyPresetVoltageNames(&d)
	out := slddoc.ExportCIM(&d, slddoc.CIMOptions{Name: name, Created: created, Classes: s.cimClasses})

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, f := range []struct {
		name string
		data []byte
	}{{base + "_EQ.xml", out.EQ}, {base + "_DL.xml", out.DL}} {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: f.name, Method: zip.Deflate, Modified: created})
		if err == nil {
			_, err = w.Write(f.data)
		}
		if err != nil {
			errJSON(c, http.StatusInternalServerError, err)
			return
		}
	}
	if err := zw.Close(); err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	warnings := out.Warnings
	if warnings == nil {
		warnings = []slddoc.CIMWarning{}
	}
	c.JSON(http.StatusOK, cimExport{Filename: base + "_CGMES.zip", File: buf.Bytes(), Warnings: warnings})
}

// importDiagramCIM reads a CIM model, a zip of profile documents (e.g. CGMES EQ + DL) or one RDF/XML document, and
// makes a diagram of each Diagram Layout diagram in it (with ?layout=auto, or with none, a diagram per substation
// laid out automatically). Responds {pages, messages, unmatchedVoltages, foreignLayout}: the .xsde import's shape,
// the voltage classes no voltage_colors preset names, and whether a page follows a layout made by another tool.
func (s *Server) importDiagramCIM(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	docs, err := cimDocuments(body)
	if err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	grid := s.cfg.Editor.GridSpacing
	pages, err := slddoc.ImportCIM(docs, slddoc.CIMImportOptions{Terminals: s.lib.Terminals(), Classes: s.lib.Classes(), Grid: grid,
		CIMClasses: s.cimClasses, AutoLayout: c.Query("layout") == "auto"})
	if err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	out := make([]importedPage, 0, len(pages))
	messages := []cimMessage{}
	unmatched := []unmatchedVoltage{}
	foreign := false
	for i, p := range pages {
		foreign = foreign || p.Layout == slddoc.CIMLayoutForeign
		for _, u := range s.applyPresetVoltageColors(p.Diagram) {
			k := slices.IndexFunc(unmatched, func(v unmatchedVoltage) bool { return v.Name == u.Name })
			if k < 0 {
				k = len(unmatched)
				unmatched = append(unmatched, u)
			}
			unmatched[k].Pages++
		}
		s.prepareCIM(p.Diagram)
		report := newImportReport(p.Report)
		// Skipped is keyed by CIM class, which names itself.
		for k := range report.Skipped {
			report.Skipped[k].Name, report.Skipped[k].Code = report.Skipped[k].Code, "CIM"
		}
		out = append(out, importedPage{Page: i + 1, Title: p.Title, Diagram: p.Diagram, Report: report})
		for _, m := range p.Messages {
			messages = append(messages, cimMessage{Level: "INFO", Page: i + 1, Text: m})
		}
		for _, m := range p.Warnings {
			messages = append(messages, cimMessage{Level: "WARN", Page: i + 1, Text: m})
		}
	}
	c.JSON(http.StatusOK, gin.H{"pages": out, "messages": messages, "unmatchedVoltages": unmatched, "foreignLayout": foreign})
}

// prepareCIM finishes an imported CIM diagram like prepareDiagram does an extracted one, except for the topology
// repair: its connections are the model's, and joining what merely touches in the drawing would change them.
func (s *Server) prepareCIM(d *slddoc.Diagram) {
	if v := slddoc.MostUsedVoltage(d); v != 0 {
		if d.Editor == nil {
			d.Editor = &slddoc.EditorSettings{}
		}
		d.Editor.DefaultVoltage = v
	}
	slddoc.EnsureIDs(d)
	s.applyPresetVoltageNames(d)
}

// cimMessage is one import note, shaped like xsde2svg's converter messages.
type cimMessage struct {
	Level string `json:"level"`
	Page  int    `json:"page"`
	Text  string `json:"text"`
}

// cimDocuments returns the RDF/XML documents of a CIM upload: every .xml/.rdf file of a zip, or the body itself. Hidden
// files (a name starting with ".") and anything under __MACOSX/ are skipped: macOS Finder adds a binary "._<name>"
// beside every file it compresses.
func cimDocuments(body []byte) ([][]byte, error) {
	if !bytes.HasPrefix(body, []byte("PK")) {
		return [][]byte{body}, nil
	}
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		return nil, err
	}
	var docs [][]byte
	for _, f := range zr.File {
		ext := strings.ToLower(path.Ext(f.Name))
		hidden := strings.HasPrefix(path.Base(f.Name), ".") || strings.HasPrefix(f.Name, "__MACOSX/")
		if f.FileInfo().IsDir() || hidden || ext != ".xml" && ext != ".rdf" {
			continue
		}
		r, err := f.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f.Name, err)
		}
		docs = append(docs, data)
	}
	if len(docs) == 0 {
		return nil, errors.New("the zip holds no .xml or .rdf CIM document")
	}
	return docs, nil
}

// unmatchedVoltage is a voltage class of a CIM import that no voltage_colors preset names. The import gave it the
// color of Preset, the preset nearest to it in voltage ("" and a neutral grey when there is none); Pages counts the
// pages using it.
type unmatchedVoltage struct {
	Name   string `json:"name"`
	Preset string `json:"preset"`
	Color  string `json:"color"`
	Pages  int    `json:"pages"`
}

// unmatchedVoltageColor is an unmatched voltage class's color when no preset is near it.
const unmatchedVoltageColor = "#808080"

// applyPresetVoltageColors gives each uncoloured voltage class the name and color of the voltage_colors preset for it
// (presetFor), or else the color of the preset nearest in voltage, and returns the latter classes.
func (s *Server) applyPresetVoltageColors(d *slddoc.Diagram) []unmatchedVoltage {
	presets := s.voltageColors()
	var unmatched []unmatchedVoltage
	for i := range d.VoltageClasses {
		vc := &d.VoltageClasses[i]
		if vc.Color != "" {
			continue
		}
		p, nearest, ok := presetFor(presets, vc.Name)
		switch {
		case ok && !nearest:
			vc.Name, vc.Color = p.Name, p.Color
		case ok:
			vc.Color = p.Color
			unmatched = append(unmatched, unmatchedVoltage{Name: vc.Name, Preset: p.Name, Color: p.Color})
		default:
			vc.Color = unmatchedVoltageColor
			unmatched = append(unmatched, unmatchedVoltage{Name: vc.Name, Color: vc.Color})
		}
	}
	return unmatched
}
