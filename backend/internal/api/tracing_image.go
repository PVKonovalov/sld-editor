package api

import (
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"sld-editor/internal/storage"
)

// maxTracingImage is the largest tracing image putTracingImage takes.
const maxTracingImage = 64 << 20

// putTracingImage: PUT /diagrams/tracing-image?name= stores the request body (a PNG, JPEG, GIF, WebP, BMP or SVG
// image) as the tracing image of the existing diagram name, replacing its earlier one; responds {file}. The diagram itself
// references it only once saved with a tracingImage.
func (s *Server) putTracingImage(c *gin.Context) {
	data, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, maxTracingImage))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			errJSON(c, http.StatusRequestEntityTooLarge, err)
			return
		}
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	file, err := s.store.SaveTracingImage(c.Query("name"), data)
	if errors.Is(err, storage.ErrNotImage) {
		errJSON(c, http.StatusUnsupportedMediaType, err)
		return
	}
	if err != nil {
		storageError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"file": file})
}

// getTracingImage: GET /diagrams/tracing-image?name= serves the tracing image file of diagram name (404 when none).
func (s *Server) getTracingImage(c *gin.Context) {
	path, err := s.store.TracingImagePath(c.Query("name"))
	if err != nil {
		storageError(c, err)
		return
	}
	c.Header("Cache-Control", "no-cache")
	// An SVG's scripts must not run, even when the URL is opened directly.
	c.Header("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
	c.Header("X-Content-Type-Options", "nosniff")
	c.File(path)
}
