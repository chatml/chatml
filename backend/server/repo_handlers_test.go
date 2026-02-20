package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAddRepo_Success(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// Create a real git repo for testing
	repoPath := createTestGitRepo(t)

	body, _ := json.Marshal(AddRepoRequest{Path: repoPath})
	req := httptest.NewRequest("POST", "/api/repos", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.AddRepo(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var repo models.Repo
	err := json.Unmarshal(w.Body.Bytes(), &repo)
	require.NoError(t, err)
	assert.NotEmpty(t, repo.ID)
	assert.Equal(t, repoPath, repo.Path)
	assert.NotEmpty(t, repo.Name)
}

func TestAddRepo_InvalidJSON(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("POST", "/api/repos", bytes.NewReader([]byte("invalid json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.AddRepo(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAddRepo_NotGitRepo(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// Use a regular directory (not a git repo)
	notGitDir := t.TempDir()

	body, _ := json.Marshal(AddRepoRequest{Path: notGitDir})
	req := httptest.NewRequest("POST", "/api/repos", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.AddRepo(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	// Verify JSON error format
	var apiErr APIError
	err := json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeValidation, apiErr.Code)
	assert.Equal(t, "invalid repository path", apiErr.Error)
}

func TestAddRepo_AlreadyExists(t *testing.T) {
	h, s := setupTestHandlers(t)

	repoPath := createTestGitRepo(t)

	// Add the repo first
	createTestRepo(t, s, "repo-1", repoPath)

	// Try to add again
	body, _ := json.Marshal(AddRepoRequest{Path: repoPath})
	req := httptest.NewRequest("POST", "/api/repos", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.AddRepo(w, req)

	assert.Equal(t, http.StatusConflict, w.Code)
	assert.Contains(t, w.Body.String(), "already added")
}

func TestListRepos_Empty(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/repos", nil)
	w := httptest.NewRecorder()

	h.ListRepos(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var repos []*models.Repo
	err := json.Unmarshal(w.Body.Bytes(), &repos)
	require.NoError(t, err)
	assert.Empty(t, repos)
}

func TestListRepos_Multiple(t *testing.T) {
	h, s := setupTestHandlers(t)

	// Add some repos
	createTestRepo(t, s, "repo-1", "/path/to/repo1")
	createTestRepo(t, s, "repo-2", "/path/to/repo2")

	req := httptest.NewRequest("GET", "/api/repos", nil)
	w := httptest.NewRecorder()

	h.ListRepos(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var repos []*models.Repo
	err := json.Unmarshal(w.Body.Bytes(), &repos)
	require.NoError(t, err)
	assert.Len(t, repos, 2)
}

func TestGetRepo_Exists(t *testing.T) {
	h, s := setupTestHandlers(t)

	repo := createTestRepo(t, s, "repo-1", "/path/to/repo")

	req := httptest.NewRequest("GET", "/api/repos/repo-1", nil)
	req = withChiContext(req, map[string]string{"id": "repo-1"})
	w := httptest.NewRecorder()

	h.GetRepo(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var gotRepo models.Repo
	err := json.Unmarshal(w.Body.Bytes(), &gotRepo)
	require.NoError(t, err)
	assert.Equal(t, repo.ID, gotRepo.ID)
	assert.Equal(t, repo.Path, gotRepo.Path)
}

func TestGetRepo_NotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/repos/nonexistent", nil)
	req = withChiContext(req, map[string]string{"id": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetRepo(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestDeleteRepo_Success(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	createTestRepo(t, s, "repo-1", "/path/to/repo")

	req := httptest.NewRequest("DELETE", "/api/repos/repo-1", nil)
	req = withChiContext(req, map[string]string{"id": "repo-1"})
	w := httptest.NewRecorder()

	h.DeleteRepo(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)

	// Verify deleted
	repo, err := s.GetRepo(ctx, "repo-1")
	require.NoError(t, err)
	assert.Nil(t, repo)
}
func TestUpdateRepoSettings_Branch(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "repo-1", repoPath)

	// Create a "develop" branch and push it to origin
	runGit(t, repoPath, "checkout", "-b", "develop")
	runGit(t, repoPath, "push", "origin", "develop")
	runGit(t, repoPath, "checkout", "main")

	body, _ := json.Marshal(UpdateRepoSettingsRequest{Branch: stringPtr("develop")})
	req := httptest.NewRequest("PATCH", "/api/repos/repo-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "repo-1"})
	w := httptest.NewRecorder()

	h.UpdateRepoSettings(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var repo models.Repo
	err := json.Unmarshal(w.Body.Bytes(), &repo)
	require.NoError(t, err)
	assert.Equal(t, "develop", repo.Branch)
}

func TestUpdateRepoSettings_Remote(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "repo-1", repoPath)

	// Add an "upstream" remote
	upstreamDir := t.TempDir()
	runGit(t, upstreamDir, "init", "--bare")
	runGit(t, repoPath, "remote", "add", "upstream", upstreamDir)

	body, _ := json.Marshal(UpdateRepoSettingsRequest{Remote: stringPtr("upstream")})
	req := httptest.NewRequest("PATCH", "/api/repos/repo-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "repo-1"})
	w := httptest.NewRecorder()

	h.UpdateRepoSettings(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var repo models.Repo
	err := json.Unmarshal(w.Body.Bytes(), &repo)
	require.NoError(t, err)
	assert.Equal(t, "upstream", repo.Remote)
}

func TestUpdateRepoSettings_BranchPrefixAndCustomPrefix(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "repo-1", repoPath)

	body, _ := json.Marshal(UpdateRepoSettingsRequest{
		BranchPrefix: stringPtr("custom"),
		CustomPrefix: stringPtr("my-prefix"),
	})
	req := httptest.NewRequest("PATCH", "/api/repos/repo-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "repo-1"})
	w := httptest.NewRecorder()

	h.UpdateRepoSettings(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var repo models.Repo
	err := json.Unmarshal(w.Body.Bytes(), &repo)
	require.NoError(t, err)
	assert.Equal(t, "custom", repo.BranchPrefix)
	assert.Equal(t, "my-prefix", repo.CustomPrefix)
}

func TestUpdateRepoSettings_NotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body, _ := json.Marshal(UpdateRepoSettingsRequest{Branch: stringPtr("main")})
	req := httptest.NewRequest("PATCH", "/api/repos/nonexistent", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "nonexistent"})
	w := httptest.NewRecorder()

	h.UpdateRepoSettings(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestUpdateRepoSettings_InvalidJSON(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "repo-1", repoPath)

	req := httptest.NewRequest("PATCH", "/api/repos/repo-1", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "repo-1"})
	w := httptest.NewRecorder()

	h.UpdateRepoSettings(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUpdateRepoSettings_RemoteDoesNotExist(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "repo-1", repoPath)

	body, _ := json.Marshal(UpdateRepoSettingsRequest{Remote: stringPtr("nonexistent-remote")})
	req := httptest.NewRequest("PATCH", "/api/repos/repo-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "repo-1"})
	w := httptest.NewRecorder()

	h.UpdateRepoSettings(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	var apiErr APIError
	err := json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Contains(t, apiErr.Error, "nonexistent-remote")
}

func TestUpdateRepoSettings_BranchDoesNotExist(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "repo-1", repoPath)

	body, _ := json.Marshal(UpdateRepoSettingsRequest{Branch: stringPtr("nonexistent-branch")})
	req := httptest.NewRequest("PATCH", "/api/repos/repo-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "repo-1"})
	w := httptest.NewRecorder()

	h.UpdateRepoSettings(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	var apiErr APIError
	err := json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Contains(t, apiErr.Error, "nonexistent-branch")
}

func TestUpdateRepoSettings_PartialUpdate(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)

	// Set initial values via store
	repo.Remote = "origin"
	repo.BranchPrefix = "none"
	repo.CustomPrefix = "old-prefix"
	require.NoError(t, s.UpdateRepo(context.Background(), repo))

	// Only update BranchPrefix, leave everything else unchanged
	body, _ := json.Marshal(UpdateRepoSettingsRequest{BranchPrefix: stringPtr("custom")})
	req := httptest.NewRequest("PATCH", "/api/repos/repo-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "repo-1"})
	w := httptest.NewRecorder()

	h.UpdateRepoSettings(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var updated models.Repo
	err := json.Unmarshal(w.Body.Bytes(), &updated)
	require.NoError(t, err)
	assert.Equal(t, "main", updated.Branch, "branch should remain unchanged")
	assert.Equal(t, "origin", updated.Remote, "remote should remain unchanged")
	assert.Equal(t, "custom", updated.BranchPrefix, "branchPrefix should be updated")
	assert.Equal(t, "old-prefix", updated.CustomPrefix, "customPrefix should remain unchanged")
}
func TestGetRepoRemotes_Success(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "repo-1", repoPath)

	// Add an upstream remote
	upstreamDir := t.TempDir()
	runGit(t, upstreamDir, "init", "--bare")
	runGit(t, repoPath, "remote", "add", "upstream", upstreamDir)

	// Push a branch to upstream
	runGit(t, repoPath, "push", "upstream", "main")

	req := httptest.NewRequest("GET", "/api/repos/repo-1/remotes", nil)
	req = withChiContext(req, map[string]string{"id": "repo-1"})
	w := httptest.NewRecorder()

	h.GetRepoRemotes(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp RepoRemotesResponse
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.Contains(t, resp.Remotes, "origin")
	assert.Contains(t, resp.Remotes, "upstream")
	assert.Contains(t, resp.Branches, "origin")
	// Remote branches may include the remote prefix depending on implementation
	require.NotEmpty(t, resp.Branches["origin"], "origin should have at least one branch")
}

func TestGetRepoRemotes_NotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/repos/nonexistent/remotes", nil)
	req = withChiContext(req, map[string]string{"id": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetRepoRemotes(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}
