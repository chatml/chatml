package github

import (
	"sync"
	"time"
)

// PRCacheEntry holds cached PR list data
type PRCacheEntry struct {
	PRs       []PRListItem
	CachedAt  time.Time
	ExpiresAt time.Time
}

// PRCache provides time-based caching for PR lists
type PRCache struct {
	mu      sync.RWMutex
	entries map[string]*PRCacheEntry
	ttl     time.Duration
}

// NewPRCache creates a new PR cache with the given TTL
func NewPRCache(ttl time.Duration) *PRCache {
	cache := &PRCache{
		entries: make(map[string]*PRCacheEntry),
		ttl:     ttl,
	}

	// Start cleanup goroutine
	go cache.cleanupLoop()

	return cache
}

// cacheKey generates a cache key for a repo
func cacheKey(owner, repo string) string {
	return owner + "/" + repo
}

// Get retrieves cached PRs for a repo
func (c *PRCache) Get(owner, repo string) ([]PRListItem, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	key := cacheKey(owner, repo)
	entry, ok := c.entries[key]
	if !ok {
		return nil, false
	}

	// Check if expired
	if time.Now().After(entry.ExpiresAt) {
		return nil, false
	}

	// Return a copy to prevent mutation
	result := make([]PRListItem, len(entry.PRs))
	copy(result, entry.PRs)
	return result, true
}

// Set stores PRs in the cache
func (c *PRCache) Set(owner, repo string, prs []PRListItem) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := cacheKey(owner, repo)
	now := time.Now()

	// Store a copy to prevent mutation
	prsCopy := make([]PRListItem, len(prs))
	copy(prsCopy, prs)

	c.entries[key] = &PRCacheEntry{
		PRs:       prsCopy,
		CachedAt:  now,
		ExpiresAt: now.Add(c.ttl),
	}
}

// Invalidate removes a specific repo from cache
func (c *PRCache) Invalidate(owner, repo string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := cacheKey(owner, repo)
	delete(c.entries, key)
}

// Clear removes all cache entries
func (c *PRCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = make(map[string]*PRCacheEntry)
}

// cleanupLoop periodically removes expired entries
func (c *PRCache) cleanupLoop() {
	ticker := time.NewTicker(c.ttl)
	defer ticker.Stop()

	for range ticker.C {
		c.cleanup()
	}
}

// cleanup removes expired entries
func (c *PRCache) cleanup() {
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
func (c *PRCache) Stats() (total int, expired int) {
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
