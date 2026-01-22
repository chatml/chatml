package branch

import (
	"os"
	"path/filepath"
	"testing"
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
