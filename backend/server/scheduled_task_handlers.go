package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// CreateScheduledTaskRequest is the JSON body for creating a scheduled task
type CreateScheduledTaskRequest struct {
	Name               string `json:"name"`
	Description        string `json:"description"`
	Prompt             string `json:"prompt"`
	Model              string `json:"model"`
	PermissionMode     string `json:"permissionMode"`
	Frequency          string `json:"frequency"`
	CronExpression     string `json:"cronExpression"`
	ScheduleHour       int    `json:"scheduleHour"`
	ScheduleMinute     int    `json:"scheduleMinute"`
	ScheduleDayOfWeek  int    `json:"scheduleDayOfWeek"`
	ScheduleDayOfMonth int    `json:"scheduleDayOfMonth"`
}

// UpdateScheduledTaskRequest is the JSON body for updating a scheduled task
type UpdateScheduledTaskRequest struct {
	Name               *string `json:"name,omitempty"`
	Description        *string `json:"description,omitempty"`
	Prompt             *string `json:"prompt,omitempty"`
	Model              *string `json:"model,omitempty"`
	PermissionMode     *string `json:"permissionMode,omitempty"`
	Frequency          *string `json:"frequency,omitempty"`
	CronExpression     *string `json:"cronExpression,omitempty"`
	ScheduleHour       *int    `json:"scheduleHour,omitempty"`
	ScheduleMinute     *int    `json:"scheduleMinute,omitempty"`
	ScheduleDayOfWeek  *int    `json:"scheduleDayOfWeek,omitempty"`
	ScheduleDayOfMonth *int    `json:"scheduleDayOfMonth,omitempty"`
	Enabled            *bool   `json:"enabled,omitempty"`
}

// validateScheduleParams checks that schedule fields are within valid ranges
func validateScheduleParams(hour, minute, dayOfWeek, dayOfMonth int) string {
	if hour < 0 || hour > 23 {
		return "scheduleHour must be 0–23"
	}
	if minute < 0 || minute > 59 {
		return "scheduleMinute must be 0–59"
	}
	if dayOfWeek < 0 || dayOfWeek > 6 {
		return "scheduleDayOfWeek must be 0–6"
	}
	if dayOfMonth < 1 || dayOfMonth > 28 {
		return "scheduleDayOfMonth must be 1–28"
	}
	return ""
}

// ListAllScheduledTasks returns all scheduled tasks across all workspaces
// GET /api/scheduled-tasks
func (h *Handlers) ListAllScheduledTasks(w http.ResponseWriter, r *http.Request) {
	tasks, err := h.store.ListAllScheduledTasks(r.Context())
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, tasks)
}

// ListWorkspaceScheduledTasks returns scheduled tasks for a specific workspace
// GET /api/repos/{id}/scheduled-tasks
func (h *Handlers) ListWorkspaceScheduledTasks(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	tasks, err := h.store.ListScheduledTasks(r.Context(), workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, tasks)
}

// CreateScheduledTask creates a new scheduled task
// POST /api/repos/{id}/scheduled-tasks
func (h *Handlers) CreateScheduledTask(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")

	var req CreateScheduledTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Name == "" {
		writeValidationError(w, "name is required")
		return
	}
	if req.Prompt == "" {
		writeValidationError(w, "prompt is required")
		return
	}
	if req.Frequency == "" {
		req.Frequency = models.FrequencyDaily
	}
	if !models.ValidFrequencies[req.Frequency] {
		writeValidationError(w, "frequency must be one of: hourly, daily, weekly, monthly")
		return
	}
	if msg := validateScheduleParams(req.ScheduleHour, req.ScheduleMinute, req.ScheduleDayOfWeek, req.ScheduleDayOfMonth); msg != "" {
		writeValidationError(w, msg)
		return
	}

	// Verify workspace exists
	repo, err := h.store.GetRepo(r.Context(), workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	now := time.Now()
	task := &models.ScheduledTask{
		ID:                 uuid.New().String()[:8],
		WorkspaceID:        workspaceID,
		Name:               req.Name,
		Description:        req.Description,
		Prompt:             req.Prompt,
		Model:              req.Model,
		PermissionMode:     req.PermissionMode,
		Frequency:          req.Frequency,
		CronExpression:     req.CronExpression,
		ScheduleHour:       req.ScheduleHour,
		ScheduleMinute:     req.ScheduleMinute,
		ScheduleDayOfWeek:  req.ScheduleDayOfWeek,
		ScheduleDayOfMonth: req.ScheduleDayOfMonth,
		Enabled:            true,
		CreatedAt:          now,
		UpdatedAt:          now,
	}

	// Compute the first next_run_at
	task.NextRunAt = models.ComputeNextRun(task, now)

	if err := h.store.AddScheduledTask(r.Context(), task); err != nil {
		writeDBError(w, err)
		return
	}

	w.WriteHeader(http.StatusCreated)
	writeJSON(w, task)
}

// GetScheduledTask returns a single scheduled task
// GET /api/scheduled-tasks/{taskId}
func (h *Handlers) GetScheduledTask(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	task, err := h.store.GetScheduledTask(r.Context(), taskID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if task == nil {
		writeNotFound(w, "scheduled task")
		return
	}
	writeJSON(w, task)
}

// UpdateScheduledTask updates a scheduled task
// PATCH /api/scheduled-tasks/{taskId}
func (h *Handlers) UpdateScheduledTask(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")

	var req UpdateScheduledTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Validate frequency if being changed
	if req.Frequency != nil && !models.ValidFrequencies[*req.Frequency] {
		writeValidationError(w, "frequency must be one of: hourly, daily, weekly, monthly")
		return
	}
	// Validate schedule params if any are being changed
	if req.ScheduleHour != nil && (*req.ScheduleHour < 0 || *req.ScheduleHour > 23) {
		writeValidationError(w, "scheduleHour must be 0–23")
		return
	}
	if req.ScheduleMinute != nil && (*req.ScheduleMinute < 0 || *req.ScheduleMinute > 59) {
		writeValidationError(w, "scheduleMinute must be 0–59")
		return
	}
	if req.ScheduleDayOfWeek != nil && (*req.ScheduleDayOfWeek < 0 || *req.ScheduleDayOfWeek > 6) {
		writeValidationError(w, "scheduleDayOfWeek must be 0–6")
		return
	}
	if req.ScheduleDayOfMonth != nil && (*req.ScheduleDayOfMonth < 1 || *req.ScheduleDayOfMonth > 28) {
		writeValidationError(w, "scheduleDayOfMonth must be 1–28")
		return
	}

	err := h.store.UpdateScheduledTask(r.Context(), taskID, func(task *models.ScheduledTask) {
		if req.Name != nil {
			task.Name = *req.Name
		}
		if req.Description != nil {
			task.Description = *req.Description
		}
		if req.Prompt != nil {
			task.Prompt = *req.Prompt
		}
		if req.Model != nil {
			task.Model = *req.Model
		}
		if req.PermissionMode != nil {
			task.PermissionMode = *req.PermissionMode
		}
		if req.Frequency != nil {
			task.Frequency = *req.Frequency
		}
		if req.CronExpression != nil {
			task.CronExpression = *req.CronExpression
		}
		if req.ScheduleHour != nil {
			task.ScheduleHour = *req.ScheduleHour
		}
		if req.ScheduleMinute != nil {
			task.ScheduleMinute = *req.ScheduleMinute
		}
		if req.ScheduleDayOfWeek != nil {
			task.ScheduleDayOfWeek = *req.ScheduleDayOfWeek
		}
		if req.ScheduleDayOfMonth != nil {
			task.ScheduleDayOfMonth = *req.ScheduleDayOfMonth
		}
		if req.Enabled != nil {
			task.Enabled = *req.Enabled
		}

		// Recompute next_run_at if schedule changed
		if req.Frequency != nil || req.ScheduleHour != nil || req.ScheduleMinute != nil ||
			req.ScheduleDayOfWeek != nil || req.ScheduleDayOfMonth != nil || req.Enabled != nil {
			if task.Enabled {
				task.NextRunAt = models.ComputeNextRun(task, time.Now())
			} else {
				task.NextRunAt = nil
			}
		}
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeNotFound(w, "scheduled task")
			return
		}
		writeDBError(w, err)
		return
	}

	// Return updated task
	task, err := h.store.GetScheduledTask(r.Context(), taskID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if task == nil {
		writeNotFound(w, "scheduled task")
		return
	}
	writeJSON(w, task)
}

// DeleteScheduledTask deletes a scheduled task and its run history
// DELETE /api/scheduled-tasks/{taskId}
func (h *Handlers) DeleteScheduledTask(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if err := h.store.DeleteScheduledTask(r.Context(), taskID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeNotFound(w, "scheduled task")
			return
		}
		writeDBError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListScheduledTaskRuns returns recent runs for a scheduled task
// GET /api/scheduled-tasks/{taskId}/runs
func (h *Handlers) ListScheduledTaskRuns(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	runs, err := h.store.ListScheduledTaskRuns(r.Context(), taskID, limit)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, runs)
}

// TriggerScheduledTask manually triggers a scheduled task
// POST /api/scheduled-tasks/{taskId}/trigger
func (h *Handlers) TriggerScheduledTask(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")

	if h.scheduler == nil {
		writeInternalError(w, "scheduler not initialized", nil)
		return
	}

	run, err := h.scheduler.TriggerNow(r.Context(), taskID)
	if err != nil {
		writeInternalError(w, "failed to trigger task", err)
		return
	}

	w.WriteHeader(http.StatusCreated)
	writeJSON(w, run)
}
