package server

import (
	"encoding/json"
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
	store           *store.Store
	repoManager     *git.RepoManager
	worktreeManager *git.WorktreeManager
	agentManager    *agent.Manager
}

func NewHandlers(s *store.Store, am *agent.Manager) *Handlers {
	return &Handlers{
		store:           s,
		repoManager:     git.NewRepoManager(),
		worktreeManager: git.NewWorktreeManager(),
		agentManager:    am,
	}
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
