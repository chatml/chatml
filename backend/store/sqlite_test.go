package store

import (
	"context"
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
	require.Len(t, got.Messages, 2)
	assert.Equal(t, "Hello", got.Messages[0].Content)
	assert.Equal(t, "user", got.Messages[0].Role)
	assert.Equal(t, "Hi there!", got.Messages[1].Content)
	assert.Equal(t, "assistant", got.Messages[1].Role)
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

	// Verify messages are loaded directly by ListConversations
	require.Len(t, convs[0].Messages, 2)
	assert.Equal(t, "Hello", convs[0].Messages[0].Content)
	assert.Equal(t, "Hi", convs[0].Messages[1].Content)
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

	got, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Len(t, got.Messages, 3)

	// Should be in order of insertion
	assert.Equal(t, "First", got.Messages[0].Content)
	assert.Equal(t, "Second", got.Messages[1].Content)
	assert.Equal(t, "Third", got.Messages[2].Content)
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

	got, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Len(t, got.Messages, 1)
	require.NotNil(t, got.Messages[0].SetupInfo)
	assert.Equal(t, "My Session", got.Messages[0].SetupInfo.SessionName)
	assert.Equal(t, "feature/test", got.Messages[0].SetupInfo.BranchName)
	assert.Equal(t, "main", got.Messages[0].SetupInfo.OriginBranch)
	assert.Equal(t, 42, got.Messages[0].SetupInfo.FileCount)
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

	got, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Len(t, got.Messages, 1)
	require.NotNil(t, got.Messages[0].RunSummary)
	assert.True(t, got.Messages[0].RunSummary.Success)
	assert.Equal(t, 0.05, got.Messages[0].RunSummary.Cost)
	assert.Equal(t, 3, got.Messages[0].RunSummary.Turns)
	assert.Equal(t, 5000, got.Messages[0].RunSummary.DurationMs)
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

	// But full has messages, meta does not
	assert.Len(t, full.Messages, 1)
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

	// GetConversation should load attachments but WITHOUT base64_data
	conv, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.Len(t, conv.Messages, 1)
	require.Len(t, conv.Messages[0].Attachments, 1)

	loadedAtt := conv.Messages[0].Attachments[0]
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

	convs, err := s.ListConversations(ctx, "sess-1")
	require.NoError(t, err)
	require.Len(t, convs, 1)
	require.Len(t, convs[0].Messages, 1)
	require.Len(t, convs[0].Messages[0].Attachments, 1)

	loadedAtt := convs[0].Messages[0].Attachments[0]
	assert.Equal(t, "att-1", loadedAtt.ID)
	assert.Equal(t, "img.png", loadedAtt.Name)
	assert.Empty(t, loadedAtt.Base64Data, "base64Data should not be loaded in list queries")
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

	// List query should NOT have base64
	conv, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.Len(t, conv.Messages[0].Attachments, 1)
	assert.Empty(t, conv.Messages[0].Attachments[0].Base64Data)

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
	require.Len(t, convs[0].Messages, 1)
	require.Len(t, convs[0].Messages[0].Attachments, 1)

	loadedAtt := convs[0].Messages[0].Attachments[0]
	assert.Equal(t, "att-batch", loadedAtt.ID)
	assert.Empty(t, loadedAtt.Base64Data, "base64Data should not be loaded in batch queries")
}
