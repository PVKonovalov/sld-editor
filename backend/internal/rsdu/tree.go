package rsdu

import (
	"cmp"
	"fmt"
	"slices"
	"strings"
)

// forest arranges nodes given by id and parent. top lists the nodes whose parent is 0 or not among the nodes, then
// one node of every cycle; children lists each node's children. Both hold indexes, sorted by name (case-insensitive),
// then id.
func forest(ids, parents []int64, names []string) (top []int, children map[int][]int) {
	byID := make(map[int64]int, len(ids))
	for i, id := range ids {
		byID[id] = i
	}
	children = map[int][]int{}
	for i, parent := range parents {
		if pi, ok := byID[parent]; ok && parent != 0 && pi != i {
			children[pi] = append(children[pi], i)
		} else {
			top = append(top, i)
		}
	}
	less := func(a, b int) int {
		if c := strings.Compare(strings.ToLower(names[a]), strings.ToLower(names[b])); c != 0 {
			return c
		}
		return cmp.Compare(ids[a], ids[b])
	}
	for _, c := range children {
		slices.SortFunc(c, less)
	}
	slices.SortFunc(top, less)

	seen := make([]bool, len(ids))
	var mark func(i int)
	mark = func(i int) {
		if seen[i] {
			return
		}
		seen[i] = true
		for _, c := range children[i] {
			mark(c)
		}
	}
	for _, i := range top {
		mark(i)
	}
	var cycles []int
	for i := range ids {
		if !seen[i] {
			cycles = append(cycles, i)
			mark(i)
		}
	}
	slices.SortFunc(cycles, less)
	return append(top, cycles...), children
}

// walk calls build for every node reachable from roots, depth first, each once; build gets the node's already built
// children.
func walk[T any](roots []int, children map[int][]int, build func(i int, kids []T) T) []T {
	seen := map[int]bool{}
	var visit func(i int) (T, bool)
	visit = func(i int) (T, bool) {
		var zero T
		if seen[i] {
			return zero, false
		}
		seen[i] = true
		var kids []T
		for _, c := range children[i] {
			if k, ok := visit(c); ok {
				kids = append(kids, k)
			}
		}
		return build(i, kids), true
	}
	out := []T{}
	for _, r := range roots {
		if n, ok := visit(r); ok {
			out = append(out, n)
		}
	}
	return out
}

// limitTree keeps of forest's top and children only the nodes on paths (node ids from a top node down): a path's last
// node with its whole subtree, a node on the way with only its children on a path. A path is followed up to where it
// breaks, and its last valid node is then only a node on the way. Returns the roots, the pruned children and a
// warning per broken path.
func limitTree(ids, parents []int64, top []int, children map[int][]int, paths [][]int64) (roots []int, kids map[int][]int, warnings []string) {
	byID := make(map[int64]int, len(ids))
	for i, id := range ids {
		byID[id] = i
	}
	on, full := map[int]bool{}, map[int]bool{}
	for _, path := range paths {
		prev := -1
		problem := ""
		for k, id := range path {
			i, ok := byID[id]
			switch {
			case !ok:
				problem = fmt.Sprintf("node %d is not in SYS_TREE21", id)
			case k == 0 && parents[i] != 0:
				problem = fmt.Sprintf("node %d is not a top node of SYS_TREE21 (its parent is %d)", id, parents[i])
			case k > 0 && parents[i] != ids[prev]:
				problem = fmt.Sprintf("node %d is not a child of node %d (%s)", id, ids[prev], parentNote(parents[i]))
			}
			if problem != "" {
				break
			}
			on[i] = true
			prev = i
		}
		switch {
		case problem == "":
			full[prev] = true
		case prev < 0:
			warnings = append(warnings, fmt.Sprintf("bindings.rsdu.sections: path %v: %s; path not shown", path, problem))
		default:
			warnings = append(warnings, fmt.Sprintf("bindings.rsdu.sections: path %v: %s; shown up to node %d, without its subtree", path, problem, ids[prev]))
		}
	}

	kids = map[int][]int{}
	for i := range on {
		kids[i] = slices.DeleteFunc(slices.Clone(children[i]), func(c int) bool { return !on[c] })
	}
	seen := map[int]bool{}
	var subtree func(i int)
	subtree = func(i int) {
		if seen[i] {
			return
		}
		seen[i] = true
		kids[i] = children[i]
		for _, c := range children[i] {
			subtree(c)
		}
	}
	for i := range full {
		subtree(i)
	}
	roots = slices.DeleteFunc(slices.Clone(top), func(i int) bool { return !on[i] })
	if len(roots) == 0 {
		warnings = append(warnings, "bindings.rsdu.sections: no path is valid; the Objects panel shows no sections")
	}
	return roots, kids, warnings
}

func parentNote(parent int64) string {
	if parent == 0 {
		return "it is a top node"
	}
	return fmt.Sprintf("its parent is %d", parent)
}
