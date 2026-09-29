package api

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/PVKonovalov/slddoc"
	"github.com/gin-gonic/gin"

	"sld-editor/internal/storage"
	"sld-editor/pkg/llog"
)

// customElement is one entry of the Elements palette's "Custom elements"
// group: a whole predefined diagram fragment, placed by the frontend as a
// copy of its contents. SVG is its Static rendering, used as the palette
// icon.
type customElement struct {
	Name    string          `json:"name"`
	Diagram *slddoc.Diagram `json:"diagram"`
	SVG     string          `json:"svg"`
}

// newCustomElement pairs d with its Static rendering. A render warning (e.g.
// a missing symbol) is logged, not returned — whatever markup was produced
// is still a usable icon.
func (s *Server) newCustomElement(name string, d *slddoc.Diagram) customElement {
	var buf bytes.Buffer
	if err := s.custom.Render(d, &buf, slddoc.Static); err != nil {
		llog.Logger.Warnf("custom element %q: rendering: %v", name, err)
	}
	return customElement{Name: name, Diagram: d, SVG: buf.String()}
}

// listCustomElements serves every .xsld directly inside the custom-elements
// directory, fully loaded — they're small and the palette needs all of them
// up front. A file that fails to load is logged and left out rather than
// failing the whole list.
func (s *Server) listCustomElements(c *gin.Context) {
	out := []customElement{}
	if s.custom == nil {
		c.JSON(http.StatusOK, out)
		return
	}
	entries, err := s.custom.List("")
	if err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	for _, e := range entries {
		if e.IsDir {
			continue
		}
		d, err := s.custom.Load(e.Name)
		if err != nil {
			llog.Logger.Warnf("custom element %q: %v", e.Name, err)
			continue
		}
		out = append(out, s.newCustomElement(e.Name, d))
	}
	c.JSON(http.StatusOK, out)
}

// saveCustomElement implements "Save selection as custom element": writes
// the posted diagram as name in the custom-elements directory and returns
// the new palette entry. name must be a single path segment, since the
// palette only lists the directory's own top level. An existing name fails
// with 409 unless overwrite=1.
func (s *Server) saveCustomElement(c *gin.Context) {
	if s.custom == nil {
		errJSON(c, http.StatusServiceUnavailable, errors.New("custom elements directory not configured"))
		return
	}
	name := c.Query("name")
	if strings.Contains(name, "/") {
		errJSON(c, http.StatusBadRequest, fmt.Errorf("%w: a custom element name can't contain /", storage.ErrInvalidName))
		return
	}
	var d slddoc.Diagram
	if err := c.ShouldBindJSON(&d); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}

	var err error
	if c.Query("overwrite") == "1" {
		_, err = s.custom.Save(name, &d)
	} else {
		_, err = s.custom.Create(name, &d)
	}
	switch {
	case errors.Is(err, storage.ErrInvalidName):
		errJSON(c, http.StatusBadRequest, err)
		return
	case errors.Is(err, storage.ErrExists):
		errJSON(c, http.StatusConflict, err)
		return
	case err != nil:
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, s.newCustomElement(name, &d))
}
