package git

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// createBareTestRepo creates a bare git repository with an initial commit,
// suitable for use as a clone source. Returns a file:// URL.
func createBareTestRepo(t *testing.T) string {
	t.Helper()

	// Create a regular repo with a commit
	workDir := t.TempDir()
	runTestGit(t, workDir, "init")
	runTestGit(t, workDir, "config", "user.email", "test@test.com")
	runTestGit(t, workDir, "config", "user.name", "Test User")
	runTestGit(t, workDir, "checkout", "-b", "main")

	readmePath := filepath.Join(workDir, "README.md")
	require.NoError(t, os.WriteFile(readmePath, []byte("# Test Repository"), 0644))
	runTestGit(t, workDir, "add", ".")
	runTestGit(t, workDir, "commit", "-m", "Initial commit")

	// Create a bare clone to act as "remote"
	bareDir := t.TempDir()
	runTestGit(t, bareDir, "clone", "--bare", workDir, ".")

	return "file://" + bareDir
}

// runTestGit executes a git command in the given directory.
func runTestGit(t *testing.T, dir string, args ...string) {
	t.Helper()

	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "git %v failed: %s", args, string(out))
}

func TestCloneRepo_Success(t *testing.T) {
	bareRepo := createBareTestRepo(t)
	parentDir := t.TempDir()
	rm := NewRepoManager()

	clonedPath, err := rm.CloneRepo(context.Background(), bareRepo, parentDir, "my-clone")
	require.NoError(t, err)

	// Verify the cloned path
	assert.Equal(t, filepath.Join(parentDir, "my-clone"), clonedPath)

	// Verify it's a valid git repo
	gitDir := filepath.Join(clonedPath, ".git")
	_, err = os.Stat(gitDir)
	assert.NoError(t, err, ".git directory should exist")

	// Verify it has the commit from the source
	cmd := exec.Command("git", "log", "--oneline")
	cmd.Dir = clonedPath
	out, err := cmd.Output()
	require.NoError(t, err)
	assert.Contains(t, string(out), "Initial commit")
}

func TestCloneRepo_TargetAlreadyExists(t *testing.T) {
	bareRepo := createBareTestRepo(t)
	parentDir := t.TempDir()
	rm := NewRepoManager()

	// Pre-create the target directory
	existingDir := filepath.Join(parentDir, "existing")
	require.NoError(t, os.Mkdir(existingDir, 0755))

	_, err := rm.CloneRepo(context.Background(), bareRepo, parentDir, "existing")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "directory already exists")
}

func TestCloneRepo_InvalidURL(t *testing.T) {
	parentDir := t.TempDir()
	rm := NewRepoManager()

	tests := []struct {
		name string
		url  string
	}{
		{"empty string", ""},
		{"random text", "not-a-url"},
		{"just a path", "/some/local/path"},
		{"ftp protocol", "ftp://example.com/repo"},
		{"no host", "https:///repo.git"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := rm.CloneRepo(context.Background(), tt.url, parentDir, "test-clone")
			require.Error(t, err)
			assert.Contains(t, err.Error(), "invalid git URL")
		})
	}
}

func TestCloneRepo_ParentDirNotExist(t *testing.T) {
	rm := NewRepoManager()

	_, err := rm.CloneRepo(context.Background(), "https://github.com/user/repo.git", "/nonexistent/path/that/does/not/exist", "test")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "parent directory does not exist")
}

func TestCloneRepo_ContextCancellation(t *testing.T) {
	bareRepo := createBareTestRepo(t)
	parentDir := t.TempDir()
	rm := NewRepoManager()

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := rm.CloneRepo(ctx, bareRepo, parentDir, "cancelled-clone")
	require.Error(t, err)

	// Target directory should be cleaned up
	_, statErr := os.Stat(filepath.Join(parentDir, "cancelled-clone"))
	assert.True(t, os.IsNotExist(statErr), "partial clone should be cleaned up")
}

func TestCloneRepo_ReturnsCorrectPath(t *testing.T) {
	bareRepo := createBareTestRepo(t)
	parentDir := t.TempDir()
	rm := NewRepoManager()

	path, err := rm.CloneRepo(context.Background(), bareRepo, parentDir, "my-project")
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(parentDir, "my-project"), path)
}

func TestCloneRepo_SpecialCharsInDirName(t *testing.T) {
	bareRepo := createBareTestRepo(t)
	parentDir := t.TempDir()
	rm := NewRepoManager()

	tests := []struct {
		name    string
		dirName string
	}{
		{"hyphenated", "my-cool-project"},
		{"underscored", "my_cool_project"},
		{"dotted", "my.project"},
		{"with spaces", "my project"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path, err := rm.CloneRepo(context.Background(), bareRepo, parentDir, tt.dirName)
			require.NoError(t, err)
			assert.Equal(t, filepath.Join(parentDir, tt.dirName), path)

			// Verify it's a valid git repo
			_, err = os.Stat(filepath.Join(path, ".git"))
			assert.NoError(t, err)
		})
	}
}

func TestCloneRepo_CloneFailureCleansUp(t *testing.T) {
	parentDir := t.TempDir()
	rm := NewRepoManager()

	// Use a URL that will definitely fail (valid format but nonexistent)
	_, err := rm.CloneRepo(context.Background(), "https://github.com/nonexistent-user-zzzzz/nonexistent-repo-zzzzz.git", parentDir, "failed-clone")
	require.Error(t, err)

	// Target directory should be cleaned up
	_, statErr := os.Stat(filepath.Join(parentDir, "failed-clone"))
	assert.True(t, os.IsNotExist(statErr), "failed clone directory should be cleaned up")
}

func TestIsValidGitURL(t *testing.T) {
	tests := []struct {
		url   string
		valid bool
	}{
		{"https://github.com/user/repo.git", true},
		{"https://github.com/user/repo", true},
		{"http://github.com/user/repo.git", true},
		{"git@github.com:user/repo.git", true},
		{"ssh://git@github.com/user/repo.git", true},
		{"git://github.com/user/repo.git", true},
		{"https://gitlab.com/org/project", true},
		{"git@bitbucket.org:team/repo.git", true},
		{"file:///tmp/some-repo", true},
		{"", false},
		{"not-a-url", false},
		{"/local/path", false},
		{"ftp://example.com/repo", false},
	}

	for _, tt := range tests {
		t.Run(tt.url, func(t *testing.T) {
			assert.Equal(t, tt.valid, IsValidGitURL(tt.url))
		})
	}
}

func TestCloneRepo_ParentIsFile(t *testing.T) {
	// Create a file where parent dir should be
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "not-a-dir")
	require.NoError(t, os.WriteFile(filePath, []byte("I'm a file"), 0644))

	rm := NewRepoManager()
	_, err := rm.CloneRepo(context.Background(), "https://github.com/user/repo.git", filePath, "test")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not a directory")
}
