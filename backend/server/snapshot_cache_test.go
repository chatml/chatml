package server

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/chatml/chatml-core/git"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func makeTestSnapshot() *SessionSnapshot {
	return &SessionSnapshot{
		GitStatus: &git.GitStatus{
			WorkingDirectory: git.WorkingDirectoryStatus{
				StagedCount:      1,
				UnstagedCount:    2,
				UntrackedCount:   0,
				TotalUncommitted: 3,
				HasChanges:       true,
			},
			Sync: git.SyncStatus{
				AheadBy:    1,
				BehindBy:   0,
				BaseBranch: "main",
				HasRemote:  true,
			},
			InProgress: git.InProgressStatus{Type: "none"},
			Conflicts:  git.ConflictStatus{Files: []string{}},
		},
		Changes: []git.FileChange{
			{Path: "src/main.go", Status: "modified", Additions: 5, Deletions: 2},
		},
		AllChanges: []git.FileChange{
			{Path: "src/main.go", Status: "modified", Additions: 5, Deletions: 2},
			{Path: "src/util.go", Status: "added", Additions: 20, Deletions: 0},
		},
		BranchCommits: []git.BranchCommit{
			{SHA: "abc123", ShortSHA: "abc", Message: "initial commit"},
		},
		BranchStats: &BranchStats{
			TotalFiles:     2,
			TotalAdditions: 25,
			TotalDeletions: 2,
		},
	}
}

func TestSnapshotCache_GetSet(t *testing.T) {
	cache := NewSnapshotCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	snap := makeTestSnapshot()
	cache.Set("session-1", snap)

	got, ok := cache.Get("session-1")
	require.True(t, ok, "expected cache hit")
	assert.Equal(t, 1, got.GitStatus.WorkingDirectory.StagedCount)
	assert.Len(t, got.Changes, 1)
	assert.Len(t, got.AllChanges, 2)
	assert.Len(t, got.BranchCommits, 1)
	assert.Equal(t, 25, got.BranchStats.TotalAdditions)
}

func TestSnapshotCache_GetMiss(t *testing.T) {
	cache := NewSnapshotCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	got, ok := cache.Get("nonexistent")
	assert.False(t, ok, "expected cache miss for nonexistent key")
	assert.Nil(t, got, "expected nil on cache miss")
}

func TestSnapshotCache_Expiration(t *testing.T) {
	cache := NewSnapshotCache(50 * time.Millisecond)
	t.Cleanup(func() { cache.Close() })

	snap := makeTestSnapshot()
	cache.Set("session-exp", snap)

	// Should be available immediately
	got, ok := cache.Get("session-exp")
	require.True(t, ok, "expected cache hit before expiration")
	assert.NotNil(t, got)

	// Wait for expiration
	time.Sleep(100 * time.Millisecond)

	got, ok = cache.Get("session-exp")
	assert.False(t, ok, "expected cache miss after TTL expiry")
	assert.Nil(t, got, "expected nil after TTL expiry")
}

func TestSnapshotCache_Invalidate(t *testing.T) {
	cache := NewSnapshotCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	cache.Set("session-a", makeTestSnapshot())
	cache.Set("session-b", makeTestSnapshot())

	// Verify both exist
	_, ok := cache.Get("session-a")
	require.True(t, ok)
	_, ok = cache.Get("session-b")
	require.True(t, ok)

	// Invalidate only session-a
	cache.Invalidate("session-a")

	_, ok = cache.Get("session-a")
	assert.False(t, ok, "session-a should be invalidated")

	got, ok := cache.Get("session-b")
	assert.True(t, ok, "session-b should be unaffected")
	assert.NotNil(t, got)
}

func TestSnapshotCache_OverwriteExisting(t *testing.T) {
	cache := NewSnapshotCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	snap1 := makeTestSnapshot()
	snap1.BranchStats.TotalAdditions = 10
	cache.Set("session-1", snap1)

	snap2 := makeTestSnapshot()
	snap2.BranchStats.TotalAdditions = 99
	cache.Set("session-1", snap2)

	got, ok := cache.Get("session-1")
	require.True(t, ok)
	assert.Equal(t, 99, got.BranchStats.TotalAdditions, "should return latest value")
}

func TestSnapshotCache_NilBranchStats(t *testing.T) {
	cache := NewSnapshotCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	snap := makeTestSnapshot()
	snap.BranchStats = nil
	cache.Set("session-nil", snap)

	got, ok := cache.Get("session-nil")
	require.True(t, ok)
	assert.Nil(t, got.BranchStats)
}

func TestSnapshotCache_ConcurrentAccess(t *testing.T) {
	cache := NewSnapshotCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	const numGoroutines = 50
	var wg sync.WaitGroup

	// Concurrent writers
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			session := fmt.Sprintf("session-%d", n%10)
			cache.Set(session, makeTestSnapshot())
		}(i)
	}

	// Concurrent readers
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			session := fmt.Sprintf("session-%d", n%10)
			cache.Get(session)
		}(i)
	}

	// Concurrent invalidators
	for i := 0; i < numGoroutines/5; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			session := fmt.Sprintf("session-%d", n%10)
			cache.Invalidate(session)
		}(i)
	}

	wg.Wait()
	// No panics, races, or deadlocks
}

func TestSnapshotCache_Close(t *testing.T) {
	cache := NewSnapshotCache(5 * time.Minute)

	assert.NotPanics(t, func() {
		cache.Close()
	})

	// Cache should still be usable after close (just no auto-cleanup)
	cache.Set("after-close", makeTestSnapshot())
	got, ok := cache.Get("after-close")
	assert.True(t, ok, "expected cache to remain usable after Close")
	require.NotNil(t, got)
}

func TestSnapshotCache_CleanupRemovesExpired(t *testing.T) {
	cache := NewSnapshotCache(50 * time.Millisecond)
	t.Cleanup(func() { cache.Close() })

	cache.Set("session-cleanup", makeTestSnapshot())

	// Wait for expiration
	time.Sleep(100 * time.Millisecond)

	// Manually trigger cleanup
	cache.cleanup()

	// Verify the internal map is empty
	cache.mu.RLock()
	count := len(cache.entries)
	cache.mu.RUnlock()
	assert.Equal(t, 0, count, "expired entries should be removed by cleanup")
}

func TestSnapshotCache_InvalidateNonexistent(t *testing.T) {
	cache := NewSnapshotCache(5 * time.Minute)
	t.Cleanup(func() { cache.Close() })

	// Should not panic
	assert.NotPanics(t, func() {
		cache.Invalidate("does-not-exist")
	})
}
