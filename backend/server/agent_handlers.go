package server

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

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

	agent, err := h.agentManager.SpawnAgent(ctx, repo.Path, repoID, req.Task)
	if err != nil {
		writeInternalError(w, "failed to spawn agent", err)
		return
	}

	writeJSON(w, agent)
}

func (h *Handlers) StopAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	h.agentManager.StopAgent(ctx, id)
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

	diff, err := h.worktreeManager.GetDiff(ctx, repo.Path, agentID)
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

	if err := h.worktreeManager.Merge(ctx, repo.Path, agentID); err != nil {
		writeInternalError(w, "failed to merge agent changes", err)
		return
	}

	// Invalidate branch cache after merge
	h.branchCache.InvalidateRepo(repo.Path)

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
		h.worktreeManager.Remove(ctx, repo.Path, agentID)
	}

	if err := h.store.DeleteAgent(ctx, agentID); err != nil {
		writeDBError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
