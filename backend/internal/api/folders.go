package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"sld-editor/internal/storage"
)

// storageError responds to a failed storage call: ErrInvalidName → 400, ErrNotFound → 404, ErrExists and
// ErrNotEmpty → 409, anything else → 500.
func storageError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, storage.ErrInvalidName):
		errJSON(c, http.StatusBadRequest, err)
	case errors.Is(err, storage.ErrNotFound):
		errJSON(c, http.StatusNotFound, err)
	case errors.Is(err, storage.ErrExists), errors.Is(err, storage.ErrNotEmpty):
		errJSON(c, http.StatusConflict, err)
	default:
		errJSON(c, http.StatusInternalServerError, err)
	}
}

// storageDone responds to a storage call that returns only an error: {} with status on success.
func storageDone(c *gin.Context, status int, err error) {
	if err != nil {
		storageError(c, err)
		return
	}
	c.JSON(status, gin.H{})
}

// createFolder: POST /folders?dir= creates an empty folder.
func (s *Server) createFolder(c *gin.Context) {
	storageDone(c, http.StatusCreated, s.store.CreateDir(c.Query("dir")))
}

// renameFolder: POST /folders/rename?from=&to= renames or moves a folder with its contents.
func (s *Server) renameFolder(c *gin.Context) {
	storageDone(c, http.StatusOK, s.store.RenameDir(c.Query("from"), c.Query("to")))
}

// deleteFolder: DELETE /folders?dir= deletes an empty folder.
func (s *Server) deleteFolder(c *gin.Context) {
	storageDone(c, http.StatusOK, s.store.DeleteDir(c.Query("dir")))
}

// renameDiagram: POST /diagrams/rename?from=&to= renames or moves a diagram.
func (s *Server) renameDiagram(c *gin.Context) {
	storageDone(c, http.StatusOK, s.store.Rename(c.Query("from"), c.Query("to")))
}

// deleteDiagram: DELETE /diagrams?name= deletes a diagram.
func (s *Server) deleteDiagram(c *gin.Context) {
	storageDone(c, http.StatusOK, s.store.Delete(c.Query("name")))
}

// openTabs: GET /presence/open?path=&session= responds {others: [{diagram, ip, since}]}, the other tabs that have
// the diagram path, or any diagram inside the folder path, open.
func (s *Server) openTabs(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"others": s.presence.OpenUnder(c.Query("path"), c.Query("session"), time.Now())})
}
