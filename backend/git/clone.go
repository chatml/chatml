package git

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"time"
)

// cloneCommandTimeout is the timeout for git clone operations.
// Clone can take much longer than regular git commands for large repos.
const cloneCommandTimeout = 5 * time.Minute

// validGitURLPattern validates common git URL formats.
// Also allows file:// for local repos (used in testing and local clones).
var validGitURLPattern = regexp.MustCompile(
	`^(https?://[\w.\-]+/.+|git@[\w.\-]+:.+|ssh://[\w.\-@]+/.+|git://[\w.\-]+/.+|file://.+)$`,
)

// IsValidGitURL checks whether a URL is a valid git clone URL.
func IsValidGitURL(url string) bool {
	return validGitURLPattern.MatchString(url)
}

// CloneRepo clones a git repository from url into parentDir/dirName.
// Returns the full path of the cloned repository.
func (rm *RepoManager) CloneRepo(ctx context.Context, url, parentDir, dirName string) (string, error) {
	if !IsValidGitURL(url) {
		return "", fmt.Errorf("invalid git URL: %s", url)
	}

	// Validate parent directory exists
	info, err := os.Stat(parentDir)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("parent directory does not exist: %s", parentDir)
		}
		return "", fmt.Errorf("cannot access parent directory: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("parent path is not a directory: %s", parentDir)
	}

	// Sanitize dirName to prevent path traversal (e.g. "../../evil")
	cleanName := filepath.Base(dirName)
	if cleanName == "." || cleanName == ".." || cleanName == string(filepath.Separator) {
		return "", fmt.Errorf("invalid directory name: %s", dirName)
	}

	targetPath := filepath.Join(parentDir, cleanName)

	// Check target doesn't already exist
	if _, err := os.Stat(targetPath); err == nil {
		return "", fmt.Errorf("directory already exists: %s", targetPath)
	}

	// Run git clone with a dedicated timeout
	cloneCtx, cancel := context.WithTimeout(ctx, cloneCommandTimeout)
	defer cancel()

	cmd := exec.CommandContext(cloneCtx, "git", "clone", url, targetPath)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		// Clean up any partial clone on failure
		os.RemoveAll(targetPath)

		if cloneCtx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("git clone timed out after %s", cloneCommandTimeout)
		}
		if ctx.Err() != nil {
			return "", fmt.Errorf("git clone cancelled: %w", ctx.Err())
		}
		return "", fmt.Errorf("git clone failed: %s", stderr.String())
	}

	return targetPath, nil
}
