package agents

import (
	"sync"
	"time"
)

// CacheEntry holds cached response data with ETag
type CacheEntry struct {
	ETag       string
	Data       interface{}
	CachedAt   time.Time
	ExpiresAt  time.Time
}

// PollingCache provides ETag-based caching for API responses
type PollingCache struct {
	mu      sync.RWMutex
	entries map[string]*CacheEntry
	ttl     time.Duration
}

// NewPollingCache creates a new polling cache with the given TTL
func NewPollingCache(ttl time.Duration) *PollingCache {
	cache := &PollingCache{
		entries: make(map[string]*CacheEntry),
		ttl:     ttl,
	}

	// Start cleanup goroutine
	go cache.cleanupLoop()

	return cache
}

// Get retrieves a cached entry by key
func (c *PollingCache) Get(key string) (*CacheEntry, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[key]
	if !ok {
		return nil, false
	}

	// Check if expired
	if time.Now().After(entry.ExpiresAt) {
		return nil, false
	}

	return entry, true
}

// GetETag returns the cached ETag for a key, or empty string if not cached
func (c *PollingCache) GetETag(key string) string {
	entry, ok := c.Get(key)
	if !ok {
		return ""
	}
	return entry.ETag
}

// Set stores a cache entry
func (c *PollingCache) Set(key string, etag string, data interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	c.entries[key] = &CacheEntry{
		ETag:      etag,
		Data:      data,
		CachedAt:  now,
		ExpiresAt: now.Add(c.ttl),
	}
}

// SetWithTTL stores a cache entry with a custom TTL
func (c *PollingCache) SetWithTTL(key string, etag string, data interface{}, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	c.entries[key] = &CacheEntry{
		ETag:      etag,
		Data:      data,
		CachedAt:  now,
		ExpiresAt: now.Add(ttl),
	}
}

// Delete removes a cache entry
func (c *PollingCache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, key)
}

// Clear removes all cache entries
func (c *PollingCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = make(map[string]*CacheEntry)
}

// cleanupLoop periodically removes expired entries
func (c *PollingCache) cleanupLoop() {
	ticker := time.NewTicker(c.ttl)
	defer ticker.Stop()

	for range ticker.C {
		c.cleanup()
	}
}

// cleanup removes expired entries
func (c *PollingCache) cleanup() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	for key, entry := range c.entries {
		if now.After(entry.ExpiresAt) {
			delete(c.entries, key)
		}
	}
}

// Stats returns cache statistics
func (c *PollingCache) Stats() (total int, expired int) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	now := time.Now()
	total = len(c.entries)
	for _, entry := range c.entries {
		if now.After(entry.ExpiresAt) {
			expired++
		}
	}
	return total, expired
}
