package server

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestSessionNameCache_AddAndContains(t *testing.T) {
	cache := NewSessionNameCache("")
	cache.initialized = true // Skip filesystem initialization

	cache.Add("Tokyo")
	cache.Add("Osaka")

	if !cache.Contains("tokyo") {
		t.Error("Expected cache to contain 'tokyo' (case-insensitive)")
	}
	if !cache.Contains("TOKYO") {
		t.Error("Expected cache to contain 'TOKYO' (case-insensitive)")
	}
	if !cache.Contains("osaka") {
		t.Error("Expected cache to contain 'osaka'")
	}
	if cache.Contains("kyoto") {
		t.Error("Did not expect cache to contain 'kyoto'")
	}
}

func TestSessionNameCache_Remove(t *testing.T) {
	cache := NewSessionNameCache("")
	cache.initialized = true

	cache.Add("Tokyo")
	cache.Add("Osaka")

	cache.Remove("TOKYO") // Case-insensitive remove

	if cache.Contains("tokyo") {
		t.Error("Did not expect cache to contain 'tokyo' after removal")
	}
	if !cache.Contains("osaka") {
		t.Error("Expected cache to still contain 'osaka'")
	}
}

func TestSessionNameCache_GetAll(t *testing.T) {
	cache := NewSessionNameCache("")
	cache.initialized = true

	cache.Add("Tokyo")
	cache.Add("Osaka")
	cache.Add("Kyoto")

	names, err := cache.GetAll()
	if err != nil {
		t.Fatalf("GetAll returned error: %v", err)
	}

	if len(names) != 3 {
		t.Errorf("Expected 3 names, got %d", len(names))
	}

	// Names are stored in lowercase
	nameMap := make(map[string]bool)
	for _, name := range names {
		nameMap[name] = true
	}

	if !nameMap["tokyo"] {
		t.Error("Expected 'tokyo' in GetAll result")
	}
	if !nameMap["osaka"] {
		t.Error("Expected 'osaka' in GetAll result")
	}
	if !nameMap["kyoto"] {
		t.Error("Expected 'kyoto' in GetAll result")
	}
}

func TestSessionNameCache_InitializeFromFilesystem(t *testing.T) {
	// Create temp directory with some session directories
	tempDir := t.TempDir()

	// Create some directories
	os.Mkdir(filepath.Join(tempDir, "tokyo"), 0755)
	os.Mkdir(filepath.Join(tempDir, "osaka"), 0755)
	// Create a file (should be ignored)
	os.WriteFile(filepath.Join(tempDir, "not-a-session.txt"), []byte("test"), 0644)

	cache := NewSessionNameCache(tempDir)

	names, err := cache.GetAll()
	if err != nil {
		t.Fatalf("GetAll returned error: %v", err)
	}

	if len(names) != 2 {
		t.Errorf("Expected 2 names (directories only), got %d", len(names))
	}

	if !cache.Contains("tokyo") {
		t.Error("Expected cache to contain 'tokyo'")
	}
	if !cache.Contains("osaka") {
		t.Error("Expected cache to contain 'osaka'")
	}
}

func TestSessionNameCache_InitializeNonExistentDir(t *testing.T) {
	cache := NewSessionNameCache("/nonexistent/path/to/workspaces")

	names, err := cache.GetAll()
	if err != nil {
		t.Fatalf("GetAll should not return error for nonexistent dir: %v", err)
	}

	if len(names) != 0 {
		t.Errorf("Expected empty names list, got %d", len(names))
	}
}

func TestSessionNameCache_ConcurrentAccess(t *testing.T) {
	cache := NewSessionNameCache("")
	cache.initialized = true

	var wg sync.WaitGroup
	numGoroutines := 100

	// Concurrent adds
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			cache.Add("session-" + string(rune('a'+n%26)))
		}(i)
	}

	// Concurrent reads
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			cache.Contains("session-" + string(rune('a'+n%26)))
			cache.GetAll()
		}(i)
	}

	// Concurrent removes
	for i := 0; i < numGoroutines/2; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			cache.Remove("session-" + string(rune('a'+n%26)))
		}(i)
	}

	wg.Wait()

	// Should not panic or deadlock
}

func TestSessionNameCache_TTL_DefaultValue(t *testing.T) {
	cache := NewSessionNameCache("")
	if cache.ttl != 5*time.Minute {
		t.Errorf("Expected default TTL of 5m, got %v", cache.ttl)
	}
}

func TestSessionNameCache_TTL_RefreshesAfterExpiry(t *testing.T) {
	tempDir := t.TempDir()

	// Start with two directories
	os.Mkdir(filepath.Join(tempDir, "tokyo"), 0755)
	os.Mkdir(filepath.Join(tempDir, "osaka"), 0755)

	cache := NewSessionNameCache(tempDir)
	cache.ttl = 10 * time.Millisecond // Short TTL for testing

	// First call initializes from filesystem
	names, err := cache.GetAll()
	if err != nil {
		t.Fatalf("GetAll returned error: %v", err)
	}
	if len(names) != 2 {
		t.Fatalf("Expected 2 names, got %d", len(names))
	}

	// Add a directory externally (simulating out-of-process creation)
	os.Mkdir(filepath.Join(tempDir, "kyoto"), 0755)

	// Before TTL expires, cache should still return 2
	names, err = cache.GetAll()
	if err != nil {
		t.Fatalf("GetAll returned error: %v", err)
	}
	if len(names) != 2 {
		t.Errorf("Expected 2 names before TTL expiry, got %d", len(names))
	}

	// Wait for TTL to expire
	time.Sleep(15 * time.Millisecond)

	// After TTL expires, cache should refresh and pick up the new directory
	names, err = cache.GetAll()
	if err != nil {
		t.Fatalf("GetAll returned error: %v", err)
	}
	if len(names) != 3 {
		t.Errorf("Expected 3 names after TTL expiry, got %d", len(names))
	}
	if !cache.Contains("kyoto") {
		t.Error("Expected cache to contain 'kyoto' after TTL refresh")
	}
}

func TestSessionNameCache_TTL_PicksUpDeletions(t *testing.T) {
	tempDir := t.TempDir()

	os.Mkdir(filepath.Join(tempDir, "tokyo"), 0755)
	os.Mkdir(filepath.Join(tempDir, "osaka"), 0755)

	cache := NewSessionNameCache(tempDir)
	cache.ttl = 10 * time.Millisecond

	// Initialize
	names, err := cache.GetAll()
	if err != nil {
		t.Fatalf("GetAll returned error: %v", err)
	}
	if len(names) != 2 {
		t.Fatalf("Expected 2 names, got %d", len(names))
	}

	// Delete a directory externally
	os.Remove(filepath.Join(tempDir, "tokyo"))

	// Wait for TTL to expire
	time.Sleep(15 * time.Millisecond)

	// Cache should refresh and reflect the deletion
	names, err = cache.GetAll()
	if err != nil {
		t.Fatalf("GetAll returned error: %v", err)
	}
	if len(names) != 1 {
		t.Errorf("Expected 1 name after TTL refresh with deletion, got %d", len(names))
	}
	if cache.Contains("tokyo") {
		t.Error("Did not expect cache to contain 'tokyo' after external deletion and TTL refresh")
	}
	if !cache.Contains("osaka") {
		t.Error("Expected cache to still contain 'osaka'")
	}
}

func TestSessionNameCache_TTL_ManualAddSurvivesBeforeTTL(t *testing.T) {
	cache := NewSessionNameCache("")
	cache.ttl = 10 * time.Minute // Long TTL

	// Initialize with nonexistent dir (empty cache)
	names, err := cache.GetAll()
	if err != nil {
		t.Fatalf("GetAll returned error: %v", err)
	}
	if len(names) != 0 {
		t.Fatalf("Expected 0 names, got %d", len(names))
	}

	// Manually add entries (simulating session creation via Add())
	cache.Add("tokyo")
	cache.Add("osaka")

	// Should still see them since TTL hasn't expired
	names, err = cache.GetAll()
	if err != nil {
		t.Fatalf("GetAll returned error: %v", err)
	}
	if len(names) != 2 {
		t.Errorf("Expected 2 names, got %d", len(names))
	}
}

func TestSessionNameCache_TTL_ConcurrentRefresh(t *testing.T) {
	tempDir := t.TempDir()
	os.Mkdir(filepath.Join(tempDir, "tokyo"), 0755)

	cache := NewSessionNameCache(tempDir)
	cache.ttl = 1 * time.Millisecond // Tiny TTL to force frequent refreshes

	// Initialize
	cache.GetAll()

	// Hammer GetAll from many goroutines while TTL is constantly expiring
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				_, err := cache.GetAll()
				if err != nil {
					t.Errorf("GetAll returned error: %v", err)
				}
				time.Sleep(time.Millisecond)
			}
		}()
	}
	wg.Wait()
	// Should not panic, deadlock, or return errors
}

func TestSessionNameCache_LastInitializedSet(t *testing.T) {
	tempDir := t.TempDir()
	cache := NewSessionNameCache(tempDir)

	if !cache.lastInitialized.IsZero() {
		t.Error("Expected lastInitialized to be zero before initialization")
	}

	before := time.Now()
	cache.GetAll()
	after := time.Now()

	cache.mu.RLock()
	li := cache.lastInitialized
	cache.mu.RUnlock()

	if li.Before(before) || li.After(after) {
		t.Errorf("Expected lastInitialized between %v and %v, got %v", before, after, li)
	}
}
