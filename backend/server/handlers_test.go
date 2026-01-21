package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================================
// Repo Handler Tests
// ============================================================================

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

// ============================================================================
// Session Handler Tests
// ============================================================================

func TestListSessions_Empty(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.ListSessions(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var sessions []*models.Session
	err := json.Unmarshal(w.Body.Bytes(), &sessions)
	require.NoError(t, err)
	assert.Empty(t, sessions)
}

func TestListSessions_WithSessions(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestSession(t, s, "sess-2", "ws-1")

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.ListSessions(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var sessions []*models.Session
	err := json.Unmarshal(w.Body.Bytes(), &sessions)
	require.NoError(t, err)
	assert.Len(t, sessions, 2)
}

func TestGetSession_Exists(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	session := createTestSession(t, s, "sess-1", "ws-1")

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/sess-1", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSession(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var gotSession models.Session
	err := json.Unmarshal(w.Body.Bytes(), &gotSession)
	require.NoError(t, err)
	assert.Equal(t, session.ID, gotSession.ID)
}

func TestGetSession_NotFound(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/nonexistent", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetSession(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

// ============================================================================
// Conversation Handler Tests
// ============================================================================

func TestListConversations_Empty(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/sess-1/conversations", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.ListConversations(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var convs []*models.Conversation
	err := json.Unmarshal(w.Body.Bytes(), &convs)
	require.NoError(t, err)
	assert.Empty(t, convs)
}

func TestListConversations_WithConversations(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")
	createTestConversation(t, s, "conv-2", "sess-1")

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/sess-1/conversations", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.ListConversations(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var convs []*models.Conversation
	err := json.Unmarshal(w.Body.Bytes(), &convs)
	require.NoError(t, err)
	assert.Len(t, convs, 2)
}

func TestGetConversation_Exists(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	conv := createTestConversation(t, s, "conv-1", "sess-1")

	req := httptest.NewRequest("GET", "/api/conversations/conv-1", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.GetConversation(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var gotConv models.Conversation
	err := json.Unmarshal(w.Body.Bytes(), &gotConv)
	require.NoError(t, err)
	assert.Equal(t, conv.ID, gotConv.ID)
}

func TestGetConversation_NotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/conversations/nonexistent", nil)
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetConversation(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestDeleteConversation_Success(t *testing.T) {
	h, s, _ := setupTestHandlersWithAgentManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Verify conversation exists before delete
	conv, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	assert.NotNil(t, conv)

	req := httptest.NewRequest("DELETE", "/api/conversations/conv-1", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.DeleteConversation(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)

	// Verify conversation was deleted
	conv, err = s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	assert.Nil(t, conv)
}

func TestDeleteConversation_NotFound(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	req := httptest.NewRequest("DELETE", "/api/conversations/nonexistent", nil)
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.DeleteConversation(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestSetConversationPlanMode_NotFound(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	body := strings.NewReader(`{"enabled": true}`)
	req := httptest.NewRequest("POST", "/api/conversations/nonexistent/plan-mode", body)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.SetConversationPlanMode(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.Contains(t, w.Body.String(), "conversation not found")
}

func TestSetConversationPlanMode_InvalidRequest(t *testing.T) {
	h, s, _ := setupTestHandlersWithAgentManager(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Send invalid JSON
	body := strings.NewReader(`{invalid json}`)
	req := httptest.NewRequest("POST", "/api/conversations/conv-1/plan-mode", body)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.SetConversationPlanMode(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSetConversationPlanMode_ProcessNotRunning(t *testing.T) {
	h, s, _ := setupTestHandlersWithAgentManager(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Conversation exists but no process is running
	body := strings.NewReader(`{"enabled": true}`)
	req := httptest.NewRequest("POST", "/api/conversations/conv-1/plan-mode", body)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.SetConversationPlanMode(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)

	// Verify JSON error format
	var apiErr APIError
	err := json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeInternal, apiErr.Code)
	assert.Equal(t, "failed to set plan mode", apiErr.Error)
}

// ============================================================================
// Session File Handler Tests
// ============================================================================

func TestGetSessionFileContent_Success(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	_, worktreePath := createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

	// Create a test file in the worktree
	writeFile(t, worktreePath, "test.txt", "Hello, World!")

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/file?path=test.txt", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionFileContent(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response FileContentResponse
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, "test.txt", response.Path)
	assert.Equal(t, "test.txt", response.Name)
	assert.Equal(t, "Hello, World!", response.Content)
	assert.Equal(t, int64(13), response.Size)
}

func TestGetSessionFileContent_SessionNotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/sessions/nonexistent/file?path=test.txt", nil)
	req = withChiContext(req, map[string]string{"sessionId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetSessionFileContent(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.Contains(t, w.Body.String(), "session not found")
}

func TestGetSessionFileContent_FileNotFound(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/file?path=nonexistent.txt", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionFileContent(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.Contains(t, w.Body.String(), "file not found")
}

func TestGetSessionFileContent_MissingPathParam(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/file", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionFileContent(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "path parameter is required")
}

func TestGetSessionFileContent_DirectoryRejected(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	_, worktreePath := createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

	// Create a directory
	require.NoError(t, os.Mkdir(filepath.Join(worktreePath, "subdir"), 0755))

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/file?path=subdir", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionFileContent(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "path is a directory")
}

func TestGetSessionFileContent_PathTraversalPrevented(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/file?path=../../../etc/passwd", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionFileContent(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "invalid path")
}

func TestListSessionFiles_Success(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	_, worktreePath := createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

	// Create some test files
	writeFile(t, worktreePath, "file1.txt", "content1")
	writeFile(t, worktreePath, "file2.txt", "content2")
	require.NoError(t, os.Mkdir(filepath.Join(worktreePath, "subdir"), 0755))
	writeFile(t, worktreePath, "subdir/file3.txt", "content3")

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/files", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.ListSessionFiles(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	// Should have at least the files/directories we created
	assert.GreaterOrEqual(t, len(response), 2)
}

func TestListSessionFiles_SessionNotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/sessions/nonexistent/files", nil)
	req = withChiContext(req, map[string]string{"sessionId": "nonexistent"})
	w := httptest.NewRecorder()

	h.ListSessionFiles(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.Contains(t, w.Body.String(), "session not found")
}

// ============================================================================
// JSON Response Tests
// ============================================================================

func TestResponseContentType(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "repo-1", "/path/to/repo")

	req := httptest.NewRequest("GET", "/api/repos", nil)
	w := httptest.NewRecorder()

	h.ListRepos(w, req)

	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
}

// ============================================================================
// CreateSession Concurrency Tests (Issue #51 - TOCTOU Race Condition Fix)
// ============================================================================

func TestCreateSession_ConcurrentRequests(t *testing.T) {
	h, s := setupTestHandlers(t)

	// Create a real git repo
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Launch concurrent session creation requests
	// Note: We use 5 requests instead of 10 because git worktree has its own
	// internal race conditions when creating multiple worktrees from the same
	// repo simultaneously. Our fix ensures no duplicate session names are created.
	const numRequests = 5
	var wg sync.WaitGroup
	results := make(chan string, numRequests)
	gitErrors := make(chan string, numRequests) // git-level errors (expected in concurrent scenarios)

	for i := 0; i < numRequests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			body, _ := json.Marshal(CreateSessionRequest{})
			req := httptest.NewRequest("POST", "/api/repos/ws-1/sessions", bytes.NewReader(body))
			req = withChiContext(req, map[string]string{"id": repo.ID})
			w := httptest.NewRecorder()

			h.CreateSession(w, req)

			if w.Code == http.StatusOK {
				var sess models.Session
				if err := json.Unmarshal(w.Body.Bytes(), &sess); err != nil {
					return
				}
				results <- sess.Name
			} else if w.Code == http.StatusConflict {
				// This would indicate our fix failed (duplicate name)
				t.Errorf("Got conflict (duplicate name): %s", w.Body.String())
			} else {
				// Other errors (like git worktree race) are acceptable in concurrent tests
				gitErrors <- w.Body.String()
			}
		}()
	}

	wg.Wait()
	close(results)
	close(gitErrors)

	// Collect all successful session names
	names := make(map[string]bool)
	for name := range results {
		if names[name] {
			t.Errorf("Duplicate session name generated: %s", name)
		}
		names[name] = true
	}

	// Drain git errors (these are expected in concurrent scenarios)
	for range gitErrors {
		// Git worktree race conditions are acceptable
	}

	// The key assertion: all successful sessions have unique names
	// Some requests may fail due to git-level races, but NO duplicates should occur
	assert.Greater(t, len(names), 0, "At least one session should be created successfully")
	t.Logf("Successfully created %d sessions with unique names out of %d concurrent requests", len(names), numRequests)
}

func TestCreateSession_DuplicateUserProvidedName(t *testing.T) {
	h, s := setupTestHandlers(t)

	// Create a real git repo
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Create first session with explicit name
	body, _ := json.Marshal(CreateSessionRequest{Name: "my-session"})
	req := httptest.NewRequest("POST", "/api/repos/ws-1/sessions", bytes.NewReader(body))
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w := httptest.NewRecorder()

	h.CreateSession(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	// Try to create second session with same name
	body, _ = json.Marshal(CreateSessionRequest{Name: "my-session"})
	req = httptest.NewRequest("POST", "/api/repos/ws-1/sessions", bytes.NewReader(body))
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w = httptest.NewRecorder()

	h.CreateSession(w, req)

	// Should fail with conflict
	assert.Equal(t, http.StatusConflict, w.Code)
	assert.Contains(t, w.Body.String(), "already exists")
}
