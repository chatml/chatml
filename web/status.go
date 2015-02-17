package web

import (
	"net/http"
	"sync"
	"time"
)

// ChatmlStatusHandler implements http.Handler.
type ChatmlStatusHandler struct {
	mu sync.RWMutex

	BuildInfo map[string]string
	Config    string
	Flags     map[string]string

	Birth time.Time
}

func (h *ChatmlStatusHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	executeTemplate(w, "status", h)
}
