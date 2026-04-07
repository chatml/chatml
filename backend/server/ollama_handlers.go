package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"

	"github.com/chatml/chatml-backend/ollama"
)

// validModelName limits model names to safe characters (alphanumeric, dots, dashes, colons, slashes)
// and a reasonable length. Rejects empty strings and overly long names.
var validModelName = regexp.MustCompile(`^[a-zA-Z0-9._:/-]{1,128}$`)

// OllamaHandlers serves REST endpoints for managing the bundled Ollama runtime.
type OllamaHandlers struct {
	mgr *ollama.Manager
	hub *Hub
}

// NewOllamaHandlers creates handlers wired to the given Ollama manager.
// Progress events are wired at manager construction time (see main.go).
func NewOllamaHandlers(mgr *ollama.Manager, hub *Hub) *OllamaHandlers {
	return &OllamaHandlers{mgr: mgr, hub: hub}
}

// GetStatus returns the current Ollama installation and runtime state.
// GET /api/ollama/status
func (h *OllamaHandlers) GetStatus(w http.ResponseWriter, r *http.Request) {
	status := h.mgr.Status(r.Context())
	writeJSON(w, status)
}

// Install triggers Ollama binary download if not already present.
// The download runs in the background; progress is streamed via WebSocket.
// Returns 202 Accepted immediately so the HTTP request doesn't block.
// POST /api/ollama/install
func (h *OllamaHandlers) Install(w http.ResponseWriter, r *http.Request) {
	if h.mgr.IsInstalled() {
		writeJSON(w, map[string]string{"status": "already_installed"})
		return
	}

	go func() {
		if err := h.mgr.Install(context.Background()); err != nil {
			log.Printf("ollama: install failed: %v", err)
			h.broadcastError("ollama_download", fmt.Sprintf("Install failed: %v", err))
		}
	}()

	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]string{"status": "installing"})
}

// Pull triggers a model download via Ollama.
// The pull runs in the background; progress is streamed via WebSocket.
// Returns 202 Accepted immediately so the HTTP request doesn't block.
// POST /api/ollama/pull
func (h *OllamaHandlers) Pull(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Model string `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Model == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "model is required", nil)
		return
	}

	// Only allow models from the supported catalog or valid Ollama model names.
	// This prevents pulling arbitrary models from the Ollama registry.
	if !ollama.IsLocalModel(req.Model) && !validModelName.MatchString(req.Model) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "unsupported model", nil)
		return
	}
	log.Printf("ollama: pull requested for model %s", req.Model)

	go func() {
		ctx := context.Background()
		// Ensure Ollama is running first
		if err := h.mgr.EnsureRunning(ctx); err != nil {
			log.Printf("ollama: failed to start for pull: %v", err)
			h.broadcastError("ollama_pull", fmt.Sprintf("Failed to start Ollama: %v", err))
			return
		}
		if err := h.mgr.Pull(ctx, req.Model); err != nil {
			log.Printf("ollama: pull %s failed: %v", req.Model, err)
			h.broadcastError("ollama_pull", fmt.Sprintf("Pull %s failed: %v", req.Model, err))
		}
	}()

	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]string{"status": "pulling", "model": req.Model})
}

// Stop gracefully shuts down the Ollama process.
// POST /api/ollama/stop
func (h *OllamaHandlers) Stop(w http.ResponseWriter, r *http.Request) {
	if err := h.mgr.Stop(); err != nil {
		writeError(w, http.StatusInternalServerError, "OLLAMA_ERROR", "Failed to stop Ollama", err)
		return
	}
	writeJSON(w, map[string]string{"status": "stopped"})
}

// ListModels returns locally available models.
// GET /api/ollama/models
func (h *OllamaHandlers) ListModels(w http.ResponseWriter, r *http.Request) {
	if !h.mgr.IsRunning() {
		writeJSON(w, []interface{}{})
		return
	}

	models, err := h.mgr.ListModels(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "OLLAMA_ERROR", "Failed to list models", err)
		return
	}
	writeJSON(w, models)
}

// broadcastError sends an error progress event via WebSocket so the frontend
// can display the failure to the user.
func (h *OllamaHandlers) broadcastError(eventType, status string) {
	h.hub.Broadcast(Event{
		Type: eventType,
		Payload: ollama.ProgressEvent{
			Type:    eventType,
			Status:  status,
			Percent: -1,
		},
	})
}
