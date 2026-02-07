package server

import (
	"bufio"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/chatml/chatml-backend/logger"
	"github.com/go-chi/chi/v5"
)

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

	commandsDir := filepath.Join(workingPath, ".claude", "commands")

	commands := []UserCommand{}

	entries, err := os.ReadDir(commandsDir)
	if err != nil {
		if os.IsNotExist(err) {
			// No commands directory — return empty list
			writeJSON(w, commands)
			return
		}
		writeInternalError(w, "failed to read commands directory", err)
		return
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}

		name := strings.TrimSuffix(entry.Name(), ".md")
		fullPath := filepath.Join(commandsDir, entry.Name())

		// Skip symlinks to prevent reading files outside the worktree
		if entry.Type()&os.ModeSymlink != 0 {
			logger.Handlers.Warnf("Skipping symlink command file %s", fullPath)
			continue
		}

		content, err := os.ReadFile(fullPath)
		if err != nil {
			logger.Handlers.Warnf("Failed to read command file %s: %v", fullPath, err)
			continue
		}

		description := extractFirstLine(string(content))

		commands = append(commands, UserCommand{
			Name:        name,
			Description: description,
			FilePath:    filepath.Join(".claude", "commands", entry.Name()),
			Content:     string(content),
		})
	}

	writeJSON(w, commands)
}

// extractFirstLine returns the first non-empty content line as a description.
// Skips YAML frontmatter blocks and strips markdown heading prefixes.
func extractFirstLine(content string) string {
	scanner := bufio.NewScanner(strings.NewReader(content))
	inFrontmatter := false

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		// Handle YAML frontmatter (content between two --- delimiters)
		if line == "---" {
			inFrontmatter = !inFrontmatter
			continue
		}
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
