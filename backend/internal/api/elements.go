package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// listElements serves the Elements palette catalog: every shape the
// configured element libraries define, in merge order.
func (s *Server) listElements(c *gin.Context) {
	c.JSON(http.StatusOK, s.lib.Symbols)
}
