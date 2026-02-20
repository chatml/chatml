package branch

import (
	"context"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
)

// PRWatchEntry tracks a watched session for PR status changes
type PRWatchEntry struct {
	SessionID   string
	WorkspaceID string
	Branch      string
	RepoPath    string
	PRStatus    string // "none", "open", "merged", "closed"
	PRNumber    int
	PRUrl       string
	PRTitle     string
	CheckStatus string
	Mergeable   *bool
	LastChecked time.Time
}

// PRChangeEvent is emitted when a session's PR status changes
type PRChangeEvent struct {
	SessionID   string
	PRStatus    string
	PRNumber    int
	PRUrl       string
	PRTitle     string
	CheckStatus string
	Mergeable   *bool
}

// PRWatcherStore is the interface for database operations needed by PRWatcher
type PRWatcherStore interface {
	GetSession(ctx context.Context, id string) (*models.Session, error)
	UpdateSession(ctx context.Context, id string, fn func(*models.Session)) error
	GetRepo(ctx context.Context, id string) (*models.Repo, error)
}

// PRWatcherRepoManager is the interface for git operations needed by PRWatcher
type PRWatcherRepoManager interface {
	GetGitHubRemote(ctx context.Context, repoPath string) (owner, repo string, err error)
}

// PRWatcher monitors GitHub for PR status changes on session branches
type PRWatcher struct {
	mu            sync.RWMutex
	sessions      map[string]*PRWatchEntry // sessionID -> entry
	ghClient      *github.Client
	repoManager   PRWatcherRepoManager
	store         PRWatcherStore
	prCache       *github.PRCache // Shared cache with ListPRs handler
	onChange      func(PRChangeEvent)
	ctx           context.Context
	cancel        context.CancelFunc
	backfillOnce  sync.Once
}

// NewPRWatcher creates a new PR watcher
func NewPRWatcher(
	ghClient *github.Client,
	repoManager PRWatcherRepoManager,
	store PRWatcherStore,
	prCache *github.PRCache,
	onChange func(PRChangeEvent),
) *PRWatcher {
	ctx, cancel := context.WithCancel(context.Background())
	w := &PRWatcher{
		sessions:    make(map[string]*PRWatchEntry),
		ghClient:    ghClient,
		repoManager: repoManager,
		store:       store,
		prCache:     prCache,
		onChange:    onChange,
		ctx:         ctx,
		cancel:      cancel,
	}

	go w.run()
	return w
}

// WatchSession starts watching a session for PR status changes.
// If the session is already watched, new PR data is merged in (e.g., when the
// CreatePR handler registers a PR for a session that was already watched at startup).
func (w *PRWatcher) WatchSession(sessionID, workspaceID, branch, repoPath, currentPRStatus string, prNumber int, prUrl string) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if existing, exists := w.sessions[sessionID]; exists {
		// Merge new data into existing entry
		updated := false
		if prNumber > 0 && existing.PRNumber != prNumber {
			existing.PRNumber = prNumber
			existing.PRUrl = prUrl
			existing.PRStatus = currentPRStatus
			existing.LastChecked = time.Time{} // Force re-check
			updated = true
		}
		if branch != "" && existing.Branch != branch {
			existing.Branch = branch
			updated = true
		}
		if updated {
			logger.PRWatcher.Infof("Updated watch for session %s (branch: %s, pr: %d)", sessionID, existing.Branch, existing.PRNumber)
		}
		return
	}

	w.sessions[sessionID] = &PRWatchEntry{
		SessionID:   sessionID,
		WorkspaceID: workspaceID,
		Branch:      branch,
		RepoPath:    repoPath,
		PRStatus:    currentPRStatus,
		PRNumber:    prNumber,
		PRUrl:       prUrl,
		LastChecked: time.Time{}, // Force immediate check
	}

	logger.PRWatcher.Infof("Started watching session %s (branch: %s, pr: %d)", sessionID, branch, prNumber)
}

// UnwatchSession stops watching a session for PR status changes
func (w *PRWatcher) UnwatchSession(sessionID string) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if _, exists := w.sessions[sessionID]; exists {
		delete(w.sessions, sessionID)
		logger.PRWatcher.Infof("Stopped watching session %s", sessionID)
	}
}

// UpdateSessionBranch updates the branch for a watched session (e.g., after branch rename)
// and invalidates the PR cache for the affected repo so the next poll fetches fresh data.
func (w *PRWatcher) UpdateSessionBranch(sessionID, newBranch string) {
	var repoPath string

	w.mu.Lock()
	if entry, exists := w.sessions[sessionID]; exists {
		entry.Branch = newBranch
		// Reset last checked to trigger re-check
		entry.LastChecked = time.Time{}
		repoPath = entry.RepoPath
		logger.PRWatcher.Infof("Updated branch for session %s: %s", sessionID, newBranch)
	}
	w.mu.Unlock()

	// Invalidate PR cache so next tick fetches fresh data from GitHub
	if repoPath != "" && w.prCache != nil {
		owner, repo, err := w.repoManager.GetGitHubRemote(w.ctx, repoPath)
		if err == nil {
			w.prCache.Invalidate(owner, repo)
		}
	}
}

// ensureSessionWatched checks whether a session is already in the watch map.
// If not, it auto-registers it from the database. Returns true if the session
// is (now) watched, false if it could not be registered.
func (w *PRWatcher) ensureSessionWatched(sessionID, caller string) bool {
	w.mu.RLock()
	_, exists := w.sessions[sessionID]
	w.mu.RUnlock()
	if exists {
		return true
	}

	if w.store == nil {
		logger.PRWatcher.Warnf("%s: session %s not in watch map and no store available", caller, sessionID)
		return false
	}

	sess, err := w.store.GetSession(w.ctx, sessionID)
	if err != nil || sess == nil {
		logger.PRWatcher.Warnf("%s: session %s not in watch map and DB lookup failed (err=%v)", caller, sessionID, err)
		return false
	}

	repoPath := ""
	if repo, repoErr := w.store.GetRepo(w.ctx, sess.WorkspaceID); repoErr == nil && repo != nil {
		repoPath = repo.Path
	}
	logger.PRWatcher.Infof("Auto-registering session %s in PRWatcher (%s)", sessionID, caller)
	w.WatchSession(sessionID, sess.WorkspaceID, sess.Branch, repoPath, models.PRStatusNone, 0, "")
	return true
}

// ForceCheckSession invalidates the PR cache for a session's repo and immediately
// checks for PRs. Used when the agent creates a PR via bash so the UI updates
// within seconds instead of waiting for the next poll cycle.
func (w *PRWatcher) ForceCheckSession(sessionID string) {
	if !w.ensureSessionWatched(sessionID, "ForceCheckSession") {
		return
	}

	w.mu.RLock()
	entry, exists := w.sessions[sessionID]
	if !exists {
		w.mu.RUnlock()
		return
	}
	repoPath := entry.RepoPath
	branch := entry.Branch
	w.mu.RUnlock()

	logger.PRWatcher.Infof("Force-checking PR status for session %s (branch: %s)", sessionID, branch)

	// Invalidate cache so we fetch fresh data from GitHub
	if repoPath != "" && w.prCache != nil {
		owner, repo, err := w.repoManager.GetGitHubRemote(w.ctx, repoPath)
		if err == nil {
			w.prCache.Invalidate(owner, repo)
		}
	}

	// Run immediate check for sessions without PR (the common case after `gh pr create`)
	w.checkSessionsWithoutPR()
	// Also check sessions with PR in case this was an update
	w.checkSessionsWithPR()
}

// RegisterPRFromAgent is called when the agent creates a PR via bash (gh pr create).
// If prNumber > 0, the session is updated immediately with the PR info extracted from
// the command output, providing instant UI feedback without a GitHub API round-trip.
// A targeted metadata fetch runs after a short delay to fill in title, checks, and
// mergeable status without racing with GitHub's eventual consistency.
func (w *PRWatcher) RegisterPRFromAgent(sessionID string, prNumber int, prURL string) {
	if prNumber > 0 {
		// Ensure the session is in the watch map before taking the lock.
		// This avoids the fragile unlock-call-relock pattern.
		w.ensureSessionWatched(sessionID, "RegisterPRFromAgent")

		w.mu.Lock()
		entry, exists := w.sessions[sessionID]
		if exists {
			logger.PRWatcher.Infof("Registering PR #%d from agent for session %s", prNumber, sessionID)

			// Update the watch entry
			entry.PRStatus = models.PRStatusOpen
			entry.PRNumber = prNumber
			entry.PRUrl = prURL
			entry.LastChecked = time.Now()
		}
		w.mu.Unlock()

		if exists {
			// Update database
			if w.store != nil {
				if err := w.store.UpdateSession(w.ctx, sessionID, func(sess *models.Session) {
					sess.PRStatus = models.PRStatusOpen
					sess.PRNumber = prNumber
					sess.PRUrl = prURL
					sess.UpdatedAt = time.Now()
					// Auto-update taskStatus: in_progress → in_review
					if sess.TaskStatus == models.TaskStatusInProgress {
						sess.TaskStatus = models.TaskStatusInReview
					}
				}); err != nil {
					logger.PRWatcher.Errorf("Failed to update session %s with PR info: %v", sessionID, err)
				}
			}

			// Emit change event for immediate WebSocket broadcast
			if w.onChange != nil {
				w.onChange(PRChangeEvent{
					SessionID: sessionID,
					PRStatus:  models.PRStatusOpen,
					PRNumber:  prNumber,
					PRUrl:     prURL,
				})
			}
		}

		// Schedule a targeted metadata fetch (title, checks, mergeable) after
		// a short delay. This avoids ForceCheckSession which uses ListOpenPRs
		// and can race with GitHub's eventual consistency right after creation.
		go func() {
			select {
			case <-time.After(3 * time.Second):
			case <-w.ctx.Done():
				return
			}
			w.enrichPRMetadata(sessionID, prNumber)
		}()
		return
	}

	// No PR number extracted (e.g., git push detection) — do a full force check
	// to discover the PR via the open PR list.
	w.ForceCheckSession(sessionID)
}

// enrichPRMetadata fetches PR title, check status, and mergeable for a known PR
// and updates the session. Unlike ForceCheckSession, this uses GetPRDetails (a
// single-PR endpoint) instead of ListOpenPRs, avoiding eventual-consistency races.
func (w *PRWatcher) enrichPRMetadata(sessionID string, prNumber int) {
	w.mu.RLock()
	entry, exists := w.sessions[sessionID]
	if !exists {
		w.mu.RUnlock()
		return
	}
	repoPath := entry.RepoPath
	w.mu.RUnlock()

	owner, repo, err := w.repoManager.GetGitHubRemote(w.ctx, repoPath)
	if err != nil {
		logger.PRWatcher.Warnf("enrichPRMetadata: failed to get remote for session %s: %v", sessionID, err)
		return
	}

	details, err := w.ghClient.GetPRDetails(w.ctx, owner, repo, prNumber)
	if err != nil || details == nil {
		logger.PRWatcher.Warnf("enrichPRMetadata: failed to get PR #%d details for session %s: %v", prNumber, sessionID, err)
		return
	}

	w.mu.Lock()
	// Re-check entry still exists and matches the same PR
	entry, exists = w.sessions[sessionID]
	if !exists || entry.PRNumber != prNumber {
		w.mu.Unlock()
		return
	}

	changed := false
	if details.Title != "" && details.Title != entry.PRTitle {
		entry.PRTitle = details.Title
		changed = true
	}
	checkStatus := string(details.CheckStatus)
	if checkStatus != entry.CheckStatus {
		entry.CheckStatus = checkStatus
		changed = true
	}
	if !boolPtrEqual(details.Mergeable, entry.Mergeable) {
		entry.Mergeable = details.Mergeable
		changed = true
	}
	entry.LastChecked = time.Now()
	w.mu.Unlock()

	if !changed {
		return
	}

	logger.PRWatcher.Infof("Enriched PR #%d metadata for session %s: title=%q, checks=%s",
		prNumber, sessionID, details.Title, checkStatus)

	// Update database
	if w.store != nil {
		if err := w.store.UpdateSession(w.ctx, sessionID, func(sess *models.Session) {
			sess.PRTitle = details.Title
			sess.CheckStatus = checkStatus
			if checkStatus == "" {
				sess.CheckStatus = models.CheckStatusNone
			}
			sess.HasCheckFailures = checkStatus == string(github.CheckStatusFailure)
			if details.Mergeable != nil {
				sess.HasMergeConflict = !*details.Mergeable
			}
		}); err != nil {
			logger.PRWatcher.Errorf("enrichPRMetadata: failed to update session %s: %v", sessionID, err)
		}
	}

	// Emit update event
	if w.onChange != nil {
		w.onChange(PRChangeEvent{
			SessionID:   sessionID,
			PRStatus:    entry.PRStatus,
			PRNumber:    prNumber,
			PRUrl:       entry.PRUrl,
			PRTitle:     details.Title,
			CheckStatus: checkStatus,
			Mergeable:   details.Mergeable,
		})
	}
}

// Close stops the PR watcher
func (w *PRWatcher) Close() error {
	w.cancel()
	logger.PRWatcher.Info("Closed")
	return nil
}

// run is the main polling loop
func (w *PRWatcher) run() {
	// Two-tier polling:
	// - Sessions without PR: check every 30 seconds (eager detection)
	// - Sessions with open PR: check every 2 minutes (lifecycle monitoring)
	fastTicker := time.NewTicker(30 * time.Second)
	slowTicker := time.NewTicker(2 * time.Minute)
	defer fastTicker.Stop()
	defer slowTicker.Stop()

	// Initial delay to let sessions populate
	select {
	case <-w.ctx.Done():
		return
	case <-time.After(5 * time.Second):
	}

	// Immediately check all sessions on startup so merged/closed PRs
	// are detected without waiting for the 2-minute slow ticker.
	w.checkSessionsWithPR()
	w.checkSessionsWithoutPR()

	for {
		select {
		case <-w.ctx.Done():
			return
		case <-fastTicker.C:
			w.checkSessionsWithoutPR()
		case <-slowTicker.C:
			w.checkSessionsWithPR()
		}
	}
}

// checkSessionsWithoutPR checks sessions that don't have an associated PR yet
func (w *PRWatcher) checkSessionsWithoutPR() {
	if !w.ghClient.IsAuthenticated() {
		return
	}

	// Group sessions by repo for efficient API calls
	repoSessions := w.groupSessionsByRepo(func(e *PRWatchEntry) bool {
		return e.PRStatus == "" || e.PRStatus == models.PRStatusNone
	})

	// Skip the shared cache for sessions without a PR. The cache may contain
	// a "fresh" entry populated before the PR was created (or kept alive by
	// BumpTTL after a 304 Not-Modified background refresh), so we must always
	// hit GitHub directly to discover newly created PRs.
	w.checkRepoSessions(repoSessions, true)
}

// checkSessionsWithPR checks sessions that have an associated PR for lifecycle changes.
// Terminal (merged/closed) sessions are piggybacked onto repos that already have open
// sessions, so they don't trigger extra GitHub API calls. This avoids O(n) overhead
// for workspaces with many finished sessions.
func (w *PRWatcher) checkSessionsWithPR() {
	if !w.ghClient.IsAuthenticated() {
		return
	}

	// Primary: sessions with open PRs (these drive the API fetches).
	openSessions := w.groupSessionsByRepo(func(e *PRWatchEntry) bool {
		return e.PRStatus == models.PRStatusOpen
	})

	// Secondary: terminal sessions only for repos that already have open sessions.
	// This detects new PRs created for branches whose previous PR was merged/closed,
	// without adding API calls for repos that have no open sessions.
	terminalSessions := w.groupSessionsByRepo(func(e *PRWatchEntry) bool {
		return e.PRStatus == models.PRStatusMerged || e.PRStatus == models.PRStatusClosed
	})
	for key, entries := range terminalSessions {
		if _, hasOpen := openSessions[key]; hasOpen {
			openSessions[key] = append(openSessions[key], entries...)
		}
	}

	w.checkRepoSessions(openSessions, false)
}

// backfillMissingPRTitles is a one-time startup pass that fetches PR titles
// for sessions that have a PR number but empty title (e.g., sessions created
// before prTitle was added to the data model).
func (w *PRWatcher) backfillMissingPRTitles() {
	if !w.ghClient.IsAuthenticated() {
		return
	}

	repoSessions := w.groupSessionsByRepo(func(e *PRWatchEntry) bool {
		return e.PRTitle == "" && e.PRNumber > 0
	})

	for key, entries := range repoSessions {
		if w.ctx.Err() != nil {
			return
		}

		for _, entry := range entries {
			if w.ctx.Err() != nil {
				return
			}

			details, err := w.ghClient.GetPRDetails(w.ctx, key.owner, key.repo, entry.PRNumber)
			if err != nil || details == nil || details.Title == "" {
				continue
			}

			w.mu.Lock()
			entry.PRTitle = details.Title
			entry.LastChecked = time.Now()
			w.mu.Unlock()

			if w.store != nil {
				_ = w.store.UpdateSession(w.ctx, entry.SessionID, func(sess *models.Session) {
					sess.PRTitle = details.Title
				})
			}
			if w.onChange != nil {
				w.onChange(PRChangeEvent{
					SessionID:   entry.SessionID,
					PRStatus:    entry.PRStatus,
					PRNumber:    entry.PRNumber,
					PRUrl:       entry.PRUrl,
					PRTitle:     details.Title,
					CheckStatus: entry.CheckStatus,
					Mergeable:   entry.Mergeable,
				})
			}

			logger.PRWatcher.Infof("Backfilled PR title for session %s: %q", entry.SessionID, details.Title)
		}
	}
}

// TriggerBackfillPRTitles runs the PR title backfill at most once per process
// lifetime. Safe to call from HTTP handlers — runs async in a goroutine.
func (w *PRWatcher) TriggerBackfillPRTitles() {
	w.backfillOnce.Do(func() {
		go w.backfillMissingPRTitles()
	})
}

// repoKey uniquely identifies a repository
type repoKey struct {
	owner string
	repo  string
}

// groupSessionsByRepo groups sessions by their repository
func (w *PRWatcher) groupSessionsByRepo(filter func(*PRWatchEntry) bool) map[repoKey][]*PRWatchEntry {
	w.mu.RLock()
	defer w.mu.RUnlock()

	result := make(map[repoKey][]*PRWatchEntry)
	for _, entry := range w.sessions {
		if !filter(entry) {
			continue
		}

		// Get owner/repo from path
		owner, repo, err := w.repoManager.GetGitHubRemote(w.ctx, entry.RepoPath)
		if err != nil {
			// No GitHub remote or error - skip this session
			continue
		}

		key := repoKey{owner: owner, repo: repo}
		result[key] = append(result[key], entry)
	}
	return result
}

// checkRepoSessions checks PR status for sessions grouped by repo.
// When skipCache is false, uses the shared PR cache to avoid redundant GitHub
// API calls. When skipCache is true (used by checkSessionsWithoutPR), always
// fetches from GitHub directly — the cache may contain stale data from before
// a PR was created, and BumpTTL can keep it "fresh" indefinitely.
func (w *PRWatcher) checkRepoSessions(repoSessions map[repoKey][]*PRWatchEntry, skipCache bool) {
	for key, entries := range repoSessions {
		// Check context cancellation
		if w.ctx.Err() != nil {
			return
		}

		// Try the shared cache — only use fresh entries (within freshTTL).
		// Skipped for sessions without a PR: the cache can be kept alive by
		// BumpTTL (304 Not-Modified) long after a PR is created, so we must
		// always hit GitHub to discover new PRs.
		var openPRs []github.PRListItem
		if !skipCache && w.prCache != nil {
			entry, freshness := w.prCache.GetWithStale(key.owner, key.repo)
			if freshness == github.CacheFresh && entry != nil {
				openPRs = make([]github.PRListItem, len(entry.PRs))
				copy(openPRs, entry.PRs)
				logger.PRWatcher.Debugf("checkRepoSessions %s/%s: using cached PR list (%d PRs)", key.owner, key.repo, len(openPRs))
			}
		}

		// Cache miss (or skipped) -- fetch from GitHub and populate shared cache.
		// NOTE: This stores PRs without details or ETag. If the HTTP handler
		// hits this entry while fresh, it will serve PRs with unknown check status
		// until the next background refresh cycle populates details.
		if openPRs == nil {
			var err error
			openPRs, err = w.ghClient.ListOpenPRs(w.ctx, key.owner, key.repo)
			if err != nil {
				logger.PRWatcher.Errorf("Failed to list PRs for %s/%s: %v", key.owner, key.repo, err)
				continue
			}
			if w.prCache != nil {
				w.prCache.Set(key.owner, key.repo, openPRs)
			}
			logger.PRWatcher.Debugf("checkRepoSessions %s/%s: fetched fresh PR list from GitHub (%d PRs)", key.owner, key.repo, len(openPRs))
		}

		// Build branch -> PR map for quick lookup
		branchToPR := make(map[string]*github.PRListItem)
		for i := range openPRs {
			branchToPR[openPRs[i].Branch] = &openPRs[i]
		}

		// Check each session
		for _, entry := range entries {
			w.checkSessionPR(key.owner, key.repo, entry, branchToPR)
		}
	}
}

// checkSessionPR checks and updates PR status for a single session
func (w *PRWatcher) checkSessionPR(owner, repo string, entry *PRWatchEntry, branchToPR map[string]*github.PRListItem) {
	pr, hasPR := branchToPR[entry.Branch]

	if !hasPR && (entry.PRStatus == "" || entry.PRStatus == models.PRStatusNone) {
		logger.PRWatcher.Debugf("checkSessionPR session=%s: no PR found for branch=%q (%d open PRs in map)", entry.SessionID, entry.Branch, len(branchToPR))
	}

	// For terminal states (merged/closed), only continue if there's a NEW PR
	// for this branch (different number). This handles the workflow where a PR
	// is merged, development continues, and a new PR is created.
	if entry.PRStatus == models.PRStatusMerged || entry.PRStatus == models.PRStatusClosed {
		if !hasPR || pr.Number == entry.PRNumber {
			return // Same old PR or no PR — nothing to do
		}
		logger.PRWatcher.Infof("Detected new PR #%d for session %s (previous PR #%d was %s)",
			pr.Number, entry.SessionID, entry.PRNumber, entry.PRStatus)
	}

	// Determine new status based on current state and PR existence
	var newStatus string
	var prNumber int
	var prUrl string
	var prTitle string
	var checkStatus string
	var mergeable *bool

	if hasPR {
		// Found an open PR for this branch
		newStatus = models.PRStatusOpen
		prNumber = pr.Number
		prUrl = pr.HTMLURL
		prTitle = pr.Title

		// Try cached details first, then fetch from GitHub
		var details *github.PRDetails
		if w.prCache != nil {
			details, _ = w.prCache.GetDetails(owner, repo, pr.Number)
		}
		if details == nil {
			var err error
			details, err = w.ghClient.GetPRDetails(w.ctx, owner, repo, pr.Number)
			if err == nil && details != nil && w.prCache != nil {
				w.prCache.SetDetails(owner, repo, map[int]*github.PRDetails{pr.Number: details})
			}
		}
		if details != nil {
			checkStatus = string(details.CheckStatus)
			mergeable = details.Mergeable
		}
	} else if entry.PRStatus == models.PRStatusOpen && entry.PRNumber > 0 {
		// Had an open PR but it's no longer in the open list - check if merged or closed
		details, err := w.ghClient.GetPRDetails(w.ctx, owner, repo, entry.PRNumber)
		if err == nil && details != nil {
			if details.State == "closed" {
				// Check if it was merged using the `merged` boolean from the PR response,
				// falling back to the dedicated /merge endpoint
				if details.Merged {
					newStatus = models.PRStatusMerged
				} else if merged, mergeErr := w.ghClient.IsPRMerged(w.ctx, owner, repo, entry.PRNumber); mergeErr == nil && merged {
					newStatus = models.PRStatusMerged
				} else {
					newStatus = models.PRStatusClosed
				}
				prNumber = entry.PRNumber
				prUrl = details.HTMLURL
				prTitle = details.Title
			} else {
				// PR not in open list but details say it's still open.
				// This can happen due to GitHub API eventual consistency.
				// Carry forward existing data to avoid wiping PR association.
				newStatus = entry.PRStatus
				prNumber = entry.PRNumber
				prUrl = entry.PRUrl
				prTitle = entry.PRTitle
				checkStatus = entry.CheckStatus
			}
		} else {
			// Couldn't fetch details - check merge endpoint directly
			if merged, mergeErr := w.ghClient.IsPRMerged(w.ctx, owner, repo, entry.PRNumber); mergeErr == nil && merged {
				newStatus = models.PRStatusMerged
			} else {
				newStatus = models.PRStatusClosed
			}
			prNumber = entry.PRNumber
			prUrl = entry.PRUrl
		}
	} else {
		// No PR found and didn't have one before
		newStatus = models.PRStatusNone
	}

	// Check if anything changed
	changed := false
	if newStatus != entry.PRStatus {
		changed = true
	}
	if prNumber != entry.PRNumber {
		changed = true
	}
	if prTitle != entry.PRTitle {
		changed = true
	}
	if checkStatus != entry.CheckStatus {
		changed = true
	}
	if !boolPtrEqual(mergeable, entry.Mergeable) {
		changed = true
	}

	if !changed {
		// Update last checked time but don't emit event
		w.mu.Lock()
		entry.LastChecked = time.Now()
		w.mu.Unlock()
		return
	}

	// Update entry
	w.mu.Lock()
	entry.PRStatus = newStatus
	entry.PRNumber = prNumber
	entry.PRUrl = prUrl
	entry.PRTitle = prTitle
	entry.CheckStatus = checkStatus
	entry.Mergeable = mergeable
	entry.LastChecked = time.Now()
	w.mu.Unlock()

	logger.PRWatcher.Infof("PR status changed for session %s: status=%s, pr=%d, checks=%s",
		entry.SessionID, newStatus, prNumber, checkStatus)

	// Update database
	if w.store != nil {
		if err := w.store.UpdateSession(w.ctx, entry.SessionID, func(sess *models.Session) {
			sess.PRStatus = newStatus
			sess.PRNumber = prNumber
			sess.PRUrl = prUrl
			sess.PRTitle = prTitle
			sess.HasCheckFailures = checkStatus == string(github.CheckStatusFailure)
			sess.CheckStatus = checkStatus
			if sess.CheckStatus == "" {
				sess.CheckStatus = models.CheckStatusNone
			}
			if newStatus == models.PRStatusOpen && mergeable != nil {
				sess.HasMergeConflict = !*mergeable
			} else if newStatus == models.PRStatusMerged || newStatus == models.PRStatusClosed {
				sess.HasMergeConflict = false
			}

			// Auto-update taskStatus based on PR lifecycle
			if newStatus == models.PRStatusOpen && sess.TaskStatus == models.TaskStatusInProgress {
				sess.TaskStatus = models.TaskStatusInReview
			}
			if newStatus == models.PRStatusMerged {
				sess.TaskStatus = models.TaskStatusDone
			}
		}); err != nil {
			logger.PRWatcher.Errorf("Failed to update session %s in DB: %v", entry.SessionID, err)
		}
	}

	// Emit change event
	if w.onChange != nil {
		w.onChange(PRChangeEvent{
			SessionID:   entry.SessionID,
			PRStatus:    newStatus,
			PRNumber:    prNumber,
			PRUrl:       prUrl,
			PRTitle:     prTitle,
			CheckStatus: checkStatus,
			Mergeable:   mergeable,
		})
	}
}


// boolPtrEqual compares two *bool values for equality
func boolPtrEqual(a, b *bool) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}
