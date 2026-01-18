package git

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

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
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = repoPath
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
	cmd := exec.Command("git", "show", fmt.Sprintf("%s:%s", ref, filePath))
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// GetChangedFiles returns a list of files that have changed compared to a base ref
func (rm *RepoManager) GetChangedFiles(repoPath, baseRef string) ([]string, error) {
	cmd := exec.Command("git", "diff", "--name-only", baseRef)
	cmd.Dir = repoPath
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

// HasMergeConflicts checks if there are any merge conflicts in the repo
func (rm *RepoManager) HasMergeConflicts(repoPath string) (bool, error) {
	cmd := exec.Command("git", "diff", "--check")
	cmd.Dir = repoPath
	out, err := cmd.CombinedOutput()
	// git diff --check returns exit code 2 if there are conflict markers
	if err != nil {
		// Check if output contains conflict markers
		return strings.Contains(string(out), "conflict"), nil
	}
	return false, nil
}
