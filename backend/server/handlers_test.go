package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/ai"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
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

// ============================================================================
// GetAttachmentData Endpoint Tests
// ============================================================================

func TestGetAttachmentData_Success(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Create fixture chain: repo → session → conversation → message → attachment
	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	msg := models.Message{
		ID:        "m1",
		Role:      "user",
		Content:   "See image",
		Timestamp: time.Now(),
	}
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	att := models.Attachment{
		ID:         "att-1",
		Type:       "image",
		Name:       "test.png",
		MimeType:   "image/png",
		Size:       512,
		Base64Data: "dGVzdGRhdGE=",
	}
	require.NoError(t, s.SaveAttachments(ctx, "m1", []models.Attachment{att}))

	// Call handler
	req := httptest.NewRequest(http.MethodGet, "/api/attachments/att-1/data", nil)
	req = withChiContext(req, map[string]string{"attachmentId": "att-1"})
	w := httptest.NewRecorder()

	h.GetAttachmentData(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
	assert.Equal(t, "dGVzdGRhdGE=", response["base64Data"])
}

func TestGetAttachmentData_NotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest(http.MethodGet, "/api/attachments/nonexistent/data", nil)
	req = withChiContext(req, map[string]string{"attachmentId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetAttachmentData(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

// ============================================================================
// ConversationMeta Handler Tests
// ============================================================================

func TestSendConversationMessage_NotFound(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	body := `{"content": "hello"}`
	req := httptest.NewRequest(http.MethodPost, "/api/conversations/nonexistent/messages", strings.NewReader(body))
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.SendConversationMessage(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestRewindConversation_NotFound(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	body := `{"checkpointUuid": "abc123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/conversations/nonexistent/rewind", strings.NewReader(body))
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.RewindConversation(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestStopConversation_ExistingConversation(t *testing.T) {
	h, s, _ := setupTestHandlersWithAgentManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Add a message so the conversation is non-trivial
	msg := models.Message{ID: "m1", Role: "user", Content: "Hello", Timestamp: time.Now()}
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	req := httptest.NewRequest(http.MethodPost, "/api/conversations/conv-1/stop", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.StopConversation(w, req)

	// Should succeed (no running process, but that's OK — StopConversation is idempotent)
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestDeleteConversation_ExistingConversation(t *testing.T) {
	h, s, _ := setupTestHandlersWithAgentManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	req := httptest.NewRequest(http.MethodDelete, "/api/conversations/conv-1", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.DeleteConversation(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)

	// Verify conversation is deleted
	conv, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	assert.Nil(t, conv)
}

// ============================================================================
// BranchCache Tests
// ============================================================================

func TestBranchCache_GetSet(t *testing.T) {
	cache := NewBranchCache(5 * time.Minute)
	defer cache.Close()

	data := &git.BranchListResult{
		Branches: []git.BranchInfo{
			{Name: "main", IsHead: true},
			{Name: "feature-1"},
		},
	}
	cache.Set("/repo:local:false:", data)

	result, ok := cache.Get("/repo:local:false:")
	require.True(t, ok)
	require.Len(t, result.Branches, 2)
	require.Equal(t, "main", result.Branches[0].Name)
}

func TestBranchCache_GetNotFound(t *testing.T) {
	cache := NewBranchCache(5 * time.Minute)
	defer cache.Close()

	result, ok := cache.Get("nonexistent")
	require.False(t, ok)
	require.Nil(t, result)
}

func TestBranchCache_Expiration(t *testing.T) {
	cache := NewBranchCache(50 * time.Millisecond)
	defer cache.Close()

	data := &git.BranchListResult{
		Branches: []git.BranchInfo{{Name: "main"}},
	}
	cache.Set("key", data)

	// Should be available immediately
	result, ok := cache.Get("key")
	require.True(t, ok)
	require.Len(t, result.Branches, 1)

	// Wait for expiration
	time.Sleep(70 * time.Millisecond)

	result, ok = cache.Get("key")
	require.False(t, ok)
	require.Nil(t, result)
}

func TestBranchCache_Invalidate(t *testing.T) {
	cache := NewBranchCache(5 * time.Minute)
	defer cache.Close()

	data := &git.BranchListResult{
		Branches: []git.BranchInfo{{Name: "main"}},
	}
	cache.Set("key1", data)

	_, ok := cache.Get("key1")
	require.True(t, ok)

	cache.Invalidate("key1")

	_, ok = cache.Get("key1")
	require.False(t, ok)
}

func TestBranchCache_InvalidateRepo(t *testing.T) {
	cache := NewBranchCache(5 * time.Minute)
	defer cache.Close()

	data := &git.BranchListResult{
		Branches: []git.BranchInfo{{Name: "main"}},
	}

	// Set entries for two different repos
	cache.Set("/path/to/repo:local:false:", data)
	cache.Set("/path/to/repo:remote:true:", data)
	cache.Set("/other/repo:local:false:", data)

	// Invalidate only /path/to/repo
	cache.InvalidateRepo("/path/to/repo")

	// Repo entries should be gone
	_, ok := cache.Get("/path/to/repo:local:false:")
	require.False(t, ok)
	_, ok = cache.Get("/path/to/repo:remote:true:")
	require.False(t, ok)

	// Other repo should still exist
	_, ok = cache.Get("/other/repo:local:false:")
	require.True(t, ok)
}

func TestBranchCache_Close(t *testing.T) {
	cache := NewBranchCache(5 * time.Minute)

	// Close should not panic
	cache.Close()

	// Double close should not panic
	cache.Close()

	// Cache is still usable after close (just no background cleanup)
	data := &git.BranchListResult{
		Branches: []git.BranchInfo{{Name: "main"}},
	}
	cache.Set("key", data)
	result, ok := cache.Get("key")
	require.True(t, ok)
	require.Equal(t, "main", result.Branches[0].Name)
}

func TestBranchCache_ConcurrentAccess(t *testing.T) {
	cache := NewBranchCache(5 * time.Minute)
	defer cache.Close()

	var wg sync.WaitGroup
	const n = 100

	for i := 0; i < n; i++ {
		wg.Add(2)
		key := "key-" + string(rune('a'+i%26))

		go func(k string) {
			defer wg.Done()
			cache.Set(k, &git.BranchListResult{
				Branches: []git.BranchInfo{{Name: k}},
			})
		}(key)

		go func(k string) {
			defer wg.Done()
			cache.Get(k)
		}(key)
	}

	wg.Wait()
	// Should not panic
}

// ============================================================================
// GetSessionBranchCommits Handler Tests
// ============================================================================

// getCommitSHA returns the current HEAD commit SHA
func getCommitSHA(t *testing.T, dir string) string {
	t.Helper()
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = dir
	out, err := cmd.Output()
	require.NoError(t, err)
	return strings.TrimSpace(string(out))
}

// createAndCommitFile creates a file and commits it
func createAndCommitFile(t *testing.T, dir, name, content, message string) {
	t.Helper()
	writeFile(t, dir, name, content)
	runGit(t, dir, "add", name)
	runGit(t, dir, "commit", "-m", message)
}

// createSessionWithGitWorktree creates a workspace + session backed by a real git repo
func createSessionWithGitWorktree(t *testing.T, h *Handlers, s *store.SQLiteStore, workspaceID, sessionID string) (string, string) {
	t.Helper()
	ctx := context.Background()

	repoPath := createTestGitRepo(t)
	baseSHA := getCommitSHA(t, repoPath)

	repo := &models.Repo{
		ID:        workspaceID,
		Name:      "test-repo",
		Path:      repoPath,
		Branch:    "main",
		CreatedAt: time.Now(),
	}
	require.NoError(t, s.AddRepo(ctx, repo))

	session := &models.Session{
		ID:            sessionID,
		WorkspaceID:   workspaceID,
		Name:          "Test Session",
		Status:        "idle",
		WorktreePath:  repoPath,
		BaseCommitSHA: baseSHA,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))

	return repoPath, baseSHA
}

func TestGetSessionBranchCommits_NoCommitsAhead(t *testing.T) {
	h, s := setupTestHandlers(t)
	createSessionWithGitWorktree(t, h, s, "ws-1", "sess-1")

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/sess-1/branch-commits", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionBranchCommits(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var commits []git.BranchCommit
	err := json.Unmarshal(w.Body.Bytes(), &commits)
	require.NoError(t, err)
	assert.Empty(t, commits)
}

func TestGetSessionBranchCommits_WithCommits(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath, _ := createSessionWithGitWorktree(t, h, s, "ws-1", "sess-1")

	// Add commits after the base
	createAndCommitFile(t, repoPath, "feature.go", "package main\n", "Add feature")
	createAndCommitFile(t, repoPath, "test.go", "package main\n", "Add tests")

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/sess-1/branch-commits", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionBranchCommits(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var commits []git.BranchCommit
	err := json.Unmarshal(w.Body.Bytes(), &commits)
	require.NoError(t, err)
	require.Len(t, commits, 2)

	// Newest first
	assert.Equal(t, "Add tests", commits[0].Message)
	assert.Equal(t, "Add feature", commits[1].Message)

	// Each commit should have files
	require.Len(t, commits[0].Files, 1)
	assert.Equal(t, "test.go", commits[0].Files[0].Path)
	require.Len(t, commits[1].Files, 1)
	assert.Equal(t, "feature.go", commits[1].Files[0].Path)
}

func TestGetSessionBranchCommits_SessionNotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/nonexistent/branch-commits", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetSessionBranchCommits(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestGetSessionBranchCommits_ReturnsEmptyArrayOnError(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Create a workspace and session with an invalid worktree path
	repo := &models.Repo{
		ID:        "ws-bad",
		Name:      "bad-repo",
		Path:      "/nonexistent/path",
		Branch:    "main",
		CreatedAt: time.Now(),
	}
	require.NoError(t, s.AddRepo(ctx, repo))

	session := &models.Session{
		ID:            "sess-bad",
		WorkspaceID:   "ws-bad",
		Name:          "Bad Session",
		Status:        "idle",
		WorktreePath:  "/nonexistent/worktree",
		BaseCommitSHA: "abc123",
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))

	req := httptest.NewRequest("GET", "/api/repos/ws-bad/sessions/sess-bad/branch-commits", nil)
	req = withChiContext(req, map[string]string{"id": "ws-bad", "sessionId": "sess-bad"})
	w := httptest.NewRecorder()

	h.GetSessionBranchCommits(w, req)

	// Should still return 200 with empty array (graceful degradation)
	assert.Equal(t, http.StatusOK, w.Code)

	var commits []git.BranchCommit
	err := json.Unmarshal(w.Body.Bytes(), &commits)
	require.NoError(t, err)
	assert.Empty(t, commits)
}

func TestGetSessionBranchCommits_CommitFilesHaveStats(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath, _ := createSessionWithGitWorktree(t, h, s, "ws-1", "sess-1")

	// Create a file with known content
	writeFile(t, repoPath, "stats.txt", "line 1\nline 2\nline 3\n")
	runGit(t, repoPath, "add", "stats.txt")
	runGit(t, repoPath, "commit", "-m", "Add file with 3 lines")

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/sess-1/branch-commits", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionBranchCommits(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var commits []git.BranchCommit
	err := json.Unmarshal(w.Body.Bytes(), &commits)
	require.NoError(t, err)
	require.Len(t, commits, 1)
	require.Len(t, commits[0].Files, 1)

	assert.Equal(t, "stats.txt", commits[0].Files[0].Path)
	assert.Equal(t, 3, commits[0].Files[0].Additions)
	assert.Equal(t, 0, commits[0].Files[0].Deletions)
}

// ============================================================================
// Settings Endpoint Tests (Workspaces Base Dir)
// ============================================================================

func TestGetWorkspacesBaseDir_Default(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/settings/workspaces-base-dir", nil)
	w := httptest.NewRecorder()

	h.GetWorkspacesBaseDir(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.NotEmpty(t, response["path"], "default path should be non-empty")
	assert.Contains(t, response["path"], "workspaces", "default path should contain 'workspaces'")
}

func TestGetWorkspacesBaseDir_CustomPath(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Pre-configure a custom path
	require.NoError(t, s.SetSetting(ctx, "workspaces-base-dir", "/custom/workspaces"))

	req := httptest.NewRequest("GET", "/api/settings/workspaces-base-dir", nil)
	w := httptest.NewRecorder()

	h.GetWorkspacesBaseDir(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, "/custom/workspaces", response["path"])
}

func TestSetWorkspacesBaseDir_ValidPath(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Use a real temp directory
	validDir := t.TempDir()

	body, _ := json.Marshal(map[string]string{"path": validDir})
	req := httptest.NewRequest("PUT", "/api/settings/workspaces-base-dir", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetWorkspacesBaseDir(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, validDir, response["path"])

	// Verify persisted in store
	val, found, err := s.GetSetting(ctx, "workspaces-base-dir")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, validDir, val)
}

func TestSetWorkspacesBaseDir_ResetToDefault(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// First set a custom path
	require.NoError(t, s.SetSetting(ctx, "workspaces-base-dir", "/custom/path"))

	// Reset by sending empty path
	body, _ := json.Marshal(map[string]string{"path": ""})
	req := httptest.NewRequest("PUT", "/api/settings/workspaces-base-dir", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetWorkspacesBaseDir(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	// Should return default path (contains "workspaces")
	assert.Contains(t, response["path"], "workspaces")

	// Verify setting was deleted from store
	_, found, err := s.GetSetting(ctx, "workspaces-base-dir")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestSetWorkspacesBaseDir_InvalidJSON(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("PUT", "/api/settings/workspaces-base-dir", bytes.NewReader([]byte("invalid json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetWorkspacesBaseDir(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSetWorkspacesBaseDir_PathNotExists(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body, _ := json.Marshal(map[string]string{"path": "/nonexistent/absolutely/fake"})
	req := httptest.NewRequest("PUT", "/api/settings/workspaces-base-dir", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetWorkspacesBaseDir(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "path does not exist")
}

func TestSetWorkspacesBaseDir_PathIsFile(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// Create a temp file (not a directory)
	tmpFile := filepath.Join(t.TempDir(), "not-a-dir.txt")
	require.NoError(t, os.WriteFile(tmpFile, []byte("hello"), 0644))

	body, _ := json.Marshal(map[string]string{"path": tmpFile})
	req := httptest.NewRequest("PUT", "/api/settings/workspaces-base-dir", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetWorkspacesBaseDir(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "path is not a directory")
}

// ============================================================================
// CreateConversation Plan Mode Tests
// ============================================================================

func TestCreateConversation_InvalidJSON(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "ws-1", repoPath)
	createTestSession(t, s, "sess-1", "ws-1")

	req := httptest.NewRequest("POST", "/api/repos/ws-1/sessions/sess-1/conversations", strings.NewReader(`{bad json`))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"workspaceId": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.CreateConversation(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateConversation_SessionNotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body := strings.NewReader(`{"type": "task", "message": "hello"}`)
	req := httptest.NewRequest("POST", "/api/repos/ws-1/sessions/nonexistent/conversations", body)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"workspaceId": "ws-1", "sessionId": "nonexistent"})
	w := httptest.NewRecorder()

	h.CreateConversation(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestCreateConversation_RequestParsing_WithPlanMode(t *testing.T) {
	// Verify that CreateConversationRequest correctly deserializes planMode
	tests := []struct {
		name     string
		body     string
		expected bool
	}{
		{
			name:     "planMode true",
			body:     `{"type": "task", "message": "hello", "planMode": true}`,
			expected: true,
		},
		{
			name:     "planMode false",
			body:     `{"type": "task", "message": "hello", "planMode": false}`,
			expected: false,
		},
		{
			name:     "planMode omitted defaults to false",
			body:     `{"type": "task", "message": "hello"}`,
			expected: false,
		},
		{
			name:     "planMode with thinking tokens",
			body:     `{"type": "task", "message": "hello", "planMode": true, "maxThinkingTokens": 5000}`,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var req CreateConversationRequest
			err := json.Unmarshal([]byte(tt.body), &req)
			require.NoError(t, err)
			assert.Equal(t, tt.expected, req.PlanMode)
		})
	}
}

// ============================================================================
// ApprovePlan Handler Tests
// ============================================================================

func TestApprovePlan_NotFound(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	req := httptest.NewRequest("POST", "/api/conversations/nonexistent/approve-plan", nil)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.ApprovePlan(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.Contains(t, w.Body.String(), "conversation not found")
}

func TestApprovePlan_NotInPlanMode(t *testing.T) {
	h, s, _ := setupTestHandlersWithAgentManager(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	req := httptest.NewRequest("POST", "/api/conversations/conv-1/approve-plan", nil)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.ApprovePlan(w, req)

	// Should fail because no process is running (not in plan mode)
	assert.Equal(t, http.StatusConflict, w.Code)
	assert.Contains(t, w.Body.String(), "conversation is not in plan mode")
}

// ============================================================================
// PR Template Handler Tests
// ============================================================================

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

// ============================================================================
// Review Prompts Settings Tests
// ============================================================================

func TestGetReviewPrompts_Empty(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/settings/review-prompts", nil)
	w := httptest.NewRecorder()

	h.GetReviewPrompts(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, map[string]any{}, resp["prompts"].(map[string]any))
}

func TestSetReviewPrompts_Success(t *testing.T) {
	h, _ := setupTestHandlers(t)

	prompts := map[string]any{"prompts": map[string]string{"quick": "Also check accessibility"}}
	body, _ := json.Marshal(prompts)
	req := httptest.NewRequest("PUT", "/api/settings/review-prompts", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetReviewPrompts(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Verify it was saved
	req2 := httptest.NewRequest("GET", "/api/settings/review-prompts", nil)
	w2 := httptest.NewRecorder()

	h.GetReviewPrompts(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	p := resp["prompts"].(map[string]any)
	assert.Equal(t, "Also check accessibility", p["quick"])
}

func TestSetReviewPrompts_EmptyDeletes(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	require.NoError(t, s.SetSetting(ctx, "review-prompts", `{"quick":"old"}`))

	body, _ := json.Marshal(map[string]any{"prompts": map[string]string{}})
	req := httptest.NewRequest("PUT", "/api/settings/review-prompts", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetReviewPrompts(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Verify deleted
	req2 := httptest.NewRequest("GET", "/api/settings/review-prompts", nil)
	w2 := httptest.NewRecorder()
	h.GetReviewPrompts(w2, req2)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	assert.Equal(t, map[string]any{}, resp["prompts"].(map[string]any))
}

func TestSetReviewPrompts_InvalidBody(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("PUT", "/api/settings/review-prompts", bytes.NewReader([]byte("invalid")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetReviewPrompts(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetWorkspaceReviewPrompts_Empty(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/repos/ws-1/settings/review-prompts", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetWorkspaceReviewPrompts(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, map[string]any{}, resp["prompts"].(map[string]any))
}

func TestSetWorkspaceReviewPrompts_Success(t *testing.T) {
	h, _ := setupTestHandlers(t)

	prompts := map[string]any{"prompts": map[string]string{"security": "Check OWASP top 10"}}
	body, _ := json.Marshal(prompts)
	req := httptest.NewRequest("PUT", "/api/repos/ws-1/settings/review-prompts", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetWorkspaceReviewPrompts(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Verify saved
	req2 := httptest.NewRequest("GET", "/api/repos/ws-1/settings/review-prompts", nil)
	req2 = withChiContext(req2, map[string]string{"id": "ws-1"})
	w2 := httptest.NewRecorder()

	h.GetWorkspaceReviewPrompts(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	p := resp["prompts"].(map[string]any)
	assert.Equal(t, "Check OWASP top 10", p["security"])
}

func TestSetWorkspaceReviewPrompts_IsolatedPerWorkspace(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// Set for ws-1
	body1, _ := json.Marshal(map[string]any{"prompts": map[string]string{"quick": "ws1 instructions"}})
	req1 := httptest.NewRequest("PUT", "/api/repos/ws-1/settings/review-prompts", bytes.NewReader(body1))
	req1.Header.Set("Content-Type", "application/json")
	req1 = withChiContext(req1, map[string]string{"id": "ws-1"})
	w1 := httptest.NewRecorder()
	h.SetWorkspaceReviewPrompts(w1, req1)
	assert.Equal(t, http.StatusOK, w1.Code)

	// ws-2 should still be empty
	req2 := httptest.NewRequest("GET", "/api/repos/ws-2/settings/review-prompts", nil)
	req2 = withChiContext(req2, map[string]string{"id": "ws-2"})
	w2 := httptest.NewRecorder()
	h.GetWorkspaceReviewPrompts(w2, req2)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	assert.Equal(t, map[string]any{}, resp["prompts"].(map[string]any))
}

func TestReviewPrompts_GlobalAndWorkspaceIsolated(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// Set a global prompt
	globalBody, _ := json.Marshal(map[string]any{"prompts": map[string]string{"quick": "global instructions"}})
	req1 := httptest.NewRequest("PUT", "/api/settings/review-prompts", bytes.NewReader(globalBody))
	req1.Header.Set("Content-Type", "application/json")
	w1 := httptest.NewRecorder()
	h.SetReviewPrompts(w1, req1)
	assert.Equal(t, http.StatusOK, w1.Code)

	// Workspace endpoint should still be empty
	req2 := httptest.NewRequest("GET", "/api/repos/ws-1/settings/review-prompts", nil)
	req2 = withChiContext(req2, map[string]string{"id": "ws-1"})
	w2 := httptest.NewRecorder()
	h.GetWorkspaceReviewPrompts(w2, req2)

	var wsResp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &wsResp))
	assert.Equal(t, map[string]any{}, wsResp["prompts"].(map[string]any))

	// Set a workspace prompt
	wsBody, _ := json.Marshal(map[string]any{"prompts": map[string]string{"security": "workspace instructions"}})
	req3 := httptest.NewRequest("PUT", "/api/repos/ws-1/settings/review-prompts", bytes.NewReader(wsBody))
	req3.Header.Set("Content-Type", "application/json")
	req3 = withChiContext(req3, map[string]string{"id": "ws-1"})
	w3 := httptest.NewRecorder()
	h.SetWorkspaceReviewPrompts(w3, req3)
	assert.Equal(t, http.StatusOK, w3.Code)

	// Global should still only have "quick", not "security"
	req4 := httptest.NewRequest("GET", "/api/settings/review-prompts", nil)
	w4 := httptest.NewRecorder()
	h.GetReviewPrompts(w4, req4)

	var globalResp map[string]any
	require.NoError(t, json.Unmarshal(w4.Body.Bytes(), &globalResp))
	gp := globalResp["prompts"].(map[string]any)
	assert.Equal(t, "global instructions", gp["quick"])
	assert.Nil(t, gp["security"])
}

func TestGetReviewPrompts_CorruptedData(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Store invalid JSON
	require.NoError(t, s.SetSetting(ctx, "review-prompts", "not-json"))

	req := httptest.NewRequest("GET", "/api/settings/review-prompts", nil)
	w := httptest.NewRecorder()
	h.GetReviewPrompts(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGeneratePRDescription_NoAIClient(t *testing.T) {
	h, _ := setupTestHandlers(t) // handlers created with nil aiClient

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/sess-1/pr/generate", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GeneratePRDescription(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, w.Body.String(), "not available")
}

// ============================================================================
// Drop Stats Handler Tests
// ============================================================================

func TestGetConversationDropStats_NoActiveProcess(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	req := httptest.NewRequest("GET", "/api/conversations/conv-nonexistent/drop-stats", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-nonexistent"})
	w := httptest.NewRecorder()

	h.GetConversationDropStats(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var stats map[string]uint64
	err := json.Unmarshal(w.Body.Bytes(), &stats)
	require.NoError(t, err)
	assert.Equal(t, uint64(0), stats["droppedMessages"])
}

func TestGetConversationDropStats_WithActiveProcess(t *testing.T) {
	h, _, agentMgr := setupTestHandlersWithAgentManager(t)

	// Manually insert a process with some drops
	proc := agent.NewProcess("drop-proc", t.TempDir(), "conv-stats")
	agentMgr.InsertProcessForTest("conv-stats", proc)

	req := httptest.NewRequest("GET", "/api/conversations/conv-stats/drop-stats", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-stats"})
	w := httptest.NewRecorder()

	h.GetConversationDropStats(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var stats map[string]uint64
	err := json.Unmarshal(w.Body.Bytes(), &stats)
	require.NoError(t, err)
	assert.Equal(t, uint64(0), stats["droppedMessages"])
}

func TestGetConversationDropStats_ReflectsDropCount(t *testing.T) {
	h, _, agentMgr := setupTestHandlersWithAgentManager(t)

	// Create process and simulate drops
	proc := agent.NewProcess("drop-proc", t.TempDir(), "conv-stats")
	proc.SimulateDrops(17)
	agentMgr.InsertProcessForTest("conv-stats", proc)

	req := httptest.NewRequest("GET", "/api/conversations/conv-stats/drop-stats", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-stats"})
	w := httptest.NewRecorder()

	h.GetConversationDropStats(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var stats map[string]uint64
	err := json.Unmarshal(w.Body.Bytes(), &stats)
	require.NoError(t, err)
	assert.Equal(t, uint64(17), stats["droppedMessages"])
}

func TestGetConversationDropStats_ResponseFormat(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	req := httptest.NewRequest("GET", "/api/conversations/conv-format/drop-stats", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-format"})
	w := httptest.NewRecorder()

	h.GetConversationDropStats(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Header().Get("Content-Type"), "application/json")

	// Verify response is valid JSON with expected key
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	_, hasDropped := result["droppedMessages"]
	assert.True(t, hasDropped, "Response should contain droppedMessages key")
}

// ============================================================================
// Summary handler tests
// ============================================================================

func TestGetConversationSummary_Found(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	repo := createTestRepo(t, s, "r1", "/fake/path")
	sess := createTestSession(t, s, "s1", repo.ID)
	conv := createTestConversation(t, s, "c1", sess.ID)

	err := s.AddSummary(ctx, &models.Summary{
		ID:             "sum1",
		ConversationID: conv.ID,
		SessionID:      sess.ID,
		Content:        "This conversation was about testing.",
		Status:         models.SummaryStatusCompleted,
		MessageCount:   5,
		CreatedAt:      time.Now(),
	})
	require.NoError(t, err)

	req := httptest.NewRequest("GET", "/api/conversations/c1/summary", nil)
	req = withChiContext(req, map[string]string{"convId": conv.ID})
	w := httptest.NewRecorder()

	h.GetConversationSummary(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var summary models.Summary
	err = json.Unmarshal(w.Body.Bytes(), &summary)
	require.NoError(t, err)
	assert.Equal(t, "sum1", summary.ID)
	assert.Equal(t, conv.ID, summary.ConversationID)
	assert.Equal(t, "This conversation was about testing.", summary.Content)
	assert.Equal(t, models.SummaryStatusCompleted, summary.Status)
	assert.Equal(t, 5, summary.MessageCount)
}

func TestGetConversationSummary_NotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/conversations/nonexistent/summary", nil)
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetConversationSummary(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)

	var apiErr APIError
	err := json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeNotFound, apiErr.Code)
}

func TestListSessionSummaries_ReturnsSummaries(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	repo := createTestRepo(t, s, "r1", "/fake/path")
	sess := createTestSession(t, s, "s1", repo.ID)
	conv1 := createTestConversation(t, s, "c1", sess.ID)
	conv2 := createTestConversation(t, s, "c2", sess.ID)

	err := s.AddSummary(ctx, &models.Summary{
		ID:             "sum1",
		ConversationID: conv1.ID,
		SessionID:      sess.ID,
		Content:        "Summary one",
		Status:         models.SummaryStatusCompleted,
		MessageCount:   3,
		CreatedAt:      time.Now(),
	})
	require.NoError(t, err)

	err = s.AddSummary(ctx, &models.Summary{
		ID:             "sum2",
		ConversationID: conv2.ID,
		SessionID:      sess.ID,
		Content:        "Summary two",
		Status:         models.SummaryStatusCompleted,
		MessageCount:   4,
		CreatedAt:      time.Now(),
	})
	require.NoError(t, err)

	req := httptest.NewRequest("GET", "/api/repos/r1/sessions/s1/summaries", nil)
	req = withChiContext(req, map[string]string{"sessionId": sess.ID})
	w := httptest.NewRecorder()

	h.ListSessionSummaries(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var summaries []*models.Summary
	err = json.Unmarshal(w.Body.Bytes(), &summaries)
	require.NoError(t, err)
	assert.Len(t, summaries, 2)
}

func TestListSessionSummaries_Empty(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/repos/r1/sessions/no-session/summaries", nil)
	req = withChiContext(req, map[string]string{"sessionId": "no-session"})
	w := httptest.NewRecorder()

	h.ListSessionSummaries(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Should return empty array, not null
	var summaries []*models.Summary
	err := json.Unmarshal(w.Body.Bytes(), &summaries)
	require.NoError(t, err)
	assert.NotNil(t, summaries)
	assert.Len(t, summaries, 0)
	assert.Equal(t, "[]", strings.TrimSpace(w.Body.String()))
}

func TestListSessionSummaries_OnlyCompleted(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	repo := createTestRepo(t, s, "r1", "/fake/path")
	sess := createTestSession(t, s, "s1", repo.ID)
	conv1 := createTestConversation(t, s, "c1", sess.ID)
	conv2 := createTestConversation(t, s, "c2", sess.ID)

	// Add a completed summary
	err := s.AddSummary(ctx, &models.Summary{
		ID:             "sum-completed",
		ConversationID: conv1.ID,
		SessionID:      sess.ID,
		Content:        "Done summary",
		Status:         models.SummaryStatusCompleted,
		MessageCount:   3,
		CreatedAt:      time.Now(),
	})
	require.NoError(t, err)

	// Add a generating summary - should be excluded
	err = s.AddSummary(ctx, &models.Summary{
		ID:             "sum-generating",
		ConversationID: conv2.ID,
		SessionID:      sess.ID,
		Content:        "",
		Status:         models.SummaryStatusGenerating,
		MessageCount:   2,
		CreatedAt:      time.Now(),
	})
	require.NoError(t, err)

	req := httptest.NewRequest("GET", "/api/repos/r1/sessions/s1/summaries", nil)
	req = withChiContext(req, map[string]string{"sessionId": sess.ID})
	w := httptest.NewRecorder()

	h.ListSessionSummaries(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var summaries []*models.Summary
	err = json.Unmarshal(w.Body.Bytes(), &summaries)
	require.NoError(t, err)
	assert.Len(t, summaries, 1)
	assert.Equal(t, "sum-completed", summaries[0].ID)
}

func TestGenerateConversationSummary_ConversationNotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("POST", "/api/conversations/nonexistent/summary", nil)
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GenerateConversationSummary(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)

	var apiErr APIError
	err := json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeNotFound, apiErr.Code)
}

func TestGenerateConversationSummary_NoAIClient(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	repo := createTestRepo(t, s, "r1", "/fake/path")
	sess := createTestSession(t, s, "s1", repo.ID)
	conv := createTestConversation(t, s, "c1", sess.ID)

	// Add enough messages
	err := s.AddMessageToConversation(ctx, conv.ID, models.Message{ID: "m1", Role: "user", Content: "Hello", Timestamp: time.Now()})
	require.NoError(t, err)
	err = s.AddMessageToConversation(ctx, conv.ID, models.Message{ID: "m2", Role: "assistant", Content: "Hi there", Timestamp: time.Now()})
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/conversations/c1/summary", nil)
	req = withChiContext(req, map[string]string{"convId": conv.ID})
	w := httptest.NewRecorder()

	h.GenerateConversationSummary(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)

	var apiErr APIError
	err = json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeServiceUnavailable, apiErr.Code)
}

func TestGenerateConversationSummary_TooFewMessages(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Set a non-nil aiClient so we get past the nil check
	h.aiClient = ai.NewClient("fake-test-key")

	repo := createTestRepo(t, s, "r1", "/fake/path")
	sess := createTestSession(t, s, "s1", repo.ID)
	conv := createTestConversation(t, s, "c1", sess.ID)

	// Add only 1 message (need at least 2 user/assistant messages)
	err := s.AddMessageToConversation(ctx, conv.ID, models.Message{ID: "m1", Role: "user", Content: "Hello", Timestamp: time.Now()})
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/conversations/c1/summary", nil)
	req = withChiContext(req, map[string]string{"convId": conv.ID})
	w := httptest.NewRecorder()

	h.GenerateConversationSummary(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var apiErr APIError
	err = json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeValidation, apiErr.Code)
	assert.Contains(t, apiErr.Error, "at least 2 messages")
}

func TestGenerateConversationSummary_AlreadyGenerating(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Set a non-nil aiClient so we get past the nil check
	h.aiClient = ai.NewClient("fake-test-key")

	repo := createTestRepo(t, s, "r1", "/fake/path")
	sess := createTestSession(t, s, "s1", repo.ID)
	conv := createTestConversation(t, s, "c1", sess.ID)

	// Add enough messages
	err := s.AddMessageToConversation(ctx, conv.ID, models.Message{ID: "m1", Role: "user", Content: "Hello", Timestamp: time.Now()})
	require.NoError(t, err)
	err = s.AddMessageToConversation(ctx, conv.ID, models.Message{ID: "m2", Role: "assistant", Content: "Hi there", Timestamp: time.Now()})
	require.NoError(t, err)

	// Add a generating summary
	err = s.AddSummary(ctx, &models.Summary{
		ID:             "sum-gen",
		ConversationID: conv.ID,
		SessionID:      sess.ID,
		Status:         models.SummaryStatusGenerating,
		MessageCount:   2,
		CreatedAt:      time.Now(),
	})
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/conversations/c1/summary", nil)
	req = withChiContext(req, map[string]string{"convId": conv.ID})
	w := httptest.NewRecorder()

	h.GenerateConversationSummary(w, req)

	assert.Equal(t, http.StatusConflict, w.Code)

	var apiErr APIError
	err = json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeConflict, apiErr.Code)
	assert.Contains(t, apiErr.Error, "already being generated")
}

func TestGenerateConversationSummary_AlreadyCompleted(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Set a non-nil aiClient so we get past the nil check
	h.aiClient = ai.NewClient("fake-test-key")

	repo := createTestRepo(t, s, "r1", "/fake/path")
	sess := createTestSession(t, s, "s1", repo.ID)
	conv := createTestConversation(t, s, "c1", sess.ID)

	// Add enough messages
	err := s.AddMessageToConversation(ctx, conv.ID, models.Message{ID: "m1", Role: "user", Content: "Hello", Timestamp: time.Now()})
	require.NoError(t, err)
	err = s.AddMessageToConversation(ctx, conv.ID, models.Message{ID: "m2", Role: "assistant", Content: "Hi there", Timestamp: time.Now()})
	require.NoError(t, err)

	// Add a completed summary
	err = s.AddSummary(ctx, &models.Summary{
		ID:             "sum-done",
		ConversationID: conv.ID,
		SessionID:      sess.ID,
		Content:        "Already summarized",
		Status:         models.SummaryStatusCompleted,
		MessageCount:   2,
		CreatedAt:      time.Now(),
	})
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/conversations/c1/summary", nil)
	req = withChiContext(req, map[string]string{"convId": conv.ID})
	w := httptest.NewRecorder()

	h.GenerateConversationSummary(w, req)

	// Should return 200 with existing summary, not start a new generation
	assert.Equal(t, http.StatusOK, w.Code)

	var summary models.Summary
	err = json.Unmarshal(w.Body.Bytes(), &summary)
	require.NoError(t, err)
	assert.Equal(t, "sum-done", summary.ID)
	assert.Equal(t, "Already summarized", summary.Content)
	assert.Equal(t, models.SummaryStatusCompleted, summary.Status)
}

// ============================================================================
// GetConversationMessages Handler Tests (Pagination)
// ============================================================================

// addTestMessages adds N messages to a conversation via the store
func addTestMessages(t *testing.T, s *store.SQLiteStore, convID string, n int) {
	t.Helper()
	ctx := context.Background()
	for i := 0; i < n; i++ {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		msg := models.Message{
			ID:        fmt.Sprintf("msg-%s-%d", convID, i),
			Role:      role,
			Content:   fmt.Sprintf("Message %d", i),
			Timestamp: time.Now(),
		}
		require.NoError(t, s.AddMessageToConversation(ctx, convID, msg))
	}
}

func TestGetConversationMessagesHandler_DefaultParams(t *testing.T) {
	h, s := setupTestHandlers(t)
	createTestRepo(t, s, "ws-1", "/path/to/ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addTestMessages(t, s, "conv-1", 5)

	req := httptest.NewRequest("GET", "/api/conversations/conv-1/messages", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.GetConversationMessages(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var page models.MessagePage
	err := json.Unmarshal(w.Body.Bytes(), &page)
	require.NoError(t, err)
	assert.Len(t, page.Messages, 5)
	assert.Equal(t, 5, page.TotalCount)
	assert.False(t, page.HasMore)
}

func TestGetConversationMessagesHandler_WithLimit(t *testing.T) {
	h, s := setupTestHandlers(t)
	createTestRepo(t, s, "ws-1", "/path/to/ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addTestMessages(t, s, "conv-1", 10)

	req := httptest.NewRequest("GET", "/api/conversations/conv-1/messages?limit=3", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.GetConversationMessages(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var page models.MessagePage
	err := json.Unmarshal(w.Body.Bytes(), &page)
	require.NoError(t, err)
	assert.Len(t, page.Messages, 3)
	assert.Equal(t, 10, page.TotalCount)
	assert.True(t, page.HasMore)
}

func TestGetConversationMessagesHandler_WithCursor(t *testing.T) {
	h, s := setupTestHandlers(t)
	createTestRepo(t, s, "ws-1", "/path/to/ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addTestMessages(t, s, "conv-1", 10)

	// First request to get the cursor
	req1 := httptest.NewRequest("GET", "/api/conversations/conv-1/messages?limit=3", nil)
	req1 = withChiContext(req1, map[string]string{"convId": "conv-1"})
	w1 := httptest.NewRecorder()
	h.GetConversationMessages(w1, req1)

	var page1 models.MessagePage
	require.NoError(t, json.Unmarshal(w1.Body.Bytes(), &page1))

	// Second request with cursor
	url := fmt.Sprintf("/api/conversations/conv-1/messages?limit=3&before=%d", page1.OldestPosition)
	req2 := httptest.NewRequest("GET", url, nil)
	req2 = withChiContext(req2, map[string]string{"convId": "conv-1"})
	w2 := httptest.NewRecorder()
	h.GetConversationMessages(w2, req2)

	assert.Equal(t, http.StatusOK, w2.Code)

	var page2 models.MessagePage
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &page2))
	assert.Len(t, page2.Messages, 3)
	assert.True(t, page2.HasMore)

	// No overlap between pages
	page1IDs := make(map[string]bool)
	for _, m := range page1.Messages {
		page1IDs[m.ID] = true
	}
	for _, m := range page2.Messages {
		assert.False(t, page1IDs[m.ID], "page2 should not contain messages from page1")
	}
}

func TestGetConversationMessagesHandler_InvalidBefore(t *testing.T) {
	h, s := setupTestHandlers(t)
	createTestRepo(t, s, "ws-1", "/path/to/ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	req := httptest.NewRequest("GET", "/api/conversations/conv-1/messages?before=notanumber", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.GetConversationMessages(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetConversationMessagesHandler_InvalidLimit(t *testing.T) {
	h, s := setupTestHandlers(t)
	createTestRepo(t, s, "ws-1", "/path/to/ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	tests := []struct {
		name  string
		limit string
	}{
		{"non-numeric", "abc"},
		{"zero", "0"},
		{"negative", "-5"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/conversations/conv-1/messages?limit="+tt.limit, nil)
			req = withChiContext(req, map[string]string{"convId": "conv-1"})
			w := httptest.NewRecorder()

			h.GetConversationMessages(w, req)

			assert.Equal(t, http.StatusBadRequest, w.Code)
		})
	}
}

func TestGetConversationMessagesHandler_EmptyConversation(t *testing.T) {
	h, s := setupTestHandlers(t)
	createTestRepo(t, s, "ws-1", "/path/to/ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	req := httptest.NewRequest("GET", "/api/conversations/conv-1/messages", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.GetConversationMessages(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var page models.MessagePage
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &page))
	assert.Empty(t, page.Messages)
	assert.False(t, page.HasMore)
	assert.Equal(t, 0, page.TotalCount)
}

func TestGetConversationMessagesHandler_NonexistentConversation(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/conversations/nonexistent/messages", nil)
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetConversationMessages(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var page models.MessagePage
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &page))
	assert.Empty(t, page.Messages)
	assert.Equal(t, 0, page.TotalCount)
}

func TestGetConversationMessagesHandler_FullPagination(t *testing.T) {
	h, s := setupTestHandlers(t)
	createTestRepo(t, s, "ws-1", "/path/to/ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addTestMessages(t, s, "conv-1", 11)

	// Walk through all pages via the HTTP handler
	var allMessages []models.Message
	baseURL := "/api/conversations/conv-1/messages?limit=4"
	cursorParam := ""

	for {
		req := httptest.NewRequest("GET", baseURL+cursorParam, nil)
		req = withChiContext(req, map[string]string{"convId": "conv-1"})
		w := httptest.NewRecorder()
		h.GetConversationMessages(w, req)

		require.Equal(t, http.StatusOK, w.Code)

		var page models.MessagePage
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &page))
		allMessages = append(allMessages, page.Messages...)

		if !page.HasMore {
			break
		}
		cursorParam = fmt.Sprintf("&before=%d", page.OldestPosition)
	}

	assert.Len(t, allMessages, 11)

	// Verify no duplicates
	seen := make(map[string]bool)
	for _, m := range allMessages {
		assert.False(t, seen[m.ID], "duplicate message: %s", m.ID)
		seen[m.ID] = true
	}
}

// ============================================================================
// Active Streaming Conversations Handler Tests
// ============================================================================

func TestGetActiveStreamingConversations_NoProcesses(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	req := httptest.NewRequest("GET", "/api/conversations/active-streaming", nil)
	w := httptest.NewRecorder()

	h.GetActiveStreamingConversations(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Header().Get("Content-Type"), "application/json")

	var result map[string][]string
	err := json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Empty(t, result["conversationIds"])
}

func TestGetActiveStreamingConversations_ReturnsEmptyArray(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	req := httptest.NewRequest("GET", "/api/conversations/active-streaming", nil)
	w := httptest.NewRecorder()

	h.GetActiveStreamingConversations(w, req)

	// Verify it returns [] not null
	assert.Contains(t, w.Body.String(), `"conversationIds":[]`)
}

func TestGetActiveStreamingConversations_WithRunningProcess(t *testing.T) {
	h, _, agentMgr := setupTestHandlersWithAgentManager(t)

	proc := agent.NewProcess("proc-1", t.TempDir(), "conv-active")
	proc.SetRunningForTest(true)
	agentMgr.InsertProcessForTest("conv-active", proc)

	req := httptest.NewRequest("GET", "/api/conversations/active-streaming", nil)
	w := httptest.NewRecorder()

	h.GetActiveStreamingConversations(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string][]string
	err := json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Equal(t, []string{"conv-active"}, result["conversationIds"])
}

func TestGetActiveStreamingConversations_MixedProcesses(t *testing.T) {
	h, _, agentMgr := setupTestHandlersWithAgentManager(t)

	procRunning := agent.NewProcess("proc-1", t.TempDir(), "conv-running")
	procRunning.SetRunningForTest(true)
	agentMgr.InsertProcessForTest("conv-running", procRunning)

	procStopped := agent.NewProcess("proc-2", t.TempDir(), "conv-stopped")
	agentMgr.InsertProcessForTest("conv-stopped", procStopped)

	req := httptest.NewRequest("GET", "/api/conversations/active-streaming", nil)
	w := httptest.NewRecorder()

	h.GetActiveStreamingConversations(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string][]string
	err := json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Len(t, result["conversationIds"], 1)
	assert.Contains(t, result["conversationIds"], "conv-running")
}

// ============================================================================
// ResolvePR Handler Tests
// ============================================================================

// setupTestHandlersWithGitHub creates handlers with a mock GitHub client for testing
func setupTestHandlersWithGitHub(t *testing.T, ghServer *httptest.Server) (*Handlers, *store.SQLiteStore) {
	t.Helper()

	sqliteStore, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)

	prCache := github.NewPRCache(5*time.Minute, 10*time.Minute)

	ghClient := github.NewClient("", "")
	ghClient.SetAPIURL(ghServer.URL)
	ghClient.SetToken("test_token")

	t.Cleanup(func() {
		sqliteStore.Close()
		prCache.Close()
	})

	handlers := NewHandlers(sqliteStore, nil, DirListingCacheConfig{TTL: 30 * time.Second}, nil, nil, nil, ghClient, prCache, nil, nil, nil, nil)

	return handlers, sqliteStore
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

func TestGetEnvSettings_Empty(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	req := httptest.NewRequest("GET", "/api/settings/env", nil)
	w := httptest.NewRecorder()

	h.GetEnvSettings(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Equal(t, "", result["envVars"])
}

func TestSetEnvSettings_Success(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	envVars := "API_KEY=test123\nDEBUG=true"
	reqBody := map[string]string{"envVars": envVars}
	body, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/settings/env", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetEnvSettings(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]string
	err = json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Equal(t, envVars, result["envVars"])
}

func TestGetEnvSettings_AfterSet(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	envVars := "FOO=bar\nBAZ=qux"
	reqBody := map[string]string{"envVars": envVars}
	body, err := json.Marshal(reqBody)
	require.NoError(t, err)

	// Set env vars
	setReq := httptest.NewRequest("PUT", "/api/settings/env", bytes.NewReader(body))
	setReq.Header.Set("Content-Type", "application/json")
	setW := httptest.NewRecorder()
	h.SetEnvSettings(setW, setReq)
	assert.Equal(t, http.StatusOK, setW.Code)

	// Get env vars
	getReq := httptest.NewRequest("GET", "/api/settings/env", nil)
	getW := httptest.NewRecorder()
	h.GetEnvSettings(getW, getReq)

	assert.Equal(t, http.StatusOK, getW.Code)

	var result map[string]string
	err = json.Unmarshal(getW.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Equal(t, envVars, result["envVars"])
}

func TestSetEnvSettings_InvalidJSON(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	req := httptest.NewRequest("PUT", "/api/settings/env", strings.NewReader("{invalid json}"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetEnvSettings(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestParseEnvVars(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected map[string]string
	}{
		{
			name:  "basic KEY=VALUE parsing",
			input: "KEY1=value1\nKEY2=value2",
			expected: map[string]string{
				"KEY1": "value1",
				"KEY2": "value2",
			},
		},
		{
			name:  "strips export prefix",
			input: "export API_KEY=secret\nexport DEBUG=true",
			expected: map[string]string{
				"API_KEY": "secret",
				"DEBUG":   "true",
			},
		},
		{
			name:     "skips blank lines and comments",
			input:    "KEY1=value1\n\n# This is a comment\nKEY2=value2\n   \n# Another comment",
			expected: map[string]string{
				"KEY1": "value1",
				"KEY2": "value2",
			},
		},
		{
			name:  "handles values with = signs",
			input: "CONNECTION_STRING=host=localhost;user=admin;password=pass=123",
			expected: map[string]string{
				"CONNECTION_STRING": "host=localhost;user=admin;password=pass=123",
			},
		},
		{
			name:     "returns empty map for empty string",
			input:    "",
			expected: map[string]string{},
		},
		{
			name:     "returns empty map for only whitespace",
			input:    "   \n\n   \n",
			expected: map[string]string{},
		},
		{
			name:  "mixed format",
			input: "export KEY1=value1\nKEY2=value2\n\n# Comment\nexport KEY3=value=with=equals",
			expected: map[string]string{
				"KEY1": "value1",
				"KEY2": "value2",
				"KEY3": "value=with=equals",
			},
		},
		{
			name:  "strips double quotes from values",
			input: `MY_VAR="hello world"`,
			expected: map[string]string{
				"MY_VAR": "hello world",
			},
		},
		{
			name:  "strips single quotes from values",
			input: `MY_VAR='hello world'`,
			expected: map[string]string{
				"MY_VAR": "hello world",
			},
		},
		{
			name:  "preserves inner quotes",
			input: `MY_VAR="it's a test"`,
			expected: map[string]string{
				"MY_VAR": "it's a test",
			},
		},
		{
			name:  "does not strip mismatched quotes",
			input: `MY_VAR="hello'`,
			expected: map[string]string{
				"MY_VAR": `"hello'`,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := store.ParseEnvVars(tt.input)
			assert.Equal(t, tt.expected, result)
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

// ============================================================================
// CreateSession with CheckoutExisting Tests
// ============================================================================

func TestCreateSession_CheckoutExisting_Success(t *testing.T) {
	h, s := setupTestHandlers(t)

	// Create a real git repo with a remote branch to checkout
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Create a feature branch on origin
	// First get the origin path from the repo
	cmd := exec.Command("git", "remote", "get-url", "origin")
	cmd.Dir = repoPath
	originOut, err := cmd.Output()
	require.NoError(t, err)
	originPath := strings.TrimSpace(string(originOut))

	// Clone origin to a temp dir, create a branch, push it
	cloneDir := t.TempDir()
	runGit(t, cloneDir, "clone", originPath, ".")
	runGit(t, cloneDir, "config", "user.email", "test@test.com")
	runGit(t, cloneDir, "config", "user.name", "Test User")
	runGit(t, cloneDir, "checkout", "-b", "feature/existing-pr")
	writeFile(t, cloneDir, "feature.txt", "new feature content")
	runGit(t, cloneDir, "add", ".")
	runGit(t, cloneDir, "commit", "-m", "Add feature")
	runGit(t, cloneDir, "push", "origin", "feature/existing-pr")

	// Clean up test session directory after test
	t.Cleanup(func() {
		workspacesDir, _ := git.WorkspacesBaseDir()
		entries, _ := os.ReadDir(workspacesDir)
		for _, entry := range entries {
			if entry.IsDir() {
				os.RemoveAll(filepath.Join(workspacesDir, entry.Name()))
			}
		}
	})

	body, _ := json.Marshal(CreateSessionRequest{
		Name:             "test-checkout-session",
		Branch:           "feature/existing-pr",
		CheckoutExisting: true,
		Task:             "Review the PR",
		SystemMessage:    "## PR Context\nThis is a test PR",
	})
	req := httptest.NewRequest("POST", "/api/repos/ws-1/sessions", bytes.NewReader(body))
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w := httptest.NewRecorder()

	h.CreateSession(w, req)

	require.Equal(t, http.StatusOK, w.Code, "Response: %s", w.Body.String())

	var sess models.Session
	err = json.Unmarshal(w.Body.Bytes(), &sess)
	require.NoError(t, err)

	assert.Equal(t, "test-checkout-session", sess.Name)
	assert.Equal(t, "feature/existing-pr", sess.Branch)
	assert.NotEmpty(t, sess.WorktreePath)
	assert.Equal(t, "Review the PR", sess.Task)
}

func TestCreateSession_CheckoutExisting_BranchNotFound(t *testing.T) {
	h, s := setupTestHandlers(t)

	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Clean up
	t.Cleanup(func() {
		workspacesDir, _ := git.WorkspacesBaseDir()
		entries, _ := os.ReadDir(workspacesDir)
		for _, entry := range entries {
			if entry.IsDir() {
				os.RemoveAll(filepath.Join(workspacesDir, entry.Name()))
			}
		}
	})

	body, _ := json.Marshal(CreateSessionRequest{
		Name:             "test-nonexistent",
		Branch:           "nonexistent-branch",
		CheckoutExisting: true,
	})
	req := httptest.NewRequest("POST", "/api/repos/ws-1/sessions", bytes.NewReader(body))
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w := httptest.NewRecorder()

	h.CreateSession(w, req)

	// Should fail because the remote branch doesn't exist
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestCreateSession_CheckoutExisting_SystemMessageStored(t *testing.T) {
	h, s := setupTestHandlers(t)

	// Create a real git repo with a remote branch
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Create a feature branch on origin
	cmd := exec.Command("git", "remote", "get-url", "origin")
	cmd.Dir = repoPath
	originOut, err := cmd.Output()
	require.NoError(t, err)
	originPath := strings.TrimSpace(string(originOut))

	cloneDir := t.TempDir()
	runGit(t, cloneDir, "clone", originPath, ".")
	runGit(t, cloneDir, "config", "user.email", "test@test.com")
	runGit(t, cloneDir, "config", "user.name", "Test User")
	runGit(t, cloneDir, "checkout", "-b", "feature/sys-msg-test")
	writeFile(t, cloneDir, "test.txt", "content")
	runGit(t, cloneDir, "add", ".")
	runGit(t, cloneDir, "commit", "-m", "Test commit")
	runGit(t, cloneDir, "push", "origin", "feature/sys-msg-test")

	t.Cleanup(func() {
		workspacesDir, _ := git.WorkspacesBaseDir()
		entries, _ := os.ReadDir(workspacesDir)
		for _, entry := range entries {
			if entry.IsDir() {
				os.RemoveAll(filepath.Join(workspacesDir, entry.Name()))
			}
		}
	})

	systemMsg := "## PR #42: Add auth\n**Branch:** feature/sys-msg-test → main\n**Changes:** +200 -50 across 8 files"

	body, _ := json.Marshal(CreateSessionRequest{
		Name:             "test-sys-msg",
		Branch:           "feature/sys-msg-test",
		CheckoutExisting: true,
		SystemMessage:    systemMsg,
	})
	req := httptest.NewRequest("POST", "/api/repos/ws-1/sessions", bytes.NewReader(body))
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w := httptest.NewRecorder()

	h.CreateSession(w, req)

	require.Equal(t, http.StatusOK, w.Code, "Response: %s", w.Body.String())

	var sess models.Session
	err = json.Unmarshal(w.Body.Bytes(), &sess)
	require.NoError(t, err)

	// Verify the session was created with the correct branch
	assert.Equal(t, "feature/sys-msg-test", sess.Branch)

	// Verify system message was stored - fetch the conversation and its messages
	ctx := context.Background()
	conversations, err := s.ListConversations(ctx, sess.ID)
	require.NoError(t, err)
	require.NotEmpty(t, conversations, "session should have at least one conversation")

	// Get messages from the first conversation
	msgPage, err := s.GetConversationMessages(ctx, conversations[0].ID, nil, 100)
	require.NoError(t, err)

	// Find the system message
	foundSystemMsg := false
	for _, msg := range msgPage.Messages {
		if msg.Role == "system" && msg.Content == systemMsg {
			foundSystemMsg = true
			break
		}
	}
	assert.True(t, foundSystemMsg, "System message should be stored in the conversation")
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

func TestCreateSession_WithBranchPrefix(t *testing.T) {
	h, s := setupTestHandlers(t)

	// Create a real git repo
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Use timestamp-based session name to avoid conflicts
	sessionName := fmt.Sprintf("test-session-%d", time.Now().UnixNano())

	// Clean up test session directory after test
	t.Cleanup(func() {
		workspacesDir, _ := git.WorkspacesBaseDir()
		os.RemoveAll(filepath.Join(workspacesDir, sessionName))
	})

	// Create session with BranchPrefix
	reqBody := CreateSessionRequest{
		Name:         sessionName,
		BranchPrefix: "feature",
	}
	body, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/repos/ws-1/sessions", bytes.NewReader(body))
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w := httptest.NewRecorder()

	h.CreateSession(w, req)

	require.Equal(t, http.StatusOK, w.Code, "Response: %s", w.Body.String())

	var session models.Session
	err = json.Unmarshal(w.Body.Bytes(), &session)
	require.NoError(t, err)

	// Verify branch name starts with the prefix
	assert.True(t, strings.HasPrefix(session.Branch, "feature/"),
		"Expected branch name to start with 'feature/', got: %s", session.Branch)
}
