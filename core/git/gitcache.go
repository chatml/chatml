package git

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	// remoteURLTTL is how long cached remote URLs are valid.
	// Remote URLs almost never change, so a long TTL is safe.
	remoteURLTTL = 5 * time.Minute
)

// GitCache provides in-memory caching for git metadata that is expensive
// to compute via subprocess but cheap to read from files. All methods are
// safe for concurrent use.
type GitCache struct {
	mu sync.RWMutex

	// gitDirs caches resolved git directory paths. These never change for the
	// lifetime of a worktree, so entries are never invalidated.
	gitDirs map[string]string // repoPath → gitDir

	// commonDirs caches resolved common directory paths. Like gitDirs, these
	// are immutable for a worktree's lifetime.
	commonDirs map[string]string // gitDir → commonDir

	// remoteURLs caches remote URLs with a TTL.
	remoteURLs map[string]cachedString // "repoPath\x00remoteName" → URL

	// packedRefs caches parsed packed-refs files, invalidated by mtime.
	packedRefs map[string]*packedRefsEntry // commonDir → parsed refs

	// upstreamRefs caches branch upstream tracking refs. These are set once
	// (on first push) and never change for the branch's lifetime, so entries
	// are never expired — only cleared on Invalidate.
	upstreamRefs map[string]string // "repoPath\x00branch" → upstream (e.g., "origin/main")
}

type cachedString struct {
	value     string
	expiresAt time.Time
}

type packedRefsEntry struct {
	mtime time.Time
	refs  map[string]string // refName → SHA
}

// NewGitCache creates a new GitCache instance.
func NewGitCache() *GitCache {
	return &GitCache{
		gitDirs:      make(map[string]string),
		commonDirs:   make(map[string]string),
		remoteURLs:   make(map[string]cachedString),
		packedRefs:   make(map[string]*packedRefsEntry),
		upstreamRefs: make(map[string]string),
	}
}

// GetGitDir returns the cached git directory for a repo path, resolving it on first access.
func (c *GitCache) GetGitDir(repoPath string) (string, error) {
	c.mu.RLock()
	if dir, ok := c.gitDirs[repoPath]; ok {
		c.mu.RUnlock()
		return dir, nil
	}
	c.mu.RUnlock()

	dir, err := ResolveGitDir(repoPath)
	if err != nil {
		return "", err
	}

	c.mu.Lock()
	c.gitDirs[repoPath] = dir
	c.mu.Unlock()
	return dir, nil
}

// GetCommonDir returns the cached common directory for a git directory.
func (c *GitCache) GetCommonDir(gitDir string) string {
	c.mu.RLock()
	if dir, ok := c.commonDirs[gitDir]; ok {
		c.mu.RUnlock()
		return dir
	}
	c.mu.RUnlock()

	dir := resolveCommonDir(gitDir)

	c.mu.Lock()
	c.commonDirs[gitDir] = dir
	c.mu.Unlock()
	return dir
}

// GetRemoteURL returns the cached remote URL, refreshing if expired.
func (c *GitCache) GetRemoteURL(repoPath, remoteName string) (string, error) {
	key := repoPath + "\x00" + remoteName

	c.mu.RLock()
	if cached, ok := c.remoteURLs[key]; ok && time.Now().Before(cached.expiresAt) {
		c.mu.RUnlock()
		return cached.value, nil
	}
	c.mu.RUnlock()

	url, err := readRemoteURL(repoPath, remoteName)
	if err != nil {
		return "", err
	}

	c.mu.Lock()
	c.remoteURLs[key] = cachedString{
		value:     url,
		expiresAt: time.Now().Add(remoteURLTTL),
	}
	c.mu.Unlock()
	return url, nil
}

// GetUpstreamRef returns the cached upstream tracking ref for a branch.
// Upstream refs are immutable for a branch's lifetime, so no TTL is needed.
func (c *GitCache) GetUpstreamRef(repoPath, branch string) (string, error) {
	key := repoPath + "\x00" + branch

	c.mu.RLock()
	if ref, ok := c.upstreamRefs[key]; ok {
		c.mu.RUnlock()
		return ref, nil
	}
	c.mu.RUnlock()

	ref, err := readUpstreamRef(repoPath, branch)
	if err != nil {
		return "", err
	}

	c.mu.Lock()
	c.upstreamRefs[key] = ref
	c.mu.Unlock()
	return ref, nil
}

// LookupPackedRef looks up a ref in the packed-refs file, using a cached parse
// that is invalidated when the file's mtime changes.
func (c *GitCache) LookupPackedRef(commonDir, refName string) (string, error) {
	packedRefsPath := filepath.Join(commonDir, "packed-refs")
	info, err := os.Stat(packedRefsPath)
	if err != nil {
		return "", err
	}
	mtime := info.ModTime()

	c.mu.RLock()
	if entry, ok := c.packedRefs[commonDir]; ok && entry.mtime.Equal(mtime) {
		sha, found := entry.refs[refName]
		c.mu.RUnlock()
		if found {
			return sha, nil
		}
		return "", fmt.Errorf("ref %s not found in packed-refs", refName)
	}
	c.mu.RUnlock()

	// Parse the entire packed-refs file
	refs, err := parsePackedRefs(packedRefsPath)
	if err != nil {
		return "", err
	}

	c.mu.Lock()
	c.packedRefs[commonDir] = &packedRefsEntry{
		mtime: mtime,
		refs:  refs,
	}
	c.mu.Unlock()

	if sha, ok := refs[refName]; ok {
		return sha, nil
	}
	return "", fmt.Errorf("ref %s not found in packed-refs", refName)
}

// parsePackedRefs parses a packed-refs file into a map of refName → SHA.
func parsePackedRefs(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	refs := make(map[string]string)
	for _, line := range splitLines(string(data)) {
		if len(line) == 0 || line[0] == '#' || line[0] == '^' {
			continue
		}
		// Assumes SHA-1 (40 hex chars); SHA-256 repos are unsupported.
		if len(line) > 41 && line[40] == ' ' {
			refs[line[41:]] = line[:40]
		}
	}

	return refs, nil
}

// splitLines splits a string by newlines, handling both \n and \r\n.
func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			line := s[start:i]
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			lines = append(lines, line)
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

// Invalidate removes all cached data for a specific repo path.
// Call this when a worktree is removed.
func (c *GitCache) Invalidate(repoPath string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	gitDir := c.gitDirs[repoPath]
	delete(c.gitDirs, repoPath)

	if gitDir != "" {
		commonDir := c.commonDirs[gitDir]
		delete(c.commonDirs, gitDir)
		if commonDir != "" {
			delete(c.packedRefs, commonDir)
		}
	}

	prefix := repoPath + "\x00"
	for key := range c.remoteURLs {
		if strings.HasPrefix(key, prefix) {
			delete(c.remoteURLs, key)
		}
	}
	for key := range c.upstreamRefs {
		if strings.HasPrefix(key, prefix) {
			delete(c.upstreamRefs, key)
		}
	}
}
