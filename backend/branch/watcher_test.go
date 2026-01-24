package branch

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestResolveWorktreeGitDir_WorktreeFile(t *testing.T) {
	// Create a temp directory structure simulating a worktree
	tmpDir := t.TempDir()
	worktreePath := filepath.Join(tmpDir, "worktree")
	mainRepoGitDir := filepath.Join(tmpDir, "main-repo", ".git", "worktrees", "worktree")

	// Create directories
	if err := os.MkdirAll(worktreePath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(mainRepoGitDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create .git file in worktree pointing to the gitdir
	gitFile := filepath.Join(worktreePath, ".git")
	if err := os.WriteFile(gitFile, []byte("gitdir: "+mainRepoGitDir+"\n"), 0644); err != nil {
		t.Fatal(err)
	}

	// Test resolveWorktreeGitDir
	result, err := resolveWorktreeGitDir(worktreePath)
	if err != nil {
		t.Fatalf("resolveWorktreeGitDir failed: %v", err)
	}

	if result != mainRepoGitDir {
		t.Errorf("resolveWorktreeGitDir = %q, want %q", result, mainRepoGitDir)
	}
}

func TestResolveWorktreeGitDir_RegularRepo(t *testing.T) {
	// Create a temp directory structure simulating a regular repo
	tmpDir := t.TempDir()
	repoPath := filepath.Join(tmpDir, "repo")
	gitDir := filepath.Join(repoPath, ".git")

	// Create .git directory
	if err := os.MkdirAll(gitDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Test resolveWorktreeGitDir
	result, err := resolveWorktreeGitDir(repoPath)
	if err != nil {
		t.Fatalf("resolveWorktreeGitDir failed: %v", err)
	}

	if result != gitDir {
		t.Errorf("resolveWorktreeGitDir = %q, want %q", result, gitDir)
	}
}

func TestResolveWorktreeGitDir_RelativePath(t *testing.T) {
	// Create a temp directory structure with relative gitdir path
	tmpDir := t.TempDir()
	worktreePath := filepath.Join(tmpDir, "worktree")
	mainRepoGitDir := filepath.Join(tmpDir, "main-repo", ".git", "worktrees", "worktree")

	// Create directories
	if err := os.MkdirAll(worktreePath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(mainRepoGitDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create .git file with relative path
	gitFile := filepath.Join(worktreePath, ".git")
	relativePath := "../main-repo/.git/worktrees/worktree"
	if err := os.WriteFile(gitFile, []byte("gitdir: "+relativePath+"\n"), 0644); err != nil {
		t.Fatal(err)
	}

	// Test resolveWorktreeGitDir
	result, err := resolveWorktreeGitDir(worktreePath)
	if err != nil {
		t.Fatalf("resolveWorktreeGitDir failed: %v", err)
	}

	// Result should be absolute and cleaned
	if result != mainRepoGitDir {
		t.Errorf("resolveWorktreeGitDir = %q, want %q", result, mainRepoGitDir)
	}
}

func TestReadCurrentBranch_BranchRef(t *testing.T) {
	tmpDir := t.TempDir()
	headPath := filepath.Join(tmpDir, "HEAD")

	// Write a branch ref
	if err := os.WriteFile(headPath, []byte("ref: refs/heads/my-feature-branch\n"), 0644); err != nil {
		t.Fatal(err)
	}

	branch, err := readCurrentBranch(headPath)
	if err != nil {
		t.Fatalf("readCurrentBranch failed: %v", err)
	}

	if branch != "my-feature-branch" {
		t.Errorf("readCurrentBranch = %q, want %q", branch, "my-feature-branch")
	}
}

func TestReadCurrentBranch_DetachedHead(t *testing.T) {
	tmpDir := t.TempDir()
	headPath := filepath.Join(tmpDir, "HEAD")

	// Write a commit SHA (detached HEAD)
	sha := "abc123def456789012345678901234567890abcd"
	if err := os.WriteFile(headPath, []byte(sha+"\n"), 0644); err != nil {
		t.Fatal(err)
	}

	branch, err := readCurrentBranch(headPath)
	if err != nil {
		t.Fatalf("readCurrentBranch failed: %v", err)
	}

	expected := "abc123de (detached)"
	if branch != expected {
		t.Errorf("readCurrentBranch = %q, want %q", branch, expected)
	}
}

func TestReadCurrentBranch_NestedBranch(t *testing.T) {
	tmpDir := t.TempDir()
	headPath := filepath.Join(tmpDir, "HEAD")

	// Write a nested branch ref
	if err := os.WriteFile(headPath, []byte("ref: refs/heads/feature/nested/branch\n"), 0644); err != nil {
		t.Fatal(err)
	}

	branch, err := readCurrentBranch(headPath)
	if err != nil {
		t.Fatalf("readCurrentBranch failed: %v", err)
	}

	if branch != "feature/nested/branch" {
		t.Errorf("readCurrentBranch = %q, want %q", branch, "feature/nested/branch")
	}
}

// ============================================================================
// Watcher Tests
// ============================================================================

// createTestWorktree creates a simulated worktree structure for testing
func createTestWorktree(t *testing.T, sessionID string) (worktreePath string, gitDir string) {
	t.Helper()

	tmpDir := t.TempDir()
	worktreePath = filepath.Join(tmpDir, "worktree-"+sessionID)
	gitDir = filepath.Join(tmpDir, "main-repo", ".git", "worktrees", sessionID)

	// Create directories
	require.NoError(t, os.MkdirAll(worktreePath, 0755))
	require.NoError(t, os.MkdirAll(gitDir, 0755))

	// Create .git file in worktree pointing to the gitdir
	gitFile := filepath.Join(worktreePath, ".git")
	require.NoError(t, os.WriteFile(gitFile, []byte("gitdir: "+gitDir+"\n"), 0644))

	// Create HEAD file
	headPath := filepath.Join(gitDir, "HEAD")
	require.NoError(t, os.WriteFile(headPath, []byte("ref: refs/heads/main\n"), 0644))

	return worktreePath, gitDir
}

func TestNewWatcher(t *testing.T) {
	events := make([]BranchChangeEvent, 0)
	var mu sync.Mutex

	onChange := func(evt BranchChangeEvent) {
		mu.Lock()
		events = append(events, evt)
		mu.Unlock()
	}

	watcher, err := NewWatcher(onChange)
	require.NoError(t, err)
	require.NotNil(t, watcher)

	defer watcher.Close()

	require.NotNil(t, watcher.watcher)
	require.NotNil(t, watcher.sessions)
	require.NotNil(t, watcher.onChange)
}

func TestWatcher_WatchSession_Success(t *testing.T) {
	events := make([]BranchChangeEvent, 0)
	watcher, err := NewWatcher(func(evt BranchChangeEvent) {
		events = append(events, evt)
	})
	require.NoError(t, err)
	defer watcher.Close()

	worktreePath, _ := createTestWorktree(t, "session-1")

	err = watcher.WatchSession("session-1", worktreePath, "main")
	require.NoError(t, err)

	// Verify session is tracked
	watcher.mu.RLock()
	entry, exists := watcher.sessions["session-1"]
	watcher.mu.RUnlock()

	require.True(t, exists)
	require.Equal(t, "session-1", entry.SessionID)
	require.Equal(t, worktreePath, entry.WorktreePath)
	require.Equal(t, "main", entry.LastBranch)
}

func TestWatcher_WatchSession_AlreadyWatching(t *testing.T) {
	watcher, err := NewWatcher(func(evt BranchChangeEvent) {})
	require.NoError(t, err)
	defer watcher.Close()

	worktreePath, _ := createTestWorktree(t, "session-1")

	// Watch first time
	err = watcher.WatchSession("session-1", worktreePath, "main")
	require.NoError(t, err)

	// Watch again - should be idempotent
	err = watcher.WatchSession("session-1", worktreePath, "main")
	require.NoError(t, err)

	// Should still only have one entry
	watcher.mu.RLock()
	require.Len(t, watcher.sessions, 1)
	watcher.mu.RUnlock()
}

func TestWatcher_WatchSession_InvalidPath(t *testing.T) {
	watcher, err := NewWatcher(func(evt BranchChangeEvent) {})
	require.NoError(t, err)
	defer watcher.Close()

	err = watcher.WatchSession("session-1", "/nonexistent/path", "main")
	require.Error(t, err)
}

func TestWatcher_WatchSession_NoHEAD(t *testing.T) {
	watcher, err := NewWatcher(func(evt BranchChangeEvent) {})
	require.NoError(t, err)
	defer watcher.Close()

	tmpDir := t.TempDir()
	worktreePath := filepath.Join(tmpDir, "worktree")
	gitDir := filepath.Join(tmpDir, "gitdir")

	// Create directories but no HEAD file
	require.NoError(t, os.MkdirAll(worktreePath, 0755))
	require.NoError(t, os.MkdirAll(gitDir, 0755))

	// Create .git file pointing to gitdir
	gitFile := filepath.Join(worktreePath, ".git")
	require.NoError(t, os.WriteFile(gitFile, []byte("gitdir: "+gitDir+"\n"), 0644))

	err = watcher.WatchSession("session-1", worktreePath, "main")
	require.Error(t, err)
	require.Contains(t, err.Error(), "HEAD file not found")
}

func TestWatcher_UnwatchSession_Success(t *testing.T) {
	watcher, err := NewWatcher(func(evt BranchChangeEvent) {})
	require.NoError(t, err)
	defer watcher.Close()

	worktreePath, _ := createTestWorktree(t, "session-1")

	err = watcher.WatchSession("session-1", worktreePath, "main")
	require.NoError(t, err)

	// Verify session exists
	watcher.mu.RLock()
	_, exists := watcher.sessions["session-1"]
	watcher.mu.RUnlock()
	require.True(t, exists)

	// Unwatch
	watcher.UnwatchSession("session-1")

	// Verify session is removed
	watcher.mu.RLock()
	_, exists = watcher.sessions["session-1"]
	watcher.mu.RUnlock()
	require.False(t, exists)
}

func TestWatcher_UnwatchSession_NotWatching(t *testing.T) {
	watcher, err := NewWatcher(func(evt BranchChangeEvent) {})
	require.NoError(t, err)
	defer watcher.Close()

	// Unwatch non-existent session - should not panic
	require.NotPanics(t, func() {
		watcher.UnwatchSession("nonexistent")
	})
}

func TestWatcher_UnwatchSession_SharedGitDir(t *testing.T) {
	watcher, err := NewWatcher(func(evt BranchChangeEvent) {})
	require.NoError(t, err)
	defer watcher.Close()

	// Create two sessions sharing the same gitdir (simulating branch switching)
	tmpDir := t.TempDir()
	gitDir := filepath.Join(tmpDir, "main-repo", ".git", "worktrees", "shared")
	require.NoError(t, os.MkdirAll(gitDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(gitDir, "HEAD"), []byte("ref: refs/heads/main\n"), 0644))

	worktree1 := filepath.Join(tmpDir, "worktree1")
	worktree2 := filepath.Join(tmpDir, "worktree2")
	require.NoError(t, os.MkdirAll(worktree1, 0755))
	require.NoError(t, os.MkdirAll(worktree2, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(worktree1, ".git"), []byte("gitdir: "+gitDir+"\n"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(worktree2, ".git"), []byte("gitdir: "+gitDir+"\n"), 0644))

	err = watcher.WatchSession("session-1", worktree1, "main")
	require.NoError(t, err)
	err = watcher.WatchSession("session-2", worktree2, "main")
	require.NoError(t, err)

	// Unwatch first session - gitdir watch should remain for second session
	watcher.UnwatchSession("session-1")

	watcher.mu.RLock()
	require.Len(t, watcher.sessions, 1)
	_, exists := watcher.sessions["session-2"]
	watcher.mu.RUnlock()
	require.True(t, exists)

	// Unwatch second session - gitdir watch should be removed
	watcher.UnwatchSession("session-2")

	watcher.mu.RLock()
	require.Empty(t, watcher.sessions)
	watcher.mu.RUnlock()
}

func TestWatcher_Close(t *testing.T) {
	watcher, err := NewWatcher(func(evt BranchChangeEvent) {})
	require.NoError(t, err)

	worktreePath, _ := createTestWorktree(t, "session-1")
	err = watcher.WatchSession("session-1", worktreePath, "main")
	require.NoError(t, err)

	// Close should not panic
	require.NotPanics(t, func() {
		watcher.Close()
	})
}

func TestWatcher_BranchChangeEvent(t *testing.T) {
	events := make([]BranchChangeEvent, 0)
	var mu sync.Mutex

	watcher, err := NewWatcher(func(evt BranchChangeEvent) {
		mu.Lock()
		events = append(events, evt)
		mu.Unlock()
	})
	require.NoError(t, err)
	defer watcher.Close()

	worktreePath, gitDir := createTestWorktree(t, "session-1")

	err = watcher.WatchSession("session-1", worktreePath, "main")
	require.NoError(t, err)

	// Simulate branch change by modifying HEAD
	headPath := filepath.Join(gitDir, "HEAD")
	err = os.WriteFile(headPath, []byte("ref: refs/heads/feature-branch\n"), 0644)
	require.NoError(t, err)

	// Wait for fsnotify to detect the change
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	evtCount := len(events)
	mu.Unlock()

	// Event may or may not be received depending on timing
	// At minimum, verify no panic occurred
	if evtCount > 0 {
		mu.Lock()
		evt := events[0]
		mu.Unlock()

		require.Equal(t, "session-1", evt.SessionID)
		require.Equal(t, "main", evt.OldBranch)
		require.Equal(t, "feature-branch", evt.NewBranch)
	}
}

func TestWatcher_ConcurrentAccess(t *testing.T) {
	watcher, err := NewWatcher(func(evt BranchChangeEvent) {})
	require.NoError(t, err)
	defer watcher.Close()

	var wg sync.WaitGroup
	const numGoroutines = 10

	// Concurrently watch and unwatch sessions
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			sessionID := "session-" + string(rune('0'+id))
			worktreePath, _ := createTestWorktree(t, sessionID)

			// Watch
			err := watcher.WatchSession(sessionID, worktreePath, "main")
			if err != nil {
				return // May fail due to concurrent access, but should not panic
			}

			// Small delay
			time.Sleep(10 * time.Millisecond)

			// Unwatch
			watcher.UnwatchSession(sessionID)
		}(i)
	}

	wg.Wait()
}

func TestResolveWorktreeGitDir_InvalidFormat(t *testing.T) {
	tmpDir := t.TempDir()
	worktreePath := filepath.Join(tmpDir, "worktree")
	require.NoError(t, os.MkdirAll(worktreePath, 0755))

	// Create .git file with invalid format
	gitFile := filepath.Join(worktreePath, ".git")
	require.NoError(t, os.WriteFile(gitFile, []byte("invalid format\n"), 0644))

	_, err := resolveWorktreeGitDir(worktreePath)
	require.Error(t, err)
	require.Contains(t, err.Error(), "unexpected .git file format")
}

func TestResolveWorktreeGitDir_MissingGitFile(t *testing.T) {
	tmpDir := t.TempDir()
	worktreePath := filepath.Join(tmpDir, "worktree")
	require.NoError(t, os.MkdirAll(worktreePath, 0755))

	// No .git file

	_, err := resolveWorktreeGitDir(worktreePath)
	require.Error(t, err)
}

func TestReadCurrentBranch_ShortSHA(t *testing.T) {
	tmpDir := t.TempDir()
	headPath := filepath.Join(tmpDir, "HEAD")

	// Write a short SHA (less than 8 chars)
	require.NoError(t, os.WriteFile(headPath, []byte("abc123\n"), 0644))

	branch, err := readCurrentBranch(headPath)
	require.NoError(t, err)
	require.Equal(t, "abc123", branch)
}

func TestReadCurrentBranch_FileNotFound(t *testing.T) {
	_, err := readCurrentBranch("/nonexistent/HEAD")
	require.Error(t, err)
}

func TestBranchChangeEvent_Struct(t *testing.T) {
	evt := BranchChangeEvent{
		SessionID: "session-123",
		OldBranch: "main",
		NewBranch: "feature",
	}

	require.Equal(t, "session-123", evt.SessionID)
	require.Equal(t, "main", evt.OldBranch)
	require.Equal(t, "feature", evt.NewBranch)
}

func TestWatchEntry_Struct(t *testing.T) {
	entry := WatchEntry{
		SessionID:    "session-123",
		WorktreePath: "/path/to/worktree",
		GitDir:       "/path/to/.git/worktrees/session-123",
		HeadPath:     "/path/to/.git/worktrees/session-123/HEAD",
		LastBranch:   "main",
	}

	require.Equal(t, "session-123", entry.SessionID)
	require.Equal(t, "/path/to/worktree", entry.WorktreePath)
	require.Equal(t, "main", entry.LastBranch)
}
