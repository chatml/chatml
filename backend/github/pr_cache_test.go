package github

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestPRCache_SetAndGet(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)

	prs := []PRListItem{
		{Number: 1, Title: "First PR", Branch: "feature-1"},
		{Number: 2, Title: "Second PR", Branch: "feature-2"},
	}

	cache.Set("owner", "repo", prs)

	result, ok := cache.Get("owner", "repo")
	require.True(t, ok)
	require.Len(t, result, 2)
	require.Equal(t, 1, result[0].Number)
	require.Equal(t, "First PR", result[0].Title)
	require.Equal(t, 2, result[1].Number)
}

func TestPRCache_GetNotFound(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)

	result, ok := cache.Get("owner", "nonexistent")
	require.False(t, ok)
	require.Nil(t, result)
}

func TestPRCache_Expiration(t *testing.T) {
	cache := NewPRCache(50*time.Millisecond, 150*time.Millisecond, 100)

	prs := []PRListItem{{Number: 1, Title: "Test PR"}}
	cache.Set("owner", "repo", prs)

	// Should be available immediately (fresh)
	result, ok := cache.Get("owner", "repo")
	require.True(t, ok)
	require.Len(t, result, 1)

	// Wait for fresh TTL to expire but still within stale TTL
	time.Sleep(80 * time.Millisecond)

	// Get still works (returns fresh + stale entries)
	result, ok = cache.Get("owner", "repo")
	require.True(t, ok)
	require.Len(t, result, 1)

	// Wait for stale TTL to expire
	time.Sleep(100 * time.Millisecond)

	// Should be expired now
	result, ok = cache.Get("owner", "repo")
	require.False(t, ok)
	require.Nil(t, result)
}

func TestPRCache_Invalidate(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)

	prs := []PRListItem{{Number: 1, Title: "Test PR"}}
	cache.Set("owner", "repo", prs)

	// Should be available
	_, ok := cache.Get("owner", "repo")
	require.True(t, ok)

	// Invalidate
	cache.Invalidate("owner", "repo")

	// Should not be available
	_, ok = cache.Get("owner", "repo")
	require.False(t, ok)
}

func TestPRCache_Clear(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)

	cache.Set("owner1", "repo1", []PRListItem{{Number: 1}})
	cache.Set("owner2", "repo2", []PRListItem{{Number: 2}})

	total, _, _, _ := cache.Stats()
	require.Equal(t, 2, total)

	cache.Clear()

	total, _, _, _ = cache.Stats()
	require.Equal(t, 0, total)
}

func TestPRCache_ImmutableCopy(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)

	prs := []PRListItem{{Number: 1, Title: "Original"}}
	cache.Set("owner", "repo", prs)

	// Modify original slice
	prs[0].Title = "Modified"

	// Cache should have original value
	result, ok := cache.Get("owner", "repo")
	require.True(t, ok)
	require.Equal(t, "Original", result[0].Title)

	// Modify result
	result[0].Title = "Also Modified"

	// Cache should still have original value
	result2, ok := cache.Get("owner", "repo")
	require.True(t, ok)
	require.Equal(t, "Original", result2[0].Title)
}

func TestPRCache_ConcurrentAccess(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)

	var wg sync.WaitGroup
	const numGoroutines = 100

	// Concurrent writes
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			prs := []PRListItem{{Number: id, Title: "PR"}}
			cache.Set("owner", "repo", prs)
		}(i)
	}

	// Concurrent reads
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cache.Get("owner", "repo")
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

	wg.Wait()
}

func TestPRCache_Stats(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)

	cache.Set("owner1", "repo1", []PRListItem{{Number: 1}})
	cache.Set("owner2", "repo2", []PRListItem{{Number: 2}})

	total, fresh, stale, expired := cache.Stats()
	require.Equal(t, 2, total)
	require.Equal(t, 2, fresh)
	require.Equal(t, 0, stale)
	require.Equal(t, 0, expired)
}

func TestPRCache_StaleWhileRevalidate(t *testing.T) {
	cache := NewPRCache(50*time.Millisecond, 200*time.Millisecond, 100)

	prs := []PRListItem{{Number: 1, Title: "Test PR"}}
	details := map[int]*PRDetails{
		1: {Number: 1, Title: "Test PR", CheckStatus: CheckStatusSuccess},
	}
	cache.SetFull("owner", "repo", prs, details, "etag-123")

	// Should be fresh
	entry, freshness := cache.GetWithStale("owner", "repo")
	require.Equal(t, CacheFresh, freshness)
	require.NotNil(t, entry)
	require.Len(t, entry.PRs, 1)
	require.Len(t, entry.Details, 1)
	require.Equal(t, "etag-123", entry.ETag)

	// Wait for fresh TTL to expire
	time.Sleep(70 * time.Millisecond)

	// Should be stale
	entry, freshness = cache.GetWithStale("owner", "repo")
	require.Equal(t, CacheStale, freshness)
	require.NotNil(t, entry)

	// Wait for stale TTL to expire
	time.Sleep(150 * time.Millisecond)

	// Should be a miss
	entry, freshness = cache.GetWithStale("owner", "repo")
	require.Equal(t, CacheMiss, freshness)
	require.Nil(t, entry)
}

func TestPRCache_RefreshDeduplication(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)

	// First call should succeed
	ok := cache.TryStartRefresh("owner", "repo")
	require.True(t, ok)

	// Second call should fail (already refreshing)
	ok = cache.TryStartRefresh("owner", "repo")
	require.False(t, ok)

	// After ending, should succeed again
	cache.EndRefresh("owner", "repo")
	ok = cache.TryStartRefresh("owner", "repo")
	require.True(t, ok)
	cache.EndRefresh("owner", "repo")
}

func TestPRCache_GetDetails(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)

	details := map[int]*PRDetails{
		1: {Number: 1, Title: "PR 1", CheckStatus: CheckStatusSuccess},
		2: {Number: 2, Title: "PR 2", CheckStatus: CheckStatusFailure},
	}
	cache.SetFull("owner", "repo", []PRListItem{{Number: 1}, {Number: 2}}, details, "")

	// Should find details
	d, ok := cache.GetDetails("owner", "repo", 1)
	require.True(t, ok)
	require.Equal(t, "PR 1", d.Title)

	// Should not find non-existent PR
	_, ok = cache.GetDetails("owner", "repo", 999)
	require.False(t, ok)

	// Should not find in non-existent repo
	_, ok = cache.GetDetails("owner", "nonexistent", 1)
	require.False(t, ok)
}

func TestPRCache_SetDetails(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)

	// Set initial data
	cache.SetFull("owner", "repo", []PRListItem{{Number: 1}}, nil, "")

	// Update details
	cache.SetDetails("owner", "repo", map[int]*PRDetails{
		1: {Number: 1, Title: "Updated", CheckStatus: CheckStatusSuccess},
	})

	d, ok := cache.GetDetails("owner", "repo", 1)
	require.True(t, ok)
	require.Equal(t, "Updated", d.Title)
}

func TestPRCache_BumpTTL(t *testing.T) {
	cache := NewPRCache(50*time.Millisecond, 200*time.Millisecond, 100)
	defer cache.Close()

	prs := []PRListItem{{Number: 1, Title: "Test PR"}}
	cache.SetFull("owner", "repo", prs, nil, "etag-1")

	// Wait until entry is stale
	time.Sleep(70 * time.Millisecond)
	_, freshness := cache.GetWithStale("owner", "repo")
	require.Equal(t, CacheStale, freshness)

	// BumpTTL should make it fresh again
	ok := cache.BumpTTL("owner", "repo")
	require.True(t, ok)

	entry, freshness := cache.GetWithStale("owner", "repo")
	require.Equal(t, CacheFresh, freshness)
	require.NotNil(t, entry)
	require.Len(t, entry.PRs, 1)

	// BumpTTL on non-existent entry returns false
	ok = cache.BumpTTL("nonexistent", "repo")
	require.False(t, ok)
}

func TestPRCache_BumpTTL_PreservesData(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)
	defer cache.Close()

	details := map[int]*PRDetails{
		1: {Number: 1, Title: "PR 1", CheckStatus: CheckStatusSuccess},
	}
	cache.SetFull("owner", "repo", []PRListItem{{Number: 1}}, details, "etag-abc")

	cache.BumpTTL("owner", "repo")

	// Verify data is preserved after bump
	entry, freshness := cache.GetWithStale("owner", "repo")
	require.Equal(t, CacheFresh, freshness)
	require.Len(t, entry.PRs, 1)
	require.Equal(t, 1, entry.PRs[0].Number)
	require.Len(t, entry.Details, 1)
	require.Equal(t, "PR 1", entry.Details[1].Title)
	require.Equal(t, "etag-abc", entry.ETag)
}

func TestPRCache_Close(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)

	// Close should not panic
	cache.Close()

	// Double close should not panic
	cache.Close()

	// Operations after close should still work (cache is still usable, just no cleanup)
	cache.Set("owner", "repo", []PRListItem{{Number: 1}})
	result, ok := cache.Get("owner", "repo")
	require.True(t, ok)
	require.Len(t, result, 1)
}

func TestPRCache_GetETag(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)
	defer cache.Close()

	// No entry returns empty string
	etag := cache.GetETag("owner", "repo")
	require.Empty(t, etag)

	// Set with ETag
	cache.SetFull("owner", "repo", []PRListItem{{Number: 1}}, nil, "W/\"abc123\"")

	etag = cache.GetETag("owner", "repo")
	require.Equal(t, "W/\"abc123\"", etag)

	// Set without ETag
	cache.SetFull("owner", "repo2", []PRListItem{{Number: 2}}, nil, "")
	etag = cache.GetETag("owner", "repo2")
	require.Empty(t, etag)
}

func TestPRCache_SetFull_WithETagAndDetails(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)
	defer cache.Close()

	prs := []PRListItem{
		{Number: 1, Title: "PR 1", Branch: "feature-1"},
		{Number: 2, Title: "PR 2", Branch: "feature-2"},
	}
	details := map[int]*PRDetails{
		1: {Number: 1, Title: "PR 1", CheckStatus: CheckStatusSuccess},
		2: {Number: 2, Title: "PR 2", CheckStatus: CheckStatusPending},
	}

	cache.SetFull("owner", "repo", prs, details, "etag-full")

	entry, freshness := cache.GetWithStale("owner", "repo")
	require.Equal(t, CacheFresh, freshness)
	require.Len(t, entry.PRs, 2)
	require.Len(t, entry.Details, 2)
	require.Equal(t, "etag-full", entry.ETag)

	// Verify details are accessible
	d, ok := cache.GetDetails("owner", "repo", 1)
	require.True(t, ok)
	require.Equal(t, CheckStatusSuccess, d.CheckStatus)

	d, ok = cache.GetDetails("owner", "repo", 2)
	require.True(t, ok)
	require.Equal(t, CheckStatusPending, d.CheckStatus)
}

func TestPRCache_SetFull_ImmutableDetails(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 100)
	defer cache.Close()

	details := map[int]*PRDetails{
		1: {Number: 1, Title: "Original", CheckDetails: []CheckDetail{
			{Name: "ci", Status: "completed", Conclusion: "success"},
		}},
	}

	cache.SetFull("owner", "repo", []PRListItem{{Number: 1}}, details, "")

	// Mutate the original map and pointed-to values
	details[1].Title = "Mutated"
	details[1].CheckDetails[0].Name = "mutated-check"
	details[1].CheckDetails = append(details[1].CheckDetails, CheckDetail{Name: "extra"})
	details[99] = &PRDetails{Number: 99}

	// Cache should be fully unaffected (deep copy)
	entry, _ := cache.GetWithStale("owner", "repo")
	require.Len(t, entry.Details, 1)
	_, exists := entry.Details[99]
	require.False(t, exists)
	require.Equal(t, "Original", entry.Details[1].Title)
	require.Len(t, entry.Details[1].CheckDetails, 1)
	require.Equal(t, "ci", entry.Details[1].CheckDetails[0].Name)
}

func TestCacheKey(t *testing.T) {
	require.Equal(t, "owner/repo", cacheKey("owner", "repo"))
	require.Equal(t, "my-org/my-repo", cacheKey("my-org", "my-repo"))
}

func TestPRCache_LRU_EvictsLeastRecent(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 3)
	defer cache.Close()

	cache.Set("owner", "repo1", []PRListItem{{Number: 1}})
	cache.Set("owner", "repo2", []PRListItem{{Number: 2}})
	cache.Set("owner", "repo3", []PRListItem{{Number: 3}})

	require.Equal(t, 3, cache.Size())

	// Adding a 4th entry should evict repo1 (least recently used)
	cache.Set("owner", "repo4", []PRListItem{{Number: 4}})

	require.Equal(t, 3, cache.Size())

	_, ok := cache.Get("owner", "repo1")
	require.False(t, ok, "repo1 should have been evicted")

	_, ok = cache.Get("owner", "repo4")
	require.True(t, ok, "repo4 should exist")
}

func TestPRCache_LRU_AccessRefreshesOrder(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 3)
	defer cache.Close()

	cache.Set("owner", "repo1", []PRListItem{{Number: 1}})
	cache.Set("owner", "repo2", []PRListItem{{Number: 2}})
	cache.Set("owner", "repo3", []PRListItem{{Number: 3}})

	// Access repo1 to move it to front
	cache.Get("owner", "repo1")

	// Adding repo4 should evict repo2 (now least recently used)
	cache.Set("owner", "repo4", []PRListItem{{Number: 4}})

	_, ok := cache.Get("owner", "repo1")
	require.True(t, ok, "repo1 should still exist after access")

	_, ok = cache.Get("owner", "repo2")
	require.False(t, ok, "repo2 should have been evicted")
}

func TestPRCache_LRU_WriteRefreshesOrder(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 3)
	defer cache.Close()

	cache.Set("owner", "repo1", []PRListItem{{Number: 1}})
	cache.Set("owner", "repo2", []PRListItem{{Number: 2}})
	cache.Set("owner", "repo3", []PRListItem{{Number: 3}})

	// BumpTTL on repo1 should refresh its LRU position
	cache.BumpTTL("owner", "repo1")

	// Adding repo4 should evict repo2
	cache.Set("owner", "repo4", []PRListItem{{Number: 4}})

	_, ok := cache.Get("owner", "repo1")
	require.True(t, ok, "repo1 should still exist after BumpTTL")

	_, ok = cache.Get("owner", "repo2")
	require.False(t, ok, "repo2 should have been evicted")
}

func TestPRCache_Size(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 5)
	defer cache.Close()

	require.Equal(t, 0, cache.Size())

	cache.Set("owner", "repo1", []PRListItem{{Number: 1}})
	require.Equal(t, 1, cache.Size())

	cache.Set("owner", "repo2", []PRListItem{{Number: 2}})
	require.Equal(t, 2, cache.Size())

	cache.Invalidate("owner", "repo1")
	require.Equal(t, 1, cache.Size())
}

func TestPRCache_LRU_InvalidateRemovesFromOrder(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 3)
	defer cache.Close()

	cache.Set("owner", "repo1", []PRListItem{{Number: 1}})
	cache.Set("owner", "repo2", []PRListItem{{Number: 2}})
	cache.Set("owner", "repo3", []PRListItem{{Number: 3}})

	// Invalidate repo2
	cache.Invalidate("owner", "repo2")
	require.Equal(t, 2, cache.Size())

	// Adding two more entries should work without evicting repo1 or repo3
	cache.Set("owner", "repo4", []PRListItem{{Number: 4}})
	require.Equal(t, 3, cache.Size())

	cache.Set("owner", "repo5", []PRListItem{{Number: 5}})
	require.Equal(t, 3, cache.Size())

	// repo1 should have been evicted (oldest)
	_, ok := cache.Get("owner", "repo1")
	require.False(t, ok, "repo1 should have been evicted")

	// repo3, repo4, repo5 should exist
	_, ok = cache.Get("owner", "repo3")
	require.True(t, ok)
	_, ok = cache.Get("owner", "repo4")
	require.True(t, ok)
	_, ok = cache.Get("owner", "repo5")
	require.True(t, ok)
}

func TestPRCache_LRU_UnlimitedWhenZero(t *testing.T) {
	cache := NewPRCache(5*time.Minute, 10*time.Minute, 0)
	defer cache.Close()

	// Should accept any number of entries without eviction
	for i := 0; i < 200; i++ {
		cache.Set("owner", fmt.Sprintf("repo%d", i), []PRListItem{{Number: i}})
	}
	require.Equal(t, 200, cache.Size())
}
