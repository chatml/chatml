package git

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGitCache_GetGitDir(t *testing.T) {
	dir := createTestGitRepo(t)
	cache := NewGitCache()

	// First call should resolve and cache
	gitDir, err := cache.GetGitDir(dir)
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(dir, ".git"), gitDir)

	// Second call should return cached value
	gitDir2, err := cache.GetGitDir(dir)
	require.NoError(t, err)
	assert.Equal(t, gitDir, gitDir2)
}

func TestGitCache_GetGitDir_Worktree(t *testing.T) {
	dir := createTestGitRepo(t)
	worktreePath := t.TempDir()
	runGit(t, dir, "worktree", "add", "-b", "cache-wt", worktreePath, "main")

	cache := NewGitCache()

	gitDir, err := cache.GetGitDir(worktreePath)
	require.NoError(t, err)
	assert.Contains(t, gitDir, filepath.Join(dir, ".git", "worktrees"))
}

func TestGitCache_GetCommonDir(t *testing.T) {
	dir := createTestGitRepo(t)
	cache := NewGitCache()

	gitDir := filepath.Join(dir, ".git")
	commonDir := cache.GetCommonDir(gitDir)
	assert.Equal(t, gitDir, commonDir)

	// Second call should return cached value
	commonDir2 := cache.GetCommonDir(gitDir)
	assert.Equal(t, commonDir, commonDir2)
}

func TestGitCache_GetRemoteURL(t *testing.T) {
	dir := createTestGitRepo(t)
	cache := NewGitCache()

	url, err := cache.GetRemoteURL(dir, "origin")
	require.NoError(t, err)
	assert.NotEmpty(t, url)

	// Second call should return cached value
	url2, err := cache.GetRemoteURL(dir, "origin")
	require.NoError(t, err)
	assert.Equal(t, url, url2)
}

func TestGitCache_GetRemoteURL_NotFound(t *testing.T) {
	dir := createTestGitRepo(t)
	cache := NewGitCache()

	_, err := cache.GetRemoteURL(dir, "nonexistent")
	assert.Error(t, err)
}

func TestGitCache_LookupPackedRef(t *testing.T) {
	dir := createTestGitRepo(t)
	expectedSHA := getCommitSHA(t, dir)
	runGit(t, dir, "pack-refs", "--all")

	cache := NewGitCache()
	gitDir := filepath.Join(dir, ".git")

	sha, err := cache.LookupPackedRef(gitDir, "refs/heads/main")
	require.NoError(t, err)
	assert.Equal(t, expectedSHA, sha)

	// Second call should use cached packed-refs
	sha2, err := cache.LookupPackedRef(gitDir, "refs/heads/main")
	require.NoError(t, err)
	assert.Equal(t, sha, sha2)
}

func TestGitCache_Invalidate(t *testing.T) {
	dir := createTestGitRepo(t)
	cache := NewGitCache()

	// Populate cache
	_, err := cache.GetGitDir(dir)
	require.NoError(t, err)
	_, err = cache.GetRemoteURL(dir, "origin")
	require.NoError(t, err)

	// Invalidate
	cache.Invalidate(dir)

	// gitDirs should be cleared
	cache.mu.RLock()
	_, cached := cache.gitDirs[dir]
	cache.mu.RUnlock()
	assert.False(t, cached)
}
