package api

import (
	"net/http"

	"github.com/PVKonovalov/slddoc"
	"github.com/gin-gonic/gin"

	"sld-editor/internal/config"
)

// designationRequest is POST /designations' body: the diagram as edited, the element ids to designate (empty: all),
// whether to renumber the ones already designated, and the label format ("short" numbers each letter code across the
// diagram, so short labels are unique).
type designationRequest struct {
	Diagram  slddoc.Diagram `json:"diagram"`
	Scope    []int          `json:"scope"`
	Renumber bool           `json:"renumber"`
	Format   string         `json:"format"`
}

// designateOptions builds slddoc.Designate's options from the letter_codes and designations configuration; grid is
// the diagram's grid step.
func (s *Server) designateOptions(grid float64) slddoc.DesignateOptions {
	d := s.cfg.Designations
	opt := slddoc.DesignateOptions{
		LetterCodes:         s.cfg.LetterCodes,
		FallbackVoltageCode: d.FallbackVoltageCode,
		Units:               map[slddoc.FunctionKind]slddoc.UnitCode{},
		Grid:                grid,
	}
	for _, v := range d.VoltageLevels {
		opt.VoltageLevels = append(opt.VoltageLevels, slddoc.VoltageCode{MaxKV: v.MaxKV, Code: v.Code})
	}
	for kind, u := range d.Units {
		opt.Units[slddoc.FunctionKind(config.DesignationUnitKinds[kind])] = slddoc.UnitCode{Code: u.Code, Digits: u.Digits}
	}
	return opt
}

// planDesignations proposes reference designations for a diagram (slddoc.Designate); it changes nothing.
func (s *Server) planDesignations(c *gin.Context) {
	var req designationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	grid := s.cfg.Editor.GridSpacing
	if e := req.Diagram.Editor; e != nil && e.GridSpacing > 0 {
		grid = e.GridSpacing
	}
	opt := s.designateOptions(grid)
	opt.Scope, opt.Renumber, opt.UniqueNumbers = req.Scope, req.Renumber, req.Format == slddoc.DesignationShort
	plan := slddoc.Designate(&req.Diagram, opt)
	if plan.Functions == nil {
		plan.Functions = []slddoc.Function{}
	}
	if plan.Rows == nil {
		plan.Rows = []slddoc.DesignationRow{}
	}
	if plan.Unplaced == nil {
		plan.Unplaced = []int{}
	}
	c.JSON(http.StatusOK, plan)
}
