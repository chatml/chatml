package stats

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/chatml/chatml-backend/appdir"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/chatml/chatml-core/git"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testStatsCache is a minimal in-memory StatsCache for testing.
type testStatsCache struct {
	entries      map[string]*models.SessionStats
	setCalls     int
	invalidCalls int
}

func newTestStatsCache() *testStatsCache {
	return &testStatsCache{entries: make(map[string]*models.SessionStats)}
}

func (c *testStatsCache) Set(sessionID string, stats *models.SessionStats) {
	c.setCalls++
	c.entries[sessionID] = stats
}

func (c *testStatsCache) Invalidate(sessionID string) {
	c.invalidCalls++
	delete(c.entries, sessionID)
}

// testDiffInvalidator tracks diff invalidation calls.
type testDiffInvalidator struct {
	invalidated []string
}

func (d *testDiffInvalidator) InvalidateSession(sessionID string) {
	d.invalidated = append(d.invalidated, sessionID)
}

// testSnapshotInvalidator tracks snapshot invalidation calls.
type testSnapshotInvalidator struct {
	invalidated []string
}

func (s *testSnapshotInvalidator) Invalidate(sessionID string) {
	s.invalidated = append(s.invalidated, sessionID)
}

func TestMain(m *testing.M) {
	tmpHome, _ := os.MkdirTemp("", "chatml-stats-test-*")
	os.Setenv("HOME", tmpHome)
	appdir.Init()
	code := m.Run()
	os.RemoveAll(tmpHome)
	os.Exit(code)
}

func TestCompute_EmptyWorktreePath(t *testing.T) {
	sc := newTestStatsCache()
	comp := New(git.NewRepoManager(), nil, sc)

	session := &models.Session{WorktreePath: ""}
	result := comp.Compute(context.Background(), session, nil)
	assert.Nil(t, result)
}

func TestCompute_BaseSessionUsesRepoPath(t *testing.T) {
	sc := newTestStatsCache()
	rm := git.NewRepoManager()
	comp := New(rm, nil, sc)

	repoPath := createTestGitRepo(t)

	session := &models.Session{
		WorktreePath: "", // Empty — base session should use repo.Path
		SessionType:  models.SessionTypeBase,
	}
	repo := &models.Repo{Path: repoPath, Branch: "main"}

	// Should not panic and should return nil (no changes)
	result := comp.Compute(context.Background(), session, repo)
	assert.Nil(t, result)
}

func TestCompute_ReturnsStatsForCommittedChanges(t *testing.T) {
	sc := newTestStatsCache()
	rm := git.NewRepoManager()
	comp := New(rm, nil, sc)

	repoPath := createTestGitRepo(t)

	// Record base commit SHA before making changes
	baseSHA := getCommitSHA(t, repoPath)

	// Create a committed change on a new branch
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = repoPath
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("command %v failed: %v\n%s", args, err, out)
		}
	}

	run("git", "checkout", "-b", "feature")
	require.NoError(t, os.WriteFile(repoPath+"/newfile.txt", []byte("hello\nworld\n"), 0644))
	run("git", "add", ".")
	run("git", "commit", "-m", "add newfile")

	session := &models.Session{
		WorktreePath:  repoPath,
		BaseCommitSHA: baseSHA,
	}
	repo := &models.Repo{Branch: "main"}

	result := comp.Compute(context.Background(), session, repo)
	require.NotNil(t, result)
	assert.Equal(t, 2, result.Additions) // "hello\nworld\n" = 2 lines
	assert.Equal(t, 0, result.Deletions)
}

func TestComputeAndCache_StoresInCache(t *testing.T) {
	sc := newTestStatsCache()
	rm := git.NewRepoManager()
	s, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)
	defer s.Close()

	comp := New(rm, s, sc)

	repoPath := createTestGitRepo(t)

	// Create repo and session in store
	ctx := context.Background()
	require.NoError(t, s.AddRepo(ctx, &models.Repo{
		ID: "ws-1", Name: "test", Path: repoPath, Branch: "main",
	}))
	require.NoError(t, s.AddSession(ctx, &models.Session{
		ID: "sess-1", WorkspaceID: "ws-1", WorktreePath: repoPath,
		Status: "idle", SessionType: models.SessionTypeWorktree,
	}))

	result := comp.ComputeAndCache(ctx, "sess-1")
	// No changes, so nil stats — but cache.Set should still be called
	assert.Nil(t, result)
	assert.Equal(t, 1, sc.setCalls)
}

func TestInvalidateAndRecompute_InvalidatesAllCaches(t *testing.T) {
	sc := newTestStatsCache()
	di := &testDiffInvalidator{}
	si := &testSnapshotInvalidator{}
	rm := git.NewRepoManager()
	s, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)
	defer s.Close()

	comp := New(rm, s, sc)
	comp.SetDiffCache(di)
	comp.SetSnapshotCache(si)

	repoPath := createTestGitRepo(t)

	ctx := context.Background()
	require.NoError(t, s.AddRepo(ctx, &models.Repo{
		ID: "ws-1", Name: "test", Path: repoPath, Branch: "main",
	}))
	require.NoError(t, s.AddSession(ctx, &models.Session{
		ID: "sess-1", WorkspaceID: "ws-1", WorktreePath: repoPath,
		Status: "idle", SessionType: models.SessionTypeWorktree,
	}))

	comp.InvalidateAndRecompute(ctx, "sess-1")

	assert.Equal(t, 1, sc.invalidCalls)
	assert.Equal(t, 1, sc.setCalls)
	assert.Equal(t, []string{"sess-1"}, di.invalidated)
	assert.Equal(t, []string{"sess-1"}, si.invalidated)
}

func TestCompute_UsesSessionTargetBranch(t *testing.T) {
	sc := newTestStatsCache()
	rm := git.NewRepoManager()
	comp := New(rm, nil, sc)

	repoPath := createTestGitRepo(t)

	session := &models.Session{
		WorktreePath:  repoPath,
		TargetBranch:  "origin/develop", // Should use this, not repo defaults
		BaseCommitSHA: "HEAD",
	}
	repo := &models.Repo{Branch: "main", Remote: "origin"}

	// Should not panic even with non-existent target branch
	// (falls back to BaseCommitSHA)
	result := comp.Compute(context.Background(), session, repo)
	assert.Nil(t, result) // No changes
}

// getCommitSHA returns the current HEAD commit SHA.
func getCommitSHA(t *testing.T, repoPath string) string {
	t.Helper()
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	require.NoError(t, err)
	return strings.TrimSpace(string(out))
}

// createTestGitRepo creates a temporary git repo with an initial commit for testing.
func createTestGitRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = dir
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("command %v failed: %v\n%s", args, err, out)
		}
	}

	run("git", "init")
	run("git", "config", "user.email", "test@test.com")
	run("git", "config", "user.name", "Test")

	require.NoError(t, os.WriteFile(dir+"/init.txt", []byte("init\n"), 0644))

	run("git", "add", ".")
	run("git", "commit", "-m", "init")

	return dir
}
