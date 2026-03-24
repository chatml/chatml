package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/ai"
	"github.com/chatml/chatml-backend/branch"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/scripts"
	"github.com/chatml/chatml-backend/store"
	"github.com/fsnotify/fsnotify"
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
	if entry.refCount <= 0 {
		delete(m.locks, path)
		m.mu.Unlock()
		logger.Handlers.Warnf("SessionLockManager: double unlock for path: %s", path)
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
	mu             sync.RWMutex
	entries        map[string]*branchCacheEntry
	ttl            time.Duration
	done           chan struct{}
	lastPruneTime  map[string]time.Time
	pruneCooldown  time.Duration
}

type branchCacheEntry struct {
	data      *git.BranchListResult
	expiresAt time.Time
}

// NewBranchCache creates a new branch cache with the given TTL
func NewBranchCache(ttl time.Duration) *BranchCache {
	c := &BranchCache{
		entries:       make(map[string]*branchCacheEntry),
		ttl:           ttl,
		done:          make(chan struct{}),
		lastPruneTime: make(map[string]time.Time),
		pruneCooldown: 30 * time.Minute,
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

// ShouldPrune returns true if enough time has passed since the last prune for this repo.
func (c *BranchCache) ShouldPrune(repoPath string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	last, ok := c.lastPruneTime[repoPath]
	if !ok {
		return true
	}
	return time.Since(last) > c.pruneCooldown
}

// MarkPruned records that a prune was performed for a repo.
func (c *BranchCache) MarkPruned(repoPath string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lastPruneTime[repoPath] = time.Now()
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

// baseBranchCacheEntry holds a cached branch name with expiry.
type baseBranchCacheEntry struct {
	branch    string
	expiresAt time.Time
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
	baseBranchCache  sync.Map // sessionID → *baseBranchCacheEntry (2s TTL)
	branchWatcher    *branch.Watcher
	prWatcher        *branch.PRWatcher
	hub              *Hub // For broadcasting WebSocket events
	ghClient         *github.Client
	prCache          *github.PRCache
	issueCache       *github.IssueCache
	avatarCache      *github.AvatarCache
	statsCache       *SessionStatsCache
	diffCache        *DiffCache
	snapshotCache    *SnapshotCache
	aiClient         ai.Provider
	scriptRunner     *scripts.Runner
	serverCtx        context.Context
	serverCancel     context.CancelFunc
	bgWg             sync.WaitGroup
}

// Close cancels background goroutines, waits for them to drain, then releases
// resources owned by Handlers (caches with background goroutines).
func (h *Handlers) Close() {
	h.serverCancel()

	done := make(chan struct{})
	go func() { h.bgWg.Wait(); close(done) }()
	select {
	case <-done:
		logger.Handlers.Info("All background goroutines completed")
	case <-time.After(5 * time.Second):
		logger.Handlers.Warn("Timed out waiting for background goroutines")
	}

	h.dirCache.Close()
	h.branchCache.Close()
	h.avatarCache.Close()
	if h.snapshotCache != nil {
		h.snapshotCache.Close()
	}
}

// goBackground launches fn as a tracked background goroutine.
// The goroutine is counted in bgWg so Close() can wait for completion.
// It is a no-op if the server context is already cancelled (shutting down).
func (h *Handlers) goBackground(fn func()) {
	if h.serverCtx.Err() != nil {
		return
	}
	h.bgWg.Add(1)
	go func() {
		defer h.bgWg.Done()
		fn()
	}()
}

// getAIClient returns an AI provider using the agent manager's multi-source
// credential cascade (settings → env → keychain → credentials file → cached
// SDK token). Each call re-evaluates credentials so expired tokens are
// automatically replaced. If h.aiClient is set (e.g. in tests), it is
// returned directly.
func (h *Handlers) getAIClient() ai.Provider {
	if h.aiClient != nil {
		return h.aiClient
	}
	if h.agentManager != nil {
		return h.agentManager.CreateAIClient()
	}
	return nil
}

// GetProviderCapabilities returns the current AI agent provider's capabilities.
func (h *Handlers) GetProviderCapabilities(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, agent.DefaultProvider())
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

// settingKeyGitHubPersonalToken is the settings key for the encrypted GitHub personal access token
const settingKeyGitHubPersonalToken = "github-personal-token"

// settingKeyGitHubPersonalTokenUser is the settings key for the GitHub username associated with the PAT
const settingKeyGitHubPersonalTokenUser = "github-personal-token-user"

// settingKeyGitHubPersonalTokenMasked is the settings key for the pre-computed masked token display string
const settingKeyGitHubPersonalTokenMasked = "github-personal-token-masked"

// getWorkspacesBaseDir returns the configured workspaces base directory,
// falling back to the default (~/Library/Application Support/ChatML/workspaces) if not configured.
func (h *Handlers) getWorkspacesBaseDir(ctx context.Context) (string, error) {
	configured, _, err := h.store.GetSetting(ctx, settingKeyWorkspacesBaseDir)
	if err != nil {
		return "", fmt.Errorf("failed to read workspaces base dir setting: %w", err)
	}
	return git.WorkspacesBaseDirWithOverride(configured)
}

func NewHandlers(ctx context.Context, s *store.SQLiteStore, am *agent.Manager, dirCacheConfig DirListingCacheConfig, bw *branch.Watcher, prw *branch.PRWatcher, hub *Hub, ghClient *github.Client, prCache *github.PRCache, issueCache *github.IssueCache, statsCache *SessionStatsCache, diffCache *DiffCache, snapshotCache *SnapshotCache, aiClient ai.Provider, scriptRunner *scripts.Runner) *Handlers {
	serverCtx, serverCancel := context.WithCancel(ctx)

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
		diffCache:        diffCache,
		snapshotCache:    snapshotCache,
		aiClient:         aiClient,
		scriptRunner:     scriptRunner,
		serverCtx:        serverCtx,
		serverCancel:     serverCancel,
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

	// For base sessions, dynamically read the current branch from git.
	// The DB branch field may be stale if the user switched branches externally.
	// Use a short TTL cache to avoid spawning a git subprocess on every call.
	if session.IsBaseSession() {
		const baseBranchTTL = 2 * time.Second
		usedCache := false
		if cached, ok := h.baseBranchCache.Load(session.ID); ok {
			if entry := cached.(*baseBranchCacheEntry); time.Now().Before(entry.expiresAt) {
				session.Branch = entry.branch
				usedCache = true
			}
		}
		if !usedCache {
			if currentBranch, brErr := h.repoManager.GetCurrentBranch(ctx, workingPath); brErr == nil && currentBranch != "" {
				session.Branch = currentBranch
				h.baseBranchCache.Store(session.ID, &baseBranchCacheEntry{
					branch:    currentBranch,
					expiresAt: time.Now().Add(baseBranchTTL),
				})
			}
		}
	}

	// Compute the merge-base between the target branch and HEAD.
	// This gives us the exact fork point, which is stable even when
	// the target branch advances or the agent rebases directly.
	// Using the live tracking ref (e.g. origin/main) directly would cause
	// phantom file changes whenever main advances ahead of the session.
	targetBranch := session.EffectiveTargetBranch()
	mergeBase, mbErr := h.repoManager.GetMergeBase(ctx, workingPath, targetBranch, "HEAD")
	if mbErr == nil && mergeBase != "" {
		baseRef = mergeBase
	} else if session.BaseCommitSHA != "" {
		// Fallback: use stored base commit SHA
		baseRef = session.BaseCommitSHA
	} else {
		// Last resort: use the live target branch ref (original behavior)
		baseRef = targetBranch
	}

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
// effectiveTargetBranch should be the fully-qualified remote ref (e.g. "origin/main"),
// matching the logic from SessionWithWorkspace.EffectiveTargetBranch().
func (h *Handlers) computeSessionStats(ctx context.Context, session *models.Session, effectiveTargetBranch string) *models.SessionStats {
	workingPath := session.WorktreePath
	if workingPath == "" {
		return nil
	}

	// Compute merge-base for accurate diff base, consistent with getSessionAndWorkspace.
	// This avoids phantom file changes when the target branch advances.
	baseRef, mbErr := h.repoManager.GetMergeBase(ctx, workingPath, effectiveTargetBranch, "HEAD")
	if mbErr != nil || baseRef == "" {
		// Fallback: prefer BaseCommitSHA, then effective target branch
		baseRef = session.BaseCommitSHA
		if baseRef == "" {
			baseRef = effectiveTargetBranch
		}
	}

	// Get tracked changes
	changes, err := h.repoManager.GetChangedFilesWithStats(ctx, workingPath, baseRef)
	if err != nil {
		// Silently return nil on error - stats are optional
		return nil
	}

	// Get untracked files
	untracked, untrackedErr := h.repoManager.GetUntrackedFiles(ctx, workingPath)
	if untrackedErr != nil {
		logger.Handlers.Warnf("computeSessionStats: GetUntrackedFiles failed for %s: %v", workingPath, untrackedErr)
	}

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

// uncachedSession pairs a session with its workspace for background stats computation.
type uncachedSession struct {
	session   *models.Session
	workspace *models.Repo
}

// computeAndBroadcastStats computes stats for sessions not in cache and pushes
// results via WebSocket. Runs as a background goroutine so ListSessions
// returns immediately.
func (h *Handlers) computeAndBroadcastStats(sessions []uncachedSession) {
	// Per-batch timeout as safety net (individual git commands have their own timeouts)
	ctx, cancel := context.WithTimeout(h.serverCtx, 5*time.Minute)
	defer cancel()

	sem := make(chan struct{}, 5) // Max 5 concurrent git processes
	var wg sync.WaitGroup

	for _, us := range sessions {
		// Stop spawning new goroutines if context is cancelled (shutdown or timeout)
		if ctx.Err() != nil {
			break
		}

		wg.Add(1)
		go func(s *models.Session, ws *models.Repo) {
			defer wg.Done()

			// Context-aware semaphore acquisition
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}

			effectiveTarget := s.TargetBranch
			if effectiveTarget == "" {
				remote := "origin"
				branch := "main"
				if ws != nil {
					if ws.Remote != "" {
						remote = ws.Remote
					}
					if ws.Branch != "" {
						branch = ws.Branch
					}
				}
				effectiveTarget = remote + "/" + branch
			}

			stats := h.computeSessionStats(ctx, s, effectiveTarget)
			if ctx.Err() != nil {
				return // Don't cache or broadcast partial results
			}
			h.statsCache.Set(s.ID, stats)

			h.hub.Broadcast(Event{
				Type:      "session_stats_update",
				SessionID: s.ID,
				Payload: map[string]interface{}{
					"sessionId": s.ID,
					"stats":     stats,
				},
			})
		}(us.session, us.workspace)
	}
	wg.Wait()
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

