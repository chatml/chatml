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
