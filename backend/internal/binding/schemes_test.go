package binding

import (
	"slices"
	"testing"
)

func TestRankCandidates(t *testing.T) {
	schemes := []Scheme{
		{Ref: "1", Name: "North sub 2", FileName: `C:\Modus\north\sub-2.xsde`},
		{Ref: "2", Name: "South sub 2", FileName: `south/SUB-2.svg`},
		{Ref: "3", Name: "Other", FileName: `other.svg`},
		{Ref: "4", Name: "Root sub 2", FileName: `sub-2.svg`},
		{Ref: "5", Name: "No file"},
		{Ref: "6", Name: "Imported", FileName: `D:/proj/area/feeder.xsde`},
	}
	brief := func(cs []Candidate) []string {
		var out []string
		for _, c := range cs {
			out = append(out, c.Ref+":"+c.Match)
		}
		return out
	}
	cases := []struct {
		name, diagram, source string
		want                  []string
	}{
		{"north folder", "north/sub-2", "", []string{"1:path", "4:name", "2:name"}},
		{"deeper south folder", "region/south/sub-2", "", []string{"2:path", "1:name", "4:name"}},
		{"south exact", "south/sub-2", "", []string{"2:path", "1:name", "4:name"}},
		{"root: the same-name file is exact, others ambiguous", "sub-2", "", []string{"4:path", "1:name", "2:name"}},
		{"source path", "x/new", "area/feeder.xsde", []string{"6:path"}},
		{"source base name only", "x/new", "feeder.xsde", []string{"6:name"}},
		{"bare source name is only a name match", "x/other-name", "other.xsde", []string{"3:name"}},
		{"nothing", "none", "", nil},
	}
	for _, c := range cases {
		if got := brief(RankCandidates(schemes, c.diagram, c.source)); !slices.Equal(got, c.want) {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
