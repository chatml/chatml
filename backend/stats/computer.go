// Package stats provides session statistics computation.
// It consolidates the duplicated stats logic that was previously spread across
// main.go (branch watcher callback, pre-warm goroutine) and server handlers.
package stats

import (
	"context"

	"github.com/chatml/chatml-core/git"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
)

// StatsCache is the subset of cache operations needed by Computer.
type StatsCache interface {
	Set(sessionID string, stats *models.SessionStats)
	Invalidate(sessionID string)
}

// DiffInvalidator is an optional cache that can be invalidated alongside stats.
type DiffInvalidator interface {
	InvalidateSession(sessionID string)
}

// SnapshotInvalidator is an optional cache that can be invalidated alongside stats.
type SnapshotInvalidator interface {
	Invalidate(sessionID string)
}

// Computer computes session statistics (additions/deletions) from git diffs.
// It encapsulates the merge-base resolution, changed-file enumeration, and
// untracked-file counting that was previously duplicated in three places.
type Computer struct {
	repo  *git.RepoManager
	store *store.SQLiteStore

	// Primary cache — always set.
	statsCache StatsCache

	// Optional caches to invalidate when stats are recomputed.
	diffCache     DiffInvalidator
	snapshotCache SnapshotInvalidator
}

// New creates a Computer with the required dependencies.
func New(repo *git.RepoManager, s *store.SQLiteStore, statsCache StatsCache) *Computer {
	return &Computer{
		repo:       repo,
		store:      s,
		statsCache: statsCache,
	}
}

// SetDiffCache sets an optional diff cache to invalidate on recompute.
func (c *Computer) SetDiffCache(dc DiffInvalidator) {
	c.diffCache = dc
}

// SetSnapshotCache sets an optional snapshot cache to invalidate on recompute.
func (c *Computer) SetSnapshotCache(sc SnapshotInvalidator) {
	c.snapshotCache = sc
}

// Compute calculates stats for a session given its session and workspace data.
// This is a pure computation — no caching or side effects.
// Returns nil if the session has no worktree path or no changes.
func (c *Computer) Compute(ctx context.Context, session *models.Session, repo *models.Repo) *models.SessionStats {
	workingPath := session.WorktreePath
	if workingPath == "" && session.IsBaseSession() && repo != nil {
		workingPath = repo.Path
	}
	if workingPath == "" {
		return nil
	}

	// Resolve effective target branch: per-session override, then remote/branch from workspace.
	effectiveTarget := session.TargetBranch
	if effectiveTarget == "" {
		remote := "origin"
		branch := "main"
		if repo != nil {
			if repo.Remote != "" {
				remote = repo.Remote
			}
			if repo.Branch != "" {
				branch = repo.Branch
			}
		}
		effectiveTarget = remote + "/" + branch
	}

	// Compute merge-base for accurate diff base.
	// This avoids phantom file changes when the target branch advances.
	baseRef, mbErr := c.repo.GetMergeBase(ctx, workingPath, effectiveTarget, "HEAD")
	if mbErr != nil || baseRef == "" {
		baseRef = session.BaseCommitSHA
		if baseRef == "" {
			baseRef = effectiveTarget
		}
	}

	// Get tracked changes.
	changes, err := c.repo.GetChangedFilesWithStats(ctx, workingPath, baseRef)
	if err != nil {
		return nil
	}

	// Get untracked files.
	untracked, untrackedErr := c.repo.GetUntrackedFiles(ctx, workingPath)
	if untrackedErr != nil {
		logger.Stats.Warnf("Compute: GetUntrackedFiles failed for %s: %v", workingPath, untrackedErr)
	}

	// Sum up stats.
	var additions, deletions int
	for _, ch := range changes {
		additions += ch.Additions
		deletions += ch.Deletions
	}
	for _, u := range untracked {
		additions += u.Additions
	}

	if additions == 0 && deletions == 0 {
		return nil
	}
	return &models.SessionStats{Additions: additions, Deletions: deletions}
}

// ComputeAndCache fetches the session and repo from the store, computes stats,
// and stores the result in the stats cache. Returns the computed stats.
func (c *Computer) ComputeAndCache(ctx context.Context, sessionID string) *models.SessionStats {
	sess, err := c.store.GetSession(ctx, sessionID)
	if err != nil || sess == nil {
		return nil
	}

	repo, err := c.store.GetRepo(ctx, sess.WorkspaceID)
	if err != nil || repo == nil {
		return nil
	}

	stats := c.Compute(ctx, sess, repo)
	c.statsCache.Set(sessionID, stats)
	return stats
}

// InvalidateAndRecompute invalidates all related caches and then recomputes stats.
// This is the callback used by the branch watcher when files change.
// Returns the freshly computed stats (may be nil).
func (c *Computer) InvalidateAndRecompute(ctx context.Context, sessionID string) *models.SessionStats {
	c.statsCache.Invalidate(sessionID)
	if c.diffCache != nil {
		c.diffCache.InvalidateSession(sessionID)
	}
	if c.snapshotCache != nil {
		c.snapshotCache.Invalidate(sessionID)
	}

	return c.ComputeAndCache(ctx, sessionID)
}
