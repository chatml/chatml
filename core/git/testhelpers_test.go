package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// createTestGitRepo creates a temporary git repository for testing
// Returns the path to the repository. Cleanup is automatic.
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

// createTestGitRepoWithBranch creates a test repo with a specific branch name
func createTestGitRepoWithBranch(t *testing.T, branchName string) string {
	t.Helper()

	dir := createTestGitRepo(t)

	// Rename the default branch
	runGit(t, dir, "branch", "-M", branchName)

	return dir
}

// runGit executes a git command in the given directory
func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()

	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "git %v failed: %s", args, string(out))
	return string(out)
}

// runGitMayFail executes a git command that might fail, returning output and error
func runGitMayFail(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// writeFile creates a file with the given content
func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()

	path := filepath.Join(dir, name)
	err := os.MkdirAll(filepath.Dir(path), 0755)
	require.NoError(t, err)
	err = os.WriteFile(path, []byte(content), 0644)
	require.NoError(t, err)
}

// deleteFile removes a file
func deleteFile(t *testing.T, dir, name string) {
	t.Helper()

	path := filepath.Join(dir, name)
	err := os.Remove(path)
	require.NoError(t, err)
}

// createAndCommitFile creates a file and commits it
func createAndCommitFile(t *testing.T, dir, name, content, message string) {
	t.Helper()

	writeFile(t, dir, name, content)
	runGit(t, dir, "add", name)
	runGit(t, dir, "commit", "-m", message)
}

// modifyAndCommitFile modifies an existing file and commits the change
func modifyAndCommitFile(t *testing.T, dir, name, content, message string) {
	t.Helper()

	writeFile(t, dir, name, content)
	runGit(t, dir, "add", name)
	runGit(t, dir, "commit", "-m", message)
}

// getCommitSHA returns the current HEAD commit SHA
func getCommitSHA(t *testing.T, dir string) string {
	t.Helper()

	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = dir
	out, err := cmd.Output()
	require.NoError(t, err)
	return string(out[:40]) // Return just the SHA
}

// createBranch creates a new branch
func createBranch(t *testing.T, dir, branchName string) {
	t.Helper()

	runGit(t, dir, "branch", branchName)
}

// checkoutBranch switches to a branch
func checkoutBranch(t *testing.T, dir, branchName string) {
	t.Helper()

	runGit(t, dir, "checkout", branchName)
}

// branchExists checks if a branch exists
func branchExists(t *testing.T, dir, branchName string) bool {
	t.Helper()

	_, err := runGitMayFail(dir, "rev-parse", "--verify", branchName)
	return err == nil
}
