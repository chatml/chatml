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
	sf       singleflight.Group
	ttl      time.Duration // freshness window — Do/DoContext serve directly within this
	staleTTL time.Duration // extended grace period; entries past ttl but within staleTTL
	// remain in the map and are usable as a stale-on-error fallback.

	mu      sync.RWMutex
	entries map[string]sfEntry[T]
}

type sfEntry[T any] struct {
	value      T
	expiresAt  time.Time // after this: not fresh (Do refetches)
	staleUntil time.Time // after this: evicted (entry is gone)
}

// CacheState describes how DoContextWithStaleOnError served its result.
type CacheState int

const (
	// CacheFresh means the value was served from fresh cache or from a
	// successful upstream refresh.
	CacheFresh CacheState = iota
	// CacheStaleError means the upstream refresh returned an error and the
	// caller is being served a previously-cached value as a fallback.
	// Surface this to the client (e.g. via X-Cache-Status: stale-error)
	// so degraded responses are visible.
	CacheStaleError
)

// NewSFCache returns a singleflight-backed TTL cache. ttl must be > 0.
// The cache has no extended stale window — entries are evicted at ttl.
//
// Without an explicit eviction strategy, entries that are written once and
// never re-stored (e.g. a feature branch that's deleted, a closed PR) would
// stay in the map until process exit. Use StartSweeper for long-lived caches
// whose key cardinality grows with usage.
func NewSFCache[T any](ttl time.Duration) *SFCache[T] {
	return NewSFCacheWithStale[T](ttl, ttl)
}

// NewSFCacheWithStale returns a cache with separate freshness and staleness
// windows. Entries are served directly while within freshTTL; past freshTTL
// but within staleTTL they remain in the map and can be served by
// DoContextWithStaleOnError as a fallback when an upstream refresh fails.
// staleTTL is clamped up to freshTTL.
func NewSFCacheWithStale[T any](freshTTL, staleTTL time.Duration) *SFCache[T] {
	if staleTTL < freshTTL {
		staleTTL = freshTTL
	}
	return &SFCache[T]{
		ttl:      freshTTL,
		staleTTL: staleTTL,
		entries:  make(map[string]sfEntry[T]),
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

// DoContextWithStaleOnError is like DoContext but, when fn returns an error
// and a stale cached value is still within the staleTTL window, returns that
// value with CacheStaleError instead of surfacing the error. This trades
// momentary staleness for UI continuity during upstream outages: the
// alternative is the user seeing 5xx panels every poll until the upstream
// recovers.
//
// Behaviour matrix:
//   - fresh hit:                  → (value, CacheFresh, nil)
//   - miss + fn ok:               → (value, CacheFresh, nil)
//   - miss + fn error + stale:    → (stale, CacheStaleError, nil)
//   - miss + fn error + no stale: → (zero,  CacheFresh,      err)
//   - ctx cancelled:              → (zero,  CacheFresh,      ctx.Err())
//
// Caller's ctx can abort their wait without cancelling the underlying fn —
// see DoContext for the singleflight semantics.
func (c *SFCache[T]) DoContextWithStaleOnError(ctx context.Context, key string, fn func() (T, error)) (T, CacheState, error) {
	if v, ok := c.lookup(key); ok {
		return v, CacheFresh, nil
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
		return zero, CacheFresh, ctx.Err()
	case res := <-ch:
		if res.Err != nil {
			// Refresh failed — fall back to a stale cached value if one
			// exists. This is the entire point of the staleTTL window.
			if v, ok := c.lookupStale(key); ok {
				return v, CacheStaleError, nil
			}
			var zero T
			return zero, CacheFresh, res.Err
		}
		return res.Val.(T), CacheFresh, nil
	}
}

// Invalidate drops any cached value for key. Safe to call when nothing is cached.
func (c *SFCache[T]) Invalidate(key string) {
	c.mu.Lock()
	delete(c.entries, key)
	c.mu.Unlock()
}

// Set populates the cache for key with the configured TTL. Use this when an
// external producer (e.g. a background poller) has already fetched the value
// and wants subsequent Do/DoContext calls to hit instead of refetching.
//
// The stored value is treated as read-only — see the SFCache contract.
func (c *SFCache[T]) Set(key string, value T) {
	c.store(key, value)
}

// lookup returns the cached value if it is still fresh. Past the freshness
// window but within the stale window, the entry is intentionally retained so
// DoContextWithStaleOnError can fall back to it on upstream failure.
func (c *SFCache[T]) lookup(key string) (T, bool) {
	c.mu.RLock()
	entry, ok := c.entries[key]
	c.mu.RUnlock()
	if !ok {
		var zero T
		return zero, false
	}
	now := time.Now()
	if now.After(entry.staleUntil) {
		// Past stale window — drop the entry so a key looked up once and
		// never re-stored doesn't pin memory forever. Re-check under the
		// write lock to avoid racing a fresh write.
		c.mu.Lock()
		if cur, ok := c.entries[key]; ok && time.Now().After(cur.staleUntil) {
			delete(c.entries, key)
		}
		c.mu.Unlock()
		var zero T
		return zero, false
	}
	if now.After(entry.expiresAt) {
		// Stale-but-retained: not a fresh hit. Don't evict; the
		// stale-on-error path may still need this value.
		var zero T
		return zero, false
	}
	return entry.value, true
}

// lookupStale returns any retained value (fresh or past-fresh-but-within-
// staleTTL). Used by DoContextWithStaleOnError as the fallback path when
// the upstream refresh fails. Does not evict on miss.
func (c *SFCache[T]) lookupStale(key string) (T, bool) {
	c.mu.RLock()
	entry, ok := c.entries[key]
	c.mu.RUnlock()
	if !ok {
		var zero T
		return zero, false
	}
	if time.Now().After(entry.staleUntil) {
		var zero T
		return zero, false
	}
	return entry.value, true
}

// Sweep walks the entries map once and deletes anything past its stale
// deadline (entries past freshness but still within staleTTL are retained
// for stale-on-error fallback). Cheap even for caches with thousands of
// keys (just a map walk under a write lock). Exposed for tests;
// production callers should use StartSweeper.
func (c *SFCache[T]) Sweep() {
	now := time.Now()
	c.mu.Lock()
	for k, e := range c.entries {
		if now.After(e.staleUntil) {
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
	now := time.Now()
	c.mu.Lock()
	c.entries[key] = sfEntry[T]{
		value:      value,
		expiresAt:  now.Add(c.ttl),
		staleUntil: now.Add(c.staleTTL),
	}
	c.mu.Unlock()
}
