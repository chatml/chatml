package git

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// CleanupCategory represents the category of a branch cleanup candidate
type CleanupCategory string

const (
	CategoryMerged   CleanupCategory = "merged"
	CategoryStale    CleanupCategory = "stale"
	CategoryOrphaned CleanupCategory = "orphaned"
	CategorySafe     CleanupCategory = "safe"
)

// protectedBranchNames are branches that should never be deleted
var protectedBranchNames = map[string]bool{
	"main":    true,
	"master":  true,
	"develop": true,
}

// CleanupCandidate represents a branch that has been analyzed for cleanup
type CleanupCandidate struct {
	Name              string          `json:"name"`
	IsRemote          bool            `json:"isRemote"`
	Category          CleanupCategory `json:"category"`
	Reason            string          `json:"reason"`
	LastCommitDate    string          `json:"lastCommitDate"`
	LastAuthor        string          `json:"lastAuthor"`
	HasLocalAndRemote bool            `json:"hasLocalAndRemote"`
	SessionID         string          `json:"sessionId,omitempty"`
	SessionName       string          `json:"sessionName,omitempty"`
	SessionStatus     string          `json:"sessionStatus,omitempty"`
	IsProtected       bool            `json:"isProtected"`
	Deletable         bool            `json:"deletable"`
}

// CleanupAnalysisRequest contains parameters for branch cleanup analysis
type CleanupAnalysisRequest struct {
	StaleDaysThreshold int  `json:"staleDaysThreshold"`
	IncludeRemote      bool `json:"includeRemote"`
}

// CleanupAnalysisResponse contains the results of branch cleanup analysis
type CleanupAnalysisResponse struct {
	Candidates     []CleanupCandidate `json:"candidates"`
	Summary        map[string]int     `json:"summary"`
	ProtectedCount int                `json:"protectedCount"`
	TotalAnalyzed  int                `json:"totalAnalyzed"`
}

// CleanupBranchTarget specifies a branch to delete and which copies (local/remote) to remove
type CleanupBranchTarget struct {
	Name         string `json:"name"`
	DeleteLocal  bool   `json:"deleteLocal"`
	DeleteRemote bool   `json:"deleteRemote"`
}

// CleanupRequest contains the list of branches to delete
type CleanupRequest struct {
	Branches []CleanupBranchTarget `json:"branches"`
}

// CleanupBranchResult contains the result of deleting a single branch
type CleanupBranchResult struct {
	Name          string `json:"name"`
	DeletedLocal  bool   `json:"deletedLocal"`
	DeletedRemote bool   `json:"deletedRemote"`
	Error         string `json:"error,omitempty"`
}

// CleanupResult contains the overall results of a branch cleanup operation.
// Note: entries in Failed may have partial deletions (e.g. DeletedLocal=true
// when the local branch was removed but the remote deletion failed).
type CleanupResult struct {
	Succeeded []CleanupBranchResult `json:"succeeded"`
	Failed    []CleanupBranchResult `json:"failed"`
}

// SessionInfo contains session metadata for branch analysis
type SessionInfo struct {
	ID     string
	Name   string
	Status string
}

// AnalyzeBranchesForCleanup analyzes all branches in a repository and categorizes them for cleanup
func (rm *RepoManager) AnalyzeBranchesForCleanup(
	ctx context.Context,
	repoPath string,
	staleDays int,
	includeRemote bool,
	sessionBranches map[string]*SessionInfo,
) (*CleanupAnalysisResponse, error) {
	if staleDays <= 0 {
		staleDays = 90
	}

	// Get all branches
	opts := BranchListOptions{
		IncludeRemote: includeRemote,
		Limit:         0, // all
		SortBy:        "date",
		SortDesc:      true,
	}
	branchResult, err := rm.ListBranches(ctx, repoPath, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to list branches: %w", err)
	}

	// Get current HEAD branch
	currentBranch, _ := rm.GetCurrentBranch(ctx, repoPath)

	// Get merged branches (local)
	mergedLocal := rm.getMergedBranches(ctx, repoPath, false)
	// Get merged branches (remote)
	var mergedRemote map[string]bool
	if includeRemote {
		mergedRemote = rm.getMergedBranches(ctx, repoPath, true)
	}

	// Get orphaned branches (local only, no upstream tracking)
	orphanedLocal := rm.getOrphanedBranches(ctx, repoPath)

	// Build a set of local branch names and remote branch names for cross-referencing
	localBranches := make(map[string]bool)
	remoteBranches := make(map[string]bool)
	for _, b := range branchResult.Branches {
		if b.IsRemote {
			// Strip "origin/" prefix for matching
			name := strings.TrimPrefix(b.Name, "origin/")
			remoteBranches[name] = true
		} else {
			localBranches[b.Name] = true
		}
	}

	staleThreshold := time.Now().AddDate(0, 0, -staleDays)

	response := &CleanupAnalysisResponse{
		Candidates: []CleanupCandidate{},
		Summary:    make(map[string]int),
	}

	for _, branch := range branchResult.Branches {
		candidate := CleanupCandidate{
			Name:           branch.Name,
			IsRemote:       branch.IsRemote,
			LastCommitDate: branch.LastCommitDate.Format(time.RFC3339),
			LastAuthor:     branch.LastAuthor,
		}

		// Check if branch exists in both local and remote
		if branch.IsRemote {
			remoteName := strings.TrimPrefix(branch.Name, "origin/")
			candidate.HasLocalAndRemote = localBranches[remoteName]
		} else {
			candidate.HasLocalAndRemote = remoteBranches[branch.Name]
		}

		// Attach session info
		if si, ok := sessionBranches[branch.Name]; ok {
			candidate.SessionID = si.ID
			candidate.SessionName = si.Name
			candidate.SessionStatus = si.Status
		}

		// Determine category
		rm.categorizeBranch(
			&candidate,
			branch,
			currentBranch,
			mergedLocal,
			mergedRemote,
			orphanedLocal,
			staleThreshold,
			staleDays,
		)

		response.Candidates = append(response.Candidates, candidate)
		response.Summary[string(candidate.Category)]++
		if candidate.IsProtected {
			response.ProtectedCount++
		}
	}

	response.TotalAnalyzed = len(branchResult.Branches)

	return response, nil
}

// categorizeBranch determines the cleanup category for a single branch
func (rm *RepoManager) categorizeBranch(
	candidate *CleanupCandidate,
	branch BranchInfo,
	currentBranch string,
	mergedLocal map[string]bool,
	mergedRemote map[string]bool,
	orphanedLocal map[string]bool,
	staleThreshold time.Time,
	staleDays int,
) {
	// Check if protected
	isProtected := rm.isBranchProtected(branch, currentBranch, candidate.SessionStatus)
	candidate.IsProtected = isProtected

	if isProtected {
		candidate.Category = CategorySafe
		candidate.Deletable = false
		candidate.Reason = rm.getProtectedReason(branch, currentBranch, candidate.SessionStatus)
		return
	}

	// Check if merged
	if branch.IsRemote {
		remoteName := branch.Name
		if mergedRemote != nil && mergedRemote[remoteName] {
			candidate.Category = CategoryMerged
			candidate.Deletable = true
			candidate.Reason = "Fully merged into main"
			return
		}
	} else {
		if mergedLocal[branch.Name] {
			candidate.Category = CategoryMerged
			candidate.Deletable = true
			candidate.Reason = "Fully merged into main"
			return
		}
	}

	// Check if stale
	if !branch.LastCommitDate.IsZero() && branch.LastCommitDate.Before(staleThreshold) {
		daysSinceCommit := int(time.Since(branch.LastCommitDate).Hours() / 24)
		candidate.Category = CategoryStale
		candidate.Deletable = true
		candidate.Reason = fmt.Sprintf("No commits in %d days", daysSinceCommit)
		return
	}

	// Check if orphaned (local only, no remote tracking branch)
	if !branch.IsRemote && orphanedLocal[branch.Name] {
		candidate.Category = CategoryOrphaned
		candidate.Deletable = true
		candidate.Reason = "No remote tracking branch"
		return
	}

	// Otherwise, it's safe/active
	candidate.Category = CategorySafe
	candidate.Deletable = false
	candidate.Reason = "Active branch"
}

// isBranchProtected checks if a branch should never be deleted
func (rm *RepoManager) isBranchProtected(branch BranchInfo, currentBranch string, sessionStatus string) bool {
	name := branch.Name
	if branch.IsRemote {
		name = strings.TrimPrefix(name, "origin/")
	}

	// HEAD branch
	if branch.IsHead || name == currentBranch {
		return true
	}

	// Protected names
	if protectedBranchNames[name] {
		return true
	}

	// Active or idle sessions
	if sessionStatus == "active" || sessionStatus == "idle" {
		return true
	}

	return false
}

// getProtectedReason returns a human-readable reason why a branch is protected
func (rm *RepoManager) getProtectedReason(branch BranchInfo, currentBranch string, sessionStatus string) string {
	name := branch.Name
	if branch.IsRemote {
		name = strings.TrimPrefix(name, "origin/")
	}

	if branch.IsHead || name == currentBranch {
		return "Current HEAD branch"
	}
	if protectedBranchNames[name] {
		return "Protected branch"
	}
	if sessionStatus == "active" || sessionStatus == "idle" {
		return fmt.Sprintf("Active session (%s)", sessionStatus)
	}
	return "Protected"
}

// getMergedBranches returns a set of branch names that are fully merged into origin/main
func (rm *RepoManager) getMergedBranches(ctx context.Context, repoPath string, remote bool) map[string]bool {
	merged := make(map[string]bool)

	// Try origin/main first, then main, then origin/master, master
	bases := []string{"origin/main", "main", "origin/master", "master"}
	for _, base := range bases {
		args := []string{"branch", "--merged", base}
		if remote {
			args = append(args, "-r")
		}

		cmd, cancel := gitCmdWithContext(ctx, repoPath, args...)
		out, err := cmd.Output()
		cancel()
		if err != nil {
			continue
		}

		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		for _, line := range lines {
			name := strings.TrimSpace(line)
			// Remove the "* " prefix for current branch
			name = strings.TrimPrefix(name, "* ")
			name = strings.TrimSpace(name)
			if name != "" {
				merged[name] = true
			}
		}
		// Return on first successful command (even if empty — an empty result
		// means no branches are merged into this base, which is valid).
		// We only fall through to the next base on git command error.
		return merged
	}

	return merged
}

// getOrphanedBranches returns local branches that have no upstream tracking branch
func (rm *RepoManager) getOrphanedBranches(ctx context.Context, repoPath string) map[string]bool {
	orphaned := make(map[string]bool)

	// Get all local branches with their upstream
	cmd, cancel := gitCmdWithContext(ctx, repoPath,
		"for-each-ref", "--format=%(refname:short) %(upstream)", "refs/heads/")
	out, err := cmd.Output()
	cancel()
	if err != nil {
		return orphaned
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, " ", 2)
		branchName := parts[0]
		upstream := ""
		if len(parts) > 1 {
			upstream = strings.TrimSpace(parts[1])
		}
		if upstream == "" {
			orphaned[branchName] = true
		}
	}

	return orphaned
}

// DeleteBranches deletes the specified branches with safety checks
func (rm *RepoManager) DeleteBranches(
	ctx context.Context,
	repoPath string,
	targets []CleanupBranchTarget,
	sessionBranches map[string]*SessionInfo,
) (*CleanupResult, error) {
	result := &CleanupResult{
		Succeeded: []CleanupBranchResult{},
		Failed:    []CleanupBranchResult{},
	}

	// Get current HEAD for safety
	currentBranch, _ := rm.GetCurrentBranch(ctx, repoPath)

	// Get merged branches for safe vs force delete decision
	mergedLocal := rm.getMergedBranches(ctx, repoPath, false)

	for _, target := range targets {
		branchResult := CleanupBranchResult{Name: target.Name}

		// Validate branch name
		if err := ValidateGitRef(target.Name); err != nil {
			branchResult.Error = fmt.Sprintf("invalid branch name: %v", err)
			result.Failed = append(result.Failed, branchResult)
			continue
		}

		// Safety: never delete protected branches
		if rm.isNameProtected(target.Name, currentBranch, sessionBranches) {
			branchResult.Error = "branch is protected and cannot be deleted"
			result.Failed = append(result.Failed, branchResult)
			continue
		}

		// Delete local branch
		if target.DeleteLocal {
			err := rm.deleteLocalBranch(ctx, repoPath, target.Name, mergedLocal[target.Name])
			if err != nil {
				branchResult.Error = fmt.Sprintf("local delete failed: %v", err)
				result.Failed = append(result.Failed, branchResult)
				continue
			}
			branchResult.DeletedLocal = true
		}

		// Delete remote branch
		if target.DeleteRemote {
			remoteName := strings.TrimPrefix(target.Name, "origin/")
			err := rm.deleteRemoteBranch(ctx, repoPath, remoteName)
			if err != nil {
				// If local succeeded but remote failed, still report as failed
				branchResult.Error = fmt.Sprintf("remote delete failed: %v", err)
				result.Failed = append(result.Failed, branchResult)
				continue
			}
			branchResult.DeletedRemote = true
		}

		result.Succeeded = append(result.Succeeded, branchResult)
	}

	return result, nil
}

// isNameProtected checks if a branch name should never be deleted (re-validation before deletion)
func (rm *RepoManager) isNameProtected(name string, currentBranch string, sessionBranches map[string]*SessionInfo) bool {
	cleanName := strings.TrimPrefix(name, "origin/")

	if cleanName == currentBranch {
		return true
	}
	if protectedBranchNames[cleanName] {
		return true
	}
	if si, ok := sessionBranches[name]; ok {
		if si.Status == "active" || si.Status == "idle" {
			return true
		}
	}
	return false
}

// deleteLocalBranch deletes a local git branch
func (rm *RepoManager) deleteLocalBranch(ctx context.Context, repoPath string, name string, isMerged bool) error {
	// Use -d (safe) for merged branches, -D (force) for unmerged
	flag := "-d"
	if !isMerged {
		flag = "-D"
	}

	cmd, cancel := gitCmdWithContext(ctx, repoPath, "branch", flag, name)
	defer cancel()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s", strings.TrimSpace(string(out)))
	}
	return nil
}

// deleteRemoteBranch deletes a remote branch
func (rm *RepoManager) deleteRemoteBranch(ctx context.Context, repoPath string, name string) error {
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "push", "origin", "--delete", name)
	defer cancel()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s", strings.TrimSpace(string(out)))
	}
	return nil
}
