package server

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/chatml/chatml-backend/github"
)

// githubURLPattern extracts owner/repo from GitHub URLs.
var githubURLPattern = regexp.MustCompile(
	`(?:https?://github\.com/|git@github\.com:|ssh://git@github\.com/)([^/]+)/([^/.]+)`,
)

// ResolveGitHubRepoRequest is the JSON body for POST /api/github/resolve-repo.
type ResolveGitHubRepoRequest struct {
	URL string `json:"url"`
}

// ListGitHubRepos handles GET /api/github/repos.
func (h *Handlers) ListGitHubRepos(w http.ResponseWriter, r *http.Request) {
	if h.ghClient == nil || !h.ghClient.IsAuthenticated() {
		writeUnauthorized(w, "GitHub authentication required")
		return
	}

	ctx := r.Context()
	q := r.URL.Query()

	page := github.ParsePageParam(q.Get("page"), 1)
	perPage := github.ParsePageParam(q.Get("per_page"), 30)
	sort := q.Get("sort")
	org := q.Get("org")
	repoType := q.Get("type")

	if perPage > 100 {
		perPage = 100
	}

	search := strings.TrimSpace(q.Get("search"))

	var (
		repos   []github.GitHubRepoDTO
		hasMore bool
		err     error
	)

	if search != "" {
		// Use GitHub search API to search across all repos, not just a single page
		repos, hasMore, err = h.ghClient.SearchUserRepos(ctx, search, org, page, perPage)
	} else if org != "" {
		repos, hasMore, err = h.ghClient.ListOrgRepos(ctx, org, page, perPage, sort)
	} else {
		repos, hasMore, err = h.ghClient.ListUserRepos(ctx, page, perPage, sort, repoType)
	}

	if err != nil {
		writeBadGateway(w, "failed to fetch repositories from GitHub", err)
		return
	}

	writeJSON(w, github.ListGitHubReposResponse{
		Repos:      repos,
		TotalCount: len(repos),
		HasMore:    hasMore,
	})
}

// ListGitHubOrgs handles GET /api/github/orgs.
func (h *Handlers) ListGitHubOrgs(w http.ResponseWriter, r *http.Request) {
	if h.ghClient == nil || !h.ghClient.IsAuthenticated() {
		writeUnauthorized(w, "GitHub authentication required")
		return
	}

	orgs, err := h.ghClient.ListUserOrgs(r.Context())
	if err != nil {
		writeBadGateway(w, "failed to fetch organizations from GitHub", err)
		return
	}

	writeJSON(w, orgs)
}

// ResolveGitHubRepo handles POST /api/github/resolve-repo.
func (h *Handlers) ResolveGitHubRepo(w http.ResponseWriter, r *http.Request) {
	if h.ghClient == nil || !h.ghClient.IsAuthenticated() {
		writeUnauthorized(w, "GitHub authentication required")
		return
	}

	var req ResolveGitHubRepoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	req.URL = strings.TrimSpace(req.URL)
	if req.URL == "" {
		writeValidationError(w, "url is required")
		return
	}

	owner, repo := parseGitHubURL(req.URL)
	if owner == "" || repo == "" {
		writeValidationError(w, "not a valid GitHub repository URL")
		return
	}

	repoInfo, err := h.ghClient.GetRepoInfo(r.Context(), owner, repo)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeNotFound(w, "repository")
			return
		}
		writeBadGateway(w, "failed to fetch repository from GitHub", err)
		return
	}

	writeJSON(w, repoInfo)
}

// parseGitHubURL extracts owner and repo name from a GitHub URL.
// Returns empty strings if the URL is not a valid GitHub URL.
func parseGitHubURL(rawURL string) (owner, repo string) {
	matches := githubURLPattern.FindStringSubmatch(rawURL)
	if len(matches) < 3 {
		return "", ""
	}
	return matches[1], matches[2]
}
