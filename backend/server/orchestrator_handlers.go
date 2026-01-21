package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/chatml/chatml-backend/orchestrator"
	"github.com/go-chi/chi/v5"
)

// OrchestratorHandlers provides HTTP handlers for the agent orchestrator
type OrchestratorHandlers struct {
	orch *orchestrator.Orchestrator
}

// NewOrchestratorHandlers creates new orchestrator handlers
func NewOrchestratorHandlers(orch *orchestrator.Orchestrator) *OrchestratorHandlers {
	return &OrchestratorHandlers{orch: orch}
}

// ListAgents returns all orchestrator agents
// GET /api/orchestrator/agents
func (h *OrchestratorHandlers) ListAgents(w http.ResponseWriter, r *http.Request) {
	agents := h.orch.ListAgents()

	response := make([]map[string]interface{}, 0, len(agents))
	for _, agent := range agents {
		item := map[string]interface{}{
			"id":                agent.ID,
			"yamlPath":          agent.YAMLPath,
			"enabled":           agent.Enabled,
			"pollingIntervalMs": agent.PollingIntervalMs,
			"lastRunAt":         agent.LastRunAt,
			"lastError":         agent.LastError,
			"totalRuns":         agent.TotalRuns,
			"totalCost":         agent.TotalCost,
			"createdAt":         agent.CreatedAt,
			"updatedAt":         agent.UpdatedAt,
			"isRunning":         h.orch.IsAgentRunning(agent.ID),
		}

		// Include definition if loaded
		if agent.Definition != nil {
			item["definition"] = agent.Definition
		}

		response = append(response, item)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// ReloadAgents reloads agent definitions from YAML files
// POST /api/orchestrator/agents/reload
func (h *OrchestratorHandlers) ReloadAgents(w http.ResponseWriter, r *http.Request) {
	if err := h.orch.ReloadAgents(); err != nil {
		writeInternalError(w, "failed to reload agents", err)
		return
	}

	writeJSON(w, map[string]interface{}{
		"success": true,
		"count":   len(h.orch.ListAgents()),
	})
}

// GetAgent returns a single orchestrator agent
// GET /api/orchestrator/agents/{agentId}
func (h *OrchestratorHandlers) GetAgent(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "agentId")

	agent, ok := h.orch.GetAgent(agentID)
	if !ok {
		writeNotFound(w, "agent")
		return
	}

	response := map[string]interface{}{
		"id":                agent.ID,
		"yamlPath":          agent.YAMLPath,
		"enabled":           agent.Enabled,
		"pollingIntervalMs": agent.PollingIntervalMs,
		"lastRunAt":         agent.LastRunAt,
		"lastError":         agent.LastError,
		"totalRuns":         agent.TotalRuns,
		"totalCost":         agent.TotalCost,
		"createdAt":         agent.CreatedAt,
		"updatedAt":         agent.UpdatedAt,
		"isRunning":         h.orch.IsAgentRunning(agent.ID),
	}

	if agent.Definition != nil {
		response["definition"] = agent.Definition
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// UpdateAgentState updates an agent's runtime state (enable/disable, interval)
// PATCH /api/orchestrator/agents/{agentId}
func (h *OrchestratorHandlers) UpdateAgentState(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "agentId")

	var req struct {
		Enabled           *bool `json:"enabled,omitempty"`
		PollingIntervalMs *int  `json:"pollingIntervalMs,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Update enabled state
	if req.Enabled != nil {
		if *req.Enabled {
			if err := h.orch.EnableAgent(agentID); err != nil {
				writeInternalError(w, "failed to enable agent", err)
				return
			}
		} else {
			if err := h.orch.DisableAgent(agentID); err != nil {
				writeInternalError(w, "failed to disable agent", err)
				return
			}
		}
	}

	// Update polling interval
	if req.PollingIntervalMs != nil {
		if err := h.orch.UpdateAgentInterval(agentID, *req.PollingIntervalMs); err != nil {
			writeInternalError(w, "failed to update polling interval", err)
			return
		}
	}

	// Return updated agent
	agent, ok := h.orch.GetAgent(agentID)
	if !ok {
		writeNotFound(w, "agent")
		return
	}

	writeJSON(w, agent)
}

// TriggerAgentRun manually triggers an agent run
// POST /api/orchestrator/agents/{agentId}/run
func (h *OrchestratorHandlers) TriggerAgentRun(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "agentId")

	run, err := h.orch.TriggerAgentRun(agentID)
	if err != nil {
		writeInternalError(w, "failed to trigger agent run", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(run)
}

// ListAgentRuns returns run history for an agent
// GET /api/orchestrator/agents/{agentId}/runs
func (h *OrchestratorHandlers) ListAgentRuns(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "agentId")

	limit := 50
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	runs, err := h.orch.GetAgentRuns(agentID, limit)
	if err != nil {
		writeInternalError(w, "failed to get agent runs", err)
		return
	}

	writeJSON(w, runs)
}

// GetAgentRun returns a specific agent run
// GET /api/orchestrator/agents/{agentId}/runs/{runId}
func (h *OrchestratorHandlers) GetAgentRun(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runId")

	run, err := h.orch.GetAgentRun(runID)
	if err != nil {
		writeInternalError(w, "failed to get agent run", err)
		return
	}
	if run == nil {
		writeNotFound(w, "run")
		return
	}

	writeJSON(w, run)
}

// StopAgentRun stops a running agent run
// POST /api/orchestrator/agents/{agentId}/runs/{runId}/stop
func (h *OrchestratorHandlers) StopAgentRun(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runId")

	if err := h.orch.StopAgentRun(runID); err != nil {
		writeInternalError(w, "failed to stop agent run", err)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}
