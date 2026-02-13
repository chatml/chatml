package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/ai"
	"github.com/chatml/chatml-backend/crypto"
	"github.com/chatml/chatml-backend/branch"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/naming"
	"github.com/chatml/chatml-backend/scripts"
	"github.com/chatml/chatml-backend/store"
	"github.com/fsnotify/fsnotify"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// SessionLockManager provides per-path mutex locks to serialize operations on the same session.
// This prevents race conditions when deleting and recreating sessions with the same name.
// Uses reference counting to clean up unused locks and prevent memory leaks.
type SessionLockManager struct {
	mu    sync.Mutex
	locks map[string]*lockEntry
}

type lockEntry struct {
	mu       *sync.Mutex
	refCount int
}

func NewSessionLockManager() *SessionLockManager {
	return &SessionLockManager{
		locks: make(map[string]*lockEntry),
	}
}

// Lock acquires a mutex for the given path. Creates the mutex if it doesn't exist.
// Increments the reference count to track active users of the lock.
func (m *SessionLockManager) Lock(path string) {
	m.mu.Lock()
	entry, ok := m.locks[path]
	if !ok {
		entry = &lockEntry{mu: &sync.Mutex{}, refCount: 0}
		m.locks[path] = entry
	}
	entry.refCount++
	m.mu.Unlock()
	entry.mu.Lock()
}

// Unlock releases the mutex for the given path and decrements the reference count.
// When reference count reaches zero, the lock entry is removed from the map.
func (m *SessionLockManager) Unlock(path string) {
	m.mu.Lock()
	entry, ok := m.locks[path]
	if !ok {
		m.mu.Unlock()
		logger.Handlers.Warnf("SessionLockManager: attempted to unlock non-existent path: %s", path)
		return
	}
	entry.refCount--
	if entry.refCount == 0 {
		delete(m.locks, path)
	}
	m.mu.Unlock()
	entry.mu.Unlock()
}

// BranchCache provides TTL-based caching for branch listing operations.
// This reduces git operations for frequently accessed branch lists.
type BranchCache struct {
	mu      sync.RWMutex
	entries map[string]*branchCacheEntry
	ttl     time.Duration
	done    chan struct{}
}

type branchCacheEntry struct {
	data      *git.BranchListResult
	expiresAt time.Time
}

// NewBranchCache creates a new branch cache with the given TTL
func NewBranchCache(ttl time.Duration) *BranchCache {
	c := &BranchCache{
		entries: make(map[string]*branchCacheEntry),
		ttl:     ttl,
		done:    make(chan struct{}),
	}
	go c.cleanupLoop()
	return c
}

// Get retrieves a cached branch list by key
func (c *BranchCache) Get(key string) (*git.BranchListResult, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[key]
	if !ok {
		return nil, false
	}

	if time.Now().After(entry.expiresAt) {
		return nil, false
	}

	return entry.data, true
}

// Set stores a branch list in the cache
func (c *BranchCache) Set(key string, data *git.BranchListResult) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries[key] = &branchCacheEntry{
		data:      data,
		expiresAt: time.Now().Add(c.ttl),
	}
}

// Invalidate removes a specific cache entry
func (c *BranchCache) Invalidate(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, key)
}

// InvalidateRepo removes all cache entries for a repo path
func (c *BranchCache) InvalidateRepo(repoPath string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	for key := range c.entries {
		if strings.HasPrefix(key, repoPath+":") {
			delete(c.entries, key)
		}
	}
}

// Close stops the cleanup goroutine. Safe to call multiple times.
func (c *BranchCache) Close() {
	select {
	case <-c.done:
	default:
		close(c.done)
	}
}

// cleanupLoop periodically removes expired branch cache entries
func (c *BranchCache) cleanupLoop() {
	ticker := time.NewTicker(c.ttl)
	defer ticker.Stop()

	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
			c.mu.Lock()
			now := time.Now()
			for key, entry := range c.entries {
				if now.After(entry.expiresAt) {
					delete(c.entries, key)
				}
			}
			c.mu.Unlock()
		}
	}
}

// dirCacheWatcher uses fsnotify to watch directories and immediately invalidate
// cache entries when filesystem changes are detected, rather than waiting for TTL.
type dirCacheWatcher struct {
	fsw              *fsnotify.Watcher
	mu               sync.Mutex
	watches          map[string]int            // path -> reference count
	pendingPaths     map[string]struct{}        // paths awaiting debounced invalidation
	debounceTimer    *time.Timer
	debounceDuration time.Duration
	invalidateFunc   func(string)               // callback to DirListingCache.InvalidatePath
	ctx              context.Context
	cancel           context.CancelFunc
}

func newDirCacheWatcher(invalidateFunc func(string), debounceDuration time.Duration) (*dirCacheWatcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("create fsnotify watcher: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	w := &dirCacheWatcher{
		fsw:              fsw,
		watches:          make(map[string]int),
		pendingPaths:     make(map[string]struct{}),
		debounceDuration: debounceDuration,
		invalidateFunc:   invalidateFunc,
		ctx:              ctx,
		cancel:           cancel,
	}
	go w.run()
	return w, nil
}

func (w *dirCacheWatcher) addWatch(path string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if count, exists := w.watches[path]; exists {
		w.watches[path] = count + 1
		return nil
	}

	if err := w.fsw.Add(path); err != nil {
		return fmt.Errorf("watch %s: %w", path, err)
	}

	w.watches[path] = 1
	logger.DirCache.Debugf("watching %s", path)
	return nil
}

func (w *dirCacheWatcher) removeWatch(path string) {
	w.mu.Lock()
	defer w.mu.Unlock()

	count, exists := w.watches[path]
	if !exists {
		return
	}

	if count > 1 {
		w.watches[path] = count - 1
		return
	}

	delete(w.watches, path)
	if err := w.fsw.Remove(path); err != nil {
		logger.DirCache.Debugf("remove watch %s: %v", path, err)
	} else {
		logger.DirCache.Debugf("unwatched %s", path)
	}
}

func (w *dirCacheWatcher) run() {
	for {
		select {
		case <-w.ctx.Done():
			return
		case event, ok := <-w.fsw.Events:
			if !ok {
				return
			}
			if event.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Remove|fsnotify.Rename) == 0 {
				continue
			}
			// The event path is inside one of the watched root dirs.
			// Find which watched root it belongs to and schedule invalidation.
			dir := filepath.Dir(event.Name)
			w.mu.Lock()
			for watchedPath := range w.watches {
				if dir == watchedPath || strings.HasPrefix(dir, watchedPath+string(filepath.Separator)) {
					w.pendingPaths[watchedPath] = struct{}{}
				}
			}
			w.scheduleFlush()
			w.mu.Unlock()

		case err, ok := <-w.fsw.Errors:
			if !ok {
				return
			}
			logger.DirCache.Warnf("fsnotify error: %v", err)
		}
	}
}

// scheduleFlush resets the debounce timer. Must be called with mu held.
func (w *dirCacheWatcher) scheduleFlush() {
	if w.debounceTimer != nil {
		w.debounceTimer.Stop()
	}
	w.debounceTimer = time.AfterFunc(w.debounceDuration, w.flush)
}

func (w *dirCacheWatcher) flush() {
	if w.ctx.Err() != nil {
		return
	}

	w.mu.Lock()
	paths := w.pendingPaths
	w.pendingPaths = make(map[string]struct{})
	w.mu.Unlock()

	for path := range paths {
		logger.DirCache.Debugf("invalidating cache for %s", path)
		w.invalidateFunc(path)
	}
}

func (w *dirCacheWatcher) close() {
	w.cancel()
	w.mu.Lock()
	if w.debounceTimer != nil {
		w.debounceTimer.Stop()
	}
	w.mu.Unlock()
	w.fsw.Close()
}

// extractRootPath extracts the filesystem path from a cache key.
// Keys are formatted as "repo:/path/to/dir:depth:N" or "session:/path/to/dir:depth:N".
func extractRootPath(cacheKey string) (string, bool) {
	parts := strings.SplitN(cacheKey, ":depth:", 2)
	if len(parts) != 2 {
		return "", false
	}
	pathPart := parts[0]
	if strings.HasPrefix(pathPart, "repo:") {
		return strings.TrimPrefix(pathPart, "repo:"), true
	}
	if strings.HasPrefix(pathPart, "session:") {
		return strings.TrimPrefix(pathPart, "session:"), true
	}
	return "", false
}

// DirListingCache provides TTL-based caching for directory listing operations
// with optional fsnotify-based immediate invalidation on filesystem changes.
type DirListingCache struct {
	mu      sync.RWMutex
	entries map[string]*dirCacheEntry
	ttl     time.Duration
	done    chan struct{}
	watcher *dirCacheWatcher
}

type dirCacheEntry struct {
	data      []*FileNode
	expiresAt time.Time
}

// NewDirListingCache creates a new directory listing cache with the given TTL.
// It also starts a filesystem watcher for immediate cache invalidation.
// If the watcher fails to initialize, the cache falls back to TTL-only mode.
func NewDirListingCache(ttl time.Duration) *DirListingCache {
	cache := &DirListingCache{
		entries: make(map[string]*dirCacheEntry),
		ttl:     ttl,
		done:    make(chan struct{}),
	}

	w, err := newDirCacheWatcher(cache.InvalidatePath, 100*time.Millisecond)
	if err != nil {
		logger.DirCache.Warnf("filesystem watcher unavailable, using TTL-only mode: %v", err)
	} else {
		cache.watcher = w
		logger.DirCache.Infof("filesystem watcher active (debounce=100ms)")
	}

	go cache.cleanupLoop()
	return cache
}

// Close stops the cleanup goroutine and filesystem watcher.
func (c *DirListingCache) Close() {
	close(c.done)
	if c.watcher != nil {
		c.watcher.close()
	}
}

// Get retrieves a cached directory listing by key
func (c *DirListingCache) Get(key string) ([]*FileNode, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[key]
	if !ok {
		return nil, false
	}

	if time.Now().After(entry.expiresAt) {
		return nil, false
	}

	return entry.data, true
}

// Set stores a directory listing in the cache and registers a filesystem watch
// on the root path for immediate invalidation.
func (c *DirListingCache) Set(key string, data []*FileNode) {
	c.mu.Lock()
	c.entries[key] = &dirCacheEntry{
		data:      data,
		expiresAt: time.Now().Add(c.ttl),
	}
	c.mu.Unlock()

	if c.watcher != nil {
		if rootPath, ok := extractRootPath(key); ok {
			if err := c.watcher.addWatch(rootPath); err != nil {
				logger.DirCache.Debugf("watch %s: %v", rootPath, err)
			}
		}
	}
}

// InvalidatePath removes all cache entries whose keys start with the given path prefix.
// This is used to invalidate cache when files are modified.
// Cache keys are formatted as "type:path:depth:N", so we check if the path portion
// starts with basePath to avoid over-invalidation of unrelated paths.
func (c *DirListingCache) InvalidatePath(basePath string) {
	c.mu.Lock()

	var removedPaths []string
	for key := range c.entries {
		// Extract path from cache key format "type:path:depth:N"
		// We need to check if the path portion starts with basePath
		if strings.HasPrefix(key, "repo:"+basePath) || strings.HasPrefix(key, "session:"+basePath) {
			delete(c.entries, key)
			if c.watcher != nil {
				if rootPath, ok := extractRootPath(key); ok {
					removedPaths = append(removedPaths, rootPath)
				}
			}
		}
	}
	c.mu.Unlock()

	for _, p := range removedPaths {
		c.watcher.removeWatch(p)
	}
}

// cleanupLoop periodically removes expired entries
func (c *DirListingCache) cleanupLoop() {
	// Use a minimum cleanup interval of 30 seconds to avoid excessive CPU usage
	// when TTL is configured to a very short duration (e.g., for testing)
	cleanupInterval := c.ttl
	if cleanupInterval < 30*time.Second {
		cleanupInterval = 30 * time.Second
	}
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.cleanup()
		case <-c.done:
			return
		}
	}
}

// cleanup removes expired entries
func (c *DirListingCache) cleanup() {
	c.mu.Lock()

	var removedPaths []string
	now := time.Now()
	for key, entry := range c.entries {
		if now.After(entry.expiresAt) {
			delete(c.entries, key)
			if c.watcher != nil {
				if rootPath, ok := extractRootPath(key); ok {
					removedPaths = append(removedPaths, rootPath)
				}
			}
		}
	}
	c.mu.Unlock()

	for _, p := range removedPaths {
		c.watcher.removeWatch(p)
	}
}

// Stats returns cache statistics (total entries, expired entries)
func (c *DirListingCache) Stats() (total int, expired int) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	now := time.Now()
	total = len(c.entries)
	for _, entry := range c.entries {
		if now.After(entry.expiresAt) {
			expired++
		}
	}
	return total, expired
}

type Handlers struct {
	store            *store.SQLiteStore
	repoManager      *git.RepoManager
	worktreeManager  *git.WorktreeManager
	agentManager     *agent.Manager
	sessionLocks     *SessionLockManager
	sessionNameCache *SessionNameCache
	fileSizeConfig   FileSizeConfig
	dirCache         *DirListingCache
	branchCache      *BranchCache
	branchWatcher    *branch.Watcher
	prWatcher        *branch.PRWatcher
	hub              *Hub // For broadcasting WebSocket events
	ghClient         *github.Client
	prCache          *github.PRCache
	issueCache       *github.IssueCache
	avatarCache      *github.AvatarCache
	statsCache       *SessionStatsCache
	aiClient         *ai.Client
	scriptRunner     *scripts.Runner
}

// writeJSON writes data as JSON response, logging any encoding errors
func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		// Log the error - response headers may already be sent
		logger.Handlers.Errorf("JSON encode error: %v", err)
	}
}

// writeJSONStatus writes data as JSON with a specific HTTP status code.
// Must be used instead of writeJSON when the status is not 200, because
// headers set after WriteHeader are silently ignored.
func writeJSONStatus(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		logger.Handlers.Errorf("JSON encode error: %v", err)
	}
}

// settingKeyWorkspacesBaseDir is the settings key for the workspaces base directory
const settingKeyWorkspacesBaseDir = "workspaces-base-dir"

// settingKeyEnvVars is the settings key for custom environment variables
const settingKeyEnvVars = "env-vars"

// settingKeyAnthropicAPIKey is the settings key for the encrypted Anthropic API key
const settingKeyAnthropicAPIKey = "anthropic-api-key"

// getWorkspacesBaseDir returns the configured workspaces base directory,
// falling back to the default (~/Library/Application Support/ChatML/workspaces) if not configured.
func (h *Handlers) getWorkspacesBaseDir(ctx context.Context) (string, error) {
	configured, _, err := h.store.GetSetting(ctx, settingKeyWorkspacesBaseDir)
	if err != nil {
		return "", fmt.Errorf("failed to read workspaces base dir setting: %w", err)
	}
	return git.WorkspacesBaseDirWithOverride(configured)
}

func NewHandlers(s *store.SQLiteStore, am *agent.Manager, dirCacheConfig DirListingCacheConfig, bw *branch.Watcher, prw *branch.PRWatcher, hub *Hub, ghClient *github.Client, prCache *github.PRCache, issueCache *github.IssueCache, statsCache *SessionStatsCache, aiClient *ai.Client, scriptRunner *scripts.Runner) *Handlers {
	// Initialize session name cache with workspaces directory
	// Cache initializes lazily on first use
	workspacesDir, err := git.WorkspacesBaseDir()
	if err != nil {
		logger.Handlers.Warnf("Failed to get workspaces base directory: %v (session name cache will be disabled)", err)
	}
	return &Handlers{
		store:            s,
		repoManager:      git.NewRepoManager(),
		worktreeManager:  git.NewWorktreeManager(),
		agentManager:     am,
		sessionLocks:     NewSessionLockManager(),
		sessionNameCache: NewSessionNameCache(workspacesDir),
		fileSizeConfig:   LoadFileSizeConfig(),
		dirCache:         NewDirListingCache(dirCacheConfig.TTL),
		branchCache:      NewBranchCache(5 * time.Minute), // Cache branches for 5 minutes
		branchWatcher:    bw,
		prWatcher:        prw,
		hub:              hub,
		ghClient:         ghClient,
		prCache:          prCache,
		issueCache:       issueCache,
		avatarCache:      github.NewAvatarCache(24 * time.Hour), // Cache avatars for 24 hours
		statsCache:       statsCache,
		aiClient:         aiClient,
		scriptRunner:     scriptRunner,
	}
}

// getSessionAndWorkspace fetches session and workspace data in a single query.
// Returns the session with embedded workspace info, the working path, and base ref.
// This helper eliminates the N+1 pattern of fetching session then workspace separately.
func (h *Handlers) getSessionAndWorkspace(ctx context.Context, sessionID string) (
	session *models.SessionWithWorkspace,
	workingPath string,
	baseRef string,
	err error,
) {
	session, err = h.store.GetSessionWithWorkspace(ctx, sessionID)
	if err != nil {
		return nil, "", "", err
	}
	if session == nil {
		return nil, "", "", nil
	}

	// Use worktree path if set, otherwise fall back to workspace path
	workingPath = session.WorktreePath
	if workingPath == "" {
		workingPath = session.WorkspacePath
	}

	// Use the session's effective target branch for diff calculations.
	// This respects the user's target branch selection (e.g., "origin/develop")
	// and falls back to "<remote>/<default-branch>" when not set.
	baseRef = session.EffectiveTargetBranch()

	return session, workingPath, baseRef, nil
}

// checkWorktreePath verifies that the given worktree path exists on disk.
// Returns true if the path is missing and a 410 response was written.
// Handlers should return early when this returns true.
func checkWorktreePath(w http.ResponseWriter, path string) bool {
	if path == "" {
		return false
	}
	if _, err := os.Stat(path); err != nil && os.IsNotExist(err) {
		writeWorktreeNotFound(w, path)
		return true
	}
	return false
}

// computeSessionStats calculates total additions/deletions for a session's worktree.
// Returns nil if the session has no worktree path or no changes.
func (h *Handlers) computeSessionStats(ctx context.Context, session *models.Session, workspaceBranch string) *models.SessionStats {
	workingPath := session.WorktreePath
	if workingPath == "" {
		return nil
	}

	// Determine base ref: prefer BaseCommitSHA, fall back to workspace branch, then "main"
	baseRef := session.BaseCommitSHA
	if baseRef == "" {
		baseRef = workspaceBranch
		if baseRef == "" {
			baseRef = "main"
		}
	}

	// Get tracked changes
	changes, err := h.repoManager.GetChangedFilesWithStats(ctx, workingPath, baseRef)
	if err != nil {
		// Silently return nil on error - stats are optional
		return nil
	}

	// Get untracked files
	untracked, _ := h.repoManager.GetUntrackedFiles(ctx, workingPath)

	// Sum up stats
	var additions, deletions int
	for _, c := range changes {
		additions += c.Additions
		deletions += c.Deletions
	}
	// Untracked files count as additions (new lines)
	for _, u := range untracked {
		additions += u.Additions
	}

	if additions == 0 && deletions == 0 {
		return nil
	}
	return &models.SessionStats{Additions: additions, Deletions: deletions}
}

// validatePath ensures the requested path stays within the base directory
// Returns the cleaned path if valid, or an error if the path escapes the base
func validatePath(basePath, requestedPath string) (string, error) {
	cleanPath := filepath.Clean(requestedPath)

	// Reject absolute paths
	if filepath.IsAbs(cleanPath) {
		return "", fmt.Errorf("absolute paths not allowed")
	}

	fullPath := filepath.Join(basePath, cleanPath)

	// Resolve symlinks to prevent symlink-based path traversal.
	// If the path doesn't exist yet, fall back to Abs-based check
	// (can't follow a symlink that doesn't exist).
	resolvedBase, errBase := filepath.EvalSymlinks(basePath)
	resolvedPath, errPath := filepath.EvalSymlinks(fullPath)

	if errBase != nil && !os.IsNotExist(errBase) {
		// Base directory exists but can't be resolved (e.g. permission error)
		return "", fmt.Errorf("failed to resolve base directory: %w", errBase)
	}

	if errBase == nil && errPath == nil {
		// Both paths exist — verify resolved path is under resolved base
		if !strings.HasPrefix(resolvedPath, resolvedBase+string(filepath.Separator)) && resolvedPath != resolvedBase {
			return "", fmt.Errorf("path escapes base directory")
		}
	} else if errBase == nil && errPath != nil && !os.IsNotExist(errPath) {
		// Path resolution failed for a reason other than "not found"
		return "", fmt.Errorf("failed to resolve path: %w", errPath)
	} else {
		// Fallback: use Abs-based check (path or base doesn't exist yet)
		absBase, err := filepath.Abs(basePath)
		if err != nil {
			return "", err
		}
		absPath, err := filepath.Abs(fullPath)
		if err != nil {
			return "", err
		}
		if !strings.HasPrefix(absPath, absBase+string(filepath.Separator)) && absPath != absBase {
			return "", fmt.Errorf("path escapes base directory")
		}
	}

	return cleanPath, nil
}

type AddRepoRequest struct {
	Path string `json:"path"`
}

func (h *Handlers) AddRepo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req AddRepoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if err := h.repoManager.ValidateRepo(req.Path); err != nil {
		writeValidationError(w, "invalid repository path")
		return
	}

	// Check if repo with same path already exists
	existing, err := h.store.GetRepoByPath(ctx, req.Path)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if existing != nil {
		writeConflict(w, "repository already added")
		return
	}

	branch, _ := h.repoManager.GetCurrentBranch(ctx, req.Path)

	repo := &models.Repo{
		ID:        uuid.New().String(),
		Name:      h.repoManager.GetRepoName(req.Path),
		Path:      req.Path,
		Branch:    branch,
		CreatedAt: time.Now(),
	}

	if err := h.store.AddRepo(ctx, repo); err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, repo)
}

func (h *Handlers) ListRepos(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repos, err := h.store.ListRepos(ctx)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, repos)
}

// ArchivedSessionDirJSON is the JSON representation of an archived session's directory info.
// Used by the frontend to register archived worktrees with the file watcher.
type ArchivedSessionDirJSON struct {
	DirName   string `json:"dirName"`
	SessionID string `json:"sessionId"`
}

// DashboardData represents the combined data for initial dashboard load
type DashboardData struct {
	Workspaces          []*models.Repo              `json:"workspaces"`
	Sessions            []*SessionWithConversations  `json:"sessions"`
	ArchivedSessionDirs []ArchivedSessionDirJSON     `json:"archivedSessionDirs"`
}

// SessionWithConversations embeds session data with its conversations
type SessionWithConversations struct {
	*models.Session
	Conversations []*models.Conversation `json:"conversations"`
}

// GetDashboardData returns all workspaces, sessions, and conversations in a single request.
// This eliminates the N+1 pattern of fetching sessions per workspace and conversations per session.
func (h *Handlers) GetDashboardData(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Fetch all repos in a single query
	repos, err := h.store.ListRepos(ctx)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Fetch archived session dirs for file watcher registration
	archivedDirs, err := h.store.ListArchivedSessionDirs(ctx)
	if err != nil {
		writeDBError(w, err)
		return
	}
	archivedSessionDirs := make([]ArchivedSessionDirJSON, 0, len(archivedDirs))
	for _, d := range archivedDirs {
		if d.WorktreePath != "" {
			archivedSessionDirs = append(archivedSessionDirs, ArchivedSessionDirJSON{
				DirName:   filepath.Base(d.WorktreePath),
				SessionID: d.ID,
			})
		}
	}

	// Fetch all sessions across all workspaces in a single query
	// Pass false to exclude archived sessions from dashboard data
	allSessions, err := h.store.ListAllSessions(ctx, false)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Early return if no sessions
	if len(allSessions) == 0 {
		writeJSON(w, DashboardData{
			Workspaces:          repos,
			Sessions:            []*SessionWithConversations{},
			ArchivedSessionDirs: archivedSessionDirs,
		})
		return
	}

	// Build workspace map for branch lookup
	workspaceByID := make(map[string]*models.Repo)
	for _, repo := range repos {
		workspaceByID[repo.ID] = repo
	}

	// Compute stats in parallel (bounded to 5 concurrent)
	// Only compute stats if cache is available
	if h.statsCache != nil {
		sem := make(chan struct{}, 5)
		var wg sync.WaitGroup
		var mu sync.Mutex

		for _, session := range allSessions {
			// Check cache first
			if cached, ok := h.statsCache.Get(session.ID); ok {
				session.Stats = cached
				continue
			}

			wg.Add(1)
			go func(s *models.Session) {
				defer wg.Done()
				sem <- struct{}{}        // Acquire
				defer func() { <-sem }() // Release

				workspace := workspaceByID[s.WorkspaceID]
				workspaceBranch := ""
				if workspace != nil {
					workspaceBranch = workspace.Branch
				}

				stats := h.computeSessionStats(ctx, s, workspaceBranch)

				mu.Lock()
				s.Stats = stats
				mu.Unlock()

				h.statsCache.Set(s.ID, stats)
			}(session)
		}
		wg.Wait()
	}

	// Get all session IDs for batch conversation fetch
	sessionIDs := make([]string, len(allSessions))
	for i, s := range allSessions {
		sessionIDs[i] = s.ID
	}

	// Batch fetch all conversations for all sessions (uses 3 queries internally)
	convsBySession, err := h.store.ListConversationsForSessions(ctx, sessionIDs)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Build response combining sessions with their conversations
	sessionsWithConvs := make([]*SessionWithConversations, len(allSessions))
	for i, session := range allSessions {
		convs := convsBySession[session.ID]
		if convs == nil {
			convs = []*models.Conversation{}
		}
		sessionsWithConvs[i] = &SessionWithConversations{
			Session:       session,
			Conversations: convs,
		}
	}

	writeJSON(w, DashboardData{
		Workspaces:          repos,
		Sessions:            sessionsWithConvs,
		ArchivedSessionDirs: archivedSessionDirs,
	})
}

func (h *Handlers) GetRepo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}
	writeJSON(w, repo)
}

// RepoDetailsResponse extends the basic repo info with remote origin details
type RepoDetailsResponse struct {
	*models.Repo
	RemoteURL      string `json:"remoteUrl,omitempty"`
	GitHubOwner    string `json:"githubOwner,omitempty"`
	GitHubRepo     string `json:"githubRepo,omitempty"`
	WorkspacesPath string `json:"workspacesPath,omitempty"`
}

func (h *Handlers) GetRepoDetails(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	response := &RepoDetailsResponse{Repo: repo}

	// Try to get remote origin URL
	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err == nil {
		response.GitHubOwner = owner
		response.GitHubRepo = repoName
		response.RemoteURL = fmt.Sprintf("https://github.com/%s/%s", owner, repoName)
	}

	// Get workspaces base directory (uses configured path if set)
	workspacesDir, err := h.getWorkspacesBaseDir(ctx)
	if err == nil {
		response.WorkspacesPath = workspacesDir
	}

	writeJSON(w, response)
}

func (h *Handlers) DeleteRepo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")

	if err := h.store.DeleteRepo(ctx, id); err != nil {
		writeDBError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type UpdateRepoSettingsRequest struct {
	Branch       *string `json:"branch,omitempty"`
	Remote       *string `json:"remote,omitempty"`
	BranchPrefix *string `json:"branchPrefix,omitempty"`
	CustomPrefix *string `json:"customPrefix,omitempty"`
}

func (h *Handlers) UpdateRepoSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	var req UpdateRepoSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Remote != nil {
		remote := *req.Remote
		if remote != "" {
			// Validate that the remote exists
			remotes, err := h.repoManager.ListRemotes(ctx, repo.Path)
			if err != nil {
				writeInternalError(w, "failed to list remotes", err)
				return
			}
			found := false
			for _, r := range remotes {
				if r == remote {
					found = true
					break
				}
			}
			if !found {
				writeValidationError(w, fmt.Sprintf("remote '%s' does not exist", remote))
				return
			}
		}
		repo.Remote = remote
	}

	if req.Branch != nil {
		branch := *req.Branch
		if branch != "" {
			if !h.repoManager.RefExists(ctx, repo.Path, branch) {
				writeValidationError(w, fmt.Sprintf("branch '%s' does not exist", branch))
				return
			}
		}
		repo.Branch = branch
	}

	if req.BranchPrefix != nil {
		repo.BranchPrefix = *req.BranchPrefix
	}
	if req.CustomPrefix != nil {
		repo.CustomPrefix = *req.CustomPrefix
	}

	if err := h.store.UpdateRepo(ctx, repo); err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, repo)
}

type RepoRemotesResponse struct {
	Remotes  []string            `json:"remotes"`
	Branches map[string][]string `json:"branches"`
}

func (h *Handlers) GetRepoRemotes(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	remotes, err := h.repoManager.ListRemotes(ctx, repo.Path)
	if err != nil {
		writeInternalError(w, "failed to list remotes", err)
		return
	}

	branches := make(map[string][]string)
	for _, remote := range remotes {
		remoteBranches, err := h.repoManager.ListRemoteBranches(ctx, repo.Path, remote)
		if err != nil {
			continue
		}
		branches[remote] = remoteBranches
	}

	writeJSON(w, RepoRemotesResponse{
		Remotes:  remotes,
		Branches: branches,
	})
}

// Session handlers

func (h *Handlers) ListSessions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")
	includeArchived := r.URL.Query().Get("includeArchived") == "true"
	sessions, err := h.store.ListSessions(ctx, workspaceID, includeArchived)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, sessions)
}

// ListBranches returns all branches for a workspace with session linkage
// GET /api/repos/{id}/branches?includeRemote=true&limit=50&offset=0&search=&sortBy=date
func (h *Handlers) ListBranches(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")

	// Get the workspace
	repo, err := h.store.GetRepo(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Parse query parameters
	query := r.URL.Query()
	includeRemote := query.Get("includeRemote") != "false" // default true
	limit := 50
	if l := query.Get("limit"); l != "" {
		fmt.Sscanf(l, "%d", &limit)
	}
	offset := 0
	if o := query.Get("offset"); o != "" {
		fmt.Sscanf(o, "%d", &offset)
	}
	search := query.Get("search")
	sortBy := query.Get("sortBy")
	if sortBy == "" {
		sortBy = "date"
	}

	// Build cache key - cache the full list, apply filtering after
	cacheKey := fmt.Sprintf("%s:remote=%v:sort=%s", repo.Path, includeRemote, sortBy)

	// Check cache first
	branchResult, cacheHit := h.branchCache.Get(cacheKey)
	if !cacheHit {
		// Get branches from git
		branchOpts := git.BranchListOptions{
			IncludeRemote: includeRemote,
			Limit:         0, // Fetch all for caching
			Offset:        0,
			Search:        "", // Don't filter in git, we'll filter cached results
			SortBy:        sortBy,
			SortDesc:      true, // Most recent first for date sort
		}

		var err error
		branchResult, err = h.repoManager.ListBranches(ctx, repo.Path, branchOpts)
		if err != nil {
			writeInternalError(w, "failed to list branches", err)
			return
		}

		// Cache the result
		h.branchCache.Set(cacheKey, branchResult)
	}

	// Apply search filter on cached results if needed
	filteredBranches := branchResult.Branches
	if search != "" {
		searchLower := strings.ToLower(search)
		var filtered []git.BranchInfo
		for _, b := range branchResult.Branches {
			if strings.Contains(strings.ToLower(b.Name), searchLower) {
				filtered = append(filtered, b)
			}
		}
		filteredBranches = filtered
	}

	// Apply pagination
	total := len(filteredBranches)
	start := offset
	if start > total {
		start = total
	}
	end := start + limit
	if end > total {
		end = total
	}
	paginatedBranches := filteredBranches[start:end]

	// Create result with pagination info
	branchResult = &git.BranchListResult{
		Branches: paginatedBranches,
		Total:    total,
		HasMore:  end < total,
	}

	// Get current branch
	currentBranch, _ := h.repoManager.GetCurrentBranch(ctx, repo.Path)

	// Get all non-archived sessions for this workspace to build branch -> session lookup
	sessions, err := h.store.ListSessions(ctx, workspaceID, false)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Build branch -> session lookup map
	branchToSession := make(map[string]*models.Session)
	for _, sess := range sessions {
		if sess.Branch != "" {
			branchToSession[sess.Branch] = sess
		}
	}

	// Separate branches into session-linked and other
	var sessionBranches []models.BranchWithSession
	var otherBranches []models.BranchWithSession

	for _, branch := range branchResult.Branches {
		bws := models.BranchWithSession{
			BranchInfo: models.BranchInfo{
				Name:              branch.Name,
				IsRemote:          branch.IsRemote,
				IsHead:            branch.IsHead,
				LastCommitSHA:     branch.LastCommitSHA,
				LastCommitDate:    branch.LastCommitDate,
				LastCommitSubject: branch.LastCommitSubject,
				LastAuthor:        branch.LastAuthor,
				LastAuthorEmail:   branch.LastAuthorEmail,
				AheadMain:         branch.AheadMain,
				BehindMain:        branch.BehindMain,
				Prefix:            branch.Prefix,
			},
		}

		// Check if this branch has an associated session
		if sess, ok := branchToSession[branch.Name]; ok {
			bws.SessionID = sess.ID
			bws.SessionName = sess.Name
			bws.SessionStatus = sess.Status
			sessionBranches = append(sessionBranches, bws)
		} else {
			otherBranches = append(otherBranches, bws)
		}
	}

	response := models.BranchListResponse{
		SessionBranches: sessionBranches,
		OtherBranches:   otherBranches,
		CurrentBranch:   currentBranch,
		Total:           branchResult.Total,
		HasMore:         branchResult.HasMore,
	}

	// Ensure empty slices are serialized as [] not null
	if response.SessionBranches == nil {
		response.SessionBranches = []models.BranchWithSession{}
	}
	if response.OtherBranches == nil {
		response.OtherBranches = []models.BranchWithSession{}
	}

	writeJSON(w, response)
}

// getSessionBranchMap builds a mapping from branch name to session info for a workspace.
// Includes archived sessions so their branches are protected during branch cleanup.
func (h *Handlers) getSessionBranchMap(ctx context.Context, workspaceID string) (map[string]*git.SessionInfo, error) {
	sessions, err := h.store.ListSessions(ctx, workspaceID, true)
	if err != nil {
		return nil, err
	}

	sessionBranches := make(map[string]*git.SessionInfo)
	for _, sess := range sessions {
		if sess.Branch != "" {
			sessionBranches[sess.Branch] = &git.SessionInfo{
				ID:     sess.ID,
				Name:   sess.Name,
				Status: sess.Status,
			}
		}
	}
	return sessionBranches, nil
}

// AnalyzeBranchCleanup analyzes branches for cleanup and returns categorized candidates
// POST /api/repos/{id}/branches/analyze-cleanup
func (h *Handlers) AnalyzeBranchCleanup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")

	// Get the workspace
	repo, err := h.store.GetRepo(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Parse request body
	var req git.CleanupAnalysisRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.StaleDaysThreshold <= 0 {
		req.StaleDaysThreshold = 90
	}

	// Get sessions for branch -> session mapping
	sessionBranches, err := h.getSessionBranchMap(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Run analysis
	response, err := h.repoManager.AnalyzeBranchesForCleanup(
		ctx, repo.Path, req.StaleDaysThreshold, req.IncludeRemote, sessionBranches,
	)
	if err != nil {
		writeInternalError(w, "failed to analyze branches", err)
		return
	}

	writeJSON(w, response)
}

// ExecuteBranchCleanup deletes the specified branches
// POST /api/repos/{id}/branches/cleanup
func (h *Handlers) ExecuteBranchCleanup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")

	// Get the workspace
	repo, err := h.store.GetRepo(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Parse request body
	var req git.CleanupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if len(req.Branches) == 0 {
		writeValidationError(w, "no branches specified")
		return
	}

	// Get sessions for safety checks
	sessionBranches, err := h.getSessionBranchMap(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Execute cleanup
	result, err := h.repoManager.DeleteBranches(ctx, repo.Path, req.Branches, sessionBranches)
	if err != nil {
		writeInternalError(w, "failed to delete branches", err)
		return
	}

	// Invalidate branch cache and notify clients
	h.branchCache.InvalidateRepo(repo.Path)
	if h.hub != nil {
		h.hub.Broadcast(Event{
			Type: "branch_dashboard_update",
			Payload: map[string]interface{}{
				"reason":    "branch_cleanup",
				"succeeded": len(result.Succeeded),
				"failed":    len(result.Failed),
			},
		})
	}

	writeJSON(w, result)
}

// GetAvatars returns GitHub avatar URLs for a batch of email addresses
// GET /api/avatars?emails=email1@example.com,email2@example.com
func (h *Handlers) GetAvatars(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Parse emails from query parameter
	emailsParam := r.URL.Query().Get("emails")
	if emailsParam == "" {
		writeJSON(w, map[string]interface{}{"avatars": map[string]string{}})
		return
	}

	emails := strings.Split(emailsParam, ",")
	if len(emails) == 0 {
		writeJSON(w, map[string]interface{}{"avatars": map[string]string{}})
		return
	}

	// Limit batch size to prevent abuse
	if len(emails) > 50 {
		emails = emails[:50]
	}

	// Check cache for existing entries
	cached, needLookup := h.avatarCache.GetMultiple(emails)

	// If we have all entries cached, return immediately
	if len(needLookup) == 0 {
		writeJSON(w, map[string]interface{}{"avatars": cached})
		return
	}

	// Look up missing emails from GitHub API
	for _, email := range needLookup {
		email = strings.TrimSpace(email)
		if email == "" {
			continue
		}

		avatarURL, err := h.ghClient.GetAvatarByEmail(ctx, email)
		if err != nil {
			// Log error but continue - don't fail the whole batch
			logger.Handlers.Debugf("Failed to get avatar for %s: %v", email, err)
			// Cache as not found to avoid repeated failed lookups
			h.avatarCache.SetNotFound(email)
			cached[email] = ""
			continue
		}

		if avatarURL == "" {
			// No user found - cache as not found
			h.avatarCache.SetNotFound(email)
			cached[email] = ""
		} else {
			h.avatarCache.Set(email, avatarURL)
			cached[email] = avatarURL
		}
	}

	writeJSON(w, map[string]interface{}{"avatars": cached})
}

type CreateSessionRequest struct {
	// Name is optional - if not provided, a city name will be auto-generated
	Name string `json:"name,omitempty"`
	// Branch is optional - if not provided, will be generated from the session name
	Branch string `json:"branch,omitempty"`
	// BranchPrefix is optional - prefix for auto-generated branch names (default: "session")
	BranchPrefix string `json:"branchPrefix,omitempty"`
	// WorktreePath is deprecated - worktrees are now created at ~/Library/Application Support/ChatML/workspaces/{name}
	WorktreePath string `json:"worktreePath,omitempty"`
	// Task is an optional description of what this session is for
	Task string `json:"task,omitempty"`
	// TargetBranch is optional - overrides the workspace default branch for PRs and sync (e.g. "origin/develop")
	TargetBranch string `json:"targetBranch,omitempty"`
	// CheckoutExisting checks out an existing remote branch instead of creating a new one
	CheckoutExisting bool `json:"checkoutExisting,omitempty"`
	// SystemMessage is optional custom content for the initial system message (e.g. PR context)
	SystemMessage string `json:"systemMessage,omitempty"`
}

// resolveRepoBranchPrefix returns the branch prefix based on repo-level settings.
// For the "github" case, it resolves to the authenticated GitHub user's login.
// Returns "session" as the default fallback.
func (h *Handlers) resolveRepoBranchPrefix(repo *models.Repo) string {
	switch repo.BranchPrefix {
	case "custom":
		if repo.CustomPrefix != "" {
			return repo.CustomPrefix
		}
	case "none":
		return ""
	case "github":
		if user := h.ghClient.GetStoredUser(); user != nil && user.Login != "" {
			return user.Login
		}
	}
	// "", or anything else → "session" (backend default)
	return "session"
}

func (h *Handlers) CreateSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	var req CreateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Validate optional targetBranch — must be in the form "<remote>/<branch>"
	if req.TargetBranch != "" {
		if !strings.Contains(req.TargetBranch, "/") {
			writeValidationError(w, "targetBranch must be in the form '<remote>/<branch>' (e.g. 'origin/develop')")
			return
		}
	}

	if req.CheckoutExisting && req.Branch == "" {
		writeValidationError(w, "branch is required when checkoutExisting is true")
		return
	}

	// Validate branch is not protected when checking out an existing branch.
	// Defense-in-depth: CheckoutExistingBranchInDir also validates this, but we
	// check early here to return a clear validation error before any git operations.
	if req.CheckoutExisting {
		branchName := strings.TrimPrefix(req.Branch, "origin/")
		if git.IsProtectedBranch(branchName) {
			writeValidationError(w, fmt.Sprintf("cannot create session on protected branch '%s'", branchName))
			return
		}
	}

	// Generate session ID
	sessionID := uuid.New().String()

	// Get workspaces base directory (uses configured path if set)
	workspacesDir, err := h.getWorkspacesBaseDir(ctx)
	if err != nil {
		writeInternalError(w, "failed to get workspaces directory", err)
		return
	}

	// Ensure workspaces base directory exists
	if err := os.MkdirAll(workspacesDir, 0755); err != nil {
		writeInternalError(w, "failed to create workspaces directory", err)
		return
	}

	// Determine remote and target branch for worktree creation (needed by retry loop)
	remote := repo.Remote
	if remote == "" {
		remote = "origin"
	}

	targetBranch := req.TargetBranch
	if targetBranch == "" {
		targetBranch = remote + "/" + repo.Branch
		if targetBranch == remote+"/" {
			targetBranch = remote + "/main"
		}
		// Verify the target ref exists; fall back to <remote>/main or <remote>/master
		if !h.repoManager.RefExists(ctx, repo.Path, targetBranch) {
			for _, fallback := range []string{remote + "/main", remote + "/master"} {
				if fallback != targetBranch && h.repoManager.RefExists(ctx, repo.Path, fallback) {
					targetBranch = fallback
					break
				}
			}
		}
	}

	// Resolve branch prefix once (used for auto-generated names)
	branchPrefix := req.BranchPrefix
	if branchPrefix == "" && req.Branch == "" {
		branchPrefix = h.resolveRepoBranchPrefix(repo)
	}

	// Generate or use provided session name with atomic directory + worktree creation
	sessionName := req.Name
	var sessionPath, branchName, worktreePath, baseCommitSHA string
	autoGeneratedName := sessionName == ""

	if autoGeneratedName {
		// Atomic session name generation with retry loop.
		// Retries on both directory collisions AND branch collisions, so stale
		// git branches from previously deleted sessions don't block the user.
		const maxRetries = 10
		for attempt := 0; attempt < maxRetries; attempt++ {
			// Get existing names from cache (initializes on first call)
			existingNames, err := h.sessionNameCache.GetAll()
			if err != nil {
				writeInternalError(w, "failed to get existing session names", err)
				return
			}

			// Generate candidate name
			candidateName := naming.GenerateUniqueSessionName(existingNames)

			// Attempt atomic directory creation
			path, err := git.CreateSessionDirectoryAtomic(workspacesDir, candidateName)
			if err != nil {
				if errors.Is(err, git.ErrDirectoryExists) {
					// Directory collision - add to cache and retry
					h.sessionNameCache.Add(candidateName)
					continue
				}
				writeInternalError(w, "failed to create session directory", err)
				return
			}

			// Directory created - now try to create the worktree with this name
			h.sessionNameCache.Add(candidateName)

			candidateBranch := candidateName
			if branchPrefix != "" {
				candidateBranch = fmt.Sprintf("%s/%s", branchPrefix, candidateName)
			}

			h.sessionLocks.Lock(path)
			var wtPath, wtBranch, wtCommit string
			var wtErr error
			if req.CheckoutExisting {
				wtPath, wtBranch, wtCommit, wtErr = h.worktreeManager.CheckoutExistingBranchInDir(ctx, repo.Path, path, req.Branch)
			} else {
				wtPath, wtBranch, wtCommit, wtErr = h.worktreeManager.CreateInExistingDir(ctx, repo.Path, path, candidateBranch, targetBranch)
			}
			h.sessionLocks.Unlock(path)

			if wtErr == nil {
				// Success - use this name
				sessionName = candidateName
				sessionPath = path
				branchName = wtBranch
				worktreePath = wtPath
				baseCommitSHA = wtCommit
				break
			}

			// Branch collision - roll back directory and retry with a new name
			if errors.Is(wtErr, git.ErrLocalBranchExists) || errors.Is(wtErr, git.ErrBranchAlreadyCheckedOut) {
				h.sessionNameCache.Remove(candidateName)
				if removeErr := os.RemoveAll(path); removeErr != nil {
					logger.Handlers.Warnf("Failed to rollback session directory %s: %v", path, removeErr)
				}
				logger.Handlers.Infof("Branch collision on '%s', retrying with new name (attempt %d/%d)", candidateBranch, attempt+1, maxRetries)
				continue
			}

			// Non-collision error - roll back and fail
			h.sessionNameCache.Remove(candidateName)
			if removeErr := os.RemoveAll(path); removeErr != nil {
				logger.Handlers.Warnf("Failed to rollback session directory %s: %v", path, removeErr)
			}
			writeInternalError(w, "failed to create worktree", wtErr)
			return
		}

		if sessionName == "" {
			writeConflict(w, "failed to generate unique session name after retries; too many branch collisions")
			return
		}
	} else {
		// User provided a name - attempt atomic directory creation (no retry)
		path, err := git.CreateSessionDirectoryAtomic(workspacesDir, sessionName)
		if err != nil {
			if errors.Is(err, git.ErrDirectoryExists) {
				writeConflict(w, fmt.Sprintf("session name '%s' already exists", sessionName))
				return
			}
			writeInternalError(w, "failed to create session directory", err)
			return
		}
		sessionPath = path
		h.sessionNameCache.Add(sessionName)

		// Determine branch name
		branchName = req.Branch
		if branchName == "" {
			if branchPrefix != "" {
				branchName = fmt.Sprintf("%s/%s", branchPrefix, sessionName)
			} else {
				branchName = sessionName
			}
		}

		// Lock on the session path to prevent race conditions
		h.sessionLocks.Lock(sessionPath)
		defer h.sessionLocks.Unlock(sessionPath)

		// Create git worktree
		if req.CheckoutExisting {
			worktreePath, branchName, baseCommitSHA, err = h.worktreeManager.CheckoutExistingBranchInDir(ctx, repo.Path, sessionPath, branchName)
		} else {
			worktreePath, branchName, baseCommitSHA, err = h.worktreeManager.CreateInExistingDir(ctx, repo.Path, sessionPath, branchName, targetBranch)
		}
		if err != nil {
			h.sessionNameCache.Remove(sessionName)
			if removeErr := os.RemoveAll(sessionPath); removeErr != nil {
				logger.Handlers.Warnf("Failed to rollback session directory %s: %v", sessionPath, removeErr)
			}
			if errors.Is(err, git.ErrBranchAlreadyCheckedOut) {
				writeConflict(w, fmt.Sprintf("branch '%s' is already checked out in another session", branchName))
				return
			}
			if errors.Is(err, git.ErrLocalBranchExists) {
				writeConflict(w, fmt.Sprintf("local branch '%s' already exists; delete it first or use a different branch name", branchName))
				return
			}
			writeInternalError(w, "failed to create worktree", err)
			return
		}
	}

	// Lock on the session path for the remainder of setup (auto-generated path needs locking here)
	if autoGeneratedName {
		h.sessionLocks.Lock(sessionPath)
		defer h.sessionLocks.Unlock(sessionPath)
	}

	// Track rollback state - if any subsequent operation fails, clean up the worktree
	rollback := true
	defer func() {
		if rollback {
			logger.Handlers.Warnf("Rolling back worktree creation due to failure: %s", worktreePath)
			h.sessionNameCache.Remove(sessionName)
			// Use background context for cleanup - the original request context may be cancelled
			h.worktreeManager.RemoveAtPath(context.Background(), repo.Path, worktreePath, branchName)
		}
	}()

	now := time.Now()

	sess := &models.Session{
		ID:            sessionID,
		WorkspaceID:   workspaceID,
		Name:          sessionName,
		Branch:        branchName,
		WorktreePath:  worktreePath,
		BaseCommitSHA: baseCommitSHA,
		TargetBranch:  req.TargetBranch,
		Task:          req.Task,
		Status:        "idle",
		PRStatus:      "none",
		Priority:      models.PriorityNone,
		TaskStatus:    models.TaskStatusBacklog,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	if err := h.store.AddSession(ctx, sess); err != nil {
		writeDBError(w, err)
		return
	}

	// Create initial "Untitled" conversation with setup info
	convID := uuid.New().String()[:8]
	conv := &models.Conversation{
		ID:          convID,
		SessionID:   sess.ID,
		Type:        models.ConversationTypeTask,
		Name:        "Untitled",
		Status:      models.ConversationStatusIdle,
		Messages:    []models.Message{},
		ToolSummary: []models.ToolAction{},
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := h.store.AddConversation(ctx, conv); err != nil {
		writeDBError(w, err)
		return
	}

	// Add system message with setup info
	originBranch := repo.Branch
	if originBranch == "" {
		originBranch = "main"
	}
	setupMsg := models.Message{
		ID:      uuid.New().String()[:8],
		Role:    "system",
		Content: req.SystemMessage,
		SetupInfo: &models.SetupInfo{
			SessionName:  sess.Name,
			BranchName:   sess.Branch,
			OriginBranch: originBranch,
		},
		Timestamp: now,
	}
	if err := h.store.AddMessageToConversation(ctx, convID, setupMsg); err != nil {
		writeDBError(w, err)
		return
	}

	// Start watching for branch changes
	if h.branchWatcher != nil {
		if err := h.branchWatcher.WatchSession(sess.ID, worktreePath, branchName); err != nil {
			logger.Handlers.Warnf("Failed to start branch watching for session %s: %v", sess.ID, err)
			// Non-fatal - session works without instant branch detection
		}
	}

	// Start watching for PR status changes
	if h.prWatcher != nil {
		h.prWatcher.WatchSession(sess.ID, workspaceID, branchName, repo.Path, models.PRStatusNone)
	}

	// Invalidate branch cache after new session/branch creation
	h.branchCache.InvalidateRepo(repo.Path)

	// Run setup scripts if configured and auto-setup is enabled
	if h.scriptRunner != nil {
		config, configErr := scripts.LoadConfig(repo.Path)
		if configErr != nil {
			logger.Handlers.Warnf("Failed to load .chatml/config.json for session %s: %v", sess.ID, configErr)
		} else if config != nil && config.AutoSetup && len(config.SetupScripts) > 0 {
			if err := h.scriptRunner.RunSetupScripts(context.Background(), sess.ID, worktreePath, config.SetupScripts); err != nil {
				logger.Handlers.Warnf("Failed to start setup scripts for session %s: %v", sess.ID, err)
			} else {
				logger.Handlers.Infof("Started setup scripts for session %s (%d scripts)", sess.ID, len(config.SetupScripts))
			}
		}
	}

	// All operations succeeded - disable rollback
	rollback = false
	writeJSON(w, sess)
}

func (h *Handlers) GetSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	writeJSON(w, session)
}

type UpdateSessionRequest struct {
	Name             *string `json:"name,omitempty"`
	Task             *string `json:"task,omitempty"`
	Status           *string `json:"status,omitempty"`
	TargetBranch     *string `json:"targetBranch,omitempty"`
	PRStatus         *string `json:"prStatus,omitempty"`
	PRUrl            *string `json:"prUrl,omitempty"`
	PRNumber         *int    `json:"prNumber,omitempty"`
	HasMergeConflict *bool   `json:"hasMergeConflict,omitempty"`
	HasCheckFailures *bool   `json:"hasCheckFailures,omitempty"`
	Pinned           *bool   `json:"pinned,omitempty"`
	Archived         *bool   `json:"archived,omitempty"`
	DeleteBranch     *bool   `json:"deleteBranch,omitempty"`
	Priority         *int    `json:"priority,omitempty"`
	TaskStatus       *string `json:"taskStatus,omitempty"`
}

func (h *Handlers) UpdateSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	var req UpdateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Validate status values before updating
	if req.Status != nil && !models.ValidSessionStatuses[*req.Status] {
		writeValidationError(w, "invalid status value")
		return
	}
	if req.PRStatus != nil && !models.ValidPRStatuses[*req.PRStatus] {
		writeValidationError(w, "invalid prStatus value")
		return
	}
	if req.Priority != nil && !models.ValidPriorities[*req.Priority] {
		writeValidationError(w, "invalid priority value")
		return
	}
	if req.TaskStatus != nil && !models.ValidTaskStatuses[*req.TaskStatus] {
		writeValidationError(w, "invalid taskStatus value")
		return
	}
	if req.TargetBranch != nil && *req.TargetBranch != "" {
		if !strings.HasPrefix(*req.TargetBranch, "origin/") || strings.TrimPrefix(*req.TargetBranch, "origin/") == "" {
			writeValidationError(w, "targetBranch must start with 'origin/' followed by a branch name (e.g. 'origin/develop')")
			return
		}
	}

	if err := h.store.UpdateSession(ctx, id, func(s *models.Session) {
		if req.Name != nil {
			s.Name = *req.Name
		}
		if req.Task != nil {
			s.Task = *req.Task
		}
		if req.Status != nil {
			s.Status = *req.Status
		}
		if req.TargetBranch != nil {
			s.TargetBranch = *req.TargetBranch
		}
		if req.PRStatus != nil {
			s.PRStatus = *req.PRStatus
		}
		if req.PRUrl != nil {
			s.PRUrl = *req.PRUrl
		}
		if req.PRNumber != nil {
			s.PRNumber = *req.PRNumber
		}
		if req.HasMergeConflict != nil {
			s.HasMergeConflict = *req.HasMergeConflict
		}
		if req.HasCheckFailures != nil {
			s.HasCheckFailures = *req.HasCheckFailures
		}
		if req.Pinned != nil {
			s.Pinned = *req.Pinned
		}
		if req.Archived != nil {
			s.Archived = *req.Archived
		}
		if req.Priority != nil {
			s.Priority = *req.Priority
		}
		if req.TaskStatus != nil {
			s.TaskStatus = *req.TaskStatus
		}
		s.UpdatedAt = time.Now()
	}); err != nil {
		writeDBError(w, err)
		return
	}

	session, err = h.store.GetSession(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Trigger archive summary generation when session is being archived
	if req.Archived != nil && *req.Archived && h.aiClient != nil {
		// Set generating status synchronously so the frontend sees it immediately
		if err := h.store.UpdateSession(ctx, id, func(s *models.Session) {
			s.ArchiveSummaryStatus = models.SummaryStatusGenerating
		}); err != nil {
			logger.Error.Errorf("Failed to set generating status for session %s: %v", id, err)
		} else {
			session.ArchiveSummaryStatus = models.SummaryStatusGenerating
			go h.generateArchiveSummary(id)
		}
	}

	// Delete local branch on archive if requested
	if req.DeleteBranch != nil && *req.DeleteBranch && req.Archived != nil && *req.Archived && session.Branch != "" {
		repo, repoErr := h.store.GetRepo(ctx, session.WorkspaceID)
		if repoErr == nil && repo != nil {
			if delErr := h.repoManager.DeleteLocalBranch(ctx, repo.Path, session.Branch); delErr != nil {
				logger.Error.Errorf("Failed to delete branch %q on archive: %v", session.Branch, delErr)
			}
		}
	}

	writeJSON(w, session)
}

// generateArchiveSummary fetches all conversations for a session and generates a combined summary.
func (h *Handlers) generateArchiveSummary(sessionID string) {
	bgCtx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	// Fetch all conversations for this session
	convs, err := h.store.ListConversations(bgCtx, sessionID)
	if err != nil {
		logger.Error.Errorf("Archive summary: failed to list conversations for session %s: %v", sessionID, err)
		h.updateArchiveSummaryStatus(bgCtx, sessionID, models.SummaryStatusFailed, "")
		return
	}

	// Build conversation messages for the AI
	var convMessages []ai.ConversationMessages
	for _, conv := range convs {
		if conv.MessageCount < 1 {
			continue
		}
		allMessages, err := h.store.GetConversationMessages(bgCtx, conv.ID, nil, conv.MessageCount)
		if err != nil {
			logger.Error.Errorf("Archive summary: failed to get messages for conversation %s: %v", conv.ID, err)
			continue
		}

		var msgs []ai.SummaryMessage
		for _, m := range allMessages.Messages {
			if m.Role == "system" && m.SetupInfo != nil {
				continue
			}
			if m.RunSummary != nil && m.Content == "" {
				continue
			}
			if m.Content == "" {
				continue
			}
			msgs = append(msgs, ai.SummaryMessage{
				Role:    m.Role,
				Content: m.Content,
			})
		}

		if len(msgs) > 0 {
			convMessages = append(convMessages, ai.ConversationMessages{
				Name:     conv.Name,
				Type:     conv.Type,
				Messages: msgs,
			})
		}
	}

	if len(convMessages) == 0 {
		logger.Handlers.Infof("Archive summary: no messages to summarize for session %s", sessionID)
		h.updateArchiveSummaryStatus(bgCtx, sessionID, models.SummaryStatusCompleted, "No conversations with messages to summarize.")
		return
	}

	// Get session info for context
	sess, _ := h.store.GetSession(bgCtx, sessionID)
	sessionName := sessionID
	task := ""
	if sess != nil {
		sessionName = sess.Name
		task = sess.Task
	}

	result, err := h.aiClient.GenerateSessionSummary(bgCtx, ai.GenerateSessionSummaryRequest{
		SessionName:   sessionName,
		Task:          task,
		Conversations: convMessages,
	})

	if err != nil {
		logger.Error.Errorf("Archive summary generation failed for session %s: %v", sessionID, err)
		h.updateArchiveSummaryStatus(bgCtx, sessionID, models.SummaryStatusFailed, "")
		return
	}

	h.updateArchiveSummaryStatus(bgCtx, sessionID, models.SummaryStatusCompleted, result)
}

// updateArchiveSummaryStatus updates the archive summary fields and broadcasts a WebSocket event.
func (h *Handlers) updateArchiveSummaryStatus(ctx context.Context, sessionID, status, content string) {
	if err := h.store.UpdateSession(ctx, sessionID, func(s *models.Session) {
		s.ArchiveSummaryStatus = status
		s.ArchiveSummary = content
	}); err != nil {
		logger.Error.Errorf("Failed to update archive summary status for session %s: %v", sessionID, err)
		return
	}

	// Broadcast so frontend can update
	if h.hub != nil {
		updatedSession, _ := h.store.GetSession(ctx, sessionID)
		if updatedSession != nil {
			h.hub.Broadcast(Event{
				Type:      "archive_summary_updated",
				SessionID: sessionID,
				Payload:   updatedSession,
			})
		}
	}
}

func (h *Handlers) DeleteSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Get session to find workspace and worktree path
	sess, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Track worktree path for locking - we need to hold the lock through DB deletion
	var worktreePath string
	if sess != nil && sess.WorktreePath != "" {
		worktreePath = sess.WorktreePath
	}

	// Acquire lock before any modifications if we have a worktree path
	if worktreePath != "" {
		h.sessionLocks.Lock(worktreePath)
		defer h.sessionLocks.Unlock(worktreePath)
	}

	// Capture cleanup info BEFORE deleting from DB
	var repoPath, sessionName string
	if sess != nil {
		// Stop watching for branch changes
		if h.branchWatcher != nil {
			h.branchWatcher.UnwatchSession(sessionID)
		}

		// Stop watching for PR status changes
		if h.prWatcher != nil {
			h.prWatcher.UnwatchSession(sessionID)
		}

		repo, err := h.store.GetRepo(ctx, sess.WorkspaceID)
		if err != nil {
			writeDBError(w, err)
			return
		}
		if repo != nil {
			repoPath = repo.Path
			sessionName = sess.Name
		}
	}

	// DELETE DB RECORD FIRST — this is the authoritative action.
	// If this fails, no disk cleanup happens and the session remains intact.
	// Previously, worktree was removed first and DB delete could fail (no retry),
	// leaving a ghost session with no worktree on disk.
	if err := h.store.DeleteSession(ctx, sessionID); err != nil {
		writeDBError(w, err)
		return
	}

	// Clean up caches. Worktree directory is intentionally
	// preserved on disk — session worktrees are permanent artifacts.
	if worktreePath != "" && repoPath != "" {
		h.sessionNameCache.Remove(sessionName)
		h.branchCache.InvalidateRepo(repoPath)
	}

	w.WriteHeader(http.StatusNoContent)
}

// GetSessionGitStatus returns comprehensive git status for a session's worktree
func (h *Handlers) GetSessionGitStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Use single JOIN query to get session + workspace data
	session, workingPath, baseRef, err := h.getSessionAndWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, workingPath) {
		return
	}

	// Get comprehensive git status
	status, err := h.repoManager.GetStatus(ctx, workingPath, baseRef)
	if err != nil {
		writeInternalError(w, "failed to get git status", err)
		return
	}

	writeJSON(w, status)
}

// GetSessionChanges returns the list of changed files in a session's worktree
func (h *Handlers) GetSessionChanges(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Use single JOIN query to get session + workspace data
	session, workingPath, baseRef, err := h.getSessionAndWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Get changed files in the session's worktree compared to base ref
	changes, err := h.repoManager.GetChangedFilesWithStats(ctx, workingPath, baseRef)
	if err != nil {
		// If there's no diff (e.g., new worktree with no changes), return empty list
		changes = []git.FileChange{}
	}

	// Get untracked files
	untracked, err := h.repoManager.GetUntrackedFiles(ctx, workingPath)
	if err != nil {
		untracked = []git.FileChange{}
	}

	// Combine untracked files first, then tracked changes
	allChanges := append(untracked, changes...)

	writeJSON(w, allChanges)
}

// GetSessionBranchCommits returns commits on the session's branch that are ahead of the base ref.
func (h *Handlers) GetSessionBranchCommits(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	session, workingPath, baseRef, err := h.getSessionAndWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	commits, err := h.repoManager.GetCommitsAheadOfBase(ctx, workingPath, baseRef)
	if err != nil {
		logger.Handlers.Warnf("Failed to get branch commits for session %s: %v", sessionID, err)
		commits = []git.BranchCommit{}
	}

	writeJSON(w, commits)
}

// GetSessionFileDiff returns the diff for a specific file in a session's worktree
func (h *Handlers) GetSessionFileDiff(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Use single JOIN query to get session + workspace data
	session, workingPath, baseRef, err := h.getSessionAndWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, workingPath) {
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	// Validate and clean the path
	cleanPath, err := validatePath(workingPath, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	// Read current file content from the worktree
	fullPath := filepath.Join(workingPath, cleanPath)
	newContent, err := os.ReadFile(fullPath)
	if err != nil && !os.IsNotExist(err) {
		writeInternalError(w, "failed to read file", err)
		return
	}

	// Get base ref version using git show
	oldContent, err := h.repoManager.GetFileAtRef(ctx, workingPath, baseRef, cleanPath)
	if err != nil {
		// File might not exist in base branch (new file)
		oldContent = ""
	}

	// Check for conflict markers
	hasConflict := strings.Contains(string(newContent), "<<<<<<<") &&
		strings.Contains(string(newContent), "=======") &&
		strings.Contains(string(newContent), ">>>>>>>")

	response := FileDiffResponse{
		Path:        cleanPath,
		OldContent:  oldContent,
		NewContent:  string(newContent),
		OldFilename: cleanPath + " (base)",
		NewFilename: cleanPath,
		HasConflict: hasConflict,
	}

	writeJSON(w, response)
}

// FileHistoryResponse represents the commit history for a file
type FileHistoryResponse struct {
	Commits []git.FileCommit `json:"commits"`
	Total   int              `json:"total"`
}

// GetSessionFileHistory returns the commit history for a specific file in a session's worktree
func (h *Handlers) GetSessionFileHistory(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	// Validate and clean the path to prevent directory traversal attacks
	cleanPath, err := validatePath(session.WorktreePath, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	commits, err := h.repoManager.GetFileCommitHistory(ctx, session.WorktreePath, cleanPath)
	if err != nil {
		// Empty history is valid for new files
		logger.Handlers.Debugf("Failed to get file history for %s: %v (returning empty)", cleanPath, err)
		commits = []git.FileCommit{}
	}

	writeJSON(w, FileHistoryResponse{
		Commits: commits,
		Total:   len(commits),
	})
}

// GetSessionFileAtRef returns the content of a file at a specific git ref (commit SHA)
func (h *Handlers) GetSessionFileAtRef(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	ref := r.URL.Query().Get("ref")
	if ref == "" {
		writeValidationError(w, "ref parameter is required")
		return
	}

	// Validate ref format early for better error messages
	if err := git.ValidateGitRef(ref); err != nil {
		writeValidationError(w, "invalid commit reference format")
		return
	}

	// Validate and clean the path to prevent directory traversal attacks
	cleanPath, err := validatePath(session.WorktreePath, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	content, err := h.repoManager.GetFileAtRef(ctx, session.WorktreePath, ref, cleanPath)
	if err != nil {
		writeInternalError(w, "failed to read file at ref", err)
		return
	}

	writeJSON(w, FileContentResponse{
		Path:    cleanPath,
		Name:    filepath.Base(cleanPath),
		Content: content,
		Size:    int64(len(content)),
	})
}

type SendMessageRequest struct {
	Content string `json:"content"`
}

func (h *Handlers) SendSessionMessage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	var req SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Content == "" {
		writeValidationError(w, "content is required")
		return
	}

	// Check if there's an active agent for this session
	if session.AgentID == "" {
		writeValidationError(w, "no agent running for this session")
		return
	}

	// Send message to the agent
	if err := h.agentManager.SendMessage(session.AgentID, req.Content); err != nil {
		writeInternalError(w, "failed to send message", err)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]string{"status": "sent"})
}

// Agent handlers

func (h *Handlers) ListAgents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")
	agents, err := h.store.ListAgents(ctx, repoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, agents)
}

type SpawnAgentRequest struct {
	Task string `json:"task"`
}

func (h *Handlers) SpawnAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, repoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	var req SpawnAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	agent, err := h.agentManager.SpawnAgent(ctx, repo.Path, repoID, req.Task)
	if err != nil {
		writeInternalError(w, "failed to spawn agent", err)
		return
	}

	writeJSON(w, agent)
}

func (h *Handlers) StopAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	h.agentManager.StopAgent(ctx, id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) GetAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	agent, err := h.store.GetAgent(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if agent == nil {
		writeNotFound(w, "agent")
		return
	}
	writeJSON(w, agent)
}

func (h *Handlers) GetAgentDiff(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	agentID := chi.URLParam(r, "id")
	agent, err := h.store.GetAgent(ctx, agentID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if agent == nil {
		writeNotFound(w, "agent")
		return
	}

	repo, err := h.store.GetRepo(ctx, agent.RepoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	diff, err := h.worktreeManager.GetDiff(ctx, repo.Path, agentID)
	if err != nil {
		writeInternalError(w, "failed to get diff", err)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(diff))
}

func (h *Handlers) MergeAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	agentID := chi.URLParam(r, "id")
	agent, err := h.store.GetAgent(ctx, agentID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if agent == nil {
		writeNotFound(w, "agent")
		return
	}

	repo, err := h.store.GetRepo(ctx, agent.RepoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	if err := h.worktreeManager.Merge(ctx, repo.Path, agentID); err != nil {
		writeInternalError(w, "failed to merge agent changes", err)
		return
	}

	// Invalidate branch cache after merge
	h.branchCache.InvalidateRepo(repo.Path)

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) DeleteAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	agentID := chi.URLParam(r, "id")
	agent, err := h.store.GetAgent(ctx, agentID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if agent == nil {
		writeNotFound(w, "agent")
		return
	}

	repo, err := h.store.GetRepo(ctx, agent.RepoID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo != nil {
		h.worktreeManager.Remove(ctx, repo.Path, agentID)
	}

	if err := h.store.DeleteAgent(ctx, agentID); err != nil {
		writeDBError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// FileNode represents a file or directory in the tree
type FileNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	IsDir    bool        `json:"isDir"`
	Children []*FileNode `json:"children,omitempty"`
}

// ListRepoFiles returns the file tree for a repository
func (h *Handlers) ListRepoFiles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	// Get depth parameter (default to 1 level, -1 for unlimited)
	depthStr := r.URL.Query().Get("depth")
	maxDepth := 1
	if depthStr == "all" {
		maxDepth = -1
	}

	// Check cache first
	cacheKey := fmt.Sprintf("repo:%s:depth:%d", repo.Path, maxDepth)
	if cached, ok := h.dirCache.Get(cacheKey); ok {
		writeJSON(w, cached)
		return
	}

	tree, err := buildFileTree(repo.Path, "", maxDepth, 0)
	if err != nil {
		writeInternalError(w, "failed to list files", err)
		return
	}

	// Cache the result
	h.dirCache.Set(cacheKey, tree)
	writeJSON(w, tree)
}

// buildFileTree recursively builds the file tree
func buildFileTree(basePath, relativePath string, maxDepth, currentDepth int) ([]*FileNode, error) {
	fullPath := filepath.Join(basePath, relativePath)
	entries, err := os.ReadDir(fullPath)
	if err != nil {
		return nil, err
	}

	var nodes []*FileNode

	// Separate directories and files
	var dirs, files []os.DirEntry
	for _, entry := range entries {
		name := entry.Name()

		// Skip known junk/cache files and OS-specific hidden files
		blocked := map[string]bool{
			".DS_Store": true, ".localized": true, ".Trash": true,
			".DocumentRevisions-V100": true, ".Spotlight-V100": true,
			".TemporaryItems": true, ".fseventsd": true, ".VolumeIcon.icns": true,
			".AppleDouble": true, ".LSOverride": true, "._*": true,
			"Thumbs.db": true, "desktop.ini": true, ".git": true,
		}
		if blocked[name] || strings.HasPrefix(name, "._") {
			continue
		}

		// Skip large build/dependency directories
		if name == "node_modules" || name == "vendor" ||
			name == "dist" || name == "build" || name == "__pycache__" ||
			name == "target" || name == ".next" || name == "out" {
			continue
		}

		if entry.IsDir() {
			dirs = append(dirs, entry)
		} else {
			files = append(files, entry)
		}
	}

	// Sort directories and files alphabetically (case-insensitive)
	sortEntries := func(entries []os.DirEntry) {
		sort.Slice(entries, func(i, j int) bool {
			return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
		})
	}
	sortEntries(dirs)
	sortEntries(files)

	// Add directories first
	for _, entry := range dirs {
		name := entry.Name()
		nodePath := filepath.Join(relativePath, name)
		node := &FileNode{
			Name:  name,
			Path:  nodePath,
			IsDir: true,
		}

		// Recursively build children if within depth limit
		if maxDepth == -1 || currentDepth < maxDepth {
			children, err := buildFileTree(basePath, nodePath, maxDepth, currentDepth+1)
			if err == nil {
				node.Children = children
			}
		}

		nodes = append(nodes, node)
	}

	// Add files
	for _, entry := range files {
		name := entry.Name()
		nodePath := filepath.Join(relativePath, name)
		nodes = append(nodes, &FileNode{
			Name:  name,
			Path:  nodePath,
			IsDir: false,
		})
	}

	return nodes, nil
}

// FileContentResponse represents a file's content and metadata
type FileContentResponse struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Content string `json:"content"`
	Size    int64  `json:"size"`
}

// FileDiffResponse represents a diff between two versions of a file
type FileDiffResponse struct {
	Path        string `json:"path"`
	OldContent  string `json:"oldContent"`
	NewContent  string `json:"newContent"`
	OldFilename string `json:"oldFilename"`
	NewFilename string `json:"newFilename"`
	HasConflict bool   `json:"hasConflict"`
}

// GetFileDiff returns the diff between the base branch and current state for a file
func (h *Handlers) GetFileDiff(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	// Get the base branch (usually main or master)
	baseBranch := r.URL.Query().Get("base")
	if baseBranch == "" {
		baseBranch = repo.Branch // default branch
	}

	// Validate and clean the path
	cleanPath, err := validatePath(repo.Path, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	fullPath := filepath.Join(repo.Path, cleanPath)

	// Read current file content
	newContent, err := os.ReadFile(fullPath)
	if err != nil && !os.IsNotExist(err) {
		writeInternalError(w, "failed to read file", err)
		return
	}

	// Get base branch version using git show
	oldContent, err := h.repoManager.GetFileAtRef(ctx, repo.Path, baseBranch, cleanPath)
	if err != nil {
		// File might not exist in base branch (new file)
		oldContent = ""
	}

	// Check for conflict markers
	hasConflict := strings.Contains(string(newContent), "<<<<<<<") &&
		strings.Contains(string(newContent), "=======") &&
		strings.Contains(string(newContent), ">>>>>>>")

	response := FileDiffResponse{
		Path:        cleanPath,
		OldContent:  oldContent,
		NewContent:  string(newContent),
		OldFilename: cleanPath + " (base)",
		NewFilename: cleanPath,
		HasConflict: hasConflict,
	}

	writeJSON(w, response)
}

// GetRepoFileContent returns the content of a specific file in the repository
func (h *Handlers) GetRepoFileContent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, id)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "repo")
		return
	}

	// Get file path from query parameter
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	// Validate and clean the path to prevent directory traversal attacks
	cleanPath, err := validatePath(repo.Path, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	fullPath := filepath.Join(repo.Path, cleanPath)

	// Check if file exists and is not a directory
	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeNotFound(w, "file")
		} else {
			writeInternalError(w, "failed to access file", err)
		}
		return
	}
	if info.IsDir() {
		writeValidationError(w, "path is a directory")
		return
	}

	// Read file content
	content, err := os.ReadFile(fullPath)
	if err != nil {
		writeInternalError(w, "failed to read file", err)
		return
	}

	// Return as JSON with metadata
	writeJSON(w, FileContentResponse{
		Path:    cleanPath,
		Name:    filepath.Base(cleanPath),
		Content: string(content),
		Size:    info.Size(),
	})
}

// GetSessionFileContent returns file content from a session's worktree
// This provides complete session isolation - files are read from the worktree, not the main repo
func (h *Handlers) GetSessionFileContent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, session.WorktreePath) {
		return
	}

	// Get file path from query parameter
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeValidationError(w, "path parameter is required")
		return
	}

	// Validate and clean the path to prevent directory traversal attacks
	cleanPath, err := validatePath(session.WorktreePath, filePath)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	fullPath := filepath.Join(session.WorktreePath, cleanPath)

	// Check if file exists and is not a directory
	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeNotFound(w, "file")
		} else {
			writeInternalError(w, "failed to access file", err)
		}
		return
	}
	if info.IsDir() {
		writeValidationError(w, "path is a directory")
		return
	}

	// Read file content
	content, err := os.ReadFile(fullPath)
	if err != nil {
		writeInternalError(w, "failed to read file", err)
		return
	}

	// Return as JSON with metadata
	writeJSON(w, FileContentResponse{
		Path:    cleanPath,
		Name:    filepath.Base(cleanPath),
		Content: string(content),
		Size:    info.Size(),
	})
}

// ListSessionFiles returns the file tree for a session's worktree
// This ensures the file tree shows files from the worktree, not the main repo
func (h *Handlers) ListSessionFiles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, session.WorktreePath) {
		return
	}

	// Parse max depth from query params
	maxDepth := 10
	if depthParam := r.URL.Query().Get("maxDepth"); depthParam != "" {
		var parsedDepth int
		if _, err := fmt.Sscanf(depthParam, "%d", &parsedDepth); err == nil && parsedDepth > 0 {
			maxDepth = parsedDepth
		}
	}

	// Check cache first
	cacheKey := fmt.Sprintf("session:%s:depth:%d", session.WorktreePath, maxDepth)
	if cached, ok := h.dirCache.Get(cacheKey); ok {
		writeJSON(w, cached)
		return
	}

	// Build file tree from worktree path
	tree, err := buildFileTree(session.WorktreePath, "", maxDepth, 0)
	if err != nil {
		writeInternalError(w, "failed to list files", err)
		return
	}

	// Cache the result
	h.dirCache.Set(cacheKey, tree)
	writeJSON(w, tree)
}

// SaveFileRequest represents a request to save file content
type SaveFileRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// SaveFile saves content to a specific file in the repository or session worktree.
// Design decision: Only allows saving to existing files, not creating new ones.
// This is intentional to prevent accidental file creation through the save API.
// File creation should be done through agent actions or explicit "create file" endpoints.
func (h *Handlers) SaveFile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	var req SaveFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Check file size limit
	maxSize := h.fileSizeConfig.MaxFileSizeBytes
	if int64(len(req.Content)) > maxSize {
		writePayloadTooLarge(w, fmt.Sprintf("file content exceeds maximum size of %d MB", maxSize/(1024*1024)))
		return
	}

	if req.Path == "" {
		writeValidationError(w, "path is required")
		return
	}

	// Determine the base path - check if this is a session-scoped save
	basePath := repo.Path
	sessionID := r.URL.Query().Get("sessionId")
	if sessionID != "" {
		session, err := h.store.GetSession(ctx, sessionID)
		if err != nil {
			writeDBError(w, err)
			return
		}
		if session == nil {
			writeNotFound(w, "session")
			return
		}
		if session.WorktreePath != "" {
			if checkWorktreePath(w, session.WorktreePath) {
				return
			}
			basePath = session.WorktreePath
		}
	}

	// Validate and clean the path to prevent directory traversal attacks
	cleanPath, err := validatePath(basePath, req.Path)
	if err != nil {
		writeValidationError(w, "invalid path")
		return
	}

	fullPath := filepath.Join(basePath, cleanPath)

	// Check if file exists (we only allow saving existing files, not creating new ones)
	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeNotFound(w, "file")
		} else {
			writeInternalError(w, "failed to access file", err)
		}
		return
	}
	if info.IsDir() {
		writeValidationError(w, "path is a directory")
		return
	}

	// Preserve file permissions
	mode := info.Mode()

	// Write file content
	if err := os.WriteFile(fullPath, []byte(req.Content), mode); err != nil {
		writeInternalError(w, "failed to save file", err)
		return
	}

	// Invalidate directory listing cache for this path
	h.dirCache.InvalidatePath(basePath)

	writeJSON(w, map[string]bool{"success": true})
}

// Conversation handlers

func (h *Handlers) ListConversations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	convs, err := h.store.ListConversations(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, convs)
}

type CreateConversationRequest struct {
	Type              string              `json:"type"`              // "task", "review", "chat"
	Message           string              `json:"message"`           // Initial message (optional)
	Model             string              `json:"model"`             // Model name override (optional)
	PlanMode          bool                `json:"planMode"`          // Start in plan mode (optional)
	MaxThinkingTokens int                 `json:"maxThinkingTokens"` // Enable extended thinking (optional)
	Effort            string              `json:"effort"`            // Reasoning effort: low, medium, high, max (optional)
	Attachments       []models.Attachment `json:"attachments"`       // File attachments (optional)
	SummaryIDs        []string            `json:"summaryIds"`        // Summaries to attach as context (optional)
}

func (h *Handlers) CreateConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	var req CreateConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Default to "task" type if not specified
	if req.Type == "" {
		req.Type = "task"
	}

	// Build instructions from attached summaries
	var instructions string
	if len(req.SummaryIDs) > 0 {
		var parts []string
		for _, sid := range req.SummaryIDs {
			summary, err := h.store.GetSummary(ctx, sid)
			if err != nil {
				if errors.Is(err, store.ErrNotFound) {
					writeValidationError(w, fmt.Sprintf("summary not found: %s", sid))
					return
				}
				writeInternalError(w, "failed to fetch summary", err)
				return
			}
			if summary.Status != models.SummaryStatusCompleted {
				continue
			}
			// Validate summary belongs to the same session
			if summary.SessionID != sessionID {
				writeValidationError(w, "summary does not belong to this session")
				return
			}
			// Look up conversation name for context
			convMeta, _ := h.store.GetConversationMeta(ctx, summary.ConversationID)
			convName := "Previous conversation"
			if convMeta != nil && convMeta.Name != "" {
				convName = convMeta.Name
			}
			parts = append(parts, fmt.Sprintf("### %s\n%s", convName, summary.Content))
		}
		if len(parts) > 0 {
			instructions = "## Context from Previous Conversations\n\n" + strings.Join(parts, "\n\n")
		}
	}

	// Build options for starting the conversation
	var opts *agent.StartConversationOptions
	if req.MaxThinkingTokens > 0 || len(req.Attachments) > 0 || req.PlanMode || instructions != "" || req.Model != "" || req.Effort != "" {
		opts = &agent.StartConversationOptions{
			MaxThinkingTokens: req.MaxThinkingTokens,
			Effort:            req.Effort,
			Attachments:       req.Attachments,
			PlanMode:          req.PlanMode,
			Instructions:      instructions,
			Model:             req.Model,
		}
	}

	conv, err := h.agentManager.StartConversation(ctx, sessionID, req.Type, req.Message, opts)
	if err != nil {
		writeInternalError(w, "failed to start conversation", err)
		return
	}

	writeJSONStatus(w, http.StatusCreated, conv)
}

func (h *Handlers) GetConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}
	writeJSON(w, conv)
}

// GetStreamingSnapshot returns the current streaming snapshot for a conversation.
// Used by the frontend to restore its view after WebSocket reconnection.
func (h *Handlers) GetStreamingSnapshot(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	data, err := h.store.GetStreamingSnapshot(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if data == nil {
		writeJSON(w, nil)
		return
	}
	// data is already JSON — write it directly
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(data)
}

func (h *Handlers) GetConversationMessages(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")

	// Parse pagination params
	var beforePosition *int
	if beforeStr := r.URL.Query().Get("before"); beforeStr != "" {
		v, err := strconv.Atoi(beforeStr)
		if err != nil {
			writeValidationError(w, "invalid 'before' parameter")
			return
		}
		beforePosition = &v
	}

	limit := 50
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		v, err := strconv.Atoi(limitStr)
		if err != nil || v < 1 {
			writeValidationError(w, "invalid 'limit' parameter")
			return
		}
		if v > 200 {
			v = 200
		}
		limit = v
	}

	page, err := h.store.GetConversationMessages(ctx, convID, beforePosition, limit)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, page)
}

type SendConversationMessageRequest struct {
	Content     string              `json:"content"`
	Attachments []models.Attachment `json:"attachments"` // File attachments (optional)
	Model       string              `json:"model"`       // Model override for this message (optional)
}

func (h *Handlers) SendConversationMessage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	var req SendConversationMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Content == "" {
		writeValidationError(w, "content is required")
		return
	}

	// Switch model if specified
	if req.Model != "" {
		// Always persist model to DB first - this ensures auto-restart will use the correct model
		if err := h.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
			c.Model = req.Model
		}); err != nil {
			logger.Handlers.Warnf("Failed to persist model for conv %s: %v", convID, err)
		}
		// Also try to update running process if there is one
		if err := h.agentManager.SetConversationModel(convID, req.Model); err != nil {
			// Not an error - process may not be running yet, auto-restart will use DB value
			logger.Handlers.Debugf("Model change won't apply to running process for conv %s: %v", convID, err)
		}
	}

	if err := h.agentManager.SendConversationMessage(ctx, convID, req.Content, req.Attachments); err != nil {
		writeInternalError(w, "failed to send message", err)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]string{"status": "sent"})
}

func (h *Handlers) StopConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	h.agentManager.StopConversation(ctx, convID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) GetConversationDropStats(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "convId")
	stats := h.agentManager.GetConversationDropStats(convID)
	if stats == nil {
		// No active process - return zero drops
		writeJSON(w, map[string]uint64{"droppedMessages": 0})
		return
	}
	writeJSON(w, stats)
}

func (h *Handlers) GetActiveStreamingConversations(w http.ResponseWriter, r *http.Request) {
	active := h.agentManager.GetActiveStreamingConversations()
	if active == nil {
		active = []string{}
	}
	writeJSON(w, map[string]interface{}{
		"conversationIds": active,
	})
}

type RewindConversationRequest struct {
	CheckpointUuid string `json:"checkpointUuid"`
}

func (h *Handlers) RewindConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	var req RewindConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.CheckpointUuid == "" {
		writeValidationError(w, "checkpointUuid is required")
		return
	}

	if err := h.agentManager.RewindConversationFiles(convID, req.CheckpointUuid); err != nil {
		writeInternalError(w, "failed to rewind conversation", err)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]string{"status": "rewinding"})
}

// AnswerQuestionRequest represents user answers to AskUserQuestion tool
type AnswerQuestionRequest struct {
	RequestID string            `json:"requestId"`
	Answers   map[string]string `json:"answers"`
}

// AnswerConversationQuestion submits user answers to a pending AskUserQuestion
func (h *Handlers) AnswerConversationQuestion(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "convId")
	if convID == "" {
		writeValidationError(w, "conversation ID required")
		return
	}

	var req AnswerQuestionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.RequestID == "" {
		writeValidationError(w, "requestId is required")
		return
	}

	// Ensure answers map is initialized (defensive validation)
	if req.Answers == nil {
		req.Answers = make(map[string]string)
	}

	// Get the process for this conversation
	proc := h.agentManager.GetConversationProcess(convID)
	if proc == nil {
		writeNotFound(w, "no active process for conversation")
		return
	}

	// Send the answer to the agent process
	if err := proc.SendUserQuestionResponse(req.RequestID, req.Answers); err != nil {
		writeInternalError(w, "failed to send answer", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) DeleteConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	// Stop the conversation if running
	h.agentManager.StopConversation(ctx, convID)

	// Delete from store
	if err := h.store.DeleteConversation(ctx, convID); err != nil {
		writeDBError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type SetPlanModeRequest struct {
	Enabled bool `json:"enabled"`
}

func (h *Handlers) SetConversationPlanMode(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	var req SetPlanModeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if err := h.agentManager.SetConversationPlanMode(convID, req.Enabled); err != nil {
		writeInternalError(w, "failed to set plan mode", err)
		return
	}

	writeJSON(w, map[string]bool{"enabled": req.Enabled})
}

type SetMaxThinkingTokensRequest struct {
	MaxThinkingTokens int `json:"maxThinkingTokens"`
}

func (h *Handlers) SetConversationMaxThinkingTokens(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	var req SetMaxThinkingTokensRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.MaxThinkingTokens <= 0 {
		writeValidationError(w, "maxThinkingTokens must be positive")
		return
	}

	if err := h.agentManager.SetConversationMaxThinkingTokens(convID, req.MaxThinkingTokens); err != nil {
		writeInternalError(w, "failed to set max thinking tokens", err)
		return
	}

	writeJSON(w, map[string]int{"maxThinkingTokens": req.MaxThinkingTokens})
}

// PlanApprovalRequest represents user approval/rejection of an ExitPlanMode tool call
type PlanApprovalRequest struct {
	RequestID string `json:"requestId"`
	Approved  bool   `json:"approved"`
}

func (h *Handlers) ApprovePlan(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "convId")

	var req PlanApprovalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.RequestID == "" {
		writeValidationError(w, "requestId is required")
		return
	}

	// Get the process for this conversation
	proc := h.agentManager.GetConversationProcess(convID)
	if proc == nil {
		writeNotFound(w, "no active process for conversation")
		return
	}

	// Send the approval/rejection to the agent process
	if err := proc.SendPlanApprovalResponse(req.RequestID, req.Approved); err != nil {
		writeInternalError(w, "failed to send plan approval", err)
		return
	}

	writeJSON(w, map[string]bool{"approved": req.Approved})
}

// Summary handlers

func (h *Handlers) GenerateConversationSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	// Check AI client is available
	if h.aiClient == nil {
		writeServiceUnavailable(w, "AI features not configured (missing ANTHROPIC_API_KEY)")
		return
	}

	// Validate conversation has enough messages
	if conv.MessageCount < 2 {
		writeValidationError(w, "conversation needs at least 2 messages to summarize")
		return
	}

	// Check for existing summary
	existing, err := h.store.GetSummaryByConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if existing != nil {
		if existing.Status == models.SummaryStatusGenerating {
			writeConflict(w, "summary is already being generated")
			return
		}
		if existing.Status == models.SummaryStatusCompleted {
			// Return existing summary
			writeJSON(w, existing)
			return
		}
		// Failed summary - allow regeneration by deleting old one
		if existing.Status == models.SummaryStatusFailed {
			if err := h.store.DeleteSummary(ctx, existing.ID); err != nil {
				writeDBError(w, err)
				return
			}
		}
	}

	// Create summary record
	summary := &models.Summary{
		ID:             uuid.New().String(),
		ConversationID: convID,
		SessionID:      conv.SessionID,
		Status:         models.SummaryStatusGenerating,
		MessageCount:   conv.MessageCount,
		CreatedAt:      time.Now(),
	}
	if err := h.store.AddSummary(ctx, summary); err != nil {
		writeDBError(w, err)
		return
	}

	// Fetch all messages via paginated API
	allMessages, err := h.store.GetConversationMessages(ctx, convID, nil, conv.MessageCount)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Build messages for the AI
	var summaryMessages []ai.SummaryMessage
	for _, m := range allMessages.Messages {
		if m.Role == "system" && m.SetupInfo != nil {
			continue // Skip setup messages
		}
		content := m.Content
		// Strip RunSummary from content (it's metadata, not conversation)
		if m.RunSummary != nil && content == "" {
			continue
		}
		if content == "" {
			continue
		}
		summaryMessages = append(summaryMessages, ai.SummaryMessage{
			Role:    m.Role,
			Content: content,
		})
	}

	// Generate asynchronously
	go func() {
		bgCtx := context.Background()
		result, err := h.aiClient.GenerateConversationSummary(bgCtx, ai.GenerateSummaryRequest{
			ConversationName: conv.Name,
			Messages:         summaryMessages,
		})

		if err != nil {
			logger.Error.Errorf("Summary generation failed for %s: %v", convID, err)
			if dbErr := h.store.UpdateSummary(bgCtx, summary.ID, models.SummaryStatusFailed, "", err.Error()); dbErr != nil {
				logger.Error.Errorf("Failed to update summary %s to failed status: %v", summary.ID, dbErr)
			}
			h.hub.Broadcast(Event{
				Type:           "summary_updated",
				ConversationID: convID,
				Payload:        map[string]interface{}{"id": summary.ID, "status": models.SummaryStatusFailed, "errorMessage": err.Error()},
			})
			return
		}

		if dbErr := h.store.UpdateSummary(bgCtx, summary.ID, models.SummaryStatusCompleted, result, ""); dbErr != nil {
			logger.Error.Errorf("Failed to update summary %s to completed status: %v", summary.ID, dbErr)
			return
		}
		// Broadcast completion
		updatedSummary, _ := h.store.GetSummary(bgCtx, summary.ID)
		if updatedSummary != nil {
			h.hub.Broadcast(Event{
				Type:           "summary_updated",
				ConversationID: convID,
				Payload:        updatedSummary,
			})
		}
	}()

	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, summary)
}

func (h *Handlers) GetConversationSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	summary, err := h.store.GetSummaryByConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if summary == nil {
		writeNotFound(w, "summary")
		return
	}
	writeJSON(w, summary)
}

func (h *Handlers) ListSessionSummaries(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	summaries, err := h.store.ListSummariesBySession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if summaries == nil {
		summaries = []*models.Summary{}
	}
	writeJSON(w, summaries)
}

// Attachment handlers

func (h *Handlers) GetAttachmentData(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	attachmentID := chi.URLParam(r, "attachmentId")
	data, err := h.store.GetAttachmentData(ctx, attachmentID)
	if err != nil {
		if errors.Is(err, store.ErrAttachmentNotFound) {
			writeNotFound(w, "attachment")
			return
		}
		writeDBError(w, err)
		return
	}
	writeJSON(w, map[string]string{"base64Data": data})
}

// File tab handlers

func (h *Handlers) ListFileTabs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")
	tabs, err := h.store.ListFileTabs(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, tabs)
}

type SaveFileTabsRequest struct {
	Tabs []FileTabRequest `json:"tabs"`
}

type FileTabRequest struct {
	ID             string `json:"id"`
	WorkspaceID    string `json:"workspaceId"`
	SessionID      string `json:"sessionId,omitempty"`
	Path           string `json:"path"`
	ViewMode       string `json:"viewMode"`
	IsPinned       bool   `json:"isPinned"`
	Position       int    `json:"position"`
	OpenedAt       string `json:"openedAt"`
	LastAccessedAt string `json:"lastAccessedAt"`
}

func (h *Handlers) SaveFileTabs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	var req SaveFileTabsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Convert request to models
	tabs := make([]*models.FileTab, len(req.Tabs))
	for i, t := range req.Tabs {
		openedAt, err := time.Parse(time.RFC3339, t.OpenedAt)
		if err != nil {
			openedAt = time.Now()
		}
		lastAccessedAt, err := time.Parse(time.RFC3339, t.LastAccessedAt)
		if err != nil {
			lastAccessedAt = time.Now()
		}

		tabs[i] = &models.FileTab{
			ID:             t.ID,
			WorkspaceID:    workspaceID,
			SessionID:      t.SessionID,
			Path:           t.Path,
			ViewMode:       t.ViewMode,
			IsPinned:       t.IsPinned,
			Position:       i,
			OpenedAt:       openedAt,
			LastAccessedAt: lastAccessedAt,
		}
	}

	if err := h.store.SaveFileTabs(ctx, workspaceID, tabs); err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

func (h *Handlers) DeleteFileTab(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tabID := chi.URLParam(r, "tabId")
	if err := h.store.DeleteFileTab(ctx, tabID); err != nil {
		writeDBError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Review comment handlers

type CreateReviewCommentRequest struct {
	FilePath   string `json:"filePath"`
	LineNumber int    `json:"lineNumber"`
	Title      string `json:"title,omitempty"`
	Content    string `json:"content"`
	Source     string `json:"source"`             // "claude" or "user"
	Author     string `json:"author"`             // Display name
	Severity   string `json:"severity,omitempty"` // "error", "warning", "suggestion", "info"
}

func (h *Handlers) ListReviewComments(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Verify session exists
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Check if filtering by file path
	filePath := r.URL.Query().Get("filePath")
	var comments []*models.ReviewComment

	if filePath != "" {
		comments, err = h.store.ListReviewCommentsForFile(ctx, sessionID, filePath)
	} else {
		comments, err = h.store.ListReviewComments(ctx, sessionID)
	}

	if err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, comments)
}

func (h *Handlers) CreateReviewComment(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Verify session exists
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	var req CreateReviewCommentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Validate required fields
	if req.FilePath == "" {
		writeValidationError(w, "filePath is required")
		return
	}
	if req.LineNumber < 1 {
		writeValidationError(w, "lineNumber must be at least 1")
		return
	}
	if req.Content == "" {
		writeValidationError(w, "content is required")
		return
	}
	// Limit content size to prevent abuse (10KB max)
	if len(req.Content) > 10*1024 {
		writeValidationError(w, "content exceeds maximum length of 10KB")
		return
	}
	if req.Source != models.CommentSourceClaude && req.Source != models.CommentSourceUser {
		writeValidationError(w, "source must be 'claude' or 'user'")
		return
	}
	if req.Author == "" {
		writeValidationError(w, "author is required")
		return
	}

	// Validate severity if provided
	if req.Severity != "" && req.Severity != models.CommentSeverityError &&
		req.Severity != models.CommentSeverityWarning && req.Severity != models.CommentSeveritySuggestion &&
		req.Severity != models.CommentSeverityInfo {
		writeValidationError(w, "severity must be 'error', 'warning', 'suggestion', or 'info'")
		return
	}

	comment := &models.ReviewComment{
		ID:         uuid.New().String(),
		SessionID:  sessionID,
		FilePath:   req.FilePath,
		LineNumber: req.LineNumber,
		Title:      req.Title,
		Content:    req.Content,
		Source:     req.Source,
		Author:     req.Author,
		Severity:   req.Severity,
		CreatedAt:  time.Now(),
		Resolved:   false,
	}

	if err := h.store.AddReviewComment(ctx, comment); err != nil {
		writeDBError(w, err)
		return
	}

	// Broadcast WebSocket event for real-time updates
	if h.hub != nil {
		h.hub.Broadcast(Event{
			Type:      "comment_added",
			SessionID: sessionID,
			Payload:   comment,
		})
	}

	w.WriteHeader(http.StatusCreated)
	writeJSON(w, comment)
}

func (h *Handlers) GetReviewCommentStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Verify session exists
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	stats, err := h.store.GetReviewCommentStats(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, stats)
}

type UpdateReviewCommentRequest struct {
	Title      *string `json:"title,omitempty"`
	Content    *string `json:"content,omitempty"`
	Severity   *string `json:"severity,omitempty"`
	Resolved   *bool   `json:"resolved,omitempty"`
	ResolvedBy *string `json:"resolvedBy,omitempty"`
}

func (h *Handlers) UpdateReviewComment(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	commentID := chi.URLParam(r, "commentId")

	// Verify session exists
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Get existing comment
	comment, err := h.store.GetReviewComment(ctx, commentID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if comment == nil || comment.SessionID != sessionID {
		writeNotFound(w, "comment")
		return
	}

	var req UpdateReviewCommentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Validate severity if provided
	if req.Severity != nil && *req.Severity != "" &&
		*req.Severity != models.CommentSeverityError &&
		*req.Severity != models.CommentSeverityWarning &&
		*req.Severity != models.CommentSeveritySuggestion &&
		*req.Severity != models.CommentSeverityInfo {
		writeValidationError(w, "severity must be 'error', 'warning', 'suggestion', or 'info'")
		return
	}

	if err := h.store.UpdateReviewComment(ctx, commentID, func(c *models.ReviewComment) {
		if req.Title != nil {
			c.Title = *req.Title
		}
		if req.Content != nil {
			c.Content = *req.Content
		}
		if req.Severity != nil {
			c.Severity = *req.Severity
		}
		if req.Resolved != nil {
			c.Resolved = *req.Resolved
			if *req.Resolved {
				now := time.Now()
				c.ResolvedAt = &now
				if req.ResolvedBy != nil {
					c.ResolvedBy = *req.ResolvedBy
				}
			} else {
				c.ResolvedAt = nil
				c.ResolvedBy = ""
			}
		}
	}); err != nil {
		writeDBError(w, err)
		return
	}

	// Get updated comment
	comment, err = h.store.GetReviewComment(ctx, commentID)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Broadcast WebSocket event for real-time updates
	if h.hub != nil {
		eventType := "comment_updated"
		if comment.Resolved {
			eventType = "comment_resolved"
		}
		h.hub.Broadcast(Event{
			Type:      eventType,
			SessionID: sessionID,
			Payload:   comment,
		})
	}

	writeJSON(w, comment)
}

func (h *Handlers) DeleteReviewComment(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	commentID := chi.URLParam(r, "commentId")

	// Verify session exists
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Verify comment exists and belongs to session
	comment, err := h.store.GetReviewComment(ctx, commentID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if comment == nil || comment.SessionID != sessionID {
		writeNotFound(w, "comment")
		return
	}

	if err := h.store.DeleteReviewComment(ctx, commentID); err != nil {
		writeDBError(w, err)
		return
	}

	// Broadcast WebSocket event for real-time updates
	if h.hub != nil {
		h.hub.Broadcast(Event{
			Type:      "comment_deleted",
			SessionID: sessionID,
			Payload: map[string]string{
				"id":        commentID,
				"sessionId": sessionID,
			},
		})
	}

	w.WriteHeader(http.StatusNoContent)
}

// GetSessionPRStatus returns PR details including CI check status for a session
func (h *Handlers) GetSessionPRStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Get session
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Check if session has a PR
	if session.PRStatus != "open" || session.PRNumber == 0 {
		writeNotFound(w, "no open PR for this session")
		return
	}

	// Get the workspace to find the repo details
	repo, err := h.store.GetRepo(ctx, session.WorkspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Extract owner/repo from git remote
	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err != nil {
		writeInternalError(w, "failed to get GitHub remote", err)
		return
	}

	// Check if GitHub client is available
	if h.ghClient == nil {
		writeInternalError(w, "GitHub client not configured", nil)
		return
	}

	// Get PR details from GitHub
	prDetails, err := h.ghClient.GetPRDetails(ctx, owner, repoName, session.PRNumber)
	if err != nil {
		writeInternalError(w, "failed to get PR details", err)
		return
	}
	if prDetails == nil {
		writeNotFound(w, "PR")
		return
	}

	writeJSON(w, prDetails)
}

// GeneratePRDescription uses AI to generate a PR title and body from session changes
func (h *Handlers) GeneratePRDescription(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	if h.aiClient == nil {
		writeServiceUnavailable(w, "AI-generated PR descriptions are not available (ANTHROPIC_API_KEY not configured)")
		return
	}

	session, workingPath, baseRef, err := h.getSessionAndWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, workingPath) {
		return
	}

	// Get commits ahead of base
	commits, err := h.repoManager.GetCommitsAheadOfBase(ctx, workingPath, baseRef)
	if err != nil {
		writeInternalError(w, "failed to get commits", err)
		return
	}

	if len(commits) == 0 {
		writeValidationError(w, "no commits ahead of base branch")
		return
	}

	// Convert to AI commit info
	aiCommits := make([]ai.CommitInfo, len(commits))
	for i, c := range commits {
		aiCommits[i] = ai.CommitInfo{
			SHA:     c.SHA,
			Message: c.Message,
			Author:  c.Author,
			Files:   len(c.Files),
		}
	}

	// Get diff summary (cap at 4KB)
	diffSummary, err := h.repoManager.GetDiffSummary(ctx, workingPath, baseRef, 4096)
	if err != nil {
		// Non-fatal: continue without diff
		diffSummary = ""
	}

	// Load custom PR templates (global + workspace, workspace takes precedence)
	globalTemplate, _, _ := h.store.GetSetting(ctx, "pr-template")
	workspaceTemplateKey := fmt.Sprintf("pr-template:%s", session.WorkspaceID)
	workspaceTemplate, _, _ := h.store.GetSetting(ctx, workspaceTemplateKey)

	customPrompt := strings.TrimSpace(globalTemplate)
	if strings.TrimSpace(workspaceTemplate) != "" {
		customPrompt = strings.TrimSpace(workspaceTemplate)
	}

	// Generate PR description via AI
	result, err := h.aiClient.GeneratePRDescription(ctx, ai.GeneratePRRequest{
		Commits:      aiCommits,
		DiffSummary:  diffSummary,
		BranchName:   session.Branch,
		BaseBranch:   baseRef,
		CustomPrompt: customPrompt,
	})
	if err != nil {
		writeInternalError(w, "failed to generate PR description", err)
		return
	}

	writeJSON(w, result)
}

// CreatePRRequest is the request body for creating a pull request
type CreatePRRequest struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	Draft bool   `json:"draft"`
}

// CreatePRResponse is the response from creating a pull request
type CreatePRResponse struct {
	Number  int    `json:"number"`
	HTMLURL string `json:"htmlUrl"`
}

// CreatePR creates a GitHub pull request for the session's branch
func (h *Handlers) CreatePR(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Check GitHub auth
	if h.ghClient == nil || !h.ghClient.IsAuthenticated() {
		writeUnauthorized(w, "GitHub authentication required. Please sign in with GitHub first.")
		return
	}

	session, workingPath, _, err := h.getSessionAndWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, workingPath) {
		return
	}

	// Parse request body
	var req CreatePRRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.Title == "" {
		writeValidationError(w, "title is required")
		return
	}

	// Get GitHub owner/repo from remote
	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, workingPath)
	if err != nil {
		writeInternalError(w, "failed to get GitHub remote", err)
		return
	}

	// Push branch to remote first (PR requires branch to exist on remote)
	if err := h.repoManager.PushBranch(ctx, workingPath, session.Branch); err != nil {
		writeInternalError(w, "failed to push branch", err)
		return
	}

	// Use the session's effective target branch as PR base
	// Strip "origin/" prefix since GitHub expects just the branch name (e.g. "develop", not "origin/develop")
	baseBranch := strings.TrimPrefix(session.EffectiveTargetBranch(), "origin/")

	// Create the PR on GitHub
	prResult, err := h.ghClient.CreatePullRequest(ctx, owner, repoName, github.CreatePullRequestRequest{
		Title: req.Title,
		Body:  req.Body,
		Head:  session.Branch,
		Base:  baseBranch,
		Draft: req.Draft,
	})
	if err != nil {
		writeInternalError(w, "failed to create pull request", err)
		return
	}

	// Update session with PR info
	now := time.Now()
	if err := h.store.UpdateSession(ctx, sessionID, func(sess *models.Session) {
		sess.PRStatus = models.PRStatusOpen
		sess.PRNumber = prResult.Number
		sess.PRUrl = prResult.HTMLURL
		sess.UpdatedAt = now
	}); err != nil {
		// PR was created but we failed to update local state - log but don't fail
		logger.Handlers.Errorf("Failed to update session %s after PR creation: %v", sessionID, err)
	}

	// Register with PR watcher for status tracking
	if h.prWatcher != nil {
		repoPath := session.WorkspacePath
		h.prWatcher.WatchSession(sessionID, session.WorkspaceID, session.Branch, repoPath, models.PRStatusOpen)
	}

	// Broadcast WebSocket event
	h.hub.Broadcast(Event{
		Type:      "session_pr_update",
		SessionID: sessionID,
		Payload: map[string]interface{}{
			"sessionId": sessionID,
			"prStatus":  models.PRStatusOpen,
			"prNumber":  prResult.Number,
			"prUrl":     prResult.HTMLURL,
		},
	})

	writeJSON(w, CreatePRResponse{
		Number:  prResult.Number,
		HTMLURL: prResult.HTMLURL,
	})
}

// GetPRTemplate returns the custom PR template for a workspace
func (h *Handlers) GetPRTemplate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")

	key := fmt.Sprintf("pr-template:%s", workspaceID)
	value, found, err := h.store.GetSetting(ctx, key)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if !found {
		value = ""
	}

	writeJSON(w, map[string]string{"template": value})
}

// SetPRTemplate updates the custom PR template for a workspace
func (h *Handlers) SetPRTemplate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")

	var req struct {
		Template string `json:"template"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	key := fmt.Sprintf("pr-template:%s", workspaceID)
	trimmed := strings.TrimSpace(req.Template)
	if trimmed == "" {
		if err := h.store.DeleteSetting(ctx, key); err != nil {
			writeDBError(w, err)
			return
		}
	} else {
		if err := h.store.SetSetting(ctx, key, trimmed); err != nil {
			writeDBError(w, err)
			return
		}
	}

	writeJSON(w, map[string]string{"status": "ok"})
}

// GetGlobalPRTemplate returns the global custom PR template
func (h *Handlers) GetGlobalPRTemplate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	value, found, err := h.store.GetSetting(ctx, "pr-template")
	if err != nil {
		writeDBError(w, err)
		return
	}
	if !found {
		value = ""
	}

	writeJSON(w, map[string]string{"template": value})
}

// SetGlobalPRTemplate updates the global custom PR template
func (h *Handlers) SetGlobalPRTemplate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		Template string `json:"template"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	trimmed := strings.TrimSpace(req.Template)
	if trimmed == "" {
		if err := h.store.DeleteSetting(ctx, "pr-template"); err != nil {
			writeDBError(w, err)
			return
		}
	} else {
		if err := h.store.SetSetting(ctx, "pr-template", trimmed); err != nil {
			writeDBError(w, err)
			return
		}
	}

	writeJSON(w, map[string]string{"status": "ok"})
}

// getReviewPrompts reads review prompt overrides from the given settings key.
func (h *Handlers) getReviewPrompts(w http.ResponseWriter, ctx context.Context, key string) {
	value, found, err := h.store.GetSetting(ctx, key)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if !found {
		writeJSON(w, map[string]any{"prompts": map[string]string{}})
		return
	}

	var prompts map[string]string
	if err := json.Unmarshal([]byte(value), &prompts); err != nil {
		writeError(w, http.StatusInternalServerError, ErrCodeInternal, "corrupted review prompts data", err)
		return
	}

	writeJSON(w, map[string]any{"prompts": prompts})
}

// setReviewPrompts writes review prompt overrides to the given settings key.
func (h *Handlers) setReviewPrompts(w http.ResponseWriter, r *http.Request, key string) {
	ctx := r.Context()

	var req struct {
		Prompts map[string]string `json:"prompts"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if len(req.Prompts) == 0 {
		if err := h.store.DeleteSetting(ctx, key); err != nil {
			writeDBError(w, err)
			return
		}
	} else {
		data, err := json.Marshal(req.Prompts)
		if err != nil {
			writeValidationError(w, "failed to encode prompts")
			return
		}
		if err := h.store.SetSetting(ctx, key, string(data)); err != nil {
			writeDBError(w, err)
			return
		}
	}

	writeJSON(w, map[string]string{"status": "ok"})
}

// GetReviewPrompts returns the global custom review prompt overrides
func (h *Handlers) GetReviewPrompts(w http.ResponseWriter, r *http.Request) {
	h.getReviewPrompts(w, r.Context(), "review-prompts")
}

// SetReviewPrompts updates the global custom review prompt overrides
func (h *Handlers) SetReviewPrompts(w http.ResponseWriter, r *http.Request) {
	h.setReviewPrompts(w, r, "review-prompts")
}

// GetWorkspaceReviewPrompts returns the per-workspace custom review prompt overrides
func (h *Handlers) GetWorkspaceReviewPrompts(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	h.getReviewPrompts(w, r.Context(), fmt.Sprintf("review-prompts:%s", workspaceID))
}

// SetWorkspaceReviewPrompts updates the per-workspace custom review prompt overrides
func (h *Handlers) SetWorkspaceReviewPrompts(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	h.setReviewPrompts(w, r, fmt.Sprintf("review-prompts:%s", workspaceID))
}

// GetSessionBranchSyncStatus returns how far behind the session is from the target branch
func (h *Handlers) GetSessionBranchSyncStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Get session with workspace data to determine effective target branch
	session, err := h.store.GetSessionWithWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, session.WorktreePath) {
		return
	}

	// Get sync status using effective target branch
	targetBranch := session.EffectiveTargetBranch()
	status, err := h.repoManager.GetBranchSyncStatus(ctx, session.WorktreePath, session.BaseCommitSHA, targetBranch)
	if err != nil {
		writeInternalError(w, "failed to get branch sync status", err)
		return
	}

	// Convert to response format
	commits := make([]models.SyncCommit, len(status.Commits))
	for i, c := range status.Commits {
		commits[i] = models.SyncCommit{
			SHA:     c.SHA,
			Subject: c.Subject,
		}
	}
	response := models.BranchSyncStatus{
		BehindBy:    status.BehindBy,
		Commits:     commits,
		BaseBranch:  status.BaseBranch,
		LastChecked: status.LastChecked.Format(time.RFC3339),
	}

	writeJSON(w, response)
}

// SyncSessionBranch performs a rebase or merge operation on the session branch
func (h *Handlers) SyncSessionBranch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Parse request
	var req models.BranchSyncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Operation != "rebase" && req.Operation != "merge" {
		writeValidationError(w, "operation must be 'rebase' or 'merge'")
		return
	}

	// Get session with workspace data to determine effective target branch
	session, err := h.store.GetSessionWithWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, session.WorktreePath) {
		return
	}

	// Determine effective target branch
	targetBranch := session.EffectiveTargetBranch()

	// Perform the operation with the effective target branch
	var result *git.BranchSyncResult
	if req.Operation == "rebase" {
		result, err = h.repoManager.RebaseOntoTarget(ctx, session.WorktreePath, targetBranch)
	} else {
		result, err = h.repoManager.MergeFromTarget(ctx, session.WorktreePath, targetBranch)
	}

	if err != nil {
		writeInternalError(w, "sync operation failed", err)
		return
	}

	// Update session's base commit SHA if successful
	if result.Success && result.NewBaseSha != "" {
		if err := h.store.UpdateSession(ctx, sessionID, func(s *models.Session) {
			s.BaseCommitSHA = result.NewBaseSha
		}); err != nil {
			logger.Handlers.Warnf("Failed to update session base commit SHA: %v", err)
		}
	}

	// Invalidate branch cache after sync operation
	if repo, err := h.store.GetRepo(ctx, session.WorkspaceID); err == nil && repo != nil {
		h.branchCache.InvalidateRepo(repo.Path)
	}

	// Convert to response format
	response := models.BranchSyncResult{
		Success:       result.Success,
		NewBaseSha:    result.NewBaseSha,
		ConflictFiles: result.ConflictFiles,
		ErrorMessage:  result.ErrorMessage,
	}

	writeJSON(w, response)
}

// AbortSessionSync aborts an in-progress rebase or merge operation
func (h *Handlers) AbortSessionSync(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Get session
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}
	if checkWorktreePath(w, session.WorktreePath) {
		return
	}

	// Check what operation is in progress
	inProgress, err := h.repoManager.GetStatus(ctx, session.WorktreePath, "main")
	if err != nil {
		writeInternalError(w, "failed to check git status", err)
		return
	}

	// Abort the appropriate operation
	switch inProgress.InProgress.Type {
	case "rebase":
		if err := h.repoManager.AbortRebase(ctx, session.WorktreePath); err != nil {
			writeInternalError(w, "failed to abort rebase", err)
			return
		}
	case "merge":
		if err := h.repoManager.AbortMerge(ctx, session.WorktreePath); err != nil {
			writeInternalError(w, "failed to abort merge", err)
			return
		}
	default:
		writeValidationError(w, "no rebase or merge in progress")
		return
	}

	// Invalidate branch cache after abort
	if repo, err := h.store.GetRepo(ctx, session.WorkspaceID); err == nil && repo != nil {
		h.branchCache.InvalidateRepo(repo.Path)
	}

	w.WriteHeader(http.StatusNoContent)
}

// PRDashboardItem represents a PR in the dashboard
type PRDashboardItem struct {
	// PR metadata
	Number         int              `json:"number"`
	Title          string           `json:"title"`
	State          string           `json:"state"`
	HTMLURL        string           `json:"htmlUrl"`
	IsDraft        bool             `json:"isDraft"`
	Mergeable      *bool            `json:"mergeable"`
	MergeableState string           `json:"mergeableState"`
	CheckStatus    string           `json:"checkStatus"`
	CheckDetails   []interface{}    `json:"checkDetails"`
	Labels         []github.PRLabel `json:"labels"`

	// Branch info
	Branch     string `json:"branch"`
	BaseBranch string `json:"baseBranch"`

	// Session info (if created from ChatML)
	SessionID   string `json:"sessionId,omitempty"`
	SessionName string `json:"sessionName,omitempty"`

	// Workspace info
	WorkspaceID   string `json:"workspaceId"`
	WorkspaceName string `json:"workspaceName"`
	RepoOwner     string `json:"repoOwner"`
	RepoName      string `json:"repoName"`

	// Counts for summary
	ChecksTotal  int `json:"checksTotal"`
	ChecksPassed int `json:"checksPassed"`
	ChecksFailed int `json:"checksFailed"`
}

// prURLPattern matches GitHub PR URLs like https://github.com/owner/repo/pull/123
var prURLPattern = regexp.MustCompile(`github\.com/([^/]+)/([^/]+)/pull/(\d+)`)

type ResolvePRRequest struct {
	URL string `json:"url"`
}

type ResolvePRResponse struct {
	Owner              string   `json:"owner"`
	Repo               string   `json:"repo"`
	PRNumber           int      `json:"prNumber"`
	Title              string   `json:"title"`
	Body               string   `json:"body"`
	Branch             string   `json:"branch"`
	BaseBranch         string   `json:"baseBranch"`
	State              string   `json:"state"`
	IsDraft            bool     `json:"isDraft"`
	Labels             []string `json:"labels"`
	Reviewers          []string `json:"reviewers"`
	Additions          int      `json:"additions"`
	Deletions          int      `json:"deletions"`
	ChangedFiles       int      `json:"changedFiles"`
	MatchedWorkspaceID string   `json:"matchedWorkspaceId,omitempty"`
	HTMLURL            string   `json:"htmlUrl"`
}

// ResolvePR parses a GitHub PR URL and returns detailed PR information plus matched workspace
func (h *Handlers) ResolvePR(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if h.ghClient == nil {
		writeValidationError(w, "GitHub client not configured")
		return
	}

	var req ResolvePRRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Parse PR URL
	matches := prURLPattern.FindStringSubmatch(req.URL)
	if matches == nil || len(matches) < 4 {
		writeValidationError(w, "invalid GitHub PR URL: expected format github.com/owner/repo/pull/number")
		return
	}

	owner := matches[1]
	repoName := matches[2]
	prNumber, err := strconv.Atoi(matches[3])
	if err != nil {
		writeValidationError(w, "invalid PR number in URL")
		return
	}

	// Fetch full PR details from GitHub
	prDetails, err := h.ghClient.GetPRFullDetails(ctx, owner, repoName, prNumber)
	if err != nil {
		writeInternalError(w, "failed to fetch PR details", err)
		return
	}

	// Try to match the PR's repo to a registered workspace
	var matchedWorkspaceID string
	repos, err := h.store.ListRepos(ctx)
	if err == nil {
		for _, repo := range repos {
			repoOwner, repoRepo, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
			if err != nil {
				continue
			}
			if strings.EqualFold(repoOwner, owner) && strings.EqualFold(repoRepo, repoName) {
				matchedWorkspaceID = repo.ID
				break
			}
		}
	}

	resp := ResolvePRResponse{
		Owner:              owner,
		Repo:               repoName,
		PRNumber:           prDetails.Number,
		Title:              prDetails.Title,
		Body:               prDetails.Body,
		Branch:             prDetails.Branch,
		BaseBranch:         prDetails.BaseBranch,
		State:              prDetails.State,
		IsDraft:            prDetails.IsDraft,
		Labels:             prDetails.Labels,
		Reviewers:          prDetails.Reviewers,
		Additions:          prDetails.Additions,
		Deletions:          prDetails.Deletions,
		ChangedFiles:       prDetails.ChangedFiles,
		MatchedWorkspaceID: matchedWorkspaceID,
		HTMLURL:            prDetails.HTMLURL,
	}

	writeJSON(w, resp)
}

// ListPRs returns all open PRs across workspaces fetched directly from GitHub
func (h *Handlers) ListPRs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Check if GitHub client is available
	if h.ghClient == nil {
		writeJSON(w, []PRDashboardItem{})
		return
	}

	// Optional workspace filter
	workspaceID := r.URL.Query().Get("workspaceId")

	// Get all repos (or specific repo if filtered)
	var repos []*models.Repo
	var err error

	if workspaceID != "" {
		repo, err := h.store.GetRepo(ctx, workspaceID)
		if err != nil {
			writeDBError(w, err)
			return
		}
		if repo == nil {
			writeNotFound(w, "workspace")
			return
		}
		repos = []*models.Repo{repo}
	} else {
		repos, err = h.store.ListRepos(ctx)
		if err != nil {
			writeDBError(w, err)
			return
		}
	}

	// Collect all PRs
	var prItems []PRDashboardItem

	for _, repo := range repos {
		// Get GitHub remote info for this repo
		owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
		if err != nil {
			// Skip repos without GitHub remote
			continue
		}

		// Check unified PR cache (list + details) with stale-while-revalidate
		cacheEntry, freshness := h.prCache.GetWithStale(owner, repoName)

		var ghPRs []github.PRListItem
		var prDetailsMap map[int]*github.PRDetails

		switch freshness {
		case github.CacheFresh:
			// Serve directly from cache -- zero API calls
			ghPRs = cacheEntry.PRs
			prDetailsMap = cacheEntry.Details

		case github.CacheStale:
			// Serve stale data immediately, trigger background refresh
			ghPRs = cacheEntry.PRs
			prDetailsMap = cacheEntry.Details

			if h.prCache.TryStartRefresh(owner, repoName) {
				go h.refreshPRCache(owner, repoName)
			}

		default:
			// Cache miss -- fetch synchronously with ETag capture
			result, fetchErr := h.ghClient.ListOpenPRsWithETag(ctx, owner, repoName, "")
			if fetchErr != nil {
				continue
			}
			ghPRs = result.PRs

			// Batch fetch all PR details
			prNumbers := make([]int, len(ghPRs))
			for i, pr := range ghPRs {
				prNumbers[i] = pr.Number
			}
			prDetailsMap, _ = h.ghClient.GetPRDetailsBatch(ctx, owner, repoName, prNumbers, 5)

			// Store combined result in cache (including ETag for future conditional requests)
			h.prCache.SetFull(owner, repoName, ghPRs, prDetailsMap, result.ETag)
		}

		// List sessions to match PRs with sessions by branch
		// Include archived sessions since PRs may still be associated with them
		sessions, err := h.store.ListSessions(ctx, repo.ID, true)
		if err != nil {
			sessions = nil // Continue without session matching
		}

		// Build a map of branch -> session for quick lookup
		sessionByBranch := make(map[string]*models.Session)
		if sessions != nil {
			for _, session := range sessions {
				sessionByBranch[session.Branch] = session
			}
		}

		// Process each PR from GitHub
		for _, ghPR := range ghPRs {
			prItem := PRDashboardItem{
				Number:        ghPR.Number,
				Title:         ghPR.Title,
				State:         ghPR.State,
				HTMLURL:       ghPR.HTMLURL,
				IsDraft:       ghPR.IsDraft,
				Branch:        ghPR.Branch,
				BaseBranch:    repo.Branch, // Default branch
				WorkspaceID:   repo.ID,
				WorkspaceName: repo.Name,
				RepoOwner:     owner,
				RepoName:      repoName,
				CheckStatus:   "unknown",
				Labels:        ghPR.Labels,
			}

			// Check if there's a matching session by branch
			if session, ok := sessionByBranch[ghPR.Branch]; ok {
				prItem.SessionID = session.ID
				prItem.SessionName = session.Name
			}

			// Use cached or freshly-fetched PR details
			if prDetailsMap != nil {
				if prDetails, ok := prDetailsMap[ghPR.Number]; ok && prDetails != nil {
					prItem.Mergeable = prDetails.Mergeable
					prItem.MergeableState = prDetails.MergeableState
					prItem.CheckStatus = string(prDetails.CheckStatus)

					// Convert check details
					for _, check := range prDetails.CheckDetails {
						prItem.CheckDetails = append(prItem.CheckDetails, check)
					}

					// Calculate counts
					prItem.ChecksTotal = len(prDetails.CheckDetails)
					for _, check := range prDetails.CheckDetails {
						if check.Status == "completed" {
							if check.Conclusion == "success" || check.Conclusion == "neutral" || check.Conclusion == "skipped" {
								prItem.ChecksPassed++
							} else {
								prItem.ChecksFailed++
							}
						}
					}
				}
			}

			prItems = append(prItems, prItem)
		}
	}

	// Return empty array instead of null
	if prItems == nil {
		prItems = []PRDashboardItem{}
	}

	writeJSON(w, prItems)
}

// refreshPRCache fetches fresh PR data from GitHub in the background
// and updates the unified cache. Called when serving stale data.
// Uses ETag conditional requests to avoid re-fetching unchanged data.
// Respects the prCache shutdown signal so goroutines don't outlive the server.
func (h *Handlers) refreshPRCache(owner, repoName string) {
	defer h.prCache.EndRefresh(owner, repoName)
	defer func() {
		if r := recover(); r != nil {
			logger.Handlers.Errorf("Panic in background PR refresh for %s/%s: %v", owner, repoName, r)
		}
	}()

	// Derive a context that cancels on timeout OR server shutdown (whichever comes first)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	go func() {
		select {
		case <-ctx.Done():
		case <-h.prCache.Done():
			cancel()
		}
	}()

	// Use cached ETag for conditional request
	etag := h.prCache.GetETag(owner, repoName)
	result, err := h.ghClient.ListOpenPRsWithETag(ctx, owner, repoName, etag)

	if errors.Is(err, github.ErrNotModified) {
		// Data unchanged -- atomically refresh the TTL on the existing entry
		h.prCache.BumpTTL(owner, repoName)
		logger.Handlers.Debugf("Background PR refresh for %s/%s: not modified (ETag hit)", owner, repoName)
		return
	}
	if err != nil {
		logger.Handlers.Errorf("Background PR refresh failed for %s/%s: %v", owner, repoName, err)
		return
	}

	// Batch fetch all PR details
	prNumbers := make([]int, len(result.PRs))
	for i, pr := range result.PRs {
		prNumbers[i] = pr.Number
	}
	prDetailsMap, _ := h.ghClient.GetPRDetailsBatch(ctx, owner, repoName, prNumbers, 5)

	// Update the unified cache with new ETag
	h.prCache.SetFull(owner, repoName, result.PRs, prDetailsMap, result.ETag)

	logger.Handlers.Debugf("Background PR refresh complete for %s/%s: %d PRs", owner, repoName, len(result.PRs))
}

// ============================================================================
// Settings endpoints
// ============================================================================

// GetWorkspacesBaseDir returns the configured workspaces base directory
func (h *Handlers) GetWorkspacesBaseDir(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	dir, err := h.getWorkspacesBaseDir(ctx)
	if err != nil {
		writeInternalError(w, "failed to get workspaces base dir", err)
		return
	}
	writeJSON(w, map[string]string{"path": dir})
}

// SetWorkspacesBaseDir updates the configured workspaces base directory
func (h *Handlers) SetWorkspacesBaseDir(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Path == "" {
		// Empty path means reset to default — delete the setting row entirely
		if err := h.store.DeleteSetting(ctx, settingKeyWorkspacesBaseDir); err != nil {
			writeInternalError(w, "failed to delete setting", err)
			return
		}
	} else {
		// Validate that path exists and is a directory
		info, err := os.Stat(req.Path)
		if err != nil {
			writeValidationError(w, fmt.Sprintf("path does not exist: %s", req.Path))
			return
		}
		if !info.IsDir() {
			writeValidationError(w, fmt.Sprintf("path is not a directory: %s", req.Path))
			return
		}
		// Verify the directory is writable by creating and removing a temp file
		testFile, err := os.CreateTemp(req.Path, ".chatml-write-test-*")
		if err != nil {
			writeValidationError(w, fmt.Sprintf("directory is not writable: %s", req.Path))
			return
		}
		testFile.Close()
		os.Remove(testFile.Name())

		if err := h.store.SetSetting(ctx, settingKeyWorkspacesBaseDir, req.Path); err != nil {
			writeInternalError(w, "failed to save setting", err)
			return
		}
	}

	// Return the effective path after save
	dir, err := h.getWorkspacesBaseDir(ctx)
	if err != nil {
		writeInternalError(w, "failed to get workspaces base dir", err)
		return
	}
	writeJSON(w, map[string]string{"path": dir})
}

// GetEnvSettings returns the saved environment variables string
func (h *Handlers) GetEnvSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	envVars, found, err := h.store.GetSetting(ctx, settingKeyEnvVars)
	if err != nil {
		writeInternalError(w, "failed to get env settings", err)
		return
	}
	if !found {
		envVars = ""
	}
	writeJSON(w, map[string]string{"envVars": envVars})
}

// SetEnvSettings saves environment variables to the settings store
func (h *Handlers) SetEnvSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		EnvVars string `json:"envVars"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if err := h.store.SetSetting(ctx, settingKeyEnvVars, req.EnvVars); err != nil {
		writeInternalError(w, "failed to save env settings", err)
		return
	}

	writeJSON(w, map[string]string{"envVars": req.EnvVars})
}

// GetAnthropicApiKey returns whether an API key is configured and a masked version.
func (h *Handlers) GetAnthropicApiKey(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	encrypted, found, err := h.store.GetSetting(ctx, settingKeyAnthropicAPIKey)
	if err != nil {
		writeInternalError(w, "failed to get API key setting", err)
		return
	}
	if !found || encrypted == "" {
		writeJSON(w, map[string]interface{}{"configured": false, "maskedKey": ""})
		return
	}

	// Decrypt to produce a masked version
	decrypted, err := crypto.Decrypt(encrypted)
	if err != nil {
		writeInternalError(w, "failed to decrypt API key", err)
		return
	}

	masked := maskAPIKey(decrypted)
	writeJSON(w, map[string]interface{}{"configured": true, "maskedKey": masked})
}

// SetAnthropicApiKey encrypts and stores (or removes) the Anthropic API key.
func (h *Handlers) SetAnthropicApiKey(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		APIKey string `json:"apiKey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Empty key = remove
	if req.APIKey == "" {
		if err := h.store.DeleteSetting(ctx, settingKeyAnthropicAPIKey); err != nil {
			writeInternalError(w, "failed to remove API key", err)
			return
		}
		writeJSON(w, map[string]interface{}{"configured": false, "maskedKey": ""})
		return
	}

	encrypted, err := crypto.Encrypt(req.APIKey)
	if err != nil {
		writeInternalError(w, "failed to encrypt API key", err)
		return
	}

	if err := h.store.SetSetting(ctx, settingKeyAnthropicAPIKey, encrypted); err != nil {
		writeInternalError(w, "failed to save API key", err)
		return
	}

	writeJSON(w, map[string]interface{}{"configured": true, "maskedKey": maskAPIKey(req.APIKey)})
}

// maskAPIKey returns a masked version of an API key, showing a recognizable
// prefix and the last 4 characters. The prefix is determined dynamically by
// finding the boundary after the third hyphen (e.g. "sk-ant-api03-" → 13 chars)
// or falling back to the first 7 characters.
func maskAPIKey(key string) string {
	if len(key) <= 8 {
		return "****"
	}

	// Find prefix boundary: up to the 3rd hyphen (inclusive)
	prefixEnd := 0
	hyphens := 0
	for i, ch := range key {
		if ch == '-' {
			hyphens++
			if hyphens == 3 {
				prefixEnd = i + 1 // include the hyphen
				break
			}
		}
	}
	if prefixEnd == 0 || prefixEnd >= len(key)-4 {
		prefixEnd = 7 // fallback for keys without hyphens
		if prefixEnd >= len(key)-4 {
			return "****"
		}
	}

	suffix := key[len(key)-4:]
	return key[:prefixEnd] + "..." + suffix
}

// GetClaudeAuthStatus checks all possible sources of Claude/Anthropic credentials
// and returns which ones are available. Sources checked:
//   - Settings-stored encrypted API key
//   - ANTHROPIC_API_KEY environment variable
//   - Claude Code CLI credentials (macOS Keychain or ~/.claude/.credentials.json)
func (h *Handlers) GetClaudeAuthStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Check 1: Settings-stored API key
	hasStoredKey := false
	encrypted, found, err := h.store.GetSetting(ctx, settingKeyAnthropicAPIKey)
	if err == nil && found && encrypted != "" {
		if _, decErr := crypto.Decrypt(encrypted); decErr == nil {
			hasStoredKey = true
		}
	}

	// Check 2: ANTHROPIC_API_KEY environment variable
	hasEnvKey := os.Getenv("ANTHROPIC_API_KEY") != ""

	// Check 3: Claude Code CLI credentials (validates token contents + expiration)
	_, cliErr := ai.ReadClaudeCodeOAuthToken()
	hasCliCredentials := cliErr == nil

	configured := hasStoredKey || hasEnvKey || hasCliCredentials

	writeJSON(w, map[string]interface{}{
		"configured":       configured,
		"hasStoredKey":     hasStoredKey,
		"hasEnvKey":        hasEnvKey,
		"hasCliCredentials": hasCliCredentials,
	})
}


// settingKeyMcpServers returns the settings key for MCP servers in a workspace
func settingKeyMcpServers(workspaceID string) string {
	return "mcp-servers:" + workspaceID
}

// GetMcpServers returns the configured MCP servers for a workspace
func (h *Handlers) GetMcpServers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")

	raw, found, err := h.store.GetSetting(ctx, settingKeyMcpServers(repoID))
	if err != nil {
		writeInternalError(w, "failed to get MCP servers", err)
		return
	}

	if !found || raw == "" {
		writeJSON(w, []models.McpServerConfig{})
		return
	}

	var servers []models.McpServerConfig
	if err := json.Unmarshal([]byte(raw), &servers); err != nil {
		writeInternalError(w, "failed to parse MCP server config", err)
		return
	}

	writeJSON(w, servers)
}

// SetMcpServers saves the MCP server configuration for a workspace
func (h *Handlers) SetMcpServers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")

	var servers []models.McpServerConfig
	if err := json.NewDecoder(r.Body).Decode(&servers); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Validate each server config
	for i, s := range servers {
		if s.Name == "" {
			writeValidationError(w, fmt.Sprintf("server at index %d is missing a name", i))
			return
		}
		switch s.Type {
		case "stdio":
			if s.Command == "" {
				writeValidationError(w, fmt.Sprintf("stdio server %q is missing a command", s.Name))
				return
			}
		case "sse", "http":
			if s.URL == "" {
				writeValidationError(w, fmt.Sprintf("%s server %q is missing a URL", s.Type, s.Name))
				return
			}
		default:
			writeValidationError(w, fmt.Sprintf("server %q has invalid type %q (must be stdio, sse, or http)", s.Name, s.Type))
			return
		}
	}

	data, err := json.Marshal(servers)
	if err != nil {
		writeInternalError(w, "failed to serialize MCP server config", err)
		return
	}

	if err := h.store.SetSetting(ctx, settingKeyMcpServers(repoID), string(data)); err != nil {
		writeInternalError(w, "failed to save MCP servers", err)
		return
	}

	writeJSON(w, servers)
}

