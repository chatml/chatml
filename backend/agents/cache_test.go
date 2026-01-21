package agents

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewPollingCache(t *testing.T) {
	cache := NewPollingCache(time.Minute)

	assert.NotNil(t, cache)
	assert.NotNil(t, cache.entries)
	assert.Equal(t, time.Minute, cache.ttl)
}

func TestPollingCache_SetAndGet(t *testing.T) {
	cache := NewPollingCache(time.Minute)

	cache.Set("key1", "etag-123", "test data")

	entry, ok := cache.Get("key1")
	require.True(t, ok)
	assert.NotNil(t, entry)
	assert.Equal(t, "etag-123", entry.ETag)
	assert.Equal(t, "test data", entry.Data)
	assert.False(t, entry.CachedAt.IsZero())
	assert.False(t, entry.ExpiresAt.IsZero())
}

func TestPollingCache_Get_NotFound(t *testing.T) {
	cache := NewPollingCache(time.Minute)

	entry, ok := cache.Get("non-existent")
	assert.False(t, ok)
	assert.Nil(t, entry)
}

func TestPollingCache_Get_Expired(t *testing.T) {
	// Use very short TTL
	cache := NewPollingCache(10 * time.Millisecond)

	cache.Set("key1", "etag-123", "test data")

	// Wait for expiration
	time.Sleep(20 * time.Millisecond)

	entry, ok := cache.Get("key1")
	assert.False(t, ok)
	assert.Nil(t, entry)
}

func TestPollingCache_GetETag(t *testing.T) {
	cache := NewPollingCache(time.Minute)

	cache.Set("key1", "etag-123", "test data")

	etag := cache.GetETag("key1")
	assert.Equal(t, "etag-123", etag)
}

func TestPollingCache_GetETag_NotFound(t *testing.T) {
	cache := NewPollingCache(time.Minute)

	etag := cache.GetETag("non-existent")
	assert.Empty(t, etag)
}

func TestPollingCache_GetETag_Expired(t *testing.T) {
	cache := NewPollingCache(10 * time.Millisecond)

	cache.Set("key1", "etag-123", "test data")

	time.Sleep(20 * time.Millisecond)

	etag := cache.GetETag("key1")
	assert.Empty(t, etag)
}

func TestPollingCache_SetWithTTL(t *testing.T) {
	cache := NewPollingCache(time.Hour) // Default long TTL

	// Set with custom short TTL
	cache.SetWithTTL("key1", "etag-123", "test data", 20*time.Millisecond)

	// Should be available immediately
	entry, ok := cache.Get("key1")
	require.True(t, ok)
	assert.Equal(t, "test data", entry.Data)

	// Wait for custom TTL to expire
	time.Sleep(30 * time.Millisecond)

	// Should be expired now
	entry, ok = cache.Get("key1")
	assert.False(t, ok)
	assert.Nil(t, entry)
}

func TestPollingCache_Delete(t *testing.T) {
	cache := NewPollingCache(time.Minute)

	cache.Set("key1", "etag-123", "test data")
	cache.Set("key2", "etag-456", "more data")

	// Delete one key
	cache.Delete("key1")

	_, ok := cache.Get("key1")
	assert.False(t, ok)

	// Other key should still exist
	entry, ok := cache.Get("key2")
	assert.True(t, ok)
	assert.Equal(t, "more data", entry.Data)
}

func TestPollingCache_Delete_NotFound(t *testing.T) {
	cache := NewPollingCache(time.Minute)

	// Should not panic when deleting non-existent key
	cache.Delete("non-existent")
}

func TestPollingCache_Clear(t *testing.T) {
	cache := NewPollingCache(time.Minute)

	cache.Set("key1", "etag-1", "data1")
	cache.Set("key2", "etag-2", "data2")
	cache.Set("key3", "etag-3", "data3")

	cache.Clear()

	_, ok := cache.Get("key1")
	assert.False(t, ok)

	_, ok = cache.Get("key2")
	assert.False(t, ok)

	_, ok = cache.Get("key3")
	assert.False(t, ok)
}

func TestPollingCache_Stats(t *testing.T) {
	// Use a longer TTL to avoid cleanup loop interference
	cache := NewPollingCache(time.Second)

	cache.Set("key1", "etag-1", "data1")
	cache.Set("key2", "etag-2", "data2")

	total, expired := cache.Stats()
	assert.Equal(t, 2, total)
	assert.Equal(t, 0, expired)

	// Now use SetWithTTL with a short TTL to test expiration tracking
	cache.Clear()
	cache.SetWithTTL("key3", "etag-3", "data3", 10*time.Millisecond)
	cache.SetWithTTL("key4", "etag-4", "data4", 10*time.Millisecond)

	// Wait for expiration (but cleanup won't run for 1 second)
	time.Sleep(20 * time.Millisecond)

	total, expired = cache.Stats()
	assert.Equal(t, 2, total)
	assert.Equal(t, 2, expired)
}

func TestPollingCache_Cleanup(t *testing.T) {
	cache := NewPollingCache(10 * time.Millisecond)

	cache.Set("key1", "etag-1", "data1")
	cache.Set("key2", "etag-2", "data2")

	// Wait for expiration
	time.Sleep(20 * time.Millisecond)

	// Manually trigger cleanup
	cache.cleanup()

	total, _ := cache.Stats()
	assert.Equal(t, 0, total)
}

func TestPollingCache_ConcurrentAccess(t *testing.T) {
	cache := NewPollingCache(time.Minute)

	var wg sync.WaitGroup

	// Concurrent writes
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := string(rune('a' + i%26))
			cache.Set(key, "etag", i)
		}(i)
	}

	// Concurrent reads
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := string(rune('a' + i%26))
			cache.Get(key)
			cache.GetETag(key)
		}(i)
	}

	// Concurrent deletes
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := string(rune('a' + i%26))
			cache.Delete(key)
		}(i)
	}

	wg.Wait()

	// Should not panic
}

func TestPollingCache_OverwriteExisting(t *testing.T) {
	cache := NewPollingCache(time.Minute)

	cache.Set("key1", "etag-old", "old data")

	entry, _ := cache.Get("key1")
	assert.Equal(t, "old data", entry.Data)

	cache.Set("key1", "etag-new", "new data")

	entry, _ = cache.Get("key1")
	assert.Equal(t, "etag-new", entry.ETag)
	assert.Equal(t, "new data", entry.Data)
}

func TestPollingCache_ComplexData(t *testing.T) {
	cache := NewPollingCache(time.Minute)

	// Store complex data structures
	data := map[string]interface{}{
		"items": []string{"a", "b", "c"},
		"count": 42,
		"nested": map[string]int{
			"x": 1,
			"y": 2,
		},
	}

	cache.Set("complex", "etag-complex", data)

	entry, ok := cache.Get("complex")
	require.True(t, ok)

	retrieved, ok := entry.Data.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, 42, retrieved["count"])
}

func TestCacheEntry_Fields(t *testing.T) {
	entry := &CacheEntry{
		ETag:      "test-etag",
		Data:      "test-data",
		CachedAt:  time.Now(),
		ExpiresAt: time.Now().Add(time.Hour),
	}

	assert.Equal(t, "test-etag", entry.ETag)
	assert.Equal(t, "test-data", entry.Data)
	assert.False(t, entry.CachedAt.IsZero())
	assert.False(t, entry.ExpiresAt.IsZero())
	assert.True(t, entry.ExpiresAt.After(entry.CachedAt))
}
