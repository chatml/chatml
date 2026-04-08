package server

import (
	"net/http"
	"os/exec"

	"github.com/chatml/chatml-backend/store"
)

// HealthReadyDeps holds dependencies needed for the readiness check.
type HealthReadyDeps struct {
	Store    *store.SQLiteStore
	GHReady func() bool // returns true if GitHub auth is valid
}

// HandleHealthReady returns a health status check that reports subsystem health.
// Only the database is treated as required (affects the status code);
// agent-runner and GitHub auth are informational-only.
func HandleHealthReady(deps HealthReadyDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		checks := map[string]interface{}{}
		allOK := true

		// Database check
		if deps.Store != nil {
			if err := deps.Store.Ping(r.Context()); err != nil {
				checks["database"] = map[string]string{"status": "unhealthy", "error": err.Error()}
				allOK = false
			} else {
				checks["database"] = map[string]string{"status": "healthy"}
			}
		}

		// Agent-runner binary check
		if _, err := exec.LookPath("agent-runner"); err != nil {
			// Also check the common name
			if _, err2 := exec.LookPath("chatml-agent-runner"); err2 != nil {
				checks["agent_runner"] = map[string]string{"status": "unavailable", "note": "not in PATH"}
			} else {
				checks["agent_runner"] = map[string]string{"status": "healthy"}
			}
		} else {
			checks["agent_runner"] = map[string]string{"status": "healthy"}
		}

		// GitHub auth check
		if deps.GHReady != nil {
			if deps.GHReady() {
				checks["github"] = map[string]string{"status": "authenticated"}
			} else {
				checks["github"] = map[string]string{"status": "not_authenticated"}
			}
		}

		status := http.StatusOK
		if !allOK {
			status = http.StatusServiceUnavailable
		}

		writeJSONStatus(w, status, map[string]interface{}{
			"status": map[bool]string{true: "ready", false: "not_ready"}[allOK],
			"checks": checks,
		})
	}
}
