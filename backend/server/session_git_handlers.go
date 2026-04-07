package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/naming"
	"github.com/go-chi/chi/v5"
)

// GetSessionGitStatus returns comprehensive git status for a session's worktree
func (h *Handlers) GetSessionGitStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Use single JOIN query to get session + workspace data
	session, workingPath, baseRef, err := h.getSessionAndWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, workingPath) {
		return
	}

	// Get comprehensive git status and current branch in parallel
	var (
		status        *git.GitStatus
		currentBranch string
		statusErr     error
		branchErr     error
		wg            sync.WaitGroup
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		status, statusErr = h.repoManager.GetStatus(ctx, workingPath, baseRef)
	}()
	go func() {
		defer wg.Done()
		currentBranch, branchErr = h.repoManager.GetCurrentBranch(ctx, workingPath)
	}()
	wg.Wait()

	if statusErr != nil {
		writeInternalError(w, "failed to get git status", statusErr)
		return
	}

	// Include current branch in the response so polling can detect external branch changes.
	// Skip detached HEAD state ("HEAD" or "") — the branch watcher handles this correctly
	// via readCurrentBranch, but the subprocess fallback returns "HEAD" for detached state.
	if branchErr == nil && currentBranch != "" && currentBranch != "HEAD" {
		status.CurrentBranch = currentBranch
		// If branch changed since last DB record, update DB (mirrors branch watcher behavior)
		if currentBranch != session.Branch {
			newName := naming.ExtractSessionNameFromBranch(currentBranch)
			status.CurrentSessionName = newName
			if newName == "" {
				newName = currentBranch
			}
			if updateErr := h.store.UpdateSession(ctx, sessionID, func(s *models.Session) {
				s.Branch = currentBranch
				s.Name = newName
				s.UpdatedAt = time.Now()
			}); updateErr != nil {
				logger.Handlers.Warnf("Failed to update branch in DB for session %s: %v", sessionID, updateErr)
			} else if h.hub != nil {
				// Broadcast WebSocket events to match branch watcher behavior
				h.hub.Broadcast(Event{
					Type:      "session_name_update",
					SessionID: sessionID,
					Payload: map[string]interface{}{
						"type":   "session_name_update",
						"name":   newName,
						"branch": currentBranch,
					},
				})
				h.hub.Broadcast(Event{
					Type: "branch_dashboard_update",
					Payload: map[string]interface{}{
						"sessionId": sessionID,
						"updatedAt": time.Now().Unix(),
					},
				})
			}
		}
	}

	// The baseRef used for ahead/behind may be a merge-base SHA.
	// Restore the human-readable branch name for frontend display.
	displayBranch := session.EffectiveTargetBranch()
	displayBranch = strings.TrimPrefix(displayBranch, session.EffectiveRemote()+"/")
	status.Sync.BaseBranch = displayBranch

	writeJSON(w, status)
}

// GetSessionChanges returns the list of truly uncommitted files in a session's worktree.
// It diffs against HEAD (not the base branch), so only staged/unstaged/untracked changes appear.
func (h *Handlers) GetSessionChanges(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Use single JOIN query to get session + workspace data
	session, workingPath, _, err := h.getSessionAndWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Get changed files in the working tree compared to HEAD (truly uncommitted only)
	changes, err := h.repoManager.GetChangedFilesWithStats(ctx, workingPath, "HEAD")
	if err != nil {
		// If there's no diff (e.g., new worktree with no changes), return empty list
		changes = []git.FileChange{}
	}

	// Get untracked files
	untracked, err := h.repoManager.GetUntrackedFiles(ctx, workingPath)
	if err != nil {
		untracked = []git.FileChange{}
	}

	// Combine untracked files first, then tracked changes
	allChanges := append(untracked, changes...)

	// Filter out files that match .gitignore rules — this handles cases where
	// build artifacts (e.g. dist/) get committed by agents and show in the diff
	allChanges = h.repoManager.FilterGitIgnored(ctx, workingPath, allChanges)

	writeJSON(w, allChanges)
}

// BranchStats holds total diff statistics for an entire branch vs its base.
type BranchStats struct {
	TotalFiles     int `json:"totalFiles"`
	TotalAdditions int `json:"totalAdditions"`
	TotalDeletions int `json:"totalDeletions"`
}

// BranchChangesResponse wraps commits and overall branch stats.
type BranchChangesResponse struct {
	Commits     []git.BranchCommit `json:"commits"`
	BranchStats *BranchStats       `json:"branchStats,omitempty"`
	AllChanges  []git.FileChange   `json:"allChanges,omitempty"`
}

// GetSessionBranchCommits returns commits on the session's branch that are ahead of the base ref,
// along with total branch diff statistics.
func (h *Handlers) GetSessionBranchCommits(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	session, workingPath, baseRef, err := h.getSessionAndWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	commits, err := h.repoManager.GetCommitsAheadOfBase(ctx, workingPath, baseRef)
	if err != nil {
		logger.Handlers.Warnf("Failed to get branch commits for session %s: %v", sessionID, err)
		commits = []git.BranchCommit{}
	}

	// Compute all changes vs base (committed + uncommitted) for the flat file list
	var branchStats *BranchStats
	allChanges, statsErr := h.repoManager.GetChangedFilesWithStats(ctx, workingPath, baseRef)
	if statsErr != nil {
		allChanges = []git.FileChange{}
	}

	// Include untracked files so new files appear in the "All Changes" view
	untracked, untErr := h.repoManager.GetUntrackedFiles(ctx, workingPath)
	if untErr == nil {
		// Deduplicate: untracked files should not overlap with diff-based changes,
		// but guard against edge cases where both sources report the same path.
		seen := make(map[string]bool, len(allChanges))
		for _, c := range allChanges {
			seen[c.Path] = true
		}
		for _, u := range untracked {
			if !seen[u.Path] {
				allChanges = append(allChanges, u)
			}
		}
	}

	// Filter out gitignored files (matches GetSessionChanges behavior)
	allChanges = h.repoManager.FilterGitIgnored(ctx, workingPath, allChanges)

	if len(allChanges) > 0 {
		bs := BranchStats{TotalFiles: len(allChanges)}
		for _, c := range allChanges {
			bs.TotalAdditions += c.Additions
			bs.TotalDeletions += c.Deletions
		}
		branchStats = &bs
	}

	writeJSON(w, BranchChangesResponse{
		Commits:     commits,
		BranchStats: branchStats,
		AllChanges:  allChanges,
	})
}

// GetSessionFileDiff returns the diff for a specific file in a session's worktree
func (h *Handlers) GetSessionFileDiff(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Use single JOIN query to get session + workspace data
	session, workingPath, baseRef, err := h.getSessionAndWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, workingPath) {
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	// If an absolute path was sent, strip the worktree prefix to make it relative
	if filepath.IsAbs(filePath) {
		prefix := workingPath
		if !strings.HasSuffix(prefix, "/") {
			prefix += "/"
		}
		if strings.HasPrefix(filePath, prefix) {
			filePath = filePath[len(prefix):]
		}
	}

	// Validate and clean the path
	cleanPath, err := validatePath(workingPath, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	// Check diff cache
	if h.diffCache != nil {
		if cached, ok := h.diffCache.Get(sessionID, cleanPath); ok {
			writeJSON(w, cached)
			return
		}
	}

	// Read current file content from the worktree
	var isDeleted bool
	fullPath := filepath.Join(workingPath, cleanPath)
	newContent, err := os.ReadFile(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			isDeleted = true
		} else {
			writeInternalError(w, "failed to read file", err)
			return
		}
	}

	// Get base ref version using git show
	oldContent, err := h.repoManager.GetFileAtRef(ctx, workingPath, baseRef, cleanPath)
	if err != nil {
		// File might not exist in base branch (new file)
		oldContent = ""
	}

	response := buildDiffResponse(ctx, h.repoManager, diffInput{
		repoPath:   workingPath,
		baseRef:    baseRef,
		path:       cleanPath,
		oldContent: oldContent,
		newContent: newContent,
		isDeleted:  isDeleted,
	})

	// Cache the result
	if h.diffCache != nil {
		h.diffCache.Set(sessionID, cleanPath, &response)
	}

	writeJSON(w, response)
}

// GetSessionDiffSummary returns a unified diff summary for the session's worktree.
// Supports optional query parameters:
//   - maxBytes: maximum diff size in bytes (default 120000)
//   - path: if set, returns unified diff for a single file only
func (h *Handlers) GetSessionDiffSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	session, workingPath, baseRef, err := h.getSessionAndWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, workingPath) {
		return
	}

	maxBytes := 120000
	if mb := r.URL.Query().Get("maxBytes"); mb != "" {
		if parsed, err := strconv.Atoi(mb); err == nil && parsed > 0 {
			maxBytes = parsed
		}
	}

	filePath := r.URL.Query().Get("path")

	var result string
	if filePath != "" {
		cleanPath, err := validatePath(workingPath, filePath)
		if err != nil {
			writeValidationError(w, "invalid path")
			return
		}
		result, err = h.repoManager.GetFileDiffUnified(ctx, workingPath, baseRef, cleanPath, maxBytes)
		if err != nil {
			writeInternalError(w, "failed to get file diff", err)
			return
		}
	} else {
		result, err = h.repoManager.GetDiffSummary(ctx, workingPath, baseRef, maxBytes)
		if err != nil {
			writeInternalError(w, "failed to get diff summary", err)
			return
		}
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(result))
}

// FileHistoryResponse represents the commit history for a file
type FileHistoryResponse struct {
	Commits   []git.FileCommit `json:"commits"`
	Total     int              `json:"total"`
	Truncated bool             `json:"truncated"`
}

// GetSessionFileHistory returns the commit history for a specific file in a session's worktree
func (h *Handlers) GetSessionFileHistory(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	// Validate and clean the path to prevent directory traversal attacks
	cleanPath, err := validatePath(session.WorktreePath, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	commits, err := h.repoManager.GetFileCommitHistory(ctx, session.WorktreePath, cleanPath)
	if err != nil {
		// Empty history is valid for new files
		logger.Handlers.Debugf("Failed to get file history for %s: %v (returning empty)", cleanPath, err)
		commits = []git.FileCommit{}
	}

	// Backend fetches 51 commits; if we got more than 50, the history is truncated
	const maxCommits = 50
	truncated := len(commits) > maxCommits
	if truncated {
		commits = commits[:maxCommits]
	}

	writeJSON(w, FileHistoryResponse{
		Commits:   commits,
		Total:     len(commits),
		Truncated: truncated,
	})
}

// GetSessionFileAtRef returns the content of a file at a specific git ref (commit SHA)
func (h *Handlers) GetSessionFileAtRef(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	ref := r.URL.Query().Get("ref")
	if ref == "" {
		writeValidationError(w, "ref parameter is required")
		return
	}

	// Validate ref format early for better error messages
	if err := git.ValidateGitRef(ref); err != nil {
		writeValidationError(w, "invalid commit reference format")
		return
	}

	// Validate and clean the path to prevent directory traversal attacks
	cleanPath, err := validatePath(session.WorktreePath, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	content, err := h.repoManager.GetFileAtRef(ctx, session.WorktreePath, ref, cleanPath)
	if err != nil {
		writeInternalError(w, "failed to read file at ref", err)
		return
	}

	writeJSON(w, FileContentResponse{
		Path:    cleanPath,
		Name:    filepath.Base(cleanPath),
		Content: content,
		Size:    int64(len(content)),
	})
}

type SendMessageRequest struct {
	Content string `json:"content"`
}

func (h *Handlers) SendSessionMessage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	var req SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Content == "" {
		writeValidationError(w, "content is required")
		return
	}

	// Check if there's an active agent for this session
	if session.AgentID == "" {
		writeValidationError(w, "no agent running for this session")
		return
	}

	// Send message to the agent
	if err := h.agentManager.SendMessage(session.AgentID, req.Content); err != nil {
		writeInternalError(w, "failed to send message", err)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]string{"status": "sent"})
}

// GetSessionSnapshot returns a consolidated snapshot of all git data for a session.
// This replaces the need for separate /git-status, /changes, and /branch-commits calls
// on session switch, reducing redundant git operations (untracked files, gitignore filter).
func (h *Handlers) GetSessionSnapshot(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Check snapshot cache first
	if h.snapshotCache != nil {
		if cached, ok := h.snapshotCache.Get(sessionID); ok {
			writeJSON(w, cached)
			return
		}
	}

	session, workingPath, baseRef, err := h.getSessionAndWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, workingPath) {
		return
	}

	// Run all git operations in parallel. Each group is independent.
	var (
		gitStatus      *git.GitStatus
		headChanges    []git.FileChange   // diff vs HEAD (uncommitted)
		baseChanges    []git.FileChange   // diff vs baseRef (branch total)
		untracked      []git.FileChange   // untracked files (shared)
		branchCommits  []git.BranchCommit
		statusErr, headErr, baseErr, untrackedErr, commitsErr error
		wg sync.WaitGroup
	)

	wg.Add(5)
	go func() {
		defer wg.Done()
		gitStatus, statusErr = h.repoManager.GetStatus(ctx, workingPath, baseRef)
	}()
	go func() {
		defer wg.Done()
		headChanges, headErr = h.repoManager.GetChangedFilesWithStats(ctx, workingPath, "HEAD")
		if headErr != nil {
			headChanges = []git.FileChange{}
		}
	}()
	go func() {
		defer wg.Done()
		baseChanges, baseErr = h.repoManager.GetChangedFilesWithStats(ctx, workingPath, baseRef)
		if baseErr != nil {
			baseChanges = []git.FileChange{}
		}
	}()
	go func() {
		defer wg.Done()
		untracked, untrackedErr = h.repoManager.GetUntrackedFiles(ctx, workingPath)
		if untrackedErr != nil {
			untracked = []git.FileChange{}
		}
	}()
	go func() {
		defer wg.Done()
		branchCommits, commitsErr = h.repoManager.GetCommitsAheadOfBase(ctx, workingPath, baseRef)
		if commitsErr != nil {
			branchCommits = []git.BranchCommit{}
		}
	}()
	wg.Wait()

	if statusErr != nil {
		writeInternalError(w, "failed to get git status", statusErr)
		return
	}

	// Restore human-readable branch name for frontend display (same as GetSessionGitStatus)
	displayBranch := session.EffectiveTargetBranch()
	displayBranch = strings.TrimPrefix(displayBranch, session.EffectiveRemote()+"/")
	gitStatus.Sync.BaseBranch = displayBranch

	// Combine untracked with head changes (uncommitted view)
	changes := append(untracked, headChanges...)

	// Combine untracked with base changes (all changes view), deduplicating
	seen := make(map[string]bool, len(baseChanges))
	for _, c := range baseChanges {
		seen[c.Path] = true
	}
	allChanges := make([]git.FileChange, 0, len(baseChanges)+len(untracked))
	allChanges = append(allChanges, baseChanges...)
	for _, u := range untracked {
		if !seen[u.Path] {
			allChanges = append(allChanges, u)
		}
	}

	// Filter gitignored files ONCE for the union of all paths
	changes = h.repoManager.FilterGitIgnored(ctx, workingPath, changes)
	allChanges = h.repoManager.FilterGitIgnored(ctx, workingPath, allChanges)

	// Compute branch stats
	var branchStats *BranchStats
	if len(allChanges) > 0 {
		bs := BranchStats{TotalFiles: len(allChanges)}
		for _, c := range allChanges {
			bs.TotalAdditions += c.Additions
			bs.TotalDeletions += c.Deletions
		}
		branchStats = &bs
	}

	snapshot := &SessionSnapshot{
		GitStatus:     gitStatus,
		Changes:       changes,
		AllChanges:    allChanges,
		BranchCommits: branchCommits,
		BranchStats:   branchStats,
	}

	// Cache the result — only if the request context is still valid (not cancelled/disconnected).
	// A cancelled context means some goroutines may have returned empty slices silently;
	// caching that partial data would serve a misleading "clean" snapshot to the next client.
	if h.snapshotCache != nil && ctx.Err() == nil {
		h.snapshotCache.Set(sessionID, snapshot)
	}

	writeJSON(w, snapshot)
}
