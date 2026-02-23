package server

import (
	"strings"
	"sync"
	"time"
)

// diffEntry holds cached file diff data
type diffEntry struct {
	response  *FileDiffResponse
	expiresAt time.Time
}

// DiffCache provides TTL-based caching for individual file diffs.
// Follows the same pattern as SessionStatsCache.
type DiffCache struct {
	mu      sync.RWMutex
	entries map[string]*diffEntry
	ttl     time.Duration
	done    chan struct{}
}

// NewDiffCache creates a new diff cache with the given TTL
func NewDiffCache(ttl time.Duration) *DiffCache {
	cache := &DiffCache{
		entries: make(map[string]*diffEntry),
		ttl:     ttl,
		done:    make(chan struct{}),
	}

	// Start cleanup goroutine
	go cache.cleanupLoop()

	return cache
}

func diffCacheKey(sessionID, path string) string {
	return sessionID + ":" + path
}

// Get retrieves a cached diff for a session file.
// Returns a defensive copy so callers cannot mutate cached data.
func (c *DiffCache) Get(sessionID, path string) (*FileDiffResponse, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[diffCacheKey(sessionID, path)]
	if !ok {
		return nil, false
	}

	// Check if expired
	if time.Now().After(entry.expiresAt) {
		return nil, false
	}

	copied := *entry.response
	return &copied, true
}

// Set stores a defensive copy of the diff in the cache.
func (c *DiffCache) Set(sessionID, path string, resp *FileDiffResponse) {
	c.mu.Lock()
	defer c.mu.Unlock()

	copied := *resp
	c.entries[diffCacheKey(sessionID, path)] = &diffEntry{
		response:  &copied,
		expiresAt: time.Now().Add(c.ttl),
	}
}

// InvalidateSession removes all cached diffs for a session
func (c *DiffCache) InvalidateSession(sessionID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	prefix := sessionID + ":"
	for key := range c.entries {
		if strings.HasPrefix(key, prefix) {
			delete(c.entries, key)
		}
	}
}

// Close stops the cleanup goroutine
func (c *DiffCache) Close() {
	close(c.done)
}

// cleanupLoop periodically removes expired entries
func (c *DiffCache) cleanupLoop() {
	// Use a minimum cleanup interval of 30 seconds to avoid excessive CPU usage
	cleanupInterval := c.ttl
	if cleanupInterval < 30*time.Second {
		cleanupInterval = 30 * time.Second
	}
	ticker := time.NewTicker(cleanupInterval)
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

// cleanup removes expired entries
func (c *DiffCache) cleanup() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	for key, entry := range c.entries {
		if now.After(entry.expiresAt) {
			delete(c.entries, key)
		}
	}
}
