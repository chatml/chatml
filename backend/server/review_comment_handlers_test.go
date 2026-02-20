package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// createTestReviewComment adds a review comment to the store for testing
func createTestReviewComment(t *testing.T, h *Handlers, sessionID, id string) *models.ReviewComment {
	t.Helper()
	ctx := context.Background()
	comment := &models.ReviewComment{
		ID:         id,
		SessionID:  sessionID,
		FilePath:   "src/main.go",
		LineNumber: 42,
		Title:      "Test issue",
		Content:    "Test review comment content",
		Source:     models.CommentSourceClaude,
		Author:     "Claude",
		Severity:   models.CommentSeverityWarning,
		CreatedAt:  time.Now(),
		Resolved:   false,
	}
	require.NoError(t, h.store.AddReviewComment(ctx, comment))
	return comment
}

// ============================================================================
// ListReviewComments Tests
// ============================================================================

func TestListReviewComments_Success(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	createTestReviewComment(t, h, session.ID, "comment-1")
	createTestReviewComment(t, h, session.ID, "comment-2")

	req := httptest.NewRequest("GET", "/comments", nil)
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.ListReviewComments(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var comments []*models.ReviewComment
	err := json.Unmarshal(w.Body.Bytes(), &comments)
	require.NoError(t, err)
	assert.Len(t, comments, 2)
}

func TestListReviewComments_FilterByFile(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	ctx := context.Background()
	require.NoError(t, h.store.AddReviewComment(ctx, &models.ReviewComment{
		ID: "c1", SessionID: session.ID, FilePath: "src/a.go", LineNumber: 1,
		Content: "a", Source: "claude", Author: "Claude", CreatedAt: time.Now(),
	}))
	require.NoError(t, h.store.AddReviewComment(ctx, &models.ReviewComment{
		ID: "c2", SessionID: session.ID, FilePath: "src/b.go", LineNumber: 1,
		Content: "b", Source: "claude", Author: "Claude", CreatedAt: time.Now(),
	}))

	req := httptest.NewRequest("GET", "/comments?filePath=src%2Fa.go", nil)
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.ListReviewComments(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var comments []*models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &comments))
	assert.Len(t, comments, 1)
	assert.Equal(t, "src/a.go", comments[0].FilePath)
}

func TestListReviewComments_SessionNotFound(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "repo-1", repoPath)

	req := httptest.NewRequest("GET", "/comments", nil)
	req = withChiContext(req, map[string]string{"id": "repo-1", "sessionId": "nonexistent"})
	w := httptest.NewRecorder()

	h.ListReviewComments(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestListReviewComments_Empty(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	req := httptest.NewRequest("GET", "/comments", nil)
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.ListReviewComments(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var comments []*models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &comments))
	assert.Empty(t, comments)
}

// ============================================================================
// CreateReviewComment Tests
// ============================================================================

func TestCreateReviewComment_Success(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	body, _ := json.Marshal(CreateReviewCommentRequest{
		FilePath:   "src/main.go",
		LineNumber: 10,
		Title:      "Bug found",
		Content:    "Missing null check before dereference",
		Source:     "claude",
		Author:     "Claude",
		Severity:   "error",
	})
	req := httptest.NewRequest("POST", "/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.CreateReviewComment(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var comment models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &comment))
	assert.NotEmpty(t, comment.ID)
	assert.Equal(t, session.ID, comment.SessionID)
	assert.Equal(t, "src/main.go", comment.FilePath)
	assert.Equal(t, 10, comment.LineNumber)
	assert.Equal(t, "Bug found", comment.Title)
	assert.Equal(t, "Missing null check before dereference", comment.Content)
	assert.Equal(t, "claude", comment.Source)
	assert.Equal(t, "Claude", comment.Author)
	assert.Equal(t, "error", comment.Severity)
	assert.False(t, comment.Resolved)
}

func TestCreateReviewComment_WithoutTitle(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	body, _ := json.Marshal(CreateReviewCommentRequest{
		FilePath:   "src/main.go",
		LineNumber: 10,
		Content:    "No title comment",
		Source:     "claude",
		Author:     "Claude",
	})
	req := httptest.NewRequest("POST", "/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.CreateReviewComment(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)
	var comment models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &comment))
	assert.Empty(t, comment.Title)
	assert.Equal(t, "No title comment", comment.Content)
}

func TestCreateReviewComment_AllSeverities(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	severities := []string{"error", "warning", "suggestion", "info"}
	for _, sev := range severities {
		t.Run(sev, func(t *testing.T) {
			body, _ := json.Marshal(CreateReviewCommentRequest{
				FilePath:   "src/main.go",
				LineNumber: 1,
				Content:    "Test " + sev,
				Source:     "claude",
				Author:     "Claude",
				Severity:   sev,
			})
			req := httptest.NewRequest("POST", "/comments", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
			w := httptest.NewRecorder()

			h.CreateReviewComment(w, req)
			assert.Equal(t, http.StatusCreated, w.Code, "severity %s should be accepted", sev)
		})
	}
}

func TestCreateReviewComment_InvalidSeverity(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	body, _ := json.Marshal(CreateReviewCommentRequest{
		FilePath:   "src/main.go",
		LineNumber: 1,
		Content:    "Invalid severity",
		Source:     "claude",
		Author:     "Claude",
		Severity:   "critical",
	})
	req := httptest.NewRequest("POST", "/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.CreateReviewComment(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "severity")
}

func TestCreateReviewComment_MissingFilePath(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	body, _ := json.Marshal(CreateReviewCommentRequest{
		LineNumber: 1,
		Content:    "Missing file path",
		Source:     "claude",
		Author:     "Claude",
	})
	req := httptest.NewRequest("POST", "/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.CreateReviewComment(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "filePath")
}

func TestCreateReviewComment_InvalidLineNumber(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	body, _ := json.Marshal(CreateReviewCommentRequest{
		FilePath:   "src/main.go",
		LineNumber: 0,
		Content:    "Invalid line number",
		Source:     "claude",
		Author:     "Claude",
	})
	req := httptest.NewRequest("POST", "/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.CreateReviewComment(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "lineNumber")
}

func TestCreateReviewComment_MissingContent(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	body, _ := json.Marshal(CreateReviewCommentRequest{
		FilePath:   "src/main.go",
		LineNumber: 1,
		Source:     "claude",
		Author:     "Claude",
	})
	req := httptest.NewRequest("POST", "/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.CreateReviewComment(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "content")
}

func TestCreateReviewComment_InvalidSource(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	body, _ := json.Marshal(CreateReviewCommentRequest{
		FilePath:   "src/main.go",
		LineNumber: 1,
		Content:    "Bad source",
		Source:     "bot",
		Author:     "Bot",
	})
	req := httptest.NewRequest("POST", "/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.CreateReviewComment(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "source")
}

func TestCreateReviewComment_MissingAuthor(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	body, _ := json.Marshal(CreateReviewCommentRequest{
		FilePath:   "src/main.go",
		LineNumber: 1,
		Content:    "No author",
		Source:     "claude",
	})
	req := httptest.NewRequest("POST", "/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.CreateReviewComment(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "author")
}

func TestCreateReviewComment_ContentTooLarge(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	largeContent := make([]byte, 11*1024) // 11KB, exceeds 10KB limit
	for i := range largeContent {
		largeContent[i] = 'a'
	}

	body, _ := json.Marshal(CreateReviewCommentRequest{
		FilePath:   "src/main.go",
		LineNumber: 1,
		Content:    string(largeContent),
		Source:     "claude",
		Author:     "Claude",
	})
	req := httptest.NewRequest("POST", "/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.CreateReviewComment(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "content exceeds")
}

func TestCreateReviewComment_SessionNotFound(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "repo-1", repoPath)

	body, _ := json.Marshal(CreateReviewCommentRequest{
		FilePath:   "src/main.go",
		LineNumber: 1,
		Content:    "Session missing",
		Source:     "claude",
		Author:     "Claude",
	})
	req := httptest.NewRequest("POST", "/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "repo-1", "sessionId": "nonexistent"})
	w := httptest.NewRecorder()

	h.CreateReviewComment(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestCreateReviewComment_InvalidJSON(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	req := httptest.NewRequest("POST", "/comments", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.CreateReviewComment(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// ============================================================================
// GetReviewCommentStats Tests
// ============================================================================

func TestGetReviewCommentStats_Success(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	ctx := context.Background()
	require.NoError(t, h.store.AddReviewComment(ctx, &models.ReviewComment{
		ID: "c1", SessionID: session.ID, FilePath: "src/a.go", LineNumber: 1,
		Content: "a1", Source: "claude", Author: "Claude", CreatedAt: time.Now(),
	}))
	require.NoError(t, h.store.AddReviewComment(ctx, &models.ReviewComment{
		ID: "c2", SessionID: session.ID, FilePath: "src/a.go", LineNumber: 2,
		Content: "a2", Source: "claude", Author: "Claude", Resolved: true, CreatedAt: time.Now(),
	}))

	req := httptest.NewRequest("GET", "/comments/stats", nil)
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.GetReviewCommentStats(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var stats []*models.CommentStats
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &stats))
	require.Len(t, stats, 1)
	assert.Equal(t, "src/a.go", stats[0].FilePath)
	assert.Equal(t, 2, stats[0].Total)
	assert.Equal(t, 1, stats[0].Unresolved)
}

func TestGetReviewCommentStats_Empty(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	req := httptest.NewRequest("GET", "/comments/stats", nil)
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.GetReviewCommentStats(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var stats []*models.CommentStats
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &stats))
	assert.Empty(t, stats)
}

// ============================================================================
// UpdateReviewComment Tests
// ============================================================================

func TestUpdateReviewComment_ResolveComment(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	createTestReviewComment(t, h, session.ID, "comment-1")

	resolved := true
	resolvedBy := "user"
	body, _ := json.Marshal(UpdateReviewCommentRequest{
		Resolved:   &resolved,
		ResolvedBy: &resolvedBy,
	})
	req := httptest.NewRequest("PATCH", "/comments/comment-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID, "commentId": "comment-1"})
	w := httptest.NewRecorder()

	h.UpdateReviewComment(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var comment models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &comment))
	assert.True(t, comment.Resolved)
	assert.NotNil(t, comment.ResolvedAt)
	assert.Equal(t, "user", comment.ResolvedBy)
}

func TestUpdateReviewComment_UpdateTitle(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	createTestReviewComment(t, h, session.ID, "comment-1")

	newTitle := "Updated title"
	body, _ := json.Marshal(UpdateReviewCommentRequest{
		Title: &newTitle,
	})
	req := httptest.NewRequest("PATCH", "/comments/comment-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID, "commentId": "comment-1"})
	w := httptest.NewRecorder()

	h.UpdateReviewComment(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var comment models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &comment))
	assert.Equal(t, "Updated title", comment.Title)
}

func TestUpdateReviewComment_UpdateSeverityToInfo(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	createTestReviewComment(t, h, session.ID, "comment-1")

	infoSeverity := "info"
	body, _ := json.Marshal(UpdateReviewCommentRequest{
		Severity: &infoSeverity,
	})
	req := httptest.NewRequest("PATCH", "/comments/comment-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID, "commentId": "comment-1"})
	w := httptest.NewRecorder()

	h.UpdateReviewComment(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var comment models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &comment))
	assert.Equal(t, "info", comment.Severity)
}

func TestUpdateReviewComment_InvalidSeverity(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	createTestReviewComment(t, h, session.ID, "comment-1")

	invalidSeverity := "critical"
	body, _ := json.Marshal(UpdateReviewCommentRequest{
		Severity: &invalidSeverity,
	})
	req := httptest.NewRequest("PATCH", "/comments/comment-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID, "commentId": "comment-1"})
	w := httptest.NewRecorder()

	h.UpdateReviewComment(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "severity")
}

func TestUpdateReviewComment_CommentNotFound(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	resolved := true
	body, _ := json.Marshal(UpdateReviewCommentRequest{Resolved: &resolved})
	req := httptest.NewRequest("PATCH", "/comments/nonexistent", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID, "commentId": "nonexistent"})
	w := httptest.NewRecorder()

	h.UpdateReviewComment(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestUpdateReviewComment_WrongSession(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session1 := createTestSession(t, s, "session-1", repo.ID)
	session2 := createTestSession(t, s, "session-2", repo.ID)

	createTestReviewComment(t, h, session1.ID, "comment-1")

	resolved := true
	body, _ := json.Marshal(UpdateReviewCommentRequest{Resolved: &resolved})
	req := httptest.NewRequest("PATCH", "/comments/comment-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	// Comment belongs to session-1 but we pass session-2
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session2.ID, "commentId": "comment-1"})
	w := httptest.NewRecorder()

	h.UpdateReviewComment(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestUpdateReviewComment_UnresolveComment(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	comment := createTestReviewComment(t, h, session.ID, "comment-1")

	// First resolve
	ctx := context.Background()
	now := time.Now()
	require.NoError(t, h.store.UpdateReviewComment(ctx, comment.ID, func(c *models.ReviewComment) {
		c.Resolved = true
		c.ResolvedAt = &now
		c.ResolvedBy = "user"
	}))

	// Then unresolve via handler
	unresolve := false
	body, _ := json.Marshal(UpdateReviewCommentRequest{Resolved: &unresolve})
	req := httptest.NewRequest("PATCH", "/comments/comment-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID, "commentId": "comment-1"})
	w := httptest.NewRecorder()

	h.UpdateReviewComment(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	assert.False(t, result.Resolved)
	assert.Nil(t, result.ResolvedAt)
	assert.Empty(t, result.ResolvedBy)
}

// ============================================================================
// DeleteReviewComment Tests
// ============================================================================

func TestDeleteReviewComment_Success(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	createTestReviewComment(t, h, session.ID, "comment-1")

	req := httptest.NewRequest("DELETE", "/comments/comment-1", nil)
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID, "commentId": "comment-1"})
	w := httptest.NewRecorder()

	h.DeleteReviewComment(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)

	// Verify deleted
	ctx := context.Background()
	got, err := h.store.GetReviewComment(ctx, "comment-1")
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestDeleteReviewComment_NotFound(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	req := httptest.NewRequest("DELETE", "/comments/nonexistent", nil)
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID, "commentId": "nonexistent"})
	w := httptest.NewRecorder()

	h.DeleteReviewComment(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestDeleteReviewComment_WrongSession(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session1 := createTestSession(t, s, "session-1", repo.ID)
	session2 := createTestSession(t, s, "session-2", repo.ID)

	createTestReviewComment(t, h, session1.ID, "comment-1")

	// Try to delete with wrong session
	req := httptest.NewRequest("DELETE", "/comments/comment-1", nil)
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session2.ID, "commentId": "comment-1"})
	w := httptest.NewRecorder()

	h.DeleteReviewComment(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

// ============================================================================
// Additional Edge Case Tests
// ============================================================================

func TestUpdateReviewComment_UpdateContent(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	createTestReviewComment(t, h, session.ID, "comment-1")

	newContent := "Updated content via PATCH"
	body, _ := json.Marshal(UpdateReviewCommentRequest{
		Content: &newContent,
	})
	req := httptest.NewRequest("PATCH", "/comments/comment-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID, "commentId": "comment-1"})
	w := httptest.NewRecorder()

	h.UpdateReviewComment(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var comment models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &comment))
	assert.Equal(t, "Updated content via PATCH", comment.Content)
}

func TestUpdateReviewComment_UpdateMultipleFields(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	createTestReviewComment(t, h, session.ID, "comment-1")

	newTitle := "New title"
	newContent := "New content"
	newSeverity := "warning"
	resolved := true
	resolvedBy := "user"
	body, _ := json.Marshal(UpdateReviewCommentRequest{
		Title:      &newTitle,
		Content:    &newContent,
		Severity:   &newSeverity,
		Resolved:   &resolved,
		ResolvedBy: &resolvedBy,
	})
	req := httptest.NewRequest("PATCH", "/comments/comment-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID, "commentId": "comment-1"})
	w := httptest.NewRecorder()

	h.UpdateReviewComment(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var comment models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &comment))
	assert.Equal(t, "New title", comment.Title)
	assert.Equal(t, "New content", comment.Content)
	assert.Equal(t, "warning", comment.Severity)
	assert.True(t, comment.Resolved)
	assert.Equal(t, "user", comment.ResolvedBy)
}

func TestCreateReviewComment_SpecialCharacters(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	body, _ := json.Marshal(CreateReviewCommentRequest{
		FilePath:   "src/app.tsx",
		LineNumber: 1,
		Title:      `Special chars: "quotes" <tags> & 'apos'`,
		Content:    "Content with\nnewlines\tand\ttabs; also `backticks` and $variables",
		Source:     "claude",
		Author:     "Claude",
		Severity:   "info",
	})
	req := httptest.NewRequest("POST", "/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.CreateReviewComment(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)
	var comment models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &comment))
	assert.Contains(t, comment.Title, `"quotes"`)
	assert.Contains(t, comment.Title, `<tags>`)
	assert.Contains(t, comment.Content, "newlines")
}

func TestCreateReviewComment_WithTitle(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	body, _ := json.Marshal(CreateReviewCommentRequest{
		FilePath:   "src/app.tsx",
		LineNumber: 42,
		Title:      "Potential memory leak",
		Content:    "This event listener is never cleaned up in the useEffect return.",
		Source:     "claude",
		Author:     "Claude",
		Severity:   "warning",
	})
	req := httptest.NewRequest("POST", "/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.CreateReviewComment(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)
	var comment models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &comment))
	assert.Equal(t, "Potential memory leak", comment.Title)
	assert.Equal(t, "This event listener is never cleaned up in the useEffect return.", comment.Content)
	assert.Equal(t, "warning", comment.Severity)
}

func TestListReviewComments_MultipleComments(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	createTestReviewComment(t, h, session.ID, "comment-1")
	createTestReviewComment(t, h, session.ID, "comment-2")
	createTestReviewComment(t, h, session.ID, "comment-3")

	req := httptest.NewRequest("GET", "/comments", nil)
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.ListReviewComments(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var comments []models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &comments))
	assert.Len(t, comments, 3)
}

func TestListReviewComments_SessionIsolation(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session1 := createTestSession(t, s, "session-1", repo.ID)
	session2 := createTestSession(t, s, "session-2", repo.ID)

	createTestReviewComment(t, h, session1.ID, "comment-1")
	createTestReviewComment(t, h, session1.ID, "comment-2")
	createTestReviewComment(t, h, session2.ID, "comment-3")

	// List for session 1
	req := httptest.NewRequest("GET", "/comments", nil)
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session1.ID})
	w := httptest.NewRecorder()
	h.ListReviewComments(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var comments1 []models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &comments1))
	assert.Len(t, comments1, 2)

	// List for session 2
	req2 := httptest.NewRequest("GET", "/comments", nil)
	req2 = withChiContext(req2, map[string]string{"id": repo.ID, "sessionId": session2.ID})
	w2 := httptest.NewRecorder()
	h.ListReviewComments(w2, req2)

	assert.Equal(t, http.StatusOK, w2.Code)
	var comments2 []models.ReviewComment
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &comments2))
	assert.Len(t, comments2, 1)
}

func TestGetReviewCommentStats_WithMixedResolved(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	c1 := createTestReviewComment(t, h, session.ID, "comment-1")
	createTestReviewComment(t, h, session.ID, "comment-2")

	// Resolve one
	ctx := context.Background()
	now := time.Now()
	require.NoError(t, h.store.UpdateReviewComment(ctx, c1.ID, func(c *models.ReviewComment) {
		c.Resolved = true
		c.ResolvedAt = &now
		c.ResolvedBy = "user"
	}))

	req := httptest.NewRequest("GET", "/comments/stats", nil)
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID})
	w := httptest.NewRecorder()

	h.GetReviewCommentStats(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var stats []map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &stats))
	assert.Len(t, stats, 1)
	assert.Equal(t, float64(2), stats[0]["total"])
	assert.Equal(t, float64(1), stats[0]["unresolved"])
}

func TestUpdateReviewComment_EmptyBody(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)
	session := createTestSession(t, s, "session-1", repo.ID)

	comment := createTestReviewComment(t, h, session.ID, "comment-1")

	body := []byte(`{}`)
	req := httptest.NewRequest("PATCH", "/comments/comment-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": repo.ID, "sessionId": session.ID, "commentId": comment.ID})
	w := httptest.NewRecorder()

	h.UpdateReviewComment(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result models.ReviewComment
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	assert.Equal(t, comment.Content, result.Content)
}
