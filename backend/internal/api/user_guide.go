package api

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
)

// userGuideMarkdown converts the user guide: CommonMark plus GitHub-style
// tables, with heading ids: explicit `{#id}` attributes (identical in every
// translation, so a dialog's "?" topic link works in any language) and
// automatic ones otherwise. Raw HTML inside the Markdown is not passed
// through (goldmark's default), so the result is safe to inject into the page.
var userGuideMarkdown = goldmark.New(
	goldmark.WithExtensions(extension.Table),
	goldmark.WithParserOptions(parser.WithAttribute(), parser.WithAutoHeadingID()),
)

// guideLang is what the lang query parameter must look like (a two-letter
// locale code); anything else is ignored, so it can never name another file.
var guideLang = regexp.MustCompile(`^[a-z]{2}$`)

// getUserGuide serves config.Config.UserGuide converted to an HTML fragment,
// read on every request so an edited guide shows without a restart. With
// ?lang=xx it serves the translation next to it (USER_GUIDE.xx.md for
// USER_GUIDE.md) when one exists, otherwise the configured guide. 404 when no
// guide is configured or the file doesn't exist.
func (s *Server) getUserGuide(c *gin.Context) {
	path := s.cfg.UserGuide
	if path == "" {
		errJSON(c, http.StatusNotFound, errors.New("no user guide configured"))
		return
	}
	if lang := c.Query("lang"); guideLang.MatchString(lang) {
		ext := filepath.Ext(path)
		translated := strings.TrimSuffix(path, ext) + "." + lang + ext
		if _, err := os.Stat(translated); err == nil {
			path = translated
		}
	}
	src, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		errJSON(c, http.StatusNotFound, fmt.Errorf("user guide %s not found", path))
		return
	}
	if err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	var html bytes.Buffer
	if err := userGuideMarkdown.Convert(src, &html); err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", html.Bytes())
}
