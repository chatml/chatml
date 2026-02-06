package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListUserCommands(t *testing.T) {
	t.Run("returns commands from .claude/commands", func(t *testing.T) {
		h, s := setupTestHandlers(t)

		createTestRepo(t, s, "ws-1", "/path/to/repo")
		_, worktreePath := createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

		// Create .claude/commands directory with a command file
		commandsDir := filepath.Join(worktreePath, ".claude", "commands")
		require.NoError(t, os.MkdirAll(commandsDir, 0755))
		writeFile(t, commandsDir, "deploy.md", "# Deploy to production\nRun the deploy script.")

		req := httptest.NewRequest("GET", "/api/sessions/sess-1/commands", nil)
		req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
		w := httptest.NewRecorder()

		h.ListUserCommands(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		var commands []UserCommand
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &commands))
		assert.Len(t, commands, 1)
		assert.Equal(t, "deploy", commands[0].Name)
		assert.Equal(t, "Deploy to production", commands[0].Description)
		assert.Contains(t, commands[0].Content, "Deploy to production")
	})

	t.Run("skips symlinked command files", func(t *testing.T) {
		h, s := setupTestHandlers(t)

		createTestRepo(t, s, "ws-1", "/path/to/repo")
		_, worktreePath := createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

		commandsDir := filepath.Join(worktreePath, ".claude", "commands")
		require.NoError(t, os.MkdirAll(commandsDir, 0755))

		// Create a real command file
		writeFile(t, commandsDir, "real.md", "# Real command")

		// Create a file outside the worktree and symlink to it
		outsideDir := t.TempDir()
		outsideFile := filepath.Join(outsideDir, "secret.txt")
		require.NoError(t, os.WriteFile(outsideFile, []byte("secret data"), 0644))
		require.NoError(t, os.Symlink(outsideFile, filepath.Join(commandsDir, "evil.md")))

		req := httptest.NewRequest("GET", "/api/sessions/sess-1/commands", nil)
		req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
		w := httptest.NewRecorder()

		h.ListUserCommands(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		var commands []UserCommand
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &commands))
		// Only the real command should be returned, symlink should be skipped
		assert.Len(t, commands, 1)
		assert.Equal(t, "real", commands[0].Name)
	})

	t.Run("skips non-md files", func(t *testing.T) {
		h, s := setupTestHandlers(t)

		createTestRepo(t, s, "ws-1", "/path/to/repo")
		_, worktreePath := createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

		commandsDir := filepath.Join(worktreePath, ".claude", "commands")
		require.NoError(t, os.MkdirAll(commandsDir, 0755))

		writeFile(t, commandsDir, "command.md", "# Valid command")
		writeFile(t, commandsDir, "notes.txt", "Not a command")
		writeFile(t, commandsDir, "script.sh", "#!/bin/bash")

		req := httptest.NewRequest("GET", "/api/sessions/sess-1/commands", nil)
		req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
		w := httptest.NewRecorder()

		h.ListUserCommands(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		var commands []UserCommand
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &commands))
		assert.Len(t, commands, 1)
		assert.Equal(t, "command", commands[0].Name)
	})

	t.Run("returns empty list when commands directory does not exist", func(t *testing.T) {
		h, s := setupTestHandlers(t)

		createTestRepo(t, s, "ws-1", "/path/to/repo")
		createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

		req := httptest.NewRequest("GET", "/api/sessions/sess-1/commands", nil)
		req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
		w := httptest.NewRecorder()

		h.ListUserCommands(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		var commands []UserCommand
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &commands))
		assert.Empty(t, commands)
	})

	t.Run("returns empty list for empty commands directory", func(t *testing.T) {
		h, s := setupTestHandlers(t)

		createTestRepo(t, s, "ws-1", "/path/to/repo")
		_, worktreePath := createTestSessionWithWorktree(t, s, "sess-1", "ws-1")

		commandsDir := filepath.Join(worktreePath, ".claude", "commands")
		require.NoError(t, os.MkdirAll(commandsDir, 0755))

		req := httptest.NewRequest("GET", "/api/sessions/sess-1/commands", nil)
		req = withChiContext(req, map[string]string{"sessionId": "sess-1"})
		w := httptest.NewRecorder()

		h.ListUserCommands(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		var commands []UserCommand
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &commands))
		assert.Empty(t, commands)
	})
}

func TestExtractFirstLine(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		expected string
	}{
		{"heading", "# Deploy\nDetails here", "Deploy"},
		{"plain text", "Run the deploy script", "Run the deploy script"},
		{"with frontmatter", "---\nname: test\n---\n# Command\nBody", "Command"},
		{"empty content", "", "Custom command"},
		{"only whitespace", "   \n  \n  ", "Custom command"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractFirstLine(tt.content)
			assert.Equal(t, tt.expected, result)
		})
	}
}
