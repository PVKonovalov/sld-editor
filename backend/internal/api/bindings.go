package api

import (
	"errors"
	"net/http"

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

// bindingError answers a provider error: 501 for a method the provider lacks, else 502 (its data source failed).
func bindingError(c *gin.Context, err error) {
	if errors.Is(err, binding.ErrNotImplemented) {
		errJSON(c, http.StatusNotImplemented, err)
		return
	}
	errJSON(c, http.StatusBadGateway, err)
}
