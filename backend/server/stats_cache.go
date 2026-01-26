package server

import (
	"sync"
	"time"

	"github.com/chatml/chatml-backend/models"
)

// statsEntry holds cached session stats data
type statsEntry struct {
	stats     *models.SessionStats
	expiresAt time.Time
}

// SessionStatsCache provides time-based caching for session stats
type SessionStatsCache struct {
	mu      sync.RWMutex
	entries map[string]*statsEntry
	ttl     time.Duration
	done    chan struct{}
}

// NewSessionStatsCache creates a new session stats cache with the given TTL
func NewSessionStatsCache(ttl time.Duration) *SessionStatsCache {
	cache := &SessionStatsCache{
		entries: make(map[string]*statsEntry),
		ttl:     ttl,
		done:    make(chan struct{}),
	}

	// Start cleanup goroutine
	go cache.cleanupLoop()

	return cache
}

// Get retrieves cached stats for a session
func (c *SessionStatsCache) Get(sessionID string) (*models.SessionStats, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[sessionID]
	if !ok {
		return nil, false
	}

	// Check if expired
	if time.Now().After(entry.expiresAt) {
		return nil, false
	}

	// Return the cached stats (can be nil for sessions with no changes)
	return entry.stats, true
}

// Set stores stats in the cache
func (c *SessionStatsCache) Set(sessionID string, stats *models.SessionStats) {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	c.entries[sessionID] = &statsEntry{
		stats:     stats,
		expiresAt: now.Add(c.ttl),
	}
}

// Invalidate removes a specific session from cache
func (c *SessionStatsCache) Invalidate(sessionID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	delete(c.entries, sessionID)
}

// Close stops the cleanup goroutine
func (c *SessionStatsCache) Close() {
	close(c.done)
}

// cleanupLoop periodically removes expired entries
func (c *SessionStatsCache) cleanupLoop() {
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
func (c *SessionStatsCache) cleanup() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	for key, entry := range c.entries {
		if now.After(entry.expiresAt) {
			delete(c.entries, key)
		}
	}
}

// Stats returns cache statistics (total entries, expired entries)
func (c *SessionStatsCache) Stats() (total int, expired int) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	now := time.Now()
	total = len(c.entries)
	for _, entry := range c.entries {
		if now.After(entry.expiresAt) {
			expired++
		}
	}
	return total, expired
}
