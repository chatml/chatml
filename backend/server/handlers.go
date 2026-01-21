package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/naming"
	"github.com/chatml/chatml-backend/session"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handlers struct {
	store           *store.SQLiteStore
	repoManager     *git.RepoManager
	worktreeManager *git.WorktreeManager
	agentManager    *agent.Manager
}

// writeJSON writes data as JSON response, logging any encoding errors
func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		// Log the error - response headers may already be sent
		fmt.Printf("[handlers] JSON encode error: %v\n", err)
	}
}

func NewHandlers(s *store.SQLiteStore, am *agent.Manager) *Handlers {
	return &Handlers{
		store:           s,
		repoManager:     git.NewRepoManager(),
		worktreeManager: git.NewWorktreeManager(),
		agentManager:    am,
	}
}

// validatePath ensures the requested path stays within the base directory
// Returns the cleaned path if valid, or an error if the path escapes the base
func validatePath(basePath, requestedPath string) (string, error) {
	cleanPath := filepath.Clean(requestedPath)

	// Reject absolute paths
	if filepath.IsAbs(cleanPath) {
		return "", fmt.Errorf("absolute paths not allowed")
	}

	fullPath := filepath.Join(basePath, cleanPath)

	// Resolve to absolute and verify it's under basePath
	absBase, err := filepath.Abs(basePath)
	if err != nil {
		return "", err
	}
	absPath, err := filepath.Abs(fullPath)
	if err != nil {
		return "", err
	}

	// Ensure path is under base (add trailing slash to prevent prefix attacks)
	if !strings.HasPrefix(absPath, absBase+string(filepath.Separator)) && absPath != absBase {
		return "", fmt.Errorf("path escapes base directory")
	}

	return cleanPath, nil
}

type AddRepoRequest struct {
	Path string `json:"path"`
}

func (h *Handlers) AddRepo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req AddRepoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if err := h.repoManager.ValidateRepo(req.Path); err != nil {
		writeValidationError(w, "invalid repository path")
		return
	}

	// Check if repo with same path already exists
	existing, err := h.store.GetRepoByPath(ctx, req.Path)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if existing != nil {
		writeConflict(w, "repository already added")
		return
	}

	branch, _ := h.repoManager.GetCurrentBranch(req.Path)

	repo := &models.Repo{
		ID:        uuid.New().String(),
		Name:      h.repoManager.GetRepoName(req.Path),
		Path:      req.Path,
		Branch:    branch,
		CreatedAt: time.Now(),
	}

	if err := h.store.AddRepo(ctx, repo); err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, repo)
}

func (h *Handlers) ListRepos(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repos, err := h.store.ListRepos(ctx)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, repos)
}

func (h *Handlers) GetRepo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}
	writeJSON(w, repo)
}

func (h *Handlers) DeleteRepo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	if err := h.store.DeleteRepo(ctx, id); err != nil {
		writeDBError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Session handlers

func (h *Handlers) ListSessions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")
	sessions, err := h.store.ListSessions(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, sessions)
}

type CreateSessionRequest struct {
	// Name is optional - if not provided, a city name will be auto-generated
	Name string `json:"name,omitempty"`
	// Branch is optional - if not provided, will be generated from the session name
	Branch string `json:"branch,omitempty"`
	// WorktreePath is deprecated - worktrees are now created at ~/.chatml/workspaces/{name}
	WorktreePath string `json:"worktreePath,omitempty"`
	// Task is an optional description of what this session is for
	Task string `json:"task,omitempty"`
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

	// Generate session ID
	sessionID := uuid.New().String()

	// Get workspaces base directory (~/.chatml/workspaces)
	workspacesDir, err := git.WorkspacesBaseDir()
	if err != nil {
		writeInternalError(w, "failed to get workspaces directory", err)
		return
	}

	// Ensure workspaces base directory exists
	if err := os.MkdirAll(workspacesDir, 0755); err != nil {
		writeInternalError(w, "failed to create workspaces directory", err)
		return
	}

	// Generate or use provided session name with atomic directory creation
	sessionName := req.Name
	var sessionPath string

	if sessionName == "" {
		// Atomic session name generation with retry loop
		const maxRetries = 5
		for attempt := 0; attempt < maxRetries; attempt++ {
			// Scan filesystem for existing session directories
			existingNames := []string{}
			entries, err := os.ReadDir(workspacesDir)
			if err == nil {
				for _, entry := range entries {
					if entry.IsDir() {
						existingNames = append(existingNames, entry.Name())
					}
				}
			}

			// Generate candidate name
			candidateName := naming.GenerateUniqueSessionName(existingNames)

			// Attempt atomic directory creation
			path, err := git.CreateSessionDirectoryAtomic(workspacesDir, candidateName)
			if err == nil {
				sessionName = candidateName
				sessionPath = path
				break
			}

			if errors.Is(err, git.ErrDirectoryExists) {
				// Name collision - retry with fresh name
				continue
			}

			// Other error - fail the request
			writeInternalError(w, "failed to create session directory", err)
			return
		}

		if sessionName == "" {
			writeConflict(w, "failed to generate unique session name after retries")
			return
		}
	} else {
		// User provided a name - attempt atomic creation
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
	}

	// Generate or use provided branch name
	branchName := req.Branch
	if branchName == "" {
		branchName = fmt.Sprintf("session/%s", sessionName)
	}

	// Create git worktree in the atomically created directory
	worktreePath, branchName, baseCommitSHA, err := h.worktreeManager.CreateInExistingDir(repo.Path, sessionPath, branchName)
	if err != nil {
		// Rollback: remove the atomically created directory
		if removeErr := os.RemoveAll(sessionPath); removeErr != nil {
			log.Printf("[handlers] Warning: failed to rollback session directory %s: %v", sessionPath, removeErr)
		}
		writeInternalError(w, "failed to create worktree", err)
		return
	}

	now := time.Now()

	// Write session metadata JSON file for portability
	meta := &session.Metadata{
		ID:            sessionID,
		Name:          sessionName,
		WorkspaceID:   workspaceID,
		WorkspacePath: repo.Path,
		Branch:        branchName,
		BaseCommitSHA: baseCommitSHA,
		CreatedAt:     now,
		Task:          req.Task,
	}
	if err := session.WriteMetadata(worktreePath, meta); err != nil {
		// Log but don't fail - metadata is supplementary
		fmt.Printf("[handlers] Warning: failed to write session metadata: %v\n", err)
	}

	sess := &models.Session{
		ID:            sessionID,
		WorkspaceID:   workspaceID,
		Name:          sessionName,
		Branch:        branchName,
		WorktreePath:  worktreePath,
		BaseCommitSHA: baseCommitSHA,
		Task:          req.Task,
		Status:        "idle",
		PRStatus:      "none",
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
	originBranch := repo.Branch
	if originBranch == "" {
		originBranch = "main"
	}
	setupMsg := models.Message{
		ID:      uuid.New().String()[:8],
		Role:    "system",
		Content: "",
		SetupInfo: &models.SetupInfo{
			SessionName:  sess.Name,
			BranchName:   sess.Branch,
			OriginBranch: originBranch,
		},
		Timestamp: now,
	}
	if err := h.store.AddMessageToConversation(ctx, convID, setupMsg); err != nil {
		writeDBError(w, err)
		return
	}

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
	PRStatus         *string `json:"prStatus,omitempty"`
	PRUrl            *string `json:"prUrl,omitempty"`
	PRNumber         *int    `json:"prNumber,omitempty"`
	HasMergeConflict *bool   `json:"hasMergeConflict,omitempty"`
	HasCheckFailures *bool   `json:"hasCheckFailures,omitempty"`
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
	writeJSON(w, session)
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
	if sess != nil {
		repo, err := h.store.GetRepo(ctx, sess.WorkspaceID)
		if err != nil {
			writeDBError(w, err)
			return
		}
		if repo != nil && sess.WorktreePath != "" {
			// Delete session metadata file (if exists)
			session.DeleteMetadata(sess.WorktreePath)

			// Remove the git worktree using absolute path
			h.worktreeManager.RemoveAtPath(repo.Path, sess.WorktreePath, sess.Branch)
		}
	}

	if err := h.store.DeleteSession(ctx, sessionID); err != nil {
		writeDBError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetSessionGitStatus returns comprehensive git status for a session's worktree
func (h *Handlers) GetSessionGitStatus(w http.ResponseWriter, r *http.Request) {
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

	// Get the workspace to find the base branch
	workspace, err := h.store.GetRepo(ctx, session.WorkspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if workspace == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Use worktree path if set, otherwise fall back to workspace path
	workingPath := session.WorktreePath
	if workingPath == "" {
		workingPath = workspace.Path
	}

	// Determine base branch
	baseBranch := workspace.Branch
	if baseBranch == "" {
		baseBranch = "main"
	}

	// Get comprehensive git status
	status, err := h.repoManager.GetStatus(workingPath, baseBranch)
	if err != nil {
		writeInternalError(w, "failed to get git status", err)
		return
	}

	writeJSON(w, status)
}

// GetSessionChanges returns the list of changed files in a session's worktree
func (h *Handlers) GetSessionChanges(w http.ResponseWriter, r *http.Request) {
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

	// Get the workspace to find the base branch
	repo, err := h.store.GetRepo(ctx, session.WorkspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Use the base commit SHA if available, otherwise fall back to repo branch for old sessions
	baseRef := session.BaseCommitSHA
	if baseRef == "" {
		baseRef = repo.Branch
		if baseRef == "" {
			baseRef = "main"
		}
	}

	// Use worktree path if set, otherwise fall back to repo path
	workingPath := session.WorktreePath
	if workingPath == "" {
		workingPath = repo.Path
	}

	// Get changed files in the session's worktree compared to base ref
	changes, err := h.repoManager.GetChangedFilesWithStats(workingPath, baseRef)
	if err != nil {
		// If there's no diff (e.g., new worktree with no changes), return empty list
		changes = []git.FileChange{}
	}

	// Get untracked files
	untracked, err := h.repoManager.GetUntrackedFiles(workingPath)
	if err != nil {
		untracked = []git.FileChange{}
	}

	// Combine untracked files first, then tracked changes
	allChanges := append(untracked, changes...)

	writeJSON(w, allChanges)
}

// GetSessionFileDiff returns the diff for a specific file in a session's worktree
func (h *Handlers) GetSessionFileDiff(w http.ResponseWriter, r *http.Request) {
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

	// Get the workspace to find the base branch
	repo, err := h.store.GetRepo(ctx, session.WorkspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	// Use the base commit SHA if available, otherwise fall back to repo branch for old sessions
	baseRef := session.BaseCommitSHA
	if baseRef == "" {
		baseRef = repo.Branch
		if baseRef == "" {
			baseRef = "main"
		}
	}

	// Use worktree path if set, otherwise fall back to repo path
	workingPath := session.WorktreePath
	if workingPath == "" {
		workingPath = repo.Path
	}

	// Validate and clean the path
	cleanPath, err := validatePath(workingPath, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	// Read current file content from the worktree
	fullPath := filepath.Join(workingPath, cleanPath)
	newContent, err := os.ReadFile(fullPath)
	if err != nil && !os.IsNotExist(err) {
		writeInternalError(w, "failed to read file", err)
		return
	}

	// Get base ref version using git show
	oldContent, err := h.repoManager.GetFileAtRef(workingPath, baseRef, cleanPath)
	if err != nil {
		// File might not exist in base branch (new file)
		oldContent = ""
	}

	// Check for conflict markers
	hasConflict := strings.Contains(string(newContent), "<<<<<<<") &&
		strings.Contains(string(newContent), "=======") &&
		strings.Contains(string(newContent), ">>>>>>>")

	response := FileDiffResponse{
		Path:        cleanPath,
		OldContent:  oldContent,
		NewContent:  string(newContent),
		OldFilename: cleanPath + " (base)",
		NewFilename: cleanPath,
		HasConflict: hasConflict,
	}

	writeJSON(w, response)
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

// Agent handlers

func (h *Handlers) ListAgents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")
	agents, err := h.store.ListAgents(ctx, repoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, agents)
}

type SpawnAgentRequest struct {
	Task string `json:"task"`
}

func (h *Handlers) SpawnAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, repoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	var req SpawnAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	agent, err := h.agentManager.SpawnAgent(repo.Path, repoID, req.Task)
	if err != nil {
		writeInternalError(w, "failed to spawn agent", err)
		return
	}

	writeJSON(w, agent)
}

func (h *Handlers) StopAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h.agentManager.StopAgent(id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) GetAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	agent, err := h.store.GetAgent(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if agent == nil {
		writeNotFound(w, "agent")
		return
	}
	writeJSON(w, agent)
}

func (h *Handlers) GetAgentDiff(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	agentID := chi.URLParam(r, "id")
	agent, err := h.store.GetAgent(ctx, agentID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if agent == nil {
		writeNotFound(w, "agent")
		return
	}

	repo, err := h.store.GetRepo(ctx, agent.RepoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	diff, err := h.worktreeManager.GetDiff(repo.Path, agentID)
	if err != nil {
		writeInternalError(w, "failed to get diff", err)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(diff))
}

func (h *Handlers) MergeAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	agentID := chi.URLParam(r, "id")
	agent, err := h.store.GetAgent(ctx, agentID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if agent == nil {
		writeNotFound(w, "agent")
		return
	}

	repo, err := h.store.GetRepo(ctx, agent.RepoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	if err := h.worktreeManager.Merge(repo.Path, agentID); err != nil {
		writeInternalError(w, "failed to merge agent changes", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) DeleteAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	agentID := chi.URLParam(r, "id")
	agent, err := h.store.GetAgent(ctx, agentID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if agent == nil {
		writeNotFound(w, "agent")
		return
	}

	repo, err := h.store.GetRepo(ctx, agent.RepoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo != nil {
		h.worktreeManager.Remove(repo.Path, agentID)
	}

	if err := h.store.DeleteAgent(ctx, agentID); err != nil {
		writeDBError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// FileNode represents a file or directory in the tree
type FileNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	IsDir    bool        `json:"isDir"`
	Children []*FileNode `json:"children,omitempty"`
}

// ListRepoFiles returns the file tree for a repository
func (h *Handlers) ListRepoFiles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	// Get depth parameter (default to 1 level, -1 for unlimited)
	depthStr := r.URL.Query().Get("depth")
	maxDepth := 1
	if depthStr == "all" {
		maxDepth = -1
	}

	tree, err := buildFileTree(repo.Path, "", maxDepth, 0)
	if err != nil {
		writeInternalError(w, "failed to list files", err)
		return
	}

	writeJSON(w, tree)
}

// buildFileTree recursively builds the file tree
func buildFileTree(basePath, relativePath string, maxDepth, currentDepth int) ([]*FileNode, error) {
	fullPath := filepath.Join(basePath, relativePath)
	entries, err := os.ReadDir(fullPath)
	if err != nil {
		return nil, err
	}

	var nodes []*FileNode

	// Separate directories and files
	var dirs, files []os.DirEntry
	for _, entry := range entries {
		name := entry.Name()
		// Skip hidden files except important ones
		if strings.HasPrefix(name, ".") {
			// Allow these hidden files/dirs
			allowed := map[string]bool{
				".github": true, ".vscode": true, ".husky": true,
				".gitignore": true, ".dockerignore": true, ".env": true,
				".env.example": true, ".env.local": true, ".prettierrc": true,
				".prettierignore": true, ".eslintrc": true, ".editorconfig": true,
				".nvmrc": true, ".npmrc": true, ".yarnrc": true,
			}
			if !allowed[name] && !strings.HasPrefix(name, ".env") {
				continue
			}
		}
		// Skip node_modules and other large dirs
		if name == "node_modules" || name == "vendor" || name == ".git" ||
			name == "dist" || name == "build" || name == "__pycache__" ||
			name == "target" || name == ".next" || name == "out" {
			continue
		}

		if entry.IsDir() {
			dirs = append(dirs, entry)
		} else {
			files = append(files, entry)
		}
	}

	// Sort directories and files alphabetically (case-insensitive)
	sortEntries := func(entries []os.DirEntry) {
		sort.Slice(entries, func(i, j int) bool {
			return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
		})
	}
	sortEntries(dirs)
	sortEntries(files)

	// Add directories first
	for _, entry := range dirs {
		name := entry.Name()
		nodePath := filepath.Join(relativePath, name)
		node := &FileNode{
			Name:  name,
			Path:  nodePath,
			IsDir: true,
		}

		// Recursively build children if within depth limit
		if maxDepth == -1 || currentDepth < maxDepth {
			children, err := buildFileTree(basePath, nodePath, maxDepth, currentDepth+1)
			if err == nil {
				node.Children = children
			}
		}

		nodes = append(nodes, node)
	}

	// Add files
	for _, entry := range files {
		name := entry.Name()
		nodePath := filepath.Join(relativePath, name)
		nodes = append(nodes, &FileNode{
			Name:  name,
			Path:  nodePath,
			IsDir: false,
		})
	}

	return nodes, nil
}

// FileContentResponse represents a file's content and metadata
type FileContentResponse struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Content string `json:"content"`
	Size    int64  `json:"size"`
}

// FileDiffResponse represents a diff between two versions of a file
type FileDiffResponse struct {
	Path        string `json:"path"`
	OldContent  string `json:"oldContent"`
	NewContent  string `json:"newContent"`
	OldFilename string `json:"oldFilename"`
	NewFilename string `json:"newFilename"`
	HasConflict bool   `json:"hasConflict"`
}

// GetFileDiff returns the diff between the base branch and current state for a file
func (h *Handlers) GetFileDiff(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	// Get the base branch (usually main or master)
	baseBranch := r.URL.Query().Get("base")
	if baseBranch == "" {
		baseBranch = repo.Branch // default branch
	}

	// Validate and clean the path
	cleanPath, err := validatePath(repo.Path, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	fullPath := filepath.Join(repo.Path, cleanPath)

	// Read current file content
	newContent, err := os.ReadFile(fullPath)
	if err != nil && !os.IsNotExist(err) {
		writeInternalError(w, "failed to read file", err)
		return
	}

	// Get base branch version using git show
	oldContent, err := h.repoManager.GetFileAtRef(repo.Path, baseBranch, cleanPath)
	if err != nil {
		// File might not exist in base branch (new file)
		oldContent = ""
	}

	// Check for conflict markers
	hasConflict := strings.Contains(string(newContent), "<<<<<<<") &&
		strings.Contains(string(newContent), "=======") &&
		strings.Contains(string(newContent), ">>>>>>>")

	response := FileDiffResponse{
		Path:        cleanPath,
		OldContent:  oldContent,
		NewContent:  string(newContent),
		OldFilename: cleanPath + " (base)",
		NewFilename: cleanPath,
		HasConflict: hasConflict,
	}

	writeJSON(w, response)
}

// GetRepoFileContent returns the content of a specific file in the repository
func (h *Handlers) GetRepoFileContent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	// Get file path from query parameter
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	// Validate and clean the path to prevent directory traversal attacks
	cleanPath, err := validatePath(repo.Path, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	fullPath := filepath.Join(repo.Path, cleanPath)

	// Check if file exists and is not a directory
	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeNotFound(w, "file")
		} else {
			writeInternalError(w, "failed to access file", err)
		}
		return
	}
	if info.IsDir() {
		writeValidationError(w, "path is a directory")
		return
	}

	// Read file content
	content, err := os.ReadFile(fullPath)
	if err != nil {
		writeInternalError(w, "failed to read file", err)
		return
	}

	// Return as JSON with metadata
	writeJSON(w, FileContentResponse{
		Path:    cleanPath,
		Name:    filepath.Base(cleanPath),
		Content: string(content),
		Size:    info.Size(),
	})
}

// GetSessionFileContent returns file content from a session's worktree
// This provides complete session isolation - files are read from the worktree, not the main repo
func (h *Handlers) GetSessionFileContent(w http.ResponseWriter, r *http.Request) {
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

	// Get file path from query parameter
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

	fullPath := filepath.Join(session.WorktreePath, cleanPath)

	// Check if file exists and is not a directory
	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeNotFound(w, "file")
		} else {
			writeInternalError(w, "failed to access file", err)
		}
		return
	}
	if info.IsDir() {
		writeValidationError(w, "path is a directory")
		return
	}

	// Read file content
	content, err := os.ReadFile(fullPath)
	if err != nil {
		writeInternalError(w, "failed to read file", err)
		return
	}

	// Return as JSON with metadata
	writeJSON(w, FileContentResponse{
		Path:    cleanPath,
		Name:    filepath.Base(cleanPath),
		Content: string(content),
		Size:    info.Size(),
	})
}

// ListSessionFiles returns the file tree for a session's worktree
// This ensures the file tree shows files from the worktree, not the main repo
func (h *Handlers) ListSessionFiles(w http.ResponseWriter, r *http.Request) {
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

	// Parse max depth from query params
	maxDepth := 10
	if depthParam := r.URL.Query().Get("maxDepth"); depthParam != "" {
		var parsedDepth int
		if _, err := fmt.Sscanf(depthParam, "%d", &parsedDepth); err == nil && parsedDepth > 0 {
			maxDepth = parsedDepth
		}
	}

	// Build file tree from worktree path
	tree, err := buildFileTree(session.WorktreePath, "", maxDepth, 0)
	if err != nil {
		writeInternalError(w, "failed to list files", err)
		return
	}

	writeJSON(w, tree)
}

// SaveFileRequest represents a request to save file content
type SaveFileRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// SaveFile saves content to a specific file in the repository or session worktree.
// Design decision: Only allows saving to existing files, not creating new ones.
// This is intentional to prevent accidental file creation through the save API.
// File creation should be done through agent actions or explicit "create file" endpoints.
func (h *Handlers) SaveFile(w http.ResponseWriter, r *http.Request) {
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

	var req SaveFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Path == "" {
		writeValidationError(w, "path is required")
		return
	}

	// Determine the base path - check if this is a session-scoped save
	basePath := repo.Path
	sessionID := r.URL.Query().Get("sessionId")
	if sessionID != "" {
		session, err := h.store.GetSession(ctx, sessionID)
		if err != nil {
			writeDBError(w, err)
			return
		}
		if session == nil {
			writeNotFound(w, "session")
			return
		}
		if session.WorktreePath != "" {
			basePath = session.WorktreePath
		}
	}

	// Validate and clean the path to prevent directory traversal attacks
	cleanPath, err := validatePath(basePath, req.Path)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	fullPath := filepath.Join(basePath, cleanPath)

	// Check if file exists (we only allow saving existing files, not creating new ones)
	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeNotFound(w, "file")
		} else {
			writeInternalError(w, "failed to access file", err)
		}
		return
	}
	if info.IsDir() {
		writeValidationError(w, "path is a directory")
		return
	}

	// Preserve file permissions
	mode := info.Mode()

	// Write file content
	if err := os.WriteFile(fullPath, []byte(req.Content), mode); err != nil {
		writeInternalError(w, "failed to save file", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// Conversation handlers

func (h *Handlers) ListConversations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	convs, err := h.store.ListConversations(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, convs)
}

type CreateConversationRequest struct {
	Type              string `json:"type"`              // "task", "review", "chat"
	Message           string `json:"message"`           // Initial message (optional)
	MaxThinkingTokens int    `json:"maxThinkingTokens"` // Enable extended thinking (optional)
}

func (h *Handlers) CreateConversation(w http.ResponseWriter, r *http.Request) {
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

	var req CreateConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Default to "task" type if not specified
	if req.Type == "" {
		req.Type = "task"
	}

	// Build options for starting the conversation
	var opts *agent.StartConversationOptions
	if req.MaxThinkingTokens > 0 {
		opts = &agent.StartConversationOptions{
			MaxThinkingTokens: req.MaxThinkingTokens,
		}
	}

	conv, err := h.agentManager.StartConversation(sessionID, req.Type, req.Message, opts)
	if err != nil {
		writeInternalError(w, "failed to start conversation", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(conv); err != nil {
		fmt.Printf("[handlers] JSON encode error: %v\n", err)
	}
}

func (h *Handlers) GetConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}
	writeJSON(w, conv)
}

type SendConversationMessageRequest struct {
	Content string `json:"content"`
}

func (h *Handlers) SendConversationMessage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	var req SendConversationMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Content == "" {
		writeValidationError(w, "content is required")
		return
	}

	if err := h.agentManager.SendConversationMessage(convID, req.Content); err != nil {
		writeInternalError(w, "failed to send message", err)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]string{"status": "sent"})
}

func (h *Handlers) StopConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	h.agentManager.StopConversation(convID)
	w.WriteHeader(http.StatusNoContent)
}

type RewindConversationRequest struct {
	CheckpointUuid string `json:"checkpointUuid"`
}

func (h *Handlers) RewindConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	var req RewindConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.CheckpointUuid == "" {
		writeValidationError(w, "checkpointUuid is required")
		return
	}

	if err := h.agentManager.RewindConversationFiles(convID, req.CheckpointUuid); err != nil {
		writeInternalError(w, "failed to rewind conversation", err)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]string{"status": "rewinding"})
}

func (h *Handlers) DeleteConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	// Stop the conversation if running
	h.agentManager.StopConversation(convID)

	// Delete from store
	if err := h.store.DeleteConversation(ctx, convID); err != nil {
		writeDBError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type SetPlanModeRequest struct {
	Enabled bool `json:"enabled"`
}

func (h *Handlers) SetConversationPlanMode(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	var req SetPlanModeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if err := h.agentManager.SetConversationPlanMode(convID, req.Enabled); err != nil {
		writeInternalError(w, "failed to set plan mode", err)
		return
	}

	writeJSON(w, map[string]bool{"enabled": req.Enabled})
}

// File tab handlers

func (h *Handlers) ListFileTabs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")
	tabs, err := h.store.ListFileTabs(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, tabs)
}

type SaveFileTabsRequest struct {
	Tabs []FileTabRequest `json:"tabs"`
}

type FileTabRequest struct {
	ID             string `json:"id"`
	WorkspaceID    string `json:"workspaceId"`
	SessionID      string `json:"sessionId,omitempty"`
	Path           string `json:"path"`
	ViewMode       string `json:"viewMode"`
	IsPinned       bool   `json:"isPinned"`
	Position       int    `json:"position"`
	OpenedAt       string `json:"openedAt"`
	LastAccessedAt string `json:"lastAccessedAt"`
}

func (h *Handlers) SaveFileTabs(w http.ResponseWriter, r *http.Request) {
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

	var req SaveFileTabsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Convert request to models
	tabs := make([]*models.FileTab, len(req.Tabs))
	for i, t := range req.Tabs {
		openedAt, err := time.Parse(time.RFC3339, t.OpenedAt)
		if err != nil {
			openedAt = time.Now()
		}
		lastAccessedAt, err := time.Parse(time.RFC3339, t.LastAccessedAt)
		if err != nil {
			lastAccessedAt = time.Now()
		}

		tabs[i] = &models.FileTab{
			ID:             t.ID,
			WorkspaceID:    workspaceID,
			SessionID:      t.SessionID,
			Path:           t.Path,
			ViewMode:       t.ViewMode,
			IsPinned:       t.IsPinned,
			Position:       i,
			OpenedAt:       openedAt,
			LastAccessedAt: lastAccessedAt,
		}
	}

	if err := h.store.SaveFileTabs(ctx, workspaceID, tabs); err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

func (h *Handlers) DeleteFileTab(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tabID := chi.URLParam(r, "tabId")
	if err := h.store.DeleteFileTab(ctx, tabID); err != nil {
		writeDBError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
