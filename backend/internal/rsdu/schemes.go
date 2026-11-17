package rsdu

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"sld-editor/internal/binding"
)

const (
	sqlSchemeGroups = "SELECT ID, ID_PARENT, NAME FROM {s}.VS_GROUP"
	sqlSchemes      = "SELECT f.ID, f.ID_NODE, f.NAME, t.NAME, f.FILE_NAME, f.LAST_UPDATE FROM {s}.VS_FORM f LEFT JOIN {s}.SYS_OTYP t ON t.ID = f.ID_TYPE"
	sqlSchemeByID   = sqlSchemes + " WHERE f.ID = ?"
	sqlSchemesIn    = "SELECT ID FROM {s}.VS_FORM WHERE ID IN (%s)"
	// existChunk keeps an IN list under Oracle's 1000 expressions.
	existChunk = 500
)

func scanScheme(r Rows) (binding.Scheme, error) {
	var id int64
	var group sql.NullInt64
	var name, typ, file sql.NullString
	var updated sql.NullInt64
	if err := r.Scan(&id, &group, &name, &typ, &file, &updated); err != nil {
		return binding.Scheme{}, err
	}
	s := binding.Scheme{Ref: strconv.FormatInt(id, 10), Name: name.String, Type: typ.String, FileName: file.String}
	if group.Valid {
		s.Group = strconv.FormatInt(group.Int64, 10)
	}
	if updated.Valid && updated.Int64 > 0 {
		at := time.Unix(updated.Int64, 0).UTC()
		s.Updated = &at
	}
	return s, nil
}

// Schemes returns VS_GROUP and VS_FORM, each sorted by name.
func (p *Provider) Schemes(ctx context.Context) (*binding.SchemeTree, error) {
	tree := &binding.SchemeTree{Groups: []binding.SchemeGroup{}, Schemes: []binding.Scheme{}}
	err := each(ctx, p.read, p.d.SQL(sqlSchemeGroups), func(r Rows) error {
		var id int64
		var parent sql.NullInt64
		var name sql.NullString
		if err := r.Scan(&id, &parent, &name); err != nil {
			return err
		}
		g := binding.SchemeGroup{ID: strconv.FormatInt(id, 10), Name: name.String}
		if parent.Valid && parent.Int64 != 0 && parent.Int64 != id {
			g.Parent = strconv.FormatInt(parent.Int64, 10)
		}
		tree.Groups = append(tree.Groups, g)
		return nil
	})
	if err != nil {
		return nil, err
	}
	err = each(ctx, p.read, p.d.SQL(sqlSchemes), func(r Rows) error {
		s, err := scanScheme(r)
		if err == nil {
			tree.Schemes = append(tree.Schemes, s)
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	sort.SliceStable(tree.Groups, func(i, j int) bool {
		return strings.ToLower(tree.Groups[i].Name) < strings.ToLower(tree.Groups[j].Name)
	})
	sort.SliceStable(tree.Schemes, func(i, j int) bool {
		return strings.ToLower(tree.Schemes[i].Name) < strings.ToLower(tree.Schemes[j].Name)
	})
	return tree, nil
}

// Scheme returns the VS_FORM row ref (its ID).
func (p *Provider) Scheme(ctx context.Context, ref string) (*binding.Scheme, error) {
	id, err := parseID("scheme id", ref)
	if err != nil {
		return nil, err
	}
	var found *binding.Scheme
	err = each(ctx, p.read, p.d.SQL(sqlSchemeByID), func(r Rows) error {
		s, err := scanScheme(r)
		found = &s
		return err
	}, id)
	if err != nil {
		return nil, err
	}
	if found == nil {
		return nil, fmt.Errorf("%w: scheme %d", binding.ErrNotFound, id)
	}
	return found, nil
}

// SchemesExist reports which of refs are VS_FORM rows; a malformed ref is reported missing.
func (p *Provider) SchemesExist(ctx context.Context, refs []string) (map[string]bool, error) {
	out := make(map[string]bool, len(refs))
	refOf := map[int64][]string{}
	var ids []any
	for _, r := range refs {
		out[r] = false
		if id, err := parseID("scheme id", r); err == nil {
			if refOf[id] == nil {
				ids = append(ids, id)
			}
			refOf[id] = append(refOf[id], r)
		}
	}
	for start := 0; start < len(ids); start += existChunk {
		chunk := ids[start:min(start+existChunk, len(ids))]
		q := p.d.SQL(fmt.Sprintf(sqlSchemesIn, strings.TrimSuffix(strings.Repeat("?, ", len(chunk)), ", ")))
		err := each(ctx, p.read, q, func(r Rows) error {
			var id int64
			if err := r.Scan(&id); err != nil {
				return err
			}
			for _, r := range refOf[id] {
				out[r] = true
			}
			return nil
		}, chunk...)
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}
