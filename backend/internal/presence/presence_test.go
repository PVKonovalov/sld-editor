package presence

import (
	"slices"
	"testing"
	"time"

	"github.com/PVKonovalov/slddoc"
)

func TestTouch(t *testing.T) {
	r := New(150 * time.Second)
	t0 := time.Date(2026, 10, 15, 10, 0, 0, 0, time.UTC)

	if st := r.Touch("a", "sub/A", "10.0.0.1", t0); len(st.Others) != 0 || st.LastSave != nil {
		t.Fatalf("first tab: %+v", st)
	}
	r.Touch("b", "sub/B", "10.0.0.2", t0)
	r.Touch("b", "sub/A", "10.0.0.2", t0.Add(30*time.Second))
	r.Touch("b", "sub/A", "10.0.0.2", t0.Add(time.Minute))
	r.Touch("c", "sub/B", "10.0.0.3", t0)
	r.Touch("e", "sub/A", "10.0.0.5", t0.Add(10*time.Second))
	want := []Other{{IP: "10.0.0.5", Since: t0.Add(10 * time.Second)}, {IP: "10.0.0.2", Since: t0.Add(30 * time.Second)}}
	if st := r.Touch("a", "sub/A", "10.0.0.1", t0.Add(time.Minute)); !slices.Equal(st.Others, want) {
		t.Errorf("Others = %v, want %v", st.Others, want)
	}
	r.Touch("e", "", "10.0.0.5", t0.Add(time.Minute))

	rev := slddoc.Revision{Time: t0.Add(2 * time.Minute), IP: "10.0.0.2"}
	r.Saved("sub/A", rev)
	if st := r.Touch("a", "sub/A", "10.0.0.1", t0.Add(2*time.Minute)); st.LastSave == nil || *st.LastSave != rev {
		t.Errorf("LastSave = %v, want %v", st.LastSave, rev)
	}

	// b's last heartbeat is now older than the ttl.
	if st := r.Touch("a", "sub/A", "10.0.0.1", t0.Add(4*time.Minute)); len(st.Others) != 0 {
		t.Errorf("expired tab still listed: %v", st.Others)
	}

	r.Touch("d", "sub/A", "10.0.0.4", t0.Add(4*time.Minute))
	r.Touch("d", "", "10.0.0.4", t0.Add(4*time.Minute))
	if st := r.Touch("a", "sub/A", "10.0.0.1", t0.Add(4*time.Minute)); len(st.Others) != 0 {
		t.Errorf("a tab that left is still listed: %v", st.Others)
	}
}
