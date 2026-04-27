package server

import (
	"context"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// SFCache combines golang.org/x/sync/singleflight with a short-TTL value cache.
//
// Concurrent callers with the same key share a single in-flight call (collapses
// thundering-herd fan-out). After the call returns, the result is cached for
// the configured TTL so subsequent calls within the window skip the work
// entirely.
//
// Errors are not cached: failed calls flow through to the next caller.
//
// Read-only contract: cached values are returned by reference. For pointer,
// slice, or map types, every concurrent caller (and every cache hit within
// the TTL) shares the same underlying memory. Callers must treat the returned
// value as read-only — mutating it races with other readers and silently
// corrupts the cache entry. If you need to mutate, copy first.
type SFCache[T any] struct {
	sf  singleflight.Group
	ttl time.Duration

	mu      sync.RWMutex
	entries map[string]sfEntry[T]
}

type sfEntry[T any] struct {
	value     T
	expiresAt time.Time
}

// NewSFCache returns a singleflight-backed TTL cache. ttl must be > 0.
//
// Without an explicit eviction strategy, entries that are written once and
// never re-stored (e.g. a feature branch that's deleted, a closed PR) would
// stay in the map until process exit. Use StartSweeper for long-lived caches
// whose key cardinality grows with usage.
func NewSFCache[T any](ttl time.Duration) *SFCache[T] {
	return &SFCache[T]{
		ttl:     ttl,
		entries: make(map[string]sfEntry[T]),
	}
}

// Do returns the cached value for key if it's still fresh, otherwise invokes fn
// (collapsing concurrent calls for the same key into one) and caches the result
// for ttl on success.
//
// Do blocks until fn returns. If fn might wrap a context-aware call (DB query,
// HTTP request), prefer DoContext so callers can bail when their own context
// is canceled. See the read-only contract on SFCache for value-sharing rules.
func (c *SFCache[T]) Do(key string, fn func() (T, error)) (T, error) {
	if v, ok := c.lookup(key); ok {
		return v, nil
	}

	v, err, _ := c.sf.Do(key, func() (any, error) {
		// Re-check cache inside singleflight to avoid duplicate work when
		// callers serialize on the same key just after a fresh write.
		if v, ok := c.lookup(key); ok {
			return v, nil
		}
		result, err := fn()
		if err != nil {
			var zero T
			return zero, err
		}
		c.store(key, result)
		return result, nil
	})
	if err != nil {
		var zero T
		return zero, err
	}
	return v.(T), nil
}

// DoContext is like Do but the caller's ctx can abort its wait without
// canceling the underlying fn. If ctx is canceled while a shared call is in
// flight, this caller returns ctx.Err() immediately while the underlying work
// continues for any other waiters and the result still populates the cache
// on success.
//
// fn itself receives no context: it must use a context independent of any
// individual caller (typically a server-lifetime context with an explicit
// timeout) so one client disconnect cannot poison the shared call.
func (c *SFCache[T]) DoContext(ctx context.Context, key string, fn func() (T, error)) (T, error) {
	if v, ok := c.lookup(key); ok {
		return v, nil
	}

	ch := c.sf.DoChan(key, func() (any, error) {
		if v, ok := c.lookup(key); ok {
			return v, nil
		}
		result, err := fn()
		if err != nil {
			var zero T
			return zero, err
		}
		c.store(key, result)
		return result, nil
	})

	select {
	case <-ctx.Done():
		var zero T
		return zero, ctx.Err()
	case res := <-ch:
		if res.Err != nil {
			var zero T
			return zero, res.Err
		}
		return res.Val.(T), nil
	}
}

// Invalidate drops any cached value for key. Safe to call when nothing is cached.
func (c *SFCache[T]) Invalidate(key string) {
	c.mu.Lock()
	delete(c.entries, key)
	c.mu.Unlock()
}

func (c *SFCache[T]) lookup(key string) (T, bool) {
	c.mu.RLock()
	entry, ok := c.entries[key]
	c.mu.RUnlock()
	if !ok {
		var zero T
		return zero, false
	}
	if time.Now().After(entry.expiresAt) {
		// Opportunistic eviction: drop the stale entry so a key that's
		// looked up once and never re-stored doesn't pin memory forever.
		// Re-check under the write lock — another caller may have
		// refreshed the entry between our read and write.
		c.mu.Lock()
		if cur, ok := c.entries[key]; ok && time.Now().After(cur.expiresAt) {
			delete(c.entries, key)
		}
		c.mu.Unlock()
		var zero T
		return zero, false
	}
	return entry.value, true
}

// Sweep walks the entries map once and deletes anything past its TTL. Cheap
// even for caches with thousands of keys (just a map walk under a write lock).
// Exposed for tests; production callers should use StartSweeper.
func (c *SFCache[T]) Sweep() {
	now := time.Now()
	c.mu.Lock()
	for k, e := range c.entries {
		if now.After(e.expiresAt) {
			delete(c.entries, k)
		}
	}
	c.mu.Unlock()
}

// StartSweeper runs Sweep on a ticker until ctx is cancelled. Suitable for
// long-lived caches whose key cardinality grows over server lifetime
// (e.g. one entry per branch / PR / session). The interval is typically a
// small multiple of the cache TTL — frequent enough to bound memory, sparse
// enough to be a nonissue. Returns immediately; the sweeper runs in a
// background goroutine.
func (c *SFCache[T]) StartSweeper(ctx context.Context, interval time.Duration) {
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				c.Sweep()
			}
		}
	}()
}

func (c *SFCache[T]) store(key string, value T) {
	c.mu.Lock()
	c.entries[key] = sfEntry[T]{value: value, expiresAt: time.Now().Add(c.ttl)}
	c.mu.Unlock()
}
