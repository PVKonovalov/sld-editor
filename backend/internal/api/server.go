// Package api wires sld-editor's HTTP surface: diagram CRUD + rendering,
// the Elements palette catalog, and editor defaults, all served over Gin.
package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"sld-editor/internal/config"
	"sld-editor/internal/elements"
	"sld-editor/internal/storage"
)

// Server holds every dependency the HTTP handlers need.
type Server struct {
	router *gin.Engine
	store  *storage.Store
	lib    *elements.Library
	cfg    *config.Config
}

// NewServer builds a ready-to-run Server.
func NewServer(store *storage.Store, lib *elements.Library, cfg *config.Config) *Server {
	r := gin.Default()
	r.Use(allowLocalOrigins())
	// This is a local authoring tool served directly, never behind a
	// reverse proxy, so there is no X-Forwarded-For chain to trust.
	_ = r.SetTrustedProxies(nil)

	s := &Server{router: r, store: store, lib: lib, cfg: cfg}
	s.routes()
	return s
}

// Run starts the HTTP server, blocking until it stops or fails.
func (s *Server) Run(addr string) error {
	return s.router.Run(addr)
}

// Handler exposes the underlying http.Handler, for tests that want to drive
// requests with httptest instead of binding a real socket.
func (s *Server) Handler() http.Handler {
	return s.router
}

func (s *Server) routes() {
	grp := s.router.Group("/api")
	grp.GET("/diagrams", s.listDiagrams)
	grp.POST("/diagrams", s.createDiagram)
	grp.GET("/diagrams/:name", s.getDiagram)
	grp.PUT("/diagrams/:name", s.saveDiagram)
	grp.GET("/diagrams/:name/svg", s.renderDiagramSVG)
	grp.POST("/render", s.renderPreview)
	grp.GET("/elements", s.listElements)
	grp.GET("/config", s.getConfig)
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
