package git

import (
	"context"
	"os"
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAnalyzeBranchesForCleanup_ProtectedBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Analyze branches
	result, err := rm.AnalyzeBranchesForCleanup(ctx, repoPath, 90, false, nil)
	require.NoError(t, err)
	require.NotNil(t, result)

	// Find the main branch in candidates
	var mainBranch *CleanupCandidate
	for i := range result.Candidates {
		if result.Candidates[i].Name == "main" {
			mainBranch = &result.Candidates[i]
			break
		}
	}

	require.NotNil(t, mainBranch, "main branch should be in candidates")
	assert.Equal(t, CategorySafe, mainBranch.Category)
	assert.True(t, mainBranch.IsProtected)
	assert.False(t, mainBranch.Deletable)
	// Main branch is checked out, so reason will be "Current HEAD branch" or "Protected branch"
	assert.True(t, mainBranch.Reason == "Current HEAD branch" || mainBranch.Reason == "Protected branch")
}

func TestAnalyzeBranchesForCleanup_MergedBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create a feature branch and push it (to establish tracking)
	createBranch(t, repoPath, "feature/test")
	checkoutBranch(t, repoPath, "feature/test")
	createAndCommitFile(t, repoPath, "feature.txt", "content", "Add feature")
	runGit(t, repoPath, "push", "-u", "origin", "feature/test")

	// Merge into main
	checkoutBranch(t, repoPath, "main")
	runGit(t, repoPath, "merge", "--no-ff", "feature/test")

	// Push main to origin so that origin/main is updated
	runGit(t, repoPath, "push", "origin", "main")

	// Analyze branches
	result, err := rm.AnalyzeBranchesForCleanup(ctx, repoPath, 90, false, nil)
	require.NoError(t, err)

	// Find the feature branch
	var featureBranch *CleanupCandidate
	for i := range result.Candidates {
		if result.Candidates[i].Name == "feature/test" {
			featureBranch = &result.Candidates[i]
			break
		}
	}

	require.NotNil(t, featureBranch, "feature branch should be in candidates")
	assert.Equal(t, CategoryMerged, featureBranch.Category)
	assert.True(t, featureBranch.Deletable)
	assert.Contains(t, featureBranch.Reason, "merged")
}

func TestAnalyzeBranchesForCleanup_StaleBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create a branch with an old commit
	createBranch(t, repoPath, "stale/old-branch")
	checkoutBranch(t, repoPath, "stale/old-branch")

	// Create a commit with a very old date
	cmd := exec.Command("git", "commit", "--allow-empty", "-m", "Old commit")
	cmd.Dir = repoPath
	cmd.Env = append(os.Environ(),
		"GIT_COMMITTER_DATE=2020-01-01T00:00:00+00:00",
		"GIT_AUTHOR_DATE=2020-01-01T00:00:00+00:00",
	)
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, string(out))

	// Return to main
	checkoutBranch(t, repoPath, "main")

	// Analyze branches with staleDays=1 (since the commit is from 2020)
	result, err := rm.AnalyzeBranchesForCleanup(ctx, repoPath, 1, false, nil)
	require.NoError(t, err)

	// Find the stale branch
	var staleBranch *CleanupCandidate
	for i := range result.Candidates {
		if result.Candidates[i].Name == "stale/old-branch" {
			staleBranch = &result.Candidates[i]
			break
		}
	}

	require.NotNil(t, staleBranch, "stale branch should be in candidates")
	assert.Equal(t, CategoryStale, staleBranch.Category)
	assert.True(t, staleBranch.Deletable)
	assert.Contains(t, staleBranch.Reason, "No commits")
}

func TestAnalyzeBranchesForCleanup_OrphanedBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create a local branch without pushing to origin
	createBranch(t, repoPath, "orphaned/no-remote")
	checkoutBranch(t, repoPath, "orphaned/no-remote")
	createAndCommitFile(t, repoPath, "orphan.txt", "content", "Add file")

	// Return to main
	checkoutBranch(t, repoPath, "main")

	// Analyze branches
	result, err := rm.AnalyzeBranchesForCleanup(ctx, repoPath, 90, false, nil)
	require.NoError(t, err)

	// Find the orphaned branch
	var orphanedBranch *CleanupCandidate
	for i := range result.Candidates {
		if result.Candidates[i].Name == "orphaned/no-remote" {
			orphanedBranch = &result.Candidates[i]
			break
		}
	}

	require.NotNil(t, orphanedBranch, "orphaned branch should be in candidates")
	assert.Equal(t, CategoryOrphaned, orphanedBranch.Category)
	assert.True(t, orphanedBranch.Deletable)
	assert.Contains(t, orphanedBranch.Reason, "No remote tracking")
}

func TestAnalyzeBranchesForCleanup_ActiveBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create a recent branch with upstream tracking
	createBranch(t, repoPath, "feature/active")
	checkoutBranch(t, repoPath, "feature/active")
	createAndCommitFile(t, repoPath, "active.txt", "content", "Add file")

	// Push to origin to establish tracking
	runGit(t, repoPath, "push", "-u", "origin", "feature/active")

	// Return to main
	checkoutBranch(t, repoPath, "main")

	// Analyze branches
	result, err := rm.AnalyzeBranchesForCleanup(ctx, repoPath, 90, false, nil)
	require.NoError(t, err)

	// Find the active branch
	var activeBranch *CleanupCandidate
	for i := range result.Candidates {
		if result.Candidates[i].Name == "feature/active" {
			activeBranch = &result.Candidates[i]
			break
		}
	}

	require.NotNil(t, activeBranch, "active branch should be in candidates")
	assert.Equal(t, CategorySafe, activeBranch.Category)
	assert.False(t, activeBranch.Deletable)
	assert.Contains(t, activeBranch.Reason, "Active")
}

func TestAnalyzeBranchesForCleanup_SessionBranchProtected(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create a branch
	createBranch(t, repoPath, "session/test")
	checkoutBranch(t, repoPath, "session/test")
	createAndCommitFile(t, repoPath, "session.txt", "content", "Add file")

	// Return to main
	checkoutBranch(t, repoPath, "main")

	// Mark this branch as having an active session
	sessionBranches := map[string]*SessionInfo{
		"session/test": {
			ID:     "sess-123",
			Name:   "Test Session",
			Status: "active",
		},
	}

	// Analyze branches
	result, err := rm.AnalyzeBranchesForCleanup(ctx, repoPath, 90, false, sessionBranches)
	require.NoError(t, err)

	// Find the session branch
	var sessionBranch *CleanupCandidate
	for i := range result.Candidates {
		if result.Candidates[i].Name == "session/test" {
			sessionBranch = &result.Candidates[i]
			break
		}
	}

	require.NotNil(t, sessionBranch, "session branch should be in candidates")
	assert.Equal(t, CategorySafe, sessionBranch.Category)
	assert.True(t, sessionBranch.IsProtected)
	assert.False(t, sessionBranch.Deletable)
	assert.Contains(t, sessionBranch.Reason, "Active session")
	assert.Equal(t, "sess-123", sessionBranch.SessionID)
	assert.Equal(t, "Test Session", sessionBranch.SessionName)
	assert.Equal(t, "active", sessionBranch.SessionStatus)
}

func TestAnalyzeBranchesForCleanup_SummaryAccurate(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create various types of branches
	// 1. Merged branch (push first to establish tracking, then merge, then push main)
	createBranch(t, repoPath, "merged/branch")
	checkoutBranch(t, repoPath, "merged/branch")
	createAndCommitFile(t, repoPath, "merged.txt", "content", "Add merged")
	runGit(t, repoPath, "push", "-u", "origin", "merged/branch")
	checkoutBranch(t, repoPath, "main")
	runGit(t, repoPath, "merge", "--no-ff", "merged/branch")
	runGit(t, repoPath, "push", "origin", "main")

	// 2. Orphaned branch (no upstream tracking)
	createBranch(t, repoPath, "orphaned/branch")
	checkoutBranch(t, repoPath, "orphaned/branch")
	createAndCommitFile(t, repoPath, "orphan.txt", "content", "Add orphan")
	checkoutBranch(t, repoPath, "main")

	// 3. Active branch with tracking
	createBranch(t, repoPath, "active/branch")
	checkoutBranch(t, repoPath, "active/branch")
	createAndCommitFile(t, repoPath, "active.txt", "content", "Add active")
	runGit(t, repoPath, "push", "-u", "origin", "active/branch")
	checkoutBranch(t, repoPath, "main")

	// Analyze branches
	result, err := rm.AnalyzeBranchesForCleanup(ctx, repoPath, 90, false, nil)
	require.NoError(t, err)

	// Count categories manually
	categoryCounts := make(map[CleanupCategory]int)
	for _, candidate := range result.Candidates {
		categoryCounts[candidate.Category]++
	}

	// Verify summary matches
	assert.Equal(t, categoryCounts[CategoryMerged], result.Summary["merged"])
	assert.Equal(t, categoryCounts[CategoryOrphaned], result.Summary["orphaned"])
	assert.Equal(t, categoryCounts[CategorySafe], result.Summary["safe"])

	// Verify total
	assert.Equal(t, len(result.Candidates), result.TotalAnalyzed)

	// Verify at least one of each category exists
	assert.Greater(t, result.Summary["merged"], 0)
	assert.Greater(t, result.Summary["orphaned"], 0)
	assert.Greater(t, result.Summary["safe"], 0)
}

func TestDeleteBranches_MergedBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create and merge a branch
	createBranch(t, repoPath, "to-delete")
	checkoutBranch(t, repoPath, "to-delete")
	createAndCommitFile(t, repoPath, "file.txt", "content", "Add file")
	checkoutBranch(t, repoPath, "main")
	runGit(t, repoPath, "merge", "--no-ff", "to-delete")

	// Delete the branch
	targets := []CleanupBranchTarget{
		{Name: "to-delete", DeleteLocal: true, DeleteRemote: false},
	}
	result, err := rm.DeleteBranches(ctx, repoPath, targets, nil)
	require.NoError(t, err)

	// Verify success
	assert.Len(t, result.Succeeded, 1)
	assert.Len(t, result.Failed, 0)
	assert.Equal(t, "to-delete", result.Succeeded[0].Name)
	assert.True(t, result.Succeeded[0].DeletedLocal)
	assert.False(t, result.Succeeded[0].DeletedRemote)

	// Verify branch is gone
	assert.False(t, branchExists(t, repoPath, "to-delete"))
}

func TestDeleteBranches_UnmergedBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create an unmerged branch
	createBranch(t, repoPath, "unmerged")
	checkoutBranch(t, repoPath, "unmerged")
	createAndCommitFile(t, repoPath, "unmerged.txt", "content", "Add unmerged")
	checkoutBranch(t, repoPath, "main")

	// Delete the branch (should use -D force delete)
	targets := []CleanupBranchTarget{
		{Name: "unmerged", DeleteLocal: true, DeleteRemote: false},
	}
	result, err := rm.DeleteBranches(ctx, repoPath, targets, nil)
	require.NoError(t, err)

	// Verify success
	assert.Len(t, result.Succeeded, 1)
	assert.Len(t, result.Failed, 0)
	assert.True(t, result.Succeeded[0].DeletedLocal)

	// Verify branch is gone
	assert.False(t, branchExists(t, repoPath, "unmerged"))
}

func TestDeleteBranches_ProtectedBranchRefused(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Try to delete main branch
	targets := []CleanupBranchTarget{
		{Name: "main", DeleteLocal: true, DeleteRemote: false},
	}
	result, err := rm.DeleteBranches(ctx, repoPath, targets, nil)
	require.NoError(t, err)

	// Verify failure
	assert.Len(t, result.Succeeded, 0)
	assert.Len(t, result.Failed, 1)
	assert.Equal(t, "main", result.Failed[0].Name)
	assert.Contains(t, result.Failed[0].Error, "protected")

	// Verify main branch still exists
	assert.True(t, branchExists(t, repoPath, "main"))
}

func TestDeleteBranches_PartialSuccess(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create a valid branch
	createBranch(t, repoPath, "valid")
	checkoutBranch(t, repoPath, "valid")
	createAndCommitFile(t, repoPath, "valid.txt", "content", "Add valid")
	checkoutBranch(t, repoPath, "main")

	// Try to delete one valid branch and one protected branch
	targets := []CleanupBranchTarget{
		{Name: "valid", DeleteLocal: true, DeleteRemote: false},
		{Name: "main", DeleteLocal: true, DeleteRemote: false},
	}
	result, err := rm.DeleteBranches(ctx, repoPath, targets, nil)
	require.NoError(t, err)

	// Verify partial success
	assert.Len(t, result.Succeeded, 1)
	assert.Len(t, result.Failed, 1)
	assert.Equal(t, "valid", result.Succeeded[0].Name)
	assert.Equal(t, "main", result.Failed[0].Name)

	// Verify only valid branch is gone
	assert.False(t, branchExists(t, repoPath, "valid"))
	assert.True(t, branchExists(t, repoPath, "main"))
}

func TestDeleteBranches_InvalidBranchName(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Try to delete a branch with invalid characters
	targets := []CleanupBranchTarget{
		{Name: "branch;rm -rf /", DeleteLocal: true, DeleteRemote: false},
	}
	result, err := rm.DeleteBranches(ctx, repoPath, targets, nil)
	require.NoError(t, err)

	// Verify failure
	assert.Len(t, result.Succeeded, 0)
	assert.Len(t, result.Failed, 1)
	assert.Contains(t, result.Failed[0].Error, "invalid branch name")
}

func TestDeleteLocalBranch_ProtectedBranchRefused(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Try to delete main branch
	err := rm.DeleteLocalBranch(ctx, repoPath, "main")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "protected")

	// Verify main still exists
	assert.True(t, branchExists(t, repoPath, "main"))
}

func TestDeleteLocalBranch_Success(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create a regular branch
	createBranch(t, repoPath, "deleteme")
	checkoutBranch(t, repoPath, "deleteme")
	createAndCommitFile(t, repoPath, "file.txt", "content", "Add file")
	checkoutBranch(t, repoPath, "main")

	// Verify branch exists
	assert.True(t, branchExists(t, repoPath, "deleteme"))

	// Delete the branch
	err := rm.DeleteLocalBranch(ctx, repoPath, "deleteme")
	require.NoError(t, err)

	// Verify branch is gone
	assert.False(t, branchExists(t, repoPath, "deleteme"))
}

func TestAnalyzeBranchesForCleanup_CurrentBranchProtected(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create a branch and check it out (making it current)
	createBranch(t, repoPath, "current-work")
	checkoutBranch(t, repoPath, "current-work")
	createAndCommitFile(t, repoPath, "work.txt", "content", "Add work")

	// Analyze branches
	result, err := rm.AnalyzeBranchesForCleanup(ctx, repoPath, 90, false, nil)
	require.NoError(t, err)

	// Find the current branch
	var currentBranch *CleanupCandidate
	for i := range result.Candidates {
		if result.Candidates[i].Name == "current-work" {
			currentBranch = &result.Candidates[i]
			break
		}
	}

	require.NotNil(t, currentBranch, "current branch should be in candidates")
	assert.Equal(t, CategorySafe, currentBranch.Category)
	assert.True(t, currentBranch.IsProtected)
	assert.False(t, currentBranch.Deletable)
	assert.Contains(t, currentBranch.Reason, "HEAD")
}

func TestAnalyzeBranchesForCleanup_StaleDaysDefault(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create a branch with recent commit
	createBranch(t, repoPath, "recent")
	checkoutBranch(t, repoPath, "recent")
	createAndCommitFile(t, repoPath, "recent.txt", "content", "Recent work")
	checkoutBranch(t, repoPath, "main")

	// Call with staleDays=0 (should default to 90)
	result, err := rm.AnalyzeBranchesForCleanup(ctx, repoPath, 0, false, nil)
	require.NoError(t, err)

	// Find the recent branch
	var recentBranch *CleanupCandidate
	for i := range result.Candidates {
		if result.Candidates[i].Name == "recent" {
			recentBranch = &result.Candidates[i]
			break
		}
	}

	require.NotNil(t, recentBranch)
	// Should NOT be stale since it's recent and default is 90 days
	assert.NotEqual(t, CategoryStale, recentBranch.Category)
}

func TestAnalyzeBranchesForCleanup_RemoteBranches(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create and push a branch to origin
	createBranch(t, repoPath, "remote-feature")
	checkoutBranch(t, repoPath, "remote-feature")
	createAndCommitFile(t, repoPath, "feature.txt", "content", "Add feature")
	runGit(t, repoPath, "push", "-u", "origin", "remote-feature")
	checkoutBranch(t, repoPath, "main")

	// Analyze with includeRemote=true
	result, err := rm.AnalyzeBranchesForCleanup(ctx, repoPath, 90, true, nil)
	require.NoError(t, err)

	// Find the remote branch
	var remoteBranch *CleanupCandidate
	for i := range result.Candidates {
		if result.Candidates[i].Name == "origin/remote-feature" {
			remoteBranch = &result.Candidates[i]
			break
		}
	}

	require.NotNil(t, remoteBranch, "remote branch should be in candidates")
	assert.True(t, remoteBranch.IsRemote)
	assert.True(t, remoteBranch.HasLocalAndRemote, "should detect both local and remote copies")
}

func TestDeleteBranches_SessionBranchProtection(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create a branch
	createBranch(t, repoPath, "session-branch")
	checkoutBranch(t, repoPath, "session-branch")
	createAndCommitFile(t, repoPath, "session.txt", "content", "Session work")
	checkoutBranch(t, repoPath, "main")

	// Mark as active session
	sessionBranches := map[string]*SessionInfo{
		"session-branch": {
			ID:     "sess-456",
			Name:   "Active Session",
			Status: "active",
		},
	}

	// Try to delete the session branch
	targets := []CleanupBranchTarget{
		{Name: "session-branch", DeleteLocal: true, DeleteRemote: false},
	}
	result, err := rm.DeleteBranches(ctx, repoPath, targets, sessionBranches)
	require.NoError(t, err)

	// Verify failure
	assert.Len(t, result.Succeeded, 0)
	assert.Len(t, result.Failed, 1)
	assert.Contains(t, result.Failed[0].Error, "protected")

	// Verify branch still exists
	assert.True(t, branchExists(t, repoPath, "session-branch"))
}

func TestDeleteBranches_IdleSessionProtection(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create a branch
	createBranch(t, repoPath, "idle-session")
	checkoutBranch(t, repoPath, "idle-session")
	createAndCommitFile(t, repoPath, "idle.txt", "content", "Idle work")
	checkoutBranch(t, repoPath, "main")

	// Mark as idle session (should still be protected)
	sessionBranches := map[string]*SessionInfo{
		"idle-session": {
			ID:     "sess-789",
			Name:   "Idle Session",
			Status: "idle",
		},
	}

	// Try to delete the idle session branch
	targets := []CleanupBranchTarget{
		{Name: "idle-session", DeleteLocal: true, DeleteRemote: false},
	}
	result, err := rm.DeleteBranches(ctx, repoPath, targets, sessionBranches)
	require.NoError(t, err)

	// Verify failure (idle sessions are also protected)
	assert.Len(t, result.Succeeded, 0)
	assert.Len(t, result.Failed, 1)
	assert.Contains(t, result.Failed[0].Error, "protected")
}

func TestAnalyzeBranchesForCleanup_MasterBranchProtected(t *testing.T) {
	repoPath := t.TempDir()

	// Initialize repo with master as default branch
	runGit(t, repoPath, "init", "-b", "master")
	runGit(t, repoPath, "config", "user.email", "test@test.com")
	runGit(t, repoPath, "config", "user.name", "Test User")

	// Create initial commit on master
	writeFile(t, repoPath, "README.md", "# Test")
	runGit(t, repoPath, "add", ".")
	runGit(t, repoPath, "commit", "-m", "Initial commit")

	// Create a bare repo to act as "origin"
	originDir := t.TempDir()
	runGit(t, originDir, "init", "--bare")

	// Add origin remote and push
	runGit(t, repoPath, "remote", "add", "origin", originDir)
	runGit(t, repoPath, "push", "-u", "origin", "master")

	rm := NewRepoManager()
	ctx := context.Background()

	// Analyze branches
	result, err := rm.AnalyzeBranchesForCleanup(ctx, repoPath, 90, false, nil)
	require.NoError(t, err)

	// Find master branch
	var masterBranch *CleanupCandidate
	for i := range result.Candidates {
		if result.Candidates[i].Name == "master" {
			masterBranch = &result.Candidates[i]
			break
		}
	}

	require.NotNil(t, masterBranch)
	assert.True(t, masterBranch.IsProtected)
	assert.False(t, masterBranch.Deletable)
}

func TestAnalyzeBranchesForCleanup_CompletedSessionDeletable(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create a branch and push it (to establish tracking)
	createBranch(t, repoPath, "completed-session")
	checkoutBranch(t, repoPath, "completed-session")
	createAndCommitFile(t, repoPath, "done.txt", "content", "Completed work")
	runGit(t, repoPath, "push", "-u", "origin", "completed-session")

	// Merge to main and push
	checkoutBranch(t, repoPath, "main")
	runGit(t, repoPath, "merge", "--no-ff", "completed-session")
	runGit(t, repoPath, "push", "origin", "main")

	// Mark as completed session (should not be protected)
	sessionBranches := map[string]*SessionInfo{
		"completed-session": {
			ID:     "sess-completed",
			Name:   "Completed Session",
			Status: "completed",
		},
	}

	// Analyze branches
	result, err := rm.AnalyzeBranchesForCleanup(ctx, repoPath, 90, false, sessionBranches)
	require.NoError(t, err)

	// Find the completed session branch
	var completedBranch *CleanupCandidate
	for i := range result.Candidates {
		if result.Candidates[i].Name == "completed-session" {
			completedBranch = &result.Candidates[i]
			break
		}
	}

	require.NotNil(t, completedBranch)
	// Should be categorized as merged (not protected by session status)
	assert.Equal(t, CategoryMerged, completedBranch.Category)
	assert.True(t, completedBranch.Deletable)
	assert.False(t, completedBranch.IsProtected)
}

func TestDeleteBranches_NonexistentBranch(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Try to delete a branch that doesn't exist
	targets := []CleanupBranchTarget{
		{Name: "does-not-exist", DeleteLocal: true, DeleteRemote: false},
	}
	result, err := rm.DeleteBranches(ctx, repoPath, targets, nil)
	require.NoError(t, err)

	// Should fail gracefully
	assert.Len(t, result.Succeeded, 0)
	assert.Len(t, result.Failed, 1)
	assert.Contains(t, result.Failed[0].Error, "delete failed")
}

func TestAnalyzeBranchesForCleanup_EmptyRepository(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Should work with just the main branch
	result, err := rm.AnalyzeBranchesForCleanup(ctx, repoPath, 90, false, nil)
	require.NoError(t, err)
	require.NotNil(t, result)

	// Should have at least the main branch
	assert.Greater(t, result.TotalAnalyzed, 0)
	assert.Greater(t, result.ProtectedCount, 0)
}

func TestAnalyzeBranchesForCleanup_MultipleProtectedBranches(t *testing.T) {
	repoPath := createTestGitRepo(t)
	rm := NewRepoManager()
	ctx := context.Background()

	// Create develop branch (also protected)
	createBranch(t, repoPath, "develop")
	checkoutBranch(t, repoPath, "develop")
	createAndCommitFile(t, repoPath, "dev.txt", "content", "Dev work")
	checkoutBranch(t, repoPath, "main")

	// Analyze branches
	result, err := rm.AnalyzeBranchesForCleanup(ctx, repoPath, 90, false, nil)
	require.NoError(t, err)

	// Both main and develop should be protected
	protectedCount := 0
	for _, candidate := range result.Candidates {
		if candidate.IsProtected {
			protectedCount++
		}
	}

	assert.GreaterOrEqual(t, protectedCount, 2, "should have at least main and develop protected")
	assert.Equal(t, protectedCount, result.ProtectedCount)
}
