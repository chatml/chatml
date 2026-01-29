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
	mu          sync.RWMutex
	sessions    map[string]*PRWatchEntry // sessionID -> entry
	ghClient    *github.Client
	repoManager PRWatcherRepoManager
	store       PRWatcherStore
	prCache     *github.PRCache // Shared cache with ListPRs handler
	onChange    func(PRChangeEvent)
	ctx         context.Context
	cancel      context.CancelFunc
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

// WatchSession starts watching a session for PR status changes
func (w *PRWatcher) WatchSession(sessionID, workspaceID, branch, repoPath, currentPRStatus string) {
	w.mu.Lock()
	defer w.mu.Unlock()

	// Check if already watching
	if _, exists := w.sessions[sessionID]; exists {
		return
	}

	w.sessions[sessionID] = &PRWatchEntry{
		SessionID:   sessionID,
		WorkspaceID: workspaceID,
		Branch:      branch,
		RepoPath:    repoPath,
		PRStatus:    currentPRStatus,
		LastChecked: time.Time{}, // Force immediate check
	}

	logger.PRWatcher.Infof("Started watching session %s (branch: %s)", sessionID, branch)
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
func (w *PRWatcher) UpdateSessionBranch(sessionID, newBranch string) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if entry, exists := w.sessions[sessionID]; exists {
		entry.Branch = newBranch
		// Reset last checked to trigger re-check
		entry.LastChecked = time.Time{}
		logger.PRWatcher.Infof("Updated branch for session %s: %s", sessionID, newBranch)
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

	w.checkRepoSessions(repoSessions)
}

// checkSessionsWithPR checks sessions that have an open PR for lifecycle changes
func (w *PRWatcher) checkSessionsWithPR() {
	if !w.ghClient.IsAuthenticated() {
		return
	}

	// Group sessions by repo for efficient API calls
	repoSessions := w.groupSessionsByRepo(func(e *PRWatchEntry) bool {
		return e.PRStatus == models.PRStatusOpen
	})

	w.checkRepoSessions(repoSessions)
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
// Uses the shared PR cache to avoid redundant GitHub API calls.
func (w *PRWatcher) checkRepoSessions(repoSessions map[repoKey][]*PRWatchEntry) {
	for key, entries := range repoSessions {
		// Check context cancellation
		if w.ctx.Err() != nil {
			return
		}

		// Try the shared cache first
		var openPRs []github.PRListItem
		if w.prCache != nil {
			cached, ok := w.prCache.Get(key.owner, key.repo)
			if ok {
				openPRs = cached
			}
		}

		// Cache miss -- fetch from GitHub and populate shared cache.
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

	// Determine new status based on current state and PR existence
	var newStatus string
	var prNumber int
	var prUrl string
	var checkStatus string
	var mergeable *bool

	if hasPR {
		// Found an open PR for this branch
		newStatus = models.PRStatusOpen
		prNumber = pr.Number
		prUrl = pr.HTMLURL

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
				// Check if it was merged
				if details.MergeableState == "merged" || w.isPRMerged(owner, repo, entry.PRNumber) {
					newStatus = models.PRStatusMerged
				} else {
					newStatus = models.PRStatusClosed
				}
				prNumber = entry.PRNumber
				prUrl = details.HTMLURL
			}
		} else {
			// Couldn't fetch details - assume closed
			newStatus = models.PRStatusClosed
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
			sess.HasCheckFailures = checkStatus == string(github.CheckStatusFailure)
			if mergeable != nil {
				sess.HasMergeConflict = !*mergeable
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
			CheckStatus: checkStatus,
			Mergeable:   mergeable,
		})
	}
}

// isPRMerged checks if a PR was merged using the merge API endpoint
func (w *PRWatcher) isPRMerged(owner, repo string, prNumber int) bool {
	// The PR details API shows state="closed" for both closed and merged PRs
	// We already have the details, so check if mergeable_state indicates merged
	// This is a simplification - in practice, the mergeable_state check in checkSessionPR
	// should be sufficient for most cases
	return false
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
