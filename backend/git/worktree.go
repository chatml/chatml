package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ErrDirectoryExists indicates a name collision during atomic directory creation
var ErrDirectoryExists = errors.New("directory already exists")

// WorkspacesBaseDir returns the base directory for session worktrees: ~/.chatml/workspaces
func WorkspacesBaseDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	return filepath.Join(homeDir, ".chatml", "workspaces"), nil
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
// Deprecated: Use CreateAtPath for new code - it allows specifying the worktree location.
func (wm *WorktreeManager) CreateWithBranch(ctx context.Context, repoPath, worktreeID, branchName string) (worktreePath string, branch string, baseCommit string, err error) {
	worktreesDir := filepath.Join(repoPath, ".worktrees")
	worktreePath = filepath.Join(worktreesDir, worktreeID)
	return wm.CreateAtPath(ctx, repoPath, worktreePath, branchName)
}

// CreateAtPath creates a worktree at a specific absolute path with a custom branch name.
// Returns the worktree path, branch name, and the base commit SHA that the worktree was created from.
func (wm *WorktreeManager) CreateAtPath(ctx context.Context, repoPath, worktreePath, branchName string) (string, string, string, error) {
	// Capture current HEAD before creating the worktree - this is the base commit
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "rev-parse", "HEAD")
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return "", "", "", fmt.Errorf("failed to get current HEAD: %w", err)
	}
	baseCommit := strings.TrimSpace(string(out))

	// Ensure parent directory exists
	parentDir := filepath.Dir(worktreePath)
	if err := os.MkdirAll(parentDir, 0755); err != nil {
		return "", "", "", fmt.Errorf("failed to create parent dir %s: %w", parentDir, err)
	}

	cmd, cancel = gitCmdWithContext(ctx, repoPath, "worktree", "add", "-b", branchName, worktreePath)
	defer cancel()
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", "", "", fmt.Errorf("failed to create worktree: %s: %w", string(out), err)
	}

	return worktreePath, branchName, baseCommit, nil
}

// CreateInExistingDir creates a git worktree in an existing directory.
// The directory must already exist (created atomically by caller via CreateSessionDirectoryAtomic).
// Returns the worktree path, branch name, and the base commit SHA.
func (wm *WorktreeManager) CreateInExistingDir(ctx context.Context, repoPath, worktreePath, branchName string) (string, string, string, error) {
	// Capture current HEAD before creating the worktree - this is the base commit
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "rev-parse", "HEAD")
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return "", "", "", fmt.Errorf("failed to get current HEAD: %w", err)
	}
	baseCommit := strings.TrimSpace(string(out))

	// Create worktree in the existing directory
	// git worktree add will work with an existing empty directory
	cmd, cancel = gitCmdWithContext(ctx, repoPath, "worktree", "add", "-b", branchName, worktreePath)
	defer cancel()
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", "", "", fmt.Errorf("failed to create worktree: %s: %w", string(out), err)
	}

	return worktreePath, branchName, baseCommit, nil
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
	// Remove the worktree
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "worktree", "remove", worktreePath, "--force")
	defer cancel()
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to remove worktree: %s: %w", string(out), err)
	}

	// Delete the branch if specified
	if branchName != "" {
		cmd, cancel = gitCmdWithContext(ctx, repoPath, "branch", "-D", branchName)
		defer cancel()
		cmd.CombinedOutput() // Ignore error, branch might not exist
	}

	return nil
}

func (wm *WorktreeManager) List(ctx context.Context, repoPath string) ([]string, error) {
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "worktree", "list", "--porcelain")
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
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "rev-parse", "--abbrev-ref", "HEAD")
	defer cancel()
	baseOut, err := cmd.Output()
	if err != nil {
		return "", err
	}
	baseBranch := strings.TrimSpace(string(baseOut))

	// Get diff
	cmd, cancel = gitCmdWithContext(ctx, repoPath, "diff", baseBranch+"..."+branchName)
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		// If diff fails, try without the three-dot syntax
		cmd, cancel = gitCmdWithContext(ctx, repoPath, "diff", baseBranch, branchName)
		defer cancel()
		out, err = cmd.Output()
		if err != nil {
			return "", err
		}
	}

	return string(out), nil
}

func (wm *WorktreeManager) Merge(ctx context.Context, repoPath, agentID string) error {
	branchName := fmt.Sprintf("agent/%s", agentID)

	cmd, cancel := gitCmdWithContext(ctx, repoPath, "merge", branchName, "--no-edit")
	defer cancel()
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("merge failed: %s: %w", string(out), err)
	}

	return nil
}

// RenameBranch renames a git branch. The command must be run from within the worktree
// that has the branch checked out, as you cannot rename a branch from outside.
func (wm *WorktreeManager) RenameBranch(ctx context.Context, worktreePath, oldBranchName, newBranchName string) error {
	cmd, cancel := gitCmdWithContext(ctx, worktreePath, "branch", "-m", oldBranchName, newBranchName)
	defer cancel()
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to rename branch: %s: %w", string(out), err)
	}
	return nil
}
