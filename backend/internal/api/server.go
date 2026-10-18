// Package api wires sld-editor's HTTP surface: diagram CRUD + rendering,
// the Elements palette catalog, and editor defaults, all served over Gin.
package api

import (
	"context"
	"errors"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"

	"sld-editor/internal/config"
	"sld-editor/internal/elements"
	"sld-editor/internal/presence"
	"sld-editor/internal/storage"
	"sld-editor/internal/webui"
)

// shutdownTimeout bounds how long Run waits for in-flight requests to
// finish once its context is cancelled, before forcing the listener
// closed — a diagram save/render is fast, so this only ever matters for a
// request that's genuinely stuck.
const shutdownTimeout = 10 * time.Second

// presenceTTL is how long a tab counts as having a diagram open after its
// last heartbeat: the frontend sends one every 60 s, so one may be missed.
const presenceTTL = 150 * time.Second

// Server holds every dependency the HTTP handlers need.
type Server struct {
	router *gin.Engine
	store  *storage.Store
	custom *storage.Store
	lib    *elements.Library
	cfg    *config.Config
	// presence tracks which tabs have which diagram open (POST /presence).
	presence *presence.Registry
}

// NewServer builds a ready-to-run Server. custom is the custom-elements
// store (config.Config.CustomElements.Dir), read-only from the API's side;
// nil serves an empty custom-elements list.
func NewServer(store, custom *storage.Store, lib *elements.Library, cfg *config.Config) *Server {
	r := gin.Default()
	// A diagram's rendered SVG and its JSON are repetitive text, so both
	// directions are compressed for the big-diagram-over-a-slow-link case:
	// responses for every browser (Accept-Encoding: gzip), and request
	// bodies the frontend sends with Content-Encoding: gzip (lib/api.ts
	// jsonBody), which are unpacked before any handler reads them.
	r.Use(gzip.Gzip(gzip.DefaultCompression, gzip.WithDecompressFn(gzip.DefaultDecompressHandle)))
	r.Use(allowLocalOrigins())
	// Trust X-Forwarded-For/X-Real-IP only from a reverse proxy on this
	// machine (e.g. nginx proxying to 127.0.0.1), so the client IP recorded
	// in the save history and shown by presence is the real one; a client
	// connecting directly cannot fake it.
	_ = r.SetTrustedProxies([]string{"127.0.0.1", "::1"})

	s := &Server{router: r, store: store, custom: custom, lib: lib, cfg: cfg, presence: presence.New(presenceTTL)}
	s.routes()
	return s
}

// Run starts the HTTP server, blocking until ctx is cancelled (a caught
// SIGINT/SIGTERM — see main.go) or the server fails to start. On
// cancellation it shuts down gracefully, letting any in-flight request
// finish (up to shutdownTimeout) rather than dropping it, and returns once
// the listener is fully closed. Builds its own *http.Server rather than
// using Gin's own router.Run convenience wrapper, since that wrapper blocks
// on http.ListenAndServe directly and exposes no way to call Shutdown.
func (s *Server) Run(ctx context.Context, addr string) error {
	httpServer := &http.Server{Addr: addr, Handler: s.router}

	errCh := make(chan error, 1)
	go func() {
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	return httpServer.Shutdown(shutdownCtx)
}

// Handler exposes the underlying http.Handler, for tests that want to drive
// requests with httptest instead of binding a real socket.
func (s *Server) Handler() http.Handler {
	return s.router
}

func (s *Server) routes() {
	grp := s.router.Group("/api")
	// name (getDiagram/saveDiagram/renderDiagramSVG) and dir (listDiagrams)
	// travel as query parameters, not :name path segments — see
	// getDiagram's own doc comment for why a subdirectory-qualified name
	// needs that.
	grp.GET("/diagrams", s.listDiagrams)
	grp.POST("/diagrams", s.createDiagram)
	grp.DELETE("/diagrams", s.deleteDiagram)
	grp.POST("/diagrams/rename", s.renameDiagram)
	grp.POST("/folders", s.createFolder)
	grp.POST("/folders/rename", s.renameFolder)
	grp.DELETE("/folders", s.deleteFolder)
	grp.GET("/diagrams/open", s.getDiagram)
	grp.PUT("/diagrams/save", s.saveDiagram)
	grp.GET("/diagrams/svg", s.renderDiagramSVG)
	grp.POST("/repair", s.repairDiagram)
	grp.POST("/render", s.renderPreview)
	grp.POST("/render/fragments", s.renderPreviewFragments)
	grp.POST("/export/xml", s.exportDiagramXML)
	grp.POST("/export/svg", s.exportDiagramSVG)
	grp.POST("/import/xml", s.importDiagramXML)
	grp.POST("/import/svg", s.importDiagramSVG)
	grp.POST("/import/xsde", s.importDiagramXSDE)
	grp.GET("/elements", s.listElements)
	grp.GET("/custom-elements", s.listCustomElements)
	grp.PUT("/custom-elements", s.saveCustomElement)
	grp.GET("/config", s.getConfig)
	grp.GET("/user-guide", s.getUserGuide)
	grp.POST("/presence", s.touchPresence)
	grp.GET("/presence/open", s.openTabs)

	s.mountWebUI()
}

// mountWebUI serves the frontend's own embedded production build
// (webui.Dist — see that package's own doc comment) for anything that
// doesn't match an /api route: normally just "/" and its own JS/CSS
// asset paths, since the frontend is a single-page app with no
// client-side router of its own. A plain http.FileServer already serves
// index.html for a directory request, so there's no separate SPA
// fallback to write; a genuinely unmatched path is a real 404 either
// way. Wired in via NoRoute rather than a Gin route pattern, since Gin's
// own routing tree doesn't cleanly let a wildcard static mount coexist
// with the sibling /api group registered above. An unmatched path that
// does start with /api (a typo'd or since-removed endpoint) still gets a
// JSON 404 here, not the frontend's own index.html, so a broken API call
// fails obviously instead of silently receiving an HTML document.
func (s *Server) mountWebUI() {
	sub, err := fs.Sub(webui.Dist, "dist")
	if err != nil {
		// dist/ is a fixed, always-embedded directory (see webui.go) —
		// this can only fail from a genuine bug in this package itself,
		// never from anything a caller or a config file controls.
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))
	s.router.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		fileServer.ServeHTTP(c.Writer, c.Request)
	})
}

// allowLocalOrigins is a permissive CORS policy: sld-editor is an internal
// authoring tool (no cookies/auth to protect), and its frontend dev server
// runs on a different port than the API during development, so every
// origin is allowed rather than hardcoding one.
func allowLocalOrigins() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func errJSON(c *gin.Context, status int, err error) {
	c.JSON(status, gin.H{"error": err.Error()})
}
