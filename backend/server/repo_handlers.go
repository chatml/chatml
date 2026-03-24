package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

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

	branch, branchErr := h.repoManager.GetCurrentBranch(ctx, req.Path)
	if branchErr != nil {
		logger.Handlers.Warnf("Failed to get current branch for %s: %v", req.Path, branchErr)
	}

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

	// Auto-create base session for the new workspace
	if _, err := h.initBaseSession(ctx, repo.ID, repo.Name, branch, repo.Path); err != nil {
		logger.Handlers.Warnf("Failed to auto-create base session for workspace %s: %v", repo.ID, err)
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

// RepoDetailsResponse extends the basic repo info with remote origin details
type RepoDetailsResponse struct {
	*models.Repo
	RemoteURL      string `json:"remoteUrl,omitempty"`
	GitHubOwner    string `json:"githubOwner,omitempty"`
	GitHubRepo     string `json:"githubRepo,omitempty"`
	WorkspacesPath string `json:"workspacesPath,omitempty"`
}

func (h *Handlers) GetRepoDetails(w http.ResponseWriter, r *http.Request) {
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

	response := &RepoDetailsResponse{Repo: repo}

	// Try to get remote origin URL
	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err == nil {
		response.GitHubOwner = owner
		response.GitHubRepo = repoName
		response.RemoteURL = fmt.Sprintf("https://github.com/%s/%s", owner, repoName)
	}

	// Get workspaces base directory (uses configured path if set)
	workspacesDir, err := h.getWorkspacesBaseDir(ctx)
	if err == nil {
		response.WorkspacesPath = workspacesDir
	}

	writeJSON(w, response)
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

type UpdateRepoSettingsRequest struct {
	Branch       *string `json:"branch,omitempty"`
	Remote       *string `json:"remote,omitempty"`
	BranchPrefix *string `json:"branchPrefix,omitempty"`
	CustomPrefix *string `json:"customPrefix,omitempty"`
}

func (h *Handlers) UpdateRepoSettings(w http.ResponseWriter, r *http.Request) {
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

	var req UpdateRepoSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Remote != nil {
		remote := *req.Remote
		if remote != "" {
			// Validate that the remote exists
			remotes, err := h.repoManager.ListRemotes(ctx, repo.Path)
			if err != nil {
				writeInternalError(w, "failed to list remotes", err)
				return
			}
			found := false
			for _, r := range remotes {
				if r == remote {
					found = true
					break
				}
			}
			if !found {
				writeValidationError(w, fmt.Sprintf("remote '%s' does not exist", remote))
				return
			}
		}
		repo.Remote = remote
	}

	if req.Branch != nil {
		branch := *req.Branch
		if branch != "" {
			if !h.repoManager.RefExists(ctx, repo.Path, branch) {
				writeValidationError(w, fmt.Sprintf("branch '%s' does not exist", branch))
				return
			}
		}
		repo.Branch = branch
	}

	if req.BranchPrefix != nil {
		repo.BranchPrefix = *req.BranchPrefix
	}
	if req.CustomPrefix != nil {
		repo.CustomPrefix = *req.CustomPrefix
	}

	if err := h.store.UpdateRepo(ctx, repo); err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, repo)
}

type RepoRemotesResponse struct {
	Remotes  []string            `json:"remotes"`
	Branches map[string][]string `json:"branches"`
}

func (h *Handlers) GetRepoRemotes(w http.ResponseWriter, r *http.Request) {
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

	remotes, err := h.repoManager.ListRemotes(ctx, repo.Path)
	if err != nil {
		writeInternalError(w, "failed to list remotes", err)
		return
	}

	branches := make(map[string][]string)
	for _, remote := range remotes {
		remoteBranches, err := h.repoManager.ListRemoteBranches(ctx, repo.Path, remote)
		if err != nil {
			continue
		}
		branches[remote] = remoteBranches
	}

	writeJSON(w, RepoRemotesResponse{
		Remotes:  remotes,
		Branches: branches,
	})
}
