package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/chatml/chatml-core/logger"
)

// ErrDirectoryExists indicates a name collision during atomic directory creation
var ErrDirectoryExists = errors.New("directory already exists")

// ErrBranchAlreadyCheckedOut indicates the branch is already in use by another worktree
var ErrBranchAlreadyCheckedOut = errors.New("branch is already checked out in another worktree")

// ErrLocalBranchExists indicates the local branch already exists (but is not checked out in a worktree)
var ErrLocalBranchExists = errors.New("local branch already exists")

// WorkspacesBaseDir returns the default base directory for session worktrees.
// It derives the path from the CHATML_DATA_DIR environment variable if set,
// otherwise uses the platform-specific default data directory + "/workspaces".
func WorkspacesBaseDir() (string, error) {
	var root string
	if override := os.Getenv("CHATML_DATA_DIR"); override != "" {
		root = override
	} else {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("get home directory: %w", err)
		}
		switch runtime.GOOS {
		case "darwin":
			root = filepath.Join(homeDir, "Library", "Application Support", "ChatML")
		case "windows":
			if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
				root = filepath.Join(localAppData, "ChatML")
			} else {
				root = filepath.Join(homeDir, "AppData", "Local", "ChatML")
			}
		default:
			if xdgData := os.Getenv("XDG_DATA_HOME"); xdgData != "" {
				root = filepath.Join(xdgData, "ChatML")
			} else {
				root = filepath.Join(homeDir, ".local", "share", "ChatML")
			}
		}
	}
	return filepath.Join(root, "workspaces"), nil
}

// WorkspacesBaseDirWithOverride returns the configured base directory if non-empty,
// otherwise falls back to the default (~/Library/Application Support/ChatML/workspaces).
func WorkspacesBaseDirWithOverride(configuredPath string) (string, error) {
	if configuredPath != "" {
		return configuredPath, nil
	}
	return WorkspacesBaseDir()
}

// CreateSessionDirectoryAtomic attempts to atomically create a session directory.
// Returns ErrDirectoryExists if the directory already exists (name collision).
// This uses os.Mkdir which is atomic at the filesystem level.
func CreateSessionDirectoryAtomic(basePath, sessionName string) (string, error) {
	sessionPath := filepath.Join(basePath, sessionName)
	if err := os.Mkdir(sessionPath, 0755); err != nil {
		if os.IsExist(err) {
			return "", ErrDirectoryExists
		}
		return "", fmt.Errorf("failed to create session directory: %w", err)
	}
	return sessionPath, nil
}

type WorktreeManager struct{}

func NewWorktreeManager() *WorktreeManager {
	return &WorktreeManager{}
}

func (wm *WorktreeManager) Create(ctx context.Context, repoPath, agentID string) (worktreePath string, branchName string, baseCommit string, err error) {
	branchName = fmt.Sprintf("agent/%s", agentID)
	return wm.CreateWithBranch(ctx, repoPath, agentID, branchName)
}

// CreateWithBranch creates a worktree with a custom branch name in the repo's .worktrees directory.
// Returns the worktree path, branch name, and the base commit SHA that the worktree was created from.
// Deprecated: Use CreateAtPath or CreateInExistingDir for new code — they accept a targetBranch parameter.
// This method always bases the worktree on origin/main.
func (wm *WorktreeManager) CreateWithBranch(ctx context.Context, repoPath, worktreeID, branchName string) (worktreePath string, branch string, baseCommit string, err error) {
	worktreesDir := filepath.Join(repoPath, ".worktrees")
	worktreePath = filepath.Join(worktreesDir, worktreeID)
	return wm.CreateAtPath(ctx, repoPath, worktreePath, branchName, "origin/main")
}

// CreateAtPath creates a worktree at a specific absolute path with a custom branch name.
// Returns the worktree path, branch name, and the base commit SHA that the worktree was created from.
// The worktree branch is based on the specified targetBranch (e.g. "origin/main", "origin/develop").
func (wm *WorktreeManager) CreateAtPath(ctx context.Context, repoPath, worktreePath, branchName, targetBranch string) (string, string, string, error) {
	// Capture target branch commit - this is the base commit for the new worktree
	cmd, cancel := gitCmdWithContext(ctx, TimeoutFast, repoPath, "rev-parse", targetBranch)
	out, err := cmd.Output()
	cancel()
	if err != nil {
		return "", "", "", fmt.Errorf("failed to get %s: repository must have the branch available: %w", targetBranch, err)
	}
	baseCommit := strings.TrimSpace(string(out))

	// Ensure parent directory exists
	parentDir := filepath.Dir(worktreePath)
	if err := os.MkdirAll(parentDir, 0755); err != nil {
		return "", "", "", fmt.Errorf("failed to create parent dir %s: %w", parentDir, err)
	}

	cmd, cancel = gitCmdWithContext(ctx, TimeoutMedium, repoPath, "worktree", "add", "-b", branchName, worktreePath, targetBranch)
	defer cancel()
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", "", "", fmt.Errorf("failed to create worktree: %s: %w", string(out), err)
	}

	return worktreePath, branchName, baseCommit, nil
}

// CreateInExistingDir creates a git worktree in an existing directory.
// The directory must already exist (created atomically by caller via CreateSessionDirectoryAtomic).
// Returns the worktree path, branch name, and the base commit SHA.
// The worktree branch is based on the specified targetBranch (e.g. "origin/main", "origin/develop").
func (wm *WorktreeManager) CreateInExistingDir(ctx context.Context, repoPath, worktreePath, branchName, targetBranch string) (string, string, string, error) {
	// Capture target branch commit - this is the base commit for the new worktree
	cmd, cancel := gitCmdWithContext(ctx, TimeoutFast, repoPath, "rev-parse", targetBranch)
	out, err := cmd.Output()
	cancel()
	if err != nil {
		return "", "", "", fmt.Errorf("failed to get %s: repository must have the branch available: %w", targetBranch, err)
	}
	baseCommit := strings.TrimSpace(string(out))

	// Create worktree in the existing directory
	// git worktree add will work with an existing empty directory
	cmd, cancel = gitCmdWithContext(ctx, TimeoutMedium, repoPath, "worktree", "add", "-b", branchName, worktreePath, targetBranch)
	defer cancel()
	if out, err := cmd.CombinedOutput(); err != nil {
		errMsg := string(out)
		if strings.Contains(errMsg, "already checked out") ||
			strings.Contains(errMsg, "is already used by worktree") {
			return "", "", "", fmt.Errorf("%w: %s", ErrBranchAlreadyCheckedOut, errMsg)
		}
		if strings.Contains(errMsg, "already exists") {
			return "", "", "", fmt.Errorf("%w: %s", ErrLocalBranchExists, errMsg)
		}
		return "", "", "", fmt.Errorf("failed to create worktree: %s: %w", errMsg, err)
	}

	return worktreePath, branchName, baseCommit, nil
}

// CheckoutExistingBranchInDir creates a worktree that checks out an existing remote branch.
// Unlike CreateInExistingDir which creates a new branch with -b, this checks out an existing
// remote branch (e.g. origin/feature-branch) and creates a local tracking branch.
// The directory must already exist (created atomically by caller).
// Returns the worktree path, local branch name, and the base commit SHA.
func (wm *WorktreeManager) CheckoutExistingBranchInDir(ctx context.Context, repoPath, worktreePath, remoteBranch string) (string, string, string, error) {
	// Reject protected branches (main, master, develop) to prevent sessions from using them
	if IsProtectedBranch(remoteBranch) {
		return "", "", "", fmt.Errorf("cannot create session on protected branch '%s'", remoteBranch)
	}

	// Fetch the specific branch from origin (targeted fetch is faster than fetching all refs)
	cmd, cancel := gitCmdWithContext(ctx, TimeoutHeavy, repoPath, "fetch", "origin", remoteBranch)
	if out, err := cmd.CombinedOutput(); err != nil {
		cancel()
		return "", "", "", fmt.Errorf("failed to fetch origin: %s: %w", string(out), err)
	}
	cancel()

	// Resolve the remote branch ref to get the base commit SHA
	remoteRef := fmt.Sprintf("origin/%s", remoteBranch)
	cmd, cancel = gitCmdWithContext(ctx, TimeoutFast, repoPath, "rev-parse", remoteRef)
	out, err := cmd.Output()
	cancel()
	if err != nil {
		return "", "", "", fmt.Errorf("remote branch '%s' not found on origin: %w", remoteBranch, err)
	}
	baseCommit := strings.TrimSpace(string(out))

	// Create worktree with a local tracking branch using -b.
	// "git worktree add -b <branch> --track <path> <remote-ref>" creates a local branch
	// tracking the remote. Possible errors:
	// - "already checked out" / "is already used by worktree" → branch is in use by another worktree
	// - "already exists" → local branch exists but is not checked out in a worktree
	cmd, cancel = gitCmdWithContext(ctx, TimeoutMedium, repoPath, "worktree", "add", "-b", remoteBranch, "--track", worktreePath, remoteRef)
	defer cancel()
	if out, err := cmd.CombinedOutput(); err != nil {
		errMsg := string(out)
		if strings.Contains(errMsg, "already checked out") ||
			strings.Contains(errMsg, "is already used by worktree") {
			return "", "", "", fmt.Errorf("%w: %s", ErrBranchAlreadyCheckedOut, errMsg)
		}
		if strings.Contains(errMsg, "already exists") {
			return "", "", "", fmt.Errorf("%w: %s", ErrLocalBranchExists, errMsg)
		}
		return "", "", "", fmt.Errorf("failed to create worktree: %s: %w", errMsg, err)
	}

	return worktreePath, remoteBranch, baseCommit, nil
}

// RestoreSessionWorktree ensures a worktree and branch exist for a session being unarchived.
// It handles the case where the local branch and/or worktree directory were deleted
// (e.g., by branch cleanup, manual deletion, or the deleteBranchOnArchive setting).
//
// Strategy:
//  1. If worktree path is already a valid git worktree → no-op
//  2. If local branch exists → create worktree from it
//  3. If remote branch (origin/<branch>) exists → fetch and create worktree + tracking branch
//  4. If baseCommitSHA is available → create worktree + branch from that commit
//  5. If targetBranch is available → create worktree + branch from target (last resort)
//  6. Otherwise → return error
func (wm *WorktreeManager) RestoreSessionWorktree(ctx context.Context, repoPath, worktreePath, branchName, baseCommitSHA, targetBranch string) error {
	// Step 1: Check if worktree already exists and is valid
	if _, err := os.Stat(worktreePath); err == nil {
		// Directory exists — check if it's a valid worktree
		cmd, cancel := gitCmdWithContext(ctx, TimeoutMedium, repoPath, "worktree", "list", "--porcelain")
		out, listErr := cmd.Output()
		cancel()
		if listErr == nil {
			for _, line := range strings.Split(string(out), "\n") {
				if strings.TrimSpace(line) == "worktree "+worktreePath {
					logger.Cleanup.Infof("Worktree already valid for restore: %s", worktreePath)
					return nil // Already a valid worktree
				}
			}
		}
		// Directory exists but is not a valid worktree — remove it so we can recreate
		if removeErr := os.RemoveAll(worktreePath); removeErr != nil {
			return fmt.Errorf("failed to remove stale worktree directory %s: %w", worktreePath, removeErr)
		}
	}

	// Prune stale worktree entries before trying to create a new one
	cmd, cancel := gitCmdWithContext(ctx, TimeoutMedium, repoPath, "worktree", "prune")
	if pruneOut, pruneErr := cmd.CombinedOutput(); pruneErr != nil {
		logger.Cleanup.Warnf("git worktree prune failed: %s", strings.TrimSpace(string(pruneOut)))
	}
	cancel()

	// Ensure parent directory exists
	parentDir := filepath.Dir(worktreePath)
	if err := os.MkdirAll(parentDir, 0755); err != nil {
		return fmt.Errorf("failed to create parent dir %s: %w", parentDir, err)
	}

	// Step 2: Check if local branch still exists
	cmd, cancel = gitCmdWithContext(ctx, TimeoutFast, repoPath, "rev-parse", "--verify", "refs/heads/"+branchName)
	_, localErr := cmd.Output()
	cancel()

	if localErr == nil {
		// Local branch exists — just create a worktree from it
		logger.Cleanup.Infof("Restoring worktree from existing local branch %s", branchName)
		cmd, cancel = gitCmdWithContext(ctx, TimeoutMedium, repoPath, "worktree", "add", worktreePath, branchName)
		out, err := cmd.CombinedOutput()
		cancel()
		if err != nil {
			return fmt.Errorf("failed to restore worktree from local branch: %s: %w", strings.TrimSpace(string(out)), err)
		}
		return nil
	}

	// Step 3: Check if remote branch exists
	remoteRef := "refs/remotes/origin/" + branchName
	cmd, cancel = gitCmdWithContext(ctx, TimeoutFast, repoPath, "rev-parse", "--verify", remoteRef)
	_, remoteErr := cmd.Output()
	cancel()

	if remoteErr == nil {
		// Remote branch exists — fetch and create tracking worktree
		logger.Cleanup.Infof("Restoring worktree from remote branch origin/%s", branchName)
		cmd, cancel = gitCmdWithContext(ctx, TimeoutHeavy, repoPath, "fetch", "origin", branchName)
		cmd.CombinedOutput()
		cancel()

		cmd, cancel = gitCmdWithContext(ctx, TimeoutMedium, repoPath, "worktree", "add", "-b", branchName, "--track", worktreePath, "origin/"+branchName)
		out, err := cmd.CombinedOutput()
		cancel()
		if err != nil {
			return fmt.Errorf("failed to restore worktree from remote branch: %s: %w", strings.TrimSpace(string(out)), err)
		}
		return nil
	}

	// Step 4: Fall back to BaseCommitSHA
	if baseCommitSHA != "" {
		logger.Cleanup.Infof("Restoring worktree from base commit %s for branch %s", baseCommitSHA, branchName)
		cmd, cancel = gitCmdWithContext(ctx, TimeoutMedium, repoPath, "worktree", "add", "-b", branchName, worktreePath, baseCommitSHA)
		out, err := cmd.CombinedOutput()
		cancel()
		if err != nil {
			return fmt.Errorf("failed to restore worktree from base commit: %s: %w", strings.TrimSpace(string(out)), err)
		}
		return nil
	}

	// Step 5: Fall back to targetBranch (e.g. origin/main) as last resort
	if targetBranch != "" {
		logger.Cleanup.Infof("Restoring worktree from target branch %s for branch %s", targetBranch, branchName)
		cmd, cancel = gitCmdWithContext(ctx, TimeoutMedium, repoPath, "worktree", "add", "-b", branchName, worktreePath, targetBranch)
		out, err := cmd.CombinedOutput()
		cancel()
		if err != nil {
			return fmt.Errorf("failed to restore worktree from target branch: %s: %w", strings.TrimSpace(string(out)), err)
		}
		return nil
	}

	return fmt.Errorf("cannot restore worktree for branch %s: no local branch, no remote branch, no base commit, and no target branch", branchName)
}

func (wm *WorktreeManager) Remove(ctx context.Context, repoPath, agentID string) error {
	branchName := fmt.Sprintf("agent/%s", agentID)
	return wm.RemoveByPath(ctx, repoPath, agentID, branchName)
}

// RemoveByPath removes a worktree by its ID and branch name from the repo's .worktrees directory.
// Deprecated: Use RemoveAtPath for new code - it works with absolute worktree paths.
func (wm *WorktreeManager) RemoveByPath(ctx context.Context, repoPath, worktreeID, branchName string) error {
	worktreePath := filepath.Join(repoPath, ".worktrees", worktreeID)
	return wm.RemoveAtPath(ctx, repoPath, worktreePath, branchName)
}

// RemoveAtPath removes a worktree at an absolute path and deletes its branch.
// If branchName is empty, only the worktree is removed (branch deletion is skipped).
func (wm *WorktreeManager) RemoveAtPath(ctx context.Context, repoPath, worktreePath, branchName string) error {
	logger.Cleanup.Infof("Removing worktree: path=%s branch=%s repo=%s", worktreePath, branchName, repoPath)

	// Remove the worktree
	cmd, cancel := gitCmdWithContext(ctx, TimeoutMedium, repoPath, "worktree", "remove", worktreePath, "--force")
	out, err := cmd.CombinedOutput()
	cancel()
	if err != nil {
		return fmt.Errorf("failed to remove worktree: %s: %w", string(out), err)
	}

	// Prune stale worktree entries from git's internal tracking (.git/worktrees/)
	cmd, cancel = gitCmdWithContext(ctx, TimeoutMedium, repoPath, "worktree", "prune")
	pruneOut, pruneErr := cmd.CombinedOutput()
	cancel()
	if pruneErr != nil {
		logger.Cleanup.Warnf("Failed to prune worktrees for %s: %s: %v", repoPath, string(pruneOut), pruneErr)
	}

	// Delete the branch if specified
	if branchName != "" {
		cmd, cancel = gitCmdWithContext(ctx, TimeoutMedium, repoPath, "branch", "-D", branchName)
		if branchOut, branchErr := cmd.CombinedOutput(); branchErr != nil {
			logger.Cleanup.Warnf("Failed to delete branch %q in %s: %s: %v", branchName, repoPath, string(branchOut), branchErr)
		}
		cancel()
	}

	return nil
}

func (wm *WorktreeManager) List(ctx context.Context, repoPath string) ([]string, error) {
	cmd, cancel := gitCmdWithContext(ctx, TimeoutMedium, repoPath, "worktree", "list", "--porcelain")
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	// Get the workspaces base directory to recognize new-style worktrees
	workspacesDir, _ := WorkspacesBaseDir() // Ignore error, will just not match new-style

	var worktrees []string
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "worktree ") {
			path := strings.TrimPrefix(line, "worktree ")
			// Include old-style worktrees (in .worktrees dir) and new-style (in ~/.chatml/workspaces)
			if strings.Contains(path, ".worktrees") || (workspacesDir != "" && strings.HasPrefix(path, workspacesDir+string(os.PathSeparator))) {
				worktrees = append(worktrees, path)
			}
		}
	}
	return worktrees, nil
}

func (wm *WorktreeManager) GetDiff(ctx context.Context, repoPath, agentID string) (string, error) {
	branchName := fmt.Sprintf("agent/%s", agentID)

	// Get the base branch
	cmd, cancel := gitCmdWithContext(ctx, TimeoutFast, repoPath, "rev-parse", "--abbrev-ref", "HEAD")
	baseOut, err := cmd.Output()
	cancel()
	if err != nil {
		return "", err
	}
	baseBranch := strings.TrimSpace(string(baseOut))

	// Get diff
	cmd, cancel = gitCmdWithContext(ctx, TimeoutHeavy, repoPath, "diff", baseBranch+"..."+branchName)
	out, err := cmd.Output()
	cancel()
	if err != nil {
		// If diff fails, try without the three-dot syntax
		cmd, cancel = gitCmdWithContext(ctx, TimeoutHeavy, repoPath, "diff", baseBranch, branchName)
		out, err = cmd.Output()
		cancel()
		if err != nil {
			return "", err
		}
	}

	return string(out), nil
}

func (wm *WorktreeManager) Merge(ctx context.Context, repoPath, agentID string) error {
	branchName := fmt.Sprintf("agent/%s", agentID)

	cmd, cancel := gitCmdWithContext(ctx, TimeoutHeavy, repoPath, "merge", branchName, "--no-edit")
	defer cancel()
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("merge failed: %s: %w", string(out), err)
	}

	return nil
}

// RenameBranch renames a git branch. The command must be run from within the worktree
// that has the branch checked out, as you cannot rename a branch from outside.
func (wm *WorktreeManager) RenameBranch(ctx context.Context, worktreePath, oldBranchName, newBranchName string) error {
	cmd, cancel := gitCmdWithContext(ctx, TimeoutFast, worktreePath, "branch", "-m", oldBranchName, newBranchName)
	defer cancel()
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to rename branch: %s: %w", string(out), err)
	}
	return nil
}
