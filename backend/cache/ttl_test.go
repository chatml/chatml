package cache

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTTLCache_SetAndGet(t *testing.T) {
	c := New[string](5 * time.Minute)
	t.Cleanup(func() { c.Close() })

	c.Set("key1", "value1")

	val, ok := c.Get("key1")
	require.True(t, ok)
	assert.Equal(t, "value1", val)
}

func TestTTLCache_GetMissing(t *testing.T) {
	c := New[int](5 * time.Minute)
	t.Cleanup(func() { c.Close() })

	val, ok := c.Get("missing")
	assert.False(t, ok)
	assert.Equal(t, 0, val)
}

func TestTTLCache_Expiration(t *testing.T) {
	c := New[string](50 * time.Millisecond)
	t.Cleanup(func() { c.Close() })

	c.Set("key", "value")

	val, ok := c.Get("key")
	require.True(t, ok)
	assert.Equal(t, "value", val)

	time.Sleep(100 * time.Millisecond)

	_, ok = c.Get("key")
	assert.False(t, ok)
}

func TestTTLCache_Invalidate(t *testing.T) {
	c := New[string](5 * time.Minute)
	t.Cleanup(func() { c.Close() })

	c.Set("key", "value")
	c.Invalidate("key")

	_, ok := c.Get("key")
	assert.False(t, ok)
}

func TestTTLCache_InvalidateByPrefix(t *testing.T) {
	c := New[string](5 * time.Minute)
	t.Cleanup(func() { c.Close() })

	c.Set("sess-1:file-a", "a")
	c.Set("sess-1:file-b", "b")
	c.Set("sess-2:file-c", "c")

	c.InvalidateByPrefix("sess-1:")

	_, ok := c.Get("sess-1:file-a")
	assert.False(t, ok)
	_, ok = c.Get("sess-1:file-b")
	assert.False(t, ok)

	val, ok := c.Get("sess-2:file-c")
	assert.True(t, ok)
	assert.Equal(t, "c", val)
}

func TestTTLCache_Stats(t *testing.T) {
	c := New[string](50 * time.Millisecond)
	t.Cleanup(func() { c.Close() })

	c.Set("a", "1")
	c.Set("b", "2")

	total, expired := c.Stats()
	assert.Equal(t, 2, total)
	assert.Equal(t, 0, expired)

	time.Sleep(100 * time.Millisecond)

	total, expired = c.Stats()
	assert.Equal(t, 2, total)
	assert.Equal(t, 2, expired)
}

func TestTTLCache_ConcurrentAccess(t *testing.T) {
	c := New[int](5 * time.Minute)
	t.Cleanup(func() { c.Close() })

	const numGoroutines = 50
	var wg sync.WaitGroup

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			key := "key"
			c.Set(key, n)
			c.Get(key)
			c.Invalidate(key)
		}(i)
	}
	wg.Wait()
}

func TestTTLCache_CloseMultipleTimes(t *testing.T) {
	c := New[string](5 * time.Minute)
	c.Close()
	c.Close() // should not panic
}

func TestTTLCache_NilPointerValue(t *testing.T) {
	type data struct{ Name string }
	c := New[*data](5 * time.Minute)
	t.Cleanup(func() { c.Close() })

	// Store nil — valid for "session has no stats" semantics
	c.Set("key", nil)

	val, ok := c.Get("key")
	assert.True(t, ok)
	assert.Nil(t, val)
}
