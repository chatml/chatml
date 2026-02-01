package store

import (
	"context"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// createTestReviewComment creates a review comment with sensible defaults
func createTestReviewComment(t *testing.T, s *SQLiteStore, id, sessionID string) *models.ReviewComment {
	t.Helper()
	ctx := context.Background()
	comment := &models.ReviewComment{
		ID:         id,
		SessionID:  sessionID,
		FilePath:   "src/main.go",
		LineNumber: 42,
		Title:      "Test issue: " + id,
		Content:    "This is a test review comment for " + id,
		Source:     models.CommentSourceClaude,
		Author:     "Claude",
		Severity:   models.CommentSeverityWarning,
		CreatedAt:  time.Now(),
		Resolved:   false,
	}
	require.NoError(t, s.AddReviewComment(ctx, comment))
	return comment
}

// ============================================================================
// AddReviewComment Tests
// ============================================================================

func TestAddReviewComment_Success(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	comment := &models.ReviewComment{
		ID:         "comment-1",
		SessionID:  session.ID,
		FilePath:   "src/main.go",
		LineNumber: 10,
		Title:      "Potential memory leak",
		Content:    "useEffect cleanup function not properly disposing event listener",
		Source:     models.CommentSourceClaude,
		Author:     "Claude",
		Severity:   models.CommentSeverityError,
		CreatedAt:  time.Now(),
		Resolved:   false,
	}

	err := s.AddReviewComment(ctx, comment)
	require.NoError(t, err)

	// Verify it was stored
	got, err := s.GetReviewComment(ctx, "comment-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "comment-1", got.ID)
	assert.Equal(t, session.ID, got.SessionID)
	assert.Equal(t, "src/main.go", got.FilePath)
	assert.Equal(t, 10, got.LineNumber)
	assert.Equal(t, "Potential memory leak", got.Title)
	assert.Equal(t, "useEffect cleanup function not properly disposing event listener", got.Content)
	assert.Equal(t, models.CommentSourceClaude, got.Source)
	assert.Equal(t, "Claude", got.Author)
	assert.Equal(t, models.CommentSeverityError, got.Severity)
	assert.False(t, got.Resolved)
	assert.Nil(t, got.ResolvedAt)
	assert.Empty(t, got.ResolvedBy)
}

func TestAddReviewComment_WithoutTitle(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	comment := &models.ReviewComment{
		ID:        "comment-1",
		SessionID: session.ID,
		FilePath:  "src/main.go",
		LineNumber: 5,
		Content:   "Just a content-only comment",
		Source:    models.CommentSourceUser,
		Author:    "User",
		CreatedAt: time.Now(),
	}

	err := s.AddReviewComment(ctx, comment)
	require.NoError(t, err)

	got, err := s.GetReviewComment(ctx, "comment-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Empty(t, got.Title)
	assert.Equal(t, "Just a content-only comment", got.Content)
}

func TestAddReviewComment_WithoutSeverity(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	comment := &models.ReviewComment{
		ID:         "comment-1",
		SessionID:  session.ID,
		FilePath:   "src/main.go",
		LineNumber: 1,
		Content:    "No severity",
		Source:     models.CommentSourceClaude,
		Author:     "Claude",
		CreatedAt:  time.Now(),
	}

	err := s.AddReviewComment(ctx, comment)
	require.NoError(t, err)

	got, err := s.GetReviewComment(ctx, "comment-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Empty(t, got.Severity)
}

func TestAddReviewComment_AllSeverityLevels(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	severities := []string{
		models.CommentSeverityError,
		models.CommentSeverityWarning,
		models.CommentSeveritySuggestion,
		models.CommentSeverityInfo,
	}

	for i, sev := range severities {
		t.Run(sev, func(t *testing.T) {
			comment := &models.ReviewComment{
				ID:         "comment-" + sev,
				SessionID:  session.ID,
				FilePath:   "src/file.go",
				LineNumber: i + 1,
				Content:    "Comment with severity " + sev,
				Source:     models.CommentSourceClaude,
				Author:     "Claude",
				Severity:   sev,
				CreatedAt:  time.Now(),
			}
			require.NoError(t, s.AddReviewComment(ctx, comment))

			got, err := s.GetReviewComment(ctx, comment.ID)
			require.NoError(t, err)
			assert.Equal(t, sev, got.Severity)
		})
	}
}

func TestAddReviewComment_InvalidSession(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	comment := &models.ReviewComment{
		ID:         "comment-1",
		SessionID:  "nonexistent-session",
		FilePath:   "src/main.go",
		LineNumber: 1,
		Content:    "This should fail",
		Source:     models.CommentSourceClaude,
		Author:     "Claude",
		CreatedAt:  time.Now(),
	}

	err := s.AddReviewComment(ctx, comment)
	assert.Error(t, err, "should fail with FK constraint violation")
}

// ============================================================================
// GetReviewComment Tests
// ============================================================================

func TestGetReviewComment_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	got, err := s.GetReviewComment(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestGetReviewComment_WithResolvedState(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	comment := createTestReviewComment(t, s, "comment-1", session.ID)

	// Resolve the comment
	now := time.Now()
	require.NoError(t, s.UpdateReviewComment(ctx, comment.ID, func(c *models.ReviewComment) {
		c.Resolved = true
		c.ResolvedAt = &now
		c.ResolvedBy = "user"
	}))

	got, err := s.GetReviewComment(ctx, "comment-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.True(t, got.Resolved)
	assert.NotNil(t, got.ResolvedAt)
	assert.Equal(t, "user", got.ResolvedBy)
}

// ============================================================================
// ListReviewComments Tests
// ============================================================================

func TestListReviewComments_Empty(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	comments, err := s.ListReviewComments(ctx, session.ID)
	require.NoError(t, err)
	assert.Empty(t, comments)
}

func TestListReviewComments_SortedByFileAndLine(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	// Add comments in mixed order
	comments := []*models.ReviewComment{
		{ID: "c3", SessionID: session.ID, FilePath: "src/b.go", LineNumber: 10, Content: "third", Source: "claude", Author: "Claude", CreatedAt: time.Now()},
		{ID: "c1", SessionID: session.ID, FilePath: "src/a.go", LineNumber: 5, Content: "first", Source: "claude", Author: "Claude", CreatedAt: time.Now()},
		{ID: "c2", SessionID: session.ID, FilePath: "src/a.go", LineNumber: 20, Content: "second", Source: "claude", Author: "Claude", CreatedAt: time.Now()},
	}
	for _, c := range comments {
		require.NoError(t, s.AddReviewComment(ctx, c))
	}

	result, err := s.ListReviewComments(ctx, session.ID)
	require.NoError(t, err)
	require.Len(t, result, 3)

	// Should be sorted by file_path, then line_number
	assert.Equal(t, "c1", result[0].ID) // src/a.go:5
	assert.Equal(t, "c2", result[1].ID) // src/a.go:20
	assert.Equal(t, "c3", result[2].ID) // src/b.go:10
}

func TestListReviewComments_OnlyForSession(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session1 := createTestSession(t, s, "session-1", repo.ID)
	session2 := createTestSession(t, s, "session-2", repo.ID)

	createTestReviewComment(t, s, "c1", session1.ID)
	createTestReviewComment(t, s, "c2", session1.ID)
	createTestReviewComment(t, s, "c3", session2.ID)

	result1, err := s.ListReviewComments(ctx, session1.ID)
	require.NoError(t, err)
	assert.Len(t, result1, 2)

	result2, err := s.ListReviewComments(ctx, session2.ID)
	require.NoError(t, err)
	assert.Len(t, result2, 1)
}

func TestListReviewComments_IncludesTitle(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	comment := &models.ReviewComment{
		ID:         "c1",
		SessionID:  session.ID,
		FilePath:   "src/main.go",
		LineNumber: 1,
		Title:      "Important issue",
		Content:    "Details here",
		Source:     "claude",
		Author:     "Claude",
		Severity:   models.CommentSeverityError,
		CreatedAt:  time.Now(),
	}
	require.NoError(t, s.AddReviewComment(ctx, comment))

	result, err := s.ListReviewComments(ctx, session.ID)
	require.NoError(t, err)
	require.Len(t, result, 1)
	assert.Equal(t, "Important issue", result[0].Title)
	assert.Equal(t, "Details here", result[0].Content)
}

// ============================================================================
// ListReviewCommentsForFile Tests
// ============================================================================

func TestListReviewCommentsForFile_FiltersCorrectly(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	comments := []*models.ReviewComment{
		{ID: "c1", SessionID: session.ID, FilePath: "src/a.go", LineNumber: 5, Content: "a1", Source: "claude", Author: "Claude", CreatedAt: time.Now()},
		{ID: "c2", SessionID: session.ID, FilePath: "src/b.go", LineNumber: 10, Content: "b1", Source: "claude", Author: "Claude", CreatedAt: time.Now()},
		{ID: "c3", SessionID: session.ID, FilePath: "src/a.go", LineNumber: 15, Content: "a2", Source: "claude", Author: "Claude", CreatedAt: time.Now()},
	}
	for _, c := range comments {
		require.NoError(t, s.AddReviewComment(ctx, c))
	}

	result, err := s.ListReviewCommentsForFile(ctx, session.ID, "src/a.go")
	require.NoError(t, err)
	require.Len(t, result, 2)
	assert.Equal(t, "c1", result[0].ID)
	assert.Equal(t, "c3", result[1].ID)

	result2, err := s.ListReviewCommentsForFile(ctx, session.ID, "src/b.go")
	require.NoError(t, err)
	assert.Len(t, result2, 1)

	// Non-existent file returns empty
	result3, err := s.ListReviewCommentsForFile(ctx, session.ID, "src/nonexistent.go")
	require.NoError(t, err)
	assert.Empty(t, result3)
}

func TestListReviewCommentsForFile_SortedByLineNumber(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	comments := []*models.ReviewComment{
		{ID: "c2", SessionID: session.ID, FilePath: "src/main.go", LineNumber: 100, Content: "second", Source: "claude", Author: "Claude", CreatedAt: time.Now()},
		{ID: "c1", SessionID: session.ID, FilePath: "src/main.go", LineNumber: 10, Content: "first", Source: "claude", Author: "Claude", CreatedAt: time.Now()},
	}
	for _, c := range comments {
		require.NoError(t, s.AddReviewComment(ctx, c))
	}

	result, err := s.ListReviewCommentsForFile(ctx, session.ID, "src/main.go")
	require.NoError(t, err)
	require.Len(t, result, 2)
	assert.Equal(t, "c1", result[0].ID)
	assert.Equal(t, "c2", result[1].ID)
}

// ============================================================================
// GetReviewCommentStats Tests
// ============================================================================

func TestGetReviewCommentStats_Empty(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	stats, err := s.GetReviewCommentStats(ctx, session.ID)
	require.NoError(t, err)
	assert.Empty(t, stats)
}

func TestGetReviewCommentStats_CountsCorrectly(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	// Add 3 comments to file A (1 resolved), 1 to file B (unresolved)
	comments := []*models.ReviewComment{
		{ID: "c1", SessionID: session.ID, FilePath: "src/a.go", LineNumber: 1, Content: "a1", Source: "claude", Author: "Claude", CreatedAt: time.Now()},
		{ID: "c2", SessionID: session.ID, FilePath: "src/a.go", LineNumber: 2, Content: "a2", Source: "claude", Author: "Claude", CreatedAt: time.Now()},
		{ID: "c3", SessionID: session.ID, FilePath: "src/a.go", LineNumber: 3, Content: "a3", Source: "claude", Author: "Claude", Resolved: true, CreatedAt: time.Now()},
		{ID: "c4", SessionID: session.ID, FilePath: "src/b.go", LineNumber: 1, Content: "b1", Source: "claude", Author: "Claude", CreatedAt: time.Now()},
	}
	for _, c := range comments {
		require.NoError(t, s.AddReviewComment(ctx, c))
	}

	stats, err := s.GetReviewCommentStats(ctx, session.ID)
	require.NoError(t, err)
	require.Len(t, stats, 2)

	// Build a map for easy lookup
	statsMap := make(map[string]*models.CommentStats)
	for _, s := range stats {
		statsMap[s.FilePath] = s
	}

	assert.Equal(t, 3, statsMap["src/a.go"].Total)
	assert.Equal(t, 2, statsMap["src/a.go"].Unresolved)
	assert.Equal(t, 1, statsMap["src/b.go"].Total)
	assert.Equal(t, 1, statsMap["src/b.go"].Unresolved)
}

// ============================================================================
// UpdateReviewComment Tests
// ============================================================================

func TestUpdateReviewComment_ResolveComment(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	createTestReviewComment(t, s, "comment-1", session.ID)

	now := time.Now()
	err := s.UpdateReviewComment(ctx, "comment-1", func(c *models.ReviewComment) {
		c.Resolved = true
		c.ResolvedAt = &now
		c.ResolvedBy = "user"
	})
	require.NoError(t, err)

	got, err := s.GetReviewComment(ctx, "comment-1")
	require.NoError(t, err)
	assert.True(t, got.Resolved)
	assert.NotNil(t, got.ResolvedAt)
	assert.Equal(t, "user", got.ResolvedBy)
}

func TestUpdateReviewComment_UnresolveComment(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	createTestReviewComment(t, s, "comment-1", session.ID)

	// First resolve
	now := time.Now()
	require.NoError(t, s.UpdateReviewComment(ctx, "comment-1", func(c *models.ReviewComment) {
		c.Resolved = true
		c.ResolvedAt = &now
		c.ResolvedBy = "user"
	}))

	// Then unresolve
	require.NoError(t, s.UpdateReviewComment(ctx, "comment-1", func(c *models.ReviewComment) {
		c.Resolved = false
		c.ResolvedAt = nil
		c.ResolvedBy = ""
	}))

	got, err := s.GetReviewComment(ctx, "comment-1")
	require.NoError(t, err)
	assert.False(t, got.Resolved)
	assert.Nil(t, got.ResolvedAt)
	assert.Empty(t, got.ResolvedBy)
}

func TestUpdateReviewComment_UpdateContent(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	createTestReviewComment(t, s, "comment-1", session.ID)

	err := s.UpdateReviewComment(ctx, "comment-1", func(c *models.ReviewComment) {
		c.Title = "Updated title"
		c.Content = "Updated content"
		c.Severity = models.CommentSeverityError
	})
	require.NoError(t, err)

	got, err := s.GetReviewComment(ctx, "comment-1")
	require.NoError(t, err)
	assert.Equal(t, "Updated title", got.Title)
	assert.Equal(t, "Updated content", got.Content)
	assert.Equal(t, models.CommentSeverityError, got.Severity)
}

func TestUpdateReviewComment_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	err := s.UpdateReviewComment(ctx, "nonexistent", func(c *models.ReviewComment) {
		c.Content = "should fail"
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

// ============================================================================
// DeleteReviewComment Tests
// ============================================================================

func TestDeleteReviewComment_Success(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	createTestReviewComment(t, s, "comment-1", session.ID)

	err := s.DeleteReviewComment(ctx, "comment-1")
	require.NoError(t, err)

	got, err := s.GetReviewComment(ctx, "comment-1")
	require.NoError(t, err)
	assert.Nil(t, got, "comment should be deleted")
}

func TestDeleteReviewComment_NonexistentIsNoOp(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Delete of non-existent ID should not error
	err := s.DeleteReviewComment(ctx, "nonexistent")
	require.NoError(t, err)
}

// ============================================================================
// DeleteReviewCommentsForSession Tests
// ============================================================================

func TestDeleteReviewCommentsForSession_DeletesAll(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	createTestReviewComment(t, s, "c1", session.ID)
	createTestReviewComment(t, s, "c2", session.ID)
	createTestReviewComment(t, s, "c3", session.ID)

	err := s.DeleteReviewCommentsForSession(ctx, session.ID)
	require.NoError(t, err)

	comments, err := s.ListReviewComments(ctx, session.ID)
	require.NoError(t, err)
	assert.Empty(t, comments)
}

func TestDeleteReviewCommentsForSession_DoesNotAffectOtherSessions(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session1 := createTestSession(t, s, "session-1", repo.ID)
	session2 := createTestSession(t, s, "session-2", repo.ID)

	createTestReviewComment(t, s, "c1", session1.ID)
	createTestReviewComment(t, s, "c2", session2.ID)

	require.NoError(t, s.DeleteReviewCommentsForSession(ctx, session1.ID))

	// Session 1 should be empty
	comments1, err := s.ListReviewComments(ctx, session1.ID)
	require.NoError(t, err)
	assert.Empty(t, comments1)

	// Session 2 should still have its comment
	comments2, err := s.ListReviewComments(ctx, session2.ID)
	require.NoError(t, err)
	assert.Len(t, comments2, 1)
}

// ============================================================================
// Title Migration Tests
// ============================================================================

func TestReviewComment_TitleFieldRoundTrip(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "session-1", repo.ID)

	// Create with title
	comment := &models.ReviewComment{
		ID:         "c1",
		SessionID:  session.ID,
		FilePath:   "src/main.go",
		LineNumber: 1,
		Title:      "Memory leak detected",
		Content:    "The event listener is never removed in the cleanup function",
		Source:     models.CommentSourceClaude,
		Author:     "Claude",
		Severity:   models.CommentSeverityError,
		CreatedAt:  time.Now(),
	}
	require.NoError(t, s.AddReviewComment(ctx, comment))

	// Read back
	got, err := s.GetReviewComment(ctx, "c1")
	require.NoError(t, err)
	assert.Equal(t, "Memory leak detected", got.Title)

	// Update title
	require.NoError(t, s.UpdateReviewComment(ctx, "c1", func(c *models.ReviewComment) {
		c.Title = "Memory leak fixed"
	}))

	got2, err := s.GetReviewComment(ctx, "c1")
	require.NoError(t, err)
	assert.Equal(t, "Memory leak fixed", got2.Title)

	// Verify title shows in list
	list, err := s.ListReviewComments(ctx, session.ID)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, "Memory leak fixed", list[0].Title)

	// Verify title shows in file list
	fileList, err := s.ListReviewCommentsForFile(ctx, session.ID, "src/main.go")
	require.NoError(t, err)
	require.Len(t, fileList, 1)
	assert.Equal(t, "Memory leak fixed", fileList[0].Title)
}
