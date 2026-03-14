package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
	createTestConversation(t, s, "conv-1", "sess-1")
	addTestMessage(t, s, "conv-1")

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
	createTestConversation(t, s, "conv-1", "sess-1")
	addTestMessage(t, s, "conv-1")

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
func TestUpdateSession_Archive_SetsSummaryGenerating(t *testing.T) {
	// Mock AI server that blocks forever to prevent the async goroutine from completing
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			return
		}
	}))
	defer aiServer.Close()

	h, s := setupTestHandlersWithAIClient(t, aiServer.URL)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")
	addTestMessage(t, s, "conv-1")

	// Archive the session
	archived := true
	body, _ := json.Marshal(UpdateSessionRequest{Archived: &archived})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify DB has generating status (set synchronously before goroutine)
	sess, err := s.GetSession(context.Background(), "sess-1")
	require.NoError(t, err)
	assert.True(t, sess.Archived)
	assert.Equal(t, models.SummaryStatusGenerating, sess.ArchiveSummaryStatus)
}

func TestUpdateSession_Archive_BlankSession_Deletes(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	// No conversation or messages — blank session

	// Archive the blank session
	archived := true
	body, _ := json.Marshal(UpdateSessionRequest{Archived: &archived})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	// Blank session should be deleted, not archived
	assert.Equal(t, http.StatusNoContent, w.Code)

	// Verify session is deleted from DB
	sess, err := s.GetSession(context.Background(), "sess-1")
	require.NoError(t, err)
	assert.Nil(t, sess)
}

func TestUpdateSession_Archive_BlankSession_CleansUpBranch(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")

	// Create a session with a branch set (simulates a real session that got a branch on creation)
	ctx := context.Background()
	session := &models.Session{
		ID:          "sess-1",
		WorkspaceID: "ws-1",
		Name:        "Test Session",
		Branch:      "test/empty-branch",
		Status:      "idle",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))
	// No conversation or messages — blank session

	// Archive the blank session (without deleteBranch flag — cleanup should still happen)
	archived := true
	body, _ := json.Marshal(UpdateSessionRequest{Archived: &archived})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	// Blank session should be deleted, not archived (branch cleanup error is logged but non-fatal)
	assert.Equal(t, http.StatusNoContent, w.Code)

	// Verify session is deleted from DB
	sess, err := s.GetSession(context.Background(), "sess-1")
	require.NoError(t, err)
	assert.Nil(t, sess)
}

func TestUpdateSession_Archive_BlankSession_CleansUpWorktree(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")

	// Create a session with both branch and worktree path set
	ctx := context.Background()
	session := &models.Session{
		ID:           "sess-1",
		WorkspaceID:  "ws-1",
		Name:         "Test Session",
		Branch:       "test/empty-branch",
		WorktreePath: "/path/to/worktree",
		Status:       "idle",
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))
	// No conversation or messages — blank session

	// Archive the blank session — should attempt worktree removal (RemoveAtPath)
	archived := true
	body, _ := json.Marshal(UpdateSessionRequest{Archived: &archived})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	// Blank session should be deleted (worktree cleanup error is logged but non-fatal)
	assert.Equal(t, http.StatusNoContent, w.Code)

	// Verify session is deleted from DB
	sess, err := s.GetSession(context.Background(), "sess-1")
	require.NoError(t, err)
	assert.Nil(t, sess)
}

func TestUpdateSession_Archive_NoAIClient_SkipsSummary(t *testing.T) {
	h, s := setupTestHandlers(t) // No AI client

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")
	addTestMessage(t, s, "conv-1")

	// Archive the session
	archived := true
	body, _ := json.Marshal(UpdateSessionRequest{Archived: &archived})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify summary status is empty (no AI client = no summary generation)
	var gotSession models.Session
	err := json.Unmarshal(w.Body.Bytes(), &gotSession)
	require.NoError(t, err)
	assert.True(t, gotSession.Archived)
	assert.Empty(t, gotSession.ArchiveSummaryStatus)

	// Verify in DB too
	sess, err := s.GetSession(context.Background(), "sess-1")
	require.NoError(t, err)
	assert.Empty(t, sess.ArchiveSummaryStatus)
}

func TestUpdateSession_Unarchive_DoesNotTriggerSummary(t *testing.T) {
	// Mock AI server that blocks forever
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			return
		}
	}))
	defer aiServer.Close()

	h, s := setupTestHandlersWithAIClient(t, aiServer.URL)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")

	// First archive the session and set a completed summary
	require.NoError(t, s.UpdateSession(context.Background(), "sess-1", func(sess *models.Session) {
		sess.Archived = true
		sess.ArchiveSummary = "Existing summary"
		sess.ArchiveSummaryStatus = models.SummaryStatusCompleted
	}))

	// Now unarchive
	archived := false
	body, _ := json.Marshal(UpdateSessionRequest{Archived: &archived})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify session is unarchived and summary status was NOT reset to "generating"
	sess, err := s.GetSession(context.Background(), "sess-1")
	require.NoError(t, err)
	assert.False(t, sess.Archived)
	assert.NotEqual(t, models.SummaryStatusGenerating, sess.ArchiveSummaryStatus)
}
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
func TestUpdateSession_SetTargetBranch(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")

	targetBranch := "origin/develop"
	body, _ := json.Marshal(UpdateSessionRequest{TargetBranch: &targetBranch})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var gotSession models.Session
	err := json.Unmarshal(w.Body.Bytes(), &gotSession)
	require.NoError(t, err)
	assert.Equal(t, "origin/develop", gotSession.TargetBranch)

	// Verify persisted in DB
	sess, err := s.GetSession(context.Background(), "sess-1")
	require.NoError(t, err)
	assert.Equal(t, "origin/develop", sess.TargetBranch)
}

func TestUpdateSession_ClearTargetBranch(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")

	// First set it
	require.NoError(t, s.UpdateSession(context.Background(), "sess-1", func(sess *models.Session) {
		sess.TargetBranch = "origin/develop"
	}))

	// Clear it by sending empty string
	empty := ""
	body, _ := json.Marshal(UpdateSessionRequest{TargetBranch: &empty})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify cleared in DB
	sess, err := s.GetSession(context.Background(), "sess-1")
	require.NoError(t, err)
	assert.Empty(t, sess.TargetBranch)
}

func TestUpdateSession_TargetBranch_ValidationRejectsInvalidPrefix(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")

	// Attempt to set target branch without "origin/" prefix
	invalid := "develop"
	body, _ := json.Marshal(UpdateSessionRequest{TargetBranch: &invalid})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Verify not persisted
	sess, err := s.GetSession(context.Background(), "sess-1")
	require.NoError(t, err)
	assert.Empty(t, sess.TargetBranch)
}

func TestUpdateSession_TargetBranch_ValidationRejectsBareOriginSlash(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")

	// "origin/" with no branch name should be rejected
	invalid := "origin/"
	body, _ := json.Marshal(UpdateSessionRequest{TargetBranch: &invalid})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}
func TestUpdateSession_TargetBranch_ValidationAcceptsEmptyString(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")

	// Empty string is valid (clears the override)
	empty := ""
	body, _ := json.Marshal(UpdateSessionRequest{TargetBranch: &empty})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestUpdateSession_TargetBranch_ValidationAcceptsOriginPrefix(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")

	branches := []string{
		"origin/main",
		"origin/develop",
		"origin/release/v2.0",
		"origin/feature/deep/nested",
	}

	for _, branch := range branches {
		b := branch
		body, _ := json.Marshal(UpdateSessionRequest{TargetBranch: &b})
		req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
		w := httptest.NewRecorder()

		h.UpdateSession(w, req)

		assert.Equal(t, http.StatusOK, w.Code, "should accept %q", branch)
	}
}

func TestUpdateSession_TargetBranch_NilDoesNotModify(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")

	// Set target branch directly
	require.NoError(t, s.UpdateSession(context.Background(), "sess-1", func(sess *models.Session) {
		sess.TargetBranch = "origin/develop"
	}))

	// Update name without touching target branch (TargetBranch is nil in request)
	name := "renamed"
	body, _ := json.Marshal(UpdateSessionRequest{Name: &name})
	req := httptest.NewRequest("PATCH", "/api/repos/ws-1/sessions/sess-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.UpdateSession(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Target branch should be unchanged
	sess, err := s.GetSession(context.Background(), "sess-1")
	require.NoError(t, err)
	assert.Equal(t, "origin/develop", sess.TargetBranch)
	assert.Equal(t, "renamed", sess.Name)
}
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
	msgPage, err := s.GetConversationMessages(ctx, conversations[0].ID, nil, 100, false)
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

func TestCreateSession_SetupInfo_OriginBranch(t *testing.T) {
	tests := []struct {
		name           string
		setupRepo      func(t *testing.T, h *Handlers, s *store.SQLiteStore) *models.Repo
		request        CreateSessionRequest
		expectedOrigin string
	}{
		{
			name: "default_origin_main",
			setupRepo: func(t *testing.T, h *Handlers, s *store.SQLiteStore) *models.Repo {
				repoPath := createTestGitRepo(t)
				return createTestRepo(t, s, "ws-default", repoPath)
			},
			request: CreateSessionRequest{
				Name: fmt.Sprintf("test-default-%d", time.Now().UnixNano()),
			},
			expectedOrigin: "origin/main",
		},
		{
			name: "custom_target_branch",
			setupRepo: func(t *testing.T, h *Handlers, s *store.SQLiteStore) *models.Repo {
				repoPath := createTestGitRepo(t)

				// Get origin path and push a develop branch
				cmd := exec.Command("git", "remote", "get-url", "origin")
				cmd.Dir = repoPath
				originOut, err := cmd.Output()
				require.NoError(t, err)
				originPath := strings.TrimSpace(string(originOut))

				cloneDir := t.TempDir()
				runGit(t, cloneDir, "clone", originPath, ".")
				runGit(t, cloneDir, "config", "user.email", "test@test.com")
				runGit(t, cloneDir, "config", "user.name", "Test User")
				runGit(t, cloneDir, "checkout", "-b", "develop")
				writeFile(t, cloneDir, "dev.txt", "develop content")
				runGit(t, cloneDir, "add", ".")
				runGit(t, cloneDir, "commit", "-m", "Develop commit")
				runGit(t, cloneDir, "push", "origin", "develop")

				// Fetch in the working repo so origin/develop exists
				runGit(t, repoPath, "fetch", "origin")

				return createTestRepo(t, s, "ws-custom", repoPath)
			},
			request: CreateSessionRequest{
				Name:         fmt.Sprintf("test-custom-%d", time.Now().UnixNano()),
				TargetBranch: "origin/develop",
			},
			expectedOrigin: "origin/develop",
		},
		{
			name: "repo_with_custom_remote",
			setupRepo: func(t *testing.T, h *Handlers, s *store.SQLiteStore) *models.Repo {
				repoPath := createTestGitRepo(t)

				// Rename the remote from "origin" to "upstream"
				runGit(t, repoPath, "remote", "rename", "origin", "upstream")

				repo := createTestRepo(t, s, "ws-upstream", repoPath)
				repo.Remote = "upstream"
				require.NoError(t, s.UpdateRepo(context.Background(), repo))
				return repo
			},
			request: CreateSessionRequest{
				Name: fmt.Sprintf("test-upstream-%d", time.Now().UnixNano()),
			},
			expectedOrigin: "upstream/main",
		},
		{
			name: "checkout_existing_branch",
			setupRepo: func(t *testing.T, h *Handlers, s *store.SQLiteStore) *models.Repo {
				repoPath := createTestGitRepo(t)

				// Push a feature branch to origin
				cmd := exec.Command("git", "remote", "get-url", "origin")
				cmd.Dir = repoPath
				originOut, err := cmd.Output()
				require.NoError(t, err)
				originPath := strings.TrimSpace(string(originOut))

				cloneDir := t.TempDir()
				runGit(t, cloneDir, "clone", originPath, ".")
				runGit(t, cloneDir, "config", "user.email", "test@test.com")
				runGit(t, cloneDir, "config", "user.name", "Test User")
				runGit(t, cloneDir, "checkout", "-b", "feature/setup-info-test")
				writeFile(t, cloneDir, "feature.txt", "feature content")
				runGit(t, cloneDir, "add", ".")
				runGit(t, cloneDir, "commit", "-m", "Feature commit")
				runGit(t, cloneDir, "push", "origin", "feature/setup-info-test")

				return createTestRepo(t, s, "ws-checkout", repoPath)
			},
			request: CreateSessionRequest{
				Name:             fmt.Sprintf("test-checkout-%d", time.Now().UnixNano()),
				Branch:           "feature/setup-info-test",
				CheckoutExisting: true,
			},
			// When checking out an existing branch, targetBranch is still origin/main
			expectedOrigin: "origin/main",
		},
		{
			name: "empty_repo_branch_defaults_to_origin_main",
			setupRepo: func(t *testing.T, h *Handlers, s *store.SQLiteStore) *models.Repo {
				repoPath := createTestGitRepo(t)
				repo := createTestRepo(t, s, "ws-empty-branch", repoPath)
				repo.Branch = "" // Clear the branch to trigger fallback
				require.NoError(t, s.UpdateRepo(context.Background(), repo))
				return repo
			},
			request: CreateSessionRequest{
				Name: fmt.Sprintf("test-empty-branch-%d", time.Now().UnixNano()),
			},
			expectedOrigin: "origin/main",
		},
		{
			name: "nonexistent_configured_branch_falls_back_to_main",
			setupRepo: func(t *testing.T, h *Handlers, s *store.SQLiteStore) *models.Repo {
				repoPath := createTestGitRepo(t)
				repo := createTestRepo(t, s, "ws-nonexistent", repoPath)
				repo.Branch = "production" // Doesn't exist on origin
				require.NoError(t, s.UpdateRepo(context.Background(), repo))
				return repo
			},
			request: CreateSessionRequest{
				Name: fmt.Sprintf("test-nonexistent-%d", time.Now().UnixNano()),
			},
			expectedOrigin: "origin/main",
		},
		{
			name: "falls_back_to_origin_master_when_main_missing",
			setupRepo: func(t *testing.T, h *Handlers, s *store.SQLiteStore) *models.Repo {
				// Create a repo where origin only has "master", not "main"
				dir := t.TempDir()
				runGit(t, dir, "init")
				runGit(t, dir, "config", "user.email", "test@test.com")
				runGit(t, dir, "config", "user.name", "Test User")
				runGit(t, dir, "checkout", "-b", "master")
				writeFile(t, dir, "README.md", "# Test")
				runGit(t, dir, "add", ".")
				runGit(t, dir, "commit", "-m", "Initial commit")

				originDir := t.TempDir()
				runGit(t, originDir, "init", "--bare")
				runGit(t, dir, "remote", "add", "origin", originDir)
				runGit(t, dir, "push", "-u", "origin", "master")

				repo := createTestRepo(t, s, "ws-master", dir)
				repo.Branch = "staging" // Non-existent; should fall back to origin/master
				require.NoError(t, s.UpdateRepo(context.Background(), repo))
				return repo
			},
			request: CreateSessionRequest{
				Name: fmt.Sprintf("test-master-%d", time.Now().UnixNano()),
			},
			expectedOrigin: "origin/master",
		},
		{
			name: "explicit_target_overrides_repo_branch",
			setupRepo: func(t *testing.T, h *Handlers, s *store.SQLiteStore) *models.Repo {
				repoPath := createTestGitRepo(t)

				// Push a develop branch to origin
				cmd := exec.Command("git", "remote", "get-url", "origin")
				cmd.Dir = repoPath
				originOut, err := cmd.Output()
				require.NoError(t, err)
				originPath := strings.TrimSpace(string(originOut))

				cloneDir := t.TempDir()
				runGit(t, cloneDir, "clone", originPath, ".")
				runGit(t, cloneDir, "config", "user.email", "test@test.com")
				runGit(t, cloneDir, "config", "user.name", "Test User")
				runGit(t, cloneDir, "checkout", "-b", "develop")
				writeFile(t, cloneDir, "dev.txt", "develop content")
				runGit(t, cloneDir, "add", ".")
				runGit(t, cloneDir, "commit", "-m", "Develop commit")
				runGit(t, cloneDir, "push", "origin", "develop")
				runGit(t, repoPath, "fetch", "origin")

				// repo.Branch is "main" but explicit target overrides it
				return createTestRepo(t, s, "ws-override", repoPath)
			},
			request: CreateSessionRequest{
				Name:         fmt.Sprintf("test-override-%d", time.Now().UnixNano()),
				TargetBranch: "origin/develop",
			},
			expectedOrigin: "origin/develop",
		},
		{
			name: "empty_remote_defaults_to_origin",
			setupRepo: func(t *testing.T, h *Handlers, s *store.SQLiteStore) *models.Repo {
				repoPath := createTestGitRepo(t)
				repo := createTestRepo(t, s, "ws-no-remote", repoPath)
				repo.Remote = "" // Explicitly clear — should fall back to "origin"
				require.NoError(t, s.UpdateRepo(context.Background(), repo))
				return repo
			},
			request: CreateSessionRequest{
				Name: fmt.Sprintf("test-no-remote-%d", time.Now().UnixNano()),
			},
			expectedOrigin: "origin/main",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, s := setupTestHandlers(t)
			repo := tt.setupRepo(t, h, s)

			body, err := json.Marshal(tt.request)
			require.NoError(t, err)

			req := httptest.NewRequest("POST", "/api/repos/"+repo.ID+"/sessions", bytes.NewReader(body))
			req = withChiContext(req, map[string]string{"id": repo.ID})
			w := httptest.NewRecorder()

			h.CreateSession(w, req)
			require.Equal(t, http.StatusOK, w.Code, "Response: %s", w.Body.String())

			var sess models.Session
			err = json.Unmarshal(w.Body.Bytes(), &sess)
			require.NoError(t, err)

			// Fetch system message from DB and validate SetupInfo
			ctx := context.Background()
			conversations, err := s.ListConversations(ctx, sess.ID)
			require.NoError(t, err)
			require.NotEmpty(t, conversations, "session should have at least one conversation")

			msgPage, err := s.GetConversationMessages(ctx, conversations[0].ID, nil, 100, false)
			require.NoError(t, err)

			var setupInfo *models.SetupInfo
			for _, msg := range msgPage.Messages {
				if msg.Role == "system" && msg.SetupInfo != nil {
					setupInfo = msg.SetupInfo
					break
				}
			}
			require.NotNil(t, setupInfo, "system message should have SetupInfo")
			assert.Equal(t, sess.Name, setupInfo.SessionName, "SetupInfo.SessionName should match session name")
			assert.Equal(t, sess.Branch, setupInfo.BranchName, "SetupInfo.BranchName should match session branch")
			assert.Equal(t, tt.expectedOrigin, setupInfo.OriginBranch, "SetupInfo.OriginBranch should reflect the actual target branch")
		})
	}
}

func TestCreateSession_SetupInfo_InvalidTargetBranchWithoutSlash(t *testing.T) {
	h, s := setupTestHandlers(t)

	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-invalid-target", repoPath)

	body, err := json.Marshal(CreateSessionRequest{
		Name:         "test-invalid-target",
		TargetBranch: "main", // Missing slash — must be "<remote>/<branch>"
	})
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/repos/"+repo.ID+"/sessions", bytes.NewReader(body))
	req = withChiContext(req, map[string]string{"id": repo.ID})
	w := httptest.NewRecorder()

	h.CreateSession(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "targetBranch must be in the form")
}

func TestCreateSession_WithBranchPrefix(t *testing.T) {
	h, s := setupTestHandlers(t)

	// Create a real git repo
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "ws-1", repoPath)

	// Use timestamp-based session name to avoid conflicts
	sessionName := fmt.Sprintf("test-session-%d", time.Now().UnixNano())

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
func TestResolveRepoBranchPrefix_EmptyDefault(t *testing.T) {
	h := &Handlers{ghClient: github.NewClient("", "")}
	repo := &models.Repo{BranchPrefix: ""}
	assert.Equal(t, "session", h.resolveRepoBranchPrefix(repo))
}

func TestResolveRepoBranchPrefix_None(t *testing.T) {
	h := &Handlers{ghClient: github.NewClient("", "")}
	repo := &models.Repo{BranchPrefix: "none"}
	assert.Equal(t, "", h.resolveRepoBranchPrefix(repo))
}

func TestResolveRepoBranchPrefix_CustomWithValue(t *testing.T) {
	h := &Handlers{ghClient: github.NewClient("", "")}
	repo := &models.Repo{BranchPrefix: "custom", CustomPrefix: "my-prefix"}
	assert.Equal(t, "my-prefix", h.resolveRepoBranchPrefix(repo))
}

func TestResolveRepoBranchPrefix_CustomWithEmptyPrefix(t *testing.T) {
	h := &Handlers{ghClient: github.NewClient("", "")}
	repo := &models.Repo{BranchPrefix: "custom", CustomPrefix: ""}
	assert.Equal(t, "session", h.resolveRepoBranchPrefix(repo))
}

func TestResolveRepoBranchPrefix_GitHubNoUser(t *testing.T) {
	h := &Handlers{ghClient: github.NewClient("", "")}
	repo := &models.Repo{BranchPrefix: "github"}
	assert.Equal(t, "session", h.resolveRepoBranchPrefix(repo))
}

func TestResolveRepoBranchPrefix_GitHubWithUser(t *testing.T) {
	ghClient := github.NewClient("", "")
	ghClient.SetUser(&github.User{Login: "mcastilho"})
	h := &Handlers{ghClient: ghClient}
	repo := &models.Repo{BranchPrefix: "github"}
	assert.Equal(t, "mcastilho", h.resolveRepoBranchPrefix(repo))
}

func TestResolveRepoBranchPrefix_Unknown(t *testing.T) {
	h := &Handlers{ghClient: github.NewClient("", "")}
	repo := &models.Repo{BranchPrefix: "something-unknown"}
	assert.Equal(t, "session", h.resolveRepoBranchPrefix(repo))
}
