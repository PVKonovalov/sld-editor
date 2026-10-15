package api

import (
	"net/http"
	"net/netip"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/PVKonovalov/slddoc"
)

type presenceRequest struct {
	// Session is a random id the tab picks for itself.
	Session string `json:"session" binding:"required"`
	// Diagram is the open diagram's name, "" when the tab has none open or
	// is closing.
	Diagram string `json:"diagram"`
}

// touchPresence is a tab's heartbeat: it records which diagram the tab has
// open and returns presence.Status for it (the other tabs' IP addresses
// and the diagram's last save).
func (s *Server) touchPresence(c *gin.Context) {
	var req presenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errJSON(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, s.presence.Touch(req.Session, req.Diagram, clientIP(c), time.Now()))
}

// newRevision is the history entry for a save made by request c: now, to
// the second, and the client's IP address.
func newRevision(c *gin.Context) slddoc.Revision {
	return slddoc.Revision{Time: time.Now().UTC().Truncate(time.Second), IP: clientIP(c)}
}

// clientIP is the request's client IP address, in IPv4 form where it has one:
// the IPv6 loopback "::1" becomes "127.0.0.1" and an IPv4-mapped address
// ("::ffff:10.0.3.41") its IPv4 address. A real IPv6 address is unchanged.
func clientIP(c *gin.Context) string {
	ip := c.ClientIP()
	addr, err := netip.ParseAddr(ip)
	switch {
	case err != nil:
		return ip
	case addr == netip.IPv6Loopback():
		return "127.0.0.1"
	default:
		return addr.Unmap().String()
	}
}
