package api

import (
	"bytes"
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/PVKonovalov/slddoc"
	"sld-editor/internal/storage"
)

// listDiagrams implements the File panel's folder browser: dir (query
// param, "" for the store's own root) names the one directory to list —
// List itself never recurses, so navigating into a subdirectory is a
// separate request with a deeper dir, not a client-side filter over one big
// recursive listing.
func (s *Server) listDiagrams(c *gin.Context) {
	entries, err := s.store.List(c.Query("dir"))
	if errors.Is(err, storage.ErrInvalidName) {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	if err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, entries)
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
	if errors.Is(err, storage.ErrInvalidName) {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	if err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusCreated, diagramResponse(d, warn))
}

// getDiagram, saveDiagram, and renderDiagramSVG all take name as a query
// parameter (?name=region1/substation-5) rather than a Gin :name path
// segment — a Gin route param never matches a literal "/", so a
// subdirectory-qualified name couldn't reach these handlers at all under
// the old /diagrams/:name pattern; a *name catch-all would work for these
// two alone, but conflicts with /diagrams/:name/svg's own extra path
// segment in Gin's router, so all three were moved to query params instead
// for one consistent scheme.
func (s *Server) getDiagram(c *gin.Context) {
	d, err := s.store.Load(c.Query("name"))
	if errors.Is(err, storage.ErrNotFound) {
		errJSON(c, http.StatusNotFound, err)
		return
	}
	if errors.Is(err, storage.ErrInvalidName) {
		errJSON(c, http.StatusBadRequest, err)
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

	warn, err := s.store.Save(c.Query("name"), &d)
	if errors.Is(err, storage.ErrInvalidName) {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	if err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, diagramResponse(&d, warn))
}

func (s *Server) renderDiagramSVG(c *gin.Context) {
	d, err := s.store.Load(c.Query("name"))
	if errors.Is(err, storage.ErrNotFound) {
		errJSON(c, http.StatusNotFound, err)
		return
	}
	if errors.Is(err, storage.ErrInvalidName) {
		errJSON(c, http.StatusBadRequest, err)
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

type renderFragmentsRequest struct {
	Diagram slddoc.Diagram `json:"diagram"`
	Ids     []int          `json:"ids"`
}

// renderPreviewFragments is renderPreview's incremental counterpart (see
// slddoc.RenderFragments' own doc comment) — given a diagram and the ids
// (elements/connectors/labels/digital devices — this schema's ids are one
// shared space across all four, so a plain int works regardless of kind)
// that actually changed since the canvas's own last successful render, it
// returns only those ids' own fresh markup, not a whole document, so the
// canvas can patch its existing DOM nodes in place instead of replacing the
// entire injected SVG on every small edit. fragments is keyed by id
// (JSON-marshaled as a string key, same as any Go map[int]... would be); an
// id the caller asked for but that no longer exists in diagram at all
// (something it just deleted locally) simply has no entry — not an error,
// same as slddoc.RenderFragments' own doc comment describes. Otherwise
// mirrors renderPreview exactly: Interactive mode, no persistence.
func (s *Server) renderPreviewFragments(c *gin.Context) {
	var req renderFragmentsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}

	fragments, renderErr := s.store.RenderFragments(&req.Diagram, req.Ids, slddoc.Interactive)
	resp := gin.H{"fragments": fragments}
	if renderErr != nil {
		resp["warning"] = renderErr.Error()
	}
	c.JSON(http.StatusOK, resp)
}

// exportDiagramXML renders a not-yet-saved (or already-modified-in-editor)
// diagram to XML for the browser to download directly to the user's own
// machine — the same slddoc.Diagram.Save format Save/Save As write to
// disk, just handed back over HTTP instead of persisted server-side.
func (s *Server) exportDiagramXML(c *gin.Context) {
	var d slddoc.Diagram
	if err := c.ShouldBindJSON(&d); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}

	var buf bytes.Buffer
	if err := d.Save(&buf); err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	c.Data(http.StatusOK, "application/xml", buf.Bytes())
}

// exportDiagramSVG mirrors exportDiagramXML for a Static-mode SVG (the same
// xsde2svg-faithful rendering the companion .svg Save writes to disk, not
// the live canvas's own Interactive markup) — a direct download of the
// current, possibly-unsaved diagram.
func (s *Server) exportDiagramSVG(c *gin.Context) {
	var d slddoc.Diagram
	if err := c.ShouldBindJSON(&d); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}

	var buf bytes.Buffer
	renderErr := s.store.Render(&d, &buf, slddoc.Static)
	if renderErr != nil {
		c.Header("X-Render-Warning", renderErr.Error())
	}
	c.Data(http.StatusOK, "image/svg+xml", buf.Bytes())
}

// importDiagramXML parses a raw .xml file dropped/picked on the client
// (see Load's own doc comment) and hands back the same JSON shape
// getDiagram does, so the frontend can treat a locally loaded file exactly
// like one opened from the server's own diagrams list.
func (s *Server) importDiagramXML(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	d, err := slddoc.Load(bytes.NewReader(body))
	if err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

func diagramResponse(d *slddoc.Diagram, renderWarning error) gin.H {
	resp := gin.H{"diagram": d}
	if renderWarning != nil {
		resp["warning"] = renderWarning.Error()
	}
	return resp
}
