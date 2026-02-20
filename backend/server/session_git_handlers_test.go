package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func getCommitSHA(t *testing.T, dir string) string {
	t.Helper()
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = dir
	out, err := cmd.Output()
	require.NoError(t, err)
	return strings.TrimSpace(string(out))
}

// createAndCommitFile creates a file and commits it
func createAndCommitFile(t *testing.T, dir, name, content, message string) {
	t.Helper()
	writeFile(t, dir, name, content)
	runGit(t, dir, "add", name)
	runGit(t, dir, "commit", "-m", message)
}

// createSessionWithGitWorktree creates a workspace + session backed by a real git repo
func createSessionWithGitWorktree(t *testing.T, h *Handlers, s *store.SQLiteStore, workspaceID, sessionID string) (string, string) {
	t.Helper()
	ctx := context.Background()

	repoPath := createTestGitRepo(t)
	baseSHA := getCommitSHA(t, repoPath)

	repo := &models.Repo{
		ID:        workspaceID,
		Name:      "test-repo",
		Path:      repoPath,
		Branch:    "main",
		CreatedAt: time.Now(),
	}
	require.NoError(t, s.AddRepo(ctx, repo))

	session := &models.Session{
		ID:            sessionID,
		WorkspaceID:   workspaceID,
		Name:          "Test Session",
		Status:        "idle",
		WorktreePath:  repoPath,
		BaseCommitSHA: baseSHA,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))

	return repoPath, baseSHA
}

func TestGetSessionBranchCommits_NoCommitsAhead(t *testing.T) {
	h, s := setupTestHandlers(t)
	createSessionWithGitWorktree(t, h, s, "ws-1", "sess-1")

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/sess-1/branch-commits", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionBranchCommits(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp BranchChangesResponse
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.Empty(t, resp.Commits)
}

func TestGetSessionBranchCommits_WithCommits(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath, _ := createSessionWithGitWorktree(t, h, s, "ws-1", "sess-1")

	// Add commits after the base
	createAndCommitFile(t, repoPath, "feature.go", "package main\n", "Add feature")
	createAndCommitFile(t, repoPath, "test.go", "package main\n", "Add tests")

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/sess-1/branch-commits", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionBranchCommits(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp BranchChangesResponse
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)
	require.Len(t, resp.Commits, 2)

	// Newest first
	assert.Equal(t, "Add tests", resp.Commits[0].Message)
	assert.Equal(t, "Add feature", resp.Commits[1].Message)

	// Each commit should have files
	require.Len(t, resp.Commits[0].Files, 1)
	assert.Equal(t, "test.go", resp.Commits[0].Files[0].Path)
	require.Len(t, resp.Commits[1].Files, 1)
	assert.Equal(t, "feature.go", resp.Commits[1].Files[0].Path)

	// Branch stats should reflect total changes
	require.NotNil(t, resp.BranchStats)
	assert.Equal(t, 2, resp.BranchStats.TotalFiles)
	assert.Equal(t, 2, resp.BranchStats.TotalAdditions) // 1 line each
	assert.Equal(t, 0, resp.BranchStats.TotalDeletions)

	// AllChanges should contain the flat file list
	require.Len(t, resp.AllChanges, 2)
	paths := []string{resp.AllChanges[0].Path, resp.AllChanges[1].Path}
	assert.Contains(t, paths, "feature.go")
	assert.Contains(t, paths, "test.go")
}

func TestGetSessionBranchCommits_SessionNotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/nonexistent/branch-commits", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetSessionBranchCommits(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestGetSessionBranchCommits_ReturnsEmptyArrayOnError(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Create a workspace and session with an invalid worktree path
	repo := &models.Repo{
		ID:        "ws-bad",
		Name:      "bad-repo",
		Path:      "/nonexistent/path",
		Branch:    "main",
		CreatedAt: time.Now(),
	}
	require.NoError(t, s.AddRepo(ctx, repo))

	session := &models.Session{
		ID:            "sess-bad",
		WorkspaceID:   "ws-bad",
		Name:          "Bad Session",
		Status:        "idle",
		WorktreePath:  "/nonexistent/worktree",
		BaseCommitSHA: "abc123",
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))

	req := httptest.NewRequest("GET", "/api/repos/ws-bad/sessions/sess-bad/branch-commits", nil)
	req = withChiContext(req, map[string]string{"id": "ws-bad", "sessionId": "sess-bad"})
	w := httptest.NewRecorder()

	h.GetSessionBranchCommits(w, req)

	// Should still return 200 with empty commits (graceful degradation)
	assert.Equal(t, http.StatusOK, w.Code)

	var resp BranchChangesResponse
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.Empty(t, resp.Commits)
}

func TestGetSessionBranchCommits_CommitFilesHaveStats(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath, _ := createSessionWithGitWorktree(t, h, s, "ws-1", "sess-1")

	// Create a file with known content
	writeFile(t, repoPath, "stats.txt", "line 1\nline 2\nline 3\n")
	runGit(t, repoPath, "add", "stats.txt")
	runGit(t, repoPath, "commit", "-m", "Add file with 3 lines")

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/sess-1/branch-commits", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.GetSessionBranchCommits(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp BranchChangesResponse
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)
	require.Len(t, resp.Commits, 1)
	require.Len(t, resp.Commits[0].Files, 1)

	assert.Equal(t, "stats.txt", resp.Commits[0].Files[0].Path)
	assert.Equal(t, 3, resp.Commits[0].Files[0].Additions)
	assert.Equal(t, 0, resp.Commits[0].Files[0].Deletions)

	// Branch stats should match the commit
	require.NotNil(t, resp.BranchStats)
	assert.Equal(t, 1, resp.BranchStats.TotalFiles)
	assert.Equal(t, 3, resp.BranchStats.TotalAdditions)
	assert.Equal(t, 0, resp.BranchStats.TotalDeletions)
}
