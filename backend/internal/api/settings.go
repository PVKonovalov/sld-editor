package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type editorDefaults struct {
	GridSpacing float64 `json:"gridSpacing"`
	Snap        bool    `json:"snap"`
	ShowGrid    bool    `json:"showGrid"`
	Background  string  `json:"background"`
}

// getConfig serves the Settings panel's defaults: the editor preferences a
// diagram falls back to when it hasn't saved its own, the default
// voltage-color palette offered when adding a voltage class, and the
// global state->color legend the Properties panel's State dropdown offers
// for a switching device.
func (s *Server) getConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"editor": editorDefaults{
			GridSpacing: s.cfg.Editor.GridSpacing,
			Snap:        s.cfg.Editor.Snap,
			ShowGrid:    s.cfg.Editor.ShowGrid,
			Background:  s.cfg.Editor.Background,
		},
		"voltageColors": s.cfg.VoltageColors,
		"stateColors":   s.cfg.StateColors,
	})
}
