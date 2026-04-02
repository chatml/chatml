package tool

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
)

const (
	// DefaultMaxInlineBytes is the maximum size of a tool result that stays inline.
	// Results larger than this are persisted to disk with a preview.
	DefaultMaxInlineBytes = 50 * 1024 // 50KB

	// DefaultPreviewBytes is the preview size included in the persisted result message.
	DefaultPreviewBytes = 2 * 1024 // 2KB
)

// ResultPersister manages large tool result persistence to disk.
// When a tool result exceeds the inline limit, the full content is written
// to a session-specific directory and a preview is returned instead.
type ResultPersister struct {
	mu         sync.Mutex
	dir        string // Session directory for persisted results
	maxInline  int    // Max bytes to keep inline
	previewLen int    // Preview size for persisted results
	initialized bool
}

// NewResultPersister creates a persister that writes to the given session directory.
func NewResultPersister(sessionDir string) *ResultPersister {
	return &ResultPersister{
		dir:        filepath.Join(sessionDir, "tool-results"),
		maxInline:  DefaultMaxInlineBytes,
		previewLen: DefaultPreviewBytes,
	}
}

// MaybePersist checks if content exceeds the inline limit. If so, it writes
// the full content to disk and returns a preview with a file reference.
// Returns the content to use inline and whether persistence occurred.
func (p *ResultPersister) MaybePersist(toolUseID, content string) (inline string, persisted bool) {
	if len(content) <= p.maxInline {
		return content, false
	}

	// Ensure directory exists (lazy init)
	p.mu.Lock()
	if !p.initialized {
		if err := os.MkdirAll(p.dir, 0755); err != nil {
			p.mu.Unlock()
			// If we can't create the directory, return truncated content
			return p.truncate(content, toolUseID), false
		}
		p.initialized = true
	}
	p.mu.Unlock()

	// Sanitize toolUseID to prevent path traversal. The ID comes from the LLM
	// response and could contain "../" sequences in a prompt-injection attack.
	safeName := sanitizeToolUseID(toolUseID)

	// Write full content to disk
	filePath := filepath.Join(p.dir, safeName+".txt")
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		return p.truncate(content, toolUseID), false
	}

	// Build preview
	preview := content
	if len(preview) > p.previewLen {
		preview = preview[:p.previewLen]
	}

	return fmt.Sprintf(
		"<persisted-output>\nOutput too large (%s). Full output saved to: %s\n\nPreview (first %dKB):\n%s\n...</persisted-output>",
		formatSize(len(content)), filePath, p.previewLen/1024, preview,
	), true
}

// truncate returns a truncated version of content as a fallback.
func (p *ResultPersister) truncate(content, toolUseID string) string {
	if len(content) <= p.maxInline {
		return content
	}
	return content[:p.maxInline] + fmt.Sprintf("\n... (output truncated, %d bytes total)", len(content))
}

// formatSize returns a human-readable size string.
func formatSize(bytes int) string {
	if bytes < 1024 {
		return fmt.Sprintf("%d bytes", bytes)
	}
	kb := float64(bytes) / 1024
	if kb < 1024 {
		return fmt.Sprintf("%.1fKB", kb)
	}
	mb := kb / 1024
	return fmt.Sprintf("%.1fMB", mb)
}

// safeIDRe matches typical LLM tool-use IDs (alphanumeric, underscores, dashes).
var safeIDRe = regexp.MustCompile(`^[a-zA-Z0-9_\-]{1,128}$`)

// sanitizeToolUseID ensures the tool use ID is safe for use as a filename.
// If the ID contains path separators, ".." sequences, or other suspicious
// characters, it is replaced with a SHA-256 hash prefix.
func sanitizeToolUseID(id string) string {
	if safeIDRe.MatchString(id) {
		return id
	}
	h := sha256.Sum256([]byte(id))
	return fmt.Sprintf("result-%x", h[:8])
}

// Cleanup removes the persisted results directory.
func (p *ResultPersister) Cleanup() {
	os.RemoveAll(p.dir)
}
