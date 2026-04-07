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

	"github.com/chatml/chatml-core/logger"
)

// Clone retry configuration
const (
	cloneMaxRetries = 2
	cloneBaseDelay  = 2 * time.Second
	cloneMaxDelay   = 30 * time.Second
)

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
// Retries transient failures (timeouts, network errors) with exponential backoff.
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

	var lastErr error
	for attempt := 0; attempt <= cloneMaxRetries; attempt++ {
		if attempt > 0 {
			delay := cloneBaseDelay * time.Duration(1<<uint(attempt-1)) // 2s, 4s, 8s
			if delay > cloneMaxDelay {
				delay = cloneMaxDelay
			}
			logger.Main.Infof("Clone attempt %d/%d failed, retrying in %s: %v", attempt+1, cloneMaxRetries+1, delay, lastErr)

			select {
			case <-ctx.Done():
				return "", fmt.Errorf("git clone cancelled: %w", ctx.Err())
			case <-time.After(delay):
			}

		}

		path, err := rm.doClone(ctx, url, targetPath)
		if err == nil {
			return path, nil
		}
		lastErr = err

		// Don't retry non-transient errors
		if isNonRetryableCloneError(err) {
			return "", err
		}
	}

	return "", fmt.Errorf("clone failed after %d attempts: %w", cloneMaxRetries+1, lastErr)
}

// doClone executes a single clone attempt.
func (rm *RepoManager) doClone(ctx context.Context, url, targetPath string) (string, error) {
	cloneCtx, cancel := context.WithTimeout(ctx, TimeoutClone)
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
			return "", fmt.Errorf("git clone timed out after %s", TimeoutClone)
		}
		if ctx.Err() != nil {
			return "", fmt.Errorf("git clone cancelled: %w", ctx.Err())
		}

		stderrStr := stderr.String()
		return "", classifyCloneError(stderrStr)
	}

	return targetPath, nil
}

// isNonRetryableCloneError returns true for errors that should not be retried
// (authentication failures, repository not found, etc.)
func isNonRetryableCloneError(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "authentication failed") ||
		strings.Contains(msg, "ssh authentication failed") ||
		strings.Contains(msg, "repository not found") ||
		strings.Contains(msg, "invalid git url") ||
		strings.Contains(msg, "directory already exists") ||
		strings.Contains(msg, "parent directory does not exist") ||
		strings.Contains(msg, "invalid directory name") ||
		strings.Contains(msg, "cancelled")
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
