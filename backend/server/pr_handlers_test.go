package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetPRTemplate_Empty(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/repos/ws-1/settings/pr-template", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetPRTemplate(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]string
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, "", resp["template"])
}

func TestSetPRTemplate_Success(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// Set a template
	body, _ := json.Marshal(map[string]string{"template": "Always mention the ticket number"})
	req := httptest.NewRequest("PUT", "/api/repos/ws-1/settings/pr-template", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetPRTemplate(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Verify it was saved by reading it back
	req2 := httptest.NewRequest("GET", "/api/repos/ws-1/settings/pr-template", nil)
	req2 = withChiContext(req2, map[string]string{"id": "ws-1"})
	w2 := httptest.NewRecorder()

	h.GetPRTemplate(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)

	var resp map[string]string
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	assert.Equal(t, "Always mention the ticket number", resp["template"])
}

func TestSetPRTemplate_EmptyDeletesTemplate(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Pre-set a template directly in the store
	require.NoError(t, s.SetSetting(ctx, "pr-template:ws-1", "existing template"))

	// Set empty to delete
	body, _ := json.Marshal(map[string]string{"template": ""})
	req := httptest.NewRequest("PUT", "/api/repos/ws-1/settings/pr-template", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetPRTemplate(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Verify template was deleted
	req2 := httptest.NewRequest("GET", "/api/repos/ws-1/settings/pr-template", nil)
	req2 = withChiContext(req2, map[string]string{"id": "ws-1"})
	w2 := httptest.NewRecorder()

	h.GetPRTemplate(w2, req2)

	var resp map[string]string
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	assert.Equal(t, "", resp["template"])
}

func TestSetPRTemplate_InvalidBody(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("PUT", "/api/repos/ws-1/settings/pr-template", bytes.NewReader([]byte("invalid json")))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetPRTemplate(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}
func TestGetGlobalPRTemplate_Empty(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/settings/pr-template", nil)
	w := httptest.NewRecorder()

	h.GetGlobalPRTemplate(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]string
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, "", resp["template"])
}

func TestSetGlobalPRTemplate_Success(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body, _ := json.Marshal(map[string]string{"template": "Include testing checklist"})
	req := httptest.NewRequest("PUT", "/api/settings/pr-template", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetGlobalPRTemplate(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Verify it was saved
	req2 := httptest.NewRequest("GET", "/api/settings/pr-template", nil)
	w2 := httptest.NewRecorder()

	h.GetGlobalPRTemplate(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)

	var resp map[string]string
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	assert.Equal(t, "Include testing checklist", resp["template"])
}

func TestSetGlobalPRTemplate_EmptyDeletes(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	require.NoError(t, s.SetSetting(ctx, "pr-template", "old template"))

	body, _ := json.Marshal(map[string]string{"template": ""})
	req := httptest.NewRequest("PUT", "/api/settings/pr-template", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetGlobalPRTemplate(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Verify deleted
	req2 := httptest.NewRequest("GET", "/api/settings/pr-template", nil)
	w2 := httptest.NewRecorder()
	h.GetGlobalPRTemplate(w2, req2)

	var resp map[string]string
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	assert.Equal(t, "", resp["template"])
}

func TestSetGlobalPRTemplate_InvalidBody(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("PUT", "/api/settings/pr-template", bytes.NewReader([]byte("invalid")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetGlobalPRTemplate(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestPRTemplate_GlobalAndWorkspaceIsolated(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// Set a global template
	globalBody, _ := json.Marshal(map[string]string{"template": "global instructions"})
	req1 := httptest.NewRequest("PUT", "/api/settings/pr-template", bytes.NewReader(globalBody))
	req1.Header.Set("Content-Type", "application/json")
	w1 := httptest.NewRecorder()
	h.SetGlobalPRTemplate(w1, req1)
	assert.Equal(t, http.StatusOK, w1.Code)

	// Workspace endpoint should still be empty
	req2 := httptest.NewRequest("GET", "/api/repos/ws-1/settings/pr-template", nil)
	req2 = withChiContext(req2, map[string]string{"id": "ws-1"})
	w2 := httptest.NewRecorder()
	h.GetPRTemplate(w2, req2)

	var wsResp map[string]string
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &wsResp))
	assert.Equal(t, "", wsResp["template"])

	// Set a workspace template
	wsBody, _ := json.Marshal(map[string]string{"template": "workspace instructions"})
	req3 := httptest.NewRequest("PUT", "/api/repos/ws-1/settings/pr-template", bytes.NewReader(wsBody))
	req3.Header.Set("Content-Type", "application/json")
	req3 = withChiContext(req3, map[string]string{"id": "ws-1"})
	w3 := httptest.NewRecorder()
	h.SetPRTemplate(w3, req3)
	assert.Equal(t, http.StatusOK, w3.Code)

	// Global should still have its value
	req4 := httptest.NewRequest("GET", "/api/settings/pr-template", nil)
	w4 := httptest.NewRecorder()
	h.GetGlobalPRTemplate(w4, req4)

	var globalResp map[string]string
	require.NoError(t, json.Unmarshal(w4.Body.Bytes(), &globalResp))
	assert.Equal(t, "global instructions", globalResp["template"])
}
func TestResolvePR_Success(t *testing.T) {
	ghServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/myorg/myrepo/pulls/42", r.URL.Path)

		pr := map[string]interface{}{
			"number":        42,
			"state":         "open",
			"title":         "Add authentication",
			"html_url":      "https://github.com/myorg/myrepo/pull/42",
			"body":          "Adds OAuth2 authentication flow",
			"draft":         false,
			"additions":     200,
			"deletions":     50,
			"changed_files": 8,
			"head":          map[string]string{"ref": "feature/auth", "sha": "abc123"},
			"base":          map[string]string{"ref": "main"},
			"labels": []map[string]string{
				{"name": "feature"},
			},
			"requested_reviewers": []map[string]string{
				{"login": "alice"},
			},
		}
		json.NewEncoder(w).Encode(pr)
	}))
	defer ghServer.Close()

	h, _ := setupTestHandlersWithGitHub(t, ghServer)

	body, _ := json.Marshal(ResolvePRRequest{URL: "https://github.com/myorg/myrepo/pull/42"})
	req := httptest.NewRequest("POST", "/api/resolve-pr", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ResolvePR(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp ResolvePRResponse
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)

	assert.Equal(t, "myorg", resp.Owner)
	assert.Equal(t, "myrepo", resp.Repo)
	assert.Equal(t, 42, resp.PRNumber)
	assert.Equal(t, "Add authentication", resp.Title)
	assert.Equal(t, "Adds OAuth2 authentication flow", resp.Body)
	assert.Equal(t, "feature/auth", resp.Branch)
	assert.Equal(t, "main", resp.BaseBranch)
	assert.Equal(t, "open", resp.State)
	assert.False(t, resp.IsDraft)
	assert.Equal(t, 200, resp.Additions)
	assert.Equal(t, 50, resp.Deletions)
	assert.Equal(t, 8, resp.ChangedFiles)
	assert.Equal(t, []string{"feature"}, resp.Labels)
	assert.Equal(t, []string{"alice"}, resp.Reviewers)
	assert.Equal(t, "https://github.com/myorg/myrepo/pull/42", resp.HTMLURL)
	// No workspace registered, so matchedWorkspaceId should be empty
	assert.Empty(t, resp.MatchedWorkspaceID)
}

func TestResolvePR_MatchesWorkspace(t *testing.T) {
	ghServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pr := map[string]interface{}{
			"number":              10,
			"state":               "open",
			"title":               "Test PR",
			"html_url":            "https://github.com/testowner/testrepo/pull/10",
			"body":                "Test body",
			"draft":               false,
			"additions":           5,
			"deletions":           2,
			"changed_files":       1,
			"head":                map[string]string{"ref": "test-branch", "sha": "sha1"},
			"base":                map[string]string{"ref": "main"},
			"labels":              []map[string]string{},
			"requested_reviewers": []map[string]string{},
		}
		json.NewEncoder(w).Encode(pr)
	}))
	defer ghServer.Close()

	h, s := setupTestHandlersWithGitHub(t, ghServer)

	// Create a git repo with a github remote that matches the PR URL
	repoPath := createTestGitRepo(t)
	// Set origin to a GitHub URL so GetGitHubRemote can parse it
	runGit(t, repoPath, "remote", "set-url", "origin", "https://github.com/testowner/testrepo.git")

	createTestRepo(t, s, "workspace-1", repoPath)

	body, _ := json.Marshal(ResolvePRRequest{URL: "https://github.com/testowner/testrepo/pull/10"})
	req := httptest.NewRequest("POST", "/api/resolve-pr", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ResolvePR(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp ResolvePRResponse
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)

	assert.Equal(t, "workspace-1", resp.MatchedWorkspaceID)
}

func TestResolvePR_InvalidURL(t *testing.T) {
	ghServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("GitHub API should not be called for invalid URLs")
	}))
	defer ghServer.Close()

	h, _ := setupTestHandlersWithGitHub(t, ghServer)

	tests := []struct {
		name string
		url  string
	}{
		{"empty URL", ""},
		{"not a GitHub URL", "https://gitlab.com/org/repo/pull/1"},
		{"missing PR number", "https://github.com/org/repo/pull/"},
		{"not a PR URL", "https://github.com/org/repo/issues/1"},
		{"random text", "not-a-url-at-all"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body, _ := json.Marshal(ResolvePRRequest{URL: tc.url})
			req := httptest.NewRequest("POST", "/api/resolve-pr", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.ResolvePR(w, req)

			assert.Equal(t, http.StatusBadRequest, w.Code)

			var apiErr APIError
			err := json.Unmarshal(w.Body.Bytes(), &apiErr)
			require.NoError(t, err)
			assert.Equal(t, ErrCodeValidation, apiErr.Code)
		})
	}
}
func TestResolvePR_InvalidRequestBody(t *testing.T) {
	ghServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("GitHub API should not be called for invalid request body")
	}))
	defer ghServer.Close()

	h, _ := setupTestHandlersWithGitHub(t, ghServer)

	req := httptest.NewRequest("POST", "/api/resolve-pr", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ResolvePR(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestResolvePR_NoGitHubClient(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body, _ := json.Marshal(ResolvePRRequest{URL: "https://github.com/org/repo/pull/1"})
	req := httptest.NewRequest("POST", "/api/resolve-pr", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ResolvePR(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestResolvePR_GitHubAPIError(t *testing.T) {
	ghServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ghServer.Close()

	h, _ := setupTestHandlersWithGitHub(t, ghServer)

	body, _ := json.Marshal(ResolvePRRequest{URL: "https://github.com/org/repo/pull/999"})
	req := httptest.NewRequest("POST", "/api/resolve-pr", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ResolvePR(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestResolvePR_URLVariants(t *testing.T) {
	ghServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pr := map[string]interface{}{
			"number":              1,
			"state":               "open",
			"title":               "Test",
			"html_url":            "https://github.com/org/repo/pull/1",
			"body":                "",
			"draft":               false,
			"additions":           0,
			"deletions":           0,
			"changed_files":       0,
			"head":                map[string]string{"ref": "branch", "sha": "sha"},
			"base":                map[string]string{"ref": "main"},
			"labels":              []map[string]string{},
			"requested_reviewers": []map[string]string{},
		}
		json.NewEncoder(w).Encode(pr)
	}))
	defer ghServer.Close()

	h, _ := setupTestHandlersWithGitHub(t, ghServer)

	// Various valid PR URL formats
	urls := []string{
		"https://github.com/org/repo/pull/1",
		"http://github.com/org/repo/pull/1",
		"github.com/org/repo/pull/1",
		"https://github.com/org/repo/pull/1/files",
		"https://github.com/org/repo/pull/1/commits",
	}

	for _, url := range urls {
		t.Run(url, func(t *testing.T) {
			body, _ := json.Marshal(ResolvePRRequest{URL: url})
			req := httptest.NewRequest("POST", "/api/resolve-pr", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.ResolvePR(w, req)

			assert.Equal(t, http.StatusOK, w.Code, "URL %s should be accepted", url)
		})
	}
}
