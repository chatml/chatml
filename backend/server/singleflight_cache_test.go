package server

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSFCache_CollapsesConcurrentCalls(t *testing.T) {
	c := NewSFCache[int](5 * time.Second)
	var calls int64

	var wg sync.WaitGroup
	const n = 50
	wg.Add(n)
	start := make(chan struct{})
	results := make([]int, n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			<-start
			v, err := c.Do("k", func() (int, error) {
				atomic.AddInt64(&calls, 1)
				time.Sleep(20 * time.Millisecond)
				return 42, nil
			})
			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
			results[i] = v
		}(i)
	}
	close(start)
	wg.Wait()

	if got := atomic.LoadInt64(&calls); got != 1 {
		t.Errorf("expected 1 underlying call, got %d", got)
	}
	for i, v := range results {
		if v != 42 {
			t.Errorf("result[%d] = %d, want 42", i, v)
		}
	}
}

func TestSFCache_ServesFromCacheWithinTTL(t *testing.T) {
	c := NewSFCache[string](200 * time.Millisecond)
	var calls int64

	for i := 0; i < 5; i++ {
		v, err := c.Do("k", func() (string, error) {
			atomic.AddInt64(&calls, 1)
			return "v", nil
		})
		if err != nil || v != "v" {
			t.Fatalf("call %d: got (%q, %v), want (\"v\", nil)", i, v, err)
		}
	}

	if got := atomic.LoadInt64(&calls); got != 1 {
		t.Errorf("expected 1 underlying call, got %d", got)
	}
}

func TestSFCache_RefetchesAfterTTL(t *testing.T) {
	c := NewSFCache[int](30 * time.Millisecond)
	var calls int64

	for i := 0; i < 3; i++ {
		_, _ = c.Do("k", func() (int, error) {
			atomic.AddInt64(&calls, 1)
			return i, nil
		})
		time.Sleep(50 * time.Millisecond)
	}

	if got := atomic.LoadInt64(&calls); got != 3 {
		t.Errorf("expected 3 underlying calls after TTL expiry, got %d", got)
	}
}

func TestSFCache_ErrorsAreNotCached(t *testing.T) {
	c := NewSFCache[int](5 * time.Second)
	sentinel := errors.New("boom")
	var calls int64

	for i := 0; i < 3; i++ {
		_, err := c.Do("k", func() (int, error) {
			atomic.AddInt64(&calls, 1)
			return 0, sentinel
		})
		if !errors.Is(err, sentinel) {
			t.Errorf("call %d: expected sentinel error, got %v", i, err)
		}
	}

	if got := atomic.LoadInt64(&calls); got != 3 {
		t.Errorf("expected 3 underlying calls (errors not cached), got %d", got)
	}
}

func TestSFCache_DoContext_CallerCancelDoesNotCancelSharedWork(t *testing.T) {
	c := NewSFCache[int](5 * time.Second)
	var calls int64
	started := make(chan struct{})
	finish := make(chan struct{})

	work := func() (int, error) {
		atomic.AddInt64(&calls, 1)
		close(started)
		<-finish
		return 99, nil
	}

	// First caller cancels its own context mid-flight.
	ctx1, cancel1 := context.WithCancel(context.Background())
	c1Done := make(chan error, 1)
	go func() {
		_, err := c.DoContext(ctx1, "k", work)
		c1Done <- err
	}()
	<-started

	// Second caller joins the same singleflight slot with a fresh context.
	c2Done := make(chan struct {
		v   int
		err error
	}, 1)
	go func() {
		v, err := c.DoContext(context.Background(), "k", work)
		c2Done <- struct {
			v   int
			err error
		}{v, err}
	}()

	// Cancel only the first caller. The shared work must still complete.
	cancel1()

	// First caller bails with ctx.Err().
	if err := <-c1Done; !errors.Is(err, context.Canceled) {
		t.Errorf("first caller: want context.Canceled, got %v", err)
	}

	// Now release the underlying work.
	close(finish)
	res := <-c2Done
	if res.err != nil || res.v != 99 {
		t.Errorf("second caller: got (%d, %v), want (99, nil)", res.v, res.err)
	}
	if got := atomic.LoadInt64(&calls); got != 1 {
		t.Errorf("expected 1 underlying call, got %d", got)
	}
}

func TestSFCache_DoContext_CachesOnSuccess(t *testing.T) {
	c := NewSFCache[int](5 * time.Second)
	var calls int64

	for i := 0; i < 3; i++ {
		v, err := c.DoContext(context.Background(), "k", func() (int, error) {
			atomic.AddInt64(&calls, 1)
			return 7, nil
		})
		if err != nil || v != 7 {
			t.Fatalf("iter %d: got (%d, %v), want (7, nil)", i, v, err)
		}
	}
	if got := atomic.LoadInt64(&calls); got != 1 {
		t.Errorf("expected 1 underlying call, got %d", got)
	}
}

func TestSFCache_Invalidate(t *testing.T) {
	c := NewSFCache[int](5 * time.Second)
	var calls int64

	for i := 0; i < 2; i++ {
		_, _ = c.Do("k", func() (int, error) {
			atomic.AddInt64(&calls, 1)
			return 1, nil
		})
		c.Invalidate("k")
	}

	if got := atomic.LoadInt64(&calls); got != 2 {
		t.Errorf("expected 2 underlying calls after invalidation, got %d", got)
	}
}

func TestSFCache_SetPopulatesEntryAndSuppressesFn(t *testing.T) {
	c := NewSFCache[int](5 * time.Second)
	var calls int64

	c.Set("k", 7)

	for i := 0; i < 3; i++ {
		v, err := c.Do("k", func() (int, error) {
			atomic.AddInt64(&calls, 1)
			return 99, nil
		})
		if err != nil || v != 7 {
			t.Fatalf("iter %d: got (%d, %v), want (7, nil)", i, v, err)
		}
	}
	if got := atomic.LoadInt64(&calls); got != 0 {
		t.Errorf("expected 0 underlying calls (Set should populate cache), got %d", got)
	}
}

func TestSFCache_StaleOnError_ReturnsStaleAfterFailedRefresh(t *testing.T) {
	// Fresh window short, stale window long: the entry expires almost
	// immediately but stays available as a fallback for ~5s.
	c := NewSFCacheWithStale[string](20*time.Millisecond, 5*time.Second)

	// Seed a cached value via a successful first call.
	if _, _, err := c.DoContextWithStaleOnError(context.Background(), "k", func() (string, error) {
		return "v1", nil
	}); err != nil {
		t.Fatalf("seed call: unexpected error: %v", err)
	}

	// Let freshness elapse but keep stale window valid.
	time.Sleep(40 * time.Millisecond)

	// Refresh fails — caller should still see the cached value tagged stale.
	v, state, err := c.DoContextWithStaleOnError(context.Background(), "k", func() (string, error) {
		return "", errors.New("upstream down")
	})
	if err != nil {
		t.Fatalf("expected nil error from stale fallback, got %v", err)
	}
	if v != "v1" {
		t.Errorf("expected stale value v1, got %q", v)
	}
	if state != CacheStaleError {
		t.Errorf("expected CacheStaleError, got %v", state)
	}
}

func TestSFCache_StaleOnError_PropagatesErrorWithNoFallback(t *testing.T) {
	// A miss with no prior successful call has no stale value to fall back
	// on; the error must surface so the caller can render an error state.
	c := NewSFCacheWithStale[int](20*time.Millisecond, 5*time.Second)
	sentinel := errors.New("upstream down")

	_, state, err := c.DoContextWithStaleOnError(context.Background(), "k", func() (int, error) {
		return 0, sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Errorf("expected sentinel error, got %v", err)
	}
	if state != CacheFresh {
		t.Errorf("expected CacheFresh marker on hard error path, got %v", state)
	}
}

func TestSFCache_StaleOnError_FreshHitDoesNotCallFn(t *testing.T) {
	c := NewSFCacheWithStale[string](5*time.Second, 30*time.Second)
	_, _, err := c.DoContextWithStaleOnError(context.Background(), "k", func() (string, error) {
		return "v1", nil
	})
	if err != nil {
		t.Fatalf("seed call: unexpected error: %v", err)
	}

	called := false
	v, state, err := c.DoContextWithStaleOnError(context.Background(), "k", func() (string, error) {
		called = true
		return "v2", nil
	})
	if err != nil || v != "v1" {
		t.Errorf("expected fresh hit (v1, nil), got (%q, %v)", v, err)
	}
	if state != CacheFresh {
		t.Errorf("expected CacheFresh, got %v", state)
	}
	if called {
		t.Error("fresh hit must not invoke fn")
	}
}

func TestSFCache_StaleOnError_EntryEvictedAfterStaleWindow(t *testing.T) {
	// Past the stale window, the value is gone and the next failure surfaces.
	c := NewSFCacheWithStale[string](10*time.Millisecond, 30*time.Millisecond)
	_, _, err := c.DoContextWithStaleOnError(context.Background(), "k", func() (string, error) {
		return "v1", nil
	})
	if err != nil {
		t.Fatalf("seed call: unexpected error: %v", err)
	}

	time.Sleep(60 * time.Millisecond)
	sentinel := errors.New("upstream down")
	_, _, err = c.DoContextWithStaleOnError(context.Background(), "k", func() (string, error) {
		return "", sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Errorf("past stale window: expected sentinel error, got %v", err)
	}
}

func TestSFCache_LookupEvictsExpiredEntry(t *testing.T) {
	c := NewSFCache[int](20 * time.Millisecond)

	if _, err := c.Do("k", func() (int, error) { return 1, nil }); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := mapLen(c); got != 1 {
		t.Fatalf("expected 1 entry after store, got %d", got)
	}

	time.Sleep(40 * time.Millisecond)

	// Lookup of an expired key must drop it from the map without requiring
	// a Sweep call. Otherwise stale, never-revisited keys accumulate forever.
	if _, ok := c.lookup("k"); ok {
		t.Fatal("expected lookup to miss on expired entry")
	}
	if got := mapLen(c); got != 0 {
		t.Errorf("expected expired entry to be evicted, %d entries remain", got)
	}
}

func TestSFCache_Sweep(t *testing.T) {
	c := NewSFCache[int](20 * time.Millisecond)

	for _, k := range []string{"a", "b", "c"} {
		k := k
		_, _ = c.Do(k, func() (int, error) { return 1, nil })
	}
	if got := mapLen(c); got != 3 {
		t.Fatalf("expected 3 entries, got %d", got)
	}

	time.Sleep(40 * time.Millisecond)

	c.Sweep()
	if got := mapLen(c); got != 0 {
		t.Errorf("expected all expired entries swept, %d remain", got)
	}
}

func TestSFCache_StartSweeperRunsUntilContextCanceled(t *testing.T) {
	c := NewSFCache[int](20 * time.Millisecond)
	for _, k := range []string{"a", "b"} {
		k := k
		_, _ = c.Do(k, func() (int, error) { return 1, nil })
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c.StartSweeper(ctx, 10*time.Millisecond)

	// Wait for at least one sweep tick after entries expire.
	deadline := time.Now().Add(200 * time.Millisecond)
	for time.Now().Before(deadline) {
		if mapLen(c) == 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := mapLen(c); got != 0 {
		t.Errorf("expected sweeper to evict expired entries, %d remain", got)
	}
}

func mapLen[T any](c *SFCache[T]) int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.entries)
}
