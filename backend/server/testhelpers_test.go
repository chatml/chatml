package server

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/ai"
	"github.com/chatml/chatml-backend/appdir"
	"github.com/chatml/chatml-core/git"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
)

func TestMain(m *testing.M) {
	tmpHome, err := os.MkdirTemp("", "chatml-test-home-*")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create temp home: %v\n", err)
		os.Exit(1)
	}
	os.Setenv("HOME", tmpHome)
	appdir.Init()

	code := m.Run()
	os.RemoveAll(tmpHome)
	os.Exit(code)
}

// setupTestHandlers creates handlers for testing
// Note: agentManager is nil, tests that need it should use setupTestHandlersWithAgentManager
func setupTestHandlers(t *testing.T) (*Handlers, *store.SQLiteStore) {
	t.Helper()

	sqliteStore, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)

	tmpWorkspaces := t.TempDir()
	err = sqliteStore.SetSetting(context.Background(), "workspaces-base-dir", tmpWorkspaces)
	require.NoError(t, err)

	prCache := github.NewPRCache(5*time.Minute, 10*time.Minute, 100)

	handlers := NewHandlers(context.Background(), sqliteStore, nil, DirListingCacheConfig{TTL: 30 * time.Second}, nil, nil, nil, nil, prCache, nil, nil, nil, nil, nil, nil)

	t.Cleanup(func() {
		handlers.Close()
		sqliteStore.Close()
		prCache.Close()
	})

	return handlers, sqliteStore
}

// setupTestHandlersWithAgentManager creates handlers with a real agentManager for testing
// Use this for tests that call methods requiring agentManager (e.g., DeleteConversation)
func setupTestHandlersWithAgentManager(t *testing.T) (*Handlers, *store.SQLiteStore, *agent.Manager) {
	t.Helper()

	sqliteStore, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)

	tmpWorkspaces := t.TempDir()
	err = sqliteStore.SetSetting(context.Background(), "workspaces-base-dir", tmpWorkspaces)
	require.NoError(t, err)

	worktreeManager := git.NewWorktreeManager()
	agentManager := agent.NewManager(context.Background(), sqliteStore, worktreeManager, 9876)
	prCache := github.NewPRCache(5*time.Minute, 10*time.Minute, 100)

	handlers := NewHandlers(context.Background(), sqliteStore, agentManager, DirListingCacheConfig{TTL: 30 * time.Second}, nil, nil, nil, nil, prCache, nil, nil, nil, nil, nil, nil)

	t.Cleanup(func() {
		handlers.Close()
		sqliteStore.Close()
		prCache.Close()
	})

	return handlers, sqliteStore, agentManager
}

// createTestGitRepo creates a temporary git repository for testing
// Sets up a fake "origin" remote with a "main" branch so origin/main is available.
func createTestGitRepo(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()

	runGit(t, dir, "init")
	runGit(t, dir, "config", "user.email", "test@test.com")
	runGit(t, dir, "config", "user.name", "Test User")

	// Create initial commit on main branch
	runGit(t, dir, "checkout", "-b", "main")
	writeFile(t, dir, "README.md", "# Test Repository")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "Initial commit")

	// Create a bare repo to act as "origin" so we have origin/main
	originDir := t.TempDir()
	runGit(t, originDir, "init", "--bare")

	// Add origin remote and push
	runGit(t, dir, "remote", "add", "origin", originDir)
	runGit(t, dir, "push", "-u", "origin", "main")

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

// addTestMessage adds a message to a conversation so the session is not considered blank.
func addTestMessage(t *testing.T, s *store.SQLiteStore, convID string) {
	t.Helper()
	require.NoError(t, s.AddMessageToConversation(context.Background(), convID, models.Message{
		ID:        "msg-" + convID,
		Role:      "user",
		Content:   "test message",
		Timestamp: time.Now(),
	}))
}

// setupTestHandlersWithAIClient creates handlers with a mock AI client for testing
// The aiServer URL is used as the Anthropic API endpoint.
func setupTestHandlersWithAIClient(t *testing.T, aiServerURL string) (*Handlers, *store.SQLiteStore) {
	t.Helper()

	sqliteStore, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)

	tmpWorkspaces := t.TempDir()
	err = sqliteStore.SetSetting(context.Background(), "workspaces-base-dir", tmpWorkspaces)
	require.NoError(t, err)

	prCache := github.NewPRCache(5*time.Minute, 10*time.Minute, 100)
	aiClient := ai.NewTestClient("sk-test-key", aiServerURL)

	handlers := NewHandlers(context.Background(), sqliteStore, nil, DirListingCacheConfig{TTL: 30 * time.Second}, nil, nil, nil, nil, prCache, nil, nil, nil, nil, aiClient, nil)

	t.Cleanup(func() {
		handlers.Close()
		sqliteStore.Close()
		prCache.Close()
	})

	return handlers, sqliteStore
}

// setupTestHandlersWithGitHub creates handlers with a mock GitHub client for testing
func setupTestHandlersWithGitHub(t *testing.T, ghServer *httptest.Server) (*Handlers, *store.SQLiteStore) {
	t.Helper()

	sqliteStore, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)

	prCache := github.NewPRCache(5*time.Minute, 10*time.Minute, 100)

	ghClient := github.NewClient("", "")
	ghClient.SetAPIURL(ghServer.URL)
	ghClient.SetToken("test_token")

	handlers := NewHandlers(context.Background(), sqliteStore, nil, DirListingCacheConfig{TTL: 30 * time.Second}, nil, nil, nil, ghClient, prCache, nil, nil, nil, nil, nil, nil)

	t.Cleanup(func() {
		handlers.Close()
		sqliteStore.Close()
		prCache.Close()
	})

	return handlers, sqliteStore
}

// withChiContext sets up chi URL parameters for a request
func withChiContext(r *http.Request, params map[string]string) *http.Request {
	rctx := chi.NewRouteContext()
	for key, value := range params {
		rctx.URLParams.Add(key, value)
	}
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}
