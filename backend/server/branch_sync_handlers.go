package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/go-chi/chi/v5"
)

// GetSessionBranchSyncStatus returns how far behind the session is from the target branch
func (h *Handlers) GetSessionBranchSyncStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Get session with workspace data to determine effective target branch
	session, err := h.store.GetSessionWithWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, session.WorktreePath) {
		return
	}

	// Get sync status using effective target branch
	targetBranch := session.EffectiveTargetBranch()
	status, err := h.repoManager.GetBranchSyncStatus(ctx, session.WorktreePath, session.BaseCommitSHA, targetBranch)
	if err != nil {
		writeInternalError(w, "failed to get branch sync status", err)
		return
	}

	// Convert to response format
	commits := make([]models.SyncCommit, len(status.Commits))
	for i, c := range status.Commits {
		commits[i] = models.SyncCommit{
			SHA:     c.SHA,
			Subject: c.Subject,
		}
	}
	response := models.BranchSyncStatus{
		BehindBy:    status.BehindBy,
		Commits:     commits,
		BaseBranch:  status.BaseBranch,
		LastChecked: status.LastChecked.Format(time.RFC3339),
	}

	writeJSON(w, response)
}

// SyncSessionBranch performs a rebase or merge operation on the session branch
func (h *Handlers) SyncSessionBranch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Parse request
	var req models.BranchSyncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Operation != "rebase" && req.Operation != "merge" {
		writeValidationError(w, "operation must be 'rebase' or 'merge'")
		return
	}

	// Get session with workspace data to determine effective target branch
	session, err := h.store.GetSessionWithWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, session.WorktreePath) {
		return
	}

	// Determine effective target branch
	targetBranch := session.EffectiveTargetBranch()

	// Perform the operation with the effective target branch
	var result *git.BranchSyncResult
	if req.Operation == "rebase" {
		result, err = h.repoManager.RebaseOntoTarget(ctx, session.WorktreePath, targetBranch)
	} else {
		result, err = h.repoManager.MergeFromTarget(ctx, session.WorktreePath, targetBranch)
	}

	if err != nil {
		writeInternalError(w, "sync operation failed", err)
		return
	}

	// Update session's base commit SHA if successful
	if result.Success && result.NewBaseSha != "" {
		if err := h.store.UpdateSession(ctx, sessionID, func(s *models.Session) {
			s.BaseCommitSHA = result.NewBaseSha
		}); err != nil {
			logger.Handlers.Warnf("Failed to update session base commit SHA: %v", err)
		}
	}

	// Invalidate branch cache after sync operation
	if repo, err := h.store.GetRepo(ctx, session.WorkspaceID); err == nil && repo != nil {
		h.branchCache.InvalidateRepo(repo.Path)
	}

	// Convert to response format
	response := models.BranchSyncResult{
		Success:       result.Success,
		NewBaseSha:    result.NewBaseSha,
		ConflictFiles: result.ConflictFiles,
		ErrorMessage:  result.ErrorMessage,
	}

	writeJSON(w, response)
}

// AbortSessionSync aborts an in-progress rebase or merge operation
func (h *Handlers) AbortSessionSync(w http.ResponseWriter, r *http.Request) {
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
	if checkWorktreePath(w, session.WorktreePath) {
		return
	}

	// Check what operation is in progress
	inProgress, err := h.repoManager.GetStatus(ctx, session.WorktreePath, "main")
	if err != nil {
		writeInternalError(w, "failed to check git status", err)
		return
	}

	// Abort the appropriate operation
	switch inProgress.InProgress.Type {
	case "rebase":
		if err := h.repoManager.AbortRebase(ctx, session.WorktreePath); err != nil {
			writeInternalError(w, "failed to abort rebase", err)
			return
		}
	case "merge":
		if err := h.repoManager.AbortMerge(ctx, session.WorktreePath); err != nil {
			writeInternalError(w, "failed to abort merge", err)
			return
		}
	default:
		writeValidationError(w, "no rebase or merge in progress")
		return
	}

	// Invalidate branch cache after abort
	if repo, err := h.store.GetRepo(ctx, session.WorkspaceID); err == nil && repo != nil {
		h.branchCache.InvalidateRepo(repo.Path)
	}

	w.WriteHeader(http.StatusNoContent)
}
