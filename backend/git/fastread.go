package git

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ResolveGitDir resolves the .git directory for a repo or worktree path.
// For regular repos, this returns repoPath/.git (a directory).
// For worktrees, .git is a file containing "gitdir: <path>" — this returns the resolved path.
func ResolveGitDir(repoPath string) (string, error) {
	gitPath := filepath.Join(repoPath, ".git")

	info, err := os.Stat(gitPath)
	if err != nil {
		return "", err
	}

	// Regular repo: .git is a directory
	if info.IsDir() {
		return gitPath, nil
	}

	// Worktree: .git is a file containing "gitdir: <path>"
	data, err := os.ReadFile(gitPath)
	if err != nil {
		return "", err
	}

	content := strings.TrimSpace(string(data))
	if !strings.HasPrefix(content, "gitdir: ") {
		return "", fmt.Errorf("unexpected .git file format: %s", content)
	}

	gitDir := strings.TrimPrefix(content, "gitdir: ")
	if !filepath.IsAbs(gitDir) {
		gitDir = filepath.Join(repoPath, gitDir)
	}

	return filepath.Clean(gitDir), nil
}

// resolveCommonDir returns the "common" git directory that contains shared data
// (config, packed-refs, refs/stash, etc). For regular repos this is the same as gitDir.
// For worktrees, it reads the commondir file to find the main repo's .git directory.
func resolveCommonDir(gitDir string) string {
	commonDirFile := filepath.Join(gitDir, "commondir")
	data, err := os.ReadFile(commonDirFile)
	if err != nil {
		// Not a worktree (or no commondir file) — gitDir is the common dir
		return gitDir
	}

	rel := strings.TrimSpace(string(data))
	if filepath.IsAbs(rel) {
		return filepath.Clean(rel)
	}
	return filepath.Clean(filepath.Join(gitDir, rel))
}

// lookupPackedRef looks up a ref in the packed-refs file.
// Returns the SHA if found, or an error if not found or on read failure.
func lookupPackedRef(commonDir, refName string) (string, error) {
	packedRefsPath := filepath.Join(commonDir, "packed-refs")
	f, err := os.Open(packedRefsPath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		// Skip comments and peeled refs (^sha lines)
		if len(line) == 0 || line[0] == '#' || line[0] == '^' {
			continue
		}
		// Format: "<sha> <refname>" — assumes SHA-1 (40 hex chars); SHA-256 repos are unsupported.
		if len(line) > 41 && line[40] == ' ' {
			if line[41:] == refName {
				return line[:40], nil
			}
		}
	}

	return "", fmt.Errorf("ref %s not found in packed-refs", refName)
}

// readCurrentBranch reads the current branch name directly from .git/HEAD.
// Returns the branch name (e.g., "main") or "HEAD" for detached HEAD state.
func readCurrentBranch(repoPath string) (string, error) {
	gitDir, err := ResolveGitDir(repoPath)
	if err != nil {
		return "", err
	}
	return readBranchFromGitDir(gitDir)
}

// readBranchFromGitDir reads the branch from a pre-resolved gitDir.
func readBranchFromGitDir(gitDir string) (string, error) {
	data, err := os.ReadFile(filepath.Join(gitDir, "HEAD"))
	if err != nil {
		return "", err
	}

	content := strings.TrimSpace(string(data))
	if strings.HasPrefix(content, "ref: refs/heads/") {
		return strings.TrimPrefix(content, "ref: refs/heads/"), nil
	}

	// Detached HEAD — return "HEAD" to match git rev-parse --abbrev-ref behavior
	return "HEAD", nil
}

// readHeadSHA reads the HEAD commit SHA directly from .git files.
// Resolves symbolic refs through loose ref files and packed-refs.
func readHeadSHA(repoPath string) (string, error) {
	gitDir, err := ResolveGitDir(repoPath)
	if err != nil {
		return "", err
	}
	return readHeadSHAFromGitDir(gitDir, nil)
}

// readHeadSHAFromGitDir reads the HEAD SHA from a pre-resolved gitDir.
// If cache is non-nil, uses it for packed-refs lookup.
func readHeadSHAFromGitDir(gitDir string, cache *GitCache) (string, error) {
	data, err := os.ReadFile(filepath.Join(gitDir, "HEAD"))
	if err != nil {
		return "", err
	}

	content := strings.TrimSpace(string(data))

	// Detached HEAD — content is the SHA directly
	if !strings.HasPrefix(content, "ref: ") {
		if len(content) >= 40 {
			return content[:40], nil
		}
		return "", fmt.Errorf("unexpected HEAD content: %s", content)
	}

	// Symbolic ref — resolve it
	refName := strings.TrimPrefix(content, "ref: ")
	return resolveRefCached(gitDir, refName, cache)
}

// resolveRef resolves a ref name (e.g., "refs/heads/main") to its SHA.
// Checks loose ref file first, then falls back to packed-refs.
func resolveRef(gitDir, refName string) (string, error) {
	return resolveRefCached(gitDir, refName, nil)
}

// resolveRefCached resolves a ref, using the cache for commonDir and packed-refs
// lookups when non-nil.
func resolveRefCached(gitDir, refName string, cache *GitCache) (string, error) {
	var commonDir string
	if cache != nil {
		commonDir = cache.GetCommonDir(gitDir)
	} else {
		commonDir = resolveCommonDir(gitDir)
	}

	// Try loose ref file first (check both gitDir and commonDir for worktrees)
	for _, dir := range []string{gitDir, commonDir} {
		loosePath := filepath.Join(dir, refName)
		data, err := os.ReadFile(loosePath)
		if err == nil {
			sha := strings.TrimSpace(string(data))
			if len(sha) >= 40 {
				return sha[:40], nil
			}
		}
	}

	// Fall back to packed-refs (cached when available)
	if cache != nil {
		return cache.LookupPackedRef(commonDir, refName)
	}
	return lookupPackedRef(commonDir, refName)
}

// readRemoteURL reads the URL for a named remote directly from .git/config.
// Uses a minimal parser that only looks for [remote "<name>"] sections.
func readRemoteURL(repoPath, remoteName string) (string, error) {
	gitDir, err := ResolveGitDir(repoPath)
	if err != nil {
		return "", err
	}

	commonDir := resolveCommonDir(gitDir)
	configPath := filepath.Join(commonDir, "config")

	f, err := os.Open(configPath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	targetSection := fmt.Sprintf(`[remote "%s"]`, remoteName)
	inSection := false

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		// New section header
		if strings.HasPrefix(line, "[") {
			inSection = (line == targetSection)
			continue
		}

		if inSection && strings.HasPrefix(line, "url = ") {
			return strings.TrimPrefix(line, "url = "), nil
		}
	}

	return "", fmt.Errorf("remote %q not found in config", remoteName)
}

// readInProgressStatus checks for in-progress git operations by reading git internal files.
// This replaces the subprocess call to git rev-parse --git-dir followed by file stats.
func readInProgressStatus(repoPath string) (*InProgressStatus, error) {
	gitDir, err := ResolveGitDir(repoPath)
	if err != nil {
		return nil, err
	}
	return readInProgressFromGitDir(gitDir)
}

// readInProgressFromGitDir checks for in-progress git operations using a pre-resolved gitDir.
func readInProgressFromGitDir(gitDir string) (*InProgressStatus, error) {
	status := &InProgressStatus{Type: "none"}

	// Check for rebase (interactive or otherwise)
	rebaseMergeDir := filepath.Join(gitDir, "rebase-merge")
	if _, err := os.Stat(rebaseMergeDir); err == nil {
		status.Type = "rebase"
		if msgnum, err := os.ReadFile(filepath.Join(rebaseMergeDir, "msgnum")); err == nil {
			fmt.Sscanf(strings.TrimSpace(string(msgnum)), "%d", &status.Current)
		}
		if end, err := os.ReadFile(filepath.Join(rebaseMergeDir, "end")); err == nil {
			fmt.Sscanf(strings.TrimSpace(string(end)), "%d", &status.Total)
		}
		return status, nil
	}

	rebaseApplyDir := filepath.Join(gitDir, "rebase-apply")
	if _, err := os.Stat(rebaseApplyDir); err == nil {
		status.Type = "rebase"
		if next, err := os.ReadFile(filepath.Join(rebaseApplyDir, "next")); err == nil {
			fmt.Sscanf(strings.TrimSpace(string(next)), "%d", &status.Current)
		}
		if last, err := os.ReadFile(filepath.Join(rebaseApplyDir, "last")); err == nil {
			fmt.Sscanf(strings.TrimSpace(string(last)), "%d", &status.Total)
		}
		return status, nil
	}

	// Check for merge
	if _, err := os.Stat(filepath.Join(gitDir, "MERGE_HEAD")); err == nil {
		status.Type = "merge"
		return status, nil
	}

	// Check for cherry-pick
	if _, err := os.Stat(filepath.Join(gitDir, "CHERRY_PICK_HEAD")); err == nil {
		status.Type = "cherry-pick"
		return status, nil
	}

	// Check for revert
	if _, err := os.Stat(filepath.Join(gitDir, "REVERT_HEAD")); err == nil {
		status.Type = "revert"
		return status, nil
	}

	return status, nil
}

// readUpstreamRef reads the upstream tracking ref for a branch from .git/config.
// Returns the full remote ref (e.g., "origin/main") or an error if not configured.
func readUpstreamRef(repoPath, branchName string) (string, error) {
	gitDir, err := ResolveGitDir(repoPath)
	if err != nil {
		return "", err
	}
	return readUpstreamFromConfig(gitDir, branchName)
}

// readUpstreamFromConfig reads the upstream ref using a pre-resolved gitDir.
func readUpstreamFromConfig(gitDir, branchName string) (string, error) {
	commonDir := resolveCommonDir(gitDir)
	configPath := filepath.Join(commonDir, "config")

	f, err := os.Open(configPath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	targetSection := fmt.Sprintf(`[branch "%s"]`, branchName)
	inSection := false
	var remote, merge string

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		if strings.HasPrefix(line, "[") {
			if inSection {
				break // Passed our section
			}
			inSection = (line == targetSection)
			continue
		}

		if !inSection {
			continue
		}

		if strings.HasPrefix(line, "remote = ") {
			remote = strings.TrimPrefix(line, "remote = ")
		} else if strings.HasPrefix(line, "merge = ") {
			merge = strings.TrimPrefix(line, "merge = ")
		}
	}

	if remote == "" || merge == "" {
		return "", fmt.Errorf("no upstream configured for branch %q", branchName)
	}

	// merge is typically "refs/heads/main" — convert to "origin/main"
	branchRef := strings.TrimPrefix(merge, "refs/heads/")
	return remote + "/" + branchRef, nil
}
