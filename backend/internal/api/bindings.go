package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/PVKonovalov/slddoc"
	"github.com/gin-gonic/gin"

	"sld-editor/internal/binding"
)

// bindingsConfig is /api/config's "bindings": the active provider ("" = off) and whether export is possible.
type bindingsConfig struct {
	Provider  string `json:"provider"`
	CanExport bool   `json:"canExport"`
	// Schemes tells that diagrams can be linked to the provider's schemes (binding.Linker).
	Schemes bool `json:"schemes"`
	// ExportCheck tells that the provider can check a diagram before an export (binding.ExportChecker).
	ExportCheck bool `json:"exportCheck"`
	// Import tells that a linked scheme's bindings can be read (binding.Importer).
	Import bool `json:"import"`
	// Fetch tells that a scheme's picture can be read from its viewer's storage and imported (binding.SVGFetcher).
	Fetch bool `json:"fetch"`
}

func (s *Server) bindingsConfig() bindingsConfig {
	if s.bindings == nil {
		return bindingsConfig{}
	}
	_, linker := s.bindings.(binding.Linker)
	_, checker := s.bindings.(binding.ExportChecker)
	_, importer := s.bindings.(binding.Importer)
	_, fetcher := s.bindings.(binding.SVGFetcher)
	return bindingsConfig{Provider: s.bindings.Name(), CanExport: binding.CanExport(s.bindings, s.cfg.Bindings), Schemes: linker,
		ExportCheck: checker, Import: importer, Fetch: linker && fetcher}
}

// bindingRoutes registers /api/bindings/* on grp; called only with a provider configured.
func (s *Server) bindingRoutes(grp *gin.RouterGroup) {
	b := grp.Group("/bindings")
	b.GET("/dictionaries", s.getBindingDictionaries)
	b.GET("/sections", s.getBindingSections)
	b.GET("/catalog", s.getBindingCatalog)
	b.GET("/list", s.getBindingList)
	b.GET("/search", s.searchBindingObjects)
	b.GET("/object", s.getBindingObject)
	b.GET("/path", s.getBindingPath)
	b.POST("/objects", s.resolveBindingObjects)
	b.POST("/suggest", s.suggestBindings)
	if l, ok := s.bindings.(binding.Linker); ok {
		s.schemeRoutes(b, l)
		if f, ok := s.bindings.(binding.SVGFetcher); ok {
			b.POST("/schemes/fetch", func(c *gin.Context) { s.fetchScheme(c, f) })
		}
	}
	if im, ok := s.bindings.(binding.Importer); ok {
		b.POST("/import", func(c *gin.Context) { s.importBindings(c, im) })
	}
	if x, ok := s.bindings.(binding.ExportChecker); ok {
		s.exportCheckRoutes(b, x)
	}
}

// suggestBindings answers {bindings} the provider proposes for the body's {ref, element} (automatic binding).
func (s *Server) suggestBindings(c *gin.Context) {
	var req struct {
		Ref     string          `json:"ref"`
		Element binding.Element `json:"element"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	bs, err := s.bindings.Suggest(c.Request.Context(), req.Ref, req.Element)
	if err != nil {
		bindingError(c, err)
		return
	}
	if bs == nil {
		bs = []slddoc.Binding{}
	}
	c.JSON(http.StatusOK, gin.H{"bindings": bs})
}

// maxResolveRefs bounds one /objects request.
const maxResolveRefs = 10000

// resolveTimeout is a watchdog: resolving refs still running after it fails with an error.
const resolveTimeout = 2 * time.Minute

// getBindingObject answers the object ?ref= with the binding kind and option suggested for it.
func (s *Server) getBindingObject(c *gin.Context) {
	answerBinding(c, func() (any, error) { return s.bindings.Resolve(c.Request.Context(), c.Query("ref")) })
}

// maxPathDepth bounds a path walk, against a parent cycle in the provider's tree.
const maxPathDepth = 64

// PathNode is one level of an object's path in the provider's tree.
type PathNode struct {
	Ref  string `json:"ref"`
	Name string `json:"name"`
}

// getBindingPath answers the path of ?ref= from its tree's root down to the object, walking up its parents.
func (s *Server) getBindingPath(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), resolveTimeout)
	defer cancel()
	answerBinding(c, func() (any, error) {
		var path []PathNode
		seen := map[string]bool{}
		for r := c.Query("ref"); r != "" && !seen[r] && len(path) < maxPathDepth; {
			seen[r] = true
			obj, err := s.bindings.Resolve(ctx, r)
			if err != nil {
				if len(path) > 0 && (errors.Is(err, binding.ErrNotFound) || errors.Is(err, binding.ErrInvalid)) {
					break
				}
				return nil, err
			}
			path = append(path, PathNode{Ref: obj.Ref, Name: obj.Name})
			r = obj.ParentRef
		}
		slices.Reverse(path)
		return gin.H{"path": path}, nil
	})
}

// resolveBindingObjects answers {objects: ref → object, missing: refs that don't exist or can't be bound} for the
// body's {refs}.
func (s *Server) resolveBindingObjects(c *gin.Context) {
	var req struct {
		Refs []string `json:"refs"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	if len(req.Refs) > maxResolveRefs {
		errJSON(c, http.StatusBadRequest, fmt.Errorf("more than %d refs", maxResolveRefs))
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), resolveTimeout)
	defer cancel()
	found, missing, err := binding.ResolveAll(ctx, s.bindings, req.Refs)
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		errJSON(c, http.StatusGatewayTimeout, fmt.Errorf("%s did not answer for %d refs within %v", s.bindings.Name(), len(req.Refs), resolveTimeout))
		return
	}
	if err != nil {
		bindingError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"objects": found, "missing": missing})
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
	case errors.Is(err, binding.ErrNotConfigured):
		errJSON(c, http.StatusServiceUnavailable, err)
	default:
		errJSON(c, http.StatusBadGateway, err)
	}
}

// importBindings answers the binding.SchemeBindings of the scheme the saved diagram ?name= is linked to; 409 when it
// is not linked to a scheme of the provider. Nothing is written: the client compares and applies.
func (s *Server) importBindings(c *gin.Context, im binding.Importer) {
	scheme, err := s.store.LoadScheme(c.Query("name"))
	if err != nil {
		storageError(c, err)
		return
	}
	if scheme == nil || scheme.Source != s.bindings.Name() {
		c.JSON(http.StatusConflict, gin.H{"error": "the diagram is not linked to a scheme of " + s.bindings.Name()})
		return
	}
	res, err := im.SchemeBindings(c.Request.Context(), scheme.Ref)
	if err != nil {
		bindingError(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}
