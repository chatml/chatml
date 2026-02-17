package github

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupMockGitHubServer creates a mock GitHub API server with custom handler.
func setupMockGitHubServer(t *testing.T, handler http.HandlerFunc) (*httptest.Server, *Client) {
	t.Helper()

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	client := NewClient("test-client-id", "test-client-secret")
	client.SetAPIURL(server.URL)
	client.SetToken("test-token")

	return server, client
}

// setupUnauthenticatedClient creates a client with no token.
func setupUnauthenticatedClient(t *testing.T, serverURL string) *Client {
	t.Helper()

	client := NewClient("test-client-id", "test-client-secret")
	client.SetAPIURL(serverURL)
	// No token set
	return client
}

// sampleGitHubRepoJSON returns a sample GitHub API repo response.
func sampleGitHubRepoJSON() map[string]interface{} {
	return map[string]interface{}{
		"full_name":      "owner/test-repo",
		"name":           "test-repo",
		"owner":          map[string]interface{}{"login": "owner"},
		"description":    "A test repository",
		"language":       "Go",
		"private":        false,
		"fork":           false,
		"stargazers_count": 42,
		"clone_url":      "https://github.com/owner/test-repo.git",
		"ssh_url":        "git@github.com:owner/test-repo.git",
		"updated_at":     "2026-01-15T10:00:00Z",
		"default_branch": "main",
	}
}

func TestListUserRepos_Success(t *testing.T) {
	_, client := setupMockGitHubServer(t, func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/user/repos", r.URL.Path)
		assert.Equal(t, "Bearer test-token", r.Header.Get("Authorization"))

		repos := []map[string]interface{}{sampleGitHubRepoJSON()}
		json.NewEncoder(w).Encode(repos)
	})

	repos, hasMore, err := client.ListUserRepos(context.Background(), 1, 30, "updated", "all")
	require.NoError(t, err)
	require.Len(t, repos, 1)
	assert.False(t, hasMore) // 1 result < 30 per_page

	r := repos[0]
	assert.Equal(t, "owner/test-repo", r.FullName)
	assert.Equal(t, "test-repo", r.Name)
	assert.Equal(t, "owner", r.Owner)
	assert.Equal(t, "A test repository", r.Description)
	assert.Equal(t, "Go", r.Language)
	assert.False(t, r.Private)
	assert.False(t, r.Fork)
	assert.Equal(t, 42, r.Stars)
	assert.Equal(t, "https://github.com/owner/test-repo.git", r.CloneURL)
	assert.Equal(t, "git@github.com:owner/test-repo.git", r.SSHURL)
	assert.Equal(t, "main", r.DefaultBranch)
}

func TestListUserRepos_Pagination(t *testing.T) {
	_, client := setupMockGitHubServer(t, func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "2", r.URL.Query().Get("page"))
		assert.Equal(t, "10", r.URL.Query().Get("per_page"))
		assert.Equal(t, "created", r.URL.Query().Get("sort"))
		assert.Equal(t, "owner", r.URL.Query().Get("type"))

		json.NewEncoder(w).Encode([]map[string]interface{}{})
	})

	repos, _, err := client.ListUserRepos(context.Background(), 2, 10, "created", "owner")
	require.NoError(t, err)
	assert.Empty(t, repos)
}

func TestListUserRepos_Unauthenticated(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("server should not be called")
	}))
	defer server.Close()

	client := setupUnauthenticatedClient(t, server.URL)

	_, _, err := client.ListUserRepos(context.Background(), 1, 30, "", "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not authenticated")
}

func TestListUserRepos_GitHubError(t *testing.T) {
	_, client := setupMockGitHubServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"message":"Internal Server Error"}`))
	})

	_, _, err := client.ListUserRepos(context.Background(), 1, 30, "", "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "500")
}

func TestListUserRepos_EmptyResponse(t *testing.T) {
	_, client := setupMockGitHubServer(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	})

	repos, hasMore, err := client.ListUserRepos(context.Background(), 1, 30, "", "")
	require.NoError(t, err)
	assert.Empty(t, repos)
	assert.False(t, hasMore)
}

func TestListUserRepos_HasMore(t *testing.T) {
	_, client := setupMockGitHubServer(t, func(w http.ResponseWriter, r *http.Request) {
		// Return exactly per_page items to indicate more pages
		repos := make([]map[string]interface{}, 5)
		for i := range repos {
			repos[i] = sampleGitHubRepoJSON()
		}
		json.NewEncoder(w).Encode(repos)
	})

	_, hasMore, err := client.ListUserRepos(context.Background(), 1, 5, "", "")
	require.NoError(t, err)
	assert.True(t, hasMore)
}

func TestListOrgRepos_Success(t *testing.T) {
	_, client := setupMockGitHubServer(t, func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/orgs/my-org/repos", r.URL.Path)
		assert.Equal(t, "Bearer test-token", r.Header.Get("Authorization"))

		repo := sampleGitHubRepoJSON()
		repo["owner"] = map[string]interface{}{"login": "my-org"}
		json.NewEncoder(w).Encode([]map[string]interface{}{repo})
	})

	repos, _, err := client.ListOrgRepos(context.Background(), "my-org", 1, 30, "updated")
	require.NoError(t, err)
	require.Len(t, repos, 1)
	assert.Equal(t, "my-org", repos[0].Owner)
}

func TestListOrgRepos_OrgNotFound(t *testing.T) {
	_, client := setupMockGitHubServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"message":"Not Found"}`))
	})

	_, _, err := client.ListOrgRepos(context.Background(), "nonexistent-org", 1, 30, "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestListUserOrgs_Success(t *testing.T) {
	_, client := setupMockGitHubServer(t, func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/user/orgs", r.URL.Path)

		orgs := []map[string]interface{}{
			{"login": "org-one", "avatar_url": "https://avatars.github.com/u/1"},
			{"login": "org-two", "avatar_url": "https://avatars.github.com/u/2"},
		}
		json.NewEncoder(w).Encode(orgs)
	})

	orgs, err := client.ListUserOrgs(context.Background())
	require.NoError(t, err)
	require.Len(t, orgs, 2)
	assert.Equal(t, "org-one", orgs[0].Login)
	assert.Equal(t, "https://avatars.github.com/u/1", orgs[0].AvatarURL)
	assert.Equal(t, "org-two", orgs[1].Login)
}

func TestListUserOrgs_Empty(t *testing.T) {
	_, client := setupMockGitHubServer(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	})

	orgs, err := client.ListUserOrgs(context.Background())
	require.NoError(t, err)
	assert.Empty(t, orgs)
}

func TestGetRepoInfo_Success(t *testing.T) {
	_, client := setupMockGitHubServer(t, func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/repos/owner/test-repo", r.URL.Path)

		json.NewEncoder(w).Encode(sampleGitHubRepoJSON())
	})

	repo, err := client.GetRepoInfo(context.Background(), "owner", "test-repo")
	require.NoError(t, err)
	assert.Equal(t, "owner/test-repo", repo.FullName)
	assert.Equal(t, "test-repo", repo.Name)
	assert.Equal(t, "owner", repo.Owner)
	assert.Equal(t, 42, repo.Stars)
}

func TestGetRepoInfo_NotFound(t *testing.T) {
	_, client := setupMockGitHubServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"message":"Not Found"}`))
	})

	_, err := client.GetRepoInfo(context.Background(), "owner", "nonexistent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestGetRepoInfo_FieldMapping(t *testing.T) {
	// Table-driven test to verify each GitHub API field maps to the correct DTO field
	_, client := setupMockGitHubServer(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"full_name":        "test-owner/test-name",
			"name":             "test-name",
			"owner":            map[string]interface{}{"login": "test-owner"},
			"description":      "Test description",
			"language":         "TypeScript",
			"private":          true,
			"fork":             true,
			"stargazers_count": 999,
			"clone_url":        "https://github.com/test-owner/test-name.git",
			"ssh_url":          "git@github.com:test-owner/test-name.git",
			"updated_at":       "2026-02-01T12:00:00Z",
			"default_branch":   "develop",
		})
	})

	repo, err := client.GetRepoInfo(context.Background(), "test-owner", "test-name")
	require.NoError(t, err)

	tests := []struct {
		field    string
		got      interface{}
		expected interface{}
	}{
		{"FullName", repo.FullName, "test-owner/test-name"},
		{"Name", repo.Name, "test-name"},
		{"Owner", repo.Owner, "test-owner"},
		{"Description", repo.Description, "Test description"},
		{"Language", repo.Language, "TypeScript"},
		{"Private", repo.Private, true},
		{"Fork", repo.Fork, true},
		{"Stars", repo.Stars, 999},
		{"CloneURL", repo.CloneURL, "https://github.com/test-owner/test-name.git"},
		{"SSHURL", repo.SSHURL, "git@github.com:test-owner/test-name.git"},
		{"UpdatedAt", repo.UpdatedAt, "2026-02-01T12:00:00Z"},
		{"DefaultBranch", repo.DefaultBranch, "develop"},
	}

	for _, tt := range tests {
		t.Run(tt.field, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.got)
		})
	}
}

func TestContainsNextLink(t *testing.T) {
	tests := []struct {
		name     string
		link     string
		expected bool
	}{
		{"has next", `<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=5>; rel="last"`, true},
		{"no next", `<https://api.github.com/user/repos?page=5>; rel="last"`, false},
		{"empty", "", false},
		{"only next", `<https://api.github.com/user/repos?page=2>; rel="next"`, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, containsNextLink(tt.link))
		})
	}
}

func TestParsePageParam(t *testing.T) {
	tests := []struct {
		input    string
		def      int
		expected int
	}{
		{"", 1, 1},
		{"5", 1, 5},
		{"0", 1, 1},
		{"-1", 1, 1},
		{"abc", 1, 1},
		{"100", 30, 100},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			assert.Equal(t, tt.expected, ParsePageParam(tt.input, tt.def))
		})
	}
}

func TestListUserRepos_DefaultParams(t *testing.T) {
	_, client := setupMockGitHubServer(t, func(w http.ResponseWriter, r *http.Request) {
		// Verify defaults are applied
		assert.Equal(t, "1", r.URL.Query().Get("page"))
		assert.Equal(t, "30", r.URL.Query().Get("per_page"))
		assert.Equal(t, "updated", r.URL.Query().Get("sort"))
		assert.Equal(t, "all", r.URL.Query().Get("type"))

		json.NewEncoder(w).Encode([]map[string]interface{}{})
	})

	// Pass zero/empty values to trigger defaults
	_, _, err := client.ListUserRepos(context.Background(), 0, 0, "", "")
	require.NoError(t, err)
}
