package cleanup

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/session"
)

// Store defines the minimal interface needed for orphan cleanup.
type Store interface {
	ListRepos(ctx context.Context) ([]*models.Repo, error)
	ListSessions(ctx context.Context, workspaceID string, includeArchived bool) ([]*models.Session, error)
	GetSession(ctx context.Context, sessionID string) (*models.Session, error)
	GetSetting(ctx context.Context, key string) (string, bool, error)
}

// WorktreeManager defines the minimal interface for worktree operations.
type WorktreeManager interface {
	List(ctx context.Context, repoPath string) ([]string, error)
	RemoveAtPath(ctx context.Context, repoPath, worktreePath, branchName string) error
}

// CleanOrphanedWorktrees finds worktrees on disk that are not tracked in the database
// and removes them. This handles cleanup from previous crashes or failed session creations.
//
// An orphaned worktree is one that exists on disk (in ~/.chatml/workspaces/) but has
// no corresponding session record in the database.
func CleanOrphanedWorktrees(ctx context.Context, store Store, wm WorktreeManager) error {
	configured, _, err := store.GetSetting(ctx, "workspaces-base-dir")
	if err != nil {
		logger.Cleanup.Debugf("Failed to read workspaces-base-dir setting, using default: %v", err)
	}
	workspacesDir, err := git.WorkspacesBaseDirWithOverride(configured)
	if err != nil {
		return fmt.Errorf("failed to get workspaces directory: %w", err)
	}

	// Get all repos from the database
	repos, err := store.ListRepos(ctx)
	if err != nil {
		return fmt.Errorf("failed to list repos: %w", err)
	}

	if len(repos) == 0 {
		logger.Cleanup.Info("No repos found, skipping orphan detection")
		return nil
	}

	totalOrphans := 0

	for _, repo := range repos {
		orphans, err := findOrphansForRepo(ctx, store, wm, repo, workspacesDir)
		if err != nil {
			logger.Cleanup.Warnf("Failed to check repo %s: %v", repo.Path, err)
			continue
		}

		for _, orphan := range orphans {
			logger.Cleanup.Infof("Removing orphaned worktree: %s", orphan.path)

			// Delete session metadata file if it exists and we have the sessionID
			if orphan.sessionID != "" {
				session.DeleteMetadata(orphan.sessionID)
			}

			// Remove the worktree and branch
			if err := wm.RemoveAtPath(ctx, repo.Path, orphan.path, orphan.branch); err != nil {
				logger.Cleanup.Warnf("Failed to remove orphan %s: %v", orphan.path, err)
				continue
			}

			totalOrphans++
		}
	}

	if totalOrphans > 0 {
		logger.Cleanup.Infof("Removed %d orphaned worktree(s)", totalOrphans)
	}

	// Also clean up stale session metadata files
	staleCount, err := session.CleanupStaleMetadata(func(sessionID string) bool {
		_, err := store.GetSession(ctx, sessionID)
		return err == nil
	})
	if err != nil {
		logger.Cleanup.Warnf("Failed to clean stale metadata: %v", err)
	} else if staleCount > 0 {
		logger.Cleanup.Infof("Removed %d stale session metadata file(s)", staleCount)
	}

	return nil
}

type orphanInfo struct {
	path      string
	branch    string
	sessionID string
}

func findOrphansForRepo(ctx context.Context, store Store, wm WorktreeManager, repo *models.Repo, workspacesDir string) ([]orphanInfo, error) {
	// Get all worktrees on disk for this repo
	diskWorktrees, err := wm.List(ctx, repo.Path)
	if err != nil {
		return nil, fmt.Errorf("failed to list worktrees: %w", err)
	}

	if len(diskWorktrees) == 0 {
		return nil, nil
	}

	// Get all sessions from the database for this repo
	// Include archived sessions since we need to check all tracked worktrees
	sessions, err := store.ListSessions(ctx, repo.ID, true)
	if err != nil {
		return nil, fmt.Errorf("failed to list sessions: %w", err)
	}

	// Build a set of tracked worktree paths
	trackedPaths := make(map[string]bool)
	for _, sess := range sessions {
		if sess.WorktreePath != "" {
			trackedPaths[sess.WorktreePath] = true
		}
	}

	// Find worktrees on disk that aren't tracked in DB
	var orphans []orphanInfo
	for _, worktreePath := range diskWorktrees {
		// Only consider worktrees in the workspaces directory
		// (skip old-style .worktrees that might be managed differently)
		if !isInWorkspacesDir(worktreePath, workspacesDir) {
			continue
		}

		if !trackedPaths[worktreePath] {
			// Orphaned worktree — no DB record exists, so we don't know the branch name.
			// RemoveAtPath will remove the worktree directory but the associated branch
			// will remain in the repo. This is a known limitation: stale branches are
			// harmless and can be pruned manually with `git branch -D`.
			// Stale metadata cleanup happens separately via CleanupStaleMetadata.
			orphans = append(orphans, orphanInfo{
				path:      worktreePath,
				branch:    "", // Unknown — branch won't be deleted (see comment above)
				sessionID: "", // Unknown for orphaned worktrees
			})
		}
	}

	return orphans, nil
}

func isInWorkspacesDir(worktreePath, workspacesDir string) bool {
	if workspacesDir == "" {
		return false
	}
	// Check if the worktree path is within the workspaces directory.
	// Use path separator to avoid false matches like "/workspaces-backup" matching "/workspaces".
	return strings.HasPrefix(worktreePath, workspacesDir+string(os.PathSeparator))
}
