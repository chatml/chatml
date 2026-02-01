package git

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewWorktreeManager(t *testing.T) {
	wm := NewWorktreeManager()
	assert.NotNil(t, wm)
}

// ============================================================================
// Create Tests
// ============================================================================

func TestCreate_Success(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	worktreePath, branch, baseCommit, err := wm.Create(context.Background(), repoPath, "test-agent")
	require.NoError(t, err)

	// Ensure cleanup happens even if test fails
	t.Cleanup(func() {
		wm.Remove(context.Background(), repoPath, "test-agent")
	})

	// Verify worktree was created
	assert.DirExists(t, worktreePath)
	assert.Contains(t, worktreePath, ".worktrees")
	assert.Contains(t, worktreePath, "test-agent")

	// Verify branch name
	assert.Equal(t, "agent/test-agent", branch)

	// Verify base commit is a valid SHA
	assert.Len(t, baseCommit, 40)

	// Verify branch exists
	assert.True(t, branchExists(t, repoPath, branch))
}

func TestCreate_ReturnsBaseCommit(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Get the current HEAD commit
	expectedSHA := getCommitSHA(t, repoPath)

	_, _, baseCommit, err := wm.Create(context.Background(), repoPath, "test-agent")
	require.NoError(t, err)

	t.Cleanup(func() {
		wm.Remove(context.Background(), repoPath, "test-agent")
	})

	// The base commit should match the HEAD when the worktree was created
	assert.Equal(t, expectedSHA, baseCommit)
}

func TestCreateWithBranch_CustomName(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	worktreePath, branch, _, err := wm.CreateWithBranch(context.Background(), repoPath, "my-worktree", "feature/custom-branch")
	require.NoError(t, err)

	t.Cleanup(func() {
		wm.RemoveByPath(context.Background(), repoPath, "my-worktree", "feature/custom-branch")
	})

	// Verify correct branch name
	assert.Equal(t, "feature/custom-branch", branch)

	// Verify worktree directory
	assert.Contains(t, worktreePath, "my-worktree")

	// Verify branch exists
	assert.True(t, branchExists(t, repoPath, "feature/custom-branch"))
}

func TestCreateWithBranch_BranchAlreadyExists(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create a branch first
	createBranch(t, repoPath, "existing-branch")

	// Try to create worktree with same branch name
	_, _, _, err := wm.CreateWithBranch(context.Background(), repoPath, "wt-1", "existing-branch")

	// Should fail because branch already exists
	assert.Error(t, err)
}

// ============================================================================
// Remove Tests
// ============================================================================

func TestRemove_Success(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create worktree first
	worktreePath, branch, _, err := wm.Create(context.Background(), repoPath, "to-remove")
	require.NoError(t, err)
	require.DirExists(t, worktreePath)

	// Remove it
	err = wm.Remove(context.Background(), repoPath, "to-remove")
	require.NoError(t, err)

	// Verify worktree is removed
	assert.NoDirExists(t, worktreePath)

	// Verify branch is deleted
	assert.False(t, branchExists(t, repoPath, branch))
}

func TestRemove_WorktreeNotExists(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Try to remove non-existent worktree
	err := wm.Remove(context.Background(), repoPath, "nonexistent")

	// Should error
	assert.Error(t, err)
}

func TestRemoveByPath_DeletesBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create worktree with custom branch
	_, _, _, err := wm.CreateWithBranch(context.Background(), repoPath, "wt-1", "custom/branch-name")
	require.NoError(t, err)

	// Verify branch exists before removal
	assert.True(t, branchExists(t, repoPath, "custom/branch-name"))

	// Remove by path
	err = wm.RemoveByPath(context.Background(), repoPath, "wt-1", "custom/branch-name")
	require.NoError(t, err)

	// Verify branch is deleted
	assert.False(t, branchExists(t, repoPath, "custom/branch-name"))
}

// ============================================================================
// List Tests
// ============================================================================

func TestList_Empty(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	worktrees, err := wm.List(context.Background(), repoPath)
	require.NoError(t, err)
	assert.Empty(t, worktrees)
}

func TestList_Multiple(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create multiple worktrees
	wm.Create(context.Background(), repoPath, "wt-1")
	wm.Create(context.Background(), repoPath, "wt-2")
	wm.Create(context.Background(), repoPath, "wt-3")

	// Ensure cleanup happens even if test fails
	t.Cleanup(func() {
		wm.Remove(context.Background(), repoPath, "wt-1")
		wm.Remove(context.Background(), repoPath, "wt-2")
		wm.Remove(context.Background(), repoPath, "wt-3")
	})

	worktrees, err := wm.List(context.Background(), repoPath)
	require.NoError(t, err)
	assert.Len(t, worktrees, 3)

	// Verify each worktree is in the .worktrees directory
	for _, wt := range worktrees {
		assert.Contains(t, wt, ".worktrees")
	}
}

func TestList_FiltersMainWorktree(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// List should not include the main worktree (the repo itself)
	worktrees, err := wm.List(context.Background(), repoPath)
	require.NoError(t, err)

	// Main worktree should not be in the list
	for _, wt := range worktrees {
		assert.NotEqual(t, repoPath, wt)
	}
}

// ============================================================================
// GetDiff Tests
// ============================================================================

func TestGetDiff_NoChanges(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create worktree
	_, _, _, err := wm.Create(context.Background(), repoPath, "diff-test")
	require.NoError(t, err)

	t.Cleanup(func() {
		wm.Remove(context.Background(), repoPath, "diff-test")
	})

	// No changes made, diff should be empty
	diff, err := wm.GetDiff(context.Background(), repoPath, "diff-test")
	require.NoError(t, err)
	assert.Empty(t, diff)
}

func TestGetDiff_WithChanges(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create worktree
	worktreePath, _, _, err := wm.Create(context.Background(), repoPath, "diff-test")
	require.NoError(t, err)

	t.Cleanup(func() {
		wm.Remove(context.Background(), repoPath, "diff-test")
	})

	// Make changes in the worktree
	writeFile(t, worktreePath, "new-file.txt", "new content\n")
	runGit(t, worktreePath, "add", ".")
	runGit(t, worktreePath, "commit", "-m", "Add new file")

	// Get diff
	diff, err := wm.GetDiff(context.Background(), repoPath, "diff-test")
	require.NoError(t, err)

	assert.Contains(t, diff, "new-file.txt")
	assert.Contains(t, diff, "new content")
}

// ============================================================================
// Merge Tests
// ============================================================================

func TestMerge_Success(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create worktree
	worktreePath, _, _, err := wm.Create(context.Background(), repoPath, "merge-test")
	require.NoError(t, err)

	t.Cleanup(func() {
		wm.Remove(context.Background(), repoPath, "merge-test")
	})

	// Make changes in the worktree
	writeFile(t, worktreePath, "merged-file.txt", "merged content\n")
	runGit(t, worktreePath, "add", ".")
	runGit(t, worktreePath, "commit", "-m", "Add merged file")

	// Merge the branch
	err = wm.Merge(context.Background(), repoPath, "merge-test")
	require.NoError(t, err)

	// Verify the file now exists in main repo
	mergedFilePath := filepath.Join(repoPath, "merged-file.txt")
	assert.FileExists(t, mergedFilePath)

	// Verify content
	content, err := os.ReadFile(mergedFilePath)
	require.NoError(t, err)
	assert.Contains(t, string(content), "merged content")
}

func TestMerge_Conflict(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create worktree
	worktreePath, _, _, err := wm.Create(context.Background(), repoPath, "conflict-test")
	require.NoError(t, err)

	t.Cleanup(func() {
		runGitMayFail(repoPath, "merge", "--abort")
		wm.Remove(context.Background(), repoPath, "conflict-test")
	})

	// Make conflicting changes in main repo
	writeFile(t, repoPath, "conflict.txt", "main content\n")
	runGit(t, repoPath, "add", ".")
	runGit(t, repoPath, "commit", "-m", "Add in main")

	// Make conflicting changes in worktree
	writeFile(t, worktreePath, "conflict.txt", "worktree content\n")
	runGit(t, worktreePath, "add", ".")
	runGit(t, worktreePath, "commit", "-m", "Add in worktree")

	// Try to merge - should fail with conflict
	err = wm.Merge(context.Background(), repoPath, "conflict-test")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "merge failed")
}

// ============================================================================
// Integration Tests
// ============================================================================

func TestWorktreeLifecycle(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create
	worktreePath, branch, baseCommit, err := wm.Create(context.Background(), repoPath, "lifecycle-test")
	require.NoError(t, err)
	assert.DirExists(t, worktreePath)
	assert.True(t, branchExists(t, repoPath, branch))
	assert.NotEmpty(t, baseCommit)

	// List - should include new worktree
	list, err := wm.List(context.Background(), repoPath)
	require.NoError(t, err)
	found := false
	for _, wt := range list {
		if filepath.Base(wt) == "lifecycle-test" {
			found = true
			break
		}
	}
	assert.True(t, found, "worktree should be in list")

	// Make changes
	writeFile(t, worktreePath, "test.txt", "test\n")
	runGit(t, worktreePath, "add", ".")
	runGit(t, worktreePath, "commit", "-m", "Test commit")

	// Get diff
	diff, err := wm.GetDiff(context.Background(), repoPath, "lifecycle-test")
	require.NoError(t, err)
	assert.Contains(t, diff, "test.txt")

	// Merge
	err = wm.Merge(context.Background(), repoPath, "lifecycle-test")
	require.NoError(t, err)
	assert.FileExists(t, filepath.Join(repoPath, "test.txt"))

	// Remove
	err = wm.Remove(context.Background(), repoPath, "lifecycle-test")
	require.NoError(t, err)
	assert.NoDirExists(t, worktreePath)
	assert.False(t, branchExists(t, repoPath, branch))
}

// ============================================================================
// CreateSessionDirectoryAtomic Tests
// ============================================================================

func TestCreateSessionDirectoryAtomic_Success(t *testing.T) {
	baseDir := t.TempDir()

	path, err := CreateSessionDirectoryAtomic(baseDir, "tokyo")
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(baseDir, "tokyo"), path)

	// Verify directory exists
	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.True(t, info.IsDir())
}

func TestCreateSessionDirectoryAtomic_Collision(t *testing.T) {
	baseDir := t.TempDir()

	// Create first directory
	_, err := CreateSessionDirectoryAtomic(baseDir, "tokyo")
	require.NoError(t, err)

	// Attempt to create same directory should fail with ErrDirectoryExists
	_, err = CreateSessionDirectoryAtomic(baseDir, "tokyo")
	assert.ErrorIs(t, err, ErrDirectoryExists)
}

func TestCreateSessionDirectoryAtomic_Concurrent(t *testing.T) {
	baseDir := t.TempDir()

	var wg sync.WaitGroup
	var successes atomic.Int32
	var collisions atomic.Int32

	// 10 goroutines try to create the same directory
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := CreateSessionDirectoryAtomic(baseDir, "tokyo")
			if err == nil {
				successes.Add(1)
			} else if errors.Is(err, ErrDirectoryExists) {
				collisions.Add(1)
			}
		}()
	}

	wg.Wait()

	// Exactly one should succeed, rest should get collision
	assert.Equal(t, int32(1), successes.Load(), "exactly one goroutine should succeed")
	assert.Equal(t, int32(9), collisions.Load(), "9 goroutines should get collision")
}

func TestCreateSessionDirectoryAtomic_ParentNotExist(t *testing.T) {
	baseDir := filepath.Join(t.TempDir(), "nonexistent", "nested")

	// Should fail because parent doesn't exist
	_, err := CreateSessionDirectoryAtomic(baseDir, "tokyo")
	assert.Error(t, err)
	assert.False(t, errors.Is(err, ErrDirectoryExists), "error should not be ErrDirectoryExists")
}

// ============================================================================
// CreateInExistingDir Tests
// ============================================================================

func TestCreateInExistingDir_Success(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create directory first (simulating atomic creation)
	sessionDir := filepath.Join(t.TempDir(), "test-session")
	require.NoError(t, os.Mkdir(sessionDir, 0755))

	// Create worktree in existing directory
	worktreePath, branch, baseCommit, err := wm.CreateInExistingDir(context.Background(), repoPath, sessionDir, "session/test-branch")
	require.NoError(t, err)

	t.Cleanup(func() {
		wm.RemoveAtPath(context.Background(), repoPath, sessionDir, "session/test-branch")
	})

	// Verify results
	assert.Equal(t, sessionDir, worktreePath)
	assert.Equal(t, "session/test-branch", branch)
	assert.Len(t, baseCommit, 40, "base commit should be a valid SHA")

	// Verify worktree is functional (has .git file)
	gitFile := filepath.Join(sessionDir, ".git")
	assert.FileExists(t, gitFile)
}

// ============================================================================
// CheckoutExistingBranchInDir Tests
// ============================================================================

func TestCheckoutExistingBranchInDir_Success(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create a branch and push it to origin so it exists as a remote branch
	runGit(t, repoPath, "checkout", "-b", "feature/existing-branch")
	writeFile(t, repoPath, "feature.txt", "feature content\n")
	runGit(t, repoPath, "add", ".")
	runGit(t, repoPath, "commit", "-m", "Add feature")
	runGit(t, repoPath, "push", "origin", "feature/existing-branch")

	// Go back to main so the branch isn't checked out
	runGit(t, repoPath, "checkout", "main")
	// Delete the local branch so only the remote ref exists
	runGit(t, repoPath, "branch", "-D", "feature/existing-branch")

	// Create directory first (simulating atomic creation)
	sessionDir := filepath.Join(t.TempDir(), "test-session")
	require.NoError(t, os.Mkdir(sessionDir, 0755))

	// Checkout the existing remote branch
	worktreePath, branch, baseCommit, err := wm.CheckoutExistingBranchInDir(context.Background(), repoPath, sessionDir, "feature/existing-branch")
	require.NoError(t, err)

	t.Cleanup(func() {
		wm.RemoveAtPath(context.Background(), repoPath, sessionDir, "feature/existing-branch")
	})

	// Verify results
	assert.Equal(t, sessionDir, worktreePath)
	assert.Equal(t, "feature/existing-branch", branch)
	assert.Len(t, baseCommit, 40, "base commit should be a valid SHA")

	// Verify worktree is functional (has .git file)
	gitFile := filepath.Join(sessionDir, ".git")
	assert.FileExists(t, gitFile)

	// Verify the feature file exists in the worktree
	assert.FileExists(t, filepath.Join(sessionDir, "feature.txt"))
}

func TestCheckoutExistingBranchInDir_BranchNotFound(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	sessionDir := filepath.Join(t.TempDir(), "test-session")
	require.NoError(t, os.Mkdir(sessionDir, 0755))

	_, _, _, err := wm.CheckoutExistingBranchInDir(context.Background(), repoPath, sessionDir, "nonexistent-branch")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "nonexistent-branch")
}

func TestCheckoutExistingBranchInDir_LocalBranchExists(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create a branch and push it to origin
	runGit(t, repoPath, "checkout", "-b", "feature/shared-branch")
	writeFile(t, repoPath, "shared.txt", "shared content\n")
	runGit(t, repoPath, "add", ".")
	runGit(t, repoPath, "commit", "-m", "Add shared")
	runGit(t, repoPath, "push", "origin", "feature/shared-branch")
	runGit(t, repoPath, "checkout", "main")
	runGit(t, repoPath, "branch", "-D", "feature/shared-branch")

	// First checkout should succeed — this creates the local branch
	sessionDir1 := filepath.Join(t.TempDir(), "session-1")
	require.NoError(t, os.Mkdir(sessionDir1, 0755))
	_, _, _, err := wm.CheckoutExistingBranchInDir(context.Background(), repoPath, sessionDir1, "feature/shared-branch")
	require.NoError(t, err)

	t.Cleanup(func() {
		wm.RemoveAtPath(context.Background(), repoPath, sessionDir1, "feature/shared-branch")
	})

	// Second checkout of the same branch fails because the local branch already exists
	// (git worktree add -b errors with "already exists" when -b tries to create a branch
	// that was already created by the first worktree)
	sessionDir2 := filepath.Join(t.TempDir(), "session-2")
	require.NoError(t, os.Mkdir(sessionDir2, 0755))
	_, _, _, err = wm.CheckoutExistingBranchInDir(context.Background(), repoPath, sessionDir2, "feature/shared-branch")
	assert.Error(t, err)
	assert.ErrorIs(t, err, ErrLocalBranchExists)
}

// ============================================================================
// WorkspacesBaseDirWithOverride Tests
// ============================================================================

func TestWorkspacesBaseDirWithOverride_ReturnsConfiguredPath(t *testing.T) {
	path, err := WorkspacesBaseDirWithOverride("/custom/workspaces")
	require.NoError(t, err)
	assert.Equal(t, "/custom/workspaces", path)
}

func TestWorkspacesBaseDirWithOverride_FallbackToDefault(t *testing.T) {
	// Empty string should fall back to the default WorkspacesBaseDir()
	overridePath, err := WorkspacesBaseDirWithOverride("")
	require.NoError(t, err)

	defaultPath, err := WorkspacesBaseDir()
	require.NoError(t, err)

	assert.Equal(t, defaultPath, overridePath)
}

func TestWorkspacesBaseDirWithOverride_DoesNotValidatePath(t *testing.T) {
	// Non-existent path should still be returned without error
	path, err := WorkspacesBaseDirWithOverride("/nonexistent/absolutely/fake/path")
	require.NoError(t, err)
	assert.Equal(t, "/nonexistent/absolutely/fake/path", path)
}
