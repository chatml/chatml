package server

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
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
