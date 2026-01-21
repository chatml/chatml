package server

import (
	"os"
	"strings"
	"sync"
)

// SessionNameCache provides an in-memory cache for existing session directory names.
// It eliminates the need for filesystem scans on every session creation by maintaining
// a synchronized map of lowercase session names.
//
// Thread-safety: All methods are safe for concurrent use.
// Initialization: Lazy-loaded from filesystem on first GetAll() call.
// Invalidation: Automatic via Add() and Remove() methods.
//
// Staleness: This cache may become stale if sessions are created or deleted externally
// (outside this process). The session creation logic handles this gracefully via retry
// loops that detect ErrDirectoryExists collisions and update the cache accordingly.
// For most use cases, this eventual consistency is acceptable since the cache is primarily
// an optimization to avoid filesystem scans, not a source of truth.
type SessionNameCache struct {
	mu            sync.RWMutex
	names         map[string]bool // lowercase name -> exists
	initialized   bool
	workspacesDir string
}

// NewSessionNameCache creates a new cache instance for the given workspaces directory.
// The cache is not initialized until the first call to GetAll().
func NewSessionNameCache(workspacesDir string) *SessionNameCache {
	return &SessionNameCache{
		names:         make(map[string]bool),
		workspacesDir: workspacesDir,
	}
}

// Initialize loads existing session directory names from the filesystem.
// This is called automatically by GetAll() if the cache is not initialized.
// Returns any error from reading the directory.
func (c *SessionNameCache) Initialize() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.initialized {
		return nil
	}

	entries, err := os.ReadDir(c.workspacesDir)
	if err != nil {
		if os.IsNotExist(err) {
			// Directory doesn't exist yet - that's fine, start with empty cache
			c.initialized = true
			return nil
		}
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() {
			c.names[strings.ToLower(entry.Name())] = true
		}
	}

	c.initialized = true
	return nil
}

// Add registers a session name in the cache (case-insensitive).
// Call this after successfully creating a session directory.
func (c *SessionNameCache) Add(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.names[strings.ToLower(name)] = true
}

// Remove unregisters a session name from the cache (case-insensitive).
// Call this after successfully deleting a session directory.
func (c *SessionNameCache) Remove(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.names, strings.ToLower(name))
}

// Contains checks if a session name exists in the cache (case-insensitive).
func (c *SessionNameCache) Contains(name string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.names[strings.ToLower(name)]
}

// GetAll returns all cached session names.
// Initializes the cache from filesystem on first call.
// Returns the list of names and any initialization error.
func (c *SessionNameCache) GetAll() ([]string, error) {
	c.mu.RLock()
	initialized := c.initialized
	c.mu.RUnlock()

	if !initialized {
		if err := c.Initialize(); err != nil {
			return nil, err
		}
	}

	c.mu.RLock()
	defer c.mu.RUnlock()

	result := make([]string, 0, len(c.names))
	for name := range c.names {
		result = append(result, name)
	}
	return result, nil
}
