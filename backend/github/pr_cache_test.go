package github

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestPRCache_SetAndGet(t *testing.T) {
	cache := NewPRCache(5 * time.Minute)

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
	cache := NewPRCache(5 * time.Minute)

	result, ok := cache.Get("owner", "nonexistent")
	require.False(t, ok)
	require.Nil(t, result)
}

func TestPRCache_Expiration(t *testing.T) {
	cache := NewPRCache(50 * time.Millisecond)

	prs := []PRListItem{{Number: 1, Title: "Test PR"}}
	cache.Set("owner", "repo", prs)

	// Should be available immediately
	result, ok := cache.Get("owner", "repo")
	require.True(t, ok)
	require.Len(t, result, 1)

	// Wait for expiration
	time.Sleep(100 * time.Millisecond)

	// Should be expired now
	result, ok = cache.Get("owner", "repo")
	require.False(t, ok)
	require.Nil(t, result)
}

func TestPRCache_Invalidate(t *testing.T) {
	cache := NewPRCache(5 * time.Minute)

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
	cache := NewPRCache(5 * time.Minute)

	cache.Set("owner1", "repo1", []PRListItem{{Number: 1}})
	cache.Set("owner2", "repo2", []PRListItem{{Number: 2}})

	total, _ := cache.Stats()
	require.Equal(t, 2, total)

	cache.Clear()

	total, _ = cache.Stats()
	require.Equal(t, 0, total)
}

func TestPRCache_ImmutableCopy(t *testing.T) {
	cache := NewPRCache(5 * time.Minute)

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
	cache := NewPRCache(5 * time.Minute)

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
	// Use a longer TTL to avoid cleanup goroutine removing entries
	cache := NewPRCache(5 * time.Minute)

	cache.Set("owner1", "repo1", []PRListItem{{Number: 1}})
	cache.Set("owner2", "repo2", []PRListItem{{Number: 2}})

	total, expired := cache.Stats()
	require.Equal(t, 2, total)
	require.Equal(t, 0, expired)
}

func TestCacheKey(t *testing.T) {
	require.Equal(t, "owner/repo", cacheKey("owner", "repo"))
	require.Equal(t, "my-org/my-repo", cacheKey("my-org", "my-repo"))
}
