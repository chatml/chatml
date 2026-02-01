package server

import (
	"encoding/json"
	"net/http"

	"github.com/chatml/chatml-backend/github"
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
	ghCtx, ok := h.resolveGitHubContext(w, r)
	if !ok {
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

	// Guard: worktree must exist to resolve HEAD SHA
	if ghCtx.session.WorktreePath == "" {
		writeValidationError(w, "session does not have a worktree yet")
		return
	}

	// Get the current HEAD SHA from the worktree
	headSHA, err := h.repoManager.GetHeadSHA(r.Context(), ghCtx.session.WorktreePath)
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

	resp, err := h.ghClient.CreateCommitStatus(r.Context(), ghCtx.owner, ghCtx.repo, headSHA, status)
	if err != nil {
		writeInternalError(w, "failed to create commit status", err)
		return
	}

	w.WriteHeader(http.StatusCreated)
	writeJSON(w, resp)
}

// ListCommitStatuses returns all commit statuses for the session's HEAD
func (h *Handlers) ListCommitStatuses(w http.ResponseWriter, r *http.Request) {
	ghCtx, ok := h.resolveGitHubContext(w, r)
	if !ok {
		return
	}

	// Guard: worktree must exist to resolve HEAD SHA
	if ghCtx.session.WorktreePath == "" {
		writeValidationError(w, "session does not have a worktree yet")
		return
	}

	// Get the current HEAD SHA from the worktree
	headSHA, err := h.repoManager.GetHeadSHA(r.Context(), ghCtx.session.WorktreePath)
	if err != nil {
		writeInternalError(w, "failed to get HEAD SHA", err)
		return
	}

	// Get combined status
	combined, err := h.ghClient.GetCombinedStatus(r.Context(), ghCtx.owner, ghCtx.repo, headSHA)
	if err != nil {
		writeInternalError(w, "failed to get commit statuses", err)
		return
	}

	writeJSON(w, combined)
}
