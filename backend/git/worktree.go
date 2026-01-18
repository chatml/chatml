package git

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type WorktreeManager struct{}

func NewWorktreeManager() *WorktreeManager {
	return &WorktreeManager{}
}

func (wm *WorktreeManager) Create(repoPath, agentID string) (worktreePath string, branchName string, err error) {
	branchName = fmt.Sprintf("agent/%s", agentID)
	return wm.CreateWithBranch(repoPath, agentID, branchName)
}

// CreateWithBranch creates a worktree with a custom branch name
func (wm *WorktreeManager) CreateWithBranch(repoPath, worktreeID, branchName string) (worktreePath string, branch string, err error) {
	worktreesDir := filepath.Join(repoPath, ".worktrees")
	if err := os.MkdirAll(worktreesDir, 0755); err != nil {
		return "", "", fmt.Errorf("failed to create worktrees dir: %w", err)
	}

	worktreePath = filepath.Join(worktreesDir, worktreeID)

	cmd := exec.Command("git", "worktree", "add", "-b", branchName, worktreePath)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", "", fmt.Errorf("failed to create worktree: %s: %w", string(out), err)
	}

	return worktreePath, branchName, nil
}

func (wm *WorktreeManager) Remove(repoPath, agentID string) error {
	branchName := fmt.Sprintf("agent/%s", agentID)
	return wm.RemoveByPath(repoPath, agentID, branchName)
}

// RemoveByPath removes a worktree by its ID and branch name
func (wm *WorktreeManager) RemoveByPath(repoPath, worktreeID, branchName string) error {
	worktreePath := filepath.Join(repoPath, ".worktrees", worktreeID)

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

	var worktrees []string
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "worktree ") {
			path := strings.TrimPrefix(line, "worktree ")
			if strings.Contains(path, ".worktrees") {
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
