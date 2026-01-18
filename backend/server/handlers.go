package server

import (
	"encoding/json"
	"net/http"
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
