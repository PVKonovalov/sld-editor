package api

import (
	"net/http"
	"path"
	"regexp"
	"strings"

	"github.com/PVKonovalov/slddoc"
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

// driveLetter is a Windows drive at the start of a scheme's file name ("C:").
var driveLetter = regexp.MustCompile(`^[A-Za-z]:$`)

// fetchedPlace proposes the folder and name of a diagram made from f: the file's base name without its extension,
// and, when the file name carries the scheme's own folder (full_path), that folder without a drive letter.
func fetchedPlace(f *binding.FetchedSVG) (folder, name string) {
	name = strings.TrimSuffix(path.Base(f.File), path.Ext(f.File))
	if !f.FullPath {
		return "", name
	}
	parts := strings.Split(strings.Trim(path.Dir(f.File), "/."), "/")
	if len(parts) > 0 && driveLetter.MatchString(parts[0]) {
		parts = parts[1:]
	}
	return strings.Join(parts, "/"), name
}

// fetchScheme answers the scheme ?ref='s picture, read from where its viewer reads it, imported as an .svg import:
// {diagram, report, folder, name}, folder and name proposed for a new diagram. 409 with {diagram} when the scheme is
// linked to a diagram other than ?diagram= (the one being re-fetched).
func (s *Server) fetchScheme(c *gin.Context, f binding.SVGFetcher) {
	ref := c.Query("ref")
	if linked := s.store.LinkedDiagrams(s.bindings.Name())[ref]; linked != "" && linked != c.Query("diagram") {
		c.JSON(http.StatusConflict, gin.H{"error": "the scheme is linked to the diagram " + linked, "diagram": linked})
		return
	}
	fetched, err := f.FetchSVG(c.Request.Context(), ref)
	if err != nil {
		bindingError(c, err)
		return
	}
	d, report, err := slddoc.Extract(fetched.SVG, "", s.voltageHints())
	if err != nil {
		errJSON(c, http.StatusUnprocessableEntity, err)
		return
	}
	rewriteImportedShapes(d)
	s.prepareDiagram(d, true)
	folder, name := fetchedPlace(fetched)
	c.JSON(http.StatusOK, gin.H{
		"diagram": d,
		"report":  newImportReport(report),
		"file":    fetched.File,
		"folder":  folder,
		"name":    name,
	})
}
