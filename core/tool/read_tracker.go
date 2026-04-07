package tool

import (
	"path/filepath"
	"sync"
)

// ReadTracker tracks which files have been read in a session.
// Used by Edit and Write tools to enforce the "read before modify" invariant,
// matching the reference Claude Code implementation's staleness tracking.
// Also tracks read order for post-compact restoration of recent file reads.
type ReadTracker struct {
	mu    sync.RWMutex
	read  map[string]bool // Absolute file paths that have been read
	order []string        // Read order (most recent last), no duplicates
}

// NewReadTracker creates an empty read tracker.
func NewReadTracker() *ReadTracker {
	return &ReadTracker{
		read:  make(map[string]bool),
		order: make([]string, 0, 32),
	}
}

// MarkRead records that a file has been read in this session.
func (rt *ReadTracker) MarkRead(filePath string) {
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		absPath = filepath.Clean(filePath)
	}
	rt.mu.Lock()
	defer rt.mu.Unlock()

	if !rt.read[absPath] {
		rt.read[absPath] = true
		rt.order = append(rt.order, absPath)
	} else {
		// Move to end (most recently read)
		for i, p := range rt.order {
			if p == absPath {
				rt.order = append(rt.order[:i], rt.order[i+1:]...)
				break
			}
		}
		rt.order = append(rt.order, absPath)
	}
}

// HasBeenRead returns true if the file has been read in this session.
func (rt *ReadTracker) HasBeenRead(filePath string) bool {
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		absPath = filepath.Clean(filePath)
	}
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	return rt.read[absPath]
}

// RecentFiles returns the N most recently read file paths (most recent first).
func (rt *ReadTracker) RecentFiles(n int) []string {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	total := len(rt.order)
	if n > total {
		n = total
	}
	if n <= 0 {
		return nil
	}

	// Return from end of order slice (most recent)
	result := make([]string, n)
	for i := 0; i < n; i++ {
		result[i] = rt.order[total-1-i]
	}
	return result
}
