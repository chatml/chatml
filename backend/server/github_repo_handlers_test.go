package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chatml/chatml-backend/github"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupGitHubRepoHandlers creates handlers with a mock GitHub API server for repo tests.
func setupGitHubRepoHandlers(t *testing.T, ghHandler http.HandlerFunc) *Handlers {
	t.Helper()

	ghServer := httptest.NewServer(ghHandler)
	t.Cleanup(ghServer.Close)

	h, _ := setupTestHandlersWithGitHub(t, ghServer)

	return h
}

func TestListGitHubRepos_Handler_Success(t *testing.T) {
	h := setupGitHubRepoHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		repos := []map[string]interface{}{
			{
				"full_name":        "owner/repo1",
				"name":             "repo1",
				"owner":            map[string]interface{}{"login": "owner"},
				"description":      "First repo",
				"language":         "Go",
				"private":          false,
				"fork":             false,
				"stargazers_count": 10,
				"clone_url":        "https://github.com/owner/repo1.git",
				"ssh_url":          "git@github.com:owner/repo1.git",
				"updated_at":       "2026-01-15T10:00:00Z",
				"default_branch":   "main",
			},
		}
		json.NewEncoder(w).Encode(repos)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/github/repos", nil)
	rr := httptest.NewRecorder()

	h.ListGitHubRepos(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var resp github.ListGitHubReposResponse
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	require.Len(t, resp.Repos, 1)
	assert.Equal(t, "owner/repo1", resp.Repos[0].FullName)
}

func TestListGitHubRepos_Handler_Unauthenticated(t *testing.T) {
	h, _ := setupTestHandlers(t)
	// h.ghClient is nil by default

	req := httptest.NewRequest(http.MethodGet, "/api/github/repos", nil)
	rr := httptest.NewRecorder()

	h.ListGitHubRepos(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)

	var apiErr APIError
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&apiErr))
	assert.Equal(t, ErrCodeUnauthorized, apiErr.Code)
}

func TestListGitHubRepos_Handler_QueryParams(t *testing.T) {
	h := setupGitHubRepoHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "2", r.URL.Query().Get("page"))
		assert.Equal(t, "10", r.URL.Query().Get("per_page"))
		assert.Equal(t, "created", r.URL.Query().Get("sort"))

		json.NewEncoder(w).Encode([]map[string]interface{}{})
	})

	req := httptest.NewRequest(http.MethodGet, "/api/github/repos?page=2&per_page=10&sort=created", nil)
	rr := httptest.NewRecorder()

	h.ListGitHubRepos(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestListGitHubRepos_Handler_OrgFilter(t *testing.T) {
	h := setupGitHubRepoHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		// Verify it hits the org repos endpoint
		assert.Equal(t, "/orgs/my-org/repos", r.URL.Path)

		json.NewEncoder(w).Encode([]map[string]interface{}{})
	})

	req := httptest.NewRequest(http.MethodGet, "/api/github/repos?org=my-org", nil)
	rr := httptest.NewRecorder()

	h.ListGitHubRepos(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestListGitHubRepos_Handler_SearchFilter(t *testing.T) {
	h := setupGitHubRepoHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		// When search is provided, the handler should call the GitHub search API
		assert.Equal(t, "/search/repositories", r.URL.Path)

		// Return a search API response format
		result := map[string]interface{}{
			"total_count": 1,
			"items": []map[string]interface{}{
				{
					"full_name": "owner/matching-repo", "name": "matching-repo",
					"owner": map[string]interface{}{"login": "owner"}, "description": "Has the keyword",
					"language": "Go", "private": false, "fork": false, "stargazers_count": 5,
					"clone_url": "https://github.com/owner/matching-repo.git",
					"ssh_url": "git@github.com:owner/matching-repo.git",
					"updated_at": "2026-01-15T10:00:00Z", "default_branch": "main",
				},
			},
		}
		json.NewEncoder(w).Encode(result)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/github/repos?search=matching", nil)
	rr := httptest.NewRecorder()

	h.ListGitHubRepos(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var resp github.ListGitHubReposResponse
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	require.Len(t, resp.Repos, 1)
	assert.Equal(t, "matching-repo", resp.Repos[0].Name)
}

func TestListGitHubRepos_Handler_DefaultParams(t *testing.T) {
	h := setupGitHubRepoHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "1", r.URL.Query().Get("page"))
		assert.Equal(t, "30", r.URL.Query().Get("per_page"))
		assert.Equal(t, "updated", r.URL.Query().Get("sort"))
		assert.Equal(t, "all", r.URL.Query().Get("type"))

		json.NewEncoder(w).Encode([]map[string]interface{}{})
	})

	// No query params — defaults should be applied
	req := httptest.NewRequest(http.MethodGet, "/api/github/repos", nil)
	rr := httptest.NewRecorder()

	h.ListGitHubRepos(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestListGitHubOrgs_Handler_Success(t *testing.T) {
	h := setupGitHubRepoHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		orgs := []map[string]interface{}{
			{"login": "org-one", "avatar_url": "https://avatars.github.com/u/1"},
		}
		json.NewEncoder(w).Encode(orgs)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/github/orgs", nil)
	rr := httptest.NewRecorder()

	h.ListGitHubOrgs(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var orgs []github.GitHubOrgDTO
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&orgs))
	require.Len(t, orgs, 1)
	assert.Equal(t, "org-one", orgs[0].Login)
}

func TestListGitHubOrgs_Handler_Unauthenticated(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest(http.MethodGet, "/api/github/orgs", nil)
	rr := httptest.NewRecorder()

	h.ListGitHubOrgs(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestResolveGitHubRepo_Handler_Success(t *testing.T) {
	h := setupGitHubRepoHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/repos/owner/test-repo", r.URL.Path)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"full_name":        "owner/test-repo",
			"name":             "test-repo",
			"owner":            map[string]interface{}{"login": "owner"},
			"description":      "A test repo",
			"language":         "TypeScript",
			"private":          false,
			"fork":             false,
			"stargazers_count": 100,
			"clone_url":        "https://github.com/owner/test-repo.git",
			"ssh_url":          "git@github.com:owner/test-repo.git",
			"updated_at":       "2026-01-15T10:00:00Z",
			"default_branch":   "main",
		})
	})

	body, _ := json.Marshal(ResolveGitHubRepoRequest{URL: "https://github.com/owner/test-repo"})
	req := httptest.NewRequest(http.MethodPost, "/api/github/resolve-repo", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	h.ResolveGitHubRepo(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var repo github.GitHubRepoDTO
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&repo))
	assert.Equal(t, "owner/test-repo", repo.FullName)
	assert.Equal(t, 100, repo.Stars)
}

func TestResolveGitHubRepo_Handler_InvalidURL(t *testing.T) {
	h := setupGitHubRepoHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("GitHub API should not be called for invalid URLs")
	})

	body, _ := json.Marshal(ResolveGitHubRepoRequest{URL: "https://gitlab.com/user/repo"})
	req := httptest.NewRequest(http.MethodPost, "/api/github/resolve-repo", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	h.ResolveGitHubRepo(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)

	var apiErr APIError
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&apiErr))
	assert.Contains(t, apiErr.Error, "not a valid GitHub")
}

func TestResolveGitHubRepo_Handler_MissingURL(t *testing.T) {
	h := setupGitHubRepoHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("GitHub API should not be called")
	})

	body, _ := json.Marshal(ResolveGitHubRepoRequest{URL: ""})
	req := httptest.NewRequest(http.MethodPost, "/api/github/resolve-repo", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	h.ResolveGitHubRepo(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestResolveGitHubRepo_Handler_RepoNotFound(t *testing.T) {
	h := setupGitHubRepoHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"message":"Not Found"}`))
	})

	body, _ := json.Marshal(ResolveGitHubRepoRequest{URL: "https://github.com/owner/nonexistent"})
	req := httptest.NewRequest(http.MethodPost, "/api/github/resolve-repo", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	h.ResolveGitHubRepo(rr, req)

	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestResolveGitHubRepo_Handler_Unauthenticated(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body, _ := json.Marshal(ResolveGitHubRepoRequest{URL: "https://github.com/owner/repo"})
	req := httptest.NewRequest(http.MethodPost, "/api/github/resolve-repo", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	h.ResolveGitHubRepo(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestResolveGitHubRepo_Handler_URLParsing(t *testing.T) {
	tests := []struct {
		name          string
		url           string
		expectOwner   string
		expectRepo    string
		expectInvalid bool
	}{
		{"https basic", "https://github.com/owner/repo", "owner", "repo", false},
		{"https with .git", "https://github.com/owner/repo.git", "owner", "repo", false},
		{"https with tree path", "https://github.com/owner/repo/tree/main", "owner", "repo", false},
		{"https with pull path", "https://github.com/owner/repo/pull/123", "owner", "repo", false},
		{"ssh git@", "git@github.com:owner/repo.git", "owner", "repo", false},
		{"ssh://", "ssh://git@github.com/owner/repo", "owner", "repo", false},
		{"gitlab url", "https://gitlab.com/owner/repo", "", "", true},
		{"not a url", "not-a-url", "", "", true},
		{"empty", "", "", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			owner, repo := parseGitHubURL(tt.url)
			if tt.expectInvalid {
				assert.Empty(t, owner)
				assert.Empty(t, repo)
			} else {
				assert.Equal(t, tt.expectOwner, owner)
				assert.Equal(t, tt.expectRepo, repo)
			}
		})
	}
}
