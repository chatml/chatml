package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/chatml/chatml-backend/ai"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/naming"
	"github.com/chatml/chatml-backend/scripts"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Session handlers

// ListAllSessions returns all sessions across all workspaces in a single query.
// GET /api/sessions?includeArchived=true
func (h *Handlers) ListAllSessions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	includeArchived := r.URL.Query().Get("includeArchived") == "true"
	sessions, err := h.store.ListAllSessions(ctx, includeArchived)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Trigger one-time PR title backfill for sessions missing titles
	if h.prWatcher != nil {
		h.prWatcher.TriggerBackfillPRTitles()
	}

	// Serve cached stats immediately; compute uncached ones in background via WebSocket.
	if h.statsCache != nil {
		// First pass: apply cached stats and collect workspace IDs for uncached sessions
		type pendingSession struct {
			session     *models.Session
			workspaceID string
		}
		var pending []pendingSession
		needWorkspaceIDs := make(map[string]bool)
		for _, session := range sessions {
			if session.Archived {
				continue
			}
			if cached, ok := h.statsCache.Get(session.ID); ok {
				session.Stats = cached
			} else {
				pending = append(pending, pendingSession{session: session, workspaceID: session.WorkspaceID})
				needWorkspaceIDs[session.WorkspaceID] = true
			}
		}

		// Batch-fetch only the workspaces needed for uncached sessions
		if len(pending) > 0 {
			ids := make([]string, 0, len(needWorkspaceIDs))
			for id := range needWorkspaceIDs {
				ids = append(ids, id)
			}
			workspaceByID, repoErr := h.store.GetReposByIDs(ctx, ids)
			if repoErr != nil {
				logger.Handlers.Warnf("ListAllSessions: failed to get repos for stats: %v", repoErr)
			}

			var uncached []uncachedSession
			for _, p := range pending {
				if ws := workspaceByID[p.workspaceID]; ws != nil {
					uncached = append(uncached, uncachedSession{
						session:   p.session,
						workspace: ws,
					})
				}
			}
			if len(uncached) > 0 && h.hub != nil {
				h.goBackground(func() { h.computeAndBroadcastStats(uncached) })
			}
		}
	}

	writeJSON(w, sessions)
}

func (h *Handlers) ListSessions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")
	includeArchived := r.URL.Query().Get("includeArchived") == "true"
	sessions, err := h.store.ListSessions(ctx, workspaceID, includeArchived)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Trigger one-time PR title backfill for sessions missing titles
	if h.prWatcher != nil {
		h.prWatcher.TriggerBackfillPRTitles()
	}

	// Serve cached stats immediately; compute uncached ones in background via WebSocket.
	if h.statsCache != nil {
		workspace, err := h.store.GetRepo(ctx, workspaceID)
		if err != nil {
			logger.Error.Errorf("ListSessions: failed to get workspace %s for stats: %v", workspaceID, err)
		}
		var uncached []uncachedSession
		for _, session := range sessions {
			if session.Archived {
				continue
			}
			if cached, ok := h.statsCache.Get(session.ID); ok {
				session.Stats = cached
			} else if workspace != nil {
				uncached = append(uncached, uncachedSession{
					session:   session,
					workspace: workspace,
				})
			}
		}
		if len(uncached) > 0 && h.hub != nil {
			h.goBackground(func() { h.computeAndBroadcastStats(uncached) })
		}
	}

	writeJSON(w, sessions)
}

// ListBranches returns all branches for a workspace with session linkage
// GET /api/repos/{id}/branches?includeRemote=true&limit=50&offset=0&search=&sortBy=date


type CreateSessionRequest struct {
	// Name is optional - if not provided, a city name will be auto-generated
	Name string `json:"name,omitempty"`
	// Branch is optional - if not provided, will be generated from the session name
	Branch string `json:"branch,omitempty"`
	// BranchPrefix is optional - prefix for auto-generated branch names (default: "session")
	BranchPrefix string `json:"branchPrefix,omitempty"`
	// WorktreePath is deprecated - worktrees are now created at ~/Library/Application Support/ChatML/workspaces/{name}
	WorktreePath string `json:"worktreePath,omitempty"`
	// Task is an optional description of what this session is for
	Task string `json:"task,omitempty"`
	// TargetBranch is optional - overrides the workspace default branch for PRs and sync (e.g. "origin/develop")
	TargetBranch string `json:"targetBranch,omitempty"`
	// CheckoutExisting checks out an existing remote branch instead of creating a new one
	CheckoutExisting bool `json:"checkoutExisting,omitempty"`
	// SystemMessage is optional custom content for the initial system message (e.g. PR context)
	SystemMessage string `json:"systemMessage,omitempty"`
	// SessionType is "worktree" (default) or "base" — base sessions operate on the repo directly
	SessionType string `json:"sessionType,omitempty"`
}

// initBaseSession creates a base session with its initial conversation and setup message,
// then starts the branch watcher. Returns the created session or an error.
func (h *Handlers) initBaseSession(ctx context.Context, workspaceID, name, branch, repoPath string) (*models.Session, error) {
	now := time.Now()
	sess := &models.Session{
		ID:           uuid.New().String(),
		WorkspaceID:  workspaceID,
		Name:         name,
		Branch:       branch,
		WorktreePath: repoPath,
		SessionType:  models.SessionTypeBase,
		Status:       "idle",
		PRStatus:     "none",
		Priority:     models.PriorityNone,
		TaskStatus:   models.TaskStatusInProgress,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	if err := h.store.AddSession(ctx, sess); err != nil {
		return nil, fmt.Errorf("add session: %w", err)
	}

	// Create initial conversation
	convID := uuid.New().String()[:8]
	conv := &models.Conversation{
		ID:          convID,
		SessionID:   sess.ID,
		Type:        models.ConversationTypeTask,
		Name:        "Untitled",
		Status:      models.ConversationStatusIdle,
		Messages:    []models.Message{},
		ToolSummary: []models.ToolAction{},
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := h.store.AddConversation(ctx, conv); err != nil {
		return nil, fmt.Errorf("add conversation: %w", err)
	}

	// System message
	setupMsg := models.Message{
		ID:   uuid.New().String()[:8],
		Role: "system",
		SetupInfo: &models.SetupInfo{
			SessionName:  sess.Name,
			BranchName:   branch,
			OriginBranch: branch,
			SessionType:  models.SessionTypeBase,
		},
		Timestamp: now,
	}
	if err := h.store.AddMessageToConversation(ctx, convID, setupMsg); err != nil {
		return nil, fmt.Errorf("add setup message: %w", err)
	}

	// Watch for branch changes
	if h.branchWatcher != nil {
		if err := h.branchWatcher.WatchSession(sess.ID, repoPath, branch); err != nil {
			logger.Handlers.Warnf("Failed to start branch watching for base session %s: %v", sess.ID, err)
		}
	}

	return sess, nil
}

// resolveRepoBranchPrefix returns the branch prefix based on repo-level settings.
// For the "github" case, it resolves to the authenticated GitHub user's login.
// Returns "session" as the default fallback.
func (h *Handlers) resolveRepoBranchPrefix(repo *models.Repo) string {
	switch repo.BranchPrefix {
	case "custom":
		if repo.CustomPrefix != "" {
			return repo.CustomPrefix
		}
	case "none":
		return ""
	case "github":
		if user := h.ghClient.GetStoredUser(); user != nil && user.Login != "" {
			return user.Login
		}
	}
	// "", or anything else → "session" (backend default)
	return "session"
}

func (h *Handlers) CreateSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	var req CreateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Validate optional targetBranch — must be in the form "<remote>/<branch>"
	if req.TargetBranch != "" {
		if !strings.Contains(req.TargetBranch, "/") {
			writeValidationError(w, "targetBranch must be in the form '<remote>/<branch>' (e.g. 'origin/develop')")
			return
		}
	}

	if req.CheckoutExisting && req.Branch == "" {
		writeValidationError(w, "branch is required when checkoutExisting is true")
		return
	}

	// Validate branch is not protected when checking out an existing branch.
	// Defense-in-depth: CheckoutExistingBranchInDir also validates this, but we
	// check early here to return a clear validation error before any git operations.
	if req.CheckoutExisting {
		branchName := strings.TrimPrefix(req.Branch, "origin/")
		if git.IsProtectedBranch(branchName) {
			writeValidationError(w, fmt.Sprintf("cannot create session on protected branch '%s'", branchName))
			return
		}
	}

	// ─── Base session fast path ───
	// Base sessions operate directly on the repo checkout: no worktree, no branch creation.
	if req.SessionType == models.SessionTypeBase {
		// Enforce one base session per workspace
		existing, err := h.store.GetBaseSessionForWorkspace(ctx, workspaceID)
		if err != nil {
			writeDBError(w, err)
			return
		}
		if existing != nil {
			writeConflict(w, "workspace already has a base session")
			return
		}

		branch, _ := h.repoManager.GetCurrentBranch(ctx, repo.Path)
		sessionName := req.Name
		if sessionName == "" {
			sessionName = repo.Name
		}

		sess, err := h.initBaseSession(ctx, workspaceID, sessionName, branch, repo.Path)
		if err != nil {
			writeInternalError(w, "failed to create base session", err)
			return
		}

		writeJSON(w, sess)
		return
	}

	// ─── Worktree session path (existing logic) ───

	// Generate session ID
	sessionID := uuid.New().String()

	// Get workspaces base directory (uses configured path if set)
	workspacesDir, err := h.getWorkspacesBaseDir(ctx)
	if err != nil {
		writeInternalError(w, "failed to get workspaces directory", err)
		return
	}

	// Ensure workspaces base directory exists
	if err := os.MkdirAll(workspacesDir, 0755); err != nil {
		writeInternalError(w, "failed to create workspaces directory", err)
		return
	}

	// Determine remote and target branch for worktree creation (needed by retry loop)
	remote := repo.Remote
	if remote == "" {
		remote = "origin"
	}

	targetBranch := req.TargetBranch
	if targetBranch == "" {
		targetBranch = remote + "/" + repo.Branch
		if targetBranch == remote+"/" {
			targetBranch = remote + "/main"
		}
		// Verify the target ref exists; fall back to <remote>/main or <remote>/master
		if !h.repoManager.RefExists(ctx, repo.Path, targetBranch) {
			for _, fallback := range []string{remote + "/main", remote + "/master"} {
				if fallback != targetBranch && h.repoManager.RefExists(ctx, repo.Path, fallback) {
					targetBranch = fallback
					break
				}
			}
		}
	}

	// Resolve branch prefix once (used for auto-generated names)
	branchPrefix := req.BranchPrefix
	if branchPrefix == "" && req.Branch == "" {
		branchPrefix = h.resolveRepoBranchPrefix(repo)
	}

	// Generate or use provided session name with atomic directory + worktree creation
	sessionName := req.Name
	var sessionPath, branchName, worktreePath, baseCommitSHA string
	autoGeneratedName := sessionName == ""

	if autoGeneratedName {
		// Atomic session name generation with retry loop.
		// Retries on both directory collisions AND branch collisions, so stale
		// git branches from previously deleted sessions don't block the user.
		const maxRetries = 10
		for attempt := 0; attempt < maxRetries; attempt++ {
			// Get existing names from cache (initializes on first call)
			existingNames, err := h.sessionNameCache.GetAll()
			if err != nil {
				writeInternalError(w, "failed to get existing session names", err)
				return
			}

			// Generate candidate name
			candidateName := naming.GenerateUniqueSessionName(existingNames)

			// Attempt atomic directory creation
			path, err := git.CreateSessionDirectoryAtomic(workspacesDir, candidateName)
			if err != nil {
				if errors.Is(err, git.ErrDirectoryExists) {
					// Directory collision - add to cache and retry
					h.sessionNameCache.Add(candidateName)
					continue
				}
				writeInternalError(w, "failed to create session directory", err)
				return
			}

			// Directory created - now try to create the worktree with this name
			h.sessionNameCache.Add(candidateName)

			candidateBranch := candidateName
			if branchPrefix != "" {
				candidateBranch = fmt.Sprintf("%s/%s", branchPrefix, candidateName)
			}

			h.sessionLocks.Lock(path)
			var wtPath, wtBranch, wtCommit string
			var wtErr error
			if req.CheckoutExisting {
				wtPath, wtBranch, wtCommit, wtErr = h.worktreeManager.CheckoutExistingBranchInDir(ctx, repo.Path, path, req.Branch)
			} else {
				wtPath, wtBranch, wtCommit, wtErr = h.worktreeManager.CreateInExistingDir(ctx, repo.Path, path, candidateBranch, targetBranch)
			}
			h.sessionLocks.Unlock(path)

			if wtErr == nil {
				// Success - use this name
				sessionName = candidateName
				sessionPath = path
				branchName = wtBranch
				worktreePath = wtPath
				baseCommitSHA = wtCommit
				break
			}

			// Branch collision - roll back directory and retry with a new name
			if errors.Is(wtErr, git.ErrLocalBranchExists) || errors.Is(wtErr, git.ErrBranchAlreadyCheckedOut) {
				h.sessionNameCache.Remove(candidateName)
				if removeErr := os.RemoveAll(path); removeErr != nil {
					logger.Handlers.Warnf("Failed to rollback session directory %s: %v", path, removeErr)
				}
				logger.Handlers.Infof("Branch collision on '%s', retrying with new name (attempt %d/%d)", candidateBranch, attempt+1, maxRetries)
				continue
			}

			// Non-collision error - roll back and fail
			h.sessionNameCache.Remove(candidateName)
			if removeErr := os.RemoveAll(path); removeErr != nil {
				logger.Handlers.Warnf("Failed to rollback session directory %s: %v", path, removeErr)
			}
			writeInternalError(w, "failed to create worktree", wtErr)
			return
		}

		if sessionName == "" {
			writeConflict(w, "failed to generate unique session name after retries; too many branch collisions")
			return
		}
	} else {
		// User provided a name - attempt atomic directory creation (no retry)
		path, err := git.CreateSessionDirectoryAtomic(workspacesDir, sessionName)
		if err != nil {
			if errors.Is(err, git.ErrDirectoryExists) {
				writeConflict(w, fmt.Sprintf("session name '%s' already exists", sessionName))
				return
			}
			writeInternalError(w, "failed to create session directory", err)
			return
		}
		sessionPath = path
		h.sessionNameCache.Add(sessionName)

		// Determine branch name
		branchName = req.Branch
		if branchName == "" {
			if branchPrefix != "" {
				branchName = fmt.Sprintf("%s/%s", branchPrefix, sessionName)
			} else {
				branchName = sessionName
			}
		}

		// Lock on the session path to prevent race conditions
		h.sessionLocks.Lock(sessionPath)
		defer h.sessionLocks.Unlock(sessionPath)

		// Create git worktree
		if req.CheckoutExisting {
			worktreePath, branchName, baseCommitSHA, err = h.worktreeManager.CheckoutExistingBranchInDir(ctx, repo.Path, sessionPath, branchName)
		} else {
			worktreePath, branchName, baseCommitSHA, err = h.worktreeManager.CreateInExistingDir(ctx, repo.Path, sessionPath, branchName, targetBranch)
		}
		if err != nil {
			h.sessionNameCache.Remove(sessionName)
			if removeErr := os.RemoveAll(sessionPath); removeErr != nil {
				logger.Handlers.Warnf("Failed to rollback session directory %s: %v", sessionPath, removeErr)
			}
			if errors.Is(err, git.ErrBranchAlreadyCheckedOut) {
				writeConflict(w, fmt.Sprintf("branch '%s' is already checked out in another session", branchName))
				return
			}
			if errors.Is(err, git.ErrLocalBranchExists) {
				writeConflict(w, fmt.Sprintf("local branch '%s' already exists; delete it first or use a different branch name", branchName))
				return
			}
			writeInternalError(w, "failed to create worktree", err)
			return
		}
	}

	// Lock on the session path for the remainder of setup (auto-generated path needs locking here)
	if autoGeneratedName {
		h.sessionLocks.Lock(sessionPath)
		defer h.sessionLocks.Unlock(sessionPath)
	}

	// Track rollback state - if any subsequent operation fails, clean up the worktree
	rollback := true
	defer func() {
		if rollback {
			logger.Handlers.Warnf("Rolling back worktree creation due to failure: %s", worktreePath)
			h.sessionNameCache.Remove(sessionName)
			// Use background context for cleanup - the original request context may be cancelled
			h.worktreeManager.RemoveAtPath(context.Background(), repo.Path, worktreePath, branchName)
		}
	}()

	now := time.Now()

	sess := &models.Session{
		ID:            sessionID,
		WorkspaceID:   workspaceID,
		Name:          sessionName,
		Branch:        branchName,
		WorktreePath:  worktreePath,
		BaseCommitSHA: baseCommitSHA,
		TargetBranch:  req.TargetBranch,
		Task:          req.Task,
		Status:        "idle",
		PRStatus:      "none",
		Priority:      models.PriorityNone,
		TaskStatus:    models.TaskStatusInProgress,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	if err := h.store.AddSession(ctx, sess); err != nil {
		writeDBError(w, err)
		return
	}

	// Create initial "Untitled" conversation with setup info
	convID := uuid.New().String()[:8]
	conv := &models.Conversation{
		ID:          convID,
		SessionID:   sess.ID,
		Type:        models.ConversationTypeTask,
		Name:        "Untitled",
		Status:      models.ConversationStatusIdle,
		Messages:    []models.Message{},
		ToolSummary: []models.ToolAction{},
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := h.store.AddConversation(ctx, conv); err != nil {
		writeDBError(w, err)
		return
	}

	// Add system message with setup info
	originBranch := targetBranch
	setupMsg := models.Message{
		ID:      uuid.New().String()[:8],
		Role:    "system",
		Content: req.SystemMessage,
		SetupInfo: &models.SetupInfo{
			SessionName:  sess.Name,
			BranchName:   sess.Branch,
			OriginBranch: originBranch,
			SessionType:  models.SessionTypeWorktree,
		},
		Timestamp: now,
	}
	if err := h.store.AddMessageToConversation(ctx, convID, setupMsg); err != nil {
		writeDBError(w, err)
		return
	}

	// Start watching for branch changes
	if h.branchWatcher != nil {
		if err := h.branchWatcher.WatchSession(sess.ID, worktreePath, branchName); err != nil {
			logger.Handlers.Warnf("Failed to start branch watching for session %s: %v", sess.ID, err)
			// Non-fatal - session works without instant branch detection
		}
	}

	// Start watching for PR status changes
	if h.prWatcher != nil {
		h.prWatcher.WatchSession(sess.ID, workspaceID, branchName, repo.Path, models.PRStatusNone, 0, "")
	}

	// Invalidate branch cache after new session/branch creation
	h.branchCache.InvalidateRepo(repo.Path)

	// Run setup scripts if configured and auto-setup is enabled
	if h.scriptRunner != nil {
		config, configErr := scripts.LoadConfig(repo.Path)
		if configErr != nil {
			logger.Handlers.Warnf("Failed to load .chatml/config.json for session %s: %v", sess.ID, configErr)
		} else if config != nil && config.AutoSetup && len(config.SetupScripts) > 0 {
			if err := h.scriptRunner.RunSetupScripts(context.Background(), sess.ID, worktreePath, config.SetupScripts); err != nil {
				logger.Handlers.Warnf("Failed to start setup scripts for session %s: %v", sess.ID, err)
			} else {
				logger.Handlers.Infof("Started setup scripts for session %s (%d scripts)", sess.ID, len(config.SetupScripts))
			}
		}
	}

	// All operations succeeded - disable rollback
	rollback = false
	writeJSON(w, sess)
}

func (h *Handlers) GetSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	writeJSON(w, session)
}

type UpdateSessionRequest struct {
	Name             *string `json:"name,omitempty"`
	Task             *string `json:"task,omitempty"`
	Status           *string `json:"status,omitempty"`
	TargetBranch     *string `json:"targetBranch,omitempty"`
	PRStatus         *string `json:"prStatus,omitempty"`
	PRUrl            *string `json:"prUrl,omitempty"`
	PRNumber         *int    `json:"prNumber,omitempty"`
	HasMergeConflict *bool   `json:"hasMergeConflict,omitempty"`
	HasCheckFailures *bool   `json:"hasCheckFailures,omitempty"`
	Pinned           *bool   `json:"pinned,omitempty"`
	Archived         *bool   `json:"archived,omitempty"`
	DeleteBranch     *bool   `json:"deleteBranch,omitempty"`
	Priority         *int    `json:"priority,omitempty"`
	TaskStatus       *string `json:"taskStatus,omitempty"`
	SprintPhase      *string `json:"sprintPhase,omitempty"`
}

func (h *Handlers) UpdateSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	var req UpdateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Validate status values before updating
	if req.Status != nil && !models.ValidSessionStatuses[*req.Status] {
		writeValidationError(w, "invalid status value")
		return
	}
	if req.PRStatus != nil && !models.ValidPRStatuses[*req.PRStatus] {
		writeValidationError(w, "invalid prStatus value")
		return
	}
	if req.Priority != nil && !models.ValidPriorities[*req.Priority] {
		writeValidationError(w, "invalid priority value")
		return
	}
	if req.TaskStatus != nil && !models.ValidTaskStatuses[*req.TaskStatus] {
		writeValidationError(w, "invalid taskStatus value")
		return
	}
	if req.SprintPhase != nil && !models.ValidSprintPhases[*req.SprintPhase] {
		writeValidationError(w, "invalid sprintPhase value")
		return
	}
	if req.TargetBranch != nil && *req.TargetBranch != "" {
		if !strings.HasPrefix(*req.TargetBranch, "origin/") || strings.TrimPrefix(*req.TargetBranch, "origin/") == "" {
			writeValidationError(w, "targetBranch must start with 'origin/' followed by a branch name (e.g. 'origin/develop')")
			return
		}
	}

	// Block archiving of base sessions
	if req.Archived != nil && *req.Archived && session.IsBaseSession() {
		writeValidationError(w, "base sessions cannot be archived")
		return
	}

	// If archiving, check if session has any messages. Delete blank sessions instead.
	if req.Archived != nil && *req.Archived {
		hasMessages, msgErr := h.store.SessionHasMessages(ctx, id)
		if msgErr == nil && !hasMessages {
			// Blank session — delete instead of archiving.
			// Always clean up worktree and branch since the session had no activity.
			if session.Branch != "" {
				repo, repoErr := h.store.GetRepo(ctx, session.WorkspaceID)
				if repoErr == nil && repo != nil {
					if session.WorktreePath != "" {
						if delErr := h.worktreeManager.RemoveAtPath(context.Background(), repo.Path, session.WorktreePath, session.Branch); delErr != nil {
							logger.Error.Errorf("Failed to remove worktree/branch for blank session %s: %v", id, delErr)
						}
					} else {
						if delErr := h.repoManager.DeleteLocalBranch(ctx, repo.Path, session.Branch); delErr != nil {
							logger.Error.Errorf("Failed to delete branch %q for blank session: %v", session.Branch, delErr)
						}
					}
				}
			}
			if delErr := h.store.DeleteSession(ctx, id); delErr != nil {
				writeDBError(w, delErr)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}

	if err := h.store.UpdateSession(ctx, id, func(s *models.Session) {
		if req.Name != nil {
			s.Name = *req.Name
		}
		if req.Task != nil {
			s.Task = *req.Task
		}
		if req.Status != nil {
			s.Status = *req.Status
		}
		if req.TargetBranch != nil {
			s.TargetBranch = *req.TargetBranch
		}
		if req.PRStatus != nil {
			s.PRStatus = *req.PRStatus
		}
		if req.PRUrl != nil {
			s.PRUrl = *req.PRUrl
		}
		if req.PRNumber != nil {
			s.PRNumber = *req.PRNumber
		}
		if req.HasMergeConflict != nil {
			s.HasMergeConflict = *req.HasMergeConflict
		}
		if req.HasCheckFailures != nil {
			s.HasCheckFailures = *req.HasCheckFailures
		}
		if req.Pinned != nil {
			s.Pinned = *req.Pinned
		}
		if req.Archived != nil {
			s.Archived = *req.Archived
		}
		if req.Priority != nil {
			s.Priority = *req.Priority
		}
		if req.TaskStatus != nil {
			s.TaskStatus = *req.TaskStatus
		}
		if req.SprintPhase != nil {
			s.SprintPhase = *req.SprintPhase
		}
		s.UpdatedAt = time.Now()
	}); err != nil {
		writeDBError(w, err)
		return
	}

	session, err = h.store.GetSession(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Trigger archive summary generation when session is being archived
	if req.Archived != nil && *req.Archived {
		if aiClient := h.getAIClient(); aiClient != nil {
			// Set generating status synchronously so the frontend sees it immediately
			if err := h.store.UpdateSession(ctx, id, func(s *models.Session) {
				s.ArchiveSummaryStatus = models.SummaryStatusGenerating
			}); err != nil {
				logger.Error.Errorf("Failed to set generating status for session %s: %v", id, err)
			} else {
				session.ArchiveSummaryStatus = models.SummaryStatusGenerating
				h.goBackground(func() { h.generateArchiveSummary(id, aiClient) })
			}
		}
	}

	// Delete local branch on archive if requested
	if req.DeleteBranch != nil && *req.DeleteBranch && req.Archived != nil && *req.Archived && session.Branch != "" {
		repo, repoErr := h.store.GetRepo(ctx, session.WorkspaceID)
		if repoErr == nil && repo != nil {
			if delErr := h.repoManager.DeleteLocalBranch(ctx, repo.Path, session.Branch); delErr != nil {
				logger.Error.Errorf("Failed to delete branch %q on archive: %v", session.Branch, delErr)
			}
		}
	}

	// Restore worktree+branch on unarchive if they're missing (async to avoid blocking the response)
	if req.Archived != nil && !*req.Archived && session.WorktreePath != "" && session.Branch != "" {
		repo, repoErr := h.store.GetRepo(ctx, session.WorkspaceID)
		if repoErr == nil && repo != nil {
			repoPath := repo.Path
			worktreePath := session.WorktreePath
			branch := session.Branch
			baseCommit := session.BaseCommitSHA
			target := session.TargetBranch
			sessionID := id
			go func() {
				restoreCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
				defer cancel()
				if restoreErr := h.worktreeManager.RestoreSessionWorktree(
					restoreCtx, repoPath, worktreePath,
					branch, baseCommit, target,
				); restoreErr != nil {
					logger.Error.Errorf("Failed to restore worktree for session %s: %v", sessionID, restoreErr)
				}
				// Notify frontend that worktree is ready
				if h.hub != nil {
					h.hub.Broadcast(Event{
						Type: "session_updated",
						Payload: map[string]interface{}{
							"sessionId": sessionID,
							"reason":    "worktree_restored",
						},
					})
				}
			}()
		}
	}

	writeJSON(w, session)
}

// generateArchiveSummary fetches all conversations for a session and generates a combined summary.
func (h *Handlers) generateArchiveSummary(sessionID string, aiClient ai.Provider) {
	bgCtx, cancel := context.WithTimeout(h.serverCtx, 90*time.Second)
	defer cancel()

	// Fetch all conversations for this session
	convs, err := h.store.ListConversations(bgCtx, sessionID)
	if err != nil {
		logger.Error.Errorf("Archive summary: failed to list conversations for session %s: %v", sessionID, err)
		h.updateArchiveSummaryStatus(bgCtx, sessionID, models.SummaryStatusFailed, "")
		return
	}

	// Build conversation messages for the AI
	var convMessages []ai.ConversationMessages
	for _, conv := range convs {
		if conv.MessageCount < 1 {
			continue
		}
		allMessages, err := h.store.GetConversationMessages(bgCtx, conv.ID, nil, conv.MessageCount, false)
		if err != nil {
			logger.Error.Errorf("Archive summary: failed to get messages for conversation %s: %v", conv.ID, err)
			continue
		}

		var msgs []ai.SummaryMessage
		for _, m := range allMessages.Messages {
			if m.Role == "system" && m.SetupInfo != nil {
				continue
			}
			if m.RunSummary != nil && m.Content == "" {
				continue
			}
			if m.Content == "" {
				continue
			}
			msgs = append(msgs, ai.SummaryMessage{
				Role:    m.Role,
				Content: m.Content,
			})
		}

		if len(msgs) > 0 {
			convMessages = append(convMessages, ai.ConversationMessages{
				Name:     conv.Name,
				Type:     conv.Type,
				Messages: msgs,
			})
		}
	}

	if len(convMessages) == 0 {
		logger.Handlers.Infof("Archive summary: no messages to summarize for session %s", sessionID)
		h.updateArchiveSummaryStatus(bgCtx, sessionID, models.SummaryStatusCompleted, "No conversations with messages to summarize.")
		return
	}

	// Get session info for context
	sess, _ := h.store.GetSession(bgCtx, sessionID)
	sessionName := sessionID
	task := ""
	if sess != nil {
		sessionName = sess.Name
		task = sess.Task
	}

	result, err := aiClient.GenerateSessionSummary(bgCtx, ai.GenerateSessionSummaryRequest{
		SessionName:   sessionName,
		Task:          task,
		Conversations: convMessages,
	})

	if err != nil {
		logger.Error.Errorf("Archive summary generation failed for session %s: %v", sessionID, err)
		h.updateArchiveSummaryStatus(bgCtx, sessionID, models.SummaryStatusFailed, "")
		return
	}

	h.updateArchiveSummaryStatus(bgCtx, sessionID, models.SummaryStatusCompleted, result)
}

// updateArchiveSummaryStatus updates the archive summary fields and broadcasts a WebSocket event.
func (h *Handlers) updateArchiveSummaryStatus(ctx context.Context, sessionID, status, content string) {
	if err := h.store.UpdateSession(ctx, sessionID, func(s *models.Session) {
		s.ArchiveSummaryStatus = status
		s.ArchiveSummary = content
	}); err != nil {
		logger.Error.Errorf("Failed to update archive summary status for session %s: %v", sessionID, err)
		return
	}

	// Broadcast so frontend can update
	if h.hub != nil {
		updatedSession, _ := h.store.GetSession(ctx, sessionID)
		if updatedSession != nil {
			h.hub.Broadcast(Event{
				Type:      "archive_summary_updated",
				SessionID: sessionID,
				Payload:   updatedSession,
			})
		}
	}
}

func (h *Handlers) DeleteSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Get session to find workspace and worktree path
	sess, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Block deletion of base sessions
	if sess != nil && sess.IsBaseSession() {
		writeValidationError(w, "base sessions cannot be deleted")
		return
	}

	// Track worktree path for locking - we need to hold the lock through DB deletion
	var worktreePath string
	if sess != nil && sess.WorktreePath != "" {
		worktreePath = sess.WorktreePath
	}

	// Acquire lock before any modifications if we have a worktree path
	if worktreePath != "" {
		h.sessionLocks.Lock(worktreePath)
		defer h.sessionLocks.Unlock(worktreePath)
	}

	// Capture cleanup info BEFORE deleting from DB
	var repoPath, sessionName string
	if sess != nil {
		// Stop watching for branch changes
		if h.branchWatcher != nil {
			h.branchWatcher.UnwatchSession(sessionID)
		}

		// Stop watching for PR status changes
		if h.prWatcher != nil {
			h.prWatcher.UnwatchSession(sessionID)
		}

		repo, err := h.store.GetRepo(ctx, sess.WorkspaceID)
		if err != nil {
			writeDBError(w, err)
			return
		}
		if repo != nil {
			repoPath = repo.Path
			sessionName = sess.Name
		}
	}

	// DELETE DB RECORD FIRST — this is the authoritative action.
	// If this fails, no disk cleanup happens and the session remains intact.
	// Previously, worktree was removed first and DB delete could fail (no retry),
	// leaving a ghost session with no worktree on disk.
	if err := h.store.DeleteSession(ctx, sessionID); err != nil {
		writeDBError(w, err)
		return
	}

	// Clean up caches. Worktree directory is intentionally
	// preserved on disk — session worktrees are permanent artifacts.
	if worktreePath != "" && repoPath != "" {
		h.sessionNameCache.Remove(sessionName)
		h.branchCache.InvalidateRepo(repoPath)
	}

	w.WriteHeader(http.StatusNoContent)
}
