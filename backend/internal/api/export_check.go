package api

import (
	"net/http"
	"slices"

	"github.com/gin-gonic/gin"

	"sld-editor/internal/binding"
)

// exportCheckRoutes registers the pre-export routes of a provider that is a binding.ExportChecker.
func (s *Server) exportCheckRoutes(b *gin.RouterGroup, x binding.ExportChecker) {
	b.GET("/export/check", func(c *gin.Context) { s.checkExport(c, x) })
	b.GET("/scheme-groups", func(c *gin.Context) {
		groups, err := x.SchemeGroups(c.Request.Context())
		if err != nil {
			bindingError(c, err)
			return
		}
		c.JSON(http.StatusOK, groups)
	})
	b.GET("/scheme-types", func(c *gin.Context) {
		types, err := x.SchemeTypes(c.Request.Context())
		if err != nil {
			bindingError(c, err)
			return
		}
		c.JSON(http.StatusOK, types)
	})
}

// checkExport answers the binding.ExportCheck of the saved diagram ?name=. A link to another provider's scheme, or
// to a scheme another diagram holds, fails it. A new scheme is proposed the group of the scheme exported last.
func (s *Server) checkExport(c *gin.Context, x binding.ExportChecker) {
	name := c.Query("name")
	d, err := s.store.Load(name)
	if err != nil {
		storageError(c, err)
		return
	}
	provider := s.bindings.Name()
	scheme := d.Scheme
	if scheme != nil && scheme.Source != provider {
		scheme = nil
	}
	check, err := x.CheckExport(c.Request.Context(), name, d, scheme)
	if err != nil {
		bindingError(c, err)
		return
	}
	switch {
	case d.Scheme != nil && d.Scheme.Source != provider:
		check.Issues = slices.DeleteFunc(check.Issues, func(i binding.ExportIssue) bool { return i.Code == binding.IssueNotLinked })
		check.Add(binding.ExportIssue{Code: binding.IssueOtherSourceScheme, Severity: binding.SeverityError, Detail: d.Scheme.Source})
	case scheme != nil:
		if holder := s.store.LinkedDiagrams(provider)[scheme.Ref]; holder != "" && holder != name {
			check.Add(binding.ExportIssue{Code: binding.IssueSchemeHeld, Severity: binding.SeverityError, Detail: holder})
		}
		if check.Scheme != nil {
			one := []binding.Scheme{*check.Scheme}
			s.withDiagrams(one)
			check.Scheme = &one[0]
		}
	}
	if check.Scheme == nil {
		if l, ok := s.bindings.(binding.Linker); ok {
			if ref := s.store.LastExported(provider); ref != "" {
				if last, err := l.Scheme(c.Request.Context(), ref); err == nil {
					check.DefaultGroup = last.Group
				}
			}
		}
	}
	c.JSON(http.StatusOK, check)
}
