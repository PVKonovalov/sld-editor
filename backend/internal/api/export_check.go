package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path"
	"slices"
	"strings"
	"time"

	"github.com/PVKonovalov/slddoc"
	"github.com/gin-gonic/gin"

	"sld-editor/internal/binding"
)

// exportCheckRoutes registers the pre-export routes of a provider that is a binding.ExportChecker, and the export
// itself when it is a binding.Exporter too.
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
	if e, ok := s.bindings.(binding.Exporter); ok {
		b.POST("/export", func(c *gin.Context) { s.exportDiagram(c, x, e) })
	}
	if _, ok := s.bindings.(binding.SVGDeliverer); ok {
		b.POST("/export/svg", s.exportSVG)
	}
}

// checkExport answers the binding.ExportCheck of the saved diagram ?name=, for registering a new scheme when
// ?register=true.
func (s *Server) checkExport(c *gin.Context, x binding.ExportChecker) {
	name := c.Query("name")
	d, err := s.store.Load(name)
	if err != nil {
		storageError(c, err)
		return
	}
	check, err := s.exportCheck(c.Request.Context(), x, name, d, c.Query("register") == "true")
	if err != nil {
		bindingError(c, err)
		return
	}
	c.JSON(http.StatusOK, check)
}

// diagramOfFile returns the diagram path a scheme file name stands for: "\" read as "/", without its extension.
func diagramOfFile(fileName string) string {
	p := strings.TrimPrefix(path.Clean("/"+strings.ReplaceAll(strings.TrimSpace(fileName), `\`, "/")), "/")
	return strings.TrimSuffix(p, path.Ext(p))
}

// exportCheck is the provider's check of the diagram name, d, plus what only the editor knows: a link to another
// provider's scheme, to a scheme another diagram holds or whose file is another diagram's, and registering anew
// while the linked scheme exists. A new scheme is proposed the group of the scheme exported last.
func (s *Server) exportCheck(ctx context.Context, x binding.ExportChecker, name string, d *slddoc.Diagram, register bool) (*binding.ExportCheck, error) {
	provider := s.bindings.Name()
	own := d.Scheme != nil && d.Scheme.Source == provider
	scheme := d.Scheme
	if !own || register {
		scheme = nil
	}
	check, err := x.CheckExport(ctx, name, d, scheme)
	if err != nil {
		return nil, err
	}
	l, linker := s.bindings.(binding.Linker)
	switch {
	case d.Scheme != nil && !own:
		check.Issues = slices.DeleteFunc(check.Issues, func(i binding.ExportIssue) bool { return i.Code == binding.IssueNotLinked })
		check.Add(binding.ExportIssue{Code: binding.IssueOtherSourceScheme, Severity: binding.SeverityError, Detail: d.Scheme.Source})
	case own && register:
		if linker {
			if _, err := l.Scheme(ctx, d.Scheme.Ref); err == nil {
				check.Add(binding.ExportIssue{Code: binding.IssueSchemeExists, Severity: binding.SeverityError, Detail: d.Scheme.Ref})
			} else if !errors.Is(err, binding.ErrNotFound) {
				return nil, err
			}
		}
	case scheme != nil:
		if holder := s.store.LinkedDiagrams(provider)[scheme.Ref]; holder != "" && holder != name {
			check.Add(binding.ExportIssue{Code: binding.IssueSchemeHeld, Severity: binding.SeverityError, Detail: holder})
		}
		if check.Scheme != nil {
			if other := diagramOfFile(check.Scheme.FileName); !scheme.Registered && !strings.EqualFold(other, name) && s.store.Exists(other) {
				check.Add(binding.ExportIssue{Code: binding.IssueFileOfDiagram, Severity: binding.SeverityError, Detail: other})
			}
			one := []binding.Scheme{*check.Scheme}
			s.withDiagrams(one)
			check.Scheme = &one[0]
		}
	}
	if check.Scheme == nil && linker {
		if ref := s.store.LastExported(provider); ref != "" {
			if last, err := l.Scheme(ctx, ref); err == nil {
				check.DefaultGroup = last.Group
			}
		}
	}
	return check, nil
}

// exportDiagram exports the saved diagram ?name= as the body's binding.ExportRequest, one export at a time; with
// Preview only what the export would change. After the provider commits,
// the diagram is saved with its scheme link and export time and its statuses cleared (a history entry like any
// save).
// 403 when export is off, 409 {error, check} when the check fails.
func (s *Server) exportDiagram(c *gin.Context, x binding.ExportChecker, e binding.Exporter) {
	if !binding.CanExport(s.bindings, s.cfg.Bindings) {
		c.JSON(http.StatusForbidden, gin.H{"error": "export to the provider is off (bindings.rsdu.export)"})
		return
	}
	var req binding.ExportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	s.exportMu.Lock()
	defer s.exportMu.Unlock()

	name := c.Query("name")
	d, err := s.store.Load(name)
	if err != nil {
		storageError(c, err)
		return
	}
	provider := s.bindings.Name()
	ctx := c.Request.Context()
	check, err := s.exportCheck(ctx, x, name, d, req.Register)
	if err != nil {
		bindingError(c, err)
		return
	}
	if !check.OK {
		c.JSON(http.StatusConflict, gin.H{"error": "the export check failed", "check": check})
		return
	}
	res, err := e.Export(ctx, name, d, req)
	if refused, ok := errors.AsType[*binding.ErrExportRefused](err); ok {
		c.JSON(http.StatusConflict, gin.H{"error": "the export check failed", "check": refused.Check})
		return
	}
	if err != nil {
		bindingError(c, err)
		return
	}
	if req.Preview {
		c.JSON(http.StatusOK, res)
		return
	}
	keep := map[int]bool{}
	for _, i := range res.Skipped {
		if i.Item > 0 {
			keep[i.Item] = true
		}
	}
	binding.ClearExported(d, provider, keep)
	d.Scheme = &res.Scheme
	rev := newRevision(c)
	rev.Time = *res.Scheme.Exported
	if _, err := s.store.SaveExported(name, d, rev); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  fmt.Sprintf("exported to scheme %s, but saving the diagram failed (link it to that scheme): %v", res.Scheme.Ref, err),
			"result": res,
		})
		return
	}
	s.presence.Saved(name, rev)
	if res.SVG, err = s.deliverSVG(ctx, name, d.Scheme); err != nil {
		res.SVGError = err.Error()
	}
	c.JSON(http.StatusOK, res)
}

// SVGExportResult answers POST /bindings/export/svg: the diagram's scheme link with its new export time and where the
// picture went.
type SVGExportResult struct {
	Scheme slddoc.SchemeRef `json:"scheme"`
	SVG    []string         `json:"svg"`
}

// exportSVG delivers only the saved SVG of the diagram ?name= to the provider's scheme it is linked to, writing
// nothing in the provider's database, and saves the diagram with that time as its export time, so later saves deliver
// it too; its binding statuses stay. 403 when export is off, 409 when the diagram isn't linked to a scheme of the
// provider, 502 when the delivery fails.
func (s *Server) exportSVG(c *gin.Context) {
	if !binding.CanExport(s.bindings, s.cfg.Bindings) {
		c.JSON(http.StatusForbidden, gin.H{"error": "export to the provider is off (bindings.rsdu.export)"})
		return
	}
	s.exportMu.Lock()
	defer s.exportMu.Unlock()

	name := c.Query("name")
	d, err := s.store.Load(name)
	if err != nil {
		storageError(c, err)
		return
	}
	if d.Scheme == nil || d.Scheme.Ref == "" || d.Scheme.Source != s.bindings.Name() {
		c.JSON(http.StatusConflict, gin.H{"error": "the diagram is not linked to a scheme of " + s.bindings.Name()})
		return
	}
	at := time.Now().UTC().Truncate(time.Second)
	scheme := *d.Scheme
	scheme.Exported = &at
	where, err := s.deliverSVG(c.Request.Context(), name, &scheme)
	if err != nil {
		bindingError(c, err)
		return
	}
	d.Scheme = &scheme
	rev := newRevision(c)
	rev.Time = at
	if _, err := s.store.SaveExported(name, d, rev); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("the picture was delivered, but saving the diagram failed: %v", err)})
		return
	}
	s.presence.Saved(name, rev)
	if where == nil {
		where = []string{}
	}
	c.JSON(http.StatusOK, SVGExportResult{Scheme: scheme, SVG: where})
}

// svgDeliveryTimeout is a watchdog: a delivery still running after it fails with an error.
const svgDeliveryTimeout = time.Minute

// deliverSVG delivers the saved SVG of the diagram name where the provider's viewer reads it, when export is on and
// the diagram is linked to a scheme of the provider that it was exported to.
func (s *Server) deliverSVG(ctx context.Context, name string, scheme *slddoc.SchemeRef) ([]string, error) {
	if s.bindings == nil || scheme == nil || scheme.Exported == nil || scheme.Source != s.bindings.Name() ||
		!binding.CanExport(s.bindings, s.cfg.Bindings) {
		return nil, nil
	}
	dl, ok := s.bindings.(binding.SVGDeliverer)
	if !ok {
		return nil, nil
	}
	svg, err := s.store.ReadSVG(name)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, svgDeliveryTimeout)
	defer cancel()
	return dl.DeliverSVG(ctx, scheme.Ref, svg, !scheme.Registered)
}
