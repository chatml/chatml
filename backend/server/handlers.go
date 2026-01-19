package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/models"
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
	var req AddRepoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.repoManager.ValidateRepo(req.Path); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Check if repo with same path already exists
	if existing := h.store.GetRepoByPath(req.Path); existing != nil {
		http.Error(w, "repository already added", http.StatusConflict)
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

	h.store.AddRepo(repo)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(repo)
}

func (h *Handlers) ListRepos(w http.ResponseWriter, r *http.Request) {
	repos := h.store.ListRepos()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(repos)
}

func (h *Handlers) GetRepo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	repo := h.store.GetRepo(id)
	if repo == nil {
		http.Error(w, "repo not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(repo)
}

func (h *Handlers) DeleteRepo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h.store.DeleteRepo(id)
	w.WriteHeader(http.StatusNoContent)
}

// Session handlers

func (h *Handlers) ListSessions(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	sessions := h.store.ListSessions(workspaceID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}

type CreateSessionRequest struct {
	Name         string `json:"name"`
	Branch       string `json:"branch"`
	WorktreePath string `json:"worktreePath"`
	Task         string `json:"task,omitempty"`
}

func (h *Handlers) CreateSession(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	repo := h.store.GetRepo(workspaceID)
	if repo == nil {
		http.Error(w, "workspace not found", http.StatusNotFound)
		return
	}

	var req CreateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Generate session ID
	sessionID := uuid.New().String()

	// Create git worktree for this session
	worktreePath, branchName, baseCommitSHA, err := h.worktreeManager.CreateWithBranch(repo.Path, sessionID, req.Branch)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create worktree: %v", err), http.StatusInternalServerError)
		return
	}

	now := time.Now()
	session := &models.Session{
		ID:            sessionID,
		WorkspaceID:   workspaceID,
		Name:          req.Name,
		Branch:        branchName,
		WorktreePath:  worktreePath,
		BaseCommitSHA: baseCommitSHA,
		Task:          req.Task,
		Status:        "idle",
		PRStatus:      "none",
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	h.store.AddSession(session)

	// Create initial "Untitled" conversation with setup info
	convID := uuid.New().String()[:8]
	conv := &models.Conversation{
		ID:          convID,
		SessionID:   session.ID,
		Type:        models.ConversationTypeTask,
		Name:        "Untitled",
		Status:      models.ConversationStatusIdle,
		Messages:    []models.Message{},
		ToolSummary: []models.ToolAction{},
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	h.store.AddConversation(conv)

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
			SessionName:  session.Name,
			BranchName:   session.Branch,
			OriginBranch: originBranch,
		},
		Timestamp: now,
	}
	h.store.AddMessageToConversation(convID, setupMsg)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(session)
}

func (h *Handlers) GetSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "sessionId")
	session := h.store.GetSession(id)
	if session == nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(session)
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
	id := chi.URLParam(r, "sessionId")
	session := h.store.GetSession(id)
	if session == nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	var req UpdateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.store.UpdateSession(id, func(s *models.Session) {
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
	})

	session = h.store.GetSession(id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(session)
}

func (h *Handlers) DeleteSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")

	// Get session to find workspace and worktree path
	session := h.store.GetSession(sessionID)
	if session != nil {
		repo := h.store.GetRepo(session.WorkspaceID)
		if repo != nil && session.WorktreePath != "" {
			// Remove the git worktree
			h.worktreeManager.RemoveByPath(repo.Path, sessionID, session.Branch)
		}
	}

	h.store.DeleteSession(sessionID)
	w.WriteHeader(http.StatusNoContent)
}

// GetSessionChanges returns the list of changed files in a session's worktree
func (h *Handlers) GetSessionChanges(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	session := h.store.GetSession(sessionID)
	if session == nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	// Get the workspace to find the base branch
	repo := h.store.GetRepo(session.WorkspaceID)
	if repo == nil {
		http.Error(w, "workspace not found", http.StatusNotFound)
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(changes)
}

// GetSessionFileDiff returns the diff for a specific file in a session's worktree
func (h *Handlers) GetSessionFileDiff(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	session := h.store.GetSession(sessionID)
	if session == nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	// Get the workspace to find the base branch
	repo := h.store.GetRepo(session.WorkspaceID)
	if repo == nil {
		http.Error(w, "workspace not found", http.StatusNotFound)
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		http.Error(w, "path parameter is required", http.StatusBadRequest)
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
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	// Read current file content from the worktree
	fullPath := filepath.Join(workingPath, cleanPath)
	newContent, err := os.ReadFile(fullPath)
	if err != nil && !os.IsNotExist(err) {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

type SendMessageRequest struct {
	Content string `json:"content"`
}

func (h *Handlers) SendSessionMessage(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	session := h.store.GetSession(sessionID)
	if session == nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	var req SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Content == "" {
		http.Error(w, "content is required", http.StatusBadRequest)
		return
	}

	// Check if there's an active agent for this session
	if session.AgentID == "" {
		http.Error(w, "no agent running for this session", http.StatusBadRequest)
		return
	}

	// Send message to the agent
	if err := h.agentManager.SendMessage(session.AgentID, req.Content); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"status": "sent"})
}

// Agent handlers

func (h *Handlers) ListAgents(w http.ResponseWriter, r *http.Request) {
	repoID := chi.URLParam(r, "id")
	agents := h.store.ListAgents(repoID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(agents)
}

type SpawnAgentRequest struct {
	Task string `json:"task"`
}

func (h *Handlers) SpawnAgent(w http.ResponseWriter, r *http.Request) {
	repoID := chi.URLParam(r, "id")
	repo := h.store.GetRepo(repoID)
	if repo == nil {
		http.Error(w, "repo not found", http.StatusNotFound)
		return
	}

	var req SpawnAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	agent, err := h.agentManager.SpawnAgent(repo.Path, repoID, req.Task)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(agent)
}

func (h *Handlers) StopAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h.agentManager.StopAgent(id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) GetAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	agent := h.store.GetAgent(id)
	if agent == nil {
		http.Error(w, "agent not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(agent)
}

func (h *Handlers) GetAgentDiff(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	agent := h.store.GetAgent(agentID)
	if agent == nil {
		http.Error(w, "agent not found", http.StatusNotFound)
		return
	}

	repo := h.store.GetRepo(agent.RepoID)
	if repo == nil {
		http.Error(w, "repo not found", http.StatusNotFound)
		return
	}

	diff, err := h.worktreeManager.GetDiff(repo.Path, agentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(diff))
}

func (h *Handlers) MergeAgent(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	agent := h.store.GetAgent(agentID)
	if agent == nil {
		http.Error(w, "agent not found", http.StatusNotFound)
		return
	}

	repo := h.store.GetRepo(agent.RepoID)
	if repo == nil {
		http.Error(w, "repo not found", http.StatusNotFound)
		return
	}

	if err := h.worktreeManager.Merge(repo.Path, agentID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) DeleteAgent(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	agent := h.store.GetAgent(agentID)
	if agent == nil {
		http.Error(w, "agent not found", http.StatusNotFound)
		return
	}

	repo := h.store.GetRepo(agent.RepoID)
	if repo != nil {
		h.worktreeManager.Remove(repo.Path, agentID)
	}

	h.store.DeleteAgent(agentID)
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
	id := chi.URLParam(r, "id")
	repo := h.store.GetRepo(id)
	if repo == nil {
		http.Error(w, "repo not found", http.StatusNotFound)
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tree)
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
	id := chi.URLParam(r, "id")
	repo := h.store.GetRepo(id)
	if repo == nil {
		http.Error(w, "repo not found", http.StatusNotFound)
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		http.Error(w, "path parameter is required", http.StatusBadRequest)
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
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(repo.Path, cleanPath)

	// Read current file content
	newContent, err := os.ReadFile(fullPath)
	if err != nil && !os.IsNotExist(err) {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetRepoFileContent returns the content of a specific file in the repository
func (h *Handlers) GetRepoFileContent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	repo := h.store.GetRepo(id)
	if repo == nil {
		http.Error(w, "repo not found", http.StatusNotFound)
		return
	}

	// Get file path from query parameter
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		http.Error(w, "path parameter is required", http.StatusBadRequest)
		return
	}

	// Validate and clean the path to prevent directory traversal attacks
	cleanPath, err := validatePath(repo.Path, filePath)
	if err != nil {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(repo.Path, cleanPath)

	// Check if file exists and is not a directory
	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "file not found", http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}
	if info.IsDir() {
		http.Error(w, "path is a directory", http.StatusBadRequest)
		return
	}

	// Read file content
	content, err := os.ReadFile(fullPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Return as JSON with metadata
	response := struct {
		Path    string `json:"path"`
		Name    string `json:"name"`
		Content string `json:"content"`
		Size    int64  `json:"size"`
	}{
		Path:    cleanPath,
		Name:    filepath.Base(cleanPath),
		Content: string(content),
		Size:    info.Size(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// Conversation handlers

func (h *Handlers) ListConversations(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	convs := h.store.ListConversations(sessionID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(convs)
}

type CreateConversationRequest struct {
	Type    string `json:"type"`    // "task", "review", "chat"
	Message string `json:"message"` // Initial message (optional)
}

func (h *Handlers) CreateConversation(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	session := h.store.GetSession(sessionID)
	if session == nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	var req CreateConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Default to "task" type if not specified
	if req.Type == "" {
		req.Type = "task"
	}

	conv, err := h.agentManager.StartConversation(sessionID, req.Type, req.Message)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(conv)
}

func (h *Handlers) GetConversation(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "convId")
	conv := h.store.GetConversation(convID)
	if conv == nil {
		http.Error(w, "conversation not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(conv)
}

type SendConversationMessageRequest struct {
	Content string `json:"content"`
}

func (h *Handlers) SendConversationMessage(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "convId")
	conv := h.store.GetConversation(convID)
	if conv == nil {
		http.Error(w, "conversation not found", http.StatusNotFound)
		return
	}

	var req SendConversationMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Content == "" {
		http.Error(w, "content is required", http.StatusBadRequest)
		return
	}

	if err := h.agentManager.SendConversationMessage(convID, req.Content); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"status": "sent"})
}

func (h *Handlers) StopConversation(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "convId")
	conv := h.store.GetConversation(convID)
	if conv == nil {
		http.Error(w, "conversation not found", http.StatusNotFound)
		return
	}

	h.agentManager.StopConversation(convID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) DeleteConversation(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "convId")
	conv := h.store.GetConversation(convID)
	if conv == nil {
		http.Error(w, "conversation not found", http.StatusNotFound)
		return
	}

	// Stop the conversation if running
	h.agentManager.StopConversation(convID)

	// Delete from store
	h.store.DeleteConversation(convID)
	w.WriteHeader(http.StatusNoContent)
}
