package branch

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

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
	LastBranch   string // Last known branch
}

// Watcher monitors git HEAD files for branch changes
type Watcher struct {
	mu       sync.RWMutex
	watcher  *fsnotify.Watcher
	sessions map[string]*WatchEntry // sessionID -> entry
	onChange func(BranchChangeEvent)
	ctx      context.Context
	cancel   context.CancelFunc
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
	gitDir, err := resolveWorktreeGitDir(worktreePath)
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

	w.sessions[sessionID] = &WatchEntry{
		SessionID:    sessionID,
		WorktreePath: worktreePath,
		GitDir:       gitDir,
		HeadPath:     headPath,
		LastBranch:   currentBranch,
	}

	log.Printf("[branch-watcher] Started watching session %s at %s", sessionID, headPath)
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
			log.Printf("[branch-watcher] Warning: failed to remove watch for %s: %v", entry.GitDir, err)
		}
	}

	delete(w.sessions, sessionID)
	log.Printf("[branch-watcher] Stopped watching session %s", sessionID)
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
			log.Printf("[branch-watcher] Error: %v", err)
		}
	}
}

// handleEvent processes a single fsnotify event
func (w *Watcher) handleEvent(event fsnotify.Event) {
	// Only care about HEAD file changes
	if !strings.HasSuffix(event.Name, "HEAD") {
		return
	}
	// Handle Write, Create, and Rename events
	// Rename is needed because some editors (e.g., vim) use atomic saves
	// which rename a temp file over the target file
	relevantOp := event.Op&fsnotify.Write != 0 ||
		event.Op&fsnotify.Create != 0 ||
		event.Op&fsnotify.Rename != 0
	if !relevantOp {
		return
	}

	// Collect events to emit while holding the lock, then emit outside the lock
	// to avoid blocking the event loop with slow callbacks
	var events []BranchChangeEvent

	w.mu.Lock()
	// Find which session(s) this HEAD file belongs to
	for sessionID, entry := range w.sessions {
		if entry.HeadPath == event.Name {
			newBranch, err := readCurrentBranch(entry.HeadPath)
			if err != nil {
				log.Printf("[branch-watcher] Failed to read branch for %s: %v", sessionID, err)
				continue
			}

			if newBranch != entry.LastBranch {
				oldBranch := entry.LastBranch
				entry.LastBranch = newBranch

				log.Printf("[branch-watcher] Branch changed for session %s: %s -> %s",
					sessionID, oldBranch, newBranch)

				events = append(events, BranchChangeEvent{
					SessionID: sessionID,
					OldBranch: oldBranch,
					NewBranch: newBranch,
				})
			}
		}
	}
	w.mu.Unlock()

	// Emit events outside the lock
	if w.onChange != nil {
		for _, evt := range events {
			w.onChange(evt)
		}
	}
}

// resolveWorktreeGitDir reads the worktree's .git file to find the actual gitdir
func resolveWorktreeGitDir(worktreePath string) (string, error) {
	gitFile := filepath.Join(worktreePath, ".git")

	info, err := os.Stat(gitFile)
	if err != nil {
		return "", err
	}

	// If .git is a directory (not a worktree), the HEAD file is directly in it
	if info.IsDir() {
		return gitFile, nil
	}

	// .git is a file (worktree), read it to find the gitdir
	data, err := os.ReadFile(gitFile)
	if err != nil {
		return "", err
	}

	content := strings.TrimSpace(string(data))
	// Format: "gitdir: /path/to/main/repo/.git/worktrees/session-name"
	if !strings.HasPrefix(content, "gitdir: ") {
		return "", fmt.Errorf("unexpected .git file format: %s", content)
	}

	gitDir := strings.TrimPrefix(content, "gitdir: ")

	// Handle relative paths
	if !filepath.IsAbs(gitDir) {
		gitDir = filepath.Join(worktreePath, gitDir)
	}

	return filepath.Clean(gitDir), nil
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

	// Detached HEAD state - return the commit SHA (first 8 chars)
	if len(content) >= 8 {
		return content[:8] + " (detached)", nil
	}

	return content, nil
}
