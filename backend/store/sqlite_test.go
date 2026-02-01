package store

import (
	"context"
	"fmt"
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
