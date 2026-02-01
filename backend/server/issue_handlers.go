package server

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/logger"
	"github.com/go-chi/chi/v5"
)

// ListIssues returns GitHub issues for a workspace's repository.
// Supports query params: state (open|closed|all, default: open), labels (comma-separated).
// Uses stale-while-revalidate caching to minimize GitHub API calls.
func (h *Handlers) ListIssues(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if h.ghClient == nil || !h.ghClient.IsAuthenticated() {
		writeJSON(w, []github.IssueListItem{})
		return
	}

	// Resolve repo and GitHub remote
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

	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err != nil {
		writeJSON(w, []github.IssueListItem{})
		return
	}

	// Query params
	state := r.URL.Query().Get("state")
	labels := r.URL.Query().Get("labels")
	if state == "" {
		state = "open"
	}

	// Check cache with stale-while-revalidate
	entry, freshness := h.issueCache.GetWithStale(owner, repoName, state, labels)

	switch freshness {
	case github.CacheFresh:
		writeJSON(w, entry.Issues)
		return

	case github.CacheStale:
		// Serve stale immediately, trigger background refresh
		writeJSON(w, entry.Issues)
		if h.issueCache.TryStartRefresh(owner, repoName, state, labels) {
			go h.refreshIssueCache(owner, repoName, state, labels)
		}
		return

	default: // CacheMiss
		result, err := h.ghClient.ListIssuesWithETag(ctx, owner, repoName, state, labels, "")
		if err != nil {
			writeInternalError(w, "failed to fetch issues", err)
			return
		}
		h.issueCache.SetFull(owner, repoName, state, labels, result.Issues, result.ETag)
		writeJSON(w, result.Issues)
	}
}

// SearchIssues searches for GitHub issues in a workspace's repository.
// Requires query param: q (search query).
// Does not use caching (search queries are too variable for effective caching).
func (h *Handlers) SearchIssues(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if h.ghClient == nil || !h.ghClient.IsAuthenticated() {
		writeJSON(w, github.SearchIssuesResult{Issues: []github.IssueListItem{}})
		return
	}

	// Resolve repo and GitHub remote
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

	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err != nil {
		writeJSON(w, github.SearchIssuesResult{Issues: []github.IssueListItem{}})
		return
	}

	query := r.URL.Query().Get("q")
	if query == "" {
		writeValidationError(w, "query parameter 'q' is required")
		return
	}

	result, err := h.ghClient.SearchIssues(ctx, owner, repoName, query)
	if err != nil {
		writeInternalError(w, "failed to search issues", err)
		return
	}

	writeJSON(w, result)
}

// GetIssueDetails returns detailed information about a single GitHub issue.
func (h *Handlers) GetIssueDetails(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if h.ghClient == nil || !h.ghClient.IsAuthenticated() {
		writeNotFound(w, "issue")
		return
	}

	// Resolve repo and GitHub remote
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

	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err != nil {
		writeNotFound(w, "issue")
		return
	}

	numberStr := chi.URLParam(r, "number")
	number, err := strconv.Atoi(numberStr)
	if err != nil {
		writeValidationError(w, "invalid issue number")
		return
	}

	issue, err := h.ghClient.GetIssue(ctx, owner, repoName, number)
	if err != nil {
		writeInternalError(w, "failed to fetch issue", err)
		return
	}
	if issue == nil {
		writeNotFound(w, "issue")
		return
	}

	writeJSON(w, issue)
}

// refreshIssueCache performs a background refresh of the issue cache for a repo+filter combination.
// Uses ETag conditional requests to avoid re-fetching unchanged data.
func (h *Handlers) refreshIssueCache(owner, repoName, state, labels string) {
	defer h.issueCache.EndRefresh(owner, repoName, state, labels)
	defer func() {
		if r := recover(); r != nil {
			logger.Handlers.Errorf("Panic in background issue refresh for %s/%s: %v", owner, repoName, r)
		}
	}()

	// Use a bounded timeout for the background refresh. During server shutdown,
	// the HTTP client will fail fast and the 30s timeout provides a hard upper bound.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	etag := h.issueCache.GetETag(owner, repoName, state, labels)
	result, err := h.ghClient.ListIssuesWithETag(ctx, owner, repoName, state, labels, etag)

	if errors.Is(err, github.ErrNotModified) {
		h.issueCache.BumpTTL(owner, repoName, state, labels)
		return
	}
	if err != nil {
		logger.Handlers.Errorf("Background issue refresh failed for %s/%s: %v", owner, repoName, err)
		return
	}

	h.issueCache.SetFull(owner, repoName, state, labels, result.Issues, result.ETag)
}
