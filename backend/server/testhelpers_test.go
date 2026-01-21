package server

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
)

// setupTestHandlers creates handlers for testing
// Note: agentManager is nil, tests that need it should use setupTestHandlersWithAgentManager
func setupTestHandlers(t *testing.T) (*Handlers, *store.SQLiteStore) {
	t.Helper()

	// Create temp directory for HOME
	tmpDir := t.TempDir()
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpDir)

	sqliteStore, err := store.NewSQLiteStore()
	require.NoError(t, err)

	t.Cleanup(func() {
		sqliteStore.Close()
		os.Setenv("HOME", origHome)
	})

	handlers := NewHandlers(sqliteStore, nil)

	return handlers, sqliteStore
}

// setupTestHandlersWithAgentManager creates handlers with a real agentManager for testing
// Use this for tests that call methods requiring agentManager (e.g., DeleteConversation)
func setupTestHandlersWithAgentManager(t *testing.T) (*Handlers, *store.SQLiteStore, *agent.Manager) {
	t.Helper()

	// Create temp directory for HOME
	tmpDir := t.TempDir()
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpDir)

	sqliteStore, err := store.NewSQLiteStore()
	require.NoError(t, err)

	worktreeManager := git.NewWorktreeManager()
	agentManager := agent.NewManager(sqliteStore, worktreeManager)

	t.Cleanup(func() {
		sqliteStore.Close()
		os.Setenv("HOME", origHome)
	})

	handlers := NewHandlers(sqliteStore, agentManager)

	return handlers, sqliteStore, agentManager
}

// createTestGitRepo creates a temporary git repository for testing
func createTestGitRepo(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()

	runGit(t, dir, "init")
	runGit(t, dir, "config", "user.email", "test@test.com")
	runGit(t, dir, "config", "user.name", "Test User")

	// Create initial commit
	writeFile(t, dir, "README.md", "# Test Repository")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "Initial commit")

	return dir
}

// runGit executes a git command
func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()

	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "git %v failed: %s", args, string(out))
}

// writeFile creates a file with content
func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()

	path := filepath.Join(dir, name)
	err := os.WriteFile(path, []byte(content), 0644)
	require.NoError(t, err)
}

// createTestRepo adds a test repo to the store
func createTestRepo(t *testing.T, s *store.SQLiteStore, id, path string) *models.Repo {
	t.Helper()
	ctx := context.Background()

	repo := &models.Repo{
		ID:        id,
		Name:      filepath.Base(path),
		Path:      path,
		Branch:    "main",
		CreatedAt: time.Now(),
	}
	require.NoError(t, s.AddRepo(ctx, repo))
	return repo
}

// createTestSession adds a test session to the store
func createTestSession(t *testing.T, s *store.SQLiteStore, id, workspaceID string) *models.Session {
	t.Helper()
	ctx := context.Background()

	session := &models.Session{
		ID:          id,
		WorkspaceID: workspaceID,
		Name:        "Test Session",
		Status:      "idle",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))
	return session
}

// createTestSessionWithWorktree adds a test session with a real worktree directory
func createTestSessionWithWorktree(t *testing.T, s *store.SQLiteStore, id, workspaceID string) (*models.Session, string) {
	t.Helper()
	ctx := context.Background()

	// Create a temp directory to act as the worktree
	worktreePath := t.TempDir()

	session := &models.Session{
		ID:           id,
		WorkspaceID:  workspaceID,
		Name:         "Test Session",
		Status:       "idle",
		WorktreePath: worktreePath,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))
	return session, worktreePath
}

// createTestConversation adds a test conversation to the store
func createTestConversation(t *testing.T, s *store.SQLiteStore, id, sessionID string) *models.Conversation {
	t.Helper()
	ctx := context.Background()

	conv := &models.Conversation{
		ID:        id,
		SessionID: sessionID,
		Type:      "task",
		Status:    "active",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	require.NoError(t, s.AddConversation(ctx, conv))
	return conv
}

// withChiContext sets up chi URL parameters for a request
func withChiContext(r *http.Request, params map[string]string) *http.Request {
	rctx := chi.NewRouteContext()
	for key, value := range params {
		rctx.URLParams.Add(key, value)
	}
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}
