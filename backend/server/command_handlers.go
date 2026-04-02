package server

import (
	"bufio"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/paths"
	"github.com/go-chi/chi/v5"
)

// maxCommandFileSize is the maximum allowed size for command files (50MB).
// Exposed as a var for testing.
var maxCommandFileSize int64 = 50 * 1024 * 1024

// UserCommand represents a user-defined command from .claude/commands/*.md
type UserCommand struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	FilePath    string `json:"filePath"`
	Content     string `json:"content"`
}

// ListUserCommands returns user-defined commands from .claude/commands/ in the session worktree
func (h *Handlers) ListUserCommands(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	session, err := h.store.GetSessionWithWorkspace(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	workingPath := session.WorktreePath
	if workingPath == "" {
		workingPath = session.WorkspacePath
	}

	if checkWorktreePath(w, workingPath) {
		return
	}

	// Check both .chatml/commands and .claude/commands directories
	primaryDir, fallbackDir := paths.CommandsDirPaths(workingPath)

	commands := []UserCommand{}
	seenNames := make(map[string]bool)

	for _, commandsDir := range []string{primaryDir, fallbackDir} {
		entries, err := os.ReadDir(commandsDir)
		if err != nil {
			continue
		}

		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			if !strings.HasSuffix(entry.Name(), ".md") {
				continue
			}

			name := strings.TrimSuffix(entry.Name(), ".md")

			// Dedup: primary dir wins over fallback
			if seenNames[name] {
				continue
			}

			fullPath := filepath.Join(commandsDir, entry.Name())

			// Skip symlinks to prevent reading files outside the worktree
			if entry.Type()&os.ModeSymlink != 0 {
				logger.Handlers.Warnf("Skipping symlink command file %s", fullPath)
				continue
			}

			// Skip files that exceed the size limit
			info, err := entry.Info()
			if err != nil {
				logger.Handlers.Warnf("Failed to stat command file %s: %v", fullPath, err)
				continue
			}
			if info.Size() > maxCommandFileSize {
				logger.Handlers.Warnf("Skipping oversized command file %s (%d bytes, limit %d)", fullPath, info.Size(), maxCommandFileSize)
				continue
			}

			content, err := os.ReadFile(fullPath)
			if err != nil {
				logger.Handlers.Warnf("Failed to read command file %s: %v", fullPath, err)
				continue
			}

			seenNames[name] = true
			description := extractFirstLine(string(content))

			// Compute relative path from workspace
			relDir, _ := filepath.Rel(workingPath, commandsDir)
			commands = append(commands, UserCommand{
				Name:        name,
				Description: description,
				FilePath:    filepath.Join(relDir, entry.Name()),
				Content:     string(content),
			})
		}
	}

	writeJSON(w, commands)
}

// extractFirstLine returns the first non-empty content line as a description.
// Skips YAML frontmatter blocks and strips markdown heading prefixes.
func extractFirstLine(content string) string {
	scanner := bufio.NewScanner(strings.NewReader(content))
	inFrontmatter := false
	frontmatterDone := false
	beforeContent := true

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		if beforeContent && line == "" {
			continue
		}

		// Only allow frontmatter at the very start of the file
		if line == "---" && !frontmatterDone {
			if beforeContent || inFrontmatter {
				inFrontmatter = !inFrontmatter
				if !inFrontmatter {
					frontmatterDone = true
				}
				beforeContent = false
				continue
			}
		}
		beforeContent = false

		if inFrontmatter {
			continue
		}

		if line == "" {
			continue
		}

		// Strip markdown heading prefix (e.g., "## Title" → "Title")
		for strings.HasPrefix(line, "#") {
			line = line[1:]
		}
		line = strings.TrimSpace(line)

		if line != "" {
			// Truncate long descriptions (rune-based to avoid splitting multi-byte UTF-8)
			runes := []rune(line)
			if len(runes) > 120 {
				return string(runes[:117]) + "..."
			}
			return line
		}
	}
	return "Custom command"
}
