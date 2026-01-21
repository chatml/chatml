package cleanup

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/session"
)

// Store defines the minimal interface needed for orphan cleanup.
type Store interface {
	ListRepos(ctx context.Context) ([]*models.Repo, error)
	ListSessions(ctx context.Context, workspaceID string) ([]*models.Session, error)
}

// WorktreeManager defines the minimal interface for worktree operations.
type WorktreeManager interface {
	List(repoPath string) ([]string, error)
	RemoveAtPath(repoPath, worktreePath, branchName string) error
}

// CleanOrphanedWorktrees finds worktrees on disk that are not tracked in the database
// and removes them. This handles cleanup from previous crashes or failed session creations.
//
// An orphaned worktree is one that exists on disk (in ~/.chatml/workspaces/) but has
// no corresponding session record in the database.
func CleanOrphanedWorktrees(ctx context.Context, store Store, wm WorktreeManager) error {
	workspacesDir, err := git.WorkspacesBaseDir()
	if err != nil {
		return fmt.Errorf("failed to get workspaces directory: %w", err)
	}

	// Get all repos from the database
	repos, err := store.ListRepos(ctx)
	if err != nil {
		return fmt.Errorf("failed to list repos: %w", err)
	}

	if len(repos) == 0 {
		log.Println("[cleanup] No repos found, skipping orphan detection")
		return nil
	}

	totalOrphans := 0

	for _, repo := range repos {
		orphans, err := findOrphansForRepo(ctx, store, wm, repo, workspacesDir)
		if err != nil {
			log.Printf("[cleanup] Warning: failed to check repo %s: %v", repo.Path, err)
			continue
		}

		for _, orphan := range orphans {
			log.Printf("[cleanup] Removing orphaned worktree: %s", orphan.path)

			// Delete session metadata file if it exists
			session.DeleteMetadata(orphan.path)

			// Remove the worktree and branch
			if err := wm.RemoveAtPath(repo.Path, orphan.path, orphan.branch); err != nil {
				log.Printf("[cleanup] Warning: failed to remove orphan %s: %v", orphan.path, err)
				continue
			}

			totalOrphans++
		}
	}

	if totalOrphans > 0 {
		log.Printf("[cleanup] Removed %d orphaned worktree(s)", totalOrphans)
	}

	return nil
}

type orphanInfo struct {
	path   string
	branch string
}

func findOrphansForRepo(ctx context.Context, store Store, wm WorktreeManager, repo *models.Repo, workspacesDir string) ([]orphanInfo, error) {
	// Get all worktrees on disk for this repo
	diskWorktrees, err := wm.List(repo.Path)
	if err != nil {
		return nil, fmt.Errorf("failed to list worktrees: %w", err)
	}

	if len(diskWorktrees) == 0 {
		return nil, nil
	}

	// Get all sessions from the database for this repo
	sessions, err := store.ListSessions(ctx, repo.ID)
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
			// Try to read branch name from session metadata, fallback to guessing
			branch := ""
			if meta, err := session.ReadMetadata(worktreePath); err == nil && meta != nil {
				branch = meta.Branch
			}

			orphans = append(orphans, orphanInfo{
				path:   worktreePath,
				branch: branch,
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
