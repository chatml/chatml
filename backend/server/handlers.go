package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/branch"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/naming"
	"github.com/chatml/chatml-backend/session"
	"github.com/chatml/chatml-backend/store"
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
}

type branchCacheEntry struct {
	data      *git.BranchListResult
	expiresAt time.Time
}

// NewBranchCache creates a new branch cache with the given TTL
func NewBranchCache(ttl time.Duration) *BranchCache {
	return &BranchCache{
		entries: make(map[string]*branchCacheEntry),
		ttl:     ttl,
	}
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

// DirListingCache provides TTL-based caching for directory listing operations.
// This reduces filesystem operations for frequently accessed directory trees.
type DirListingCache struct {
	mu      sync.RWMutex
	entries map[string]*dirCacheEntry
	ttl     time.Duration
	done    chan struct{}
}

type dirCacheEntry struct {
	data      []*FileNode
	expiresAt time.Time
}

// NewDirListingCache creates a new directory listing cache with the given TTL
func NewDirListingCache(ttl time.Duration) *DirListingCache {
	cache := &DirListingCache{
		entries: make(map[string]*dirCacheEntry),
		ttl:     ttl,
		done:    make(chan struct{}),
	}
	go cache.cleanupLoop()
	return cache
}

// Close stops the cleanup goroutine. Should be called when the cache is no longer needed.
func (c *DirListingCache) Close() {
	close(c.done)
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

// Set stores a directory listing in the cache
func (c *DirListingCache) Set(key string, data []*FileNode) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries[key] = &dirCacheEntry{
		data:      data,
		expiresAt: time.Now().Add(c.ttl),
	}
}

// InvalidatePath removes all cache entries whose keys start with the given path prefix.
// This is used to invalidate cache when files are modified.
// Cache keys are formatted as "type:path:depth:N", so we check if the path portion
// starts with basePath to avoid over-invalidation of unrelated paths.
func (c *DirListingCache) InvalidatePath(basePath string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	for key := range c.entries {
		// Extract path from cache key format "type:path:depth:N"
		// We need to check if the path portion starts with basePath
		if strings.HasPrefix(key, "repo:"+basePath) || strings.HasPrefix(key, "session:"+basePath) {
			delete(c.entries, key)
		}
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
	defer c.mu.Unlock()

	now := time.Now()
	for key, entry := range c.entries {
		if now.After(entry.expiresAt) {
			delete(c.entries, key)
		}
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
	avatarCache      *github.AvatarCache
	statsCache       *SessionStatsCache
}

// writeJSON writes data as JSON response, logging any encoding errors
func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		// Log the error - response headers may already be sent
		fmt.Printf("[handlers] JSON encode error: %v\n", err)
	}
}

func NewHandlers(s *store.SQLiteStore, am *agent.Manager, dirCacheConfig DirListingCacheConfig, bw *branch.Watcher, prw *branch.PRWatcher, hub *Hub, ghClient *github.Client, statsCache *SessionStatsCache) *Handlers {
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
		prCache:          github.NewPRCache(30 * time.Second),   // Cache PR data for 30 seconds
		avatarCache:      github.NewAvatarCache(24 * time.Hour), // Cache avatars for 24 hours
		statsCache:       statsCache,
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

	// Determine base ref: prefer BaseCommitSHA, fall back to workspace branch, then "main".
	// Note: WorkspaceBranch is the repo's default branch (e.g., "main", "master") stored
	// at workspace creation time - it's not a remote tracking ref like "origin/main".
	baseRef = session.BaseCommitSHA
	if baseRef == "" {
		baseRef = session.WorkspaceBranch
		if baseRef == "" {
			baseRef = "main"
		}
	}

	return session, workingPath, baseRef, nil
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

	// Resolve to absolute and verify it's under basePath
	absBase, err := filepath.Abs(basePath)
	if err != nil {
		return "", err
	}
	absPath, err := filepath.Abs(fullPath)
	if err != nil {
		return "", err
	}

	// Ensure path is under base (add trailing slash to prevent prefix attacks)
	if !strings.HasPrefix(absPath, absBase+string(filepath.Separator)) && absPath != absBase {
		return "", fmt.Errorf("path escapes base directory")
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

// DashboardData represents the combined data for initial dashboard load
type DashboardData struct {
	Workspaces []*models.Repo              `json:"workspaces"`
	Sessions   []*SessionWithConversations `json:"sessions"`
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
			Workspaces: repos,
			Sessions:   []*SessionWithConversations{},
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
		Workspaces: repos,
		Sessions:   sessionsWithConvs,
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
	rm := git.NewRepoManager()
	owner, repoName, err := rm.GetGitHubRemote(ctx, repo.Path)
	if err == nil {
		response.GitHubOwner = owner
		response.GitHubRepo = repoName
		response.RemoteURL = fmt.Sprintf("https://github.com/%s/%s", owner, repoName)
	}

	// Get workspaces base directory
	workspacesDir, err := git.WorkspacesBaseDir()
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

	repoMgr := git.NewRepoManager()

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
		branchResult, err = repoMgr.ListBranches(ctx, repo.Path, branchOpts)
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
	currentBranch, _ := repoMgr.GetCurrentBranch(ctx, repo.Path)

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
	// WorktreePath is deprecated - worktrees are now created at ~/.chatml/workspaces/{name}
	WorktreePath string `json:"worktreePath,omitempty"`
	// Task is an optional description of what this session is for
	Task string `json:"task,omitempty"`
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

	// Generate session ID
	sessionID := uuid.New().String()

	// Get workspaces base directory (~/.chatml/workspaces)
	workspacesDir, err := git.WorkspacesBaseDir()
	if err != nil {
		writeInternalError(w, "failed to get workspaces directory", err)
		return
	}

	// Ensure workspaces base directory exists
	if err := os.MkdirAll(workspacesDir, 0755); err != nil {
		writeInternalError(w, "failed to create workspaces directory", err)
		return
	}

	// Generate or use provided session name with atomic directory creation
	sessionName := req.Name
	var sessionPath string

	if sessionName == "" {
		// Atomic session name generation with retry loop
		const maxRetries = 5
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
			if err == nil {
				sessionName = candidateName
				sessionPath = path
				// Add to cache after successful creation
				h.sessionNameCache.Add(sessionName)
				break
			}

			if errors.Is(err, git.ErrDirectoryExists) {
				// Name collision (external change or race) - add to cache and retry
				h.sessionNameCache.Add(candidateName)
				continue
			}

			// Other error - fail the request
			writeInternalError(w, "failed to create session directory", err)
			return
		}

		if sessionName == "" {
			writeConflict(w, "failed to generate unique session name after retries")
			return
		}
	} else {
		// User provided a name - attempt atomic creation
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
		// Add to cache after successful creation
		h.sessionNameCache.Add(sessionName)
	}

	// Generate or use provided branch name
	branchName := req.Branch
	if branchName == "" {
		branchName = fmt.Sprintf("session/%s", sessionName)
	}

	// Lock on the session path to prevent race conditions with delete operations
	h.sessionLocks.Lock(sessionPath)
	defer h.sessionLocks.Unlock(sessionPath)

	// Create git worktree in the atomically created directory
	worktreePath, branchName, baseCommitSHA, err := h.worktreeManager.CreateInExistingDir(ctx, repo.Path, sessionPath, branchName)
	if err != nil {
		// Rollback: remove the atomically created directory and cache entry
		h.sessionNameCache.Remove(sessionName)
		if removeErr := os.RemoveAll(sessionPath); removeErr != nil {
			logger.Handlers.Warnf("Failed to rollback session directory %s: %v", sessionPath, removeErr)
		}
		writeInternalError(w, "failed to create worktree", err)
		return
	}

	// Track rollback state - if any subsequent operation fails, clean up the worktree
	rollback := true
	defer func() {
		if rollback {
			fmt.Printf("[handlers] Rolling back worktree creation due to failure: %s\n", worktreePath)
			h.sessionNameCache.Remove(sessionName)
			session.DeleteMetadata(sessionID)
			// Use background context for cleanup - the original request context may be cancelled
			h.worktreeManager.RemoveAtPath(context.Background(), repo.Path, worktreePath, branchName)
		}
	}()

	now := time.Now()

	// Write session metadata JSON file for portability
	meta := &session.Metadata{
		ID:            sessionID,
		Name:          sessionName,
		WorkspaceID:   workspaceID,
		WorkspacePath: repo.Path,
		WorktreePath:  worktreePath,
		Branch:        branchName,
		BaseCommitSHA: baseCommitSHA,
		CreatedAt:     now,
		Task:          req.Task,
	}
	if err := session.WriteMetadata(meta); err != nil {
		// Log but don't fail - metadata is supplementary
		fmt.Printf("[handlers] Warning: failed to write session metadata: %v\n", err)
	}

	sess := &models.Session{
		ID:            sessionID,
		WorkspaceID:   workspaceID,
		Name:          sessionName,
		Branch:        branchName,
		WorktreePath:  worktreePath,
		BaseCommitSHA: baseCommitSHA,
		Task:          req.Task,
		Status:        "idle",
		PRStatus:      "none",
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
		Content: "",
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
	PRStatus         *string `json:"prStatus,omitempty"`
	PRUrl            *string `json:"prUrl,omitempty"`
	PRNumber         *int    `json:"prNumber,omitempty"`
	HasMergeConflict *bool   `json:"hasMergeConflict,omitempty"`
	HasCheckFailures *bool   `json:"hasCheckFailures,omitempty"`
	Pinned           *bool   `json:"pinned,omitempty"`
	Archived         *bool   `json:"archived,omitempty"`
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
	writeJSON(w, session)
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

	// Clean up worktree if session exists
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
		if repo != nil && sess.WorktreePath != "" {
			// Delete session metadata file (if exists)
			session.DeleteMetadata(sessionID)

			// Remove the git worktree using absolute path
			h.worktreeManager.RemoveAtPath(ctx, repo.Path, sess.WorktreePath, sess.Branch)

			// Remove from session name cache
			h.sessionNameCache.Remove(sess.Name)
		}
	}

	// Delete from DB while still holding the lock (if acquired)
	if err := h.store.DeleteSession(ctx, sessionID); err != nil {
		writeDBError(w, err)
		return
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

	agent, err := h.agentManager.SpawnAgent(repo.Path, repoID, req.Task)
	if err != nil {
		writeInternalError(w, "failed to spawn agent", err)
		return
	}

	writeJSON(w, agent)
}

func (h *Handlers) StopAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h.agentManager.StopAgent(id)
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
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
	MaxThinkingTokens int                 `json:"maxThinkingTokens"` // Enable extended thinking (optional)
	Attachments       []models.Attachment `json:"attachments"`       // File attachments (optional)
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

	// Build options for starting the conversation
	var opts *agent.StartConversationOptions
	if req.MaxThinkingTokens > 0 || len(req.Attachments) > 0 {
		opts = &agent.StartConversationOptions{
			MaxThinkingTokens: req.MaxThinkingTokens,
			Attachments:       req.Attachments,
		}
	}

	conv, err := h.agentManager.StartConversation(sessionID, req.Type, req.Message, opts)
	if err != nil {
		writeInternalError(w, "failed to start conversation", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(conv); err != nil {
		fmt.Printf("[handlers] JSON encode error: %v\n", err)
	}
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

type SendConversationMessageRequest struct {
	Content     string              `json:"content"`
	Attachments []models.Attachment `json:"attachments"` // File attachments (optional)
}

func (h *Handlers) SendConversationMessage(w http.ResponseWriter, r *http.Request) {
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

	var req SendConversationMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Content == "" {
		writeValidationError(w, "content is required")
		return
	}

	if err := h.agentManager.SendConversationMessage(convID, req.Content, req.Attachments); err != nil {
		writeInternalError(w, "failed to send message", err)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]string{"status": "sent"})
}

func (h *Handlers) StopConversation(w http.ResponseWriter, r *http.Request) {
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

	h.agentManager.StopConversation(convID)
	w.WriteHeader(http.StatusNoContent)
}

type RewindConversationRequest struct {
	CheckpointUuid string `json:"checkpointUuid"`
}

func (h *Handlers) RewindConversation(w http.ResponseWriter, r *http.Request) {
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
	conv, err := h.store.GetConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	// Stop the conversation if running
	h.agentManager.StopConversation(convID)

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
	conv, err := h.store.GetConversation(ctx, convID)
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
	Content    string `json:"content"`
	Source     string `json:"source"`             // "claude" or "user"
	Author     string `json:"author"`             // Display name
	Severity   string `json:"severity,omitempty"` // "error", "warning", "suggestion"
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
		req.Severity != models.CommentSeverityWarning && req.Severity != models.CommentSeveritySuggestion {
		writeValidationError(w, "severity must be 'error', 'warning', or 'suggestion'")
		return
	}

	comment := &models.ReviewComment{
		ID:         uuid.New().String(),
		SessionID:  sessionID,
		FilePath:   req.FilePath,
		LineNumber: req.LineNumber,
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
		*req.Severity != models.CommentSeveritySuggestion {
		writeValidationError(w, "severity must be 'error', 'warning', or 'suggestion'")
		return
	}

	if err := h.store.UpdateReviewComment(ctx, commentID, func(c *models.ReviewComment) {
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

// GetSessionBranchSyncStatus returns how far behind the session is from origin/main
func (h *Handlers) GetSessionBranchSyncStatus(w http.ResponseWriter, r *http.Request) {
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

	// Get sync status
	status, err := h.repoManager.GetBranchSyncStatus(ctx, session.WorktreePath, session.BaseCommitSHA)
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

	// Perform the operation
	var result *git.BranchSyncResult
	if req.Operation == "rebase" {
		result, err = h.repoManager.RebaseOntoMain(ctx, session.WorktreePath)
	} else {
		result, err = h.repoManager.MergeFromMain(ctx, session.WorktreePath)
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

		// Check PR cache first
		ghPRs, cacheHit := h.prCache.Get(owner, repoName)
		if !cacheHit {
			// Fetch all open PRs directly from GitHub
			ghPRs, err = h.ghClient.ListOpenPRs(ctx, owner, repoName)
			if err != nil {
				// Log error but continue with other repos
				continue
			}
			// Cache the result
			h.prCache.Set(owner, repoName, ghPRs)
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

		// Collect all PR numbers for batch fetching
		prNumbers := make([]int, len(ghPRs))
		for i, pr := range ghPRs {
			prNumbers[i] = pr.Number
		}

		// Batch fetch all PR details concurrently (max 5 parallel requests)
		prDetailsMap, _ := h.ghClient.GetPRDetailsBatch(ctx, owner, repoName, prNumbers, 5)

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

			// Use batch-fetched PR details
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

			prItems = append(prItems, prItem)
		}
	}

	// Return empty array instead of null
	if prItems == nil {
		prItems = []PRDashboardItem{}
	}

	writeJSON(w, prItems)
}
