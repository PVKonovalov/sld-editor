package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"sld-editor/internal/binding"
)

// maxExistRefs bounds one POST /bindings/schemes/exist.
const maxExistRefs = 10000

// schemeRoutes registers the scheme link routes of a provider that is a binding.Linker.
func (s *Server) schemeRoutes(b *gin.RouterGroup, l binding.Linker) {
	b.GET("/schemes", func(c *gin.Context) { s.getSchemes(c, l) })
	b.GET("/scheme", func(c *gin.Context) { s.getScheme(c, l) })
	b.GET("/schemes/suggest", func(c *gin.Context) { s.suggestSchemes(c, l) })
	b.POST("/schemes/exist", func(c *gin.Context) { s.schemesExist(c, l) })
}

// withDiagrams fills each scheme's Diagram from the link index.
func (s *Server) withDiagrams(schemes []binding.Scheme) {
	linked := s.store.LinkedDiagrams(s.bindings.Name())
	for i := range schemes {
		schemes[i].Diagram = linked[schemes[i].Ref]
	}
}

// getSchemes answers the provider's groups and schemes, each scheme with its linked diagram.
func (s *Server) getSchemes(c *gin.Context, l binding.Linker) {
	tree, err := l.Schemes(c.Request.Context())
	if err != nil {
		bindingError(c, err)
		return
	}
	s.withDiagrams(tree.Schemes)
	c.JSON(http.StatusOK, tree)
}

// getScheme answers the scheme ?ref= with its linked diagram; 404 when it is gone.
func (s *Server) getScheme(c *gin.Context, l binding.Linker) {
	sc, err := l.Scheme(c.Request.Context(), c.Query("ref"))
	if err != nil {
		bindingError(c, err)
		return
	}
	one := []binding.Scheme{*sc}
	s.withDiagrams(one)
	c.JSON(http.StatusOK, one[0])
}

// suggestSchemes answers {candidates} for the diagram ?name= (its path) imported from ?source=: ranked, never
// chosen; a candidate linked to another diagram carries that diagram.
func (s *Server) suggestSchemes(c *gin.Context, l binding.Linker) {
	tree, err := l.Schemes(c.Request.Context())
	if err != nil {
		bindingError(c, err)
		return
	}
	s.withDiagrams(tree.Schemes)
	candidates := binding.RankCandidates(tree.Schemes, c.Query("name"), c.Query("source"))
	if candidates == nil {
		candidates = []binding.Candidate{}
	}
	c.JSON(http.StatusOK, gin.H{"candidates": candidates})
}

// schemesExist answers {exist: {ref: bool}} for the body's {refs}.
func (s *Server) schemesExist(c *gin.Context, l binding.Linker) {
	var req struct {
		Refs []string `json:"refs"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	if len(req.Refs) > maxExistRefs {
		c.JSON(http.StatusBadRequest, gin.H{"error": "too many refs"})
		return
	}
	exist, err := l.SchemesExist(c.Request.Context(), req.Refs)
	if err != nil {
		bindingError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"exist": exist})
}
