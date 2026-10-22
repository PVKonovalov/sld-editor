package api

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
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
	out := slddoc.ExportCIM(&d, slddoc.CIMOptions{Name: name, Created: created})

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
// makes a diagram of each Diagram Layout diagram in it, repaired like an extracted import. Responds {pages, messages}
// in the shape of the .xsde import.
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
	pages, err := slddoc.ImportCIM(docs, slddoc.CIMImportOptions{Terminals: s.lib.Terminals(), Classes: s.lib.Classes(), Grid: grid})
	if err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	out := make([]importedPage, 0, len(pages))
	messages := []cimMessage{}
	for i, p := range pages {
		s.applyPresetVoltageColors(p.Diagram)
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
	}
	c.JSON(http.StatusOK, gin.H{"pages": out, "messages": messages})
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

// cimDocuments returns the RDF/XML documents of a CIM upload: every .xml/.rdf file of a zip, or the body itself.
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
		if f.FileInfo().IsDir() || ext != ".xml" && ext != ".rdf" {
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

// applyPresetVoltageColors colours each uncoloured voltage class like the voltage_colors preset of the same
// voltage, and any other one from a fixed set, so imported voltages are told apart.
func (s *Server) applyPresetVoltageColors(d *slddoc.Diagram) {
	fallback := []string{"#00a0f0", "#962896", "#965000", "#326400", "#d02020", "#4a90d9", "#c8a000"}
	n := 0
	for i := range d.VoltageClasses {
		vc := &d.VoltageClasses[i]
		if vc.Color != "" {
			continue
		}
		kv, ok := slddoc.ParseVoltage(vc.Name)
		for _, p := range s.cfg.VoltageColors {
			if pkv, pok := slddoc.ParseVoltage(p.Name); ok && pok && pkv == kv {
				vc.Name, vc.Color = p.Name, p.Color
				break
			}
		}
		if vc.Color == "" {
			vc.Color = fallback[n%len(fallback)]
			n++
		}
	}
}
