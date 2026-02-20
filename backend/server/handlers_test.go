package server

import (
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/git"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponseContentType(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "repo-1", "/path/to/repo")

	req := httptest.NewRequest("GET", "/api/repos", nil)
	w := httptest.NewRecorder()

	h.ListRepos(w, req)

	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
}
func TestLoadFileSizeConfig_Default(t *testing.T) {
	// Clear environment variable - t.Setenv with empty string then unset
	t.Setenv("CHATML_MAX_FILE_SIZE_MB", "")

	config := LoadFileSizeConfig()

	// Default is 50MB
	assert.Equal(t, int64(50*1024*1024), config.MaxFileSizeBytes)
}

func TestLoadFileSizeConfig_FromEnv(t *testing.T) {
	t.Setenv("CHATML_MAX_FILE_SIZE_MB", "100")

	config := LoadFileSizeConfig()

	// Should be 100MB
	assert.Equal(t, int64(100*1024*1024), config.MaxFileSizeBytes)
}

func TestLoadFileSizeConfig_InvalidEnv(t *testing.T) {
	t.Setenv("CHATML_MAX_FILE_SIZE_MB", "invalid")

	config := LoadFileSizeConfig()

	// Should fall back to default (50MB)
	assert.Equal(t, int64(50*1024*1024), config.MaxFileSizeBytes)
}

func TestLoadFileSizeConfig_ZeroValue(t *testing.T) {
	t.Setenv("CHATML_MAX_FILE_SIZE_MB", "0")

	config := LoadFileSizeConfig()

	// Zero is invalid, should fall back to default (50MB)
	assert.Equal(t, int64(50*1024*1024), config.MaxFileSizeBytes)
}
func TestDirListingCache_GetSet(t *testing.T) {
	cache := NewDirListingCache(1 * time.Second)
	defer cache.Close()

	// Initially should not have the key
	_, ok := cache.Get("test-key")
	assert.False(t, ok)

	// Set a value
	testData := []*FileNode{
		{Name: "file1.txt", Path: "file1.txt", IsDir: false},
		{Name: "dir1", Path: "dir1", IsDir: true},
	}
	cache.Set("test-key", testData)

	// Should now have the key
	result, ok := cache.Get("test-key")
	assert.True(t, ok)
	assert.Equal(t, testData, result)
}

func TestDirListingCache_Expiration(t *testing.T) {
	cache := NewDirListingCache(50 * time.Millisecond)
	defer cache.Close()

	testData := []*FileNode{
		{Name: "file1.txt", Path: "file1.txt", IsDir: false},
	}
	cache.Set("test-key", testData)

	// Should have the key immediately
	_, ok := cache.Get("test-key")
	assert.True(t, ok)

	// Wait for TTL to expire with sufficient margin for CI environments
	time.Sleep(150 * time.Millisecond)

	// Should no longer have the key
	_, ok = cache.Get("test-key")
	assert.False(t, ok)
}

func TestDirListingCache_InvalidatePath(t *testing.T) {
	cache := NewDirListingCache(1 * time.Minute)
	defer cache.Close()

	// Set multiple entries with different paths
	cache.Set("repo:/path/to/repo:depth:1", []*FileNode{{Name: "a.txt"}})
	cache.Set("repo:/path/to/repo:depth:10", []*FileNode{{Name: "b.txt"}})
	cache.Set("session:/path/to/worktree:depth:1", []*FileNode{{Name: "c.txt"}})

	// Verify all entries exist
	_, ok1 := cache.Get("repo:/path/to/repo:depth:1")
	_, ok2 := cache.Get("repo:/path/to/repo:depth:10")
	_, ok3 := cache.Get("session:/path/to/worktree:depth:1")
	assert.True(t, ok1)
	assert.True(t, ok2)
	assert.True(t, ok3)

	// Invalidate entries containing /path/to/repo
	cache.InvalidatePath("/path/to/repo")

	// repo entries should be gone, session entry should remain
	_, ok1 = cache.Get("repo:/path/to/repo:depth:1")
	_, ok2 = cache.Get("repo:/path/to/repo:depth:10")
	_, ok3 = cache.Get("session:/path/to/worktree:depth:1")
	assert.False(t, ok1)
	assert.False(t, ok2)
	assert.True(t, ok3)
}

func TestDirListingCache_Stats(t *testing.T) {
	// Use longer TTL to avoid cleanup goroutine interference
	cache := NewDirListingCache(1 * time.Minute)
	defer cache.Close()

	// Initially empty
	total, expired := cache.Stats()
	assert.Equal(t, 0, total)
	assert.Equal(t, 0, expired)

	// Add entries
	cache.Set("key1", []*FileNode{{Name: "a.txt"}})
	cache.Set("key2", []*FileNode{{Name: "b.txt"}})

	total, expired = cache.Stats()
	assert.Equal(t, 2, total)
	assert.Equal(t, 0, expired)
}

func TestDirListingCache_ConcurrentAccess(t *testing.T) {
	cache := NewDirListingCache(1 * time.Minute)
	defer cache.Close()
	var wg sync.WaitGroup

	// Concurrently read and write
	for i := 0; i < 100; i++ {
		wg.Add(2)
		key := "key-" + string(rune('a'+i%26))

		// Writer
		go func(k string) {
			defer wg.Done()
			cache.Set(k, []*FileNode{{Name: k}})
		}(key)

		// Reader
		go func(k string) {
			defer wg.Done()
			cache.Get(k)
		}(key)
	}

	wg.Wait()

	// Should not panic and should have some entries
	total, _ := cache.Stats()
	assert.Greater(t, total, 0)
}
func TestBranchCache_GetSet(t *testing.T) {
	cache := NewBranchCache(5 * time.Minute)
	defer cache.Close()

	data := &git.BranchListResult{
		Branches: []git.BranchInfo{
			{Name: "main", IsHead: true},
			{Name: "feature-1"},
		},
	}
	cache.Set("/repo:local:false:", data)

	result, ok := cache.Get("/repo:local:false:")
	require.True(t, ok)
	require.Len(t, result.Branches, 2)
	require.Equal(t, "main", result.Branches[0].Name)
}

func TestBranchCache_GetNotFound(t *testing.T) {
	cache := NewBranchCache(5 * time.Minute)
	defer cache.Close()

	result, ok := cache.Get("nonexistent")
	require.False(t, ok)
	require.Nil(t, result)
}

func TestBranchCache_Expiration(t *testing.T) {
	cache := NewBranchCache(50 * time.Millisecond)
	defer cache.Close()

	data := &git.BranchListResult{
		Branches: []git.BranchInfo{{Name: "main"}},
	}
	cache.Set("key", data)

	// Should be available immediately
	result, ok := cache.Get("key")
	require.True(t, ok)
	require.Len(t, result.Branches, 1)

	// Wait for expiration
	time.Sleep(70 * time.Millisecond)

	result, ok = cache.Get("key")
	require.False(t, ok)
	require.Nil(t, result)
}

func TestBranchCache_Invalidate(t *testing.T) {
	cache := NewBranchCache(5 * time.Minute)
	defer cache.Close()

	data := &git.BranchListResult{
		Branches: []git.BranchInfo{{Name: "main"}},
	}
	cache.Set("key1", data)

	_, ok := cache.Get("key1")
	require.True(t, ok)

	cache.Invalidate("key1")

	_, ok = cache.Get("key1")
	require.False(t, ok)
}

func TestBranchCache_InvalidateRepo(t *testing.T) {
	cache := NewBranchCache(5 * time.Minute)
	defer cache.Close()

	data := &git.BranchListResult{
		Branches: []git.BranchInfo{{Name: "main"}},
	}

	// Set entries for two different repos
	cache.Set("/path/to/repo:local:false:", data)
	cache.Set("/path/to/repo:remote:true:", data)
	cache.Set("/other/repo:local:false:", data)

	// Invalidate only /path/to/repo
	cache.InvalidateRepo("/path/to/repo")

	// Repo entries should be gone
	_, ok := cache.Get("/path/to/repo:local:false:")
	require.False(t, ok)
	_, ok = cache.Get("/path/to/repo:remote:true:")
	require.False(t, ok)

	// Other repo should still exist
	_, ok = cache.Get("/other/repo:local:false:")
	require.True(t, ok)
}

func TestBranchCache_Close(t *testing.T) {
	cache := NewBranchCache(5 * time.Minute)

	// Close should not panic
	cache.Close()

	// Double close should not panic
	cache.Close()

	// Cache is still usable after close (just no background cleanup)
	data := &git.BranchListResult{
		Branches: []git.BranchInfo{{Name: "main"}},
	}
	cache.Set("key", data)
	result, ok := cache.Get("key")
	require.True(t, ok)
	require.Equal(t, "main", result.Branches[0].Name)
}

func TestBranchCache_ConcurrentAccess(t *testing.T) {
	cache := NewBranchCache(5 * time.Minute)
	defer cache.Close()

	var wg sync.WaitGroup
	const n = 100

	for i := 0; i < n; i++ {
		wg.Add(2)
		key := "key-" + string(rune('a'+i%26))

		go func(k string) {
			defer wg.Done()
			cache.Set(k, &git.BranchListResult{
				Branches: []git.BranchInfo{{Name: k}},
			})
		}(key)

		go func(k string) {
			defer wg.Done()
			cache.Get(k)
		}(key)
	}

	wg.Wait()
	// Should not panic
}
func TestExtractRootPath(t *testing.T) {
	tests := []struct {
		key      string
		wantPath string
		wantOK   bool
	}{
		{"repo:/Users/me/project:depth:1", "/Users/me/project", true},
		{"session:/Users/me/worktree:depth:10", "/Users/me/worktree", true},
		{"repo:/path/with:colons:depth:3", "/path/with:colons", true},
		{"unknown:/foo:depth:1", "", false},
		{"invalid-key", "", false},
		{"", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.key, func(t *testing.T) {
			path, ok := extractRootPath(tt.key)
			assert.Equal(t, tt.wantOK, ok)
			assert.Equal(t, tt.wantPath, path)
		})
	}
}
func TestDirCacheWatcherRefCounting(t *testing.T) {
	dir := t.TempDir()

	calls := 0
	w, err := newDirCacheWatcher(func(string) { calls++ }, 50*time.Millisecond)
	require.NoError(t, err)
	defer w.close()

	// First add creates the watch
	require.NoError(t, w.addWatch(dir))
	assert.Equal(t, 1, w.watches[dir])

	// Second add increments refcount
	require.NoError(t, w.addWatch(dir))
	assert.Equal(t, 2, w.watches[dir])

	// First remove decrements but keeps watch
	w.removeWatch(dir)
	assert.Equal(t, 1, w.watches[dir])

	// Second remove actually removes the watch
	w.removeWatch(dir)
	_, exists := w.watches[dir]
	assert.False(t, exists)
}

func TestDirCacheWatcherInvalidatesOnChange(t *testing.T) {
	dir := t.TempDir()

	invalidated := make(chan string, 10)
	w, err := newDirCacheWatcher(func(path string) {
		invalidated <- path
	}, 50*time.Millisecond)
	require.NoError(t, err)
	defer w.close()

	require.NoError(t, w.addWatch(dir))

	// Create a file in the watched directory
	err = os.WriteFile(filepath.Join(dir, "test.txt"), []byte("hello"), 0644)
	require.NoError(t, err)

	// Should receive invalidation within a reasonable time
	select {
	case path := <-invalidated:
		assert.Equal(t, dir, path)
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for cache invalidation")
	}
}

func TestDirCacheWatcherDebounce(t *testing.T) {
	dir := t.TempDir()

	var mu sync.Mutex
	invalidations := 0
	w, err := newDirCacheWatcher(func(string) {
		mu.Lock()
		invalidations++
		mu.Unlock()
	}, 100*time.Millisecond)
	require.NoError(t, err)
	defer w.close()

	require.NoError(t, w.addWatch(dir))

	// Rapidly create multiple files
	for i := 0; i < 5; i++ {
		err = os.WriteFile(filepath.Join(dir, fmt.Sprintf("file%d.txt", i)), []byte("data"), 0644)
		require.NoError(t, err)
	}

	// Wait for debounce to flush
	time.Sleep(300 * time.Millisecond)

	mu.Lock()
	count := invalidations
	mu.Unlock()

	// Should have been debounced to a small number of invalidations (ideally 1)
	assert.LessOrEqual(t, count, 3, "expected debouncing to reduce invalidation count")
	assert.GreaterOrEqual(t, count, 1, "expected at least one invalidation")
}

func TestDirListingCacheWithWatcher(t *testing.T) {
	dir := t.TempDir()

	cache := NewDirListingCache(5 * time.Minute)
	defer cache.Close()

	// Watcher should be active
	require.NotNil(t, cache.watcher)

	// Set a cache entry for this directory
	key := fmt.Sprintf("repo:%s:depth:1", dir)
	cache.Set(key, []*FileNode{{Name: "old.txt"}})

	// Verify it's cached
	data, ok := cache.Get(key)
	require.True(t, ok)
	assert.Len(t, data, 1)

	// Create a file to trigger invalidation
	err := os.WriteFile(filepath.Join(dir, "new.txt"), []byte("hello"), 0644)
	require.NoError(t, err)

	// Wait for debounce + processing
	time.Sleep(500 * time.Millisecond)

	// Cache entry should be invalidated
	_, ok = cache.Get(key)
	assert.False(t, ok, "expected cache entry to be invalidated after filesystem change")
}
// Helper: stringPtr
// ============================================================================

func stringPtr(s string) *string { return &s }
