package server

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	gitpkg "github.com/chatml/chatml-core/git"
	"github.com/chatml/chatml-backend/models"
	"github.com/google/uuid"
)

// CloneRepoRequest is the JSON body for POST /api/clone.
type CloneRepoRequest struct {
	URL     string `json:"url"`
	Path    string `json:"path"`
	DirName string `json:"dirName"`
}

// CloneRepoResponse is the response for a successful clone.
type CloneRepoResponse struct {
	Path string       `json:"path"`
	Repo *models.Repo `json:"repo"`
}

// CloneRepo handles POST /api/clone — clones a git repository and auto-registers it as a workspace.
func (h *Handlers) CloneRepo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req CloneRepoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	req.URL = strings.TrimSpace(req.URL)
	req.Path = strings.TrimSpace(req.Path)
	req.DirName = strings.TrimSpace(req.DirName)

	if req.URL == "" {
		writeValidationError(w, "url is required")
		return
	}
	if req.Path == "" {
		writeValidationError(w, "path is required")
		return
	}
	if req.DirName == "" {
		writeValidationError(w, "dirName is required")
		return
	}

	if !gitpkg.IsValidGitURL(req.URL) {
		writeValidationError(w, "invalid git URL format")
		return
	}

	// Validate parent directory exists
	info, err := os.Stat(req.Path)
	if err != nil {
		if os.IsNotExist(err) {
			writeValidationError(w, "clone directory does not exist")
			return
		}
		writeInternalError(w, "cannot access clone directory", err)
		return
	}
	if !info.IsDir() {
		writeValidationError(w, "clone path is not a directory")
		return
	}

	// Perform the clone
	clonedPath, err := h.repoManager.CloneRepo(ctx, req.URL, req.Path, req.DirName)
	if err != nil {
		errMsg := err.Error()
		switch {
		case strings.Contains(errMsg, "directory already exists"):
			writeConflict(w, "directory already exists")
		case strings.Contains(errMsg, "authentication failed"):
			writeUnauthorized(w, errMsg)
		case strings.Contains(errMsg, "SSH authentication failed"):
			writeUnauthorized(w, errMsg)
		case strings.Contains(errMsg, "repository not found"):
			writeError(w, http.StatusNotFound, ErrCodeNotFound, errMsg, nil)
		case strings.Contains(errMsg, "timed out"):
			writeError(w, http.StatusGatewayTimeout, "GATEWAY_TIMEOUT", errMsg, err)
		case strings.Contains(errMsg, "cancelled"):
			// Client cancelled — connection is likely already closed
			return
		default:
			writeBadGateway(w, "git clone failed", err)
		}
		return
	}

	// Auto-register the cloned repo as a workspace (same pattern as AddRepo handler)
	branch, _ := h.repoManager.GetCurrentBranch(ctx, clonedPath)

	repo := &models.Repo{
		ID:        uuid.New().String(),
		Name:      h.repoManager.GetRepoName(clonedPath),
		Path:      clonedPath,
		Branch:    branch,
		CreatedAt: time.Now(),
	}

	if err := h.store.AddRepo(ctx, repo); err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, CloneRepoResponse{
		Path: clonedPath,
		Repo: repo,
	})
}
