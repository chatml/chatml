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
	assert.Contains(t, summary, "=== Diff (truncated) ===")
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
	assert.Contains(t, summary, "=== Diff (truncated) ===")
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
