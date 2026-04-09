package server

import (
	"net/http"
	"strconv"
)

// GetSpendStats returns aggregated cost data for the dashboard spend tracker.
// GET /api/stats/spend?days=14
func (h *Handlers) GetSpendStats(w http.ResponseWriter, r *http.Request) {
	days := 14
	if d := r.URL.Query().Get("days"); d != "" {
		if parsed, err := strconv.Atoi(d); err == nil && parsed > 0 && parsed <= 90 {
			days = parsed
		}
	}

	stats, err := h.store.GetSpendStats(r.Context(), days)
	if err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, stats)
}
