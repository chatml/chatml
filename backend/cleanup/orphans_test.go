package cleanup

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/chatml/chatml-backend/models"
)

// mockStore implements the Store interface for testing
type mockStore struct {
	repos         []*models.Repo
	sessions      map[string][]*models.Session // keyed by workspace ID
	sessionsByID  map[string]*models.Session   // keyed by session ID
	listErr       error
	getSessionErr error
}

func (m *mockStore) ListRepos(ctx context.Context) ([]*models.Repo, error) {
	if m.listErr != nil {
		return nil, m.listErr
	}
	return m.repos, nil
}

func (m *mockStore) ListSessions(ctx context.Context, workspaceID string, includeArchived bool) ([]*models.Session, error) {
	sessions := m.sessions[workspaceID]
	if includeArchived {
		return sessions, nil
	}
	var filtered []*models.Session
	for _, s := range sessions {
		if !s.Archived {
			filtered = append(filtered, s)
		}
	}
	return filtered, nil
}

func (m *mockStore) GetSession(ctx context.Context, sessionID string) (*models.Session, error) {
	if m.getSessionErr != nil {
		return nil, m.getSessionErr
	}
	if m.sessionsByID != nil {
		if sess, ok := m.sessionsByID[sessionID]; ok {
			return sess, nil
		}
	}
	// Also check in the sessions map for backward compatibility with existing tests
	for _, sessions := range m.sessions {
		for _, sess := range sessions {
			if sess.ID == sessionID {
				return sess, nil
			}
		}
	}
	return nil, errors.New("session not found")
}

// mockWorktreeManager implements the WorktreeManager interface for testing
type mockWorktreeManager struct {
	worktrees    map[string][]string // keyed by repo path
	removedPaths []string
	removeErr    error
}

func (m *mockWorktreeManager) List(ctx context.Context, repoPath string) ([]string, error) {
	return m.worktrees[repoPath], nil
}

func (m *mockWorktreeManager) RemoveAtPath(ctx context.Context, repoPath, worktreePath, branchName string) error {
	if m.removeErr != nil {
		return m.removeErr
	}
	m.removedPaths = append(m.removedPaths, worktreePath)
	return nil
}

func TestIsInWorkspacesDir(t *testing.T) {
	sep := string(os.PathSeparator)

	tests := []struct {
		name          string
		worktreePath  string
		workspacesDir string
		want          bool
	}{
		{
			name:          "path inside workspaces dir",
			worktreePath:  "/home/user/.chatml/workspaces" + sep + "session1",
			workspacesDir: "/home/user/.chatml/workspaces",
			want:          true,
		},
		{
			name:          "nested path inside workspaces dir",
			worktreePath:  "/home/user/.chatml/workspaces" + sep + "repo" + sep + "session1",
			workspacesDir: "/home/user/.chatml/workspaces",
			want:          true,
		},
		{
			name:          "path with similar prefix but different dir",
			worktreePath:  "/home/user/.chatml/workspaces-backup" + sep + "session1",
			workspacesDir: "/home/user/.chatml/workspaces",
			want:          false,
		},
		{
			name:          "path exactly equals workspaces dir",
			worktreePath:  "/home/user/.chatml/workspaces",
			workspacesDir: "/home/user/.chatml/workspaces",
			want:          false,
		},
		{
			name:          "completely different path",
			worktreePath:  "/tmp/worktree",
			workspacesDir: "/home/user/.chatml/workspaces",
			want:          false,
		},
		{
			name:          "empty workspaces dir",
			worktreePath:  "/home/user/.chatml/workspaces" + sep + "session1",
			workspacesDir: "",
			want:          false,
		},
		{
			name:          "old-style worktree in .worktrees",
			worktreePath:  "/home/user/repo/.worktrees/session1",
			workspacesDir: "/home/user/.chatml/workspaces",
			want:          false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isInWorkspacesDir(tt.worktreePath, tt.workspacesDir)
			if got != tt.want {
				t.Errorf("isInWorkspacesDir(%q, %q) = %v, want %v",
					tt.worktreePath, tt.workspacesDir, got, tt.want)
			}
		})
	}
}

func TestFindOrphansForRepo(t *testing.T) {
	ctx := context.Background()
	sep := string(os.PathSeparator)
	workspacesDir := filepath.Join("/home", "user", ".chatml", "workspaces")

	tests := []struct {
		name           string
		diskWorktrees  []string
		dbSessions     []*models.Session
		expectedOrphan []string
	}{
		{
			name:           "no worktrees on disk",
			diskWorktrees:  []string{},
			dbSessions:     []*models.Session{},
			expectedOrphan: nil,
		},
		{
			name: "all worktrees tracked",
			diskWorktrees: []string{
				workspacesDir + sep + "session1",
				workspacesDir + sep + "session2",
			},
			dbSessions: []*models.Session{
				{ID: "s1", WorktreePath: workspacesDir + sep + "session1"},
				{ID: "s2", WorktreePath: workspacesDir + sep + "session2"},
			},
			expectedOrphan: nil,
		},
		{
			name: "one orphan worktree",
			diskWorktrees: []string{
				workspacesDir + sep + "session1",
				workspacesDir + sep + "orphan",
			},
			dbSessions: []*models.Session{
				{ID: "s1", WorktreePath: workspacesDir + sep + "session1"},
			},
			expectedOrphan: []string{workspacesDir + sep + "orphan"},
		},
		{
			name: "multiple orphan worktrees",
			diskWorktrees: []string{
				workspacesDir + sep + "orphan1",
				workspacesDir + sep + "tracked",
				workspacesDir + sep + "orphan2",
			},
			dbSessions: []*models.Session{
				{ID: "s1", WorktreePath: workspacesDir + sep + "tracked"},
			},
			expectedOrphan: []string{
				workspacesDir + sep + "orphan1",
				workspacesDir + sep + "orphan2",
			},
		},
		{
			name: "skip worktrees outside workspaces dir",
			diskWorktrees: []string{
				"/other/path/worktree",
				workspacesDir + sep + "orphan",
			},
			dbSessions:     []*models.Session{},
			expectedOrphan: []string{workspacesDir + sep + "orphan"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &mockStore{
				sessions: map[string][]*models.Session{
					"repo1": tt.dbSessions,
				},
			}
			wm := &mockWorktreeManager{
				worktrees: map[string][]string{
					"/repo/path": tt.diskWorktrees,
				},
			}
			repo := &models.Repo{ID: "repo1", Path: "/repo/path"}

			orphans, err := findOrphansForRepo(ctx, store, wm, repo, workspacesDir)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			// Extract paths from orphanInfo
			var orphanPaths []string
			for _, o := range orphans {
				orphanPaths = append(orphanPaths, o.path)
			}

			if len(orphanPaths) != len(tt.expectedOrphan) {
				t.Errorf("got %d orphans, want %d", len(orphanPaths), len(tt.expectedOrphan))
				return
			}

			for i, path := range orphanPaths {
				if path != tt.expectedOrphan[i] {
					t.Errorf("orphan[%d] = %q, want %q", i, path, tt.expectedOrphan[i])
				}
			}
		})
	}
}

func TestCleanOrphanedWorktrees(t *testing.T) {
	ctx := context.Background()
	sep := string(os.PathSeparator)

	t.Run("no repos returns early", func(t *testing.T) {
		store := &mockStore{repos: []*models.Repo{}}
		wm := &mockWorktreeManager{}

		err := CleanOrphanedWorktrees(ctx, store, wm)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("store error propagates", func(t *testing.T) {
		expectedErr := errors.New("database error")
		store := &mockStore{listErr: expectedErr}
		wm := &mockWorktreeManager{}

		err := CleanOrphanedWorktrees(ctx, store, wm)
		if err == nil || !errors.Is(err, expectedErr) {
			t.Errorf("expected error %v, got %v", expectedErr, err)
		}
	})

	t.Run("removes orphan worktrees", func(t *testing.T) {
		// Get actual workspaces dir for this test
		homeDir, _ := os.UserHomeDir()
		workspacesDir := filepath.Join(homeDir, ".chatml", "workspaces")

		orphanPath := workspacesDir + sep + "orphan-session"
		trackedPath := workspacesDir + sep + "tracked-session"

		store := &mockStore{
			repos: []*models.Repo{
				{ID: "repo1", Path: "/repo/path"},
			},
			sessions: map[string][]*models.Session{
				"repo1": {
					{ID: "s1", WorktreePath: trackedPath},
				},
			},
		}
		wm := &mockWorktreeManager{
			worktrees: map[string][]string{
				"/repo/path": {trackedPath, orphanPath},
			},
		}

		err := CleanOrphanedWorktrees(ctx, store, wm)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		// Verify orphan was removed
		if len(wm.removedPaths) != 1 {
			t.Errorf("expected 1 removal, got %d", len(wm.removedPaths))
			return
		}
		if wm.removedPaths[0] != orphanPath {
			t.Errorf("removed path = %q, want %q", wm.removedPaths[0], orphanPath)
		}
	})

	t.Run("continues on removal error", func(t *testing.T) {
		homeDir, _ := os.UserHomeDir()
		workspacesDir := filepath.Join(homeDir, ".chatml", "workspaces")

		orphanPath := workspacesDir + sep + "orphan"

		store := &mockStore{
			repos: []*models.Repo{
				{ID: "repo1", Path: "/repo/path"},
			},
			sessions: map[string][]*models.Session{
				"repo1": {},
			},
		}
		wm := &mockWorktreeManager{
			worktrees: map[string][]string{
				"/repo/path": {orphanPath},
			},
			removeErr: errors.New("removal failed"),
		}

		// Should not return an error, just log warning
		err := CleanOrphanedWorktrees(ctx, store, wm)
		if err != nil {
			t.Errorf("expected no error, got %v", err)
		}
	})
}
