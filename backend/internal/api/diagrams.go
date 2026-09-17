package api

import (
	"bytes"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/PVKonovalov/slddoc"
	"sld-editor/internal/storage"
)

func (s *Server) listDiagrams(c *gin.Context) {
	infos, err := s.store.List()
	if err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, infos)
}

type createDiagramRequest struct {
	Name   string  `json:"name" binding:"required"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// createDiagram implements File > New: it seeds a blank diagram (this
// editor's own settings defaults, one Base layer, nothing else) and fails
// if the name is already taken rather than silently overwriting it.
func (s *Server) createDiagram(c *gin.Context) {
	var req createDiagramRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	if req.Width <= 0 {
		req.Width = 2000
	}
	if req.Height <= 0 {
		req.Height = 1200
	}

	d := &slddoc.Diagram{
		Width:  req.Width,
		Height: req.Height,
		Editor: &slddoc.EditorSettings{
			GridSpacing: s.cfg.Editor.GridSpacing,
			Snap:        s.cfg.Editor.Snap,
			Background:  s.cfg.Editor.Background,
		},
		Layers: []slddoc.Layer{{ID: slddoc.BaseLayer, Name: "Base"}},
	}

	warn, err := s.store.Create(req.Name, d)
	if errors.Is(err, storage.ErrExists) {
		errJSON(c, http.StatusConflict, err)
		return
	}
	if err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusCreated, diagramResponse(d, warn))
}

func (s *Server) getDiagram(c *gin.Context) {
	d, err := s.store.Load(c.Param("name"))
	if errors.Is(err, storage.ErrNotFound) {
		errJSON(c, http.StatusNotFound, err)
		return
	}
	if err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// saveDiagram implements both File > Save (name unchanged) and File > Save
// As (client sends the new name): it always upserts, since a distinct
// "don't clobber an existing name" check belongs to the Save As UI flow
// (checking the diagram list before submitting), not this endpoint.
func (s *Server) saveDiagram(c *gin.Context) {
	var d slddoc.Diagram
	if err := c.ShouldBindJSON(&d); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}

	warn, err := s.store.Save(c.Param("name"), &d)
	if err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, diagramResponse(&d, warn))
}

func (s *Server) renderDiagramSVG(c *gin.Context) {
	d, err := s.store.Load(c.Param("name"))
	if errors.Is(err, storage.ErrNotFound) {
		errJSON(c, http.StatusNotFound, err)
		return
	}
	if err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}

	// Static: this is a direct download/view of the artifact, same as the
	// companion .svg Save writes to disk — never carries this editor's own
	// interactivity-only markup.
	c.Header("Content-Type", "image/svg+xml")
	if err := s.store.Render(d, c.Writer, slddoc.Static); err != nil {
		c.Header("X-Render-Warning", err.Error())
	}
}

// renderPreview renders a not-yet-saved (or not-yet-saved-under-this-name)
// diagram, for the canvas to preview edits before the user saves.
// Interactive: this is what the live canvas actually clicks on.
func (s *Server) renderPreview(c *gin.Context) {
	var d slddoc.Diagram
	if err := c.ShouldBindJSON(&d); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}

	var buf bytes.Buffer
	renderErr := s.store.Render(&d, &buf, slddoc.Interactive)
	resp := gin.H{"svg": buf.String()}
	if renderErr != nil {
		resp["warning"] = renderErr.Error()
	}
	c.JSON(http.StatusOK, resp)
}

func diagramResponse(d *slddoc.Diagram, renderWarning error) gin.H {
	resp := gin.H{"diagram": d}
	if renderWarning != nil {
		resp["warning"] = renderWarning.Error()
	}
	return resp
}
