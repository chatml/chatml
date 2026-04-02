package tool

import (
	"path/filepath"
	"sync"
)

// ReadTracker tracks which files have been read in a session.
// Used by Edit and Write tools to enforce the "read before modify" invariant,
// matching the reference Claude Code implementation's staleness tracking.
type ReadTracker struct {
	mu   sync.RWMutex
	read map[string]bool // Absolute file paths that have been read
}

// NewReadTracker creates an empty read tracker.
func NewReadTracker() *ReadTracker {
	return &ReadTracker{read: make(map[string]bool)}
}

// MarkRead records that a file has been read in this session.
func (rt *ReadTracker) MarkRead(filePath string) {
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		absPath = filepath.Clean(filePath)
	}
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.read[absPath] = true
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
