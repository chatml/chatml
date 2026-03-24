package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/go-chi/chi/v5"
)

// ============================================================================
// Base session handlers: preflight, branch management, stash
// ============================================================================

// getBaseSession is a helper that loads a session and validates it is a base session.
func (h *Handlers) getBaseSession(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	workspaceID := chi.URLParam(r, "id")

	sess, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return "", "", false
	}
	if sess == nil || sess.WorkspaceID != workspaceID {
		writeNotFound(w, "session")
		return "", "", false
	}
	if !sess.IsBaseSession() {
		writeValidationError(w, "this endpoint is only available for base sessions")
		return "", "", false
	}
	return workspaceID, sess.WorktreePath, true
}

// PreflightCheck runs safety checks on the repository for a base session.
// GET /api/repos/{id}/sessions/{sessionId}/preflight
func (h *Handlers) PreflightCheck(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	_, repoPath, ok := h.getBaseSession(w, r)
	if !ok {
		return
	}

	status, err := h.repoManager.CheckPreflight(ctx, repoPath)
	if err != nil {
		writeInternalError(w, "preflight check failed", err)
		return
	}
	writeJSON(w, status)
}

// GetCurrentBranch returns the current branch of a base session's repo.
// GET /api/repos/{id}/sessions/{sessionId}/current-branch
func (h *Handlers) GetCurrentSessionBranch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	_, repoPath, ok := h.getBaseSession(w, r)
	if !ok {
		return
	}

	branch, err := h.repoManager.GetCurrentBranch(ctx, repoPath)
	if err != nil {
		writeInternalError(w, "failed to get current branch", err)
		return
	}

	// Update DB if branch changed
	if err := h.store.UpdateSession(ctx, sessionID, func(s *models.Session) {
		s.Branch = branch
	}); err != nil {
		logger.Handlers.Warnf("Failed to update branch in DB for session %s: %v", sessionID, err)
	}

	writeJSON(w, map[string]string{"branch": branch})
}

// CreateSessionBranch creates a new branch in the base session's repo.
// POST /api/repos/{id}/sessions/{sessionId}/branches/create
func (h *Handlers) CreateSessionBranch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	_, repoPath, ok := h.getBaseSession(w, r)
	if !ok {
		return
	}

	var req struct {
		Name       string `json:"name"`
		StartPoint string `json:"startPoint,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.Name == "" {
		writeValidationError(w, "branch name is required")
		return
	}

	if err := h.repoManager.CreateBranch(ctx, repoPath, req.Name, req.StartPoint); err != nil {
		writeInternalError(w, "failed to create branch", err)
		return
	}

	writeJSON(w, map[string]string{"branch": req.Name})
}

// SwitchSessionBranch switches the base session's repo to a different branch.
// POST /api/repos/{id}/sessions/{sessionId}/branches/switch
func (h *Handlers) SwitchSessionBranch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	_, repoPath, ok := h.getBaseSession(w, r)
	if !ok {
		return
	}

	var req struct {
		Branch string `json:"branch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.Branch == "" {
		writeValidationError(w, "branch name is required")
		return
	}

	// Check for dirty working tree before switching
	dirtyFiles, err := h.repoManager.GetDirtyFiles(ctx, repoPath)
	if err != nil {
		writeInternalError(w, "failed to check working tree status", err)
		return
	}
	if len(dirtyFiles) > 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":      "working tree has uncommitted changes",
			"dirtyFiles": dirtyFiles,
		})
		return
	}

	// Switch branch
	if err := h.repoManager.SwitchBranch(ctx, repoPath, req.Branch); err != nil {
		if _, ok := err.(*git.DirtyWorkingTreeError); ok {
			// Race: files became dirty between the pre-flight check and git switch.
			// Re-fetch dirty files so the response shape matches the pre-flight path.
			raceFiles, _ := h.repoManager.GetDirtyFiles(ctx, repoPath)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":      "working tree has uncommitted changes",
				"dirtyFiles": raceFiles,
			})
			return
		}
		writeInternalError(w, "failed to switch branch", err)
		return
	}

	// Update session branch in DB
	if err := h.store.UpdateSession(ctx, sessionID, func(s *models.Session) {
		s.Branch = req.Branch
	}); err != nil {
		writeDBError(w, err)
		return
	}

	// Invalidate caches so the new branch is reflected immediately
	h.baseBranchCache.Delete(sessionID)
	if h.snapshotCache != nil {
		h.snapshotCache.Invalidate(sessionID)
	}

	// Broadcast branch change via WebSocket
	if h.hub != nil {
		h.hub.Broadcast(Event{
			Type: "session_updated",
			Payload: map[string]interface{}{
				"sessionId": sessionID,
				"reason":    "branch_switched",
				"branch":    req.Branch,
			},
		})
	}

	writeJSON(w, map[string]string{"branch": req.Branch})
}

// DeleteSessionBranch deletes a local branch from the base session's repo.
// DELETE /api/repos/{id}/sessions/{sessionId}/branches/{name}
func (h *Handlers) DeleteSessionBranch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	_, repoPath, ok := h.getBaseSession(w, r)
	if !ok {
		return
	}

	branchName := chi.URLParam(r, "branchName")
	if branchName == "" {
		writeValidationError(w, "branch name is required")
		return
	}

	// The existing DeleteLocalBranch in cleanup.go already checks protected branches
	if err := h.repoManager.DeleteLocalBranch(ctx, repoPath, branchName); err != nil {
		writeInternalError(w, "failed to delete branch", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ============================================================================
// Stash handlers
// ============================================================================

// ListStashes returns all stash entries for the base session's repo.
// GET /api/repos/{id}/sessions/{sessionId}/stashes
func (h *Handlers) ListStashes(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	_, repoPath, ok := h.getBaseSession(w, r)
	if !ok {
		return
	}

	entries, err := h.repoManager.ListStashes(ctx, repoPath)
	if err != nil {
		writeInternalError(w, "failed to list stashes", err)
		return
	}
	writeJSON(w, entries)
}

// CreateStash creates a new stash in the base session's repo.
// POST /api/repos/{id}/sessions/{sessionId}/stashes
func (h *Handlers) CreateStash(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	_, repoPath, ok := h.getBaseSession(w, r)
	if !ok {
		return
	}

	var req struct {
		Message          string `json:"message,omitempty"`
		IncludeUntracked bool   `json:"includeUntracked,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if err := h.repoManager.CreateStash(ctx, repoPath, req.Message, req.IncludeUntracked); err != nil {
		writeInternalError(w, "failed to create stash", err)
		return
	}

	w.WriteHeader(http.StatusCreated)
}

// parseStashIndex extracts and validates the stash index from the URL.
func parseStashIndex(w http.ResponseWriter, r *http.Request) (int, bool) {
	index, err := strconv.Atoi(chi.URLParam(r, "index"))
	if err != nil || index < 0 {
		writeValidationError(w, "invalid stash index")
		return 0, false
	}
	return index, true
}

// ApplyStash applies a stash entry without removing it.
// POST /api/repos/{id}/sessions/{sessionId}/stashes/{index}/apply
func (h *Handlers) ApplyStash(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	_, repoPath, ok := h.getBaseSession(w, r)
	if !ok {
		return
	}

	index, ok := parseStashIndex(w, r)
	if !ok {
		return
	}

	if err := h.repoManager.ApplyStash(ctx, repoPath, index); err != nil {
		writeInternalError(w, "failed to apply stash", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// PopStash applies and removes a stash entry.
// POST /api/repos/{id}/sessions/{sessionId}/stashes/{index}/pop
func (h *Handlers) PopStash(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	_, repoPath, ok := h.getBaseSession(w, r)
	if !ok {
		return
	}

	index, ok := parseStashIndex(w, r)
	if !ok {
		return
	}

	if err := h.repoManager.PopStash(ctx, repoPath, index); err != nil {
		writeInternalError(w, "failed to pop stash", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// DropStash removes a stash entry without applying it.
// DELETE /api/repos/{id}/sessions/{sessionId}/stashes/{index}
func (h *Handlers) DropStash(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	_, repoPath, ok := h.getBaseSession(w, r)
	if !ok {
		return
	}

	index, ok := parseStashIndex(w, r)
	if !ok {
		return
	}

	if err := h.repoManager.DropStash(ctx, repoPath, index); err != nil {
		writeInternalError(w, "failed to drop stash", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
