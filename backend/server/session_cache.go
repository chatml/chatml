package server

import (
	"os"
	"strings"
	"sync"
	"time"
)

const defaultSessionCacheTTL = 5 * time.Minute

// SessionNameCache provides an in-memory cache for existing session directory names.
// It eliminates the need for filesystem scans on every session creation by maintaining
// a synchronized map of lowercase session names.
//
// Thread-safety: All methods are safe for concurrent use.
// Initialization: Lazy-loaded from filesystem on first GetAll() call.
// Invalidation: Automatic via Add() and Remove() methods.
// TTL: The cache re-reads the filesystem after the TTL expires to pick up
// external changes (sessions created/deleted outside this process).
type SessionNameCache struct {
	mu              sync.RWMutex
	names           map[string]bool // lowercase name -> exists
	initialized     bool
	lastInitialized time.Time
	ttl             time.Duration
	workspacesDir   string
}

// NewSessionNameCache creates a new cache instance for the given workspaces directory.
// The cache is not initialized until the first call to GetAll().
func NewSessionNameCache(workspacesDir string) *SessionNameCache {
	return &SessionNameCache{
		names:         make(map[string]bool),
		ttl:           defaultSessionCacheTTL,
		workspacesDir: workspacesDir,
	}
}

// initialize loads existing session directory names from the filesystem.
// Must be called with c.mu held for writing.
func (c *SessionNameCache) initialize() error {
	entries, err := os.ReadDir(c.workspacesDir)
	if err != nil {
		if os.IsNotExist(err) {
			// Directory doesn't exist yet - that's fine, start with empty cache
			c.names = make(map[string]bool)
			c.initialized = true
			c.lastInitialized = time.Now()
			return nil
		}
		return err
	}

	fresh := make(map[string]bool, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			fresh[strings.ToLower(entry.Name())] = true
		}
	}

	c.names = fresh
	c.initialized = true
	c.lastInitialized = time.Now()
	return nil
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

	return c.initialize()
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
// Does not trigger a TTL refresh; call GetAll() first to ensure freshness.
func (c *SessionNameCache) Contains(name string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.names[strings.ToLower(name)]
}

// GetAll returns all cached session names.
// Initializes the cache from filesystem on first call and refreshes it
// when the TTL has expired to pick up external changes.
// Returns the list of names and any initialization error.
func (c *SessionNameCache) GetAll() ([]string, error) {
	c.mu.RLock()
	// Zero lastInitialized means never initialized, not expired.
	expired := !c.lastInitialized.IsZero() && time.Since(c.lastInitialized) > c.ttl
	needsRefresh := !c.initialized || expired
	c.mu.RUnlock()

	if needsRefresh {
		c.mu.Lock()
		// Double-check after acquiring write lock
		expired = !c.lastInitialized.IsZero() && time.Since(c.lastInitialized) > c.ttl
		if !c.initialized || expired {
			if err := c.initialize(); err != nil {
				c.mu.Unlock()
				return nil, err
			}
		}
		c.mu.Unlock()
	}

	c.mu.RLock()
	defer c.mu.RUnlock()

	result := make([]string, 0, len(c.names))
	for name := range c.names {
		result = append(result, name)
	}
	return result, nil
}
