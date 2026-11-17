package rsdu

import (
	"cmp"
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
