package api

import (
	"errors"
	"math"
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/PVKonovalov/slddoc"
	"sld-editor/internal/config"
)

var hexColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// SetConfigFile names the YAML file the configuration was read from, which POST /config/voltage-colors extends.
func (s *Server) SetConfigFile(path string) {
	s.configFile = path
}

// voltageColors returns a copy of the configured voltage_colors presets.
func (s *Server) voltageColors() []config.VoltageColor {
	s.cfgMu.RLock()
	defer s.cfgMu.RUnlock()
	return slices.Clone(s.cfg.VoltageColors)
}

// presetFor returns the voltage_colors preset for the voltage class name: the one naming the same voltage
// (slddoc.ParseVoltage), else the one with the same name. Nearest is false then; otherwise the result is the preset
// nearest in voltage (by ratio, so 400 kV is nearer 330 kV than 220 kV) and ok is false when there is none.
func presetFor(presets []config.VoltageColor, name string) (p config.VoltageColor, nearest, ok bool) {
	kv, hasKV := slddoc.ParseVoltage(name)
	norm := func(v string) string { return strings.ToLower(strings.TrimSpace(v)) }
	best := math.Inf(1)
	for _, c := range presets {
		pkv, pok := slddoc.ParseVoltage(c.Name)
		if hasKV && pok && pkv == kv || norm(c.Name) == norm(name) {
			return c, false, true
		}
		if hasKV && pok {
			if d := math.Abs(math.Log(kv / pkv)); d < best {
				best, p, ok = d, c, true
			}
		}
	}
	return p, ok, ok
}

// addVoltageColors: POST /config/voltage-colors appends the posted [{name, color}] presets (color "#rrggbb") to
// voltage_colors, in the configuration file and in the running server; one whose voltage or name a preset already
// has is left out. Responds {voltageColors}, the whole list now.
func (s *Server) addVoltageColors(c *gin.Context) {
	var in []config.VoltageColor
	if err := c.ShouldBindJSON(&in); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	for i := range in {
		in[i].Name, in[i].Color = strings.TrimSpace(in[i].Name), strings.ToLower(strings.TrimSpace(in[i].Color))
		if in[i].Name == "" || !hexColorRe.MatchString(in[i].Color) {
			errJSON(c, http.StatusBadRequest, errors.New("each voltage color needs a name and a #rrggbb color"))
			return
		}
	}

	s.cfgMu.Lock()
	defer s.cfgMu.Unlock()
	known := slices.Clone(s.cfg.VoltageColors)
	var add []config.VoltageColor
	for _, vc := range in {
		if _, nearest, ok := presetFor(known, vc.Name); ok && !nearest {
			continue
		}
		add = append(add, vc)
		known = append(known, vc)
	}
	if len(add) > 0 {
		if s.configFile == "" {
			errJSON(c, http.StatusConflict, errors.New("the configuration file is unknown"))
			return
		}
		if err := config.AppendVoltageColors(s.configFile, add); err != nil {
			errJSON(c, http.StatusInternalServerError, err)
			return
		}
		s.cfg.VoltageColors = append(s.cfg.VoltageColors, add...)
	}
	c.JSON(http.StatusOK, gin.H{"voltageColors": slices.Clone(s.cfg.VoltageColors)})
}
