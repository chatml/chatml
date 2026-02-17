package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// ============================================================================
// Workflow handlers
// ============================================================================

func (h *Handlers) ListWorkflows(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workflows, err := h.store.ListWorkflows(ctx)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, workflows)
}

func (h *Handlers) GetWorkflow(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "workflowId")

	workflow, err := h.store.GetWorkflow(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if workflow == nil {
		writeNotFound(w, "workflow")
		return
	}
	writeJSON(w, workflow)
}

type CreateWorkflowRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

func (h *Handlers) CreateWorkflow(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req CreateWorkflowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.Name == "" {
		writeValidationError(w, "name is required")
		return
	}

	now := time.Now()
	workflow := &models.Workflow{
		ID:          uuid.New().String(),
		Name:        req.Name,
		Description: req.Description,
		Enabled:     true,
		GraphJSON:   "{}",
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if err := h.store.AddWorkflow(ctx, workflow); err != nil {
		writeDBError(w, err)
		return
	}
	writeJSONStatus(w, http.StatusCreated, workflow)
}

type UpdateWorkflowRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	Enabled     *bool   `json:"enabled,omitempty"`
	GraphJSON   *string `json:"graphJson,omitempty"`
	ToolPolicy  *string `json:"toolPolicy,omitempty"`
}

func (h *Handlers) UpdateWorkflow(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "workflowId")

	workflow, err := h.store.GetWorkflow(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if workflow == nil {
		writeNotFound(w, "workflow")
		return
	}

	var req UpdateWorkflowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Name != nil {
		workflow.Name = *req.Name
	}
	if req.Description != nil {
		workflow.Description = *req.Description
	}
	if req.Enabled != nil {
		workflow.Enabled = *req.Enabled
	}
	if req.GraphJSON != nil {
		workflow.GraphJSON = *req.GraphJSON
	}
	if req.ToolPolicy != nil {
		workflow.ToolPolicy = *req.ToolPolicy
	}

	if err := h.store.UpdateWorkflow(ctx, workflow); err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, workflow)
}

func (h *Handlers) DeleteWorkflow(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "workflowId")

	if err := h.store.DeleteWorkflow(ctx, id); err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, map[string]bool{"success": true})
}

func (h *Handlers) EnableWorkflow(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "workflowId")

	workflow, err := h.store.GetWorkflow(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if workflow == nil {
		writeNotFound(w, "workflow")
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	workflow.Enabled = req.Enabled
	if err := h.store.UpdateWorkflow(ctx, workflow); err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, workflow)
}

// ============================================================================
// Trigger handlers
// ============================================================================

func (h *Handlers) ListTriggers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workflowID := chi.URLParam(r, "workflowId")

	triggers, err := h.store.ListTriggers(ctx, workflowID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, triggers)
}

type CreateTriggerRequest struct {
	Type    models.TriggerType `json:"type"`
	Config  string             `json:"config"`
	Enabled *bool              `json:"enabled,omitempty"`
}

func (h *Handlers) CreateTrigger(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workflowID := chi.URLParam(r, "workflowId")

	var req CreateTriggerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if !models.ValidTriggerTypes[req.Type] {
		writeValidationError(w, "invalid trigger type")
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	config := req.Config
	if config == "" {
		config = "{}"
	}

	trigger := &models.Trigger{
		ID:         uuid.New().String(),
		WorkflowID: workflowID,
		Type:       req.Type,
		Config:     config,
		Enabled:    enabled,
	}

	if err := h.store.AddTrigger(ctx, trigger); err != nil {
		writeDBError(w, err)
		return
	}
	writeJSONStatus(w, http.StatusCreated, trigger)
}

func (h *Handlers) UpdateTrigger(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	triggerID := chi.URLParam(r, "triggerId")

	trigger, err := h.store.GetTrigger(ctx, triggerID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if trigger == nil {
		writeNotFound(w, "trigger")
		return
	}

	var req struct {
		Type    *models.TriggerType `json:"type,omitempty"`
		Config  *string             `json:"config,omitempty"`
		Enabled *bool               `json:"enabled,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Type != nil {
		if !models.ValidTriggerTypes[*req.Type] {
			writeValidationError(w, "invalid trigger type")
			return
		}
		trigger.Type = *req.Type
	}
	if req.Config != nil {
		trigger.Config = *req.Config
	}
	if req.Enabled != nil {
		trigger.Enabled = *req.Enabled
	}

	if err := h.store.UpdateTrigger(ctx, trigger); err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, trigger)
}

func (h *Handlers) DeleteTrigger(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	triggerID := chi.URLParam(r, "triggerId")

	if err := h.store.DeleteTrigger(ctx, triggerID); err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, map[string]bool{"success": true})
}

// ============================================================================
// Workflow Run handlers
// ============================================================================

func (h *Handlers) ListWorkflowRuns(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workflowID := chi.URLParam(r, "workflowId")

	runs, err := h.store.ListWorkflowRuns(ctx, workflowID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, runs)
}

type WorkflowRunDetail struct {
	models.WorkflowRun
	Steps []*models.StepRun `json:"steps"`
}

func (h *Handlers) GetWorkflowRun(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	runID := chi.URLParam(r, "runId")

	run, err := h.store.GetWorkflowRun(ctx, runID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if run == nil {
		writeNotFound(w, "workflow run")
		return
	}

	steps, err := h.store.ListStepRuns(ctx, runID)
	if err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, WorkflowRunDetail{
		WorkflowRun: *run,
		Steps:       steps,
	})
}

func (h *Handlers) TriggerWorkflowRun(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workflowID := chi.URLParam(r, "workflowId")

	if h.automationEngine == nil {
		writeValidationError(w, "automation engine not available")
		return
	}

	var req struct {
		InputData map[string]interface{} `json:"inputData,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// Allow empty body for manual triggers
		req.InputData = map[string]interface{}{}
	}
	if req.InputData == nil {
		req.InputData = map[string]interface{}{}
	}

	run, err := h.automationEngine.StartRun(ctx, workflowID, "", "manual", req.InputData)
	if err != nil {
		writeValidationError(w, err.Error())
		return
	}

	writeJSONStatus(w, http.StatusCreated, run)
}

func (h *Handlers) CancelWorkflowRun(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	runID := chi.URLParam(r, "runId")

	run, err := h.store.GetWorkflowRun(ctx, runID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if run == nil {
		writeNotFound(w, "workflow run")
		return
	}

	if run.Status != models.WorkflowRunStatusPending && run.Status != models.WorkflowRunStatusRunning {
		writeValidationError(w, "can only cancel pending or running workflows")
		return
	}

	// Signal the automation engine to cancel the active run.
	// If the engine owns this run, it will update the DB itself.
	engineOwned := false
	if h.automationEngine != nil {
		engineOwned = h.automationEngine.CancelRun(runID)
	}

	// Only update the DB directly if the engine didn't own the run
	// (e.g. a pending run that hasn't been picked up yet).
	if !engineOwned {
		now := time.Now()
		run.Status = models.WorkflowRunStatusCancelled
		run.CompletedAt = &now

		if err := h.store.UpdateWorkflowRun(ctx, run); err != nil {
			writeDBError(w, err)
			return
		}
	}

	// Re-read the run to return the latest state
	run, err = h.store.GetWorkflowRun(ctx, runID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, run)
}
