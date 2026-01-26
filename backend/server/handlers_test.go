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
	"time"

	"github.com/chatml/chatml-backend/git"
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

func TestUpdateSession_Archive(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")

	// Archive the session
	archived := true
	body, _ := json.Marshal(UpdateSessionRequest{Archived: &archived})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify session is archived in response
	var gotSession models.Session
	err := json.Unmarshal(w.Body.Bytes(), &gotSession)
	require.NoError(t, err)
	assert.True(t, gotSession.Archived)

	// Verify persisted in DB
	sess, err := s.GetSession(context.Background(), "sess-1")
	require.NoError(t, err)
	assert.True(t, sess.Archived)
}

func TestUpdateSession_Unarchive(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")

	// First archive the session
	require.NoError(t, s.UpdateSession(context.Background(), "sess-1", func(sess *models.Session) {
		sess.Archived = true
	}))

	// Unarchive the session
	archived := false
	body, _ := json.Marshal(UpdateSessionRequest{Archived: &archived})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify session is unarchived
	var gotSession models.Session
	err := json.Unmarshal(w.Body.Bytes(), &gotSession)
	require.NoError(t, err)
	assert.False(t, gotSession.Archived)
}

func TestUpdateSession_Pin(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")

	// Pin the session
	pinned := true
	body, _ := json.Marshal(UpdateSessionRequest{Pinned: &pinned})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify session is pinned
	var gotSession models.Session
	err := json.Unmarshal(w.Body.Bytes(), &gotSession)
	require.NoError(t, err)
	assert.True(t, gotSession.Pinned)
}

func TestUpdateSession_ArchiveAndPin(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")

	// Set both archived and pinned in one request
	archived := true
	pinned := true
	body, _ := json.Marshal(UpdateSessionRequest{Archived: &archived, Pinned: &pinned})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var gotSession models.Session
	err := json.Unmarshal(w.Body.Bytes(), &gotSession)
	require.NoError(t, err)
	assert.True(t, gotSession.Archived)
	assert.True(t, gotSession.Pinned)
}

func TestListSessions_ExcludesArchivedByDefault(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestSession(t, s, "sess-2", "ws-1")

	// Archive sess-2
	require.NoError(t, s.UpdateSession(context.Background(), "sess-2", func(sess *models.Session) {
		sess.Archived = true
	}))

	// List sessions without includeArchived param
	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.ListSessions(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var sessions []*models.Session
	err := json.Unmarshal(w.Body.Bytes(), &sessions)
	require.NoError(t, err)
	assert.Len(t, sessions, 1)
	assert.Equal(t, "sess-1", sessions[0].ID)
}

func TestListSessions_IncludesArchivedWhenRequested(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestSession(t, s, "sess-2", "ws-1")

	// Archive sess-2
	require.NoError(t, s.UpdateSession(context.Background(), "sess-2", func(sess *models.Session) {
		sess.Archived = true
	}))

	// List sessions with includeArchived=true
	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions?includeArchived=true", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.ListSessions(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var sessions []*models.Session
	err := json.Unmarshal(w.Body.Bytes(), &sessions)
	require.NoError(t, err)
	assert.Len(t, sessions, 2)
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

func TestValidatePath(t *testing.T) {
	basePath := "/home/user/workspace"

	tests := []struct {
		name        string
		path        string
		wantErr     bool
		errContains string
		wantPath    string
	}{
		// Valid paths
		{
			name:     "simple relative path",
			path:     "foo/bar.txt",
			wantErr:  false,
			wantPath: "foo/bar.txt",
		},
		{
			name:     "deeply nested path",
			path:     "src/components/ui/Button.tsx",
			wantErr:  false,
			wantPath: "src/components/ui/Button.tsx",
		},
		{
			name:     "current directory",
			path:     ".",
			wantErr:  false,
			wantPath: ".",
		},
		{
			name:     "explicit current directory prefix",
			path:     "./foo/bar",
			wantErr:  false,
			wantPath: "foo/bar",
		},
		{
			name:     "path with dots in filename",
			path:     "file.test.js",
			wantErr:  false,
			wantPath: "file.test.js",
		},
		{
			name:     "normalized path stays within base",
			path:     "foo/bar/../baz",
			wantErr:  false,
			wantPath: "foo/baz",
		},

		// Directory traversal attacks
		{
			name:        "parent directory escape",
			path:        "../secret",
			wantErr:     true,
			errContains: "path escapes base directory",
		},
		{
			name:        "multi-level traversal",
			path:        "../../etc/passwd",
			wantErr:     true,
			errContains: "path escapes base directory",
		},
		{
			name:        "embedded traversal that escapes",
			path:        "foo/../../../etc/passwd",
			wantErr:     true,
			errContains: "path escapes base directory",
		},
		{
			name:        "deep traversal attack",
			path:        "a/b/c/../../../../etc/passwd",
			wantErr:     true,
			errContains: "path escapes base directory",
		},

		// Absolute path rejection
		{
			name:        "absolute unix path",
			path:        "/etc/passwd",
			wantErr:     true,
			errContains: "absolute paths not allowed",
		},
		{
			name:        "absolute path to sensitive file",
			path:        "/root/.ssh/id_rsa",
			wantErr:     true,
			errContains: "absolute paths not allowed",
		},

		// Edge cases
		{
			name:     "empty path",
			path:     "",
			wantErr:  false,
			wantPath: ".",
		},
		{
			name:     "whitespace only path",
			path:     "   ",
			wantErr:  false,
			wantPath: "   ",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := validatePath(basePath, tt.path)

			if tt.wantErr {
				require.Error(t, err)
				assert.Empty(t, result, "result should be empty on error")
				if tt.errContains != "" {
					assert.Contains(t, err.Error(), tt.errContains)
				}
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.wantPath, result)
			}
		})
	}
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

func TestListSessionFiles_DotfileFiltering(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	_, worktreePath := createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

	// Create legitimate config dotfiles that should be shown
	writeFile(t, worktreePath, ".mcp.json", `{"mcpServers":{}}`)
	writeFile(t, worktreePath, ".gitignore", "node_modules")
	writeFile(t, worktreePath, ".env.example", "KEY=value")
	writeFile(t, worktreePath, ".prettierrc", `{}`)
	writeFile(t, worktreePath, ".babelrc", `{}`)
	writeFile(t, worktreePath, ".eslintrc.json", `{}`)

	// Create OS junk files that should be filtered out
	writeFile(t, worktreePath, ".DS_Store", "junk")
	writeFile(t, worktreePath, ".localized", "junk")
	writeFile(t, worktreePath, "._hidden", "junk")

	// Create normal files
	writeFile(t, worktreePath, "README.md", "readme")
	writeFile(t, worktreePath, "package.json", `{}`)

	req := httptest.NewRequest("GET", "/api/sessions/sess-1/files", nil)
	req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.ListSessionFiles(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	// Convert response to map for easier checking
	fileMap := make(map[string]bool)
	for _, file := range response {
		name, ok := file["name"].(string)
		if ok {
			fileMap[name] = true
		}
	}

	// Verify legitimate config dotfiles are included
	assert.True(t, fileMap[".mcp.json"], ".mcp.json should be included")
	assert.True(t, fileMap[".gitignore"], ".gitignore should be included")
	assert.True(t, fileMap[".env.example"], ".env.example should be included")
	assert.True(t, fileMap[".prettierrc"], ".prettierrc should be included")
	assert.True(t, fileMap[".babelrc"], ".babelrc should be included")
	assert.True(t, fileMap[".eslintrc.json"], ".eslintrc.json should be included")

	// Verify OS junk files are excluded
	assert.False(t, fileMap[".DS_Store"], ".DS_Store should be excluded")
	assert.False(t, fileMap[".localized"], ".localized should be excluded")
	assert.False(t, fileMap["._hidden"], "._hidden should be excluded")

	// Verify normal files are included
	assert.True(t, fileMap["README.md"], "README.md should be included")
	assert.True(t, fileMap["package.json"], "package.json should be included")
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

	// Clean up test session directory after test
	t.Cleanup(func() {
		workspacesDir, _ := git.WorkspacesBaseDir()
		os.RemoveAll(filepath.Join(workspacesDir, "my-session"))
	})

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

// ============================================================================
// SaveFile Handler Tests (Issue #77 - File Size Limits)
// ============================================================================

func TestSaveFile_Success(t *testing.T) {
	h, s := setupTestHandlers(t)

	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Create a test file to save to (SaveFile only allows saving existing files)
	writeFile(t, repoPath, "test.txt", "original content")

	body, _ := json.Marshal(SaveFileRequest{
		Path:    "test.txt",
		Content: "updated content",
	})
	req := httptest.NewRequest("POST", "/api/repos/ws-1/file/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w := httptest.NewRecorder()

	h.SaveFile(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify file was updated
	content, err := os.ReadFile(filepath.Join(repoPath, "test.txt"))
	require.NoError(t, err)
	assert.Equal(t, "updated content", string(content))
}

func TestSaveFile_ExceedsMaxSize(t *testing.T) {
	// Set a small max file size for testing via env var BEFORE creating handlers
	t.Setenv("CHATML_MAX_FILE_SIZE_MB", "1") // 1MB limit

	h, s := setupTestHandlers(t)

	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Create a test file to save to
	writeFile(t, repoPath, "test.txt", "original content")

	// Create content larger than 1MB
	largeContent := strings.Repeat("x", 2*1024*1024) // 2MB

	body, _ := json.Marshal(SaveFileRequest{
		Path:    "test.txt",
		Content: largeContent,
	})
	req := httptest.NewRequest("POST", "/api/repos/ws-1/file/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w := httptest.NewRecorder()

	h.SaveFile(w, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, w.Code)

	var apiErr APIError
	err := json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodePayloadTooLarge, apiErr.Code)
	assert.Contains(t, apiErr.Error, "exceeds maximum size")
}

func TestSaveFile_AtExactLimit(t *testing.T) {
	// Set a small max file size for testing BEFORE creating handlers
	t.Setenv("CHATML_MAX_FILE_SIZE_MB", "1") // 1MB limit

	h, s := setupTestHandlers(t)

	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Create a test file to save to
	writeFile(t, repoPath, "test.txt", "original content")

	// Create content exactly at 1MB (should succeed)
	exactContent := strings.Repeat("x", 1*1024*1024) // exactly 1MB

	body, _ := json.Marshal(SaveFileRequest{
		Path:    "test.txt",
		Content: exactContent,
	})
	req := httptest.NewRequest("POST", "/api/repos/ws-1/file/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w := httptest.NewRecorder()

	h.SaveFile(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestSaveFile_JustOverLimit(t *testing.T) {
	// Set a small max file size for testing BEFORE creating handlers
	t.Setenv("CHATML_MAX_FILE_SIZE_MB", "1") // 1MB limit

	h, s := setupTestHandlers(t)

	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Create a test file to save to
	writeFile(t, repoPath, "test.txt", "original content")

	// Create content just over 1MB (should fail)
	overContent := strings.Repeat("x", 1*1024*1024+1) // 1MB + 1 byte

	body, _ := json.Marshal(SaveFileRequest{
		Path:    "test.txt",
		Content: overContent,
	})
	req := httptest.NewRequest("POST", "/api/repos/ws-1/file/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w := httptest.NewRecorder()

	h.SaveFile(w, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, w.Code)
}

func TestLoadFileSizeConfig_Default(t *testing.T) {
	// Clear environment variable - t.Setenv with empty string then unset
	t.Setenv("CHATML_MAX_FILE_SIZE_MB", "")

	config := LoadFileSizeConfig()

	// Default is 50MB
	assert.Equal(t, int64(50*1024*1024), config.MaxFileSizeBytes)
}

func TestLoadFileSizeConfig_FromEnv(t *testing.T) {
	t.Setenv("CHATML_MAX_FILE_SIZE_MB", "100")

	config := LoadFileSizeConfig()

	// Should be 100MB
	assert.Equal(t, int64(100*1024*1024), config.MaxFileSizeBytes)
}

func TestLoadFileSizeConfig_InvalidEnv(t *testing.T) {
	t.Setenv("CHATML_MAX_FILE_SIZE_MB", "invalid")

	config := LoadFileSizeConfig()

	// Should fall back to default (50MB)
	assert.Equal(t, int64(50*1024*1024), config.MaxFileSizeBytes)
}

func TestLoadFileSizeConfig_ZeroValue(t *testing.T) {
	t.Setenv("CHATML_MAX_FILE_SIZE_MB", "0")

	config := LoadFileSizeConfig()

	// Zero is invalid, should fall back to default (50MB)
	assert.Equal(t, int64(50*1024*1024), config.MaxFileSizeBytes)
}

// ============================================================================
// DirListingCache Tests
// ============================================================================

func TestDirListingCache_GetSet(t *testing.T) {
	cache := NewDirListingCache(1 * time.Second)
	defer cache.Close()

	// Initially should not have the key
	_, ok := cache.Get("test-key")
	assert.False(t, ok)

	// Set a value
	testData := []*FileNode{
		{Name: "file1.txt", Path: "file1.txt", IsDir: false},
		{Name: "dir1", Path: "dir1", IsDir: true},
	}
	cache.Set("test-key", testData)

	// Should now have the key
	result, ok := cache.Get("test-key")
	assert.True(t, ok)
	assert.Equal(t, testData, result)
}

func TestDirListingCache_Expiration(t *testing.T) {
	cache := NewDirListingCache(50 * time.Millisecond)
	defer cache.Close()

	testData := []*FileNode{
		{Name: "file1.txt", Path: "file1.txt", IsDir: false},
	}
	cache.Set("test-key", testData)

	// Should have the key immediately
	_, ok := cache.Get("test-key")
	assert.True(t, ok)

	// Wait for TTL to expire with sufficient margin for CI environments
	time.Sleep(150 * time.Millisecond)

	// Should no longer have the key
	_, ok = cache.Get("test-key")
	assert.False(t, ok)
}

func TestDirListingCache_InvalidatePath(t *testing.T) {
	cache := NewDirListingCache(1 * time.Minute)
	defer cache.Close()

	// Set multiple entries with different paths
	cache.Set("repo:/path/to/repo:depth:1", []*FileNode{{Name: "a.txt"}})
	cache.Set("repo:/path/to/repo:depth:10", []*FileNode{{Name: "b.txt"}})
	cache.Set("session:/path/to/worktree:depth:1", []*FileNode{{Name: "c.txt"}})

	// Verify all entries exist
	_, ok1 := cache.Get("repo:/path/to/repo:depth:1")
	_, ok2 := cache.Get("repo:/path/to/repo:depth:10")
	_, ok3 := cache.Get("session:/path/to/worktree:depth:1")
	assert.True(t, ok1)
	assert.True(t, ok2)
	assert.True(t, ok3)

	// Invalidate entries containing /path/to/repo
	cache.InvalidatePath("/path/to/repo")

	// repo entries should be gone, session entry should remain
	_, ok1 = cache.Get("repo:/path/to/repo:depth:1")
	_, ok2 = cache.Get("repo:/path/to/repo:depth:10")
	_, ok3 = cache.Get("session:/path/to/worktree:depth:1")
	assert.False(t, ok1)
	assert.False(t, ok2)
	assert.True(t, ok3)
}

func TestDirListingCache_Stats(t *testing.T) {
	// Use longer TTL to avoid cleanup goroutine interference
	cache := NewDirListingCache(1 * time.Minute)
	defer cache.Close()

	// Initially empty
	total, expired := cache.Stats()
	assert.Equal(t, 0, total)
	assert.Equal(t, 0, expired)

	// Add entries
	cache.Set("key1", []*FileNode{{Name: "a.txt"}})
	cache.Set("key2", []*FileNode{{Name: "b.txt"}})

	total, expired = cache.Stats()
	assert.Equal(t, 2, total)
	assert.Equal(t, 0, expired)
}

func TestDirListingCache_ConcurrentAccess(t *testing.T) {
	cache := NewDirListingCache(1 * time.Minute)
	defer cache.Close()
	var wg sync.WaitGroup

	// Concurrently read and write
	for i := 0; i < 100; i++ {
		wg.Add(2)
		key := "key-" + string(rune('a'+i%26))

		// Writer
		go func(k string) {
			defer wg.Done()
			cache.Set(k, []*FileNode{{Name: k}})
		}(key)

		// Reader
		go func(k string) {
			defer wg.Done()
			cache.Get(k)
		}(key)
	}

	wg.Wait()

	// Should not panic and should have some entries
	total, _ := cache.Stats()
	assert.Greater(t, total, 0)
}
