package git

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveGitDir_RegularRepo(t *testing.T) {
	dir := createTestGitRepo(t)

	gitDir, err := ResolveGitDir(dir)
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(dir, ".git"), gitDir)
}

func TestResolveGitDir_Worktree(t *testing.T) {
	dir := createTestGitRepo(t)

	// Create a worktree
	worktreePath := t.TempDir()
	runGit(t, dir, "worktree", "add", "-b", "test-wt", worktreePath, "main")

	gitDir, err := ResolveGitDir(worktreePath)
	require.NoError(t, err)
	// Should point to the main repo's .git/worktrees/<name> directory
	assert.Contains(t, gitDir, filepath.Join(dir, ".git", "worktrees"))
}

func TestResolveGitDir_NotARepo(t *testing.T) {
	dir := t.TempDir()
	_, err := ResolveGitDir(dir)
	assert.Error(t, err)
}

func TestResolveCommonDir_RegularRepo(t *testing.T) {
	dir := createTestGitRepo(t)
	gitDir := filepath.Join(dir, ".git")

	commonDir := resolveCommonDir(gitDir)
	assert.Equal(t, gitDir, commonDir)
}

func TestResolveCommonDir_Worktree(t *testing.T) {
	dir := createTestGitRepo(t)
	worktreePath := t.TempDir()
	runGit(t, dir, "worktree", "add", "-b", "test-wt-common", worktreePath, "main")

	gitDir, err := ResolveGitDir(worktreePath)
	require.NoError(t, err)

	commonDir := resolveCommonDir(gitDir)
	// Common dir should be the main repo's .git directory
	// Use EvalSymlinks to handle macOS /var -> /private/var symlink
	expected, _ := filepath.EvalSymlinks(filepath.Join(dir, ".git"))
	actual, _ := filepath.EvalSymlinks(commonDir)
	assert.Equal(t, expected, actual)
}

func TestReadCurrentBranch(t *testing.T) {
	dir := createTestGitRepo(t)

	branch, err := readCurrentBranch(dir)
	require.NoError(t, err)
	assert.Equal(t, "main", branch)
}

func TestReadCurrentBranch_FeatureBranch(t *testing.T) {
	dir := createTestGitRepo(t)
	runGit(t, dir, "checkout", "-b", "feature/my-feature")

	branch, err := readCurrentBranch(dir)
	require.NoError(t, err)
	assert.Equal(t, "feature/my-feature", branch)
}

func TestReadCurrentBranch_DetachedHead(t *testing.T) {
	dir := createTestGitRepo(t)
	sha := getCommitSHA(t, dir)
	runGit(t, dir, "checkout", sha)

	branch, err := readCurrentBranch(dir)
	require.NoError(t, err)
	assert.Equal(t, "HEAD", branch)
}

func TestReadHeadSHA(t *testing.T) {
	dir := createTestGitRepo(t)
	expectedSHA := getCommitSHA(t, dir)

	sha, err := readHeadSHA(dir)
	require.NoError(t, err)
	assert.Equal(t, expectedSHA, sha)
}

func TestReadHeadSHA_AfterCommit(t *testing.T) {
	dir := createTestGitRepo(t)
	createAndCommitFile(t, dir, "new.txt", "content", "new commit")
	expectedSHA := getCommitSHA(t, dir)

	sha, err := readHeadSHA(dir)
	require.NoError(t, err)
	assert.Equal(t, expectedSHA, sha)
}

func TestReadHeadSHA_DetachedHead(t *testing.T) {
	dir := createTestGitRepo(t)
	expectedSHA := getCommitSHA(t, dir)
	runGit(t, dir, "checkout", expectedSHA)

	sha, err := readHeadSHA(dir)
	require.NoError(t, err)
	assert.Equal(t, expectedSHA, sha)
}

func TestReadRemoteURL(t *testing.T) {
	dir := createTestGitRepo(t)

	url, err := readRemoteURL(dir, "origin")
	require.NoError(t, err)
	assert.NotEmpty(t, url)
}

func TestReadRemoteURL_NonExistentRemote(t *testing.T) {
	dir := createTestGitRepo(t)

	_, err := readRemoteURL(dir, "nonexistent")
	assert.Error(t, err)
}

func TestReadInProgressStatus_Clean(t *testing.T) {
	dir := createTestGitRepo(t)

	status, err := readInProgressStatus(dir)
	require.NoError(t, err)
	assert.Equal(t, "none", status.Type)
}

func TestReadUpstreamRef(t *testing.T) {
	dir := createTestGitRepo(t)

	// main tracks origin/main (set up by createTestGitRepo)
	upstream, err := readUpstreamRef(dir, "main")
	require.NoError(t, err)
	assert.Equal(t, "origin/main", upstream)
}

func TestReadUpstreamRef_NoUpstream(t *testing.T) {
	dir := createTestGitRepo(t)
	runGit(t, dir, "checkout", "-b", "local-only")

	_, err := readUpstreamRef(dir, "local-only")
	assert.Error(t, err)
}

func TestLookupPackedRef(t *testing.T) {
	dir := createTestGitRepo(t)
	expectedSHA := getCommitSHA(t, dir)

	// Pack refs so they end up in packed-refs
	runGit(t, dir, "pack-refs", "--all")

	gitDir := filepath.Join(dir, ".git")
	sha, err := lookupPackedRef(gitDir, "refs/heads/main")
	require.NoError(t, err)
	assert.Equal(t, expectedSHA, sha)
}

func TestLookupPackedRef_NotFound(t *testing.T) {
	dir := createTestGitRepo(t)
	runGit(t, dir, "pack-refs", "--all")

	gitDir := filepath.Join(dir, ".git")
	_, err := lookupPackedRef(gitDir, "refs/heads/nonexistent")
	assert.Error(t, err)
}

func TestReadHeadSHA_PackedRefs(t *testing.T) {
	dir := createTestGitRepo(t)
	expectedSHA := getCommitSHA(t, dir)

	// Pack refs and remove loose ref file
	runGit(t, dir, "pack-refs", "--all")

	// Remove the loose ref file to force packed-refs lookup
	looseRefPath := filepath.Join(dir, ".git", "refs", "heads", "main")
	os.Remove(looseRefPath) // May already be gone after pack-refs --all on some git versions

	sha, err := readHeadSHA(dir)
	require.NoError(t, err)
	assert.Equal(t, expectedSHA, sha)
}

func TestResolveRef_LooseRef(t *testing.T) {
	dir := createTestGitRepo(t)
	expectedSHA := getCommitSHA(t, dir)

	gitDir := filepath.Join(dir, ".git")
	sha, err := resolveRef(gitDir, "refs/heads/main")
	require.NoError(t, err)
	assert.Equal(t, expectedSHA, sha)
}

func TestReadCurrentBranch_Worktree(t *testing.T) {
	dir := createTestGitRepo(t)
	worktreePath := t.TempDir()
	runGit(t, dir, "worktree", "add", "-b", "wt-branch", worktreePath, "main")

	branch, err := readCurrentBranch(worktreePath)
	require.NoError(t, err)
	assert.Equal(t, "wt-branch", branch)
}

func TestReadHeadSHA_Worktree(t *testing.T) {
	dir := createTestGitRepo(t)
	expectedSHA := getCommitSHA(t, dir)
	worktreePath := t.TempDir()
	runGit(t, dir, "worktree", "add", "-b", "wt-sha", worktreePath, "main")

	sha, err := readHeadSHA(worktreePath)
	require.NoError(t, err)
	assert.Equal(t, expectedSHA, sha)
}

func TestReadRemoteURL_Worktree(t *testing.T) {
	dir := createTestGitRepo(t)
	worktreePath := t.TempDir()
	runGit(t, dir, "worktree", "add", "-b", "wt-remote", worktreePath, "main")

	url, err := readRemoteURL(worktreePath, "origin")
	require.NoError(t, err)
	assert.NotEmpty(t, url)

	// Should match the main repo's remote URL
	mainURL, err := readRemoteURL(dir, "origin")
	require.NoError(t, err)
	assert.Equal(t, mainURL, url)
}
