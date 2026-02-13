package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================================
// Repo Tests
// ============================================================================

func TestAddRepo_Success(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	repo := &models.Repo{
		ID:        "repo-123",
		Name:      "test-repo",
		Path:      "/path/to/repo",
		Branch:    "main",
		CreatedAt: time.Now(),
	}

	require.NoError(t, s.AddRepo(ctx, repo))

	got, err := s.GetRepo(ctx, "repo-123")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, repo.ID, got.ID)
	assert.Equal(t, repo.Name, got.Name)
	assert.Equal(t, repo.Path, got.Path)
	assert.Equal(t, repo.Branch, got.Branch)
}

func TestAddRepo_Upsert(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	// Add initial repo
	repo := &models.Repo{
		ID:        "repo-123",
		Name:      "original-name",
		Path:      "/original/path",
		Branch:    "main",
		CreatedAt: time.Now(),
	}
	require.NoError(t, s.AddRepo(ctx, repo))

	// Add again with same ID but different data (upsert)
	repo2 := &models.Repo{
		ID:        "repo-123",
		Name:      "updated-name",
		Path:      "/updated/path",
		Branch:    "develop",
		CreatedAt: time.Now(),
	}
	require.NoError(t, s.AddRepo(ctx, repo2))

	// Should have updated values
	got, err := s.GetRepo(ctx, "repo-123")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "updated-name", got.Name)
	assert.Equal(t, "/updated/path", got.Path)
	assert.Equal(t, "develop", got.Branch)

	// Should still be only one repo
	repos, err := s.ListRepos(ctx)
	require.NoError(t, err)
	assert.Len(t, repos, 1)
}

func TestGetRepo_Exists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "repo-1")

	got, err := s.GetRepo(ctx, "repo-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "repo-1", got.ID)
}

func TestGetRepo_NotExists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	got, err := s.GetRepo(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestGetRepoByPath_Exists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	repo := createTestRepo(t, s, "repo-1")

	got, err := s.GetRepoByPath(ctx, repo.Path)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "repo-1", got.ID)
}

func TestGetRepoByPath_NotExists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	got, err := s.GetRepoByPath(ctx, "/nonexistent/path")
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestListRepos_Empty(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	repos, err := s.ListRepos(ctx)
	require.NoError(t, err)
	assert.NotNil(t, repos)
	assert.Empty(t, repos)
}

func TestListRepos_Multiple(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	createTestRepo(t, s, "repo-1")
	createTestRepo(t, s, "repo-2")
	createTestRepo(t, s, "repo-3")

	repos, err := s.ListRepos(ctx)
	require.NoError(t, err)
	assert.Len(t, repos, 3)

	// Collect IDs
	ids := make(map[string]bool)
	for _, r := range repos {
		ids[r.ID] = true
	}
	assert.True(t, ids["repo-1"])
	assert.True(t, ids["repo-2"])
	assert.True(t, ids["repo-3"])
}

func TestDeleteRepo_Exists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "repo-1")

	// Verify exists
	got, err := s.GetRepo(ctx, "repo-1")
	require.NoError(t, err)
	require.NotNil(t, got)

	require.NoError(t, s.DeleteRepo(ctx, "repo-1"))

	// Verify deleted
	got, err = s.GetRepo(ctx, "repo-1")
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestDeleteRepo_NotExists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	// Should not panic or error
	require.NoError(t, s.DeleteRepo(ctx, "nonexistent"))
}

func TestDeleteRepo_CascadesSessions(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	// Create repo and session
	createTestRepo(t, s, "repo-1")
	createTestSession(t, s, "session-1", "repo-1")

	// Verify session exists
	got, err := s.GetSession(ctx, "session-1")
	require.NoError(t, err)
	require.NotNil(t, got)

	// Delete repo
	require.NoError(t, s.DeleteRepo(ctx, "repo-1"))

	// Session should be cascade deleted
	got, err = s.GetSession(ctx, "session-1")
	require.NoError(t, err)
	assert.Nil(t, got)
}

// ============================================================================
// Session Tests
// ============================================================================

func TestAddSession_Success(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	session := &models.Session{
		ID:               "sess-1",
		WorkspaceID:      "ws-1",
		Name:             "My Session",
		Branch:           "feature/test",
		WorktreePath:     "/path/to/.worktrees/sess-1",
		BaseCommitSHA:    "abc123def456",
		Task:             "Write tests",
		Status:           "active",
		AgentID:          "agent-1",
		PRStatus:         "open",
		PRUrl:            "https://github.com/test/pr/1",
		PRNumber:         1,
		HasMergeConflict: true,
		HasCheckFailures: false,
		Pinned:           true,
		Stats: &models.SessionStats{
			Additions: 100,
			Deletions: 50,
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	require.NoError(t, s.AddSession(ctx, session))

	got, err := s.GetSession(ctx, "sess-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "sess-1", got.ID)
	assert.Equal(t, "ws-1", got.WorkspaceID)
	assert.Equal(t, "My Session", got.Name)
	assert.Equal(t, "feature/test", got.Branch)
	assert.Equal(t, "/path/to/.worktrees/sess-1", got.WorktreePath)
	assert.Equal(t, "abc123def456", got.BaseCommitSHA)
	assert.Equal(t, "Write tests", got.Task)
	assert.Equal(t, "active", got.Status)
	assert.Equal(t, "agent-1", got.AgentID)
	assert.Equal(t, "open", got.PRStatus)
	assert.Equal(t, "https://github.com/test/pr/1", got.PRUrl)
	assert.Equal(t, 1, got.PRNumber)
	assert.True(t, got.HasMergeConflict)
	assert.False(t, got.HasCheckFailures)
	assert.True(t, got.Pinned)
	require.NotNil(t, got.Stats)
	assert.Equal(t, 100, got.Stats.Additions)
	assert.Equal(t, 50, got.Stats.Deletions)
}

func TestAddSession_NilStats(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	session := &models.Session{
		ID:          "sess-1",
		WorkspaceID: "ws-1",
		Name:        "Session without stats",
		Status:      "idle",
		Stats:       nil, // No stats
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	require.NoError(t, s.AddSession(ctx, session))

	got, err := s.GetSession(ctx, "sess-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	// Stats should be nil when additions and deletions are both 0
	assert.Nil(t, got.Stats)
}

func TestGetSession_Exists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")

	got, err := s.GetSession(ctx, "sess-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "sess-1", got.ID)
}

func TestGetSession_NotExists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	got, err := s.GetSession(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestListSessions_ByWorkspace(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestRepo(t, s, "ws-2")

	createTestSession(t, s, "s1", "ws-1")
	createTestSession(t, s, "s2", "ws-1")
	createTestSession(t, s, "s3", "ws-2") // Different workspace

	sessions, err := s.ListSessions(ctx, "ws-1", true)
	require.NoError(t, err)
	assert.Len(t, sessions, 2)

	ids := make(map[string]bool)
	for _, sess := range sessions {
		ids[sess.ID] = true
	}
	assert.True(t, ids["s1"])
	assert.True(t, ids["s2"])
	assert.False(t, ids["s3"]) // Should not be included
}

func TestListSessions_PinnedFirst(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	// Create non-pinned session first (should appear second)
	s1 := &models.Session{
		ID:          "s1",
		WorkspaceID: "ws-1",
		Name:        "Not Pinned",
		Status:      "idle",
		Pinned:      false,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, s1))

	// Create pinned session second (should appear first)
	s2 := &models.Session{
		ID:          "s2",
		WorkspaceID: "ws-1",
		Name:        "Pinned",
		Status:      "idle",
		Pinned:      true,
		CreatedAt:   time.Now().Add(-1 * time.Hour), // Older but pinned
		UpdatedAt:   time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, s2))

	sessions, err := s.ListSessions(ctx, "ws-1", true)
	require.NoError(t, err)
	require.Len(t, sessions, 2)

	// Pinned session should be first regardless of creation time
	assert.Equal(t, "s2", sessions[0].ID)
	assert.True(t, sessions[0].Pinned)
	assert.Equal(t, "s1", sessions[1].ID)
	assert.False(t, sessions[1].Pinned)
}

func TestListSessions_Empty(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	sessions, err := s.ListSessions(ctx, "ws-1", true)
	require.NoError(t, err)
	assert.NotNil(t, sessions)
	assert.Empty(t, sessions)
}

func TestListSessions_FilterArchived(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	// Create 3 sessions
	createTestSession(t, s, "s1", "ws-1")
	createTestSession(t, s, "s2", "ws-1")
	createTestSession(t, s, "s3", "ws-1")

	// Archive s2
	require.NoError(t, s.UpdateSession(ctx, "s2", func(sess *models.Session) {
		sess.Archived = true
	}))

	// Test without includeArchived (default: false)
	sessions, err := s.ListSessions(ctx, "ws-1", false)
	require.NoError(t, err)
	assert.Len(t, sessions, 2)
	for _, sess := range sessions {
		assert.False(t, sess.Archived, "Should not include archived sessions")
	}

	// Test with includeArchived=true
	allSessions, err := s.ListSessions(ctx, "ws-1", true)
	require.NoError(t, err)
	assert.Len(t, allSessions, 3)
}

func TestListAllSessions_FilterArchived(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestRepo(t, s, "ws-2")

	// Create sessions across repos
	createTestSession(t, s, "s1", "ws-1")
	createTestSession(t, s, "s2", "ws-1")
	createTestSession(t, s, "s3", "ws-2")

	// Archive s2
	require.NoError(t, s.UpdateSession(ctx, "s2", func(sess *models.Session) {
		sess.Archived = true
	}))

	// Test filtering
	sessions, err := s.ListAllSessions(ctx, false)
	require.NoError(t, err)
	assert.Len(t, sessions, 2)

	allSessions, err := s.ListAllSessions(ctx, true)
	require.NoError(t, err)
	assert.Len(t, allSessions, 3)
}

func TestListAllSessions_ReadsArchivedField(t *testing.T) {
	// This test verifies the archived field is correctly read from DB
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	createTestSession(t, s, "s1", "ws-1")
	require.NoError(t, s.UpdateSession(ctx, "s1", func(sess *models.Session) {
		sess.Archived = true
	}))

	// Fetch via ListAllSessions
	sessions, err := s.ListAllSessions(ctx, true)
	require.NoError(t, err)
	require.Len(t, sessions, 1)

	// Verify archived field is populated correctly
	assert.True(t, sessions[0].Archived, "Archived field should be read from DB")
}

func TestListArchivedSessionDirs(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	// Create three sessions, archive two of them
	createTestSession(t, s, "s1", "ws-1")
	createTestSession(t, s, "s2", "ws-1")
	createTestSession(t, s, "s3", "ws-1")

	// Set worktree paths and archive s1 and s3
	require.NoError(t, s.UpdateSession(ctx, "s1", func(sess *models.Session) {
		sess.WorktreePath = "/worktrees/session-s1"
		sess.Archived = true
	}))
	require.NoError(t, s.UpdateSession(ctx, "s2", func(sess *models.Session) {
		sess.WorktreePath = "/worktrees/session-s2"
	}))
	require.NoError(t, s.UpdateSession(ctx, "s3", func(sess *models.Session) {
		sess.WorktreePath = "/worktrees/session-s3"
		sess.Archived = true
	}))

	dirs, err := s.ListArchivedSessionDirs(ctx)
	require.NoError(t, err)
	assert.Len(t, dirs, 2, "should return only archived sessions")

	// Verify returned data
	dirMap := make(map[string]string)
	for _, d := range dirs {
		dirMap[d.ID] = d.WorktreePath
	}
	assert.Equal(t, "/worktrees/session-s1", dirMap["s1"])
	assert.Equal(t, "/worktrees/session-s3", dirMap["s3"])
	assert.NotContains(t, dirMap, "s2", "non-archived session should not be returned")
}

func TestUpdateSession_SetArchived(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	sess := createTestSession(t, s, "s1", "ws-1")

	// Initially not archived
	assert.False(t, sess.Archived)

	// Archive it
	require.NoError(t, s.UpdateSession(ctx, "s1", func(sess *models.Session) {
		sess.Archived = true
	}))

	// Verify persisted
	fetched, err := s.GetSession(ctx, "s1")
	require.NoError(t, err)
	assert.True(t, fetched.Archived)

	// Unarchive it
	require.NoError(t, s.UpdateSession(ctx, "s1", func(sess *models.Session) {
		sess.Archived = false
	}))

	fetched, err = s.GetSession(ctx, "s1")
	require.NoError(t, err)
	assert.False(t, fetched.Archived)
}

func TestUpdateSession_SetPinned(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	sess := createTestSession(t, s, "s1", "ws-1")

	// Initially not pinned
	assert.False(t, sess.Pinned)

	// Pin it
	require.NoError(t, s.UpdateSession(ctx, "s1", func(sess *models.Session) {
		sess.Pinned = true
	}))

	// Verify persisted
	fetched, err := s.GetSession(ctx, "s1")
	require.NoError(t, err)
	assert.True(t, fetched.Pinned)

	// Unpin it
	require.NoError(t, s.UpdateSession(ctx, "s1", func(sess *models.Session) {
		sess.Pinned = false
	}))

	fetched, err = s.GetSession(ctx, "s1")
	require.NoError(t, err)
	assert.False(t, fetched.Pinned)
}

func TestUpdateSession_PartialUpdate(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")

	// Update only name
	require.NoError(t, s.UpdateSession(ctx, "sess-1", func(sess *models.Session) {
		sess.Name = "Updated Name"
	}))

	got, err := s.GetSession(ctx, "sess-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "Updated Name", got.Name)
	// Other fields should be unchanged
	assert.Equal(t, "feature/sess-1", got.Branch)
}

func TestUpdateSession_NotExists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	// Should not error
	require.NoError(t, s.UpdateSession(ctx, "nonexistent", func(sess *models.Session) {
		sess.Name = "Updated"
	}))
}

func TestDeleteSession_Cascades(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Verify conversation exists
	got, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)

	require.NoError(t, s.DeleteSession(ctx, "sess-1"))

	// Session and conversation should be deleted
	sess, err := s.GetSession(ctx, "sess-1")
	require.NoError(t, err)
	assert.Nil(t, sess)
	conv, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	assert.Nil(t, conv)
}

// ============================================================================
// SessionExistsByName Tests
// ============================================================================

func TestSessionExistsByName_Exists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")

	exists, err := s.SessionExistsByName(ctx, "ws-1", "test-session-sess-1")
	require.NoError(t, err)
	assert.True(t, exists)
}

func TestSessionExistsByName_NotExists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	exists, err := s.SessionExistsByName(ctx, "ws-1", "nonexistent")
	require.NoError(t, err)
	assert.False(t, exists)
}

func TestSessionExistsByName_WrongWorkspace(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestRepo(t, s, "ws-2")
	createTestSession(t, s, "sess-1", "ws-1")

	// Session belongs to ws-1, should not be found in ws-2
	exists, err := s.SessionExistsByName(ctx, "ws-2", "test-session-sess-1")
	require.NoError(t, err)
	assert.False(t, exists)
}

func TestSessionExistsByName_CaseSensitive(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	session := &models.Session{
		ID:          "sess-1",
		WorkspaceID: "ws-1",
		Name:        "Tokyo",
		Status:      "idle",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))

	// Exact match
	exists, err := s.SessionExistsByName(ctx, "ws-1", "Tokyo")
	require.NoError(t, err)
	assert.True(t, exists)

	// Different case should not match (default BINARY collation is case-sensitive)
	exists, err = s.SessionExistsByName(ctx, "ws-1", "tokyo")
	require.NoError(t, err)
	assert.False(t, exists)
}

func TestSessionExistsByName_AfterDeletion(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")

	// Exists before deletion
	exists, err := s.SessionExistsByName(ctx, "ws-1", "test-session-sess-1")
	require.NoError(t, err)
	assert.True(t, exists)

	// Delete the session
	require.NoError(t, s.DeleteSession(ctx, "sess-1"))

	// Should no longer exist
	exists, err = s.SessionExistsByName(ctx, "ws-1", "test-session-sess-1")
	require.NoError(t, err)
	assert.False(t, exists)
}

// ============================================================================
// Agent Tests
// ============================================================================

func TestAddAgent_Success(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "repo-1")

	agent := &models.Agent{
		ID:        "agent-1",
		RepoID:    "repo-1",
		Task:      "Write code",
		Status:    string(models.StatusRunning),
		Worktree:  "/path/to/.worktrees/agent-1",
		Branch:    "agent/agent-1",
		CreatedAt: time.Now(),
	}

	require.NoError(t, s.AddAgent(ctx, agent))

	got, err := s.GetAgent(ctx, "agent-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "agent-1", got.ID)
	assert.Equal(t, "repo-1", got.RepoID)
	assert.Equal(t, "Write code", got.Task)
	assert.Equal(t, string(models.StatusRunning), got.Status)
	assert.Equal(t, "/path/to/.worktrees/agent-1", got.Worktree)
	assert.Equal(t, "agent/agent-1", got.Branch)
}

func TestGetAgent_NotExists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	got, err := s.GetAgent(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestListAgents_ByRepo(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "repo-1")
	createTestRepo(t, s, "repo-2")

	createTestAgent(t, s, "a1", "repo-1")
	createTestAgent(t, s, "a2", "repo-1")
	createTestAgent(t, s, "a3", "repo-2") // Different repo

	agents, err := s.ListAgents(ctx, "repo-1")
	require.NoError(t, err)
	assert.Len(t, agents, 2)

	ids := make(map[string]bool)
	for _, a := range agents {
		ids[a.ID] = true
	}
	assert.True(t, ids["a1"])
	assert.True(t, ids["a2"])
	assert.False(t, ids["a3"])
}

func TestListAgents_Empty(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "repo-1")

	agents, err := s.ListAgents(ctx, "repo-1")
	require.NoError(t, err)
	assert.NotNil(t, agents)
	assert.Empty(t, agents)
}

func TestUpdateAgentStatus(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "repo-1")
	createTestAgent(t, s, "agent-1", "repo-1")

	// Initial status is pending
	got, err := s.GetAgent(ctx, "agent-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, string(models.StatusPending), got.Status)

	// Update to running
	require.NoError(t, s.UpdateAgentStatus(ctx, "agent-1", models.StatusRunning))
	got, err = s.GetAgent(ctx, "agent-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, string(models.StatusRunning), got.Status)

	// Update to done
	require.NoError(t, s.UpdateAgentStatus(ctx, "agent-1", models.StatusDone))
	got, err = s.GetAgent(ctx, "agent-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, string(models.StatusDone), got.Status)
}

func TestDeleteAgent(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "repo-1")
	createTestAgent(t, s, "agent-1", "repo-1")

	got, err := s.GetAgent(ctx, "agent-1")
	require.NoError(t, err)
	require.NotNil(t, got)

	require.NoError(t, s.DeleteAgent(ctx, "agent-1"))

	got, err = s.GetAgent(ctx, "agent-1")
	require.NoError(t, err)
	assert.Nil(t, got)
}

// ============================================================================
// Conversation Tests
// ============================================================================

func TestAddConversation_Success(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")

	conv := &models.Conversation{
		ID:        "conv-1",
		SessionID: "sess-1",
		Type:      models.ConversationTypeTask,
		Name:      "My Conversation",
		Status:    models.ConversationStatusActive,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	require.NoError(t, s.AddConversation(ctx, conv))

	got, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "conv-1", got.ID)
	assert.Equal(t, "sess-1", got.SessionID)
	assert.Equal(t, models.ConversationTypeTask, got.Type)
	assert.Equal(t, "My Conversation", got.Name)
	assert.Equal(t, models.ConversationStatusActive, got.Status)
	// Messages and ToolSummary should be empty slices, not nil
	assert.NotNil(t, got.Messages)
	assert.Empty(t, got.Messages)
	assert.NotNil(t, got.ToolSummary)
	assert.Empty(t, got.ToolSummary)
}

func TestGetConversation_NotExists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	got, err := s.GetConversation(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestGetConversation_WithMessages(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Add messages
	msg1 := createTestMessage("m1", "user", "Hello")
	msg2 := createTestMessage("m2", "assistant", "Hi there!")
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg1))
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg2))

	got, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, 2, got.MessageCount)

	// Verify messages via paginated endpoint
	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 2)
	assert.Equal(t, "Hello", page.Messages[0].Content)
	assert.Equal(t, "user", page.Messages[0].Role)
	assert.Equal(t, "Hi there!", page.Messages[1].Content)
	assert.Equal(t, "assistant", page.Messages[1].Role)
}

func TestGetConversation_EmptyMessages(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	got, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	// Should be empty slice, not nil (important for JSON serialization)
	assert.NotNil(t, got.Messages)
	assert.Len(t, got.Messages, 0)
	assert.NotNil(t, got.ToolSummary)
	assert.Len(t, got.ToolSummary, 0)
}

func TestListConversations_BySession(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestSession(t, s, "sess-2", "ws-1")

	createTestConversation(t, s, "c1", "sess-1")
	createTestConversation(t, s, "c2", "sess-1")
	createTestConversation(t, s, "c3", "sess-2") // Different session

	convs, err := s.ListConversations(ctx, "sess-1")
	require.NoError(t, err)
	assert.Len(t, convs, 2)

	ids := make(map[string]bool)
	for _, c := range convs {
		ids[c.ID] = true
	}
	assert.True(t, ids["c1"])
	assert.True(t, ids["c2"])
	assert.False(t, ids["c3"])
}

func TestListConversations_WithMessages(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "c1", "sess-1")

	// Add messages to conversation
	require.NoError(t, s.AddMessageToConversation(ctx, "c1", createTestMessage("m1", "user", "Hello")))
	require.NoError(t, s.AddMessageToConversation(ctx, "c1", createTestMessage("m2", "assistant", "Hi")))

	convs, err := s.ListConversations(ctx, "sess-1")
	require.NoError(t, err)
	require.Len(t, convs, 1)

	// ListConversations no longer loads messages inline, only MessageCount
	assert.Equal(t, 2, convs[0].MessageCount)
	assert.Empty(t, convs[0].Messages) // Messages are empty (use GetConversationMessages for paginated access)

	// Verify messages via paginated endpoint
	page, err := s.GetConversationMessages(ctx, "c1", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 2)
	assert.Equal(t, "Hello", page.Messages[0].Content)
	assert.Equal(t, "Hi", page.Messages[1].Content)
}

func TestListConversations_WithToolActions(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "c1", "sess-1")

	// Add tool actions
	require.NoError(t, s.AddToolActionToConversation(ctx, "c1", models.ToolAction{
		ID: "t1", Tool: "read_file", Target: "main.go", Success: true,
	}))
	require.NoError(t, s.AddToolActionToConversation(ctx, "c1", models.ToolAction{
		ID: "t2", Tool: "write_file", Target: "test.go", Success: false,
	}))

	convs, err := s.ListConversations(ctx, "sess-1")
	require.NoError(t, err)
	require.Len(t, convs, 1)

	// Verify tool actions are loaded directly by ListConversations
	require.Len(t, convs[0].ToolSummary, 2)
	assert.Equal(t, "read_file", convs[0].ToolSummary[0].Tool)
	assert.Equal(t, "main.go", convs[0].ToolSummary[0].Target)
	assert.True(t, convs[0].ToolSummary[0].Success)
	assert.Equal(t, "write_file", convs[0].ToolSummary[1].Tool)
	assert.Equal(t, "test.go", convs[0].ToolSummary[1].Target)
	assert.False(t, convs[0].ToolSummary[1].Success)
}

func TestUpdateConversation_NameChange(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	conv, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	originalUpdatedAt := conv.UpdatedAt

	// Small delay to ensure UpdatedAt changes
	time.Sleep(10 * time.Millisecond)

	require.NoError(t, s.UpdateConversation(ctx, "conv-1", func(conv *models.Conversation) {
		conv.Name = "New Name"
		conv.Status = models.ConversationStatusCompleted
	}))

	got, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "New Name", got.Name)
	assert.Equal(t, models.ConversationStatusCompleted, got.Status)
	assert.True(t, got.UpdatedAt.After(originalUpdatedAt))
}

func TestDeleteConversation(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	got, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)

	require.NoError(t, s.DeleteConversation(ctx, "conv-1"))

	got, err = s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	assert.Nil(t, got)
}

// ============================================================================
// Conversation Model Field Tests
// ============================================================================

func TestAddConversation_WithModel(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")

	conv := &models.Conversation{
		ID:        "conv-1",
		SessionID: "sess-1",
		Type:      models.ConversationTypeTask,
		Name:      "Model Test",
		Status:    models.ConversationStatusActive,
		Model:     "claude-sonnet-4-20250514",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	require.NoError(t, s.AddConversation(ctx, conv))

	got, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "claude-sonnet-4-20250514", got.Model)
}

func TestAddConversation_ModelDefaultsToEmpty(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")

	// Use helper which doesn't set Model
	createTestConversation(t, s, "conv-1", "sess-1")

	got, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "", got.Model)
}

func TestGetConversationMeta_IncludesModel(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")

	conv := &models.Conversation{
		ID:        "conv-1",
		SessionID: "sess-1",
		Type:      models.ConversationTypeTask,
		Name:      "Meta Model Test",
		Status:    models.ConversationStatusActive,
		Model:     "claude-haiku-4-5-20251001",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	require.NoError(t, s.AddConversation(ctx, conv))

	got, err := s.GetConversationMeta(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "claude-haiku-4-5-20251001", got.Model)
}

func TestListConversations_IncludesModel(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")

	for _, tc := range []struct{ id, model string }{
		{"c1", "claude-opus-4-5-20251101"},
		{"c2", "claude-sonnet-4-20250514"},
		{"c3", ""},
	} {
		conv := &models.Conversation{
			ID:        tc.id,
			SessionID: "sess-1",
			Type:      models.ConversationTypeTask,
			Name:      "Conv " + tc.id,
			Status:    models.ConversationStatusActive,
			Model:     tc.model,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		require.NoError(t, s.AddConversation(ctx, conv))
	}

	convs, err := s.ListConversations(ctx, "sess-1")
	require.NoError(t, err)
	require.Len(t, convs, 3)

	modelsByID := map[string]string{}
	for _, c := range convs {
		modelsByID[c.ID] = c.Model
	}
	assert.Equal(t, "claude-opus-4-5-20251101", modelsByID["c1"])
	assert.Equal(t, "claude-sonnet-4-20250514", modelsByID["c2"])
	assert.Equal(t, "", modelsByID["c3"])
}

func TestListConversationsForSessions_IncludesModel(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestSession(t, s, "sess-2", "ws-1")

	conv1 := &models.Conversation{
		ID: "c1", SessionID: "sess-1", Type: models.ConversationTypeTask,
		Name: "C1", Status: models.ConversationStatusActive, Model: "claude-opus-4-5-20251101",
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	conv2 := &models.Conversation{
		ID: "c2", SessionID: "sess-2", Type: models.ConversationTypeTask,
		Name: "C2", Status: models.ConversationStatusActive, Model: "claude-haiku-4-5-20251001",
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	require.NoError(t, s.AddConversation(ctx, conv1))
	require.NoError(t, s.AddConversation(ctx, conv2))

	result, err := s.ListConversationsForSessions(ctx, []string{"sess-1", "sess-2"})
	require.NoError(t, err)
	require.Len(t, result["sess-1"], 1)
	require.Len(t, result["sess-2"], 1)
	assert.Equal(t, "claude-opus-4-5-20251101", result["sess-1"][0].Model)
	assert.Equal(t, "claude-haiku-4-5-20251001", result["sess-2"][0].Model)
}

func TestUpdateConversation_ModelChange(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")

	conv := &models.Conversation{
		ID:        "conv-1",
		SessionID: "sess-1",
		Type:      models.ConversationTypeTask,
		Name:      "Update Model Test",
		Status:    models.ConversationStatusActive,
		Model:     "claude-opus-4-5-20251101",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	require.NoError(t, s.AddConversation(ctx, conv))

	require.NoError(t, s.UpdateConversation(ctx, "conv-1", func(c *models.Conversation) {
		c.Model = "claude-sonnet-4-20250514"
	}))

	got, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "claude-sonnet-4-20250514", got.Model)
}

// ============================================================================
// Message Tests
// ============================================================================

func TestAddMessageToConversation_Ordering(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Add messages in order
	messages := []models.Message{
		createTestMessage("m1", "user", "First"),
		createTestMessage("m2", "assistant", "Second"),
		createTestMessage("m3", "user", "Third"),
	}

	for _, msg := range messages {
		require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))
	}

	// Verify ordering via paginated endpoint
	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 3)

	// Should be in order of insertion
	assert.Equal(t, "First", page.Messages[0].Content)
	assert.Equal(t, "Second", page.Messages[1].Content)
	assert.Equal(t, "Third", page.Messages[2].Content)
}

func TestAddMessageToConversation_WithSetupInfo(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	msg := models.Message{
		ID:        "m1",
		Role:      "system",
		Content:   "System message",
		Timestamp: time.Now(),
		SetupInfo: &models.SetupInfo{
			SessionName:  "My Session",
			BranchName:   "feature/test",
			OriginBranch: "main",
			FileCount:    42,
		},
	}

	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	// Verify via paginated endpoint
	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 1)
	require.NotNil(t, page.Messages[0].SetupInfo)
	assert.Equal(t, "My Session", page.Messages[0].SetupInfo.SessionName)
	assert.Equal(t, "feature/test", page.Messages[0].SetupInfo.BranchName)
	assert.Equal(t, "main", page.Messages[0].SetupInfo.OriginBranch)
	assert.Equal(t, 42, page.Messages[0].SetupInfo.FileCount)
}

func TestAddMessageToConversation_WithRunSummary(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	msg := models.Message{
		ID:        "m1",
		Role:      "assistant",
		Content:   "Done!",
		Timestamp: time.Now(),
		RunSummary: &models.RunSummary{
			Success:    true,
			Cost:       0.05,
			Turns:      3,
			DurationMs: 5000,
		},
	}

	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	// Verify via paginated endpoint
	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 1)
	require.NotNil(t, page.Messages[0].RunSummary)
	assert.True(t, page.Messages[0].RunSummary.Success)
	assert.Equal(t, 0.05, page.Messages[0].RunSummary.Cost)
	assert.Equal(t, 3, page.Messages[0].RunSummary.Turns)
	assert.Equal(t, 5000, page.Messages[0].RunSummary.DurationMs)
}

// ============================================================================
// Tool Action Tests
// ============================================================================

func TestAddToolActionToConversation_Ordering(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	actions := []models.ToolAction{
		createTestToolAction("t1", "read_file", "main.go", true),
		createTestToolAction("t2", "write_file", "output.txt", true),
		createTestToolAction("t3", "bash", "go test", false),
	}

	for _, action := range actions {
		require.NoError(t, s.AddToolActionToConversation(ctx, "conv-1", action))
	}

	got, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Len(t, got.ToolSummary, 3)

	// Should be in order of insertion
	assert.Equal(t, "read_file", got.ToolSummary[0].Tool)
	assert.Equal(t, "main.go", got.ToolSummary[0].Target)
	assert.True(t, got.ToolSummary[0].Success)

	assert.Equal(t, "write_file", got.ToolSummary[1].Tool)
	assert.Equal(t, "output.txt", got.ToolSummary[1].Target)
	assert.True(t, got.ToolSummary[1].Success)

	assert.Equal(t, "bash", got.ToolSummary[2].Tool)
	assert.Equal(t, "go test", got.ToolSummary[2].Target)
	assert.False(t, got.ToolSummary[2].Success)
}

// ============================================================================
// Migration Tests
// ============================================================================

func TestMigration_Idempotent(t *testing.T) {
	s := newTestStore(t)

	// Run migrations again - should not error
	err := s.runMigrations()
	assert.NoError(t, err)

	// Run again - should still not error
	err = s.runMigrations()
	assert.NoError(t, err)
}

// ============================================================================
// Helper Function Tests
// ============================================================================

func TestBoolToInt(t *testing.T) {
	assert.Equal(t, 1, boolToInt(true))
	assert.Equal(t, 0, boolToInt(false))
}

func TestIntToBool(t *testing.T) {
	assert.True(t, intToBool(1))
	assert.True(t, intToBool(2))
	assert.True(t, intToBool(-1))
	assert.False(t, intToBool(0))
}

// ============================================================================
// GetConversationMeta Tests
// ============================================================================

func TestGetConversationMeta_Success(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	got, err := s.GetConversationMeta(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "conv-1", got.ID)
	assert.Equal(t, "sess-1", got.SessionID)
	assert.Equal(t, models.ConversationTypeTask, got.Type)
	assert.Equal(t, models.ConversationStatusActive, got.Status)
}

func TestGetConversationMeta_NotFound(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	got, err := s.GetConversationMeta(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestGetConversationMeta_DoesNotLoadMessages(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Add messages and tool actions
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", createTestMessage("m1", "user", "Hello")))
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", createTestMessage("m2", "assistant", "Hi")))
	require.NoError(t, s.AddToolActionToConversation(ctx, "conv-1", createTestToolAction("t1", "Read", "file.go", true)))

	got, err := s.GetConversationMeta(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)

	// Meta should NOT have messages or tool actions loaded
	assert.Nil(t, got.Messages)
	assert.Nil(t, got.ToolSummary)
}

func TestGetConversationMeta_VsGetConversation(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", createTestMessage("m1", "user", "Hello")))

	// Meta returns same core fields as GetConversation
	meta, err := s.GetConversationMeta(ctx, "conv-1")
	require.NoError(t, err)
	full, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)

	assert.Equal(t, full.ID, meta.ID)
	assert.Equal(t, full.SessionID, meta.SessionID)
	assert.Equal(t, full.Type, meta.Type)
	assert.Equal(t, full.Status, meta.Status)

	// GetConversation now returns messageCount instead of inline messages
	assert.Equal(t, 1, full.MessageCount)
	assert.Empty(t, full.Messages) // Messages are empty (use GetConversationMessages for paginated access)
	assert.Nil(t, meta.Messages)
}

// ============================================================================
// GetAttachmentData Tests
// ============================================================================

func TestGetAttachmentData_Success(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	msg := createTestMessage("m1", "user", "Here is an image")
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	// Save attachment with base64 data
	att := models.Attachment{
		ID:         "att-1",
		Type:       "image",
		Name:       "screenshot.png",
		MimeType:   "image/png",
		Size:       1024,
		Base64Data: "iVBORw0KGgoAAAANSUhEUg==",
	}
	require.NoError(t, s.SaveAttachments(ctx, "m1", []models.Attachment{att}))

	data, err := s.GetAttachmentData(ctx, "att-1")
	require.NoError(t, err)
	assert.Equal(t, "iVBORw0KGgoAAAANSUhEUg==", data)
}

func TestGetAttachmentData_NotFound(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	_, err := s.GetAttachmentData(ctx, "nonexistent")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrAttachmentNotFound)
}

func TestGetAttachmentData_NullBase64(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	msg := createTestMessage("m1", "user", "A code file")
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	// Save attachment without base64 data (text file)
	att := models.Attachment{
		ID:       "att-2",
		Type:     "file",
		Name:     "main.go",
		MimeType: "text/plain",
		Size:     256,
		Preview:  "package main\n",
	}
	require.NoError(t, s.SaveAttachments(ctx, "m1", []models.Attachment{att}))

	data, err := s.GetAttachmentData(ctx, "att-2")
	require.NoError(t, err)
	assert.Equal(t, "", data)
}

// ============================================================================
// Base64 Exclusion Tests
// ============================================================================

func TestGetConversation_AttachmentsExcludeBase64(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	msg := createTestMessage("m1", "user", "Image attached")
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	// Save attachment WITH base64 data
	att := models.Attachment{
		ID:         "att-1",
		Type:       "image",
		Name:       "photo.png",
		MimeType:   "image/png",
		Size:       2048,
		Width:      800,
		Height:     600,
		Base64Data: "AAAA_LARGE_BASE64_DATA_AAAA",
		Preview:    "thumbnail",
	}
	require.NoError(t, s.SaveAttachments(ctx, "m1", []models.Attachment{att}))

	// GetConversation no longer loads messages inline, verify messageCount
	conv, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	assert.Equal(t, 1, conv.MessageCount)

	// Use GetConversationMessages to verify attachments exclude base64
	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 1)
	require.Len(t, page.Messages[0].Attachments, 1)

	loadedAtt := page.Messages[0].Attachments[0]
	assert.Equal(t, "att-1", loadedAtt.ID)
	assert.Equal(t, "photo.png", loadedAtt.Name)
	assert.Equal(t, "image/png", loadedAtt.MimeType)
	assert.Equal(t, int64(2048), loadedAtt.Size)
	assert.Equal(t, 800, loadedAtt.Width)
	assert.Equal(t, 600, loadedAtt.Height)
	assert.Equal(t, "thumbnail", loadedAtt.Preview)
	// Base64Data should NOT be loaded
	assert.Empty(t, loadedAtt.Base64Data, "base64Data should not be loaded in conversation queries")
}

func TestListConversations_AttachmentsExcludeBase64(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	msg := createTestMessage("m1", "user", "File")
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	att := models.Attachment{
		ID:         "att-1",
		Type:       "image",
		Name:       "img.png",
		MimeType:   "image/png",
		Size:       4096,
		Base64Data: "BBBB_SHOULD_NOT_APPEAR_BBBB",
	}
	require.NoError(t, s.SaveAttachments(ctx, "m1", []models.Attachment{att}))

	// ListConversations no longer loads messages inline
	convs, err := s.ListConversations(ctx, "sess-1")
	require.NoError(t, err)
	require.Len(t, convs, 1)
	assert.Equal(t, 1, convs[0].MessageCount)

	// Verify attachments via paginated messages endpoint
	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 1)
	require.Len(t, page.Messages[0].Attachments, 1)

	loadedAtt := page.Messages[0].Attachments[0]
	assert.Equal(t, "att-1", loadedAtt.ID)
	assert.Equal(t, "img.png", loadedAtt.Name)
	assert.Empty(t, loadedAtt.Base64Data, "base64Data should not be loaded in paginated queries")
}

func TestGetAttachmentsByMessageID_ExcludesBase64(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	msg := createTestMessage("m1", "user", "File")
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	att := models.Attachment{
		ID:         "att-1",
		Type:       "image",
		Name:       "img.png",
		MimeType:   "image/png",
		Size:       512,
		Base64Data: "CCCC_NOT_RETURNED_CCCC",
	}
	require.NoError(t, s.SaveAttachments(ctx, "m1", []models.Attachment{att}))

	attachments, err := s.GetAttachmentsByMessageID(ctx, "m1")
	require.NoError(t, err)
	require.Len(t, attachments, 1)
	assert.Equal(t, "att-1", attachments[0].ID)
	assert.Empty(t, attachments[0].Base64Data, "base64Data should not be loaded by GetAttachmentsByMessageID")
}

func TestGetAttachmentData_RoundTrip(t *testing.T) {
	// Verify that base64 data is saved and can be retrieved via dedicated endpoint
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	msg := createTestMessage("m1", "user", "Image")
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	largeBase64 := "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
	att := models.Attachment{
		ID:         "att-round",
		Type:       "image",
		Name:       "pixel.png",
		MimeType:   "image/png",
		Size:       128,
		Base64Data: largeBase64,
	}
	require.NoError(t, s.SaveAttachments(ctx, "m1", []models.Attachment{att}))

	// Paginated query should NOT have base64
	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 1)
	require.Len(t, page.Messages[0].Attachments, 1)
	assert.Empty(t, page.Messages[0].Attachments[0].Base64Data)

	// Dedicated query SHOULD have base64
	data, err := s.GetAttachmentData(ctx, "att-round")
	require.NoError(t, err)
	assert.Equal(t, largeBase64, data)
}

func TestListConversationsForSessions_AttachmentsExcludeBase64(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	msg := createTestMessage("m1", "user", "Attached file")
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	att := models.Attachment{
		ID:         "att-batch",
		Type:       "image",
		Name:       "batch.png",
		MimeType:   "image/png",
		Size:       1024,
		Base64Data: "DDDD_BATCH_BASE64_DDDD",
	}
	require.NoError(t, s.SaveAttachments(ctx, "m1", []models.Attachment{att}))

	convMap, err := s.ListConversationsForSessions(ctx, []string{"sess-1"})
	require.NoError(t, err)
	convs := convMap["sess-1"]
	require.Len(t, convs, 1)
	assert.Equal(t, 1, convs[0].MessageCount)

	// Verify attachments via paginated messages endpoint
	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 1)
	require.Len(t, page.Messages[0].Attachments, 1)

	loadedAtt := page.Messages[0].Attachments[0]
	assert.Equal(t, "att-batch", loadedAtt.ID)
	assert.Empty(t, loadedAtt.Base64Data, "base64Data should not be loaded in paginated queries")
}

// ============================================================================
// Settings Tests
// ============================================================================

func TestGetSetting_NotFound_ReturnsEmpty(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	val, found, err := s.GetSetting(ctx, "nonexistent-key")
	require.NoError(t, err)
	assert.False(t, found)
	assert.Equal(t, "", val)
}

func TestSetSetting_AndGet(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	require.NoError(t, s.SetSetting(ctx, "my-key", "my-value"))

	val, found, err := s.GetSetting(ctx, "my-key")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "my-value", val)
}

func TestSetSetting_Upsert(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	require.NoError(t, s.SetSetting(ctx, "key", "value1"))
	require.NoError(t, s.SetSetting(ctx, "key", "value2"))

	val, found, err := s.GetSetting(ctx, "key")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "value2", val)
}

func TestSetSetting_MultipleKeys(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	require.NoError(t, s.SetSetting(ctx, "key-a", "alpha"))
	require.NoError(t, s.SetSetting(ctx, "key-b", "beta"))
	require.NoError(t, s.SetSetting(ctx, "key-c", "gamma"))

	val, found, err := s.GetSetting(ctx, "key-a")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "alpha", val)

	val, found, err = s.GetSetting(ctx, "key-b")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "beta", val)

	val, found, err = s.GetSetting(ctx, "key-c")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "gamma", val)
}

func TestDeleteSetting_Exists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	require.NoError(t, s.SetSetting(ctx, "to-delete", "some-value"))

	require.NoError(t, s.DeleteSetting(ctx, "to-delete"))

	val, found, err := s.GetSetting(ctx, "to-delete")
	require.NoError(t, err)
	assert.False(t, found)
	assert.Equal(t, "", val)
}

func TestDeleteSetting_NotExists_NoError(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	err := s.DeleteSetting(ctx, "never-existed")
	require.NoError(t, err)
}

func TestSetSetting_EmptyValue(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	// Empty string should be allowed (TEXT NOT NULL allows empty strings)
	require.NoError(t, s.SetSetting(ctx, "empty-key", ""))

	val, found, err := s.GetSetting(ctx, "empty-key")
	require.NoError(t, err)
	assert.True(t, found, "key with empty value should still be found")
	assert.Equal(t, "", val)
}

// ============================================================================
// Message Pagination Tests (GetConversationMessages)
// ============================================================================

// addNMessages is a helper to add N messages to a conversation
func addNMessages(t *testing.T, s *SQLiteStore, convID string, n int) {
	t.Helper()
	ctx := context.Background()
	for i := 0; i < n; i++ {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		msg := createTestMessage(
			fmt.Sprintf("msg-%s-%d", convID, i),
			role,
			fmt.Sprintf("Message %d", i),
		)
		require.NoError(t, s.AddMessageToConversation(ctx, convID, msg))
	}
}

func TestGetConversationMessages_EmptyConversation(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	require.NotNil(t, page)
	assert.Empty(t, page.Messages)
	assert.False(t, page.HasMore)
	assert.Equal(t, 0, page.TotalCount)
	assert.Equal(t, 0, page.OldestPosition)
}

func TestGetConversationMessages_DefaultLimit(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addNMessages(t, s, "conv-1", 5)

	// Passing 0 limit should default to 50
	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 0)
	require.NoError(t, err)
	assert.Len(t, page.Messages, 5)
	assert.Equal(t, 5, page.TotalCount)
	assert.False(t, page.HasMore)
}

func TestGetConversationMessages_NegativeLimit(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addNMessages(t, s, "conv-1", 3)

	// Negative limit should default to 50
	page, err := s.GetConversationMessages(ctx, "conv-1", nil, -10)
	require.NoError(t, err)
	assert.Len(t, page.Messages, 3)
}

func TestGetConversationMessages_LimitClampsAt200(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Add 210 messages — more than the 200 max
	addNMessages(t, s, "conv-1", 210)

	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 500)
	require.NoError(t, err)
	// Should be clamped to 200
	assert.Len(t, page.Messages, 200)
	assert.True(t, page.HasMore)
	assert.Equal(t, 210, page.TotalCount)
}

func TestGetConversationMessages_ReturnsLatestMessages(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addNMessages(t, s, "conv-1", 10)

	// Request only 3 — should get the 3 most recent
	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 3)
	require.NoError(t, err)
	assert.Len(t, page.Messages, 3)
	assert.True(t, page.HasMore)
	assert.Equal(t, 10, page.TotalCount)

	// Messages should be in ascending order (oldest first)
	assert.Equal(t, "Message 7", page.Messages[0].Content)
	assert.Equal(t, "Message 8", page.Messages[1].Content)
	assert.Equal(t, "Message 9", page.Messages[2].Content)
}

func TestGetConversationMessages_AscendingOrder(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addNMessages(t, s, "conv-1", 5)

	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 5)

	// Verify ascending order by content
	for i, msg := range page.Messages {
		assert.Equal(t, fmt.Sprintf("Message %d", i), msg.Content)
	}
}

func TestGetConversationMessages_CursorPagination(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addNMessages(t, s, "conv-1", 10)

	// Page 1: get latest 3
	page1, err := s.GetConversationMessages(ctx, "conv-1", nil, 3)
	require.NoError(t, err)
	assert.Len(t, page1.Messages, 3)
	assert.True(t, page1.HasMore)
	assert.Equal(t, "Message 7", page1.Messages[0].Content)
	assert.Equal(t, "Message 9", page1.Messages[2].Content)

	// Page 2: get 3 before the oldest position of page 1
	cursor := page1.OldestPosition
	page2, err := s.GetConversationMessages(ctx, "conv-1", &cursor, 3)
	require.NoError(t, err)
	assert.Len(t, page2.Messages, 3)
	assert.True(t, page2.HasMore)
	assert.Equal(t, "Message 4", page2.Messages[0].Content)
	assert.Equal(t, "Message 6", page2.Messages[2].Content)

	// Page 3: get 3 more
	cursor2 := page2.OldestPosition
	page3, err := s.GetConversationMessages(ctx, "conv-1", &cursor2, 3)
	require.NoError(t, err)
	assert.Len(t, page3.Messages, 3)
	assert.True(t, page3.HasMore)
	assert.Equal(t, "Message 1", page3.Messages[0].Content)
	assert.Equal(t, "Message 3", page3.Messages[2].Content)

	// Page 4: get remaining 1
	cursor3 := page3.OldestPosition
	page4, err := s.GetConversationMessages(ctx, "conv-1", &cursor3, 3)
	require.NoError(t, err)
	assert.Len(t, page4.Messages, 1)
	assert.False(t, page4.HasMore)
	assert.Equal(t, "Message 0", page4.Messages[0].Content)
}

func TestGetConversationMessages_HasMoreFlag(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addNMessages(t, s, "conv-1", 5)

	// Exact count: hasMore should be false
	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 5)
	require.NoError(t, err)
	assert.Len(t, page.Messages, 5)
	assert.False(t, page.HasMore)

	// One less: hasMore should be true
	page2, err := s.GetConversationMessages(ctx, "conv-1", nil, 4)
	require.NoError(t, err)
	assert.Len(t, page2.Messages, 4)
	assert.True(t, page2.HasMore)

	// More than available: hasMore should be false
	page3, err := s.GetConversationMessages(ctx, "conv-1", nil, 10)
	require.NoError(t, err)
	assert.Len(t, page3.Messages, 5)
	assert.False(t, page3.HasMore)
}

func TestGetConversationMessages_OldestPosition(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addNMessages(t, s, "conv-1", 5)

	// Full page: oldest position should be position of first message (position 0)
	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	assert.Equal(t, 0, page.OldestPosition)

	// Partial page: oldest should be position of the oldest returned message
	page2, err := s.GetConversationMessages(ctx, "conv-1", nil, 2)
	require.NoError(t, err)
	assert.Len(t, page2.Messages, 2)
	// Positions are 0-based so the 2 most recent are at positions 3 and 4
	assert.Equal(t, 3, page2.OldestPosition)
}

func TestGetConversationMessages_WithSetupInfo(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	msg := models.Message{
		ID:      "msg-setup",
		Role:    "system",
		Content: "Setup message",
		SetupInfo: &models.SetupInfo{
			SessionName:  "test-session",
			BranchName:   "feature/test",
			OriginBranch: "main",
			FileCount:    42,
		},
		Timestamp: time.Now(),
	}
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 1)
	require.NotNil(t, page.Messages[0].SetupInfo)
	assert.Equal(t, "test-session", page.Messages[0].SetupInfo.SessionName)
	assert.Equal(t, "feature/test", page.Messages[0].SetupInfo.BranchName)
	assert.Equal(t, "main", page.Messages[0].SetupInfo.OriginBranch)
	assert.Equal(t, 42, page.Messages[0].SetupInfo.FileCount)
}

func TestGetConversationMessages_WithRunSummary(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	msg := models.Message{
		ID:      "msg-summary",
		Role:    "assistant",
		Content: "Done!",
		RunSummary: &models.RunSummary{
			Success:    true,
			Cost:       0.05,
			Turns:      3,
			DurationMs: 12000,
		},
		Timestamp: time.Now(),
	}
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 1)
	require.NotNil(t, page.Messages[0].RunSummary)
	assert.True(t, page.Messages[0].RunSummary.Success)
	assert.Equal(t, 0.05, page.Messages[0].RunSummary.Cost)
	assert.Equal(t, 3, page.Messages[0].RunSummary.Turns)
	assert.Equal(t, 12000, page.Messages[0].RunSummary.DurationMs)
}

func TestGetConversationMessages_WithAttachments(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	msg := models.Message{
		ID:        "msg-attach",
		Role:      "user",
		Content:   "Here is a file",
		Timestamp: time.Now(),
	}
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	// Attachments are saved separately via SaveAttachments
	attachments := []models.Attachment{
		{
			ID:         "att-1",
			Type:       "file",
			Name:       "test.txt",
			MimeType:   "text/plain",
			Size:       100,
			Base64Data: "dGVzdCBkYXRh",
			Preview:    "test data",
		},
	}
	require.NoError(t, s.SaveAttachments(ctx, "msg-attach", attachments))

	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 1)
	require.Len(t, page.Messages[0].Attachments, 1)
	assert.Equal(t, "att-1", page.Messages[0].Attachments[0].ID)
	assert.Equal(t, "test.txt", page.Messages[0].Attachments[0].Name)
	// loadAttachmentsForMessages excludes base64 by default
	assert.Empty(t, page.Messages[0].Attachments[0].Base64Data)
	assert.Equal(t, "test data", page.Messages[0].Attachments[0].Preview)
}

func TestGetConversationMessages_NonexistentConversation(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	page, err := s.GetConversationMessages(ctx, "nonexistent", nil, 50)
	require.NoError(t, err)
	require.NotNil(t, page)
	assert.Empty(t, page.Messages)
	assert.False(t, page.HasMore)
	assert.Equal(t, 0, page.TotalCount)
}

func TestGetConversationMessages_TotalCountStaysConstant(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addNMessages(t, s, "conv-1", 20)

	// TotalCount should be the same regardless of limit or cursor
	page1, err := s.GetConversationMessages(ctx, "conv-1", nil, 5)
	require.NoError(t, err)
	assert.Equal(t, 20, page1.TotalCount)

	cursor := page1.OldestPosition
	page2, err := s.GetConversationMessages(ctx, "conv-1", &cursor, 5)
	require.NoError(t, err)
	assert.Equal(t, 20, page2.TotalCount)
}

func TestGetConversationMessages_RolesPreserved(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addNMessages(t, s, "conv-1", 4)

	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 4)

	// addNMessages alternates: 0=user, 1=assistant, 2=user, 3=assistant
	assert.Equal(t, "user", page.Messages[0].Role)
	assert.Equal(t, "assistant", page.Messages[1].Role)
	assert.Equal(t, "user", page.Messages[2].Role)
	assert.Equal(t, "assistant", page.Messages[3].Role)
}

func TestGetConversationMessages_CursorPagination_CollectsAllMessages(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addNMessages(t, s, "conv-1", 15)

	// Walk through all pages collecting messages
	var allMessages []models.Message
	var cursor *int
	for {
		page, err := s.GetConversationMessages(ctx, "conv-1", cursor, 4)
		require.NoError(t, err)
		allMessages = append(allMessages, page.Messages...)
		if !page.HasMore {
			break
		}
		cursor = &page.OldestPosition
	}

	// Should have collected all 15 messages with no duplicates
	assert.Len(t, allMessages, 15)
	seen := make(map[string]bool)
	for _, msg := range allMessages {
		assert.False(t, seen[msg.ID], "duplicate message ID: %s", msg.ID)
		seen[msg.ID] = true
	}
}

// ============================================================================
// GetConversationMessageCount Tests
// ============================================================================

func TestGetConversationMessageCount_Empty(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	count, err := s.GetConversationMessageCount(ctx, "conv-1")
	require.NoError(t, err)
	assert.Equal(t, 0, count)
}

func TestGetConversationMessageCount_WithMessages(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addNMessages(t, s, "conv-1", 7)

	count, err := s.GetConversationMessageCount(ctx, "conv-1")
	require.NoError(t, err)
	assert.Equal(t, 7, count)
}

func TestGetConversationMessageCount_Nonexistent(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	count, err := s.GetConversationMessageCount(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Equal(t, 0, count)
}

// ============================================================================
// GetConversation and ListConversations return MessageCount Tests
// ============================================================================

func TestGetConversation_ReturnsMessageCount(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addNMessages(t, s, "conv-1", 12)

	conv, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, conv)
	assert.Equal(t, 12, conv.MessageCount)
	// Messages should NOT be loaded inline
	assert.Empty(t, conv.Messages)
}

func TestListConversations_ReturnsMessageCount(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")
	createTestConversation(t, s, "conv-2", "sess-1")

	addNMessages(t, s, "conv-1", 5)
	addNMessages(t, s, "conv-2", 10)

	convs, err := s.ListConversations(ctx, "sess-1")
	require.NoError(t, err)
	require.Len(t, convs, 2)

	// Find each conversation and verify counts
	counts := make(map[string]int)
	for _, c := range convs {
		counts[c.ID] = c.MessageCount
		assert.Empty(t, c.Messages, "Messages should not be loaded inline for %s", c.ID)
	}
	assert.Equal(t, 5, counts["conv-1"])
	assert.Equal(t, 10, counts["conv-2"])
}

func TestListConversationsForSessions_ReturnsMessageCount(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestSession(t, s, "sess-2", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")
	createTestConversation(t, s, "conv-2", "sess-2")

	addNMessages(t, s, "conv-1", 3)
	addNMessages(t, s, "conv-2", 8)

	result, err := s.ListConversationsForSessions(ctx, []string{"sess-1", "sess-2"})
	require.NoError(t, err)

	// Flatten the map and check counts
	counts := make(map[string]int)
	for _, convs := range result {
		for _, c := range convs {
			counts[c.ID] = c.MessageCount
			assert.Empty(t, c.Messages)
		}
	}
	assert.Equal(t, 3, counts["conv-1"])
	assert.Equal(t, 8, counts["conv-2"])
}


// ============================================================================
// Summary Tests
// ============================================================================

func createTestSummary(id, conversationID, sessionID, status string) *models.Summary {
	return &models.Summary{
		ID:             id,
		ConversationID: conversationID,
		SessionID:      sessionID,
		Content:        "Summary content for " + id,
		Status:         status,
		MessageCount:   10,
		CreatedAt:      time.Now(),
	}
}

func TestAddSummary_Success(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	summary := createTestSummary("sum-1", "conv-1", "sess-1", models.SummaryStatusCompleted)
	require.NoError(t, s.AddSummary(ctx, summary))

	got, err := s.GetSummary(ctx, "sum-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "sum-1", got.ID)
	assert.Equal(t, "conv-1", got.ConversationID)
	assert.Equal(t, "sess-1", got.SessionID)
	assert.Equal(t, "Summary content for sum-1", got.Content)
	assert.Equal(t, models.SummaryStatusCompleted, got.Status)
	assert.Equal(t, 10, got.MessageCount)
}

func TestGetSummaryByConversation_Success(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	summary := createTestSummary("sum-1", "conv-1", "sess-1", models.SummaryStatusCompleted)
	require.NoError(t, s.AddSummary(ctx, summary))

	got, err := s.GetSummaryByConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "sum-1", got.ID)
	assert.Equal(t, "conv-1", got.ConversationID)
	assert.Equal(t, models.SummaryStatusCompleted, got.Status)
}

func TestGetSummaryByConversation_NotFound(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	got, err := s.GetSummaryByConversation(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestGetSummary_Success(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	summary := createTestSummary("sum-1", "conv-1", "sess-1", models.SummaryStatusGenerating)
	summary.ErrorMessage = ""
	require.NoError(t, s.AddSummary(ctx, summary))

	got, err := s.GetSummary(ctx, "sum-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "sum-1", got.ID)
	assert.Equal(t, "conv-1", got.ConversationID)
	assert.Equal(t, "sess-1", got.SessionID)
	assert.Equal(t, models.SummaryStatusGenerating, got.Status)
	assert.Equal(t, 10, got.MessageCount)
}

func TestGetSummary_NotFound(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	got, err := s.GetSummary(ctx, "nonexistent")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
	assert.Nil(t, got)
}

func TestListSummariesBySession_OnlyCompleted(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")
	createTestConversation(t, s, "conv-2", "sess-1")

	// Add a generating summary
	generating := createTestSummary("sum-gen", "conv-1", "sess-1", models.SummaryStatusGenerating)
	require.NoError(t, s.AddSummary(ctx, generating))

	// Add a completed summary
	completed := createTestSummary("sum-done", "conv-2", "sess-1", models.SummaryStatusCompleted)
	require.NoError(t, s.AddSummary(ctx, completed))

	summaries, err := s.ListSummariesBySession(ctx, "sess-1")
	require.NoError(t, err)
	require.Len(t, summaries, 1)
	assert.Equal(t, "sum-done", summaries[0].ID)
	assert.Equal(t, models.SummaryStatusCompleted, summaries[0].Status)
}

func TestListSummariesBySession_Empty(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")

	summaries, err := s.ListSummariesBySession(ctx, "sess-1")
	require.NoError(t, err)
	assert.Empty(t, summaries)
}

func TestListSummariesBySession_MultipleConversations(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")
	createTestConversation(t, s, "conv-2", "sess-1")
	createTestConversation(t, s, "conv-3", "sess-1")

	// Add completed summaries for different conversations in the same session
	sum1 := createTestSummary("sum-1", "conv-1", "sess-1", models.SummaryStatusCompleted)
	sum2 := createTestSummary("sum-2", "conv-2", "sess-1", models.SummaryStatusCompleted)
	sum3 := createTestSummary("sum-3", "conv-3", "sess-1", models.SummaryStatusCompleted)
	require.NoError(t, s.AddSummary(ctx, sum1))
	require.NoError(t, s.AddSummary(ctx, sum2))
	require.NoError(t, s.AddSummary(ctx, sum3))

	summaries, err := s.ListSummariesBySession(ctx, "sess-1")
	require.NoError(t, err)
	require.Len(t, summaries, 3)

	// Collect IDs to verify all are present
	ids := make(map[string]bool)
	for _, s := range summaries {
		ids[s.ID] = true
	}
	assert.True(t, ids["sum-1"])
	assert.True(t, ids["sum-2"])
	assert.True(t, ids["sum-3"])
}

func TestUpdateSummary_Success(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	summary := createTestSummary("sum-1", "conv-1", "sess-1", models.SummaryStatusGenerating)
	require.NoError(t, s.AddSummary(ctx, summary))

	// Update to completed with content
	require.NoError(t, s.UpdateSummary(ctx, "sum-1", models.SummaryStatusCompleted, "Final summary content", ""))

	got, err := s.GetSummary(ctx, "sum-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, models.SummaryStatusCompleted, got.Status)
	assert.Equal(t, "Final summary content", got.Content)
	assert.Equal(t, "", got.ErrorMessage)
}

func TestUpdateSummary_NotFound(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	err := s.UpdateSummary(ctx, "nonexistent", models.SummaryStatusCompleted, "content", "")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestSummary_CascadeDeleteConversation(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	summary := createTestSummary("sum-1", "conv-1", "sess-1", models.SummaryStatusCompleted)
	require.NoError(t, s.AddSummary(ctx, summary))

	// Verify summary exists
	got, err := s.GetSummary(ctx, "sum-1")
	require.NoError(t, err)
	require.NotNil(t, got)

	// Delete the conversation
	require.NoError(t, s.DeleteConversation(ctx, "conv-1"))

	// Summary should be cascade deleted
	got, err = s.GetSummary(ctx, "sum-1")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
	assert.Nil(t, got)
}

func TestSummary_CascadeDeleteSession(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")
	createTestConversation(t, s, "conv-2", "sess-1")

	sum1 := createTestSummary("sum-1", "conv-1", "sess-1", models.SummaryStatusCompleted)
	sum2 := createTestSummary("sum-2", "conv-2", "sess-1", models.SummaryStatusCompleted)
	require.NoError(t, s.AddSummary(ctx, sum1))
	require.NoError(t, s.AddSummary(ctx, sum2))

	// Verify summaries exist
	summaries, err := s.ListSummariesBySession(ctx, "sess-1")
	require.NoError(t, err)
	require.Len(t, summaries, 2)

	// Delete the session
	require.NoError(t, s.DeleteSession(ctx, "sess-1"))

	// All summaries should be cascade deleted
	got1, err := s.GetSummary(ctx, "sum-1")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
	assert.Nil(t, got1)

	got2, err := s.GetSummary(ctx, "sum-2")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
	assert.Nil(t, got2)

	// ListSummariesBySession should return empty
	summaries, err = s.ListSummariesBySession(ctx, "sess-1")
	require.NoError(t, err)
	assert.Empty(t, summaries)
}

// ============================================================================
// Archive Summary Field Tests
// ============================================================================

func TestUpdateSession_SetArchiveSummary(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "s1", "ws-1")

	// Set archive summary and status
	require.NoError(t, s.UpdateSession(ctx, "s1", func(sess *models.Session) {
		sess.ArchiveSummary = "This session implemented authentication."
		sess.ArchiveSummaryStatus = models.SummaryStatusCompleted
	}))

	fetched, err := s.GetSession(ctx, "s1")
	require.NoError(t, err)
	assert.Equal(t, "This session implemented authentication.", fetched.ArchiveSummary)
	assert.Equal(t, models.SummaryStatusCompleted, fetched.ArchiveSummaryStatus)

	// Update to generating status with empty summary
	require.NoError(t, s.UpdateSession(ctx, "s1", func(sess *models.Session) {
		sess.ArchiveSummary = ""
		sess.ArchiveSummaryStatus = models.SummaryStatusGenerating
	}))

	fetched, err = s.GetSession(ctx, "s1")
	require.NoError(t, err)
	assert.Empty(t, fetched.ArchiveSummary)
	assert.Equal(t, models.SummaryStatusGenerating, fetched.ArchiveSummaryStatus)

	// Update to failed status
	require.NoError(t, s.UpdateSession(ctx, "s1", func(sess *models.Session) {
		sess.ArchiveSummaryStatus = models.SummaryStatusFailed
	}))

	fetched, err = s.GetSession(ctx, "s1")
	require.NoError(t, err)
	assert.Equal(t, models.SummaryStatusFailed, fetched.ArchiveSummaryStatus)
}

func TestAddSession_WithArchiveSummaryFields(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	session := &models.Session{
		ID:                   "sess-with-summary",
		WorkspaceID:          "ws-1",
		Name:                 "Pre-summarized Session",
		Branch:               "feature/test",
		Status:               "idle",
		ArchiveSummary:       "Pre-existing summary text",
		ArchiveSummaryStatus: models.SummaryStatusCompleted,
		CreatedAt:            time.Now(),
		UpdatedAt:            time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))

	fetched, err := s.GetSession(ctx, "sess-with-summary")
	require.NoError(t, err)
	require.NotNil(t, fetched)
	assert.Equal(t, "Pre-existing summary text", fetched.ArchiveSummary)
	assert.Equal(t, models.SummaryStatusCompleted, fetched.ArchiveSummaryStatus)
}

func TestListSessions_IncludesArchiveSummaryFields(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "s1", "ws-1")

	require.NoError(t, s.UpdateSession(ctx, "s1", func(sess *models.Session) {
		sess.Archived = true
		sess.ArchiveSummary = "Session summary for listing"
		sess.ArchiveSummaryStatus = models.SummaryStatusCompleted
	}))

	sessions, err := s.ListSessions(ctx, "ws-1", true)
	require.NoError(t, err)
	require.Len(t, sessions, 1)
	assert.Equal(t, "Session summary for listing", sessions[0].ArchiveSummary)
	assert.Equal(t, models.SummaryStatusCompleted, sessions[0].ArchiveSummaryStatus)
}

func TestGetSessionWithWorkspace_IncludesArchiveSummaryFields(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "s1", "ws-1")

	require.NoError(t, s.UpdateSession(ctx, "s1", func(sess *models.Session) {
		sess.ArchiveSummary = "Session summary via join"
		sess.ArchiveSummaryStatus = models.SummaryStatusCompleted
	}))

	result, err := s.GetSessionWithWorkspace(ctx, "s1")
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "Session summary via join", result.Session.ArchiveSummary)
	assert.Equal(t, models.SummaryStatusCompleted, result.Session.ArchiveSummaryStatus)
}

// ============================================================================
// Session TargetBranch Tests
// ============================================================================

func TestSession_TargetBranch_AddAndGet(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	session := &models.Session{
		ID:           "sess-tb-1",
		WorkspaceID:  "ws-1",
		Name:         "target-branch-session",
		Branch:       "feature/tb",
		TargetBranch: "origin/develop",
		Status:       "idle",
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))

	got, err := s.GetSession(ctx, "sess-tb-1")
	require.NoError(t, err)
	assert.Equal(t, "origin/develop", got.TargetBranch)
}

func TestSession_TargetBranch_EmptyStoredAsNull(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	session := &models.Session{
		ID:          "sess-tb-2",
		WorkspaceID: "ws-1",
		Name:        "no-target-branch",
		Branch:      "feature/no-tb",
		Status:      "idle",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))

	got, err := s.GetSession(ctx, "sess-tb-2")
	require.NoError(t, err)
	assert.Empty(t, got.TargetBranch)
}

func TestSession_TargetBranch_Update(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-tb-3", "ws-1")

	// Set target branch
	require.NoError(t, s.UpdateSession(ctx, "sess-tb-3", func(sess *models.Session) {
		sess.TargetBranch = "origin/release/v2"
	}))

	got, err := s.GetSession(ctx, "sess-tb-3")
	require.NoError(t, err)
	assert.Equal(t, "origin/release/v2", got.TargetBranch)
}

func TestSession_TargetBranch_Clear(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	// Create session with target branch set
	session := &models.Session{
		ID:           "sess-tb-4",
		WorkspaceID:  "ws-1",
		Name:         "clear-tb",
		Branch:       "feature/clear",
		TargetBranch: "origin/staging",
		Status:       "idle",
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))

	// Clear target branch by setting to empty string
	require.NoError(t, s.UpdateSession(ctx, "sess-tb-4", func(sess *models.Session) {
		sess.TargetBranch = ""
	}))

	got, err := s.GetSession(ctx, "sess-tb-4")
	require.NoError(t, err)
	assert.Empty(t, got.TargetBranch)
}

func TestSession_TargetBranch_GetSessionWithWorkspace(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	session := &models.Session{
		ID:           "sess-tb-5",
		WorkspaceID:  "ws-1",
		Name:         "with-workspace",
		Branch:       "feature/ws",
		TargetBranch: "origin/develop",
		Status:       "idle",
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))

	got, err := s.GetSessionWithWorkspace(ctx, "sess-tb-5")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "origin/develop", got.TargetBranch)
	assert.Equal(t, "origin/develop", got.EffectiveTargetBranch())
}

func TestSession_TargetBranch_EffectiveTargetBranch_FallsBack(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1") // repo has Branch: "main"

	session := &models.Session{
		ID:          "sess-tb-6",
		WorkspaceID: "ws-1",
		Name:        "fallback",
		Branch:      "feature/fb",
		Status:      "idle",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))

	got, err := s.GetSessionWithWorkspace(ctx, "sess-tb-6")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Empty(t, got.TargetBranch)
	assert.Equal(t, "origin/main", got.EffectiveTargetBranch())
}

func TestSession_TargetBranch_ListSessions(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	// Create two sessions: one with target branch, one without
	s1 := &models.Session{
		ID:           "sess-tb-7a",
		WorkspaceID:  "ws-1",
		Name:         "with-target",
		Branch:       "feature/a",
		TargetBranch: "origin/staging",
		Status:       "idle",
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	s2 := &models.Session{
		ID:          "sess-tb-7b",
		WorkspaceID: "ws-1",
		Name:        "no-target",
		Branch:      "feature/b",
		Status:      "idle",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, s1))
	require.NoError(t, s.AddSession(ctx, s2))

	sessions, err := s.ListSessions(ctx, "ws-1", false)
	require.NoError(t, err)
	require.Len(t, sessions, 2)

	// Find each session and verify targetBranch
	byID := map[string]*models.Session{}
	for i := range sessions {
		byID[sessions[i].ID] = sessions[i]
	}
	assert.Equal(t, "origin/staging", byID["sess-tb-7a"].TargetBranch)
	assert.Empty(t, byID["sess-tb-7b"].TargetBranch)
}

// ============================================================================
// Repo Settings Tests (remote, branch_prefix, custom_prefix)
// ============================================================================

func TestUpdateRepo_Success(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	repo := createTestRepo(t, s, "repo-upd-1")

	t.Run("updates branch, remote, branch_prefix, custom_prefix", func(t *testing.T) {
		repo.Branch = "develop"
		repo.Remote = "upstream"
		repo.BranchPrefix = "feat"
		repo.CustomPrefix = "my-prefix"
		require.NoError(t, s.UpdateRepo(ctx, repo))

		got, err := s.GetRepo(ctx, "repo-upd-1")
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Equal(t, "develop", got.Branch)
		assert.Equal(t, "upstream", got.Remote)
		assert.Equal(t, "feat", got.BranchPrefix)
		assert.Equal(t, "my-prefix", got.CustomPrefix)
	})

	t.Run("preserves ID, Name, Path, CreatedAt", func(t *testing.T) {
		got, err := s.GetRepo(ctx, "repo-upd-1")
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Equal(t, repo.ID, got.ID)
		assert.Equal(t, repo.Name, got.Name)
		assert.Equal(t, repo.Path, got.Path)
		assert.False(t, got.CreatedAt.IsZero())
	})

	t.Run("fields default to empty strings when not set", func(t *testing.T) {
		createTestRepo(t, s, "repo-upd-defaults")
		got, err := s.GetRepo(ctx, "repo-upd-defaults")
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Equal(t, "", got.Remote)
		assert.Equal(t, "", got.BranchPrefix)
		assert.Equal(t, "", got.CustomPrefix)
	})
}

func TestUpdateRepo_ClearsFields(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	repo := &models.Repo{
		ID:           "repo-clear-1",
		Name:         "clear-repo",
		Path:         "/path/to/clear",
		Branch:       "main",
		Remote:       "upstream",
		BranchPrefix: "feat",
		CustomPrefix: "prefix",
		CreatedAt:    time.Now(),
	}
	require.NoError(t, s.AddRepo(ctx, repo))

	// Clear the settings
	repo.Remote = ""
	repo.BranchPrefix = ""
	repo.CustomPrefix = ""
	require.NoError(t, s.UpdateRepo(ctx, repo))

	got, err := s.GetRepo(ctx, "repo-clear-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "", got.Remote)
	assert.Equal(t, "", got.BranchPrefix)
	assert.Equal(t, "", got.CustomPrefix)
}

func TestAddRepo_WithRepoSettings(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	t.Run("stores remote, branch_prefix, custom_prefix", func(t *testing.T) {
		repo := &models.Repo{
			ID:           "repo-settings-1",
			Name:         "settings-repo",
			Path:         "/path/to/settings",
			Branch:       "main",
			Remote:       "upstream",
			BranchPrefix: "fix",
			CustomPrefix: "team-alpha",
			CreatedAt:    time.Now(),
		}
		require.NoError(t, s.AddRepo(ctx, repo))

		got, err := s.GetRepo(ctx, "repo-settings-1")
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Equal(t, "upstream", got.Remote)
		assert.Equal(t, "fix", got.BranchPrefix)
		assert.Equal(t, "team-alpha", got.CustomPrefix)
	})

	t.Run("upsert updates new columns", func(t *testing.T) {
		repo1 := &models.Repo{
			ID:           "repo-upsert-settings",
			Name:         "upsert-repo",
			Path:         "/path/to/upsert",
			Branch:       "main",
			Remote:       "origin",
			BranchPrefix: "feat",
			CustomPrefix: "v1",
			CreatedAt:    time.Now(),
		}
		require.NoError(t, s.AddRepo(ctx, repo1))

		// Upsert with new settings
		repo2 := &models.Repo{
			ID:           "repo-upsert-settings",
			Name:         "upsert-repo-updated",
			Path:         "/path/to/upsert/updated",
			Branch:       "develop",
			Remote:       "upstream",
			BranchPrefix: "fix",
			CustomPrefix: "v2",
			CreatedAt:    time.Now(),
		}
		require.NoError(t, s.AddRepo(ctx, repo2))

		got, err := s.GetRepo(ctx, "repo-upsert-settings")
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Equal(t, "upsert-repo-updated", got.Name)
		assert.Equal(t, "/path/to/upsert/updated", got.Path)
		assert.Equal(t, "develop", got.Branch)
		assert.Equal(t, "upstream", got.Remote)
		assert.Equal(t, "fix", got.BranchPrefix)
		assert.Equal(t, "v2", got.CustomPrefix)

		// Verify only one repo exists
		repos, err := s.ListRepos(ctx)
		require.NoError(t, err)
		count := 0
		for _, r := range repos {
			if r.ID == "repo-upsert-settings" {
				count++
			}
		}
		assert.Equal(t, 1, count)
	})
}

func TestGetRepo_ReadsNewColumns(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	repo := &models.Repo{
		ID:           "repo-get-cols",
		Name:         "get-cols-repo",
		Path:         "/path/to/get-cols",
		Branch:       "main",
		Remote:       "upstream",
		BranchPrefix: "feat",
		CustomPrefix: "project-x",
		CreatedAt:    time.Now(),
	}
	require.NoError(t, s.AddRepo(ctx, repo))

	got, err := s.GetRepo(ctx, "repo-get-cols")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "upstream", got.Remote)
	assert.Equal(t, "feat", got.BranchPrefix)
	assert.Equal(t, "project-x", got.CustomPrefix)
}

func TestListRepos_ReadsNewColumns(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	repo1 := &models.Repo{
		ID:           "repo-list-1",
		Name:         "list-repo-1",
		Path:         "/path/to/list-1",
		Branch:       "main",
		Remote:       "origin",
		BranchPrefix: "feat",
		CustomPrefix: "alpha",
		CreatedAt:    time.Now(),
	}
	repo2 := &models.Repo{
		ID:           "repo-list-2",
		Name:         "list-repo-2",
		Path:         "/path/to/list-2",
		Branch:       "develop",
		Remote:       "upstream",
		BranchPrefix: "fix",
		CustomPrefix: "beta",
		CreatedAt:    time.Now(),
	}
	require.NoError(t, s.AddRepo(ctx, repo1))
	require.NoError(t, s.AddRepo(ctx, repo2))

	repos, err := s.ListRepos(ctx)
	require.NoError(t, err)
	require.Len(t, repos, 2)

	byID := map[string]*models.Repo{}
	for _, r := range repos {
		byID[r.ID] = r
	}

	assert.Equal(t, "origin", byID["repo-list-1"].Remote)
	assert.Equal(t, "feat", byID["repo-list-1"].BranchPrefix)
	assert.Equal(t, "alpha", byID["repo-list-1"].CustomPrefix)

	assert.Equal(t, "upstream", byID["repo-list-2"].Remote)
	assert.Equal(t, "fix", byID["repo-list-2"].BranchPrefix)
	assert.Equal(t, "beta", byID["repo-list-2"].CustomPrefix)
}

func TestGetRepoByPath_ReadsNewColumns(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	repo := &models.Repo{
		ID:           "repo-bypath-cols",
		Name:         "bypath-repo",
		Path:         "/unique/path/for/test",
		Branch:       "main",
		Remote:       "upstream",
		BranchPrefix: "chore",
		CustomPrefix: "team-beta",
		CreatedAt:    time.Now(),
	}
	require.NoError(t, s.AddRepo(ctx, repo))

	got, err := s.GetRepoByPath(ctx, "/unique/path/for/test")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "upstream", got.Remote)
	assert.Equal(t, "chore", got.BranchPrefix)
	assert.Equal(t, "team-beta", got.CustomPrefix)
}

func TestGetSessionWithWorkspace_IncludesWorkspaceRemote(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	t.Run("returns workspace remote when set", func(t *testing.T) {
		repo := &models.Repo{
			ID:        "ws-remote-1",
			Name:      "remote-repo",
			Path:      "/path/to/remote-repo",
			Branch:    "main",
			Remote:    "upstream",
			CreatedAt: time.Now(),
		}
		require.NoError(t, s.AddRepo(ctx, repo))
		createTestSession(t, s, "sess-remote-1", "ws-remote-1")

		result, err := s.GetSessionWithWorkspace(ctx, "sess-remote-1")
		require.NoError(t, err)
		require.NotNil(t, result)
		assert.Equal(t, "upstream", result.WorkspaceRemote)
		assert.Equal(t, "/path/to/remote-repo", result.WorkspacePath)
		assert.Equal(t, "main", result.WorkspaceBranch)
	})

	t.Run("returns empty string when remote not set", func(t *testing.T) {
		createTestRepo(t, s, "ws-remote-2")
		createTestSession(t, s, "sess-remote-2", "ws-remote-2")

		result, err := s.GetSessionWithWorkspace(ctx, "sess-remote-2")
		require.NoError(t, err)
		require.NotNil(t, result)
		assert.Equal(t, "", result.WorkspaceRemote)
	})
}

// ============================================================================
// Edge Case Tests
// ============================================================================

func TestAddMessage_LargeContent(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	repo := createTestRepo(t, s, "repo-large")
	session := createTestSession(t, s, "sess-large", repo.ID)
	conv := createTestConversation(t, s, "conv-large", session.ID)

	largeContent := strings.Repeat("x", 100*1024) // 100KB
	msg := createTestMessage("msg-large", "assistant", largeContent)

	require.NoError(t, s.AddMessageToConversation(ctx, conv.ID, msg))

	// Retrieve via paginated endpoint
	page, err := s.GetConversationMessages(ctx, conv.ID, nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 1)
	assert.Len(t, page.Messages[0].Content, 100*1024)
	assert.Equal(t, largeContent, page.Messages[0].Content)
}

func TestAddMessage_SpecialCharacters(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	repo := createTestRepo(t, s, "repo-special")
	session := createTestSession(t, s, "sess-special", repo.ID)
	conv := createTestConversation(t, s, "conv-special", session.ID)

	// Unicode, emoji, null-like sequences, SQL injection attempts
	specialContent := "Hello \u4e16\u754c \U0001F680\U0001F30D \x00-like \\0 NULL nil ' OR 1=1 --; DROP TABLE messages;"

	msg := createTestMessage("msg-special", "user", specialContent)
	require.NoError(t, s.AddMessageToConversation(ctx, conv.ID, msg))

	page, err := s.GetConversationMessages(ctx, conv.ID, nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Messages, 1)
	assert.Equal(t, specialContent, page.Messages[0].Content)
}

func TestDeleteSession_CascadesConversationsAndMessages(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	repo := createTestRepo(t, s, "repo-cascade-sess")
	session := createTestSession(t, s, "sess-cascade", repo.ID)
	conv := createTestConversation(t, s, "conv-cascade", session.ID)

	msg := createTestMessage("msg-cascade", "user", "will be deleted")
	require.NoError(t, s.AddMessageToConversation(ctx, conv.ID, msg))

	// Verify everything exists
	gotSession, err := s.GetSession(ctx, "sess-cascade")
	require.NoError(t, err)
	require.NotNil(t, gotSession)

	gotConv, err := s.GetConversation(ctx, "conv-cascade")
	require.NoError(t, err)
	require.NotNil(t, gotConv)

	count, err := s.GetConversationMessageCount(ctx, "conv-cascade")
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Delete the session
	require.NoError(t, s.DeleteSession(ctx, "sess-cascade"))

	// Session gone
	gotSession, err = s.GetSession(ctx, "sess-cascade")
	require.NoError(t, err)
	assert.Nil(t, gotSession)

	// Conversation gone (cascade)
	gotConv, err = s.GetConversation(ctx, "conv-cascade")
	require.NoError(t, err)
	assert.Nil(t, gotConv)

	// Messages gone (cascade)
	count, err = s.GetConversationMessageCount(ctx, "conv-cascade")
	require.NoError(t, err)
	assert.Equal(t, 0, count)
}

func TestDeleteRepo_CascadesAll(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	repo := createTestRepo(t, s, "repo-cascade-all")
	session := createTestSession(t, s, "sess-cascade-all", repo.ID)
	conv := createTestConversation(t, s, "conv-cascade-all", session.ID)

	msg := createTestMessage("msg-cascade-all", "assistant", "cascading content")
	require.NoError(t, s.AddMessageToConversation(ctx, conv.ID, msg))

	// Verify everything exists
	gotRepo, err := s.GetRepo(ctx, "repo-cascade-all")
	require.NoError(t, err)
	require.NotNil(t, gotRepo)

	// Delete the repo
	require.NoError(t, s.DeleteRepo(ctx, "repo-cascade-all"))

	// Repo gone
	gotRepo, err = s.GetRepo(ctx, "repo-cascade-all")
	require.NoError(t, err)
	assert.Nil(t, gotRepo)

	// Session gone (cascade through repos -> sessions)
	gotSession, err := s.GetSession(ctx, "sess-cascade-all")
	require.NoError(t, err)
	assert.Nil(t, gotSession)

	// Conversation gone (cascade through sessions -> conversations)
	gotConv, err := s.GetConversation(ctx, "conv-cascade-all")
	require.NoError(t, err)
	assert.Nil(t, gotConv)

	// Messages gone (cascade through conversations -> messages)
	count, err := s.GetConversationMessageCount(ctx, "conv-cascade-all")
	require.NoError(t, err)
	assert.Equal(t, 0, count)
}

func TestListSessions_PinnedOrdering(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-pinned-order")

	now := time.Now()

	// Create sessions with different pinned/time combinations
	sessions := []*models.Session{
		{
			ID:          "s-old-unpinned",
			WorkspaceID: "ws-pinned-order",
			Name:        "Old Unpinned",
			Status:      "idle",
			Pinned:      false,
			CreatedAt:   now.Add(-3 * time.Hour),
			UpdatedAt:   now.Add(-3 * time.Hour),
		},
		{
			ID:          "s-new-unpinned",
			WorkspaceID: "ws-pinned-order",
			Name:        "New Unpinned",
			Status:      "idle",
			Pinned:      false,
			CreatedAt:   now.Add(-1 * time.Hour),
			UpdatedAt:   now.Add(-1 * time.Hour),
		},
		{
			ID:          "s-old-pinned",
			WorkspaceID: "ws-pinned-order",
			Name:        "Old Pinned",
			Status:      "idle",
			Pinned:      true,
			CreatedAt:   now.Add(-4 * time.Hour),
			UpdatedAt:   now.Add(-4 * time.Hour),
		},
		{
			ID:          "s-new-pinned",
			WorkspaceID: "ws-pinned-order",
			Name:        "New Pinned",
			Status:      "idle",
			Pinned:      true,
			CreatedAt:   now.Add(-2 * time.Hour),
			UpdatedAt:   now.Add(-2 * time.Hour),
		},
	}

	for _, sess := range sessions {
		require.NoError(t, s.AddSession(ctx, sess))
	}

	result, err := s.ListSessions(ctx, "ws-pinned-order", true)
	require.NoError(t, err)
	require.Len(t, result, 4)

	// Pinned sessions should come first
	assert.True(t, result[0].Pinned, "first session should be pinned")
	assert.True(t, result[1].Pinned, "second session should be pinned")
	assert.False(t, result[2].Pinned, "third session should not be pinned")
	assert.False(t, result[3].Pinned, "fourth session should not be pinned")
}

func TestGetSessionWithWorkspace_NotFound(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	result, err := s.GetSessionWithWorkspace(ctx, "nonexistent-session")
	require.NoError(t, err)
	assert.Nil(t, result)
}

func TestAddConversation_ForeignKeyViolation(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	conv := &models.Conversation{
		ID:        "conv-orphan",
		SessionID: "nonexistent-session",
		Type:      models.ConversationTypeTask,
		Name:      "Orphan Conversation",
		Status:    models.ConversationStatusActive,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	err := s.AddConversation(ctx, conv)
	assert.Error(t, err, "should fail with foreign key violation for nonexistent session")
}

func TestListConversationsForSessions_MultipleIDs(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	repo := createTestRepo(t, s, "repo-multi-conv")

	// Create two sessions
	session1 := createTestSession(t, s, "sess-multi-1", repo.ID)
	session2 := createTestSession(t, s, "sess-multi-2", repo.ID)

	// Create conversations under each session
	createTestConversation(t, s, "conv-s1-a", session1.ID)
	createTestConversation(t, s, "conv-s1-b", session1.ID)
	createTestConversation(t, s, "conv-s2-a", session2.ID)

	result, err := s.ListConversationsForSessions(ctx, []string{session1.ID, session2.ID})
	require.NoError(t, err)

	// Check correct grouping
	assert.Len(t, result[session1.ID], 2, "session1 should have 2 conversations")
	assert.Len(t, result[session2.ID], 1, "session2 should have 1 conversation")

	// Verify conversation IDs in session1 group
	s1IDs := make(map[string]bool)
	for _, c := range result[session1.ID] {
		s1IDs[c.ID] = true
	}
	assert.True(t, s1IDs["conv-s1-a"])
	assert.True(t, s1IDs["conv-s1-b"])

	// Verify conversation IDs in session2 group
	assert.Equal(t, "conv-s2-a", result[session2.ID][0].ID)
}

func TestUpdateConversation_NotExists(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	// Updating a nonexistent conversation should not error (returns nil)
	err := s.UpdateConversation(ctx, "nonexistent-conv", func(c *models.Conversation) {
		c.Name = "Updated Name"
	})
	assert.NoError(t, err)
}

func TestStreamingSnapshot_CRUD(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	repo := createTestRepo(t, s, "repo-snap")
	session := createTestSession(t, s, "sess-snap", repo.ID)
	conv := createTestConversation(t, s, "conv-snap", session.ID)

	// Get - should be nil initially
	got, err := s.GetStreamingSnapshot(ctx, conv.ID)
	require.NoError(t, err)
	assert.Nil(t, got)

	// Set
	snapshot := map[string]interface{}{
		"text":        "snapshot content",
		"activeTools": []interface{}{},
		"isThinking":  true,
	}
	data, err := json.Marshal(snapshot)
	require.NoError(t, err)
	require.NoError(t, s.SetStreamingSnapshot(ctx, conv.ID, data))

	// Get - should have content
	got, err = s.GetStreamingSnapshot(ctx, conv.ID)
	require.NoError(t, err)
	require.NotNil(t, got)
	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal(got, &parsed))
	assert.Equal(t, "snapshot content", parsed["text"])
	assert.True(t, parsed["isThinking"].(bool))

	// Clear
	require.NoError(t, s.ClearStreamingSnapshot(ctx, conv.ID))

	// Get - should be nil again
	got, err = s.GetStreamingSnapshot(ctx, conv.ID)
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestFileTabs_CRUD(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	createTestRepo(t, s, "ws-tabs")

	now := time.Now()

	tabs := []*models.FileTab{
		{
			ID:             "tab-1",
			WorkspaceID:    "ws-tabs",
			Path:           "/src/main.go",
			ViewMode:       "file",
			IsPinned:       true,
			Position:       0,
			OpenedAt:       now,
			LastAccessedAt: now,
		},
		{
			ID:             "tab-2",
			WorkspaceID:    "ws-tabs",
			Path:           "/src/utils.go",
			ViewMode:       "diff",
			IsPinned:       false,
			Position:       1,
			OpenedAt:       now,
			LastAccessedAt: now,
		},
	}

	// SaveFileTabs
	require.NoError(t, s.SaveFileTabs(ctx, "ws-tabs", tabs))

	// ListFileTabs
	listed, err := s.ListFileTabs(ctx, "ws-tabs")
	require.NoError(t, err)
	require.Len(t, listed, 2)

	// Should be ordered by position
	assert.Equal(t, "tab-1", listed[0].ID)
	assert.Equal(t, "/src/main.go", listed[0].Path)
	assert.Equal(t, "file", listed[0].ViewMode)
	assert.True(t, listed[0].IsPinned)
	assert.Equal(t, 0, listed[0].Position)

	assert.Equal(t, "tab-2", listed[1].ID)
	assert.Equal(t, "/src/utils.go", listed[1].Path)
	assert.Equal(t, "diff", listed[1].ViewMode)
	assert.False(t, listed[1].IsPinned)
	assert.Equal(t, 1, listed[1].Position)

	// DeleteFileTab
	require.NoError(t, s.DeleteFileTab(ctx, "tab-1"))

	listed, err = s.ListFileTabs(ctx, "ws-tabs")
	require.NoError(t, err)
	require.Len(t, listed, 1)
	assert.Equal(t, "tab-2", listed[0].ID)
}

func TestUpdateSession_ConcurrentWrites(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	// Limit to 1 connection so all goroutines share the same in-memory DB
	s.db.SetMaxOpenConns(1)

	createTestRepo(t, s, "ws-concurrent")
	createTestSession(t, s, "sess-concurrent", "ws-concurrent")

	var wg sync.WaitGroup
	errors := make([]error, 10)

	for i := 0; i < 10; i++ {
		wg.Add(1)
		idx := i
		go func() {
			defer wg.Done()
			errors[idx] = s.UpdateSession(ctx, "sess-concurrent", func(sess *models.Session) {
				sess.Task = fmt.Sprintf("Updated by writer %d", idx)
			})
		}()
	}

	wg.Wait()

	// All updates should succeed (SQLite retry handles contention)
	for i, err := range errors {
		assert.NoError(t, err, "writer %d should not error", i)
	}

	// Verify the session is still valid (not corrupted)
	got, err := s.GetSession(ctx, "sess-concurrent")
	require.NoError(t, err)
	require.NotNil(t, got)

	// The task should reflect one of the 10 writers
	assert.Contains(t, got.Task, "Updated by writer")
	assert.NotEmpty(t, got.Status)
	assert.NotEmpty(t, got.Name)
}
