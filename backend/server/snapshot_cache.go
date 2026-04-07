package server

import (
	"sync"
	"time"

	"github.com/chatml/chatml-core/git"
)

// SessionSnapshot holds the consolidated git data for a session.
// This is the cached response for the /snapshot endpoint.
type SessionSnapshot struct {
	GitStatus     *git.GitStatus     `json:"gitStatus"`
	Changes       []git.FileChange   `json:"changes"`
	AllChanges    []git.FileChange   `json:"allChanges"`
	BranchCommits []git.BranchCommit `json:"commits"`
	BranchStats   *BranchStats       `json:"branchStats,omitempty"`
}

type snapshotEntry struct {
	snapshot  *SessionSnapshot
	expiresAt time.Time
}

// SnapshotCache provides short-TTL caching for consolidated session snapshots.
// Keyed by sessionID. Invalidated by branch watcher on file/index changes.
type SnapshotCache struct {
	mu      sync.RWMutex
	entries map[string]*snapshotEntry
	ttl     time.Duration
	done    chan struct{}
}

// NewSnapshotCache creates a new snapshot cache with the given TTL.
func NewSnapshotCache(ttl time.Duration) *SnapshotCache {
	cache := &SnapshotCache{
		entries: make(map[string]*snapshotEntry),
		ttl:     ttl,
		done:    make(chan struct{}),
	}
	go cache.cleanupLoop()
	return cache
}

// Get retrieves a cached snapshot for a session.
func (c *SnapshotCache) Get(sessionID string) (*SessionSnapshot, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[sessionID]
	if !ok {
		return nil, false
	}
	if time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return entry.snapshot, true
}

// Set stores a snapshot in the cache.
func (c *SnapshotCache) Set(sessionID string, snap *SessionSnapshot) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries[sessionID] = &snapshotEntry{
		snapshot:  snap,
		expiresAt: time.Now().Add(c.ttl),
	}
}

// Invalidate removes the cached snapshot for a session.
func (c *SnapshotCache) Invalidate(sessionID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, sessionID)
}

// Close stops the cleanup goroutine. Safe to call multiple times.
func (c *SnapshotCache) Close() {
	select {
	case <-c.done:
		// already closed
	default:
		close(c.done)
	}
}

func (c *SnapshotCache) cleanupLoop() {
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

func (c *SnapshotCache) cleanup() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	for key, entry := range c.entries {
		if now.After(entry.expiresAt) {
			delete(c.entries, key)
		}
	}
}
