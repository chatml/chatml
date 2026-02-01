package github

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// ============================================================================
// Basic Operations
// ============================================================================

func TestIssueCache_SetAndGet(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	issues := []IssueListItem{
		{Number: 1, Title: "First Issue", State: "open"},
		{Number: 2, Title: "Second Issue", State: "open"},
	}

	cache.SetFull("owner", "repo", "open", "", issues, "etag-1")

	entry, freshness := cache.GetWithStale("owner", "repo", "open", "")
	require.Equal(t, CacheFresh, freshness)
	require.NotNil(t, entry)
	require.Len(t, entry.Issues, 2)
	require.Equal(t, 1, entry.Issues[0].Number)
	require.Equal(t, "First Issue", entry.Issues[0].Title)
	require.Equal(t, 2, entry.Issues[1].Number)
	require.Equal(t, "Second Issue", entry.Issues[1].Title)
	require.Equal(t, "etag-1", entry.ETag)
}

func TestIssueCache_GetNotFound(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	entry, freshness := cache.GetWithStale("owner", "nonexistent", "open", "")
	require.Equal(t, CacheMiss, freshness)
	require.Nil(t, entry)
}

func TestIssueCache_GetWithStale_Fresh(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	issues := []IssueListItem{
		{Number: 1, Title: "Test", State: "open", Labels: []IssueLabel{{Name: "bug", Color: "red"}}},
	}
	cache.SetFull("owner", "repo", "open", "", issues, "etag-fresh")

	entry, freshness := cache.GetWithStale("owner", "repo", "open", "")
	require.Equal(t, CacheFresh, freshness)
	require.NotNil(t, entry)
	require.Len(t, entry.Issues, 1)
	require.Equal(t, "etag-fresh", entry.ETag)
	require.Len(t, entry.Issues[0].Labels, 1)
	require.Equal(t, "bug", entry.Issues[0].Labels[0].Name)
}

func TestIssueCache_ImmutableCopy(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	issues := []IssueListItem{
		{Number: 1, Title: "Original", Labels: []IssueLabel{{Name: "bug", Color: "red"}}},
	}
	cache.SetFull("owner", "repo", "open", "", issues, "")

	// Modify original slice
	issues[0].Title = "Modified"
	issues[0].Labels[0].Name = "modified-label"

	// Cache should have original values
	entry, _ := cache.GetWithStale("owner", "repo", "open", "")
	require.Equal(t, "Original", entry.Issues[0].Title)
	require.Equal(t, "bug", entry.Issues[0].Labels[0].Name)
}

// ============================================================================
// Freshness Transitions
// ============================================================================

func TestIssueCache_FreshToStaleToExpired(t *testing.T) {
	cache := NewIssueCache(50*time.Millisecond, 150*time.Millisecond)
	defer cache.Close()

	issues := []IssueListItem{{Number: 1, Title: "Test"}}
	cache.SetFull("owner", "repo", "open", "", issues, "etag-1")

	// Should be fresh immediately
	entry, freshness := cache.GetWithStale("owner", "repo", "open", "")
	require.Equal(t, CacheFresh, freshness)
	require.NotNil(t, entry)
	require.Len(t, entry.Issues, 1)

	// Wait for fresh TTL to expire
	time.Sleep(70 * time.Millisecond)

	// Should be stale
	entry, freshness = cache.GetWithStale("owner", "repo", "open", "")
	require.Equal(t, CacheStale, freshness)
	require.NotNil(t, entry)

	// Wait for stale TTL to expire
	time.Sleep(100 * time.Millisecond)

	// Should be a miss
	entry, freshness = cache.GetWithStale("owner", "repo", "open", "")
	require.Equal(t, CacheMiss, freshness)
	require.Nil(t, entry)
}

// ============================================================================
// Filter Isolation
// ============================================================================

func TestIssueCache_DifferentStatesSeparateEntries(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	openIssues := []IssueListItem{{Number: 1, Title: "Open Issue"}}
	closedIssues := []IssueListItem{{Number: 2, Title: "Closed Issue"}}

	cache.SetFull("owner", "repo", "open", "", openIssues, "etag-open")
	cache.SetFull("owner", "repo", "closed", "", closedIssues, "etag-closed")

	// Verify open
	entry, freshness := cache.GetWithStale("owner", "repo", "open", "")
	require.Equal(t, CacheFresh, freshness)
	require.Len(t, entry.Issues, 1)
	require.Equal(t, "Open Issue", entry.Issues[0].Title)
	require.Equal(t, "etag-open", entry.ETag)

	// Verify closed
	entry, freshness = cache.GetWithStale("owner", "repo", "closed", "")
	require.Equal(t, CacheFresh, freshness)
	require.Len(t, entry.Issues, 1)
	require.Equal(t, "Closed Issue", entry.Issues[0].Title)
	require.Equal(t, "etag-closed", entry.ETag)
}

func TestIssueCache_DifferentLabelsSeparateEntries(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	bugIssues := []IssueListItem{{Number: 1, Title: "Bug"}}
	featureIssues := []IssueListItem{{Number: 2, Title: "Feature"}, {Number: 3, Title: "Feature 2"}}

	cache.SetFull("owner", "repo", "open", "bug", bugIssues, "")
	cache.SetFull("owner", "repo", "open", "feature", featureIssues, "")

	entry, _ := cache.GetWithStale("owner", "repo", "open", "bug")
	require.Len(t, entry.Issues, 1)
	require.Equal(t, "Bug", entry.Issues[0].Title)

	entry, _ = cache.GetWithStale("owner", "repo", "open", "feature")
	require.Len(t, entry.Issues, 2)
	require.Equal(t, "Feature", entry.Issues[0].Title)
}

func TestIssueCache_SameRepoMultipleFilterCombos(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	cache.SetFull("owner", "repo", "open", "", []IssueListItem{{Number: 1}}, "")
	cache.SetFull("owner", "repo", "closed", "", []IssueListItem{{Number: 2}}, "")
	cache.SetFull("owner", "repo", "open", "bug", []IssueListItem{{Number: 3}}, "")

	e1, _ := cache.GetWithStale("owner", "repo", "open", "")
	require.Equal(t, 1, e1.Issues[0].Number)

	e2, _ := cache.GetWithStale("owner", "repo", "closed", "")
	require.Equal(t, 2, e2.Issues[0].Number)

	e3, _ := cache.GetWithStale("owner", "repo", "open", "bug")
	require.Equal(t, 3, e3.Issues[0].Number)
}

// ============================================================================
// Cache Key
// ============================================================================

func TestIssueCacheKey(t *testing.T) {
	require.Equal(t, "owner/repo:open:", issueCacheKey("owner", "repo", "open", ""))
	require.Equal(t, "owner/repo:closed:bug", issueCacheKey("owner", "repo", "closed", "bug"))
	require.Equal(t, "my-org/my-repo:all:bug,ui", issueCacheKey("my-org", "my-repo", "all", "bug,ui"))
}

// ============================================================================
// Invalidate
// ============================================================================

func TestIssueCache_Invalidate(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	cache.SetFull("owner", "repo", "open", "", []IssueListItem{{Number: 1}}, "")
	cache.SetFull("owner", "repo", "closed", "", []IssueListItem{{Number: 2}}, "")
	cache.SetFull("owner", "repo", "open", "bug", []IssueListItem{{Number: 3}}, "")

	// All should be cached
	_, f1 := cache.GetWithStale("owner", "repo", "open", "")
	_, f2 := cache.GetWithStale("owner", "repo", "closed", "")
	_, f3 := cache.GetWithStale("owner", "repo", "open", "bug")
	require.Equal(t, CacheFresh, f1)
	require.Equal(t, CacheFresh, f2)
	require.Equal(t, CacheFresh, f3)

	// Invalidate all entries for this repo
	cache.Invalidate("owner", "repo")

	// All should be gone
	_, f1 = cache.GetWithStale("owner", "repo", "open", "")
	_, f2 = cache.GetWithStale("owner", "repo", "closed", "")
	_, f3 = cache.GetWithStale("owner", "repo", "open", "bug")
	require.Equal(t, CacheMiss, f1)
	require.Equal(t, CacheMiss, f2)
	require.Equal(t, CacheMiss, f3)
}

func TestIssueCache_Invalidate_OnlyTargetRepo(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	cache.SetFull("owner", "repo-a", "open", "", []IssueListItem{{Number: 1}}, "")
	cache.SetFull("owner", "repo-b", "open", "", []IssueListItem{{Number: 2}}, "")

	cache.Invalidate("owner", "repo-a")

	_, f1 := cache.GetWithStale("owner", "repo-a", "open", "")
	require.Equal(t, CacheMiss, f1)

	entry, f2 := cache.GetWithStale("owner", "repo-b", "open", "")
	require.Equal(t, CacheFresh, f2)
	require.Equal(t, 2, entry.Issues[0].Number)
}

func TestIssueCache_Invalidate_NonExistent(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	// Should not panic
	cache.Invalidate("nonexistent", "repo")
}

// ============================================================================
// BumpTTL
// ============================================================================

func TestIssueCache_BumpTTL(t *testing.T) {
	cache := NewIssueCache(50*time.Millisecond, 200*time.Millisecond)
	defer cache.Close()

	cache.SetFull("owner", "repo", "open", "", []IssueListItem{{Number: 1}}, "etag-1")

	// Wait until stale
	time.Sleep(70 * time.Millisecond)
	_, freshness := cache.GetWithStale("owner", "repo", "open", "")
	require.Equal(t, CacheStale, freshness)

	// Bump TTL should make it fresh again
	ok := cache.BumpTTL("owner", "repo", "open", "")
	require.True(t, ok)

	entry, freshness := cache.GetWithStale("owner", "repo", "open", "")
	require.Equal(t, CacheFresh, freshness)
	require.NotNil(t, entry)
	require.Len(t, entry.Issues, 1)
}

func TestIssueCache_BumpTTL_PreservesData(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	issues := []IssueListItem{
		{Number: 1, Title: "Test", Labels: []IssueLabel{{Name: "bug"}}},
	}
	cache.SetFull("owner", "repo", "open", "", issues, "etag-abc")

	cache.BumpTTL("owner", "repo", "open", "")

	entry, freshness := cache.GetWithStale("owner", "repo", "open", "")
	require.Equal(t, CacheFresh, freshness)
	require.Len(t, entry.Issues, 1)
	require.Equal(t, 1, entry.Issues[0].Number)
	require.Equal(t, "Test", entry.Issues[0].Title)
	require.Len(t, entry.Issues[0].Labels, 1)
	require.Equal(t, "bug", entry.Issues[0].Labels[0].Name)
	require.Equal(t, "etag-abc", entry.ETag)
}

func TestIssueCache_BumpTTL_NonExistent(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	ok := cache.BumpTTL("nonexistent", "repo", "open", "")
	require.False(t, ok)
}

// ============================================================================
// ETag
// ============================================================================

func TestIssueCache_GetETag(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	// Non-existent returns empty
	etag := cache.GetETag("owner", "repo", "open", "")
	require.Empty(t, etag)

	// Set with ETag
	cache.SetFull("owner", "repo", "open", "", []IssueListItem{{Number: 1}}, `W/"abc123"`)
	etag = cache.GetETag("owner", "repo", "open", "")
	require.Equal(t, `W/"abc123"`, etag)
}

func TestIssueCache_GetETag_EmptyETag(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	cache.SetFull("owner", "repo", "open", "", []IssueListItem{{Number: 1}}, "")
	etag := cache.GetETag("owner", "repo", "open", "")
	require.Empty(t, etag)
}

// ============================================================================
// Refresh Deduplication
// ============================================================================

func TestIssueCache_TryStartRefresh_Dedup(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	// First call should succeed
	ok := cache.TryStartRefresh("owner", "repo", "open", "")
	require.True(t, ok)

	// Second call should fail (already refreshing)
	ok = cache.TryStartRefresh("owner", "repo", "open", "")
	require.False(t, ok)

	// After ending, should succeed again
	cache.EndRefresh("owner", "repo", "open", "")
	ok = cache.TryStartRefresh("owner", "repo", "open", "")
	require.True(t, ok)
	cache.EndRefresh("owner", "repo", "open", "")
}

func TestIssueCache_TryStartRefresh_DifferentKeys(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	// Different filter combos should be able to refresh concurrently
	ok1 := cache.TryStartRefresh("owner", "repo", "open", "")
	ok2 := cache.TryStartRefresh("owner", "repo", "closed", "")
	require.True(t, ok1)
	require.True(t, ok2)

	cache.EndRefresh("owner", "repo", "open", "")
	cache.EndRefresh("owner", "repo", "closed", "")
}

// ============================================================================
// Lifecycle
// ============================================================================

func TestIssueCache_Close(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)

	// Close should not panic
	cache.Close()
}

func TestIssueCache_DoubleClose(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)

	cache.Close()
	// Double close should not panic
	cache.Close()
}

func TestIssueCache_OperationsAfterClose(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	cache.Close()

	// Operations should still work after close (just no cleanup goroutine)
	cache.SetFull("owner", "repo", "open", "", []IssueListItem{{Number: 1}}, "")
	entry, freshness := cache.GetWithStale("owner", "repo", "open", "")
	require.Equal(t, CacheFresh, freshness)
	require.Len(t, entry.Issues, 1)
}

func TestIssueCache_Done(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)

	// Done channel should be open before Close
	select {
	case <-cache.Done():
		t.Fatal("Done channel should not be closed yet")
	default:
		// Expected
	}

	cache.Close()

	// Done channel should be closed after Close
	select {
	case <-cache.Done():
		// Expected
	default:
		t.Fatal("Done channel should be closed after Close()")
	}
}

// ============================================================================
// Concurrency
// ============================================================================

func TestIssueCache_ConcurrentAccess(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	var wg sync.WaitGroup
	const numGoroutines = 100

	// Concurrent writes
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			issues := []IssueListItem{{Number: id, Title: "Issue"}}
			cache.SetFull("owner", "repo", "open", "", issues, "")
		}(i)
	}

	// Concurrent reads
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cache.GetWithStale("owner", "repo", "open", "")
		}()
	}

	// Concurrent invalidates
	for i := 0; i < numGoroutines/10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cache.Invalidate("owner", "repo")
		}()
	}

	// Concurrent BumpTTL
	for i := 0; i < numGoroutines/10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cache.BumpTTL("owner", "repo", "open", "")
		}()
	}

	// Concurrent TryStartRefresh/EndRefresh
	for i := 0; i < numGoroutines/10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if cache.TryStartRefresh("owner", "repo", "open", "") {
				cache.EndRefresh("owner", "repo", "open", "")
			}
		}()
	}

	wg.Wait()
}

// ============================================================================
// Cleanup
// ============================================================================

func TestIssueCache_CleanupRemovesExpired(t *testing.T) {
	cache := NewIssueCache(10*time.Millisecond, 20*time.Millisecond)
	defer cache.Close()

	cache.SetFull("owner", "repo", "open", "", []IssueListItem{{Number: 1}}, "")

	// Should be cached
	_, freshness := cache.GetWithStale("owner", "repo", "open", "")
	require.Equal(t, CacheFresh, freshness)

	// Wait for both TTLs to expire
	time.Sleep(50 * time.Millisecond)

	// Manually trigger cleanup
	cache.cleanup()

	// Should be removed
	_, freshness = cache.GetWithStale("owner", "repo", "open", "")
	require.Equal(t, CacheMiss, freshness)
}

// ============================================================================
// Clear
// ============================================================================

func TestIssueCache_Clear(t *testing.T) {
	cache := NewIssueCache(5*time.Minute, 10*time.Minute)
	defer cache.Close()

	cache.SetFull("owner1", "repo1", "open", "", []IssueListItem{{Number: 1}}, "")
	cache.SetFull("owner2", "repo2", "open", "", []IssueListItem{{Number: 2}}, "")

	cache.Clear()

	_, f1 := cache.GetWithStale("owner1", "repo1", "open", "")
	_, f2 := cache.GetWithStale("owner2", "repo2", "open", "")
	require.Equal(t, CacheMiss, f1)
	require.Equal(t, CacheMiss, f2)
}
