package context

import (
	"crypto/sha256"
	"fmt"
	"os"
	"sync"

	"github.com/chatml/chatml-core/provider"
)

// DeltaTracker tracks file states for efficient delta-based context updates.
// Instead of re-reading entire files after edits, it computes and caches
// content hashes and can generate delta messages showing only what changed.
type DeltaTracker struct {
	mu     sync.RWMutex
	states map[string]fileState // path -> last known state
}

type fileState struct {
	Hash    string // SHA256 of content
	Size    int64
	Content string // Last known content (cached for diff)
}

// NewDeltaTracker creates an empty delta tracker.
func NewDeltaTracker() *DeltaTracker {
	return &DeltaTracker{states: make(map[string]fileState)}
}

// RecordFileState records the current state of a file (call after Read tool).
func (dt *DeltaTracker) RecordFileState(path, content string) {
	dt.mu.Lock()
	defer dt.mu.Unlock()
	dt.states[path] = fileState{
		Hash:    hashContent(content),
		Size:    int64(len(content)),
		Content: content,
	}
}

// HasChanged returns true if the file content differs from the last recorded state.
func (dt *DeltaTracker) HasChanged(path, currentContent string) bool {
	dt.mu.RLock()
	defer dt.mu.RUnlock()

	prev, ok := dt.states[path]
	if !ok {
		return true // Never seen before = changed
	}
	return prev.Hash != hashContent(currentContent)
}

// FileUnchangedStub returns a stub message for files that haven't changed.
// This allows compaction to skip unchanged file re-reads.
const FileUnchangedStub = "[File unchanged since last read]"

// GenerateDeltaMessages builds context restoration messages that only include
// changed files, using stubs for unchanged ones. This reduces token usage
// when restoring context after compaction.
//
// NOTE: This method does NOT update tracked state. After processing delta
// messages, callers should call RecordFileState for each changed file to
// prevent re-sending the same content on subsequent calls.
func (dt *DeltaTracker) GenerateDeltaMessages(paths []string) []provider.Message {
	if len(paths) == 0 {
		return nil
	}

	// Copy state under lock, then release before file I/O to avoid
	// blocking writers on slow filesystems.
	dt.mu.RLock()
	statesCopy := make(map[string]fileState, len(dt.states))
	for k, v := range dt.states {
		statesCopy[k] = v
	}
	dt.mu.RUnlock()

	var blocks []provider.ContentBlock
	for _, path := range paths {
		prev, hasPrev := statesCopy[path]

		// Read current content
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		currentContent := string(data)
		currentHash := hashContent(currentContent)

		if hasPrev && prev.Hash == currentHash {
			// File unchanged — use stub
			blocks = append(blocks, provider.NewTextBlock(
				fmt.Sprintf("--- %s ---\n%s\n", path, FileUnchangedStub),
			))
		} else {
			// File changed or new — include full content (truncated)
			content := currentContent
			const maxChars = 20000 // ~5K tokens
			if len(content) > maxChars {
				content = content[:maxChars] + "\n... (truncated)"
			}
			blocks = append(blocks, provider.NewTextBlock(
				fmt.Sprintf("--- %s ---\n%s\n", path, content),
			))
		}
	}

	if len(blocks) == 0 {
		return nil
	}

	return []provider.Message{
		{
			Role:    provider.RoleUser,
			Content: blocks,
		},
	}
}

// Clear removes all tracked states.
func (dt *DeltaTracker) Clear() {
	dt.mu.Lock()
	defer dt.mu.Unlock()
	dt.states = make(map[string]fileState)
}

// TrackedPaths returns all currently tracked file paths.
func (dt *DeltaTracker) TrackedPaths() []string {
	dt.mu.RLock()
	defer dt.mu.RUnlock()
	paths := make([]string, 0, len(dt.states))
	for p := range dt.states {
		paths = append(paths, p)
	}
	return paths
}

func hashContent(content string) string {
	h := sha256.Sum256([]byte(content))
	return fmt.Sprintf("%x", h[:8]) // First 8 bytes = 16 hex chars
}
