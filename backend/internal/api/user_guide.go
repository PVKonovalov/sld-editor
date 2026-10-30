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
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// userGuideMarkdown converts the user guide: CommonMark plus GitHub-style
// tables, with heading ids: explicit `{#id}` attributes (identical in every
// translation, so a dialog's "?" topic link works in any language) and
// automatic ones otherwise. Raw HTML inside the Markdown is not passed
// through (goldmark's default), so the result is safe to inject into the page.
// Relative image paths point at GET /api/user-guide/images/:name (guideImageLinks).
var userGuideMarkdown = goldmark.New(
	goldmark.WithExtensions(extension.Table),
	goldmark.WithParserOptions(parser.WithAttribute(), parser.WithAutoHeadingID(),
		parser.WithASTTransformers(util.Prioritized(guideImageLinks{}, 100))),
)

// userGuideImagesURL is where the guide's pictures are served.
const userGuideImagesURL = "/api/user-guide/images/"

// guideImageName is what a guide picture's file name must look like: no
// directories, a picture extension, so it can never name another file.
var guideImageName = regexp.MustCompile(`^[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?i:png|jpe?g|gif|webp|svg)$`)

// guideImageTypes maps a guide picture's extension to its Content-Type.
var guideImageTypes = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
	".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
}

// guideLangKey carries the language of a translated guide (a guideLang
// string) into guideImageLinks.
var guideLangKey = parser.NewContextKey()

// guideImageLinks rewrites an image written as "images/x.png" or "x.png" (as
// the Markdown reads in an editor, next to its images folder) to
// userGuideImagesURL + "x.png", with "?lang=xx" for a translated guide (see
// getUserGuideImage). Absolute URLs and anything else stay as they are.
type guideImageLinks struct{}

func (guideImageLinks) Transform(doc *ast.Document, _ text.Reader, pc parser.Context) {
	query := ""
	if lang, ok := pc.Get(guideLangKey).(string); ok {
		query = "?lang=" + lang
	}
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if img, ok := n.(*ast.Image); ok && entering {
			name := strings.TrimPrefix(string(img.Destination), "images/")
			if guideImageName.MatchString(name) {
				img.Destination = []byte(userGuideImagesURL + name + query)
			}
		}
		return ast.WalkContinue, nil
	})
}

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
	pc := parser.NewContext()
	if lang := c.Query("lang"); guideLang.MatchString(lang) {
		if translated := withLang(path, lang); fileExists(translated) {
			path = translated
			pc.Set(guideLangKey, lang)
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
	if err := userGuideMarkdown.Convert(src, &html, parser.WithContext(pc)); err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", html.Bytes())
}

// withLang names the translation of a guide file: x.png -> x.ru.png.
func withLang(path, lang string) string {
	ext := filepath.Ext(path)
	return strings.TrimSuffix(path, ext) + "." + lang + ext
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// getUserGuideImage serves a picture of the user guide from the images folder
// next to config.Config.UserGuide, read on every request like the guide. With
// ?lang=xx it serves the translated picture (x.xx.png for x.png) when one
// exists, otherwise the shared one. 404 for a name that isn't a plain picture
// file name or doesn't exist.
func (s *Server) getUserGuideImage(c *gin.Context) {
	name := c.Param("name")
	if s.cfg.UserGuide == "" || !guideImageName.MatchString(name) {
		errJSON(c, http.StatusNotFound, errors.New("image not found"))
		return
	}
	path := filepath.Join(filepath.Dir(s.cfg.UserGuide), "images", name)
	if lang := c.Query("lang"); guideLang.MatchString(lang) {
		if translated := withLang(path, lang); fileExists(translated) {
			path = translated
		}
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		errJSON(c, http.StatusNotFound, errors.New("image not found"))
		return
	}
	if err != nil {
		errJSON(c, http.StatusInternalServerError, err)
		return
	}
	// An SVG opened directly must not run scripts in the editor's origin.
	c.Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, guideImageTypes[strings.ToLower(filepath.Ext(name))], data)
}
