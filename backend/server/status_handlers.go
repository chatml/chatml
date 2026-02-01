package server

import (
	"encoding/json"
	"net/http"

	"github.com/chatml/chatml-backend/github"
	"github.com/go-chi/chi/v5"
)

// PostCommitStatusRequest represents the request body for posting a commit status
type PostCommitStatusRequest struct {
	State       string `json:"state"`       // error, failure, pending, success
	Description string `json:"description"` // Short description (max 140 chars)
	Context     string `json:"context"`     // Status identifier, e.g., "chatml/ai-review"
	TargetURL   string `json:"targetUrl"`   // Optional URL to link to
}

// PostCommitStatus posts a commit status for the session's current HEAD
func (h *Handlers) PostCommitStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Get session
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Parse request
	var req PostCommitStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Validate state
	validStates := map[string]bool{
		"error":   true,
		"failure": true,
		"pending": true,
		"success": true,
	}
	if !validStates[req.State] {
		writeValidationError(w, "state must be one of: error, failure, pending, success")
		return
	}

	// Validate description length
	if len(req.Description) > 140 {
		writeValidationError(w, "description must be 140 characters or less")
		return
	}

	// Default context if not provided
	if req.Context == "" {
		req.Context = "chatml/verification"
	}

	// Get the workspace to find the repo details
	repo, err := h.store.GetRepo(ctx, session.WorkspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Extract owner/repo from git remote
	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err != nil {
		writeInternalError(w, "failed to get GitHub remote", err)
		return
	}

	// Check if GitHub client is available
	if h.ghClient == nil {
		writeInternalError(w, "GitHub client not configured", nil)
		return
	}

	// Get the current HEAD SHA from the worktree
	headSHA, err := h.repoManager.GetHeadSHA(ctx, session.WorktreePath)
	if err != nil {
		writeInternalError(w, "failed to get HEAD SHA", err)
		return
	}

	// Create commit status
	status := github.CommitStatus{
		State:       req.State,
		Description: req.Description,
		Context:     req.Context,
		TargetURL:   req.TargetURL,
	}

	resp, err := h.ghClient.CreateCommitStatus(ctx, owner, repoName, headSHA, status)
	if err != nil {
		writeInternalError(w, "failed to create commit status", err)
		return
	}

	w.WriteHeader(http.StatusCreated)
	writeJSON(w, resp)
}

// ListCommitStatuses returns all commit statuses for the session's HEAD
func (h *Handlers) ListCommitStatuses(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Get session
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Get the workspace to find the repo details
	repo, err := h.store.GetRepo(ctx, session.WorkspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Extract owner/repo from git remote
	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err != nil {
		writeInternalError(w, "failed to get GitHub remote", err)
		return
	}

	// Check if GitHub client is available
	if h.ghClient == nil {
		writeInternalError(w, "GitHub client not configured", nil)
		return
	}

	// Get the current HEAD SHA from the worktree
	headSHA, err := h.repoManager.GetHeadSHA(ctx, session.WorktreePath)
	if err != nil {
		writeInternalError(w, "failed to get HEAD SHA", err)
		return
	}

	// Get combined status
	combined, err := h.ghClient.GetCombinedStatus(ctx, owner, repoName, headSHA)
	if err != nil {
		writeInternalError(w, "failed to get commit statuses", err)
		return
	}

	writeJSON(w, combined)
}
