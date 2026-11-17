package api

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"sld-editor/internal/binding"
)

// bindingsConfig is /api/config's "bindings": the active provider ("" = off) and whether export is possible.
type bindingsConfig struct {
	Provider  string `json:"provider"`
	CanExport bool   `json:"canExport"`
}

func (s *Server) bindingsConfig() bindingsConfig {
	if s.bindings == nil {
		return bindingsConfig{}
	}
	return bindingsConfig{Provider: s.bindings.Name(), CanExport: binding.CanExport(s.bindings, s.cfg.Bindings)}
}

// bindingRoutes registers /api/bindings/* on grp; called only with a provider configured.
func (s *Server) bindingRoutes(grp *gin.RouterGroup) {
	b := grp.Group("/bindings")
	b.GET("/dictionaries", s.getBindingDictionaries)
	b.GET("/sections", s.getBindingSections)
	b.GET("/catalog", s.getBindingCatalog)
	b.GET("/list", s.getBindingList)
	b.GET("/search", s.searchBindingObjects)
}

// getBindingSections answers the provider's top-level object tree.
func (s *Server) getBindingSections(c *gin.Context) {
	answerBinding(c, func() (any, error) { return s.bindings.Sections(c.Request.Context()) })
}

// getBindingCatalog answers the catalog tree of ?section=.
func (s *Server) getBindingCatalog(c *gin.Context) {
	answerBinding(c, func() (any, error) { return s.bindings.Catalog(c.Request.Context(), c.Query("section")) })
}

// getBindingList answers the objects listed under catalog node ?node= of ?section=.
func (s *Server) getBindingList(c *gin.Context) {
	answerBinding(c, func() (any, error) {
		return s.bindings.List(c.Request.Context(), c.Query("section"), c.Query("node"))
	})
}

// searchBindingObjects answers catalog nodes and objects of ?section= whose name contains ?q=, at most ?limit=.
func (s *Server) searchBindingObjects(c *gin.Context) {
	limit := 0
	if l := c.Query("limit"); l != "" {
		n, err := strconv.Atoi(l)
		if err != nil || n <= 0 {
			errJSON(c, http.StatusBadRequest, fmt.Errorf("limit %q is not a positive integer", l))
			return
		}
		limit = n
	}
	answerBinding(c, func() (any, error) {
		return s.bindings.Search(c.Request.Context(), c.Query("section"), c.Query("q"), limit)
	})
}

// answerBinding answers get's result as JSON, or its error by bindingError.
func answerBinding(c *gin.Context, get func() (any, error)) {
	v, err := get()
	if err != nil {
		bindingError(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

// getBindingDictionaries answers the provider's reference lists; ?refresh=1 re-reads them from the data source.
func (s *Server) getBindingDictionaries(c *gin.Context) {
	if c.Query("refresh") == "1" {
		if r, ok := s.bindings.(binding.Refresher); ok {
			r.Refresh()
		}
	}
	d, err := s.bindings.Dictionaries(c.Request.Context())
	if err != nil {
		bindingError(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// bindingError answers a provider error: 400 for a bad argument, 404 for an unknown section, node or object, 501 for
// a method the provider lacks, else 502 (its data source failed).
func bindingError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, binding.ErrInvalid):
		errJSON(c, http.StatusBadRequest, err)
	case errors.Is(err, binding.ErrNotFound):
		errJSON(c, http.StatusNotFound, err)
	case errors.Is(err, binding.ErrNotImplemented):
		errJSON(c, http.StatusNotImplemented, err)
	default:
		errJSON(c, http.StatusBadGateway, err)
	}
}
