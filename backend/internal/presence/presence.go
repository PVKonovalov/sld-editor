// Package presence tracks, in memory, which browser tabs have which diagram
// open and who saved each diagram last, so every tab can warn its user that
// someone else is editing the same diagram.
package presence

import (
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/PVKonovalov/slddoc"
)

// Other is another tab with the same diagram open.
type Other struct {
	IP string `json:"ip"`
	// Since is when that tab opened the diagram.
	Since time.Time `json:"since"`
}

// Status is what one tab learns about the diagram it has open.
type Status struct {
	// Others are the other tabs with the same diagram open, in the order
	// they opened it.
	Others []Other `json:"others"`
	// LastSave is the diagram's most recent save seen by this server, nil
	// when there was none since it started.
	LastSave *slddoc.Revision `json:"lastSave,omitempty"`
}

type session struct {
	diagram string
	ip      string
	opened  time.Time
	seen    time.Time
}

// Registry is safe for concurrent use.
type Registry struct {
	ttl      time.Duration
	mu       sync.Mutex
	sessions map[string]session
	saves    map[string]slddoc.Revision
}

// New returns an empty Registry that forgets a tab ttl after its last Touch.
func New(ttl time.Duration) *Registry {
	return &Registry{ttl: ttl, sessions: map[string]session{}, saves: map[string]slddoc.Revision{}}
}

// Touch records that tab id (at ip) has diagram open at now, or has none
// open when diagram is "", and returns the diagram's Status for that tab.
func (r *Registry) Touch(id, diagram, ip string, now time.Time) Status {
	r.mu.Lock()
	defer r.mu.Unlock()
	for k, s := range r.sessions {
		if now.Sub(s.seen) > r.ttl {
			delete(r.sessions, k)
		}
	}
	if diagram == "" {
		delete(r.sessions, id)
		return Status{Others: []Other{}}
	}
	opened := now
	if old, ok := r.sessions[id]; ok && old.diagram == diagram {
		opened = old.opened
	}
	r.sessions[id] = session{diagram: diagram, ip: ip, opened: opened, seen: now}

	st := Status{Others: []Other{}}
	for k, s := range r.sessions {
		if k != id && s.diagram == diagram {
			st.Others = append(st.Others, Other{IP: s.ip, Since: s.opened})
		}
	}
	slices.SortFunc(st.Others, func(a, b Other) int {
		if c := a.Since.Compare(b.Since); c != 0 {
			return c
		}
		return strings.Compare(a.IP, b.IP)
	})
	if rev, ok := r.saves[diagram]; ok {
		st.LastSave = &rev
	}
	return st
}

// Saved records rev as diagram's most recent save.
func (r *Registry) Saved(diagram string, rev slddoc.Revision) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.saves[diagram] = rev
}
