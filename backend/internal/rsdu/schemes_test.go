package rsdu

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"

	"sld-editor/internal/binding"
)

func schemesDB() *fakeDB {
	return &fakeDB{rows: func(q string, args []any) [][]any {
		switch {
		case strings.Contains(q, "FROM rsduadmin.VS_GROUP"):
			return [][]any{{int64(2), int64(1), "b child"}, {int64(1), nil, "A root"}, {int64(3), int64(3), "self"}}
		case strings.Contains(q, "WHERE f.ID = "):
			if args[0].(int64) == 10 {
				return [][]any{{int64(10), int64(2), int64(518), "Sub", nil, "Scheme", `C:\x\sub.xsde`, int64(1763018922)}}
			}
			return nil
		case strings.Contains(q, "FROM rsduadmin.VS_FORM f"):
			return [][]any{
				{int64(11), int64(1), nil, "zeta", nil, nil, nil, nil},
				{int64(10), int64(2), int64(518), "Sub", nil, "Scheme", `C:\x\sub.xsde`, int64(1763018922)},
			}
		case strings.Contains(q, "SELECT ID FROM rsduadmin.VS_FORM WHERE ID IN"):
			var out [][]any
			for _, a := range args {
				if a.(int64) < 100 {
					out = append(out, []any{a})
				}
			}
			return out
		}
		return nil
	}}
}

func TestSchemes(t *testing.T) {
	f := schemesDB()
	p := newFakeProvider(t, f)
	tree, err := p.Schemes(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(tree.Groups) != 3 || tree.Groups[0].Name != "A root" || tree.Groups[0].Parent != "" || tree.Groups[1].Parent != "1" || tree.Groups[2].Parent != "" {
		t.Errorf("groups %+v", tree.Groups)
	}
	if len(tree.Schemes) != 2 || tree.Schemes[0].Ref != "10" || tree.Schemes[1].Updated != nil {
		t.Fatalf("schemes %+v", tree.Schemes)
	}
	s := tree.Schemes[0]
	if s.Group != "2" || s.TypeID != "518" || s.FileName != `C:\x\sub.xsde` || s.Type != "Scheme" || s.Updated.Unix() != 1763018922 {
		t.Errorf("scheme %+v", s)
	}
	if one, err := p.Scheme(context.Background(), "10"); err != nil || one.Name != "Sub" {
		t.Errorf("Scheme = %+v, %v", one, err)
	}
	if _, err := p.Scheme(context.Background(), "12"); !errors.Is(err, binding.ErrNotFound) {
		t.Errorf("missing: %v", err)
	}
	if _, err := p.Scheme(context.Background(), "x"); !errors.Is(err, binding.ErrInvalid) {
		t.Errorf("bad ref: %v", err)
	}
}

func TestSchemesExist(t *testing.T) {
	f := schemesDB()
	p := newFakeProvider(t, f)
	refs := []string{"bad", "5", " 5", "500"}
	for i := range 1200 {
		refs = append(refs, strconv.Itoa(1000+i))
	}
	got, err := p.SchemesExist(context.Background(), refs)
	if err != nil {
		t.Fatal(err)
	}
	if got["bad"] || !got["5"] || !got[" 5"] || got["500"] {
		t.Errorf("exist %v", map[string]bool{"bad": got["bad"], "5": got["5"], " 5": got[" 5"], "500": got["500"]})
	}
	n := 0
	for _, q := range f.queries {
		if strings.Contains(q, "WHERE ID IN") {
			n++
			if c := strings.Count(q, "$"); c > existChunk {
				t.Errorf("chunk of %d", c)
			}
		}
	}
	if n != 3 {
		t.Errorf("%d IN queries, want 3", n)
	}
}
