package git

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// WorkspacesBaseDir returns the base directory for session worktrees: ~/.chatml/workspaces
func WorkspacesBaseDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	return filepath.Join(homeDir, ".chatml", "workspaces"), nil
}

type WorktreeManager struct{}

func NewWorktreeManager() *WorktreeManager {
	return &WorktreeManager{}
}

func (wm *WorktreeManager) Create(repoPath, agentID string) (worktreePath string, branchName string, baseCommit string, err error) {
	branchName = fmt.Sprintf("agent/%s", agentID)
	return wm.CreateWithBranch(repoPath, agentID, branchName)
}

// CreateWithBranch creates a worktree with a custom branch name in the repo's .worktrees directory.
// Returns the worktree path, branch name, and the base commit SHA that the worktree was created from.
// Deprecated: Use CreateAtPath for new code - it allows specifying the worktree location.
func (wm *WorktreeManager) CreateWithBranch(repoPath, worktreeID, branchName string) (worktreePath string, branch string, baseCommit string, err error) {
	worktreesDir := filepath.Join(repoPath, ".worktrees")
	worktreePath = filepath.Join(worktreesDir, worktreeID)
	return wm.CreateAtPath(repoPath, worktreePath, branchName)
}

// CreateAtPath creates a worktree at a specific absolute path with a custom branch name.
// Returns the worktree path, branch name, and the base commit SHA that the worktree was created from.
func (wm *WorktreeManager) CreateAtPath(repoPath, worktreePath, branchName string) (string, string, string, error) {
	// Capture current HEAD before creating the worktree - this is the base commit
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = repoPath
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

	cmd = exec.Command("git", "worktree", "add", "-b", branchName, worktreePath)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", "", "", fmt.Errorf("failed to create worktree: %s: %w", string(out), err)
	}

	return worktreePath, branchName, baseCommit, nil
}

func (wm *WorktreeManager) Remove(repoPath, agentID string) error {
	branchName := fmt.Sprintf("agent/%s", agentID)
	return wm.RemoveByPath(repoPath, agentID, branchName)
}

// RemoveByPath removes a worktree by its ID and branch name from the repo's .worktrees directory.
// Deprecated: Use RemoveAtPath for new code - it works with absolute worktree paths.
func (wm *WorktreeManager) RemoveByPath(repoPath, worktreeID, branchName string) error {
	worktreePath := filepath.Join(repoPath, ".worktrees", worktreeID)
	return wm.RemoveAtPath(repoPath, worktreePath, branchName)
}

// RemoveAtPath removes a worktree at an absolute path and deletes its branch.
func (wm *WorktreeManager) RemoveAtPath(repoPath, worktreePath, branchName string) error {
	// Remove the worktree
	cmd := exec.Command("git", "worktree", "remove", worktreePath, "--force")
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to remove worktree: %s: %w", string(out), err)
	}

	// Delete the branch
	cmd = exec.Command("git", "branch", "-D", branchName)
	cmd.Dir = repoPath
	cmd.CombinedOutput() // Ignore error, branch might not exist

	return nil
}

func (wm *WorktreeManager) List(repoPath string) ([]string, error) {
	cmd := exec.Command("git", "worktree", "list", "--porcelain")
	cmd.Dir = repoPath
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
			if strings.Contains(path, ".worktrees") || (workspacesDir != "" && strings.HasPrefix(path, workspacesDir)) {
				worktrees = append(worktrees, path)
			}
		}
	}
	return worktrees, nil
}

func (wm *WorktreeManager) GetDiff(repoPath, agentID string) (string, error) {
	branchName := fmt.Sprintf("agent/%s", agentID)

	// Get the base branch
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = repoPath
	baseOut, err := cmd.Output()
	if err != nil {
		return "", err
	}
	baseBranch := strings.TrimSpace(string(baseOut))

	// Get diff
	cmd = exec.Command("git", "diff", baseBranch+"..."+branchName)
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		// If diff fails, try without the three-dot syntax
		cmd = exec.Command("git", "diff", baseBranch, branchName)
		cmd.Dir = repoPath
		out, err = cmd.Output()
		if err != nil {
			return "", err
		}
	}

	return string(out), nil
}

func (wm *WorktreeManager) Merge(repoPath, agentID string) error {
	branchName := fmt.Sprintf("agent/%s", agentID)

	cmd := exec.Command("git", "merge", branchName, "--no-edit")
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("merge failed: %s: %w", string(out), err)
	}

	return nil
}

// RenameBranch renames a git branch. The command must be run from within the worktree
// that has the branch checked out, as you cannot rename a branch from outside.
func (wm *WorktreeManager) RenameBranch(worktreePath, oldBranchName, newBranchName string) error {
	cmd := exec.Command("git", "branch", "-m", oldBranchName, newBranchName)
	cmd.Dir = worktreePath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to rename branch: %s: %w", string(out), err)
	}
	return nil
}
