package store

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/require"
	_ "modernc.org/sqlite"
)

// newTestStore creates a new SQLiteStore using an in-memory database for testing.
// The database is automatically cleaned up when the test ends.
func newTestStore(t *testing.T) *SQLiteStore {
	t.Helper()

	// Use in-memory database with foreign keys enabled
	db, err := sql.Open("sqlite", ":memory:?_pragma=foreign_keys(1)")
	require.NoError(t, err)

	s := &SQLiteStore{
		db:     db,
		dbPath: "",
	}

	// Initialize schema
	require.NoError(t, s.initSchema())

	// Register cleanup
	t.Cleanup(func() {
		db.Close()
	})

	return s
}

// createTestRepo creates a test repo with sensible defaults
func createTestRepo(t *testing.T, s *SQLiteStore, id string) *models.Repo {
	t.Helper()
	ctx := context.Background()
	repo := &models.Repo{
		ID:        id,
		Name:      "test-repo-" + id,
		Path:      "/path/to/" + id,
		Branch:    "main",
		CreatedAt: time.Now(),
	}
	require.NoError(t, s.AddRepo(ctx, repo))
	return repo
}

// createTestSession creates a test session with sensible defaults
func createTestSession(t *testing.T, s *SQLiteStore, id, workspaceID string) *models.Session {
	t.Helper()
	ctx := context.Background()
	session := &models.Session{
		ID:          id,
		WorkspaceID: workspaceID,
		Name:        "test-session-" + id,
		Branch:      "feature/" + id,
		Task:        "Test task for " + id,
		Status:      "idle",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))
	return session
}

// createTestConversation creates a test conversation with sensible defaults
func createTestConversation(t *testing.T, s *SQLiteStore, id, sessionID string) *models.Conversation {
	t.Helper()
	ctx := context.Background()
	conv := &models.Conversation{
		ID:        id,
		SessionID: sessionID,
		Type:      models.ConversationTypeTask,
		Name:      "Test Conversation " + id,
		Status:    models.ConversationStatusActive,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	require.NoError(t, s.AddConversation(ctx, conv))
	return conv
}

// createTestAgent creates a test agent with sensible defaults
func createTestAgent(t *testing.T, s *SQLiteStore, id, repoID string) *models.Agent {
	t.Helper()
	ctx := context.Background()
	agent := &models.Agent{
		ID:        id,
		RepoID:    repoID,
		Task:      "Test task for agent " + id,
		Status:    string(models.StatusPending),
		Worktree:  "/path/to/.worktrees/" + id,
		Branch:    "agent/" + id,
		CreatedAt: time.Now(),
	}
	require.NoError(t, s.AddAgent(ctx, agent))
	return agent
}

// createTestMessage creates a test message
func createTestMessage(id, role, content string) models.Message {
	return models.Message{
		ID:        id,
		Role:      role,
		Content:   content,
		Timestamp: time.Now(),
	}
}

// createTestToolAction creates a test tool action
func createTestToolAction(id, tool, target string, success bool) models.ToolAction {
	return models.ToolAction{
		ID:      id,
		Tool:    tool,
		Target:  target,
		Success: success,
	}
}
