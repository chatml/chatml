package github

import (
	"strings"
	"sync"
	"time"
)

// AvatarEntry holds cached avatar data for an email
type AvatarEntry struct {
	AvatarURL string
	NotFound  bool // true if we looked up and found no matching user
	CachedAt  time.Time
	ExpiresAt time.Time
}

// AvatarCache provides time-based caching for GitHub avatar URLs by email
type AvatarCache struct {
	mu      sync.RWMutex
	entries map[string]*AvatarEntry
	ttl     time.Duration
}

// NewAvatarCache creates a new avatar cache with the given TTL
func NewAvatarCache(ttl time.Duration) *AvatarCache {
	cache := &AvatarCache{
		entries: make(map[string]*AvatarEntry),
		ttl:     ttl,
	}

	// Start cleanup goroutine
	go cache.cleanupLoop()

	return cache
}

// normalizeEmail lowercases and trims email for consistent cache keys
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// Get retrieves cached avatar URL for an email
// Returns (avatarURL, notFound, found)
// - found=false means not in cache
// - found=true, notFound=true means we know there's no GitHub user for this email
// - found=true, notFound=false means we have a valid avatar URL
func (c *AvatarCache) Get(email string) (avatarURL string, notFound bool, found bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	key := normalizeEmail(email)
	entry, ok := c.entries[key]
	if !ok {
		return "", false, false
	}

	// Check if expired
	if time.Now().After(entry.ExpiresAt) {
		return "", false, false
	}

	return entry.AvatarURL, entry.NotFound, true
}

// Set stores an avatar URL in the cache
func (c *AvatarCache) Set(email string, avatarURL string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := normalizeEmail(email)
	now := time.Now()

	c.entries[key] = &AvatarEntry{
		AvatarURL: avatarURL,
		NotFound:  false,
		CachedAt:  now,
		ExpiresAt: now.Add(c.ttl),
	}
}

// SetNotFound marks an email as having no GitHub user
func (c *AvatarCache) SetNotFound(email string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := normalizeEmail(email)
	now := time.Now()

	c.entries[key] = &AvatarEntry{
		AvatarURL: "",
		NotFound:  true,
		CachedAt:  now,
		ExpiresAt: now.Add(c.ttl),
	}
}

// GetMultiple retrieves cached avatars for multiple emails
// Returns a map of email -> avatarURL for found entries (including not-found markers)
// and a slice of emails that need to be looked up
func (c *AvatarCache) GetMultiple(emails []string) (cached map[string]string, needLookup []string) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	cached = make(map[string]string)
	now := time.Now()

	for _, email := range emails {
		key := normalizeEmail(email)
		entry, ok := c.entries[key]
		if !ok || now.After(entry.ExpiresAt) {
			needLookup = append(needLookup, email)
			continue
		}
		// Include both found avatars and "not found" markers (empty string)
		cached[email] = entry.AvatarURL
	}

	return cached, needLookup
}

// Clear removes all cache entries
func (c *AvatarCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = make(map[string]*AvatarEntry)
}

// cleanupLoop periodically removes expired entries
func (c *AvatarCache) cleanupLoop() {
	ticker := time.NewTicker(c.ttl)
	defer ticker.Stop()

	for range ticker.C {
		c.cleanup()
	}
}

// cleanup removes expired entries
func (c *AvatarCache) cleanup() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	for key, entry := range c.entries {
		if now.After(entry.ExpiresAt) {
			delete(c.entries, key)
		}
	}
}

// Stats returns cache statistics
func (c *AvatarCache) Stats() (total int, notFound int, expired int) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	now := time.Now()
	total = len(c.entries)
	for _, entry := range c.entries {
		if now.After(entry.ExpiresAt) {
			expired++
		} else if entry.NotFound {
			notFound++
		}
	}
	return total, notFound, expired
}
