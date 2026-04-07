package server

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/chatml/chatml-core/scripts"
	"github.com/go-chi/chi/v5"
)

// GetWorkspaceConfig returns the .chatml/config.json for a workspace
func (h *Handlers) GetWorkspaceConfig(w http.ResponseWriter, r *http.Request) {
	repoID := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(r.Context(), repoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeError(w, http.StatusNotFound, ErrCodeNotFound, "workspace not found", nil)
		return
	}

	config, err := scripts.LoadConfig(repo.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, ErrCodeValidation, err.Error(), err)
		return
	}

	if config == nil {
		// Return empty config when no file exists
		config = &scripts.ChatMLConfig{
			SetupScripts: []scripts.ScriptDef{},
			RunScripts:   map[string]scripts.ScriptDef{},
			Hooks:        map[string]string{},
			AutoSetup:    false,
		}
	}

	writeJSON(w, config)
}

// UpdateWorkspaceConfig writes the .chatml/config.json for a workspace
func (h *Handlers) UpdateWorkspaceConfig(w http.ResponseWriter, r *http.Request) {
	repoID := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(r.Context(), repoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeError(w, http.StatusNotFound, ErrCodeNotFound, "workspace not found", nil)
		return
	}

	var config scripts.ChatMLConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		writeError(w, http.StatusBadRequest, ErrCodeValidation, "invalid JSON", err)
		return
	}

	if err := scripts.WriteConfig(repo.Path, &config); err != nil {
		writeInternalError(w, "failed to write config", err)
		return
	}

	writeJSON(w, config)
}

// DetectWorkspaceConfig auto-detects a suggested config from workspace files
func (h *Handlers) DetectWorkspaceConfig(w http.ResponseWriter, r *http.Request) {
	repoID := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(r.Context(), repoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeError(w, http.StatusNotFound, ErrCodeNotFound, "workspace not found", nil)
		return
	}

	config := scripts.DetectConfig(repo.Path)
	if config == nil {
		config = &scripts.ChatMLConfig{
			SetupScripts: []scripts.ScriptDef{},
			RunScripts:   map[string]scripts.ScriptDef{},
			Hooks:        map[string]string{},
			AutoSetup:    false,
		}
	}

	writeJSON(w, config)
}

// RunScript starts execution of a named run script
func (h *Handlers) RunScript(w http.ResponseWriter, r *http.Request) {
	if h.scriptRunner == nil {
		writeInternalError(w, "script runner not available", nil)
		return
	}

	repoID := chi.URLParam(r, "id")
	sessionID := chi.URLParam(r, "sessionId")

	session, workingPath, _, err := h.getSessionAndWorkspace(r.Context(), sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeError(w, http.StatusNotFound, ErrCodeNotFound, "session not found", nil)
		return
	}

	// Load config from workspace
	repo, err := h.store.GetRepo(r.Context(), repoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeError(w, http.StatusNotFound, ErrCodeNotFound, "workspace not found", nil)
		return
	}

	var req struct {
		ScriptKey string `json:"scriptKey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, ErrCodeValidation, "invalid JSON", err)
		return
	}

	config, err := scripts.LoadConfig(repo.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, ErrCodeValidation, "invalid config: "+err.Error(), err)
		return
	}
	if config == nil {
		writeError(w, http.StatusNotFound, ErrCodeNotFound, "no .chatml/config.json found", nil)
		return
	}

	script, ok := config.RunScripts[req.ScriptKey]
	if !ok {
		writeError(w, http.StatusNotFound, ErrCodeNotFound, "script not found: "+req.ScriptKey, nil)
		return
	}

	runID, err := h.scriptRunner.RunScript(context.Background(), sessionID, workingPath, req.ScriptKey, script)
	if err != nil {
		writeInternalError(w, "failed to start script", err)
		return
	}

	writeJSON(w, map[string]string{"runId": runID})
}

// RunSetupScripts re-runs all setup scripts for a session
func (h *Handlers) RunSetupScripts(w http.ResponseWriter, r *http.Request) {
	if h.scriptRunner == nil {
		writeInternalError(w, "script runner not available", nil)
		return
	}

	repoID := chi.URLParam(r, "id")
	sessionID := chi.URLParam(r, "sessionId")

	session, workingPath, _, err := h.getSessionAndWorkspace(r.Context(), sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeError(w, http.StatusNotFound, ErrCodeNotFound, "session not found", nil)
		return
	}

	repo, err := h.store.GetRepo(r.Context(), repoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeError(w, http.StatusNotFound, ErrCodeNotFound, "workspace not found", nil)
		return
	}

	config, err := scripts.LoadConfig(repo.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, ErrCodeValidation, "invalid config: "+err.Error(), err)
		return
	}
	if config == nil || len(config.SetupScripts) == 0 {
		writeError(w, http.StatusBadRequest, ErrCodeValidation, "no setup scripts configured", nil)
		return
	}

	if err := h.scriptRunner.RunSetupScripts(context.Background(), sessionID, workingPath, config.SetupScripts); err != nil {
		writeError(w, http.StatusConflict, ErrCodeValidation, err.Error(), err)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]string{"status": "started"})
}

// StopSessionScript stops a running script
func (h *Handlers) StopSessionScript(w http.ResponseWriter, r *http.Request) {
	if h.scriptRunner == nil {
		writeInternalError(w, "script runner not available", nil)
		return
	}

	var req struct {
		RunID string `json:"runId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, ErrCodeValidation, "invalid JSON", err)
		return
	}

	if err := h.scriptRunner.StopScript(req.RunID); err != nil {
		writeError(w, http.StatusBadRequest, ErrCodeValidation, err.Error(), err)
		return
	}

	writeJSON(w, map[string]string{"status": "stopped"})
}

// ListScriptRuns returns all script runs for a session
func (h *Handlers) ListScriptRuns(w http.ResponseWriter, r *http.Request) {
	if h.scriptRunner == nil {
		writeJSON(w, []interface{}{})
		return
	}

	sessionID := chi.URLParam(r, "sessionId")
	runs := h.scriptRunner.GetSessionRuns(sessionID)
	if runs == nil {
		runs = []*scripts.ScriptRun{}
	}

	writeJSON(w, runs)
}
