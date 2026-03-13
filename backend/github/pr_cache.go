package github

import (
	"container/list"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/logger"
)

// lruItem is stored in the LRU list to track access order
type lruItem struct {
	key string
}

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
	mu         sync.Mutex
	entries    map[string]*PRCacheEntry
	freshTTL   time.Duration
	staleTTL   time.Duration
	maxEntries int

	// LRU eviction order (front = most recent, back = least recent)
	order *list.List
	items map[string]*list.Element

	// Background refresh deduplication
	refreshMu  sync.Mutex
	refreshing map[string]bool

	// Shutdown signal for cleanup goroutine
	done chan struct{}
}

// NewPRCache creates a new PR cache with the given fresh and stale TTLs.
// Fresh TTL: serve directly from cache. Stale TTL: serve stale + trigger background refresh.
// maxEntries limits the cache size; when exceeded, the least-recently-accessed entry is evicted.
// A maxEntries <= 0 means unlimited.
func NewPRCache(freshTTL, staleTTL time.Duration, maxEntries int) *PRCache {
	cache := &PRCache{
		entries:    make(map[string]*PRCacheEntry),
		freshTTL:   freshTTL,
		staleTTL:   staleTTL,
		maxEntries: maxEntries,
		order:      list.New(),
		items:      make(map[string]*list.Element),
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
	c.mu.Lock()
	defer c.mu.Unlock()

	key := cacheKey(owner, repo)
	entry, ok := c.entries[key]
	if !ok {
		return nil, CacheMiss
	}

	now := time.Now()

	if now.Before(entry.ExpiresAt) {
		c.touchLRU(key)
		return entry, CacheFresh
	}

	if now.Before(entry.StaleUntil) {
		c.touchLRU(key)
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
	c.mu.Lock()
	defer c.mu.Unlock()

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
	if ok {
		c.touchLRU(key)
	}
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

	c.touchLRU(key)
	c.evictIfNeeded()

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

	c.touchLRU(key)
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
	c.touchLRU(key)
	return true
}

// GetETag returns the stored ETag for a repo's PR list
func (c *PRCache) GetETag(owner, repo string) string {
	c.mu.Lock()
	defer c.mu.Unlock()

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
	c.removeLRU(key)
	logger.GitHub.Debugf("PR cache INVALIDATE %s", key)
}

// Clear removes all cache entries
func (c *PRCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = make(map[string]*PRCacheEntry)
	c.order = list.New()
	c.items = make(map[string]*list.Element)
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
			c.removeLRU(key)
		}
	}

	logger.GitHub.Debugf("PR cache cleanup: %d entries remaining (max %d)", len(c.entries), c.maxEntries)
}

// touchLRU moves the key to the front of the LRU list (most recently used).
// Must be called while holding c.mu.
func (c *PRCache) touchLRU(key string) {
	if elem, ok := c.items[key]; ok {
		c.order.MoveToFront(elem)
	} else {
		elem := c.order.PushFront(&lruItem{key: key})
		c.items[key] = elem
	}
}

// evictIfNeeded removes the least-recently-used entries until within maxEntries.
// Must be called while holding c.mu.
func (c *PRCache) evictIfNeeded() {
	if c.maxEntries <= 0 {
		return
	}
	for len(c.entries) > c.maxEntries {
		back := c.order.Back()
		if back == nil {
			break
		}
		item := back.Value.(*lruItem)
		delete(c.entries, item.key)
		c.order.Remove(back)
		delete(c.items, item.key)
		logger.GitHub.Debugf("PR cache LRU evict %s", item.key)
	}
}

// removeLRU removes a key from the LRU tracking structures.
// Must be called while holding c.mu.
func (c *PRCache) removeLRU(key string) {
	if elem, ok := c.items[key]; ok {
		c.order.Remove(elem)
		delete(c.items, key)
	}
}

// Size returns the number of entries in the cache
func (c *PRCache) Size() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.entries)
}

// Stats returns cache statistics
func (c *PRCache) Stats() (total int, fresh int, stale int, expired int) {
	c.mu.Lock()
	defer c.mu.Unlock()

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
