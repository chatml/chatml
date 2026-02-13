package server

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// SessionStatsCache tests
// ---------------------------------------------------------------------------

func TestSessionStatsCache_GetSet(t *testing.T) {
	cache := NewSessionStatsCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	stats := &models.SessionStats{Additions: 10, Deletions: 3}
	cache.Set("session-1", stats)

	got, ok := cache.Get("session-1")
	require.True(t, ok, "expected cache hit")
	assert.Equal(t, 10, got.Additions)
	assert.Equal(t, 3, got.Deletions)
}

func TestSessionStatsCache_GetMiss(t *testing.T) {
	cache := NewSessionStatsCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	got, ok := cache.Get("nonexistent")
	assert.False(t, ok, "expected cache miss for nonexistent key")
	assert.Nil(t, got, "expected nil stats on cache miss")
}

func TestSessionStatsCache_Expiration(t *testing.T) {
	cache := NewSessionStatsCache(50 * time.Millisecond)
	t.Cleanup(func() { cache.Close() })

	stats := &models.SessionStats{Additions: 5, Deletions: 2}
	cache.Set("session-exp", stats)

	// Should be available immediately
	got, ok := cache.Get("session-exp")
	require.True(t, ok, "expected cache hit before expiration")
	assert.Equal(t, 5, got.Additions)

	// Wait for expiration
	time.Sleep(100 * time.Millisecond)

	got, ok = cache.Get("session-exp")
	assert.False(t, ok, "expected cache miss after TTL expiry")
	assert.Nil(t, got, "expected nil stats after TTL expiry")
}

func TestSessionStatsCache_Invalidate(t *testing.T) {
	cache := NewSessionStatsCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	stats := &models.SessionStats{Additions: 7, Deletions: 1}
	cache.Set("session-inv", stats)

	// Verify it's there
	_, ok := cache.Get("session-inv")
	require.True(t, ok, "expected cache hit before invalidation")

	cache.Invalidate("session-inv")

	got, ok := cache.Get("session-inv")
	assert.False(t, ok, "expected cache miss after invalidation")
	assert.Nil(t, got, "expected nil stats after invalidation")
}

func TestSessionStatsCache_SetNilStats(t *testing.T) {
	cache := NewSessionStatsCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	// Setting nil stats is valid (for sessions with no changes)
	cache.Set("session-nil", nil)

	got, ok := cache.Get("session-nil")
	assert.True(t, ok, "expected cache hit for nil stats entry")
	assert.Nil(t, got, "expected nil stats returned for nil entry")
}

func TestSessionStatsCache_Stats(t *testing.T) {
	cache := NewSessionStatsCache(50 * time.Millisecond)
	t.Cleanup(func() { cache.Close() })

	// Empty cache
	total, expired := cache.Stats()
	assert.Equal(t, 0, total, "expected 0 total entries on empty cache")
	assert.Equal(t, 0, expired, "expected 0 expired entries on empty cache")

	// Add some entries
	cache.Set("a", &models.SessionStats{Additions: 1})
	cache.Set("b", &models.SessionStats{Additions: 2})
	cache.Set("c", &models.SessionStats{Additions: 3})

	total, expired = cache.Stats()
	assert.Equal(t, 3, total, "expected 3 total entries")
	assert.Equal(t, 0, expired, "expected 0 expired entries immediately after set")

	// Wait for all entries to expire
	time.Sleep(100 * time.Millisecond)

	total, expired = cache.Stats()
	assert.Equal(t, 3, total, "expected 3 total entries (expired but not cleaned up)")
	assert.Equal(t, 3, expired, "expected 3 expired entries after TTL")
}

func TestSessionStatsCache_Close(t *testing.T) {
	cache := NewSessionStatsCache(5 * time.Minute)

	// Close should not panic
	assert.NotPanics(t, func() {
		cache.Close()
	})

	// Cache should still be usable after close (just no auto-cleanup)
	cache.Set("after-close", &models.SessionStats{Additions: 42})
	got, ok := cache.Get("after-close")
	assert.True(t, ok, "expected cache to remain usable after Close")
	require.NotNil(t, got)
	assert.Equal(t, 42, got.Additions)
}

func TestSessionStatsCache_ConcurrentAccess(t *testing.T) {
	cache := NewSessionStatsCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	const numGoroutines = 50
	var wg sync.WaitGroup

	// Concurrent writers
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			key := fmt.Sprintf("session-%d", n%10)
			cache.Set(key, &models.SessionStats{Additions: n, Deletions: n * 2})
		}(i)
	}

	// Concurrent readers
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			key := fmt.Sprintf("session-%d", n%10)
			cache.Get(key)
		}(i)
	}

	// Concurrent invalidators
	for i := 0; i < numGoroutines/5; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			key := fmt.Sprintf("session-%d", n%10)
			cache.Invalidate(key)
		}(i)
	}

	// Concurrent stats callers
	for i := 0; i < numGoroutines/5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cache.Stats()
		}()
	}

	wg.Wait()
	// No panics, races, or deadlocks
}

// ---------------------------------------------------------------------------
// SessionLockManager tests
// ---------------------------------------------------------------------------

func TestSessionLockManager_LockUnlock(t *testing.T) {
	m := NewSessionLockManager()

	// Basic lock/unlock cycle should complete without deadlock
	m.Lock("path/a")
	m.Unlock("path/a")
}

func TestSessionLockManager_MutualExclusion(t *testing.T) {
	m := NewSessionLockManager()

	var mu sync.Mutex
	held := false
	violated := false
	var wg sync.WaitGroup

	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m.Lock("shared")
			defer m.Unlock("shared")

			mu.Lock()
			if held {
				violated = true
			}
			held = true
			mu.Unlock()

			// Simulate work
			time.Sleep(10 * time.Millisecond)

			mu.Lock()
			held = false
			mu.Unlock()
		}()
	}

	wg.Wait()
	assert.False(t, violated, "two goroutines held the same lock simultaneously")
}

func TestSessionLockManager_DifferentPathsIndependent(t *testing.T) {
	m := NewSessionLockManager()

	// Lock path "a", then in a goroutine lock path "b".
	// If paths are independent, "b" won't block.
	m.Lock("a")

	done := make(chan struct{})
	go func() {
		m.Lock("b")
		m.Unlock("b")
		close(done)
	}()

	select {
	case <-done:
		// OK -- "b" was not blocked by "a"
	case <-time.After(2 * time.Second):
		t.Fatal("locking path 'b' was blocked by 'a'; different paths should be independent")
	}

	m.Unlock("a")
}

func TestSessionLockManager_CleanupAfterUnlock(t *testing.T) {
	m := NewSessionLockManager()

	m.Lock("clean")
	m.Unlock("clean")

	// After unlock with refCount reaching 0, the entry should be removed
	m.mu.Lock()
	_, exists := m.locks["clean"]
	m.mu.Unlock()

	assert.False(t, exists, "lock entry should be removed after last unlock (refCount 0)")
}

func TestSessionLockManager_ConcurrentSamePath(t *testing.T) {
	m := NewSessionLockManager()

	var counter int64
	const numGoroutines = 10
	const increments = 100
	var wg sync.WaitGroup

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < increments; j++ {
				m.Lock("counter-path")
				// Non-atomic increment -- safe only if mutex provides mutual exclusion
				c := atomic.LoadInt64(&counter)
				atomic.StoreInt64(&counter, c+1)
				m.Unlock("counter-path")
			}
		}()
	}

	wg.Wait()
	assert.Equal(t, int64(numGoroutines*increments), atomic.LoadInt64(&counter),
		"counter should equal total increments if mutual exclusion holds")
}

// ---------------------------------------------------------------------------
// truncateLogLines tests
// ---------------------------------------------------------------------------

func TestTruncateLogLines_UnderLimit(t *testing.T) {
	logs := "line1\nline2\nline3"
	result, totalLines, truncated := truncateLogLines(logs, 10)

	assert.Equal(t, logs, result, "logs under limit should be returned unchanged")
	assert.Equal(t, 3, totalLines, "totalLines should reflect actual line count")
	assert.False(t, truncated, "should not be truncated when under limit")
}

func TestTruncateLogLines_OverLimit(t *testing.T) {
	logs := "line1\nline2\nline3\nline4\nline5"
	result, totalLines, truncated := truncateLogLines(logs, 3)

	assert.Equal(t, "line3\nline4\nline5", result, "should return last N lines")
	assert.Equal(t, 5, totalLines, "totalLines should reflect original count")
	assert.True(t, truncated, "should be marked as truncated")
}

func TestTruncateLogLines_ExactLimit(t *testing.T) {
	logs := "line1\nline2\nline3"
	result, totalLines, truncated := truncateLogLines(logs, 3)

	assert.Equal(t, logs, result, "logs at exact limit should be returned unchanged")
	assert.Equal(t, 3, totalLines, "totalLines should equal maxLines")
	assert.False(t, truncated, "should not be truncated when exactly at limit")
}

func TestTruncateLogLines_EmptyString(t *testing.T) {
	result, totalLines, truncated := truncateLogLines("", 10)

	assert.Equal(t, "", result, "empty string should return empty")
	// strings.Split("", "\n") returns [""], so totalLines is 1
	assert.Equal(t, 1, totalLines, "empty string splits into one element")
	assert.False(t, truncated, "empty string should not be truncated")
}
