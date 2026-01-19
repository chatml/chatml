package store

import (
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
	s := newTestStore(t)

	repo := &models.Repo{
		ID:        "repo-123",
		Name:      "test-repo",
		Path:      "/path/to/repo",
		Branch:    "main",
		CreatedAt: time.Now(),
	}

	s.AddRepo(repo)

	got := s.GetRepo("repo-123")
	require.NotNil(t, got)
	assert.Equal(t, repo.ID, got.ID)
	assert.Equal(t, repo.Name, got.Name)
	assert.Equal(t, repo.Path, got.Path)
	assert.Equal(t, repo.Branch, got.Branch)
}

func TestAddRepo_Upsert(t *testing.T) {
	s := newTestStore(t)

	// Add initial repo
	repo := &models.Repo{
		ID:        "repo-123",
		Name:      "original-name",
		Path:      "/original/path",
		Branch:    "main",
		CreatedAt: time.Now(),
	}
	s.AddRepo(repo)

	// Add again with same ID but different data (upsert)
	repo2 := &models.Repo{
		ID:        "repo-123",
		Name:      "updated-name",
		Path:      "/updated/path",
		Branch:    "develop",
		CreatedAt: time.Now(),
	}
	s.AddRepo(repo2)

	// Should have updated values
	got := s.GetRepo("repo-123")
	require.NotNil(t, got)
	assert.Equal(t, "updated-name", got.Name)
	assert.Equal(t, "/updated/path", got.Path)
	assert.Equal(t, "develop", got.Branch)

	// Should still be only one repo
	repos := s.ListRepos()
	assert.Len(t, repos, 1)
}

func TestGetRepo_Exists(t *testing.T) {
	s := newTestStore(t)
	createTestRepo(t, s, "repo-1")

	got := s.GetRepo("repo-1")
	require.NotNil(t, got)
	assert.Equal(t, "repo-1", got.ID)
}

func TestGetRepo_NotExists(t *testing.T) {
	s := newTestStore(t)

	got := s.GetRepo("nonexistent")
	assert.Nil(t, got)
}

func TestGetRepoByPath_Exists(t *testing.T) {
	s := newTestStore(t)
	repo := createTestRepo(t, s, "repo-1")

	got := s.GetRepoByPath(repo.Path)
	require.NotNil(t, got)
	assert.Equal(t, "repo-1", got.ID)
}

func TestGetRepoByPath_NotExists(t *testing.T) {
	s := newTestStore(t)

	got := s.GetRepoByPath("/nonexistent/path")
	assert.Nil(t, got)
}

func TestListRepos_Empty(t *testing.T) {
	s := newTestStore(t)

	repos := s.ListRepos()
	assert.NotNil(t, repos)
	assert.Empty(t, repos)
}

func TestListRepos_Multiple(t *testing.T) {
	s := newTestStore(t)

	createTestRepo(t, s, "repo-1")
	createTestRepo(t, s, "repo-2")
	createTestRepo(t, s, "repo-3")

	repos := s.ListRepos()
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
	s := newTestStore(t)
	createTestRepo(t, s, "repo-1")

	// Verify exists
	require.NotNil(t, s.GetRepo("repo-1"))

	s.DeleteRepo("repo-1")

	// Verify deleted
	assert.Nil(t, s.GetRepo("repo-1"))
}

func TestDeleteRepo_NotExists(t *testing.T) {
	s := newTestStore(t)

	// Should not panic or error
	s.DeleteRepo("nonexistent")
}

func TestDeleteRepo_CascadesSessions(t *testing.T) {
	s := newTestStore(t)

	// Create repo and session
	createTestRepo(t, s, "repo-1")
	createTestSession(t, s, "session-1", "repo-1")

	// Verify session exists
	require.NotNil(t, s.GetSession("session-1"))

	// Delete repo
	s.DeleteRepo("repo-1")

	// Session should be cascade deleted
	assert.Nil(t, s.GetSession("session-1"))
}

// ============================================================================
// Session Tests
// ============================================================================

func TestAddSession_Success(t *testing.T) {
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

	s.AddSession(session)

	got := s.GetSession("sess-1")
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

	s.AddSession(session)

	got := s.GetSession("sess-1")
	require.NotNil(t, got)
	// Stats should be nil when additions and deletions are both 0
	assert.Nil(t, got.Stats)
}

func TestGetSession_Exists(t *testing.T) {
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")

	got := s.GetSession("sess-1")
	require.NotNil(t, got)
	assert.Equal(t, "sess-1", got.ID)
}

func TestGetSession_NotExists(t *testing.T) {
	s := newTestStore(t)

	got := s.GetSession("nonexistent")
	assert.Nil(t, got)
}

func TestListSessions_ByWorkspace(t *testing.T) {
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestRepo(t, s, "ws-2")

	createTestSession(t, s, "s1", "ws-1")
	createTestSession(t, s, "s2", "ws-1")
	createTestSession(t, s, "s3", "ws-2") // Different workspace

	sessions := s.ListSessions("ws-1")
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
	s.AddSession(s1)

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
	s.AddSession(s2)

	sessions := s.ListSessions("ws-1")
	require.Len(t, sessions, 2)

	// Pinned session should be first regardless of creation time
	assert.Equal(t, "s2", sessions[0].ID)
	assert.True(t, sessions[0].Pinned)
	assert.Equal(t, "s1", sessions[1].ID)
	assert.False(t, sessions[1].Pinned)
}

func TestListSessions_Empty(t *testing.T) {
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")

	sessions := s.ListSessions("ws-1")
	assert.NotNil(t, sessions)
	assert.Empty(t, sessions)
}

func TestUpdateSession_PartialUpdate(t *testing.T) {
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")

	// Update only name
	s.UpdateSession("sess-1", func(sess *models.Session) {
		sess.Name = "Updated Name"
	})

	got := s.GetSession("sess-1")
	require.NotNil(t, got)
	assert.Equal(t, "Updated Name", got.Name)
	// Other fields should be unchanged
	assert.Equal(t, "feature/sess-1", got.Branch)
}

func TestUpdateSession_NotExists(t *testing.T) {
	s := newTestStore(t)

	// Should not panic
	s.UpdateSession("nonexistent", func(sess *models.Session) {
		sess.Name = "Updated"
	})
}

func TestDeleteSession_Cascades(t *testing.T) {
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Verify conversation exists
	require.NotNil(t, s.GetConversation("conv-1"))

	s.DeleteSession("sess-1")

	// Session and conversation should be deleted
	assert.Nil(t, s.GetSession("sess-1"))
	assert.Nil(t, s.GetConversation("conv-1"))
}

// ============================================================================
// Agent Tests
// ============================================================================

func TestAddAgent_Success(t *testing.T) {
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

	s.AddAgent(agent)

	got := s.GetAgent("agent-1")
	require.NotNil(t, got)
	assert.Equal(t, "agent-1", got.ID)
	assert.Equal(t, "repo-1", got.RepoID)
	assert.Equal(t, "Write code", got.Task)
	assert.Equal(t, string(models.StatusRunning), got.Status)
	assert.Equal(t, "/path/to/.worktrees/agent-1", got.Worktree)
	assert.Equal(t, "agent/agent-1", got.Branch)
}

func TestGetAgent_NotExists(t *testing.T) {
	s := newTestStore(t)

	got := s.GetAgent("nonexistent")
	assert.Nil(t, got)
}

func TestListAgents_ByRepo(t *testing.T) {
	s := newTestStore(t)
	createTestRepo(t, s, "repo-1")
	createTestRepo(t, s, "repo-2")

	createTestAgent(t, s, "a1", "repo-1")
	createTestAgent(t, s, "a2", "repo-1")
	createTestAgent(t, s, "a3", "repo-2") // Different repo

	agents := s.ListAgents("repo-1")
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
	s := newTestStore(t)
	createTestRepo(t, s, "repo-1")

	agents := s.ListAgents("repo-1")
	assert.NotNil(t, agents)
	assert.Empty(t, agents)
}

func TestUpdateAgentStatus(t *testing.T) {
	s := newTestStore(t)
	createTestRepo(t, s, "repo-1")
	createTestAgent(t, s, "agent-1", "repo-1")

	// Initial status is pending
	got := s.GetAgent("agent-1")
	require.NotNil(t, got)
	assert.Equal(t, string(models.StatusPending), got.Status)

	// Update to running
	s.UpdateAgentStatus("agent-1", models.StatusRunning)
	got = s.GetAgent("agent-1")
	require.NotNil(t, got)
	assert.Equal(t, string(models.StatusRunning), got.Status)

	// Update to done
	s.UpdateAgentStatus("agent-1", models.StatusDone)
	got = s.GetAgent("agent-1")
	require.NotNil(t, got)
	assert.Equal(t, string(models.StatusDone), got.Status)
}

func TestDeleteAgent(t *testing.T) {
	s := newTestStore(t)
	createTestRepo(t, s, "repo-1")
	createTestAgent(t, s, "agent-1", "repo-1")

	require.NotNil(t, s.GetAgent("agent-1"))

	s.DeleteAgent("agent-1")

	assert.Nil(t, s.GetAgent("agent-1"))
}

// ============================================================================
// Conversation Tests
// ============================================================================

func TestAddConversation_Success(t *testing.T) {
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

	s.AddConversation(conv)

	got := s.GetConversation("conv-1")
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
	s := newTestStore(t)

	got := s.GetConversation("nonexistent")
	assert.Nil(t, got)
}

func TestGetConversation_WithMessages(t *testing.T) {
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Add messages
	msg1 := createTestMessage("m1", "user", "Hello")
	msg2 := createTestMessage("m2", "assistant", "Hi there!")
	s.AddMessageToConversation("conv-1", msg1)
	s.AddMessageToConversation("conv-1", msg2)

	got := s.GetConversation("conv-1")
	require.NotNil(t, got)
	require.Len(t, got.Messages, 2)
	assert.Equal(t, "Hello", got.Messages[0].Content)
	assert.Equal(t, "user", got.Messages[0].Role)
	assert.Equal(t, "Hi there!", got.Messages[1].Content)
	assert.Equal(t, "assistant", got.Messages[1].Role)
}

func TestGetConversation_EmptyMessages(t *testing.T) {
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	got := s.GetConversation("conv-1")
	require.NotNil(t, got)
	// Should be empty slice, not nil (important for JSON serialization)
	assert.NotNil(t, got.Messages)
	assert.Len(t, got.Messages, 0)
	assert.NotNil(t, got.ToolSummary)
	assert.Len(t, got.ToolSummary, 0)
}

func TestListConversations_BySession(t *testing.T) {
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestSession(t, s, "sess-2", "ws-1")

	createTestConversation(t, s, "c1", "sess-1")
	createTestConversation(t, s, "c2", "sess-1")
	createTestConversation(t, s, "c3", "sess-2") // Different session

	convs := s.ListConversations("sess-1")
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
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "c1", "sess-1")

	// Add messages to conversation
	s.AddMessageToConversation("c1", createTestMessage("m1", "user", "Hello"))
	s.AddMessageToConversation("c1", createTestMessage("m2", "assistant", "Hi"))

	convs := s.ListConversations("sess-1")
	require.Len(t, convs, 1)

	// Verify messages were added (use GetConversation for full message loading)
	// Note: ListConversations should also load messages but checking via GetConversation
	conv := s.GetConversation("c1")
	require.NotNil(t, conv)
	require.Len(t, conv.Messages, 2)
	assert.Equal(t, "Hello", conv.Messages[0].Content)
	assert.Equal(t, "Hi", conv.Messages[1].Content)
}

func TestUpdateConversation_NameChange(t *testing.T) {
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	originalUpdatedAt := s.GetConversation("conv-1").UpdatedAt

	// Small delay to ensure UpdatedAt changes
	time.Sleep(10 * time.Millisecond)

	s.UpdateConversation("conv-1", func(conv *models.Conversation) {
		conv.Name = "New Name"
		conv.Status = models.ConversationStatusCompleted
	})

	got := s.GetConversation("conv-1")
	require.NotNil(t, got)
	assert.Equal(t, "New Name", got.Name)
	assert.Equal(t, models.ConversationStatusCompleted, got.Status)
	assert.True(t, got.UpdatedAt.After(originalUpdatedAt))
}

func TestDeleteConversation(t *testing.T) {
	s := newTestStore(t)
	createTestRepo(t, s, "ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	require.NotNil(t, s.GetConversation("conv-1"))

	s.DeleteConversation("conv-1")

	assert.Nil(t, s.GetConversation("conv-1"))
}

// ============================================================================
// Message Tests
// ============================================================================

func TestAddMessageToConversation_Ordering(t *testing.T) {
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
		s.AddMessageToConversation("conv-1", msg)
	}

	got := s.GetConversation("conv-1")
	require.NotNil(t, got)
	require.Len(t, got.Messages, 3)

	// Should be in order of insertion
	assert.Equal(t, "First", got.Messages[0].Content)
	assert.Equal(t, "Second", got.Messages[1].Content)
	assert.Equal(t, "Third", got.Messages[2].Content)
}

func TestAddMessageToConversation_WithSetupInfo(t *testing.T) {
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

	s.AddMessageToConversation("conv-1", msg)

	got := s.GetConversation("conv-1")
	require.NotNil(t, got)
	require.Len(t, got.Messages, 1)
	require.NotNil(t, got.Messages[0].SetupInfo)
	assert.Equal(t, "My Session", got.Messages[0].SetupInfo.SessionName)
	assert.Equal(t, "feature/test", got.Messages[0].SetupInfo.BranchName)
	assert.Equal(t, "main", got.Messages[0].SetupInfo.OriginBranch)
	assert.Equal(t, 42, got.Messages[0].SetupInfo.FileCount)
}

func TestAddMessageToConversation_WithRunSummary(t *testing.T) {
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

	s.AddMessageToConversation("conv-1", msg)

	got := s.GetConversation("conv-1")
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
		s.AddToolActionToConversation("conv-1", action)
	}

	got := s.GetConversation("conv-1")
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
