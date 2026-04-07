package git

import (
	"context"
	"fmt"
	"testing"
	"time"

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

// ============================================================================
// GetCommitsAheadOfBase Tests
// ============================================================================

func TestGetCommitsAheadOfBase_NoCommitsAhead(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Get the current HEAD (same as base) — no commits ahead
	baseSHA := getCommitSHA(t, repoPath)

	commits, err := rm.GetCommitsAheadOfBase(context.Background(), repoPath, baseSHA)
	require.NoError(t, err)
	assert.Empty(t, commits)
}

func TestGetCommitsAheadOfBase_SingleCommit(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	baseSHA := getCommitSHA(t, repoPath)

	// Create a new commit ahead of base
	createAndCommitFile(t, repoPath, "new-file.txt", "hello world\nline 2\n", "Add new file")

	commits, err := rm.GetCommitsAheadOfBase(context.Background(), repoPath, baseSHA)
	require.NoError(t, err)
	require.Len(t, commits, 1)

	assert.Equal(t, "Add new file", commits[0].Message)
	assert.NotEmpty(t, commits[0].SHA)
	assert.NotEmpty(t, commits[0].ShortSHA)
	assert.Equal(t, "Test User", commits[0].Author)
	assert.Equal(t, "test@test.com", commits[0].Email)
	assert.False(t, commits[0].Timestamp.IsZero())

	// Verify file changes
	require.Len(t, commits[0].Files, 1)
	assert.Equal(t, "new-file.txt", commits[0].Files[0].Path)
	assert.Equal(t, 2, commits[0].Files[0].Additions)
	assert.Equal(t, 0, commits[0].Files[0].Deletions)
}

func TestGetCommitsAheadOfBase_MultipleCommits(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	baseSHA := getCommitSHA(t, repoPath)

	// Create multiple commits
	createAndCommitFile(t, repoPath, "file1.txt", "content 1\n", "First commit")
	createAndCommitFile(t, repoPath, "file2.txt", "content 2\n", "Second commit")
	createAndCommitFile(t, repoPath, "file3.txt", "content 3\n", "Third commit")

	commits, err := rm.GetCommitsAheadOfBase(context.Background(), repoPath, baseSHA)
	require.NoError(t, err)
	require.Len(t, commits, 3)

	// Commits should be in reverse chronological order (newest first)
	assert.Equal(t, "Third commit", commits[0].Message)
	assert.Equal(t, "Second commit", commits[1].Message)
	assert.Equal(t, "First commit", commits[2].Message)
}

func TestGetCommitsAheadOfBase_CommitWithMultipleFiles(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	baseSHA := getCommitSHA(t, repoPath)

	// Create multiple files and commit them together
	writeFile(t, repoPath, "fileA.txt", "line 1\nline 2\n")
	writeFile(t, repoPath, "fileB.txt", "line 1\nline 2\nline 3\n")
	runGit(t, repoPath, "add", ".")
	runGit(t, repoPath, "commit", "-m", "Add multiple files")

	commits, err := rm.GetCommitsAheadOfBase(context.Background(), repoPath, baseSHA)
	require.NoError(t, err)
	require.Len(t, commits, 1)
	require.Len(t, commits[0].Files, 2)

	// Files should be present with correct stats
	fileMap := make(map[string]FileChange)
	for _, f := range commits[0].Files {
		fileMap[f.Path] = f
	}

	assert.Equal(t, 2, fileMap["fileA.txt"].Additions)
	assert.Equal(t, 3, fileMap["fileB.txt"].Additions)
}

func TestGetCommitsAheadOfBase_ModifiedAndDeletedFiles(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create some files first
	createAndCommitFile(t, repoPath, "modify-me.txt", "original\ncontent\n", "Add file to modify")
	createAndCommitFile(t, repoPath, "delete-me.txt", "will be deleted\n", "Add file to delete")

	baseSHA := getCommitSHA(t, repoPath)

	// Modify a file
	modifyAndCommitFile(t, repoPath, "modify-me.txt", "modified\ncontent\nnew line\n", "Modify file")

	// Delete a file
	deleteFile(t, repoPath, "delete-me.txt")
	runGit(t, repoPath, "add", "delete-me.txt")
	runGit(t, repoPath, "commit", "-m", "Delete file")

	commits, err := rm.GetCommitsAheadOfBase(context.Background(), repoPath, baseSHA)
	require.NoError(t, err)
	require.Len(t, commits, 2)

	// Most recent commit first (delete)
	assert.Equal(t, "Delete file", commits[0].Message)
	require.Len(t, commits[0].Files, 1)
	assert.Equal(t, "delete-me.txt", commits[0].Files[0].Path)
	assert.Equal(t, 0, commits[0].Files[0].Additions)
	assert.Equal(t, 1, commits[0].Files[0].Deletions)

	// Second commit (modify)
	assert.Equal(t, "Modify file", commits[1].Message)
	require.Len(t, commits[1].Files, 1)
	assert.Equal(t, "modify-me.txt", commits[1].Files[0].Path)
	assert.True(t, commits[1].Files[0].Additions > 0)
}

func TestGetCommitsAheadOfBase_OnFeatureBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	baseSHA := getCommitSHA(t, repoPath)

	// Create a feature branch and add commits
	runGit(t, repoPath, "checkout", "-b", "feature/test")
	createAndCommitFile(t, repoPath, "feature.txt", "feature code\n", "Add feature")
	createAndCommitFile(t, repoPath, "tests.txt", "test code\n", "Add tests")

	commits, err := rm.GetCommitsAheadOfBase(context.Background(), repoPath, baseSHA)
	require.NoError(t, err)
	require.Len(t, commits, 2)

	assert.Equal(t, "Add tests", commits[0].Message)
	assert.Equal(t, "Add feature", commits[1].Message)
}

func TestGetCommitsAheadOfBase_InvalidBaseRef(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Use a ref with special characters that should fail validation
	_, err := rm.GetCommitsAheadOfBase(context.Background(), repoPath, "ref; rm -rf /")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid base ref")
}

func TestGetCommitsAheadOfBase_NonExistentBaseRef(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	_, err := rm.GetCommitsAheadOfBase(context.Background(), repoPath, "0000000000000000000000000000000000000000")
	assert.Error(t, err)
}

func TestGetCommitsAheadOfBase_SHAFieldsArePopulated(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	baseSHA := getCommitSHA(t, repoPath)
	createAndCommitFile(t, repoPath, "test.txt", "content\n", "Test commit")

	expectedSHA := getCommitSHA(t, repoPath)

	commits, err := rm.GetCommitsAheadOfBase(context.Background(), repoPath, baseSHA)
	require.NoError(t, err)
	require.Len(t, commits, 1)

	// Full SHA should match
	assert.Equal(t, expectedSHA, commits[0].SHA)
	// Short SHA should be a prefix of the full SHA
	assert.True(t, len(commits[0].ShortSHA) >= 7)
	assert.Equal(t, commits[0].SHA[:len(commits[0].ShortSHA)], commits[0].ShortSHA)
}

func TestGetCommitsAheadOfBase_EmptyFilesSliceNotNil(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	baseSHA := getCommitSHA(t, repoPath)

	// Create an empty commit (amend with allow-empty)
	runGit(t, repoPath, "commit", "--allow-empty", "-m", "Empty commit")

	commits, err := rm.GetCommitsAheadOfBase(context.Background(), repoPath, baseSHA)
	require.NoError(t, err)
	require.Len(t, commits, 1)

	// Files slice should be initialized (not nil), even if empty
	assert.NotNil(t, commits[0].Files)
	assert.Len(t, commits[0].Files, 0)
}

func TestGetCommitsAheadOfBase_SubdirectoryFiles(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	baseSHA := getCommitSHA(t, repoPath)

	// Create files in subdirectories
	writeFile(t, repoPath, "src/components/Button.tsx", "export function Button() {}\n")
	writeFile(t, repoPath, "src/utils/helpers.ts", "export const helper = () => {}\n")
	runGit(t, repoPath, "add", ".")
	runGit(t, repoPath, "commit", "-m", "Add component files")

	commits, err := rm.GetCommitsAheadOfBase(context.Background(), repoPath, baseSHA)
	require.NoError(t, err)
	require.Len(t, commits, 1)
	require.Len(t, commits[0].Files, 2)

	paths := make(map[string]bool)
	for _, f := range commits[0].Files {
		paths[f.Path] = true
	}

	assert.True(t, paths["src/components/Button.tsx"])
	assert.True(t, paths["src/utils/helpers.ts"])
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

// ============================================================================
// PushBranch Tests
// ============================================================================

func TestPushBranch_Success(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create a feature branch with a commit
	runGit(t, repoPath, "checkout", "-b", "feature/push-test")
	createAndCommitFile(t, repoPath, "push-test.txt", "content\n", "Push test commit")

	err := rm.PushBranch(context.Background(), repoPath, "feature/push-test")
	require.NoError(t, err)

	// Verify the branch was pushed to origin
	out := runGit(t, repoPath, "branch", "-r")
	assert.Contains(t, out, "origin/feature/push-test")
}

func TestPushBranch_InvalidBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	err := rm.PushBranch(context.Background(), repoPath, "branch; rm -rf /")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid branch name")
}

func TestPushBranch_ContextCancellation(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := rm.PushBranch(ctx, repoPath, "main")
	require.Error(t, err)
}

// ============================================================================
// GetDiffSummary Tests
// ============================================================================

func TestGetDiffSummary_WithChanges(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	baseSHA := getCommitSHA(t, repoPath)

	// Make some changes (unstaged so they show up in diff against base)
	runGit(t, repoPath, "checkout", "-b", "feature/diff-test")
	createAndCommitFile(t, repoPath, "new-file.txt", "line 1\nline 2\nline 3\n", "Add new file")

	summary, err := rm.GetDiffSummary(context.Background(), repoPath, baseSHA, 4096)
	require.NoError(t, err)

	assert.Contains(t, summary, "=== Diff Stats ===")
	assert.Contains(t, summary, "=== Diff ===")
	assert.Contains(t, summary, "new-file.txt")
}

func TestGetDiffSummary_NoChanges(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	headSHA := getCommitSHA(t, repoPath)

	summary, err := rm.GetDiffSummary(context.Background(), repoPath, headSHA, 4096)
	require.NoError(t, err)

	// Should still have section headers but no actual diff content
	assert.Contains(t, summary, "=== Diff Stats ===")
	assert.Contains(t, summary, "=== Diff ===")
}

func TestGetDiffSummary_Truncation(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	baseSHA := getCommitSHA(t, repoPath)

	// Create a file with enough content to exceed maxBytes
	largeContent := ""
	for i := 0; i < 100; i++ {
		largeContent += "This is a line of content that contributes to a large diff output.\n"
	}
	createAndCommitFile(t, repoPath, "large-file.txt", largeContent, "Add large file")

	// Use a very small maxBytes to force truncation
	summary, err := rm.GetDiffSummary(context.Background(), repoPath, baseSHA, 100)
	require.NoError(t, err)

	assert.Contains(t, summary, "... (truncated)")
}

func TestGetDiffSummary_InvalidBaseRef(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	_, err := rm.GetDiffSummary(context.Background(), repoPath, "ref; rm -rf /", 4096)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid base ref")
}

// ============================================================================
// GetMergeBase Tests
// ============================================================================

func TestGetMergeBase_SameCommit(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	headSHA := getCommitSHA(t, repoPath)

	// merge-base of HEAD with itself is HEAD
	result, err := rm.GetMergeBase(context.Background(), repoPath, "HEAD", "HEAD")
	require.NoError(t, err)
	assert.Equal(t, headSHA, result)
}

func TestGetMergeBase_LinearHistory(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	baseSHA := getCommitSHA(t, repoPath)

	// Add commits on top of main
	createAndCommitFile(t, repoPath, "file1.txt", "content\n", "Commit 1")
	createAndCommitFile(t, repoPath, "file2.txt", "content\n", "Commit 2")

	// merge-base of baseSHA and HEAD should be baseSHA (linear history)
	result, err := rm.GetMergeBase(context.Background(), repoPath, baseSHA, "HEAD")
	require.NoError(t, err)
	assert.Equal(t, baseSHA, result)
}

func TestGetMergeBase_DivergedBranches(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Record the fork point
	forkSHA := getCommitSHA(t, repoPath)

	// Create a feature branch with its own commits
	runGit(t, repoPath, "checkout", "-b", "feature/test")
	createAndCommitFile(t, repoPath, "feature.txt", "feature code\n", "Feature commit")

	// Go back to main and add commits (simulating origin/main advancing)
	runGit(t, repoPath, "checkout", "main")
	createAndCommitFile(t, repoPath, "main-update.txt", "main update\n", "Main commit")

	// Go back to feature branch
	runGit(t, repoPath, "checkout", "feature/test")

	// merge-base of main and feature should be the fork point
	result, err := rm.GetMergeBase(context.Background(), repoPath, "main", "HEAD")
	require.NoError(t, err)
	assert.Equal(t, forkSHA, result)
}

func TestGetMergeBase_DivergedBranches_DiffAccuracy(t *testing.T) {
	// This test demonstrates the core bug fix: diffing against merge-base
	// shows only session changes, while diffing against the live branch
	// would show phantom changes from main.
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Record the fork point
	forkSHA := getCommitSHA(t, repoPath)

	// Create a feature branch with one file change
	runGit(t, repoPath, "checkout", "-b", "feature/session")
	createAndCommitFile(t, repoPath, "session-work.txt", "session code\n", "Session commit")

	// Go back to main and add a DIFFERENT file (simulating origin/main advancing)
	runGit(t, repoPath, "checkout", "main")
	createAndCommitFile(t, repoPath, "other-dev-work.txt", "other dev code\n", "Other dev commit")

	// Go back to the feature branch
	runGit(t, repoPath, "checkout", "feature/session")

	// Using merge-base (correct): diff should show ONLY the session's file
	mergeBase, err := rm.GetMergeBase(context.Background(), repoPath, "main", "HEAD")
	require.NoError(t, err)
	assert.Equal(t, forkSHA, mergeBase)

	changesFromMergeBase, err := rm.GetChangedFilesWithStats(context.Background(), repoPath, mergeBase)
	require.NoError(t, err)
	assert.Len(t, changesFromMergeBase, 1, "merge-base diff should show only session changes")
	assert.Equal(t, "session-work.txt", changesFromMergeBase[0].Path)

	// Using live branch (broken): diff would show BOTH the session's file
	// AND the other dev's file as a "deletion" (since feature branch doesn't have it)
	changesFromMain, err := rm.GetChangedFilesWithStats(context.Background(), repoPath, "main")
	require.NoError(t, err)
	assert.Greater(t, len(changesFromMain), 1, "live branch diff incorrectly shows files from main")
}

func TestGetMergeBase_AfterRebase(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create a feature branch with commits
	runGit(t, repoPath, "checkout", "-b", "feature/rebase-test")
	createAndCommitFile(t, repoPath, "feature.txt", "feature code\n", "Feature commit")

	// Go back to main, add commits (simulating origin/main advancing)
	runGit(t, repoPath, "checkout", "main")
	createAndCommitFile(t, repoPath, "main-advance.txt", "main code\n", "Main advance")
	newMainSHA := getCommitSHA(t, repoPath)

	// Push updated main to origin
	runGit(t, repoPath, "push", "origin", "main")

	// Go back to feature and rebase onto updated main
	runGit(t, repoPath, "checkout", "feature/rebase-test")
	runGit(t, repoPath, "rebase", "main")

	// After rebase, merge-base should be the NEW main tip (rebase point)
	result, err := rm.GetMergeBase(context.Background(), repoPath, "main", "HEAD")
	require.NoError(t, err)
	assert.Equal(t, newMainSHA, result)

	// Diff against merge-base should show ONLY the feature file
	changes, err := rm.GetChangedFilesWithStats(context.Background(), repoPath, result)
	require.NoError(t, err)
	assert.Len(t, changes, 1)
	assert.Equal(t, "feature.txt", changes[0].Path)
}

func TestGetMergeBase_AfterRebase_MainAdvancesFurther(t *testing.T) {
	// This is the exact scenario reported as a bug: after rebase, main
	// advances again, and the Changes panel should still only show session changes.
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create feature branch
	runGit(t, repoPath, "checkout", "-b", "feature/post-rebase")
	createAndCommitFile(t, repoPath, "feature.txt", "feature\n", "Feature commit")

	// Main advances
	runGit(t, repoPath, "checkout", "main")
	createAndCommitFile(t, repoPath, "main1.txt", "main1\n", "Main advance 1")

	// Rebase feature onto main
	runGit(t, repoPath, "checkout", "feature/post-rebase")
	runGit(t, repoPath, "rebase", "main")
	rebasePointSHA := getCommitSHA(t, repoPath)
	// Get the merge-base right after rebase (should be main tip at rebase time)
	mbAfterRebase, err := rm.GetMergeBase(context.Background(), repoPath, "main", "HEAD")
	require.NoError(t, err)

	// Main advances AGAIN (this is what triggers the bug with the old approach)
	runGit(t, repoPath, "checkout", "main")
	createAndCommitFile(t, repoPath, "main2.txt", "main2\n", "Main advance 2")

	// Go back to feature
	runGit(t, repoPath, "checkout", "feature/post-rebase")

	// merge-base should STILL be the rebase point, not the new main tip
	mbAfterMainAdvance, err := rm.GetMergeBase(context.Background(), repoPath, "main", "HEAD")
	require.NoError(t, err)
	assert.Equal(t, mbAfterRebase, mbAfterMainAdvance, "merge-base should be stable after main advances")

	// And that merge-base should NOT be the current HEAD of feature
	assert.NotEqual(t, rebasePointSHA, mbAfterMainAdvance, "merge-base should be the rebase point, not feature HEAD")

	// Diff against merge-base: only session changes
	changes, err := rm.GetChangedFilesWithStats(context.Background(), repoPath, mbAfterMainAdvance)
	require.NoError(t, err)
	assert.Len(t, changes, 1, "should only show session's file, not main2.txt")
	assert.Equal(t, "feature.txt", changes[0].Path)

	// Diff against live main (broken approach): would show extra files
	changesFromMain, err := rm.GetChangedFilesWithStats(context.Background(), repoPath, "main")
	require.NoError(t, err)
	assert.Greater(t, len(changesFromMain), 1, "live main diff incorrectly includes main2.txt")
}

func TestGetMergeBase_WithOriginRef(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create feature branch
	runGit(t, repoPath, "checkout", "-b", "feature/origin-test")
	createAndCommitFile(t, repoPath, "feature.txt", "feature\n", "Feature commit")

	// merge-base with origin/main should work (origin/main was set up in createTestGitRepo)
	result, err := rm.GetMergeBase(context.Background(), repoPath, "origin/main", "HEAD")
	require.NoError(t, err)
	assert.NotEmpty(t, result)
	assert.Len(t, result, 40, "should be a full SHA")
}

func TestGetMergeBase_InvalidRef1(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	_, err := rm.GetMergeBase(context.Background(), repoPath, "ref; rm -rf /", "HEAD")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid ref1")
}

func TestGetMergeBase_InvalidRef2(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	_, err := rm.GetMergeBase(context.Background(), repoPath, "HEAD", "ref; rm -rf /")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid ref2")
}

func TestGetMergeBase_NonExistentRef(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	_, err := rm.GetMergeBase(context.Background(), repoPath, "nonexistent-branch", "HEAD")
	require.Error(t, err)
}

func TestGetMergeBase_NoCommonAncestor(t *testing.T) {
	// Create two repos with no shared history (orphan branches)
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create an orphan branch with no common ancestor to main
	runGit(t, repoPath, "checkout", "--orphan", "orphan-branch")
	runGit(t, repoPath, "rm", "-rf", ".")
	writeFile(t, repoPath, "orphan.txt", "orphan content\n")
	runGit(t, repoPath, "add", ".")
	runGit(t, repoPath, "commit", "-m", "Orphan commit")

	// merge-base should fail because there's no common ancestor
	_, err := rm.GetMergeBase(context.Background(), repoPath, "main", "HEAD")
	require.Error(t, err)
}

func TestGetMergeBase_MultipleSessionCommits(t *testing.T) {
	// Simulate a real session: multiple commits on a feature branch,
	// main advances, verify merge-base and diff are correct.
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	forkSHA := getCommitSHA(t, repoPath)

	// Feature branch with multiple commits
	runGit(t, repoPath, "checkout", "-b", "feature/multi-commit")
	createAndCommitFile(t, repoPath, "feat1.go", "package feat\n", "Add feat1")
	createAndCommitFile(t, repoPath, "feat2.go", "package feat\n", "Add feat2")
	modifyAndCommitFile(t, repoPath, "feat1.go", "package feat\n\nfunc Init() {}\n", "Update feat1")

	// Main advances with unrelated changes
	runGit(t, repoPath, "checkout", "main")
	createAndCommitFile(t, repoPath, "unrelated.txt", "unrelated\n", "Unrelated main commit")
	createAndCommitFile(t, repoPath, "another.txt", "another\n", "Another main commit")

	// Back to feature
	runGit(t, repoPath, "checkout", "feature/multi-commit")

	// merge-base should be the original fork point
	result, err := rm.GetMergeBase(context.Background(), repoPath, "main", "HEAD")
	require.NoError(t, err)
	assert.Equal(t, forkSHA, result)

	// Diff against merge-base: only the 2 feature files
	changes, err := rm.GetChangedFilesWithStats(context.Background(), repoPath, result)
	require.NoError(t, err)
	paths := map[string]bool{}
	for _, c := range changes {
		paths[c.Path] = true
	}
	assert.True(t, paths["feat1.go"], "should include feat1.go")
	assert.True(t, paths["feat2.go"], "should include feat2.go")
	assert.False(t, paths["unrelated.txt"], "should NOT include unrelated.txt from main")
	assert.False(t, paths["another.txt"], "should NOT include another.txt from main")
}

// ============================================================================
// ValidateGitRef Security Tests
// ============================================================================

func TestValidateGitRef_EmptyRef(t *testing.T) {
	err := ValidateGitRef("")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty git ref")
}

func TestValidateGitRef_ValidRefs(t *testing.T) {
	validRefs := []struct {
		name string
		ref  string
	}{
		{"simple branch", "main"},
		{"feature branch", "feature/foo"},
		{"version tag", "v1.0.0"},
		{"tilde ref", "abc123~2"},
		{"caret ref", "HEAD^{}"},
		{"double dot range", "main..feature"},
		{"at sign ref", "HEAD@{1}"},
		{"SHA prefix", "abc1234"},
		{"full SHA", "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"},
		{"nested slashes", "fix/issue/123"},
		{"underscores", "fix_something"},
		{"dots in name", "release.1.0"},
	}

	for _, tt := range validRefs {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateGitRef(tt.ref)
			assert.NoError(t, err, "ref %q should be valid", tt.ref)
		})
	}
}

func TestValidateGitRef_HyphenPrefix(t *testing.T) {
	// Flag injection: refs starting with hyphen could be interpreted as git flags
	dangerousRefs := []string{
		"--exec=whoami",
		"-D",
		"--all",
		"-v",
		"--force",
	}

	for _, ref := range dangerousRefs {
		t.Run(ref, func(t *testing.T) {
			err := ValidateGitRef(ref)
			require.Error(t, err)
			assert.Contains(t, err.Error(), "cannot start with hyphen")
		})
	}
}

func TestValidateGitRef_ShellMetachars(t *testing.T) {
	// Shell metacharacters that could enable command injection
	metachars := []struct {
		name string
		ref  string
	}{
		{"semicolon", "ref;rm -rf /"},
		{"pipe", "ref|cat /etc/passwd"},
		{"ampersand", "ref&whoami"},
		{"dollar", "ref$HOME"},
		{"backtick", "ref`id`"},
		{"open paren", "ref(cmd)"},
		{"close paren", "ref)"},
		{"space", "ref with space"},
		{"exclamation", "ref!important"},
		{"backslash", "ref\\path"},
		{"single quote", "ref'inject"},
		{"double quote", `ref"inject`},
		{"newline", "ref\ninjection"},
	}

	for _, tt := range metachars {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateGitRef(tt.ref)
			assert.Error(t, err, "ref %q should be rejected", tt.ref)
		})
	}
}

func TestValidateGitRef_NullByte(t *testing.T) {
	err := ValidateGitRef("ref\x00injection")
	assert.Error(t, err, "null byte should be rejected")
}

func TestValidateGitRef_DoubleDotAllowed(t *testing.T) {
	// ".." is valid git range syntax
	err := ValidateGitRef("main..feature")
	assert.NoError(t, err)

	err = ValidateGitRef("v1.0..v2.0")
	assert.NoError(t, err)
}

func TestValidateGitRef_UnicodeRejected(t *testing.T) {
	unicodeRefs := []string{
		"branché",
		"ブランチ",
		"分支",
		"ветка",
	}

	for _, ref := range unicodeRefs {
		t.Run(ref, func(t *testing.T) {
			err := ValidateGitRef(ref)
			assert.Error(t, err, "unicode ref %q should be rejected", ref)
		})
	}
}

// ============================================================================
// ListRemotes Tests
// ============================================================================

func TestListRemotes_Success(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	remotes, err := rm.ListRemotes(context.Background(), repoPath)
	require.NoError(t, err)
	assert.Contains(t, remotes, "origin")
}

func TestListRemotes_NoRemotes(t *testing.T) {
	// Create a repo without a remote
	dir := t.TempDir()
	runGit(t, dir, "init")
	runGit(t, dir, "config", "user.email", "test@test.com")
	runGit(t, dir, "config", "user.name", "Test User")
	writeFile(t, dir, "README.md", "# Test")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "Initial commit")

	rm := NewRepoManager()
	remotes, err := rm.ListRemotes(context.Background(), dir)
	require.NoError(t, err)
	assert.Empty(t, remotes)
}

func TestListRemotes_MultipleRemotes(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Add a second remote
	upstreamDir := t.TempDir()
	runGit(t, upstreamDir, "init", "--bare")
	runGit(t, repoPath, "remote", "add", "upstream", upstreamDir)

	remotes, err := rm.ListRemotes(context.Background(), repoPath)
	require.NoError(t, err)
	assert.Len(t, remotes, 2)
	assert.Contains(t, remotes, "origin")
	assert.Contains(t, remotes, "upstream")
}

// ============================================================================
// ListRemoteBranches Tests
// ============================================================================

func TestListRemoteBranches_Success(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Push a feature branch to origin
	runGit(t, repoPath, "checkout", "-b", "feature/remote-test")
	createAndCommitFile(t, repoPath, "remote.txt", "content", "Remote commit")
	runGit(t, repoPath, "push", "origin", "feature/remote-test")
	runGit(t, repoPath, "checkout", "main")

	branches, err := rm.ListRemoteBranches(context.Background(), repoPath, "origin")
	require.NoError(t, err)
	assert.Contains(t, branches, "origin/main")
	assert.Contains(t, branches, "origin/feature/remote-test")
}

// ============================================================================
// RefExists Tests
// ============================================================================

func TestRefExists_ExistingBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	assert.True(t, rm.RefExists(context.Background(), repoPath, "main"))
}

func TestRefExists_NonExistent(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	assert.False(t, rm.RefExists(context.Background(), repoPath, "nonexistent-branch"))
}

func TestRefExists_CommitSHA(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	sha := getCommitSHA(t, repoPath)
	assert.True(t, rm.RefExists(context.Background(), repoPath, sha))
}

// ============================================================================
// GetUntrackedFiles Tests
// ============================================================================

func TestGetUntrackedFiles_NonePresent(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	files, err := rm.GetUntrackedFiles(context.Background(), repoPath)
	require.NoError(t, err)
	assert.Empty(t, files)
}

func TestGetUntrackedFiles_SomePresent(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create untracked files
	writeFile(t, repoPath, "untracked1.txt", "content1")
	writeFile(t, repoPath, "untracked2.txt", "content2")

	files, err := rm.GetUntrackedFiles(context.Background(), repoPath)
	require.NoError(t, err)
	assert.Len(t, files, 2)

	paths := make(map[string]bool)
	for _, f := range files {
		paths[f.Path] = true
		assert.Equal(t, "untracked", f.Status)
	}
	assert.True(t, paths["untracked1.txt"])
	assert.True(t, paths["untracked2.txt"])
}

func TestGetUntrackedFiles_IgnoresDirectories(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create untracked files in a subdirectory
	writeFile(t, repoPath, "subdir/file.txt", "content")

	files, err := rm.GetUntrackedFiles(context.Background(), repoPath)
	require.NoError(t, err)

	// Should return individual files, not directories
	for _, f := range files {
		assert.False(t, f.Path == "subdir/", "should not include directory entries")
	}
}

// ============================================================================
// FilterGitIgnored Tests
// ============================================================================

func TestFilterGitIgnored_EmptyList(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	result := rm.FilterGitIgnored(context.Background(), repoPath, []FileChange{})
	assert.Empty(t, result)
}

func TestFilterGitIgnored_NoIgnoredFiles(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create a .gitignore that ignores dist/
	writeFile(t, repoPath, ".gitignore", "dist/\n")
	runGit(t, repoPath, "add", ".gitignore")
	runGit(t, repoPath, "commit", "-m", "Add gitignore")

	changes := []FileChange{
		{Path: "src/main.go", Status: "modified"},
		{Path: "README.md", Status: "added"},
	}

	result := rm.FilterGitIgnored(context.Background(), repoPath, changes)
	assert.Len(t, result, 2)
}

func TestFilterGitIgnored_FiltersIgnoredFiles(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create a .gitignore that ignores dist/ and build/
	writeFile(t, repoPath, ".gitignore", "dist/\nbuild/\n*.log\n")
	runGit(t, repoPath, "add", ".gitignore")
	runGit(t, repoPath, "commit", "-m", "Add gitignore")

	changes := []FileChange{
		{Path: "src/main.go", Status: "modified"},
		{Path: "dist/bundle.js", Status: "added"},
		{Path: "dist/bundle.css", Status: "added"},
		{Path: "build/output.bin", Status: "added"},
		{Path: "app.log", Status: "untracked"},
		{Path: "README.md", Status: "modified"},
	}

	result := rm.FilterGitIgnored(context.Background(), repoPath, changes)
	assert.Len(t, result, 2)

	paths := make(map[string]bool)
	for _, f := range result {
		paths[f.Path] = true
	}
	assert.True(t, paths["src/main.go"])
	assert.True(t, paths["README.md"])
}

func TestFilterGitIgnored_NestedGitignore(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create a nested .gitignore
	writeFile(t, repoPath, ".gitignore", "*.log\n")
	writeFile(t, repoPath, "src/.gitignore", "*.generated.go\n")
	runGit(t, repoPath, "add", ".gitignore", "src/.gitignore")
	runGit(t, repoPath, "commit", "-m", "Add gitignore files")

	changes := []FileChange{
		{Path: "src/main.go", Status: "modified"},
		{Path: "src/types.generated.go", Status: "added"},
		{Path: "debug.log", Status: "untracked"},
	}

	result := rm.FilterGitIgnored(context.Background(), repoPath, changes)
	assert.Len(t, result, 1)
	assert.Equal(t, "src/main.go", result[0].Path)
}

func TestFilterGitIgnored_PreservesFileChangeFields(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	writeFile(t, repoPath, ".gitignore", "dist/\n")
	runGit(t, repoPath, "add", ".gitignore")
	runGit(t, repoPath, "commit", "-m", "Add gitignore")

	changes := []FileChange{
		{Path: "src/main.go", Additions: 10, Deletions: 5, Status: "modified"},
		{Path: "dist/bundle.js", Additions: 100, Deletions: 0, Status: "added"},
	}

	result := rm.FilterGitIgnored(context.Background(), repoPath, changes)
	require.Len(t, result, 1)
	assert.Equal(t, "src/main.go", result[0].Path)
	assert.Equal(t, 10, result[0].Additions)
	assert.Equal(t, 5, result[0].Deletions)
	assert.Equal(t, "modified", result[0].Status)
}

// ============================================================================
// GetFileCommitHistory Tests
// ============================================================================

func TestGetFileCommitHistory_SingleFile(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create a file with multiple commits
	createAndCommitFile(t, repoPath, "tracked.txt", "line1\n", "First version")
	modifyAndCommitFile(t, repoPath, "tracked.txt", "line1\nline2\n", "Second version")

	commits, err := rm.GetFileCommitHistory(context.Background(), repoPath, "tracked.txt")
	require.NoError(t, err)
	require.Len(t, commits, 2)

	// Most recent first
	assert.Equal(t, "Second version", commits[0].Message)
	assert.Equal(t, "First version", commits[1].Message)

	// Verify fields are populated
	for _, c := range commits {
		assert.Len(t, c.SHA, 40)
		assert.True(t, len(c.ShortSHA) >= 7)
		assert.Equal(t, "Test User", c.Author)
		assert.Equal(t, "test@test.com", c.Email)
		assert.False(t, c.Timestamp.IsZero())
	}

	// Second version should show additions
	assert.Greater(t, commits[0].Additions, 0)
}

func TestGetFileCommitHistory_NoCommits(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Request history for a file that doesn't exist
	commits, err := rm.GetFileCommitHistory(context.Background(), repoPath, "nonexistent.txt")
	require.NoError(t, err)
	assert.Empty(t, commits)
}

// ============================================================================
// GetStatus Tests
// ============================================================================

func TestGetStatus_CleanWorktree(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	status, err := rm.GetStatus(context.Background(), repoPath, "main")
	require.NoError(t, err)

	assert.Equal(t, 0, status.WorkingDirectory.StagedCount)
	assert.Equal(t, 0, status.WorkingDirectory.UnstagedCount)
	assert.Equal(t, 0, status.WorkingDirectory.UntrackedCount)
	assert.Equal(t, 0, status.WorkingDirectory.TotalUncommitted)
	assert.False(t, status.WorkingDirectory.HasChanges)
	assert.Equal(t, "none", status.InProgress.Type)
}

func TestGetStatus_MixedChanges(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create staged change
	writeFile(t, repoPath, "staged.txt", "staged content")
	runGit(t, repoPath, "add", "staged.txt")

	// Create unstaged change
	writeFile(t, repoPath, "README.md", "modified readme")

	// Create untracked file
	writeFile(t, repoPath, "untracked.txt", "untracked content")

	status, err := rm.GetStatus(context.Background(), repoPath, "main")
	require.NoError(t, err)

	assert.Equal(t, 1, status.WorkingDirectory.StagedCount)
	assert.Equal(t, 1, status.WorkingDirectory.UnstagedCount)
	assert.Equal(t, 1, status.WorkingDirectory.UntrackedCount)
	assert.Equal(t, 3, status.WorkingDirectory.TotalUncommitted)
	assert.True(t, status.WorkingDirectory.HasChanges)
}

func TestGetStatus_InProgressMerge(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create conflicting branches
	runGit(t, repoPath, "checkout", "-b", "conflict-branch")
	modifyAndCommitFile(t, repoPath, "README.md", "conflict branch content", "Conflict commit")
	runGit(t, repoPath, "checkout", "main")
	modifyAndCommitFile(t, repoPath, "README.md", "main content", "Main commit")

	// Start a merge that will conflict
	runGitMayFail(repoPath, "merge", "conflict-branch")

	status, err := rm.GetStatus(context.Background(), repoPath, "main")
	require.NoError(t, err)

	assert.Equal(t, "merge", status.InProgress.Type)

	// Cleanup
	runGitMayFail(repoPath, "merge", "--abort")
}

// ============================================================================
// GetHeadSHA Tests
// ============================================================================

func TestGetHeadSHA_ReturnsValidSHA(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	sha, err := rm.GetHeadSHA(context.Background(), repoPath)
	require.NoError(t, err)
	assert.Len(t, sha, 40)
	assert.Regexp(t, `^[0-9a-f]{40}$`, sha)
}

func TestGetHeadSHA_MatchesExpected(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	expected := getCommitSHA(t, repoPath)
	sha, err := rm.GetHeadSHA(context.Background(), repoPath)
	require.NoError(t, err)
	assert.Equal(t, expected, sha)
}

// ============================================================================
// GetGitHubRemote Tests
// ============================================================================

func TestGetGitHubRemote_SSHFormat(t *testing.T) {
	dir := t.TempDir()
	runGit(t, dir, "init")
	runGit(t, dir, "config", "user.email", "test@test.com")
	runGit(t, dir, "config", "user.name", "Test User")
	writeFile(t, dir, "README.md", "# Test")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "Initial commit")
	runGit(t, dir, "remote", "add", "origin", "git@github.com:myowner/myrepo.git")

	rm := NewRepoManager()
	owner, repo, err := rm.GetGitHubRemote(context.Background(), dir)
	require.NoError(t, err)
	assert.Equal(t, "myowner", owner)
	assert.Equal(t, "myrepo", repo)
}

func TestGetGitHubRemote_HTTPSFormat(t *testing.T) {
	dir := t.TempDir()
	runGit(t, dir, "init")
	runGit(t, dir, "config", "user.email", "test@test.com")
	runGit(t, dir, "config", "user.name", "Test User")
	writeFile(t, dir, "README.md", "# Test")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "Initial commit")
	runGit(t, dir, "remote", "add", "origin", "https://github.com/myowner/myrepo.git")

	rm := NewRepoManager()
	owner, repo, err := rm.GetGitHubRemote(context.Background(), dir)
	require.NoError(t, err)
	assert.Equal(t, "myowner", owner)
	assert.Equal(t, "myrepo", repo)
}

func TestGetGitHubRemote_NonGitHubRemote(t *testing.T) {
	dir := t.TempDir()
	runGit(t, dir, "init")
	runGit(t, dir, "config", "user.email", "test@test.com")
	runGit(t, dir, "config", "user.name", "Test User")
	writeFile(t, dir, "README.md", "# Test")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "Initial commit")
	runGit(t, dir, "remote", "add", "origin", "https://gitlab.com/myowner/myrepo.git")

	rm := NewRepoManager()
	_, _, err := rm.GetGitHubRemote(context.Background(), dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unable to parse GitHub remote")
}

func TestGetGitHubRemote_NoOrigin(t *testing.T) {
	dir := t.TempDir()
	runGit(t, dir, "init")
	runGit(t, dir, "config", "user.email", "test@test.com")
	runGit(t, dir, "config", "user.name", "Test User")
	writeFile(t, dir, "README.md", "# Test")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "Initial commit")

	rm := NewRepoManager()
	_, _, err := rm.GetGitHubRemote(context.Background(), dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to get origin remote")
}

// ============================================================================
// ListBranches Tests
// ============================================================================

func TestListBranches_DefaultSort(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create several branches with commits
	runGit(t, repoPath, "checkout", "-b", "branch-a")
	createAndCommitFile(t, repoPath, "a.txt", "a", "Commit A")
	runGit(t, repoPath, "checkout", "main")

	runGit(t, repoPath, "checkout", "-b", "branch-b")
	createAndCommitFile(t, repoPath, "b.txt", "b", "Commit B")
	runGit(t, repoPath, "checkout", "main")

	result, err := rm.ListBranches(context.Background(), repoPath, BranchListOptions{
		SortBy:   "date",
		SortDesc: true,
	})
	require.NoError(t, err)

	assert.GreaterOrEqual(t, len(result.Branches), 3) // main, branch-a, branch-b
	assert.Equal(t, len(result.Branches), result.Total)

	// Verify date-descending order: each commit date should be >= next
	for i := 0; i < len(result.Branches)-1; i++ {
		assert.True(t,
			!result.Branches[i].LastCommitDate.Before(result.Branches[i+1].LastCommitDate),
			"branch %q date should be >= %q date",
			result.Branches[i].Name, result.Branches[i+1].Name,
		)
	}
}

func TestListBranches_SearchFilter(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	runGit(t, repoPath, "checkout", "-b", "feature/search-me")
	createAndCommitFile(t, repoPath, "s.txt", "s", "Commit S")
	runGit(t, repoPath, "checkout", "main")

	runGit(t, repoPath, "checkout", "-b", "fix/something")
	createAndCommitFile(t, repoPath, "f.txt", "f", "Commit F")
	runGit(t, repoPath, "checkout", "main")

	result, err := rm.ListBranches(context.Background(), repoPath, BranchListOptions{
		Search: "search",
	})
	require.NoError(t, err)

	assert.Len(t, result.Branches, 1)
	assert.Equal(t, "feature/search-me", result.Branches[0].Name)
}

func TestListBranches_Pagination(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	// Create 5 branches
	for i := 0; i < 5; i++ {
		name := fmt.Sprintf("branch-%d", i)
		runGit(t, repoPath, "checkout", "-b", name)
		createAndCommitFile(t, repoPath, name+".txt", "content", "Commit "+name)
		runGit(t, repoPath, "checkout", "main")
	}

	// Get first page
	result, err := rm.ListBranches(context.Background(), repoPath, BranchListOptions{
		Limit:  2,
		Offset: 0,
	})
	require.NoError(t, err)
	assert.Len(t, result.Branches, 2)
	assert.True(t, result.HasMore)
	assert.Equal(t, 6, result.Total) // 5 + main

	// Get second page
	result2, err := rm.ListBranches(context.Background(), repoPath, BranchListOptions{
		Limit:  2,
		Offset: 2,
	})
	require.NoError(t, err)
	assert.Len(t, result2.Branches, 2)
	assert.True(t, result2.HasMore)

	// Get last page
	result3, err := rm.ListBranches(context.Background(), repoPath, BranchListOptions{
		Limit:  2,
		Offset: 4,
	})
	require.NoError(t, err)
	assert.Len(t, result3.Branches, 2)
	assert.False(t, result3.HasMore)

	// All branches across pages should be different
	allNames := make(map[string]bool)
	for _, b := range result.Branches {
		allNames[b.Name] = true
	}
	for _, b := range result2.Branches {
		allNames[b.Name] = true
	}
	for _, b := range result3.Branches {
		allNames[b.Name] = true
	}
	assert.Len(t, allNames, 6, "all branches should be unique across pages")
}

func TestListBranches_NameSort(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()

	runGit(t, repoPath, "checkout", "-b", "zebra")
	createAndCommitFile(t, repoPath, "z.txt", "z", "Z")
	runGit(t, repoPath, "checkout", "main")

	runGit(t, repoPath, "checkout", "-b", "alpha")
	createAndCommitFile(t, repoPath, "a.txt", "a", "A")
	runGit(t, repoPath, "checkout", "main")

	result, err := rm.ListBranches(context.Background(), repoPath, BranchListOptions{
		SortBy:   "name",
		SortDesc: false,
	})
	require.NoError(t, err)

	// Should be alphabetically sorted
	assert.Equal(t, "alpha", result.Branches[0].Name)
}

// ============================================================================
// sortBranches Tests
// ============================================================================

func TestSortBranches_DateAscDesc(t *testing.T) {
	now := time.Now()
	branches := []BranchInfo{
		{Name: "old", LastCommitDate: now.Add(-2 * time.Hour)},
		{Name: "new", LastCommitDate: now},
		{Name: "mid", LastCommitDate: now.Add(-1 * time.Hour)},
	}

	// Sort ascending
	sortBranches(branches, "date", false)
	assert.Equal(t, "old", branches[0].Name)
	assert.Equal(t, "mid", branches[1].Name)
	assert.Equal(t, "new", branches[2].Name)

	// Sort descending
	sortBranches(branches, "date", true)
	assert.Equal(t, "new", branches[0].Name)
	assert.Equal(t, "mid", branches[1].Name)
	assert.Equal(t, "old", branches[2].Name)
}

func TestSortBranches_NameAscDesc(t *testing.T) {
	branches := []BranchInfo{
		{Name: "charlie"},
		{Name: "alpha"},
		{Name: "bravo"},
	}

	// Sort ascending
	sortBranches(branches, "name", false)
	assert.Equal(t, "alpha", branches[0].Name)
	assert.Equal(t, "bravo", branches[1].Name)
	assert.Equal(t, "charlie", branches[2].Name)

	// Sort descending
	sortBranches(branches, "name", true)
	assert.Equal(t, "charlie", branches[0].Name)
	assert.Equal(t, "bravo", branches[1].Name)
	assert.Equal(t, "alpha", branches[2].Name)
}
