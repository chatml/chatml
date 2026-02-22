package git

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
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
	// Prevent git from hanging on interactive credential/passphrase prompts.
	// Without these, git clone can block indefinitely in a headless sidecar process.
	cmd.Env = append(os.Environ(),
		"GIT_TERMINAL_PROMPT=0",
		"GIT_SSH_COMMAND=ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
	)
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

		stderrStr := stderr.String()
		return "", classifyCloneError(stderrStr)
	}

	return targetPath, nil
}

// classifyCloneError maps common git stderr messages to user-friendly error messages.
func classifyCloneError(stderr string) error {
	lower := strings.ToLower(stderr)
	switch {
	case strings.Contains(lower, "authentication failed") ||
		strings.Contains(lower, "could not read username") ||
		strings.Contains(lower, "terminal prompts disabled"):
		return fmt.Errorf("authentication failed: the repository may be private or require credentials")
	case strings.Contains(lower, "permission denied") ||
		strings.Contains(lower, "host key verification failed"):
		return fmt.Errorf("SSH authentication failed: check your SSH key configuration")
	case strings.Contains(lower, "repository not found") ||
		strings.Contains(lower, "not found"):
		return fmt.Errorf("repository not found: check that the URL is correct and you have access")
	default:
		return fmt.Errorf("git clone failed: %s", stderr)
	}
}
