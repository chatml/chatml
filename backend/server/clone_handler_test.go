package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// createBareTestRepoForClone creates a bare git repository with an initial commit,
// suitable as a clone source for handler tests. Returns a file:// URL.
func createBareTestRepoForClone(t *testing.T) string {
	t.Helper()

	workDir := t.TempDir()
	runGit(t, workDir, "init")
	runGit(t, workDir, "config", "user.email", "test@test.com")
	runGit(t, workDir, "config", "user.name", "Test User")
	runGit(t, workDir, "checkout", "-b", "main")
	writeFile(t, workDir, "README.md", "# Test Repository")
	runGit(t, workDir, "add", ".")
	runGit(t, workDir, "commit", "-m", "Initial commit")

	bareDir := t.TempDir()
	runGit(t, bareDir, "clone", "--bare", workDir, ".")

	return "file://" + bareDir
}

func TestCloneRepo_Handler_Success(t *testing.T) {
	h, s := setupTestHandlers(t)
	bareRepo := createBareTestRepoForClone(t)
	parentDir := t.TempDir()

	body, _ := json.Marshal(CloneRepoRequest{
		URL:     bareRepo,
		Path:    parentDir,
		DirName: "test-clone",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/clone", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	h.CloneRepo(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var resp CloneRepoResponse
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, filepath.Join(parentDir, "test-clone"), resp.Path)
	assert.NotEmpty(t, resp.Repo.ID)
	assert.Equal(t, "test-clone", resp.Repo.Name)
	assert.Equal(t, filepath.Join(parentDir, "test-clone"), resp.Repo.Path)

	// Verify repo was registered in the store
	repo, err := s.GetRepoByPath(context.Background(), resp.Path)
	require.NoError(t, err)
	assert.NotNil(t, repo)
	assert.Equal(t, resp.Repo.ID, repo.ID)
}

func TestCloneRepo_Handler_InvalidBody(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest(http.MethodPost, "/api/clone", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	h.CloneRepo(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)

	var apiErr APIError
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&apiErr))
	assert.Equal(t, ErrCodeValidation, apiErr.Code)
}

func TestCloneRepo_Handler_MissingURL(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body, _ := json.Marshal(CloneRepoRequest{
		URL:     "",
		Path:    "/some/path",
		DirName: "test",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/clone", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	h.CloneRepo(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)

	var apiErr APIError
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&apiErr))
	assert.Contains(t, apiErr.Error, "url is required")
}

func TestCloneRepo_Handler_MissingPath(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body, _ := json.Marshal(CloneRepoRequest{
		URL:     "https://github.com/user/repo.git",
		Path:    "",
		DirName: "test",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/clone", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	h.CloneRepo(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)

	var apiErr APIError
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&apiErr))
	assert.Contains(t, apiErr.Error, "path is required")
}

func TestCloneRepo_Handler_MissingDirName(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body, _ := json.Marshal(CloneRepoRequest{
		URL:     "https://github.com/user/repo.git",
		Path:    "/some/path",
		DirName: "",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/clone", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	h.CloneRepo(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)

	var apiErr APIError
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&apiErr))
	assert.Contains(t, apiErr.Error, "dirName is required")
}

func TestCloneRepo_Handler_DirAlreadyExists(t *testing.T) {
	h, _ := setupTestHandlers(t)
	bareRepo := createBareTestRepoForClone(t)
	parentDir := t.TempDir()

	// Pre-create the target directory
	require.NoError(t, os.Mkdir(filepath.Join(parentDir, "existing"), 0755))

	body, _ := json.Marshal(CloneRepoRequest{
		URL:     bareRepo,
		Path:    parentDir,
		DirName: "existing",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/clone", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	h.CloneRepo(rr, req)

	assert.Equal(t, http.StatusConflict, rr.Code)

	var apiErr APIError
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&apiErr))
	assert.Equal(t, ErrCodeConflict, apiErr.Code)
}

func TestCloneRepo_Handler_ParentNotExist(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body, _ := json.Marshal(CloneRepoRequest{
		URL:     "https://github.com/user/repo.git",
		Path:    "/nonexistent/parent/directory",
		DirName: "test",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/clone", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	h.CloneRepo(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)

	var apiErr APIError
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&apiErr))
	assert.Contains(t, apiErr.Error, "clone directory does not exist")
}

func TestCloneRepo_Handler_InvalidURL(t *testing.T) {
	h, _ := setupTestHandlers(t)
	parentDir := t.TempDir()

	body, _ := json.Marshal(CloneRepoRequest{
		URL:     "not-a-valid-url",
		Path:    parentDir,
		DirName: "test",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/clone", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	h.CloneRepo(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)

	var apiErr APIError
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&apiErr))
	assert.Contains(t, apiErr.Error, "invalid git URL")
}

func TestCloneRepo_Handler_AutoRegistersWorkspace(t *testing.T) {
	h, s := setupTestHandlers(t)
	bareRepo := createBareTestRepoForClone(t)
	parentDir := t.TempDir()

	body, _ := json.Marshal(CloneRepoRequest{
		URL:     bareRepo,
		Path:    parentDir,
		DirName: "auto-registered",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/clone", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	h.CloneRepo(rr, req)

	require.Equal(t, http.StatusOK, rr.Code)

	// Verify the workspace was stored
	clonedPath := filepath.Join(parentDir, "auto-registered")
	repo, err := s.GetRepoByPath(context.Background(), clonedPath)
	require.NoError(t, err)
	require.NotNil(t, repo)

	assert.Equal(t, "auto-registered", repo.Name)
	assert.Equal(t, clonedPath, repo.Path)
	assert.Equal(t, "main", repo.Branch)
}

func TestCloneRepo_Handler_URLValidation(t *testing.T) {
	h, _ := setupTestHandlers(t)
	parentDir := t.TempDir()

	tests := []struct {
		name       string
		url        string
		expectCode int
		anyError   bool // when true, accept any error status (>= 400) instead of exact match
	}{
		// Valid URLs pass validation but clone fails — the exact HTTP status depends on
		// git's error message (401 for auth failure, 404 for not found, 502 for other).
		{"valid https", "https://github.com/user/repo.git", 0, true},
		{"valid ssh", "git@github.com:user/repo.git", 0, true},
		{"invalid empty", "", http.StatusBadRequest, false},
		{"invalid garbage", "not-a-url", http.StatusBadRequest, false},
		{"invalid ftp", "ftp://example.com/repo", http.StatusBadRequest, false},
		{"invalid local path", "/some/local/path", http.StatusBadRequest, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(CloneRepoRequest{
				URL:     tt.url,
				Path:    parentDir,
				DirName: "url-test-" + tt.name,
			})

			req := httptest.NewRequest(http.MethodPost, "/api/clone", bytes.NewReader(body))
			rr := httptest.NewRecorder()

			h.CloneRepo(rr, req)

			if tt.anyError {
				assert.GreaterOrEqual(t, rr.Code, 400, "url=%s should return an error status", tt.url)
			} else {
				assert.Equal(t, tt.expectCode, rr.Code, "url=%s", tt.url)
			}
		})
	}
}

func TestCloneRepo_Handler_WhitespaceTrimmming(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body, _ := json.Marshal(CloneRepoRequest{
		URL:     "  ",
		Path:    "  ",
		DirName: "  ",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/clone", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	h.CloneRepo(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)

	var apiErr APIError
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&apiErr))
	assert.Contains(t, apiErr.Error, "url is required")
}

func TestCloneRepo_Handler_ContextCancellation(t *testing.T) {
	// Verify the handler doesn't panic or produce unexpected results
	// when the request context is cancelled (simulating client disconnect).
	h, _ := setupTestHandlers(t)
	bareRepo := createBareTestRepoForClone(t)
	parentDir := t.TempDir()

	body, _ := json.Marshal(CloneRepoRequest{
		URL:     bareRepo,
		Path:    parentDir,
		DirName: "cancel-test",
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately to simulate client disconnect

	req := httptest.NewRequest(http.MethodPost, "/api/clone", bytes.NewReader(body))
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()

	// Should not panic
	assert.NotPanics(t, func() {
		h.CloneRepo(rr, req)
	})

	// Note: With file:// URLs, local clones may complete before the cancellation
	// takes effect, so we don't assert on the status code. The important thing is
	// the handler handles cancellation gracefully without panicking.
}

// Verify that the store.GetRepoByPath function exists and works correctly
// by checking the model structure returned after clone
func TestCloneRepo_Handler_RepoModelFields(t *testing.T) {
	h, _ := setupTestHandlers(t)
	bareRepo := createBareTestRepoForClone(t)
	parentDir := t.TempDir()

	body, _ := json.Marshal(CloneRepoRequest{
		URL:     bareRepo,
		Path:    parentDir,
		DirName: "model-test",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/clone", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	h.CloneRepo(rr, req)

	require.Equal(t, http.StatusOK, rr.Code)

	var resp CloneRepoResponse
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))

	// Verify all required fields are populated
	assert.NotEmpty(t, resp.Repo.ID, "repo ID should be set")
	assert.Equal(t, "model-test", resp.Repo.Name, "repo name should match dirName")
	assert.Equal(t, filepath.Join(parentDir, "model-test"), resp.Repo.Path)
	assert.NotZero(t, resp.Repo.CreatedAt, "createdAt should be set")

	// Verify the ID is a valid UUID
	var repo models.Repo
	repo.ID = resp.Repo.ID
	assert.Len(t, repo.ID, 36, "ID should be a UUID")
}
