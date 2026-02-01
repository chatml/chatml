package github

import (
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/logger"
)

// IssueCacheEntry holds cached issue list data
type IssueCacheEntry struct {
	Issues     []IssueListItem
	ETag       string
	CachedAt   time.Time
	ExpiresAt  time.Time // "fresh" deadline
	StaleUntil time.Time // "stale" deadline (serve stale while revalidating)
}

// IssueCache provides time-based caching for issue lists with stale-while-revalidate
type IssueCache struct {
	mu       sync.RWMutex
	entries  map[string]*IssueCacheEntry
	freshTTL time.Duration
	staleTTL time.Duration

	// Background refresh deduplication
	refreshMu  sync.Mutex
	refreshing map[string]bool

	// Shutdown signal for cleanup goroutine
	done chan struct{}
}

// NewIssueCache creates a new issue cache with the given fresh and stale TTLs.
// Fresh TTL: serve directly from cache. Stale TTL: serve stale + trigger background refresh.
func NewIssueCache(freshTTL, staleTTL time.Duration) *IssueCache {
	cache := &IssueCache{
		entries:    make(map[string]*IssueCacheEntry),
		freshTTL:   freshTTL,
		staleTTL:   staleTTL,
		refreshing: make(map[string]bool),
		done:       make(chan struct{}),
	}

	// Start cleanup goroutine
	go cache.cleanupLoop()

	return cache
}

// issueCacheKey generates a cache key for a repo with filters
func issueCacheKey(owner, repo, state, labels string) string {
	return owner + "/" + repo + ":" + state + ":" + labels
}

// GetWithStale retrieves cached issues with freshness status.
// Returns the entry, its freshness, and whether data was found.
func (c *IssueCache) GetWithStale(owner, repo, state, labels string) (*IssueCacheEntry, CacheFreshness) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	key := issueCacheKey(owner, repo, state, labels)
	entry, ok := c.entries[key]
	if !ok {
		return nil, CacheMiss
	}

	now := time.Now()

	if now.Before(entry.ExpiresAt) {
		return entry, CacheFresh
	}

	if now.Before(entry.StaleUntil) {
		return entry, CacheStale
	}

	return nil, CacheMiss
}

// SetFull stores issues and ETag in the cache
func (c *IssueCache) SetFull(owner, repo, state, labels string, issues []IssueListItem, etag string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := issueCacheKey(owner, repo, state, labels)
	now := time.Now()

	// Store a copy to prevent mutation
	issuesCopy := make([]IssueListItem, len(issues))
	for i, issue := range issues {
		issuesCopy[i] = copyIssueListItem(issue)
	}

	c.entries[key] = &IssueCacheEntry{
		Issues:     issuesCopy,
		ETag:       etag,
		CachedAt:   now,
		ExpiresAt:  now.Add(c.freshTTL),
		StaleUntil: now.Add(c.staleTTL),
	}

	logger.GitHub.Debugf("Issue cache SET %s: %d issues, etag=%q", key, len(issues), etag)
}

// copyIssueListItem creates a deep copy of an IssueListItem
func copyIssueListItem(item IssueListItem) IssueListItem {
	copied := item

	if item.Labels != nil {
		copied.Labels = make([]IssueLabel, len(item.Labels))
		copy(copied.Labels, item.Labels)
	}

	if item.Assignees != nil {
		copied.Assignees = make([]IssueUser, len(item.Assignees))
		copy(copied.Assignees, item.Assignees)
	}

	return copied
}

// BumpTTL atomically extends the fresh and stale deadlines for an existing entry.
// Returns true if the entry was found and bumped.
func (c *IssueCache) BumpTTL(owner, repo, state, labels string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := issueCacheKey(owner, repo, state, labels)
	entry, ok := c.entries[key]
	if !ok {
		return false
	}

	now := time.Now()
	entry.ExpiresAt = now.Add(c.freshTTL)
	entry.StaleUntil = now.Add(c.staleTTL)
	entry.CachedAt = now
	return true
}

// GetETag returns the stored ETag for a repo's issue list
func (c *IssueCache) GetETag(owner, repo, state, labels string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()

	key := issueCacheKey(owner, repo, state, labels)
	entry, ok := c.entries[key]
	if !ok {
		return ""
	}
	return entry.ETag
}

// TryStartRefresh attempts to claim the refresh lock for a cache key.
// Returns true if this caller should perform the refresh.
func (c *IssueCache) TryStartRefresh(owner, repo, state, labels string) bool {
	c.refreshMu.Lock()
	defer c.refreshMu.Unlock()

	key := issueCacheKey(owner, repo, state, labels)
	if c.refreshing[key] {
		return false
	}
	c.refreshing[key] = true
	return true
}

// EndRefresh releases the refresh lock for a cache key
func (c *IssueCache) EndRefresh(owner, repo, state, labels string) {
	c.refreshMu.Lock()
	defer c.refreshMu.Unlock()

	key := issueCacheKey(owner, repo, state, labels)
	delete(c.refreshing, key)
}

// Invalidate removes all cache entries for a specific repo (any state/labels combination)
func (c *IssueCache) Invalidate(owner, repo string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	prefix := owner + "/" + repo + ":"
	for key := range c.entries {
		if strings.HasPrefix(key, prefix) {
			delete(c.entries, key)
		}
	}
	logger.GitHub.Debugf("Issue cache INVALIDATE %s/%s", owner, repo)
}

// Clear removes all cache entries
func (c *IssueCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = make(map[string]*IssueCacheEntry)
}

// Done returns a channel that is closed when the cache is shut down.
// Useful for deriving contexts that should cancel on shutdown.
func (c *IssueCache) Done() <-chan struct{} {
	return c.done
}

// Close stops the cleanup goroutine. Safe to call multiple times.
func (c *IssueCache) Close() {
	select {
	case <-c.done:
		// Already closed
	default:
		close(c.done)
	}
}

// cleanupLoop periodically removes expired entries
func (c *IssueCache) cleanupLoop() {
	ticker := time.NewTicker(c.staleTTL)
	defer ticker.Stop()

	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
			c.cleanup()
		}
	}
}

// cleanup removes entries past their stale deadline
func (c *IssueCache) cleanup() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	for key, entry := range c.entries {
		if now.After(entry.StaleUntil) {
			delete(c.entries, key)
		}
	}
}
