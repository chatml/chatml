package server

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDiffCache_GetSet(t *testing.T) {
	cache := NewDiffCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	resp := &FileDiffResponse{
		Path:       "main.go",
		OldContent: "old",
		NewContent: "new",
	}
	cache.Set("session-1", "main.go", resp)

	got, ok := cache.Get("session-1", "main.go")
	require.True(t, ok, "expected cache hit")
	assert.Equal(t, "old", got.OldContent)
	assert.Equal(t, "new", got.NewContent)
	assert.Equal(t, "main.go", got.Path)
}

func TestDiffCache_GetMiss(t *testing.T) {
	cache := NewDiffCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	got, ok := cache.Get("nonexistent", "file.go")
	assert.False(t, ok, "expected cache miss for nonexistent key")
	assert.Nil(t, got, "expected nil on cache miss")
}

func TestDiffCache_Expiration(t *testing.T) {
	cache := NewDiffCache(50 * time.Millisecond)
	t.Cleanup(func() { cache.Close() })

	resp := &FileDiffResponse{Path: "test.go", OldContent: "a", NewContent: "b"}
	cache.Set("session-exp", "test.go", resp)

	// Should be available immediately
	got, ok := cache.Get("session-exp", "test.go")
	require.True(t, ok, "expected cache hit before expiration")
	assert.Equal(t, "a", got.OldContent)

	// Wait for expiration
	time.Sleep(100 * time.Millisecond)

	got, ok = cache.Get("session-exp", "test.go")
	assert.False(t, ok, "expected cache miss after TTL expiry")
	assert.Nil(t, got, "expected nil after TTL expiry")
}

func TestDiffCache_InvalidateSession(t *testing.T) {
	cache := NewDiffCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	// Add multiple files for the same session
	cache.Set("session-inv", "file1.go", &FileDiffResponse{Path: "file1.go"})
	cache.Set("session-inv", "file2.go", &FileDiffResponse{Path: "file2.go"})
	cache.Set("other-session", "file1.go", &FileDiffResponse{Path: "file1.go"})

	// Verify all entries exist
	_, ok := cache.Get("session-inv", "file1.go")
	require.True(t, ok)
	_, ok = cache.Get("session-inv", "file2.go")
	require.True(t, ok)
	_, ok = cache.Get("other-session", "file1.go")
	require.True(t, ok)

	// Invalidate one session
	cache.InvalidateSession("session-inv")

	// Session entries should be gone
	_, ok = cache.Get("session-inv", "file1.go")
	assert.False(t, ok, "expected cache miss after session invalidation")
	_, ok = cache.Get("session-inv", "file2.go")
	assert.False(t, ok, "expected cache miss after session invalidation")

	// Other session should be unaffected
	got, ok := cache.Get("other-session", "file1.go")
	assert.True(t, ok, "other session should not be invalidated")
	assert.Equal(t, "file1.go", got.Path)
}

func TestDiffCache_ConcurrentAccess(t *testing.T) {
	cache := NewDiffCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	const numGoroutines = 50
	var wg sync.WaitGroup

	// Concurrent writers
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			session := fmt.Sprintf("session-%d", n%10)
			path := fmt.Sprintf("file-%d.go", n%5)
			cache.Set(session, path, &FileDiffResponse{Path: path, OldContent: fmt.Sprintf("old-%d", n)})
		}(i)
	}

	// Concurrent readers
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			session := fmt.Sprintf("session-%d", n%10)
			path := fmt.Sprintf("file-%d.go", n%5)
			cache.Get(session, path)
		}(i)
	}

	// Concurrent invalidators
	for i := 0; i < numGoroutines/5; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			session := fmt.Sprintf("session-%d", n%10)
			cache.InvalidateSession(session)
		}(i)
	}

	wg.Wait()
	// No panics, races, or deadlocks
}

func TestDiffCache_Close(t *testing.T) {
	cache := NewDiffCache(5 * time.Minute)

	// Close should not panic
	assert.NotPanics(t, func() {
		cache.Close()
	})

	// Cache should still be usable after close (just no auto-cleanup)
	cache.Set("after-close", "file.go", &FileDiffResponse{Path: "file.go", NewContent: "content"})
	got, ok := cache.Get("after-close", "file.go")
	assert.True(t, ok, "expected cache to remain usable after Close")
	require.NotNil(t, got)
	assert.Equal(t, "content", got.NewContent)
}
