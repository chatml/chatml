package git

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Default timeout for git commands
const gitCommandTimeout = 30 * time.Second

// gitCmdContext creates a git command with the given context
func gitCmdContext(ctx context.Context, repoPath string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = repoPath
	return cmd
}

// gitCmd creates a git command with a timeout context.
// Returns the command and a cancel function that MUST be called when done.
func gitCmd(repoPath string, args ...string) (*exec.Cmd, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(context.Background(), gitCommandTimeout)
	cmd := gitCmdContext(ctx, repoPath, args...)
	return cmd, cancel
}

type RepoManager struct{}

func NewRepoManager() *RepoManager {
	return &RepoManager{}
}

func (rm *RepoManager) ValidateRepo(path string) error {
	gitDir := filepath.Join(path, ".git")
	if _, err := os.Stat(gitDir); os.IsNotExist(err) {
		return fmt.Errorf("not a git repository: %s", path)
	}
	return nil
}

func (rm *RepoManager) GetCurrentBranch(repoPath string) (string, error) {
	cmd, cancel := gitCmd(repoPath, "rev-parse", "--abbrev-ref", "HEAD")
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func (rm *RepoManager) GetRepoName(path string) string {
	return filepath.Base(path)
}

// GetFileAtRef returns the content of a file at a specific git ref (branch, tag, or commit)
func (rm *RepoManager) GetFileAtRef(repoPath, ref, filePath string) (string, error) {
	cmd, cancel := gitCmd(repoPath, "show", fmt.Sprintf("%s:%s", ref, filePath))
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// GetChangedFiles returns a list of files that have changed compared to a base ref
func (rm *RepoManager) GetChangedFiles(repoPath, baseRef string) ([]string, error) {
	cmd, cancel := gitCmd(repoPath, "diff", "--name-only", baseRef)
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	var files []string
	for _, line := range lines {
		if line != "" {
			files = append(files, line)
		}
	}
	return files, nil
}

// FileChange represents a changed file with stats
type FileChange struct {
	Path      string `json:"path"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Status    string `json:"status"` // "added", "modified", "deleted"
}

// GetChangedFilesWithStats returns files changed compared to a base ref with addition/deletion counts
func (rm *RepoManager) GetChangedFilesWithStats(repoPath, baseRef string) ([]FileChange, error) {
	// First get the diff stats
	cmd, cancel := gitCmd(repoPath, "diff", "--numstat", baseRef)
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var changes []FileChange
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 3 {
			continue
		}

		additions := 0
		deletions := 0
		// Handle binary files (shown as "-")
		if parts[0] != "-" {
			fmt.Sscanf(parts[0], "%d", &additions)
		}
		if parts[1] != "-" {
			fmt.Sscanf(parts[1], "%d", &deletions)
		}

		// Reconstruct file path (may contain spaces)
		filePath := strings.Join(parts[2:], " ")

		status := "modified"
		if additions > 0 && deletions == 0 {
			// Check if it's a new file
			checkCmd, checkCancel := gitCmd(repoPath, "ls-tree", baseRef, "--", filePath)
			checkOut, _ := checkCmd.Output()
			checkCancel()
			if len(checkOut) == 0 {
				status = "added"
			}
		} else if deletions > 0 && additions == 0 {
			// Check if file still exists
			if _, err := os.Stat(filepath.Join(repoPath, filePath)); os.IsNotExist(err) {
				status = "deleted"
			}
		}

		changes = append(changes, FileChange{
			Path:      filePath,
			Additions: additions,
			Deletions: deletions,
			Status:    status,
		})
	}

	return changes, nil
}

// HasMergeConflicts checks if there are any merge conflicts in the repo
func (rm *RepoManager) HasMergeConflicts(repoPath string) (bool, error) {
	cmd, cancel := gitCmd(repoPath, "diff", "--check")
	defer cancel()
	out, err := cmd.CombinedOutput()
	// git diff --check returns exit code 2 if there are conflict markers
	if err != nil {
		// Check if output contains conflict markers
		return strings.Contains(string(out), "conflict"), nil
	}
	return false, nil
}
