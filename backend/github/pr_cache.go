package github

import (
	"sync"
	"time"

	"github.com/chatml/chatml-backend/logger"
)

// CacheFreshness indicates how fresh a cache entry is
type CacheFreshness int

const (
	// CacheMiss means no entry exists in cache
	CacheMiss CacheFreshness = iota
	// CacheFresh means the entry is within the fresh TTL (serve directly)
	CacheFresh
	// CacheStale means the entry is past fresh but within stale TTL (serve + revalidate)
	CacheStale
)

// PRCacheEntry holds cached PR list data with details
type PRCacheEntry struct {
	PRs        []PRListItem
	Details    map[int]*PRDetails // keyed by PR number
	ETag       string             // GitHub ETag for conditional requests on the list
	CachedAt   time.Time
	ExpiresAt  time.Time // "fresh" deadline
	StaleUntil time.Time // "stale" deadline (serve stale while revalidating)
}

// PRCache provides time-based caching for PR lists and details with stale-while-revalidate
type PRCache struct {
	mu       sync.RWMutex
	entries  map[string]*PRCacheEntry
	freshTTL time.Duration
	staleTTL time.Duration

	// Background refresh deduplication
	refreshMu  sync.Mutex
	refreshing map[string]bool

	// Shutdown signal for cleanup goroutine
	done chan struct{}
}

// NewPRCache creates a new PR cache with the given fresh and stale TTLs.
// Fresh TTL: serve directly from cache. Stale TTL: serve stale + trigger background refresh.
func NewPRCache(freshTTL, staleTTL time.Duration) *PRCache {
	cache := &PRCache{
		entries:    make(map[string]*PRCacheEntry),
		freshTTL:   freshTTL,
		staleTTL:   staleTTL,
		refreshing: make(map[string]bool),
		done:       make(chan struct{}),
	}

	// Start cleanup goroutine
	go cache.cleanupLoop()

	return cache
}

// cacheKey generates a cache key for a repo
func cacheKey(owner, repo string) string {
	return owner + "/" + repo
}

// GetWithStale retrieves cached PRs with freshness status.
// Returns the entry, its freshness, and whether data was found.
func (c *PRCache) GetWithStale(owner, repo string) (*PRCacheEntry, CacheFreshness) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	key := cacheKey(owner, repo)
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

// Get retrieves cached PRs for a repo (backwards-compatible, serves both fresh and stale entries)
func (c *PRCache) Get(owner, repo string) ([]PRListItem, bool) {
	entry, freshness := c.GetWithStale(owner, repo)
	if freshness == CacheMiss || entry == nil {
		return nil, false
	}

	// Return a copy to prevent mutation
	result := make([]PRListItem, len(entry.PRs))
	copy(result, entry.PRs)
	return result, true
}

// GetDetails retrieves cached details for a single PR
func (c *PRCache) GetDetails(owner, repo string, prNumber int) (*PRDetails, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	key := cacheKey(owner, repo)
	entry, ok := c.entries[key]
	if !ok {
		return nil, false
	}

	// Serve details from both fresh and stale entries
	now := time.Now()
	if now.After(entry.StaleUntil) {
		return nil, false
	}

	details, ok := entry.Details[prNumber]
	return details, ok
}

// SetFull stores PRs, details, and ETag in the cache
func (c *PRCache) SetFull(owner, repo string, prs []PRListItem, details map[int]*PRDetails, etag string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := cacheKey(owner, repo)
	now := time.Now()

	// Store copies to prevent mutation
	prsCopy := make([]PRListItem, len(prs))
	copy(prsCopy, prs)

	detailsCopy := make(map[int]*PRDetails, len(details))
	for k, v := range details {
		copied := *v
		if v.CheckDetails != nil {
			copied.CheckDetails = make([]CheckDetail, len(v.CheckDetails))
			copy(copied.CheckDetails, v.CheckDetails)
		}
		detailsCopy[k] = &copied
	}

	c.entries[key] = &PRCacheEntry{
		PRs:        prsCopy,
		Details:    detailsCopy,
		ETag:       etag,
		CachedAt:   now,
		ExpiresAt:  now.Add(c.freshTTL),
		StaleUntil: now.Add(c.staleTTL),
	}

	logger.GitHub.Debugf("PR cache SET %s: %d PRs, %d details, etag=%q", key, len(prs), len(details), etag)
}

// Set stores PRs in the cache (backwards-compatible, no details)
func (c *PRCache) Set(owner, repo string, prs []PRListItem) {
	c.SetFull(owner, repo, prs, nil, "")
}

// SetDetails updates the details for specific PRs within an existing cache entry
func (c *PRCache) SetDetails(owner, repo string, details map[int]*PRDetails) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := cacheKey(owner, repo)
	entry, ok := c.entries[key]
	if !ok {
		return
	}

	if entry.Details == nil {
		entry.Details = make(map[int]*PRDetails)
	}

	for k, v := range details {
		copied := *v
		if v.CheckDetails != nil {
			copied.CheckDetails = make([]CheckDetail, len(v.CheckDetails))
			copy(copied.CheckDetails, v.CheckDetails)
		}
		entry.Details[k] = &copied
	}
}

// BumpTTL atomically extends the fresh and stale deadlines for an existing entry.
// Returns true if the entry was found and bumped.
func (c *PRCache) BumpTTL(owner, repo string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := cacheKey(owner, repo)
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

// GetETag returns the stored ETag for a repo's PR list
func (c *PRCache) GetETag(owner, repo string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()

	key := cacheKey(owner, repo)
	entry, ok := c.entries[key]
	if !ok {
		return ""
	}
	return entry.ETag
}

// TryStartRefresh attempts to claim the refresh lock for a cache key.
// Returns true if this caller should perform the refresh.
func (c *PRCache) TryStartRefresh(owner, repo string) bool {
	c.refreshMu.Lock()
	defer c.refreshMu.Unlock()

	key := cacheKey(owner, repo)
	if c.refreshing[key] {
		return false
	}
	c.refreshing[key] = true
	return true
}

// EndRefresh releases the refresh lock for a cache key
func (c *PRCache) EndRefresh(owner, repo string) {
	c.refreshMu.Lock()
	defer c.refreshMu.Unlock()

	key := cacheKey(owner, repo)
	delete(c.refreshing, key)
}

// Invalidate removes a specific repo from cache
func (c *PRCache) Invalidate(owner, repo string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := cacheKey(owner, repo)
	delete(c.entries, key)
	logger.GitHub.Debugf("PR cache INVALIDATE %s", key)
}

// Clear removes all cache entries
func (c *PRCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = make(map[string]*PRCacheEntry)
}

// Done returns a channel that is closed when the cache is shut down.
// Useful for deriving contexts that should cancel on shutdown.
func (c *PRCache) Done() <-chan struct{} {
	return c.done
}

// Close stops the cleanup goroutine. Safe to call multiple times.
func (c *PRCache) Close() {
	select {
	case <-c.done:
		// Already closed
	default:
		close(c.done)
	}
}

// cleanupLoop periodically removes expired entries
func (c *PRCache) cleanupLoop() {
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
func (c *PRCache) cleanup() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	for key, entry := range c.entries {
		if now.After(entry.StaleUntil) {
			delete(c.entries, key)
		}
	}
}

// Stats returns cache statistics
func (c *PRCache) Stats() (total int, fresh int, stale int, expired int) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	now := time.Now()
	total = len(c.entries)
	for _, entry := range c.entries {
		if now.Before(entry.ExpiresAt) {
			fresh++
		} else if now.Before(entry.StaleUntil) {
			stale++
		} else {
			expired++
		}
	}
	return total, fresh, stale, expired
}
