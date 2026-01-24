package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
)

// mockOrchestrator implements a minimal orchestrator interface for testing
type mockOrchestrator struct {
	agents      map[string]*models.OrchestratorAgent
	runs        map[string][]*models.AgentRun
	runningIDs  map[string]bool
	enableErr   error
	disableErr  error
	triggerErr  error
	reloadErr   error
	updateErr   error
	stopRunErr  error
	getRunsErr  error
	getRunErr   error
}

func newMockOrchestrator() *mockOrchestrator {
	return &mockOrchestrator{
		agents:     make(map[string]*models.OrchestratorAgent),
		runs:       make(map[string][]*models.AgentRun),
		runningIDs: make(map[string]bool),
	}
}

func (m *mockOrchestrator) ListAgents() []*models.OrchestratorAgent {
	result := make([]*models.OrchestratorAgent, 0, len(m.agents))
	for _, a := range m.agents {
		result = append(result, a)
	}
	return result
}

func (m *mockOrchestrator) GetAgent(id string) (*models.OrchestratorAgent, bool) {
	a, ok := m.agents[id]
	return a, ok
}

func (m *mockOrchestrator) IsAgentRunning(id string) bool {
	return m.runningIDs[id]
}

func (m *mockOrchestrator) ReloadAgents() error {
	return m.reloadErr
}

func (m *mockOrchestrator) EnableAgent(id string) error {
	if m.enableErr != nil {
		return m.enableErr
	}
	if a, ok := m.agents[id]; ok {
		a.Enabled = true
	}
	return nil
}

func (m *mockOrchestrator) DisableAgent(id string) error {
	if m.disableErr != nil {
		return m.disableErr
	}
	if a, ok := m.agents[id]; ok {
		a.Enabled = false
	}
	return nil
}

func (m *mockOrchestrator) UpdateAgentInterval(id string, intervalMs int) error {
	if m.updateErr != nil {
		return m.updateErr
	}
	if a, ok := m.agents[id]; ok {
		a.PollingIntervalMs = intervalMs
	}
	return nil
}

func (m *mockOrchestrator) TriggerAgentRun(id string) (*models.AgentRun, error) {
	if m.triggerErr != nil {
		return nil, m.triggerErr
	}
	run := &models.AgentRun{
		ID:        "run-123",
		AgentID:   id,
		Trigger:   models.AgentTriggerManual,
		Status:    models.AgentRunStatusRunning,
		StartedAt: time.Now(),
	}
	m.runs[id] = append(m.runs[id], run)
	return run, nil
}

func (m *mockOrchestrator) GetAgentRuns(agentID string, limit int) ([]*models.AgentRun, error) {
	if m.getRunsErr != nil {
		return nil, m.getRunsErr
	}
	runs := m.runs[agentID]
	if limit > 0 && len(runs) > limit {
		runs = runs[:limit]
	}
	return runs, nil
}

func (m *mockOrchestrator) GetAgentRun(runID string) (*models.AgentRun, error) {
	if m.getRunErr != nil {
		return nil, m.getRunErr
	}
	for _, runs := range m.runs {
		for _, run := range runs {
			if run.ID == runID {
				return run, nil
			}
		}
	}
	return nil, nil
}

func (m *mockOrchestrator) StopAgentRun(runID string) error {
	return m.stopRunErr
}

// orchestratorInterface defines the methods used by OrchestratorHandlers
// This allows testing with our mock
type orchestratorInterface interface {
	ListAgents() []*models.OrchestratorAgent
	GetAgent(id string) (*models.OrchestratorAgent, bool)
	IsAgentRunning(id string) bool
	ReloadAgents() error
	EnableAgent(id string) error
	DisableAgent(id string) error
	UpdateAgentInterval(id string, intervalMs int) error
	TriggerAgentRun(id string) (*models.AgentRun, error)
	GetAgentRuns(agentID string, limit int) ([]*models.AgentRun, error)
	GetAgentRun(runID string) (*models.AgentRun, error)
	StopAgentRun(runID string) error
}

// testOrchestratorHandlers wraps our mock for testing
type testOrchestratorHandlers struct {
	mock *mockOrchestrator
}

func newTestOrchestratorHandlers(mock *mockOrchestrator) *testOrchestratorHandlers {
	return &testOrchestratorHandlers{mock: mock}
}

func (h *testOrchestratorHandlers) ListAgents(w http.ResponseWriter, r *http.Request) {
	agents := h.mock.ListAgents()

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
			"isRunning":         h.mock.IsAgentRunning(agent.ID),
		}
		if agent.Definition != nil {
			item["definition"] = agent.Definition
		}
		response = append(response, item)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (h *testOrchestratorHandlers) ReloadAgents(w http.ResponseWriter, r *http.Request) {
	if err := h.mock.ReloadAgents(); err != nil {
		writeInternalError(w, "failed to reload agents", err)
		return
	}
	writeJSON(w, map[string]interface{}{
		"success": true,
		"count":   len(h.mock.ListAgents()),
	})
}

func (h *testOrchestratorHandlers) GetAgent(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "agentId")
	agent, ok := h.mock.GetAgent(agentID)
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
		"isRunning":         h.mock.IsAgentRunning(agent.ID),
	}
	if agent.Definition != nil {
		response["definition"] = agent.Definition
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (h *testOrchestratorHandlers) UpdateAgentState(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "agentId")

	var req struct {
		Enabled           *bool `json:"enabled,omitempty"`
		PollingIntervalMs *int  `json:"pollingIntervalMs,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Enabled != nil {
		if *req.Enabled {
			if err := h.mock.EnableAgent(agentID); err != nil {
				writeInternalError(w, "failed to enable agent", err)
				return
			}
		} else {
			if err := h.mock.DisableAgent(agentID); err != nil {
				writeInternalError(w, "failed to disable agent", err)
				return
			}
		}
	}

	if req.PollingIntervalMs != nil {
		if err := h.mock.UpdateAgentInterval(agentID, *req.PollingIntervalMs); err != nil {
			writeInternalError(w, "failed to update polling interval", err)
			return
		}
	}

	agent, ok := h.mock.GetAgent(agentID)
	if !ok {
		writeNotFound(w, "agent")
		return
	}

	writeJSON(w, agent)
}

func (h *testOrchestratorHandlers) TriggerAgentRun(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "agentId")

	run, err := h.mock.TriggerAgentRun(agentID)
	if err != nil {
		writeInternalError(w, "failed to trigger agent run", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(run)
}

func (h *testOrchestratorHandlers) ListAgentRuns(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "agentId")

	limit := 50
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := parseInt(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	runs, err := h.mock.GetAgentRuns(agentID, limit)
	if err != nil {
		writeInternalError(w, "failed to get agent runs", err)
		return
	}

	writeJSON(w, runs)
}

func (h *testOrchestratorHandlers) GetAgentRun(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runId")

	run, err := h.mock.GetAgentRun(runID)
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

func (h *testOrchestratorHandlers) StopAgentRun(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runId")

	if err := h.mock.StopAgentRun(runID); err != nil {
		writeInternalError(w, "failed to stop agent run", err)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

// Helper function
func parseInt(s string) (int, error) {
	var n int
	err := json.Unmarshal([]byte(s), &n)
	return n, err
}

// setupOrchestratorTestRouter creates a router with mock orchestrator handlers
func setupOrchestratorTestRouter(mock *mockOrchestrator) *chi.Mux {
	r := chi.NewRouter()
	h := newTestOrchestratorHandlers(mock)

	r.Route("/api/orchestrator/agents", func(r chi.Router) {
		r.Get("/", h.ListAgents)
		r.Post("/reload", h.ReloadAgents)
		r.Route("/{agentId}", func(r chi.Router) {
			r.Get("/", h.GetAgent)
			r.Patch("/", h.UpdateAgentState)
			r.Post("/run", h.TriggerAgentRun)
			r.Get("/runs", h.ListAgentRuns)
			r.Get("/runs/{runId}", h.GetAgentRun)
			r.Post("/runs/{runId}/stop", h.StopAgentRun)
		})
	})

	return r
}

// ============================================================================
// List Agents Tests
// ============================================================================

func TestOrchestratorHandlers_ListAgents_Empty(t *testing.T) {
	mock := newMockOrchestrator()
	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("GET", "/api/orchestrator/agents", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var response []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	require.Empty(t, response)
}

func TestOrchestratorHandlers_ListAgents_WithAgents(t *testing.T) {
	mock := newMockOrchestrator()
	now := time.Now()
	mock.agents["agent-1"] = &models.OrchestratorAgent{
		ID:        "agent-1",
		YAMLPath:  "/path/to/agent1.yaml",
		Enabled:   true,
		TotalRuns: 5,
		CreatedAt: now,
		UpdatedAt: now,
	}
	mock.agents["agent-2"] = &models.OrchestratorAgent{
		ID:        "agent-2",
		YAMLPath:  "/path/to/agent2.yaml",
		Enabled:   false,
		TotalRuns: 3,
		CreatedAt: now,
		UpdatedAt: now,
	}

	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("GET", "/api/orchestrator/agents", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var response []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	require.Len(t, response, 2)
}

func TestOrchestratorHandlers_ListAgents_IncludesDefinition(t *testing.T) {
	mock := newMockOrchestrator()
	now := time.Now()
	mock.agents["agent-1"] = &models.OrchestratorAgent{
		ID:        "agent-1",
		YAMLPath:  "/path/to/agent1.yaml",
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
		Definition: &models.AgentDefinition{
			ID:          "agent-1",
			Name:        "Test Agent",
			Type:        "polling",
			Description: "A test agent",
		},
	}

	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("GET", "/api/orchestrator/agents", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var response []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	require.Len(t, response, 1)

	_, hasDefinition := response[0]["definition"]
	require.True(t, hasDefinition, "response should include definition")
}

func TestOrchestratorHandlers_ListAgents_IncludesIsRunning(t *testing.T) {
	mock := newMockOrchestrator()
	now := time.Now()
	mock.agents["agent-1"] = &models.OrchestratorAgent{
		ID:        "agent-1",
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
	}
	mock.runningIDs["agent-1"] = true

	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("GET", "/api/orchestrator/agents", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var response []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	require.Len(t, response, 1)
	require.True(t, response[0]["isRunning"].(bool))
}

// ============================================================================
// Reload Agents Tests
// ============================================================================

func TestOrchestratorHandlers_ReloadAgents_Success(t *testing.T) {
	mock := newMockOrchestrator()
	mock.agents["agent-1"] = &models.OrchestratorAgent{ID: "agent-1"}
	mock.agents["agent-2"] = &models.OrchestratorAgent{ID: "agent-2"}

	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("POST", "/api/orchestrator/agents/reload", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	require.True(t, response["success"].(bool))
	require.Equal(t, float64(2), response["count"])
}

func TestOrchestratorHandlers_ReloadAgents_Error(t *testing.T) {
	mock := newMockOrchestrator()
	mock.reloadErr = context.DeadlineExceeded

	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("POST", "/api/orchestrator/agents/reload", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusInternalServerError, w.Code)
}

// ============================================================================
// Get Agent Tests
// ============================================================================

func TestOrchestratorHandlers_GetAgent_Success(t *testing.T) {
	mock := newMockOrchestrator()
	now := time.Now()
	mock.agents["agent-1"] = &models.OrchestratorAgent{
		ID:                "agent-1",
		YAMLPath:          "/path/to/agent.yaml",
		Enabled:           true,
		PollingIntervalMs: 60000,
		TotalRuns:         10,
		TotalCost:         1.25,
		CreatedAt:         now,
		UpdatedAt:         now,
	}

	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("GET", "/api/orchestrator/agents/agent-1", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	require.Equal(t, "agent-1", response["id"])
	require.True(t, response["enabled"].(bool))
	require.Equal(t, float64(60000), response["pollingIntervalMs"])
}

func TestOrchestratorHandlers_GetAgent_NotFound(t *testing.T) {
	mock := newMockOrchestrator()
	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("GET", "/api/orchestrator/agents/nonexistent", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusNotFound, w.Code)
}

// ============================================================================
// Update Agent State Tests
// ============================================================================

func TestOrchestratorHandlers_UpdateAgentState_Enable(t *testing.T) {
	mock := newMockOrchestrator()
	now := time.Now()
	mock.agents["agent-1"] = &models.OrchestratorAgent{
		ID:        "agent-1",
		Enabled:   false,
		CreatedAt: now,
		UpdatedAt: now,
	}

	router := setupOrchestratorTestRouter(mock)

	body, _ := json.Marshal(map[string]interface{}{"enabled": true})
	req := httptest.NewRequest("PATCH", "/api/orchestrator/agents/agent-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	require.True(t, mock.agents["agent-1"].Enabled)
}

func TestOrchestratorHandlers_UpdateAgentState_Disable(t *testing.T) {
	mock := newMockOrchestrator()
	now := time.Now()
	mock.agents["agent-1"] = &models.OrchestratorAgent{
		ID:        "agent-1",
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
	}

	router := setupOrchestratorTestRouter(mock)

	body, _ := json.Marshal(map[string]interface{}{"enabled": false})
	req := httptest.NewRequest("PATCH", "/api/orchestrator/agents/agent-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	require.False(t, mock.agents["agent-1"].Enabled)
}

func TestOrchestratorHandlers_UpdateAgentState_UpdateInterval(t *testing.T) {
	mock := newMockOrchestrator()
	now := time.Now()
	mock.agents["agent-1"] = &models.OrchestratorAgent{
		ID:                "agent-1",
		PollingIntervalMs: 60000,
		CreatedAt:         now,
		UpdatedAt:         now,
	}

	router := setupOrchestratorTestRouter(mock)

	body, _ := json.Marshal(map[string]interface{}{"pollingIntervalMs": 120000})
	req := httptest.NewRequest("PATCH", "/api/orchestrator/agents/agent-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, 120000, mock.agents["agent-1"].PollingIntervalMs)
}

func TestOrchestratorHandlers_UpdateAgentState_InvalidBody(t *testing.T) {
	mock := newMockOrchestrator()
	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("PATCH", "/api/orchestrator/agents/agent-1", bytes.NewReader([]byte("invalid json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusBadRequest, w.Code)
}

// ============================================================================
// Trigger Agent Run Tests
// ============================================================================

func TestOrchestratorHandlers_TriggerAgentRun_Success(t *testing.T) {
	mock := newMockOrchestrator()
	mock.agents["agent-1"] = &models.OrchestratorAgent{ID: "agent-1"}

	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("POST", "/api/orchestrator/agents/agent-1/run", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusCreated, w.Code)

	var response models.AgentRun
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	require.Equal(t, "run-123", response.ID)
	require.Equal(t, "agent-1", response.AgentID)
	require.Equal(t, models.AgentTriggerManual, response.Trigger)
}

func TestOrchestratorHandlers_TriggerAgentRun_Error(t *testing.T) {
	mock := newMockOrchestrator()
	mock.triggerErr = context.DeadlineExceeded

	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("POST", "/api/orchestrator/agents/agent-1/run", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusInternalServerError, w.Code)
}

// ============================================================================
// List Agent Runs Tests
// ============================================================================

func TestOrchestratorHandlers_ListAgentRuns_Default(t *testing.T) {
	mock := newMockOrchestrator()
	now := time.Now()
	mock.runs["agent-1"] = []*models.AgentRun{
		{ID: "run-1", AgentID: "agent-1", Status: models.AgentRunStatusCompleted, StartedAt: now},
		{ID: "run-2", AgentID: "agent-1", Status: models.AgentRunStatusRunning, StartedAt: now},
	}

	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("GET", "/api/orchestrator/agents/agent-1/runs", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var response []*models.AgentRun
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	require.Len(t, response, 2)
}

func TestOrchestratorHandlers_ListAgentRuns_CustomLimit(t *testing.T) {
	mock := newMockOrchestrator()
	now := time.Now()
	for i := 0; i < 10; i++ {
		mock.runs["agent-1"] = append(mock.runs["agent-1"], &models.AgentRun{
			ID:        "run-" + string(rune('0'+i)),
			AgentID:   "agent-1",
			Status:    models.AgentRunStatusCompleted,
			StartedAt: now,
		})
	}

	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("GET", "/api/orchestrator/agents/agent-1/runs?limit=5", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var response []*models.AgentRun
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	require.Len(t, response, 5)
}

func TestOrchestratorHandlers_ListAgentRuns_Empty(t *testing.T) {
	mock := newMockOrchestrator()
	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("GET", "/api/orchestrator/agents/agent-1/runs", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var response []*models.AgentRun
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	require.Empty(t, response)
}

// ============================================================================
// Get Agent Run Tests
// ============================================================================

func TestOrchestratorHandlers_GetAgentRun_Success(t *testing.T) {
	mock := newMockOrchestrator()
	now := time.Now()
	mock.runs["agent-1"] = []*models.AgentRun{
		{ID: "run-123", AgentID: "agent-1", Status: models.AgentRunStatusCompleted, StartedAt: now},
	}

	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("GET", "/api/orchestrator/agents/agent-1/runs/run-123", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var response models.AgentRun
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	require.Equal(t, "run-123", response.ID)
}

func TestOrchestratorHandlers_GetAgentRun_NotFound(t *testing.T) {
	mock := newMockOrchestrator()
	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("GET", "/api/orchestrator/agents/agent-1/runs/nonexistent", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusNotFound, w.Code)
}

// ============================================================================
// Stop Agent Run Tests
// ============================================================================

func TestOrchestratorHandlers_StopAgentRun_Success(t *testing.T) {
	mock := newMockOrchestrator()
	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("POST", "/api/orchestrator/agents/agent-1/runs/run-123/stop", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var response map[string]bool
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	require.True(t, response["success"])
}

func TestOrchestratorHandlers_StopAgentRun_Error(t *testing.T) {
	mock := newMockOrchestrator()
	mock.stopRunErr = context.DeadlineExceeded

	router := setupOrchestratorTestRouter(mock)

	req := httptest.NewRequest("POST", "/api/orchestrator/agents/agent-1/runs/run-123/stop", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusInternalServerError, w.Code)
}
