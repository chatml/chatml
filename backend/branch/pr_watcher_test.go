package branch

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// Mock implementations
// ---------------------------------------------------------------------------

type mockPRWatcherStore struct {
	sessions map[string]*models.Session
	repos    map[string]*models.Repo
}

func newMockStore() *mockPRWatcherStore {
	return &mockPRWatcherStore{
		sessions: make(map[string]*models.Session),
		repos:    make(map[string]*models.Repo),
	}
}

func (m *mockPRWatcherStore) GetSession(_ context.Context, id string) (*models.Session, error) {
	if s, ok := m.sessions[id]; ok {
		return s, nil
	}
	return nil, nil
}

func (m *mockPRWatcherStore) UpdateSession(_ context.Context, id string, fn func(*models.Session)) error {
	s, ok := m.sessions[id]
	if !ok {
		s = &models.Session{ID: id}
		m.sessions[id] = s
	}
	fn(s)
	return nil
}

func (m *mockPRWatcherStore) GetRepo(_ context.Context, id string) (*models.Repo, error) {
	if r, ok := m.repos[id]; ok {
		return r, nil
	}
	return nil, nil
}

// mockPRWatcherRepoManager returns a fixed owner/repo for all calls.
type mockPRWatcherRepoManager struct {
	owner string
	repo  string
	err   error
}

func (m *mockPRWatcherRepoManager) GetGitHubRemote(_ context.Context, _ string) (string, string, error) {
	return m.owner, m.repo, m.err
}

// mockPRWatcherRepoManagerByPath returns different owner/repo based on repoPath.
type mockPRWatcherRepoManagerByPath struct {
	mapping map[string]struct{ owner, repo string }
}

func (m *mockPRWatcherRepoManagerByPath) GetGitHubRemote(_ context.Context, repoPath string) (string, string, error) {
	if entry, ok := m.mapping[repoPath]; ok {
		return entry.owner, entry.repo, nil
	}
	return "", "", assert.AnError
}

// ---------------------------------------------------------------------------
// Helper: build a PRWatcher without starting the polling goroutine
// ---------------------------------------------------------------------------

func newTestPRWatcher(store PRWatcherStore, repoMgr PRWatcherRepoManager, prCache *github.PRCache) *PRWatcher {
	ctx, cancel := context.WithCancel(context.Background())
	return &PRWatcher{
		sessions:    make(map[string]*PRWatchEntry),
		ghClient:    nil,
		repoManager: repoMgr,
		store:       store,
		prCache:     prCache,
		ctx:         ctx,
		cancel:      cancel,
	}
}

// ---------------------------------------------------------------------------
// WatchSession tests
// ---------------------------------------------------------------------------

func TestPRWatcher_WatchSession_AddsEntry(t *testing.T) {
	w := newTestPRWatcher(newMockStore(), &mockPRWatcherRepoManager{}, nil)
	defer w.Close()

	w.WatchSession("sess-1", "ws-1", "feature/foo", "/repo/path", "none", 0, "")

	w.mu.RLock()
	defer w.mu.RUnlock()

	entry, ok := w.sessions["sess-1"]
	require.True(t, ok, "session entry should exist")
	assert.Equal(t, "sess-1", entry.SessionID)
	assert.Equal(t, "ws-1", entry.WorkspaceID)
	assert.Equal(t, "feature/foo", entry.Branch)
	assert.Equal(t, "/repo/path", entry.RepoPath)
	assert.Equal(t, "none", entry.PRStatus)
}

func TestPRWatcher_WatchSession_WithPRNumber(t *testing.T) {
	w := newTestPRWatcher(newMockStore(), &mockPRWatcherRepoManager{}, nil)
	defer w.Close()

	w.WatchSession("sess-1", "ws-1", "feature/foo", "/repo/path", "open", 42, "https://github.com/org/repo/pull/42")

	w.mu.RLock()
	defer w.mu.RUnlock()

	entry, ok := w.sessions["sess-1"]
	require.True(t, ok, "session entry should exist")
	assert.Equal(t, 42, entry.PRNumber)
	assert.Equal(t, "https://github.com/org/repo/pull/42", entry.PRUrl)
	assert.Equal(t, "open", entry.PRStatus)
}

func TestPRWatcher_WatchSession_Idempotent(t *testing.T) {
	w := newTestPRWatcher(newMockStore(), &mockPRWatcherRepoManager{}, nil)
	defer w.Close()

	w.WatchSession("sess-1", "ws-1", "feature/foo", "/repo/path", "none", 0, "")
	w.WatchSession("sess-1", "ws-1", "feature/bar", "/other/path", "open", 1, "")

	w.mu.RLock()
	defer w.mu.RUnlock()

	require.Len(t, w.sessions, 1, "should still have exactly one entry")

	entry := w.sessions["sess-1"]
	// The original entry should be unchanged because the second call returns early.
	assert.Equal(t, "feature/foo", entry.Branch)
	assert.Equal(t, "/repo/path", entry.RepoPath)
	assert.Equal(t, "none", entry.PRStatus)
}

// ---------------------------------------------------------------------------
// UnwatchSession tests
// ---------------------------------------------------------------------------

func TestPRWatcher_UnwatchSession_RemovesEntry(t *testing.T) {
	w := newTestPRWatcher(newMockStore(), &mockPRWatcherRepoManager{}, nil)
	defer w.Close()

	w.WatchSession("sess-1", "ws-1", "feature/foo", "/repo/path", "none", 0, "")
	w.UnwatchSession("sess-1")

	w.mu.RLock()
	defer w.mu.RUnlock()

	_, ok := w.sessions["sess-1"]
	assert.False(t, ok, "session entry should have been removed")
}

func TestPRWatcher_UnwatchSession_NonExistent(t *testing.T) {
	w := newTestPRWatcher(newMockStore(), &mockPRWatcherRepoManager{}, nil)
	defer w.Close()

	// Should not panic when unwatching a session that was never added.
	assert.NotPanics(t, func() {
		w.UnwatchSession("does-not-exist")
	})
}

// ---------------------------------------------------------------------------
// UpdateSessionBranch tests
// ---------------------------------------------------------------------------

func TestPRWatcher_UpdateSessionBranch_UpdatesEntry(t *testing.T) {
	repoMgr := &mockPRWatcherRepoManager{owner: "org", repo: "myrepo"}
	w := newTestPRWatcher(newMockStore(), repoMgr, nil)
	defer w.Close()

	w.WatchSession("sess-1", "ws-1", "feature/old", "/repo/path", "none", 0, "")

	// Set LastChecked to a non-zero value so we can verify it gets reset.
	w.mu.Lock()
	w.sessions["sess-1"].LastChecked = time.Now()
	w.mu.Unlock()

	w.UpdateSessionBranch("sess-1", "feature/new")

	w.mu.RLock()
	defer w.mu.RUnlock()

	entry := w.sessions["sess-1"]
	require.NotNil(t, entry)
	assert.Equal(t, "feature/new", entry.Branch)
	assert.True(t, entry.LastChecked.IsZero(), "LastChecked should be reset to zero time")
}

func TestPRWatcher_UpdateSessionBranch_InvalidatesPRCache(t *testing.T) {
	repoMgr := &mockPRWatcherRepoManager{owner: "org", repo: "myrepo"}
	prCache := github.NewPRCache(5*time.Minute, 30*time.Minute)
	w := newTestPRWatcher(newMockStore(), repoMgr, prCache)
	defer w.Close()

	w.WatchSession("sess-1", "ws-1", "feature/old", "/repo/path", "none", 0, "")

	// This should call prCache.Invalidate internally without panicking.
	assert.NotPanics(t, func() {
		w.UpdateSessionBranch("sess-1", "feature/new")
	})
}

func TestPRWatcher_UpdateSessionBranch_NonExistent(t *testing.T) {
	repoMgr := &mockPRWatcherRepoManager{owner: "org", repo: "myrepo"}
	w := newTestPRWatcher(newMockStore(), repoMgr, nil)
	defer w.Close()

	// Should not panic when updating a branch for a session that was never watched.
	assert.NotPanics(t, func() {
		w.UpdateSessionBranch("does-not-exist", "feature/new")
	})
}

// ---------------------------------------------------------------------------
// Close tests
// ---------------------------------------------------------------------------

func TestPRWatcher_Close_CancelsContext(t *testing.T) {
	w := newTestPRWatcher(newMockStore(), &mockPRWatcherRepoManager{}, nil)

	// Verify the context is not cancelled before Close.
	require.NoError(t, w.ctx.Err())

	w.Close()

	assert.Error(t, w.ctx.Err(), "context should be cancelled after Close")
}

// ---------------------------------------------------------------------------
// boolPtrEqual tests
// ---------------------------------------------------------------------------

func boolPtr(v bool) *bool {
	return &v
}

func TestBoolPtrEqual_BothNil(t *testing.T) {
	assert.True(t, boolPtrEqual(nil, nil))
}

func TestBoolPtrEqual_FirstNil(t *testing.T) {
	assert.False(t, boolPtrEqual(nil, boolPtr(true)))
}

func TestBoolPtrEqual_SecondNil(t *testing.T) {
	assert.False(t, boolPtrEqual(boolPtr(true), nil))
}

func TestBoolPtrEqual_BothTrueSame(t *testing.T) {
	assert.True(t, boolPtrEqual(boolPtr(true), boolPtr(true)))
}

func TestBoolPtrEqual_BothFalseSame(t *testing.T) {
	assert.True(t, boolPtrEqual(boolPtr(false), boolPtr(false)))
}

func TestBoolPtrEqual_Different(t *testing.T) {
	assert.False(t, boolPtrEqual(boolPtr(true), boolPtr(false)))
}

// ---------------------------------------------------------------------------
// HasMergeConflict flag tests
// ---------------------------------------------------------------------------

func TestPRWatcher_CheckSessionPR_MergedPR_ClearsMergeConflict(t *testing.T) {
	// Simulate a PR that was open with a merge conflict, then gets merged.
	// The HasMergeConflict flag should be cleared when the PR transitions to merged.
	store := newMockStore()
	store.sessions["sess-1"] = &models.Session{
		ID:               "sess-1",
		HasMergeConflict: true, // was conflicting while open
		PRStatus:         models.PRStatusOpen,
		PRNumber:         42,
		TaskStatus:       models.TaskStatusInReview,
	}

	var capturedEvent *PRChangeEvent
	repoMgr := &mockPRWatcherRepoManager{owner: "org", repo: "myrepo"}
	w := newTestPRWatcher(store, repoMgr, nil)
	w.onChange = func(evt PRChangeEvent) {
		capturedEvent = &evt
	}
	defer w.Close()

	// Set up a mock GitHub API server that returns the PR as merged
	ts := newMockGitHubServer(t, mockGitHubResponses{
		prDetails: &mockPRDetails{state: "closed", merged: true, mergeable: nil},
		prMerged:  boolPtr(true),
	})
	defer ts.Close()

	ghClient := github.NewClient("", "")
	ghClient.SetToken("test-token")
	ghClient.SetAPIURL(ts.URL)
	w.ghClient = ghClient

	// Manually set up the watch entry as if PR was previously open
	w.mu.Lock()
	w.sessions["sess-1"] = &PRWatchEntry{
		SessionID: "sess-1",
		Branch:    "feature/foo",
		RepoPath:  "/repo/path",
		PRStatus:  models.PRStatusOpen,
		PRNumber:  42,
		PRUrl:     "https://github.com/org/myrepo/pull/42",
	}
	w.mu.Unlock()

	// PR is no longer in the open list (it's merged), so pass empty branchToPR
	w.checkSessionPR("org", "myrepo", w.sessions["sess-1"], map[string]*github.PRListItem{})

	// Verify store was updated
	sess := store.sessions["sess-1"]
	assert.False(t, sess.HasMergeConflict, "HasMergeConflict should be cleared for merged PR")
	assert.Equal(t, models.PRStatusMerged, sess.PRStatus)
	require.NotNil(t, capturedEvent, "should have emitted a change event")
}

func TestPRWatcher_CheckSessionPR_OpenPR_SetsMergeConflict(t *testing.T) {
	// When a PR is open and mergeable is false, HasMergeConflict should be true.
	store := newMockStore()
	store.sessions["sess-1"] = &models.Session{
		ID:         "sess-1",
		PRStatus:   "none",
		TaskStatus: models.TaskStatusInProgress,
	}

	repoMgr := &mockPRWatcherRepoManager{owner: "org", repo: "myrepo"}
	w := newTestPRWatcher(store, repoMgr, nil)
	w.onChange = func(evt PRChangeEvent) {}
	defer w.Close()

	mergeable := false
	ts := newMockGitHubServer(t, mockGitHubResponses{
		prDetails: &mockPRDetails{state: "open", merged: false, mergeable: &mergeable},
	})
	defer ts.Close()

	ghClient := github.NewClient("", "")
	ghClient.SetToken("test-token")
	ghClient.SetAPIURL(ts.URL)
	w.ghClient = ghClient

	w.mu.Lock()
	w.sessions["sess-1"] = &PRWatchEntry{
		SessionID: "sess-1",
		Branch:    "feature/foo",
		RepoPath:  "/repo/path",
		PRStatus:  "none",
	}
	w.mu.Unlock()

	// PR is in the open list
	branchToPR := map[string]*github.PRListItem{
		"feature/foo": {Number: 42, Branch: "feature/foo", HTMLURL: "https://github.com/org/myrepo/pull/42"},
	}
	w.checkSessionPR("org", "myrepo", w.sessions["sess-1"], branchToPR)

	sess := store.sessions["sess-1"]
	assert.True(t, sess.HasMergeConflict, "HasMergeConflict should be true for open non-mergeable PR")
	assert.Equal(t, models.PRStatusOpen, sess.PRStatus)
}

func TestPRWatcher_CheckSessionPR_ClosedPR_ClearsMergeConflict(t *testing.T) {
	// When a PR is closed (not merged), HasMergeConflict should be cleared.
	store := newMockStore()
	store.sessions["sess-1"] = &models.Session{
		ID:               "sess-1",
		HasMergeConflict: true,
		PRStatus:         models.PRStatusOpen,
		PRNumber:         42,
	}

	repoMgr := &mockPRWatcherRepoManager{owner: "org", repo: "myrepo"}
	w := newTestPRWatcher(store, repoMgr, nil)
	w.onChange = func(evt PRChangeEvent) {}
	defer w.Close()

	ts := newMockGitHubServer(t, mockGitHubResponses{
		prDetails: &mockPRDetails{state: "closed", merged: false, mergeable: nil},
		prMerged:  boolPtr(false),
	})
	defer ts.Close()

	ghClient := github.NewClient("", "")
	ghClient.SetToken("test-token")
	ghClient.SetAPIURL(ts.URL)
	w.ghClient = ghClient

	w.mu.Lock()
	w.sessions["sess-1"] = &PRWatchEntry{
		SessionID: "sess-1",
		Branch:    "feature/foo",
		RepoPath:  "/repo/path",
		PRStatus:  models.PRStatusOpen,
		PRNumber:  42,
		PRUrl:     "https://github.com/org/myrepo/pull/42",
	}
	w.mu.Unlock()

	w.checkSessionPR("org", "myrepo", w.sessions["sess-1"], map[string]*github.PRListItem{})

	sess := store.sessions["sess-1"]
	assert.False(t, sess.HasMergeConflict, "HasMergeConflict should be cleared for closed PR")
	assert.Equal(t, models.PRStatusClosed, sess.PRStatus)
}

// ---------------------------------------------------------------------------
// Mock GitHub server helpers
// ---------------------------------------------------------------------------

type mockPRDetails struct {
	state     string
	merged    bool
	mergeable *bool
}

type mockGitHubResponses struct {
	prDetails *mockPRDetails
	prMerged  *bool // response for /pulls/:number/merge endpoint
}

func newMockGitHubServer(t *testing.T, responses mockGitHubResponses) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Match /repos/:owner/:repo/pulls/:number/merge
		if matched, _ := regexp.MatchString(`/repos/.+/.+/pulls/\d+/merge$`, r.URL.Path); matched {
			if responses.prMerged != nil && *responses.prMerged {
				w.WriteHeader(http.StatusNoContent) // 204 = merged
			} else {
				w.WriteHeader(http.StatusNotFound) // 404 = not merged
			}
			return
		}

		// Match /repos/:owner/:repo/pulls/:number (PR details)
		if matched, _ := regexp.MatchString(`/repos/.+/.+/pulls/\d+$`, r.URL.Path); matched {
			if responses.prDetails == nil {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			pr := map[string]interface{}{
				"number":          42,
				"state":           responses.prDetails.state,
				"title":           "Test PR",
				"body":            "",
				"html_url":        "https://github.com/org/myrepo/pull/42",
				"merged":          responses.prDetails.merged,
				"mergeable":       responses.prDetails.mergeable,
				"mergeable_state": "unknown",
				"head":            map[string]string{"sha": "abc123"},
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(pr)
			return
		}

		// Match /repos/:owner/:repo/commits/:ref/check-runs
		if matched, _ := regexp.MatchString(`/repos/.+/.+/commits/.+/check-runs$`, r.URL.Path); matched {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"total_count": 0,
				"check_runs":  []interface{}{},
			})
			return
		}

		w.WriteHeader(http.StatusNotFound)
	}))
}

// ---------------------------------------------------------------------------
// groupSessionsByRepo tests
// ---------------------------------------------------------------------------

func TestPRWatcher_GroupSessionsByRepo(t *testing.T) {
	// Use a path-based mock so different repo paths yield different owner/repo pairs.
	repoMgr := &mockPRWatcherRepoManagerByPath{
		mapping: map[string]struct{ owner, repo string }{
			"/repo/alpha": {owner: "org", repo: "alpha"},
			"/repo/beta":  {owner: "org", repo: "beta"},
		},
	}
	w := newTestPRWatcher(newMockStore(), repoMgr, nil)
	defer w.Close()

	// Manually populate sessions with different repo paths.
	w.mu.Lock()
	w.sessions["sess-1"] = &PRWatchEntry{
		SessionID: "sess-1",
		Branch:    "feature/a",
		RepoPath:  "/repo/alpha",
	}
	w.sessions["sess-2"] = &PRWatchEntry{
		SessionID: "sess-2",
		Branch:    "feature/b",
		RepoPath:  "/repo/alpha",
	}
	w.sessions["sess-3"] = &PRWatchEntry{
		SessionID: "sess-3",
		Branch:    "feature/c",
		RepoPath:  "/repo/beta",
	}
	w.mu.Unlock()

	// Group all sessions (no filtering).
	groups := w.groupSessionsByRepo(func(_ *PRWatchEntry) bool {
		return true
	})

	assert.Len(t, groups, 2, "should have two distinct repo groups")

	alphaKey := repoKey{owner: "org", repo: "alpha"}
	betaKey := repoKey{owner: "org", repo: "beta"}

	alphaGroup, ok := groups[alphaKey]
	require.True(t, ok, "should have group for org/alpha")
	assert.Len(t, alphaGroup, 2, "alpha group should contain 2 sessions")

	betaGroup, ok := groups[betaKey]
	require.True(t, ok, "should have group for org/beta")
	assert.Len(t, betaGroup, 1, "beta group should contain 1 session")

	// Verify the filter works: exclude sess-1.
	filtered := w.groupSessionsByRepo(func(e *PRWatchEntry) bool {
		return e.SessionID != "sess-1"
	})

	alphaFiltered, ok := filtered[alphaKey]
	require.True(t, ok)
	assert.Len(t, alphaFiltered, 1, "alpha group should have 1 session after filtering")
	assert.Equal(t, "sess-2", alphaFiltered[0].SessionID)
}
