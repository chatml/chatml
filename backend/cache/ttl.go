// Package cache provides TTL-based in-memory caches used across the backend.
package cache

import (
	"strings"
	"sync"
	"time"
)

// entry holds a cached value with an expiration time.
type entry[T any] struct {
	value     T
	expiresAt time.Time
}

// TTLCache is a generic, thread-safe TTL cache keyed by string.
// Use New to create one and Close to stop the background cleanup goroutine.
type TTLCache[T any] struct {
	mu      sync.RWMutex
	entries map[string]*entry[T]
	ttl     time.Duration
	done    chan struct{}
}

// New creates a TTLCache with the given TTL and starts a background cleanup goroutine.
func New[T any](ttl time.Duration) *TTLCache[T] {
	c := &TTLCache[T]{
		entries: make(map[string]*entry[T]),
		ttl:     ttl,
		done:    make(chan struct{}),
	}
	go c.cleanupLoop()
	return c
}

// Get retrieves a cached value. Returns zero value and false if missing or expired.
func (c *TTLCache[T]) Get(key string) (T, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	e, ok := c.entries[key]
	if !ok || time.Now().After(e.expiresAt) {
		var zero T
		return zero, false
	}
	return e.value, true
}

// Set stores a value in the cache.
func (c *TTLCache[T]) Set(key string, value T) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries[key] = &entry[T]{
		value:     value,
		expiresAt: time.Now().Add(c.ttl),
	}
}

// Invalidate removes a single key from the cache.
func (c *TTLCache[T]) Invalidate(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	delete(c.entries, key)
}

// InvalidateByPrefix removes all entries whose key starts with the given prefix.
func (c *TTLCache[T]) InvalidateByPrefix(prefix string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	for key := range c.entries {
		if strings.HasPrefix(key, prefix) {
			delete(c.entries, key)
		}
	}
}

// Close stops the background cleanup goroutine. Safe to call multiple times.
func (c *TTLCache[T]) Close() {
	select {
	case <-c.done:
		// already closed
	default:
		close(c.done)
	}
}

// Stats returns the total and expired entry counts (diagnostic only).
func (c *TTLCache[T]) Stats() (total int, expired int) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	now := time.Now()
	total = len(c.entries)
	for _, e := range c.entries {
		if now.After(e.expiresAt) {
			expired++
		}
	}
	return total, expired
}

func (c *TTLCache[T]) cleanupLoop() {
	interval := c.ttl
	if interval < 30*time.Second {
		interval = 30 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.cleanup()
		case <-c.done:
			return
		}
	}
}

func (c *TTLCache[T]) cleanup() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	for key, e := range c.entries {
		if now.After(e.expiresAt) {
			delete(c.entries, key)
		}
	}
}
