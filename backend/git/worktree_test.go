package git

import (
	"os"
	"path/filepath"
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

	worktreePath, branch, baseCommit, err := wm.Create(repoPath, "test-agent")
	require.NoError(t, err)

	// Ensure cleanup happens even if test fails
	t.Cleanup(func() {
		wm.Remove(repoPath, "test-agent")
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

	_, _, baseCommit, err := wm.Create(repoPath, "test-agent")
	require.NoError(t, err)

	t.Cleanup(func() {
		wm.Remove(repoPath, "test-agent")
	})

	// The base commit should match the HEAD when the worktree was created
	assert.Equal(t, expectedSHA, baseCommit)
}

func TestCreateWithBranch_CustomName(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	worktreePath, branch, _, err := wm.CreateWithBranch(repoPath, "my-worktree", "feature/custom-branch")
	require.NoError(t, err)

	t.Cleanup(func() {
		wm.RemoveByPath(repoPath, "my-worktree", "feature/custom-branch")
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
	_, _, _, err := wm.CreateWithBranch(repoPath, "wt-1", "existing-branch")

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
	worktreePath, branch, _, err := wm.Create(repoPath, "to-remove")
	require.NoError(t, err)
	require.DirExists(t, worktreePath)

	// Remove it
	err = wm.Remove(repoPath, "to-remove")
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
	err := wm.Remove(repoPath, "nonexistent")

	// Should error
	assert.Error(t, err)
}

func TestRemoveByPath_DeletesBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create worktree with custom branch
	_, _, _, err := wm.CreateWithBranch(repoPath, "wt-1", "custom/branch-name")
	require.NoError(t, err)

	// Verify branch exists before removal
	assert.True(t, branchExists(t, repoPath, "custom/branch-name"))

	// Remove by path
	err = wm.RemoveByPath(repoPath, "wt-1", "custom/branch-name")
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

	worktrees, err := wm.List(repoPath)
	require.NoError(t, err)
	assert.Empty(t, worktrees)
}

func TestList_Multiple(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create multiple worktrees
	wm.Create(repoPath, "wt-1")
	wm.Create(repoPath, "wt-2")
	wm.Create(repoPath, "wt-3")

	// Ensure cleanup happens even if test fails
	t.Cleanup(func() {
		wm.Remove(repoPath, "wt-1")
		wm.Remove(repoPath, "wt-2")
		wm.Remove(repoPath, "wt-3")
	})

	worktrees, err := wm.List(repoPath)
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
	worktrees, err := wm.List(repoPath)
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
	_, _, _, err := wm.Create(repoPath, "diff-test")
	require.NoError(t, err)

	t.Cleanup(func() {
		wm.Remove(repoPath, "diff-test")
	})

	// No changes made, diff should be empty
	diff, err := wm.GetDiff(repoPath, "diff-test")
	require.NoError(t, err)
	assert.Empty(t, diff)
}

func TestGetDiff_WithChanges(t *testing.T) {
	repoPath := createTestGitRepo(t)
	wm := NewWorktreeManager()

	// Create worktree
	worktreePath, _, _, err := wm.Create(repoPath, "diff-test")
	require.NoError(t, err)

	t.Cleanup(func() {
		wm.Remove(repoPath, "diff-test")
	})

	// Make changes in the worktree
	writeFile(t, worktreePath, "new-file.txt", "new content\n")
	runGit(t, worktreePath, "add", ".")
	runGit(t, worktreePath, "commit", "-m", "Add new file")

	// Get diff
	diff, err := wm.GetDiff(repoPath, "diff-test")
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
	worktreePath, _, _, err := wm.Create(repoPath, "merge-test")
	require.NoError(t, err)

	t.Cleanup(func() {
		wm.Remove(repoPath, "merge-test")
	})

	// Make changes in the worktree
	writeFile(t, worktreePath, "merged-file.txt", "merged content\n")
	runGit(t, worktreePath, "add", ".")
	runGit(t, worktreePath, "commit", "-m", "Add merged file")

	// Merge the branch
	err = wm.Merge(repoPath, "merge-test")
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
	worktreePath, _, _, err := wm.Create(repoPath, "conflict-test")
	require.NoError(t, err)

	t.Cleanup(func() {
		runGitMayFail(repoPath, "merge", "--abort")
		wm.Remove(repoPath, "conflict-test")
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
	err = wm.Merge(repoPath, "conflict-test")
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
	worktreePath, branch, baseCommit, err := wm.Create(repoPath, "lifecycle-test")
	require.NoError(t, err)
	assert.DirExists(t, worktreePath)
	assert.True(t, branchExists(t, repoPath, branch))
	assert.NotEmpty(t, baseCommit)

	// List - should include new worktree
	list, err := wm.List(repoPath)
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
	diff, err := wm.GetDiff(repoPath, "lifecycle-test")
	require.NoError(t, err)
	assert.Contains(t, diff, "test.txt")

	// Merge
	err = wm.Merge(repoPath, "lifecycle-test")
	require.NoError(t, err)
	assert.FileExists(t, filepath.Join(repoPath, "test.txt"))

	// Remove
	err = wm.Remove(repoPath, "lifecycle-test")
	require.NoError(t, err)
	assert.NoDirExists(t, worktreePath)
	assert.False(t, branchExists(t, repoPath, branch))
}
