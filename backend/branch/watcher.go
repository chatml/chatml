package branch

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/logger"
	"github.com/fsnotify/fsnotify"
)

// BranchChangeEvent is emitted when a session's git branch changes
type BranchChangeEvent struct {
	SessionID string
	OldBranch string
	NewBranch string
}

// WatchEntry tracks a watched HEAD file
type WatchEntry struct {
	SessionID    string
	WorktreePath string
	GitDir       string // The actual gitdir path
	HeadPath     string // Full path to HEAD file
	IndexPath    string // Full path to index file (for stats invalidation)
	LastBranch   string // Last known branch
}

// Watcher monitors git HEAD files for branch changes
type Watcher struct {
	mu                sync.RWMutex
	watcher           *fsnotify.Watcher
	sessions          map[string]*WatchEntry // sessionID -> entry
	onChange              func(BranchChangeEvent)
	onStatsInvalidate    func(sessionID string)              // Called when worktree files change
	onBranchChangeNotify func(sessionID, newBranch string)   // Called when branch changes (e.g., to notify PRWatcher)
	ctx                  context.Context
	cancel            context.CancelFunc
}

// NewWatcher creates a new branch watcher
func NewWatcher(onChange func(BranchChangeEvent)) (*Watcher, error) {
	fsWatcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("failed to create fsnotify watcher: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	w := &Watcher{
		watcher:  fsWatcher,
		sessions: make(map[string]*WatchEntry),
		onChange: onChange,
		ctx:      ctx,
		cancel:   cancel,
	}

	go w.run()
	return w, nil
}

// WatchSession starts watching a session's git HEAD file
func (w *Watcher) WatchSession(sessionID, worktreePath, currentBranch string) error {
	// Resolve gitdir from worktree's .git file
	gitDir, err := git.ResolveGitDir(worktreePath)
	if err != nil {
		return fmt.Errorf("failed to resolve gitdir for %s: %w", worktreePath, err)
	}

	headPath := filepath.Join(gitDir, "HEAD")

	// Verify HEAD file exists
	if _, err := os.Stat(headPath); err != nil {
		return fmt.Errorf("HEAD file not found at %s: %w", headPath, err)
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	// Check if already watching
	if _, exists := w.sessions[sessionID]; exists {
		return nil // Already watching
	}

	// Watch the gitdir directory (fsnotify watches directories, not individual files)
	if err := w.watcher.Add(gitDir); err != nil {
		return fmt.Errorf("failed to watch gitdir %s: %w", gitDir, err)
	}

	// If the stored branch looks like a stale detached-HEAD artifact,
	// re-read the actual branch from HEAD. This self-heals sessions that
	// had their branch corrupted by a transient detached state (e.g., rebase).
	initialBranch := currentBranch
	if strings.Contains(currentBranch, "(detached)") || currentBranch == "HEAD" {
		if actual, err := readCurrentBranch(headPath); err == nil && actual != "" {
			initialBranch = actual
		}
	}

	w.sessions[sessionID] = &WatchEntry{
		SessionID:    sessionID,
		WorktreePath: worktreePath,
		GitDir:       gitDir,
		HeadPath:     headPath,
		IndexPath:    filepath.Join(gitDir, "index"),
		LastBranch:   initialBranch,
	}

	logger.BranchWatcher.Infof("Started watching session %s at %s", sessionID, headPath)

	// Emit a correction event if we healed a stale detached branch
	if initialBranch != currentBranch && initialBranch != "" {
		onChange := w.onChange
		w.mu.Unlock()
		if onChange != nil {
			onChange(BranchChangeEvent{
				SessionID: sessionID,
				OldBranch: currentBranch,
				NewBranch: initialBranch,
			})
		}
		w.mu.Lock()
	}

	return nil
}

// UnwatchSession stops watching a session's git HEAD file
func (w *Watcher) UnwatchSession(sessionID string) {
	w.mu.Lock()
	defer w.mu.Unlock()

	entry, exists := w.sessions[sessionID]
	if !exists {
		return
	}

	// Count how many sessions use this gitdir
	count := 0
	for _, e := range w.sessions {
		if e.GitDir == entry.GitDir {
			count++
		}
	}

	// Only remove watch if this is the last session using this gitdir
	if count == 1 {
		if err := w.watcher.Remove(entry.GitDir); err != nil {
			logger.BranchWatcher.Warnf("Failed to remove watch for %s: %v", entry.GitDir, err)
		}
	}

	delete(w.sessions, sessionID)
	logger.BranchWatcher.Infof("Stopped watching session %s", sessionID)
}

// SetStatsInvalidateCallback sets the callback for stats invalidation
// This is called when working tree files change (detected via git index changes)
func (w *Watcher) SetStatsInvalidateCallback(cb func(sessionID string)) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.onStatsInvalidate = cb
}

// SetBranchChangeNotifyCallback sets a callback invoked on branch changes.
// Used to notify other subsystems (e.g., PRWatcher) when a session's branch is renamed.
func (w *Watcher) SetBranchChangeNotifyCallback(cb func(sessionID, newBranch string)) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.onBranchChangeNotify = cb
}

// Close stops the watcher
func (w *Watcher) Close() error {
	w.cancel()
	return w.watcher.Close()
}

// run processes fsnotify events
func (w *Watcher) run() {
	for {
		select {
		case <-w.ctx.Done():
			return
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			w.handleEvent(event)
		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			logger.BranchWatcher.Errorf("Error: %v", err)
		}
	}
}

// handleEvent processes a single fsnotify event
func (w *Watcher) handleEvent(event fsnotify.Event) {
	// Handle Write, Create, and Rename events
	// Rename is needed because some editors (e.g., vim) use atomic saves
	// which rename a temp file over the target file
	relevantOp := event.Op&fsnotify.Write != 0 ||
		event.Op&fsnotify.Create != 0 ||
		event.Op&fsnotify.Rename != 0
	if !relevantOp {
		return
	}

	isHeadFile := strings.HasSuffix(event.Name, "HEAD")
	isIndexFile := strings.HasSuffix(event.Name, "index")

	// Only care about HEAD or index file changes
	if !isHeadFile && !isIndexFile {
		return
	}

	// Collect events to emit while holding the lock, then emit outside the lock
	// to avoid blocking the event loop with slow callbacks
	var branchEvents []BranchChangeEvent
	var statsInvalidateSessions []string

	w.mu.Lock()
	onStatsInvalidate := w.onStatsInvalidate       // Capture callback while holding lock
	onBranchChangeNotify := w.onBranchChangeNotify // Capture callback while holding lock

	// Find which session(s) this file belongs to
	for sessionID, entry := range w.sessions {
		// Handle HEAD file changes (branch changes)
		if isHeadFile && entry.HeadPath == event.Name {
			newBranch, err := readCurrentBranch(entry.HeadPath)
			if err != nil {
				logger.BranchWatcher.Errorf("Failed to read branch for %s: %v", sessionID, err)
				continue
			}

			// Skip if branch is empty (can happen during file write race conditions)
			// or if the branch hasn't actually changed
			if newBranch == "" || newBranch == entry.LastBranch {
				continue
			}

			oldBranch := entry.LastBranch
			entry.LastBranch = newBranch

			logger.BranchWatcher.Infof("Branch changed for session %s: %s -> %s",
				sessionID, oldBranch, newBranch)

			branchEvents = append(branchEvents, BranchChangeEvent{
				SessionID: sessionID,
				OldBranch: oldBranch,
				NewBranch: newBranch,
			})

			// Branch change also invalidates stats
			statsInvalidateSessions = append(statsInvalidateSessions, sessionID)
		}

		// Handle index file changes (stats invalidation)
		if isIndexFile && entry.IndexPath == event.Name {
			// Only add if not already added from branch change
			found := false
			for _, sid := range statsInvalidateSessions {
				if sid == sessionID {
					found = true
					break
				}
			}
			if !found {
				statsInvalidateSessions = append(statsInvalidateSessions, sessionID)
			}
		}
	}
	w.mu.Unlock()

	// Emit branch change events outside the lock
	if w.onChange != nil {
		for _, evt := range branchEvents {
			w.onChange(evt)
		}
	}

	// Emit stats invalidation events outside the lock
	if onStatsInvalidate != nil {
		for _, sessionID := range statsInvalidateSessions {
			onStatsInvalidate(sessionID)
		}
	}

	// Notify subscribers of branch changes (e.g., PRWatcher)
	if onBranchChangeNotify != nil {
		for _, evt := range branchEvents {
			onBranchChangeNotify(evt.SessionID, evt.NewBranch)
		}
	}
}

// readCurrentBranch reads the branch name from a HEAD file
func readCurrentBranch(headPath string) (string, error) {
	data, err := os.ReadFile(headPath)
	if err != nil {
		return "", err
	}

	content := strings.TrimSpace(string(data))
	// Format: "ref: refs/heads/branch-name"
	if strings.HasPrefix(content, "ref: refs/heads/") {
		return strings.TrimPrefix(content, "ref: refs/heads/"), nil
	}

	// Detached HEAD state — return empty string so the watcher skips
	// the event. Transient detached states (e.g., during rebase) should
	// not overwrite the session's branch name.
	return "", nil
}
