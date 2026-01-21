package git

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewRepoManager(t *testing.T) {
	rm := NewRepoManager()
	assert.NotNil(t, rm)
}

// ============================================================================
// ValidateRepo Tests
// ============================================================================

func TestValidateRepo_Valid(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	err := rm.ValidateRepo(repoPath)
	assert.NoError(t, err)
}

func TestValidateRepo_NotGitRepo(t *testing.T) {
	// Create a regular directory (not a git repo)
	dir := t.TempDir()
	rm := NewRepoManager()

	err := rm.ValidateRepo(dir)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not a git repository")
}

func TestValidateRepo_PathNotExists(t *testing.T) {
	rm := NewRepoManager()

	err := rm.ValidateRepo("/nonexistent/path")
	assert.Error(t, err)
}

// ============================================================================
// GetCurrentBranch Tests
// ============================================================================

func TestGetCurrentBranch_DefaultBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	branch, err := rm.GetCurrentBranch(context.Background(), repoPath)
	require.NoError(t, err)
	// The default branch name can vary (main, master, etc.)
	assert.NotEmpty(t, branch)
}

func TestGetCurrentBranch_CustomBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create and checkout a custom branch
	runGit(t, repoPath, "checkout", "-b", "feature/test-branch")

	branch, err := rm.GetCurrentBranch(context.Background(), repoPath)
	require.NoError(t, err)
	assert.Equal(t, "feature/test-branch", branch)
}

func TestGetCurrentBranch_NotGitRepo(t *testing.T) {
	dir := t.TempDir()
	rm := NewRepoManager()

	_, err := rm.GetCurrentBranch(context.Background(), dir)
	assert.Error(t, err)
}

// ============================================================================
// GetRepoName Tests
// ============================================================================

func TestGetRepoName(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		expected string
	}{
		{"simple path", "/home/user/projects/myrepo", "myrepo"},
		{"nested path", "/a/b/c/d/repo-name", "repo-name"},
		{"root path", "/myrepo", "myrepo"},
		{"trailing slash", "/home/user/myrepo/", "myrepo"},
	}

	rm := NewRepoManager()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := rm.GetRepoName(tt.path)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// ============================================================================
// GetFileAtRef Tests
// ============================================================================

func TestGetFileAtRef_ExistingFile(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// README.md was created in the initial commit
	content, err := rm.GetFileAtRef(context.Background(), repoPath, "HEAD", "README.md")
	require.NoError(t, err)
	assert.Contains(t, content, "# Test Repository")
}

func TestGetFileAtRef_NonExistentFile(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	_, err := rm.GetFileAtRef(context.Background(), repoPath, "HEAD", "nonexistent.txt")
	assert.Error(t, err)
}

func TestGetFileAtRef_DifferentCommit(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Get the initial commit SHA
	initialSHA := getCommitSHA(t, repoPath)

	// Modify the README
	modifyAndCommitFile(t, repoPath, "README.md", "# Modified Content", "Update README")

	// Verify current content
	current, err := rm.GetFileAtRef(context.Background(), repoPath, "HEAD", "README.md")
	require.NoError(t, err)
	assert.Contains(t, current, "# Modified Content")

	// Verify original content at the initial commit
	original, err := rm.GetFileAtRef(context.Background(), repoPath, initialSHA, "README.md")
	require.NoError(t, err)
	assert.Contains(t, original, "# Test Repository")
}

// ============================================================================
// GetChangedFiles Tests
// ============================================================================

func TestGetChangedFiles_NoChanges(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create a branch to compare against
	initialSHA := getCommitSHA(t, repoPath)

	files, err := rm.GetChangedFiles(context.Background(), repoPath, initialSHA)
	require.NoError(t, err)
	assert.Empty(t, files)
}

func TestGetChangedFiles_WithChanges(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	initialSHA := getCommitSHA(t, repoPath)

	// Make some changes (unstaged)
	writeFile(t, repoPath, "new-file.txt", "new content")
	writeFile(t, repoPath, "README.md", "modified readme")

	// Add to staging
	runGit(t, repoPath, "add", ".")

	files, err := rm.GetChangedFiles(context.Background(), repoPath, initialSHA)
	require.NoError(t, err)
	assert.Len(t, files, 2)
	assert.Contains(t, files, "new-file.txt")
	assert.Contains(t, files, "README.md")
}

// ============================================================================
// GetChangedFilesWithStats Tests
// ============================================================================

func TestGetChangedFilesWithStats_NoChanges(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	initialSHA := getCommitSHA(t, repoPath)

	changes, err := rm.GetChangedFilesWithStats(context.Background(), repoPath, initialSHA)
	require.NoError(t, err)
	assert.Empty(t, changes)
}

func TestGetChangedFilesWithStats_AddedFile(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	initialSHA := getCommitSHA(t, repoPath)

	// Create and stage a new file
	writeFile(t, repoPath, "new-file.txt", "line 1\nline 2\nline 3")
	runGit(t, repoPath, "add", "new-file.txt")

	changes, err := rm.GetChangedFilesWithStats(context.Background(), repoPath, initialSHA)
	require.NoError(t, err)
	require.Len(t, changes, 1)

	assert.Equal(t, "new-file.txt", changes[0].Path)
	assert.Equal(t, 3, changes[0].Additions)
	assert.Equal(t, 0, changes[0].Deletions)
	assert.Equal(t, "added", changes[0].Status)
}

func TestGetChangedFilesWithStats_ModifiedFile(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	initialSHA := getCommitSHA(t, repoPath)

	// Modify existing file
	writeFile(t, repoPath, "README.md", "# Modified\nNew line added")
	runGit(t, repoPath, "add", "README.md")

	changes, err := rm.GetChangedFilesWithStats(context.Background(), repoPath, initialSHA)
	require.NoError(t, err)
	require.Len(t, changes, 1)

	assert.Equal(t, "README.md", changes[0].Path)
	assert.Equal(t, "modified", changes[0].Status)
	assert.Greater(t, changes[0].Additions, 0)
}

func TestGetChangedFilesWithStats_DeletedFile(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create a file and commit it first
	createAndCommitFile(t, repoPath, "to-delete.txt", "content to delete", "Add file")

	baseSHA := getCommitSHA(t, repoPath)

	// Delete the file
	deleteFile(t, repoPath, "to-delete.txt")
	runGit(t, repoPath, "add", "to-delete.txt")

	changes, err := rm.GetChangedFilesWithStats(context.Background(), repoPath, baseSHA)
	require.NoError(t, err)
	require.Len(t, changes, 1)

	assert.Equal(t, "to-delete.txt", changes[0].Path)
	assert.Equal(t, 0, changes[0].Additions)
	assert.Greater(t, changes[0].Deletions, 0)
	assert.Equal(t, "deleted", changes[0].Status)
}

// ============================================================================
// HasMergeConflicts Tests
// ============================================================================

func TestHasMergeConflicts_NoConflict(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	hasConflicts, err := rm.HasMergeConflicts(context.Background(), repoPath)
	require.NoError(t, err)
	assert.False(t, hasConflicts)
}

func TestHasMergeConflicts_WithConflictMarkers(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create a file that already exists (so git can detect conflicts in it)
	createAndCommitFile(t, repoPath, "conflicted.txt", "original content", "Add file")

	// Now modify it with conflict markers (simulating a failed merge)
	conflictContent := `<<<<<<< HEAD
local changes
=======
remote changes
>>>>>>> branch`
	writeFile(t, repoPath, "conflicted.txt", conflictContent)

	hasConflicts, err := rm.HasMergeConflicts(context.Background(), repoPath)
	require.NoError(t, err)
	assert.True(t, hasConflicts)
}

// ============================================================================
// FileChange Tests
// ============================================================================

func TestFileChange_Struct(t *testing.T) {
	fc := FileChange{
		Path:      "test.go",
		Additions: 10,
		Deletions: 5,
		Status:    "modified",
	}

	assert.Equal(t, "test.go", fc.Path)
	assert.Equal(t, 10, fc.Additions)
	assert.Equal(t, 5, fc.Deletions)
	assert.Equal(t, "modified", fc.Status)
}

// ============================================================================
// Edge Cases
// ============================================================================

func TestGetChangedFiles_EmptyResult(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Compare HEAD to itself
	files, err := rm.GetChangedFiles(context.Background(), repoPath, "HEAD")
	require.NoError(t, err)
	assert.Empty(t, files)
}

func TestGetFileAtRef_BranchRef(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create a new branch with different content
	runGit(t, repoPath, "checkout", "-b", "feature-branch")
	modifyAndCommitFile(t, repoPath, "README.md", "# Feature Branch Content", "Feature commit")

	// Go back to main
	runGit(t, repoPath, "checkout", "-")

	// Read file from the feature branch
	content, err := rm.GetFileAtRef(context.Background(), repoPath, "feature-branch", "README.md")
	require.NoError(t, err)
	assert.Contains(t, content, "# Feature Branch Content")

	// Verify main still has original content
	mainContent, err := rm.GetFileAtRef(context.Background(), repoPath, "HEAD", "README.md")
	require.NoError(t, err)
	assert.Contains(t, mainContent, "# Test Repository")
}
