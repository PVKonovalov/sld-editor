package binding

import (
	"context"
	"path"
	"sort"
	"strings"
	"time"
)

// SchemeGroup is a folder of the provider's schemes (RSDU: VS_GROUP); Parent is "" for a root group.
type SchemeGroup struct {
	ID     string `json:"id"`
	Parent string `json:"parent,omitempty"`
	Name   string `json:"name"`
}

// Scheme is a provider's scheme a diagram can be linked to (RSDU: VS_FORM). Diagram is the linked diagram, filled
// from the editor's link index.
type Scheme struct {
	Ref      string     `json:"ref"`
	Group    string     `json:"group"`
	Name     string     `json:"name"`
	Type     string     `json:"type,omitempty"`
	TypeID   string     `json:"typeId,omitempty"`
	FileName string     `json:"fileName,omitempty"`
	Updated  *time.Time `json:"updated,omitempty"`
	Diagram  string     `json:"diagram,omitempty"`
}

// SchemeTree is every group and scheme of a provider.
type SchemeTree struct {
	Groups  []SchemeGroup `json:"groups"`
	Schemes []Scheme      `json:"schemes"`
}

// Linker is a Provider whose schemes diagrams can be linked to.
type Linker interface {
	// Schemes returns every group and scheme.
	Schemes(ctx context.Context) (*SchemeTree, error)
	// Scheme returns the scheme ref; ErrNotFound when it does not exist, ErrInvalid for a malformed ref.
	Scheme(ctx context.Context, ref string) (*Scheme, error)
	// SchemesExist reports which of refs exist.
	SchemesExist(ctx context.Context, refs []string) (map[string]bool, error)
}

// Match kinds of a Candidate.
const (
	MatchPath = "path" // the scheme's file name ends with the diagram's path or its source path
	MatchName = "name" // only the base name matches: ambiguous
)

// Candidate is a scheme proposed for a diagram.
type Candidate struct {
	Scheme
	Match string `json:"match"`
}

// normalizeFileName returns a file name for comparison: "\" → "/", no extension, lower case, no leading "./" or "/".
func normalizeFileName(name string) string {
	n := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(name), `\`, "/"))
	n = strings.TrimSuffix(n, path.Ext(n))
	return strings.TrimLeft(strings.TrimPrefix(n, "./"), "/")
}

// endsWithPath reports whether file (normalized) is p or ends with "/" + p.
func endsWithPath(file, p string) bool {
	return p != "" && (file == p || strings.HasSuffix(file, "/"+p))
}

// pathMatch reports whether file and p are equal, or one ends with the other where that one has a folder (a bare base
// name is only ambiguous).
func pathMatch(file, p string) bool {
	return p != "" && (file == p || strings.Contains(p, "/") && endsWithPath(file, p) || strings.Contains(file, "/") && endsWithPath(p, file))
}

// RankCandidates returns the schemes whose file name matches the diagram name (its path relative to the diagrams
// directory) or its source (the file it was imported from, "" when none): path matches (one path ends with the
// other, folders included; a source without a folder, as a browser upload has, never is) first, then base-name
// matches; by name within each.
func RankCandidates(schemes []Scheme, name, source string) []Candidate {
	diagram := normalizeFileName(name)
	src := normalizeFileName(source)
	base := path.Base(diagram)
	var out []Candidate
	for _, s := range schemes {
		file := normalizeFileName(s.FileName)
		if file == "" {
			continue
		}
		switch {
		case pathMatch(file, diagram), strings.Contains(src, "/") && pathMatch(file, src):
			out = append(out, Candidate{Scheme: s, Match: MatchPath})
		case path.Base(file) == base || src != "" && path.Base(file) == path.Base(src):
			out = append(out, Candidate{Scheme: s, Match: MatchName})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Match != out[j].Match {
			return out[i].Match == MatchPath
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}
