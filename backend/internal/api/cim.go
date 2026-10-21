package api

import (
	"archive/zip"
	"bytes"
	"net/http"
	"path"
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
