package git

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Default timeout for git commands
const gitCommandTimeout = 30 * time.Second

// gitCmdWithContext creates a git command with the given context and an additional timeout.
// The timeout is layered on top of the parent context, so the command will be cancelled
// if either the parent context is cancelled or the timeout expires.
// Returns the command and a cancel function that MUST be called when done.
func gitCmdWithContext(ctx context.Context, repoPath string, args ...string) (*exec.Cmd, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(ctx, gitCommandTimeout)
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = repoPath
	return cmd, cancel
}

// gitCmd creates a git command with a timeout context using context.Background().
// Returns the command and a cancel function that MUST be called when done.
// Deprecated: Use gitCmdWithContext for better context propagation.
func gitCmd(repoPath string, args ...string) (*exec.Cmd, context.CancelFunc) {
	return gitCmdWithContext(context.Background(), repoPath, args...)
}

type RepoManager struct{}

func NewRepoManager() *RepoManager {
	return &RepoManager{}
}

// ValidateGitRef validates a git reference (branch, tag, commit SHA) to prevent command injection.
// Valid refs contain only alphanumeric characters, hyphens, underscores, forward slashes, dots, and tildes.
// Rejects refs starting with hyphen (could be interpreted as flags) or containing shell metacharacters.
// Exported for use by handlers that need early validation with better error messages.
var validGitRefPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.\-/~^@{}]*$`)

func ValidateGitRef(ref string) error {
	if ref == "" {
		return fmt.Errorf("empty git ref")
	}
	// Reject refs starting with hyphen (could be interpreted as git flags)
	if strings.HasPrefix(ref, "-") {
		return fmt.Errorf("invalid git ref: cannot start with hyphen")
	}
	// Reject shell metacharacters and other dangerous patterns
	if !validGitRefPattern.MatchString(ref) {
		return fmt.Errorf("invalid git ref: contains invalid characters")
	}
	// Note: ".." is allowed as it's valid git range syntax (e.g., "main..feature")
	// The regex already rejects shell metacharacters, so no additional check needed
	return nil
}

func (rm *RepoManager) ValidateRepo(path string) error {
	gitDir := filepath.Join(path, ".git")
	if _, err := os.Stat(gitDir); os.IsNotExist(err) {
		return fmt.Errorf("not a git repository: %s", path)
	}
	return nil
}

func (rm *RepoManager) GetCurrentBranch(ctx context.Context, repoPath string) (string, error) {
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "rev-parse", "--abbrev-ref", "HEAD")
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
func (rm *RepoManager) GetFileAtRef(ctx context.Context, repoPath, ref, filePath string) (string, error) {
	if err := ValidateGitRef(ref); err != nil {
		return "", fmt.Errorf("invalid ref: %w", err)
	}
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "show", fmt.Sprintf("%s:%s", ref, filePath))
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// GetChangedFiles returns a list of files that have changed compared to a base ref
func (rm *RepoManager) GetChangedFiles(ctx context.Context, repoPath, baseRef string) ([]string, error) {
	if err := ValidateGitRef(baseRef); err != nil {
		return nil, fmt.Errorf("invalid base ref: %w", err)
	}
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "diff", "--name-only", baseRef)
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
func (rm *RepoManager) GetChangedFilesWithStats(ctx context.Context, repoPath, baseRef string) ([]FileChange, error) {
	if err := ValidateGitRef(baseRef); err != nil {
		return nil, fmt.Errorf("invalid base ref: %w", err)
	}
	// First get the diff stats
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "diff", "--numstat", baseRef)
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
			checkCmd, checkCancel := gitCmdWithContext(ctx, repoPath, "ls-tree", baseRef, "--", filePath)
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

// GetUntrackedFiles returns files that are not tracked by git
func (rm *RepoManager) GetUntrackedFiles(ctx context.Context, repoPath string) ([]FileChange, error) {
	// Use -uall to show individual files inside untracked directories
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "status", "--porcelain", "-uall")
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var untracked []FileChange
	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		if len(line) < 3 {
			continue
		}
		// Untracked files start with "??"
		if line[0] == '?' && line[1] == '?' {
			filePath := strings.TrimSpace(line[3:])
			// Skip directories (they end with /)
			if strings.HasSuffix(filePath, "/") {
				continue
			}
			untracked = append(untracked, FileChange{
				Path:      filePath,
				Additions: 0,
				Deletions: 0,
				Status:    "untracked",
			})
		}
	}

	return untracked, nil
}

// FileCommit represents a commit that touched a specific file
type FileCommit struct {
	SHA       string    `json:"sha"`
	ShortSHA  string    `json:"shortSha"`
	Message   string    `json:"message"`
	Author    string    `json:"author"`
	Email     string    `json:"email"`
	Timestamp time.Time `json:"timestamp"`
	Additions int       `json:"additions"`
	Deletions int       `json:"deletions"`
}

// GetFileCommitHistory returns the commit history for a specific file
// Uses --follow to track file renames
func (rm *RepoManager) GetFileCommitHistory(ctx context.Context, repoPath, filePath string) ([]FileCommit, error) {
	// Build git log command with custom format
	// Format: SHA|ShortSHA|AuthorName|AuthorEmail|Timestamp|Subject
	args := []string{
		"log",
		"--follow",
		"--pretty=format:%H|%h|%an|%ae|%aI|%s",
		"--numstat",
		"--",
		filePath,
	}

	cmd, cancel := gitCmdWithContext(ctx, repoPath, args...)
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var commits []FileCommit
	lines := strings.Split(string(out), "\n")

	var current *FileCommit
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Check if this is a commit line (contains 5 pipes for our format)
		if strings.Count(line, "|") == 5 {
			// Save previous commit if exists
			if current != nil {
				commits = append(commits, *current)
			}

			parts := strings.SplitN(line, "|", 6)
			if len(parts) != 6 {
				continue
			}

			timestamp, _ := time.Parse(time.RFC3339, parts[4])
			current = &FileCommit{
				SHA:       parts[0],
				ShortSHA:  parts[1],
				Author:    parts[2],
				Email:     parts[3],
				Timestamp: timestamp,
				Message:   parts[5],
			}
		} else if current != nil {
			// Parse numstat line: additions deletions filename
			// With --follow, renames may produce multiple stat lines per commit.
			// We accumulate values to capture total changes for the file.
			statParts := strings.Fields(line)
			if len(statParts) >= 2 {
				// Handle binary files (shown as "-")
				if statParts[0] != "-" {
					if additions, err := strconv.Atoi(statParts[0]); err == nil {
						current.Additions += additions
					}
				}
				if statParts[1] != "-" {
					if deletions, err := strconv.Atoi(statParts[1]); err == nil {
						current.Deletions += deletions
					}
				}
			}
		}
	}

	// Don't forget the last commit
	if current != nil {
		commits = append(commits, *current)
	}

	return commits, nil
}

// HasMergeConflicts checks if there are any merge conflicts in the repo
func (rm *RepoManager) HasMergeConflicts(ctx context.Context, repoPath string) (bool, error) {
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "diff", "--check")
	defer cancel()
	out, err := cmd.CombinedOutput()
	// git diff --check returns exit code 2 if there are conflict markers
	if err != nil {
		// Check if output contains conflict markers
		return strings.Contains(string(out), "conflict"), nil
	}
	return false, nil
}

// GitStatus represents the comprehensive git status of a worktree
type GitStatus struct {
	WorkingDirectory WorkingDirectoryStatus `json:"workingDirectory"`
	Sync             SyncStatus             `json:"sync"`
	InProgress       InProgressStatus       `json:"inProgress"`
	Conflicts        ConflictStatus         `json:"conflicts"`
	Stash            StashStatus            `json:"stash"`
}

// WorkingDirectoryStatus represents the state of the working directory
type WorkingDirectoryStatus struct {
	StagedCount        int  `json:"stagedCount"`
	UnstagedCount      int  `json:"unstagedCount"`
	UntrackedCount     int  `json:"untrackedCount"`
	TotalUncommitted   int  `json:"totalUncommitted"`
	HasChanges         bool `json:"hasChanges"`
}

// SyncStatus represents the sync state with remote/base branch
type SyncStatus struct {
	AheadBy          int    `json:"aheadBy"`
	BehindBy         int    `json:"behindBy"`
	BaseBranch       string `json:"baseBranch"`
	RemoteBranch     string `json:"remoteBranch,omitempty"`
	HasRemote        bool   `json:"hasRemote"`
	Diverged         bool   `json:"diverged"`
	UnpushedCommits  int    `json:"unpushedCommits"`
}

// InProgressStatus represents any in-progress git operations
type InProgressStatus struct {
	Type    string `json:"type"` // "none", "rebase", "merge", "cherry-pick", "revert"
	Current int    `json:"current,omitempty"`
	Total   int    `json:"total,omitempty"`
}

// ConflictStatus represents merge conflict information
type ConflictStatus struct {
	HasConflicts bool     `json:"hasConflicts"`
	Count        int      `json:"count"`
	Files        []string `json:"files"`
}

// StashStatus represents stash information
type StashStatus struct {
	Count int `json:"count"`
}

// GetStatus returns comprehensive git status for a worktree
func (rm *RepoManager) GetStatus(ctx context.Context, worktreePath, baseBranch string) (*GitStatus, error) {
	status := &GitStatus{
		InProgress: InProgressStatus{Type: "none"},
		Conflicts:  ConflictStatus{Files: []string{}},
	}

	// Get working directory status
	wdStatus, err := rm.getWorkingDirectoryStatus(ctx, worktreePath)
	if err != nil {
		return nil, fmt.Errorf("failed to get working directory status: %w", err)
	}
	status.WorkingDirectory = *wdStatus

	// Get sync status
	syncStatus, err := rm.getSyncStatus(ctx, worktreePath, baseBranch)
	if err != nil {
		// Don't fail completely if sync status fails
		status.Sync = SyncStatus{BaseBranch: baseBranch}
	} else {
		status.Sync = *syncStatus
	}

	// Get in-progress operation status
	inProgress, err := rm.getInProgressStatus(ctx, worktreePath)
	if err == nil {
		status.InProgress = *inProgress
	}

	// Get conflict status
	conflicts, err := rm.getConflictStatus(ctx, worktreePath)
	if err == nil {
		status.Conflicts = *conflicts
	}

	// Get stash count
	stashCount, err := rm.getStashCount(ctx, worktreePath)
	if err == nil {
		status.Stash = StashStatus{Count: stashCount}
	}

	return status, nil
}

// getWorkingDirectoryStatus parses git status --porcelain output.
// Note: A file can have both staged and unstaged changes (partial staging),
// and will be counted in both StagedCount and UnstagedCount. TotalUncommitted
// is the sum of all counts, representing the total number of status entries,
// not unique files.
func (rm *RepoManager) getWorkingDirectoryStatus(ctx context.Context, repoPath string) (*WorkingDirectoryStatus, error) {
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "status", "--porcelain")
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	status := &WorkingDirectoryStatus{}
	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		if len(line) < 2 {
			continue
		}
		indexStatus := line[0]
		worktreeStatus := line[1]

		// Untracked files
		if indexStatus == '?' && worktreeStatus == '?' {
			status.UntrackedCount++
			continue
		}

		// Staged changes (index has changes)
		if indexStatus != ' ' && indexStatus != '?' {
			status.StagedCount++
		}

		// Unstaged changes (worktree has changes)
		if worktreeStatus != ' ' && worktreeStatus != '?' {
			status.UnstagedCount++
		}
	}

	status.TotalUncommitted = status.StagedCount + status.UnstagedCount + status.UntrackedCount
	status.HasChanges = status.TotalUncommitted > 0

	return status, nil
}

// getSyncStatus gets ahead/behind counts relative to base branch
func (rm *RepoManager) getSyncStatus(ctx context.Context, repoPath, baseBranch string) (*SyncStatus, error) {
	status := &SyncStatus{
		BaseBranch: baseBranch,
	}

	// Validate base branch ref
	if err := ValidateGitRef(baseBranch); err != nil {
		return status, fmt.Errorf("invalid base branch: %w", err)
	}

	// Check if remote tracking branch exists
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
	remoteOut, _ := cmd.Output()
	cancel()
	remoteBranch := strings.TrimSpace(string(remoteOut))
	if remoteBranch != "" {
		status.RemoteBranch = remoteBranch
		status.HasRemote = true
	}

	// Get ahead/behind compared to base branch (origin/main or similar)
	remoteBase := "origin/" + baseBranch
	cmd, cancel = gitCmdWithContext(ctx, repoPath, "rev-list", "--left-right", "--count", remoteBase+"...HEAD")
	countOut, err := cmd.Output()
	cancel()
	if err != nil {
		// Try without origin prefix
		cmd, cancel = gitCmdWithContext(ctx, repoPath, "rev-list", "--left-right", "--count", baseBranch+"...HEAD")
		countOut, err = cmd.Output()
		cancel()
		if err != nil {
			return status, nil // Return what we have
		}
	}

	parts := strings.Fields(string(countOut))
	if len(parts) >= 2 {
		fmt.Sscanf(parts[0], "%d", &status.BehindBy)
		fmt.Sscanf(parts[1], "%d", &status.AheadBy)
	}

	status.Diverged = status.AheadBy > 0 && status.BehindBy > 0

	// Get unpushed commits (if we have a remote tracking branch)
	if status.HasRemote {
		cmd, cancel = gitCmdWithContext(ctx, repoPath, "rev-list", "@{u}..HEAD", "--count")
		unpushedOut, err := cmd.Output()
		cancel()
		if err == nil {
			fmt.Sscanf(strings.TrimSpace(string(unpushedOut)), "%d", &status.UnpushedCommits)
		}
	} else {
		// If no remote tracking, all local commits are unpushed
		status.UnpushedCommits = status.AheadBy
	}

	return status, nil
}

// getInProgressStatus checks for in-progress git operations
func (rm *RepoManager) getInProgressStatus(ctx context.Context, repoPath string) (*InProgressStatus, error) {
	status := &InProgressStatus{Type: "none"}

	// Get the git directory for this worktree
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "rev-parse", "--git-dir")
	defer cancel()
	gitDirOut, err := cmd.Output()
	if err != nil {
		return status, err
	}
	gitDir := strings.TrimSpace(string(gitDirOut))
	if !filepath.IsAbs(gitDir) {
		gitDir = filepath.Join(repoPath, gitDir)
	}

	// Check for rebase
	rebaseMergeDir := filepath.Join(gitDir, "rebase-merge")
	rebaseApplyDir := filepath.Join(gitDir, "rebase-apply")
	if _, err := os.Stat(rebaseMergeDir); err == nil {
		status.Type = "rebase"
		// Get progress
		if msgnum, err := os.ReadFile(filepath.Join(rebaseMergeDir, "msgnum")); err == nil {
			fmt.Sscanf(strings.TrimSpace(string(msgnum)), "%d", &status.Current)
		}
		if end, err := os.ReadFile(filepath.Join(rebaseMergeDir, "end")); err == nil {
			fmt.Sscanf(strings.TrimSpace(string(end)), "%d", &status.Total)
		}
		return status, nil
	}
	if _, err := os.Stat(rebaseApplyDir); err == nil {
		status.Type = "rebase"
		// Get progress from rebase-apply
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

// getConflictStatus gets list of files with conflicts
func (rm *RepoManager) getConflictStatus(ctx context.Context, repoPath string) (*ConflictStatus, error) {
	status := &ConflictStatus{Files: []string{}}

	cmd, cancel := gitCmdWithContext(ctx, repoPath, "diff", "--name-only", "--diff-filter=U")
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return status, nil // No conflicts
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for _, line := range lines {
		if line != "" {
			status.Files = append(status.Files, line)
		}
	}

	status.Count = len(status.Files)
	status.HasConflicts = status.Count > 0

	return status, nil
}

// getStashCount returns the number of stashed changes
func (rm *RepoManager) getStashCount(ctx context.Context, repoPath string) (int, error) {
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "stash", "list")
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return 0, err
	}

	if len(strings.TrimSpace(string(out))) == 0 {
		return 0, nil
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	return len(lines), nil
}

// branchInfo is an internal struct for branch data during processing
type branchInfo struct {
	Name           string
	IsRemote       bool
	IsHead         bool
	LastCommitSHA  string
	LastCommitDate time.Time
	LastAuthor     string
	AheadMain      int
	BehindMain     int
	Prefix         string
}

// BranchListOptions controls branch listing behavior
type BranchListOptions struct {
	IncludeRemote bool
	Limit         int
	Offset        int
	Search        string
	SortBy        string // "name" or "date"
	SortDesc      bool
}

// BranchListResult contains paginated branch results
type BranchListResult struct {
	Branches []branchInfo `json:"branches"`
	Total    int          `json:"total"`
	HasMore  bool         `json:"hasMore"`
}

// ListBranches returns all branches in a repository with metadata
func (rm *RepoManager) ListBranches(ctx context.Context, repoPath string, opts BranchListOptions) (*BranchListResult, error) {
	// Set defaults
	if opts.Limit <= 0 {
		opts.Limit = 50
	}
	if opts.SortBy == "" {
		opts.SortBy = "date"
	}

	// Get all branches with metadata
	// Format: refname|objectname|committerdate|authorname|HEAD
	args := []string{"branch", "--format=%(refname:short)|%(objectname:short)|%(committerdate:iso-strict)|%(authorname)|%(HEAD)"}
	if opts.IncludeRemote {
		args = append(args, "-a")
	}

	cmd, cancel := gitCmdWithContext(ctx, repoPath, args...)
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to list branches: %w", err)
	}

	// Parse branch output
	var allBranches []branchInfo
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}

		parts := strings.Split(line, "|")
		if len(parts) < 5 {
			continue
		}

		name := parts[0]
		commitSHA := parts[1]
		dateStr := parts[2]
		author := parts[3]
		isHead := strings.TrimSpace(parts[4]) == "*"

		// Filter by search term if provided
		if opts.Search != "" && !strings.Contains(strings.ToLower(name), strings.ToLower(opts.Search)) {
			continue
		}

		// Determine if remote branch
		isRemote := strings.HasPrefix(name, "origin/") || strings.HasPrefix(name, "remotes/")

		// Skip HEAD pointer for remote branches
		if name == "origin/HEAD" || strings.HasSuffix(name, "/HEAD") {
			continue
		}

		// Parse commit date
		var commitDate time.Time
		if dateStr != "" {
			commitDate, _ = time.Parse(time.RFC3339, dateStr)
		}

		// Extract prefix (e.g., "feature" from "feature/my-branch")
		prefix := ""
		if idx := strings.Index(name, "/"); idx > 0 {
			prefix = name[:idx]
			// For remote branches like "origin/feature/foo", get the second part
			if prefix == "origin" || prefix == "remotes" {
				rest := name[idx+1:]
				if idx2 := strings.Index(rest, "/"); idx2 > 0 {
					prefix = rest[:idx2]
				} else {
					prefix = ""
				}
			}
		}

		allBranches = append(allBranches, branchInfo{
			Name:           name,
			IsRemote:       isRemote,
			IsHead:         isHead,
			LastCommitSHA:  commitSHA,
			LastCommitDate: commitDate,
			LastAuthor:     author,
			Prefix:         prefix,
		})
	}

	// Sort branches using O(n log n) sort
	sortBranches(allBranches, opts.SortBy, opts.SortDesc)

	// Apply pagination first
	total := len(allBranches)
	start := opts.Offset
	if start > total {
		start = total
	}
	end := start + opts.Limit
	if end > total {
		end = total
	}

	paginated := allBranches[start:end]

	// Get ahead/behind counts only for the paginated branches (performance optimization)
	for i := range paginated {
		ahead, behind := rm.getAheadBehind(ctx, repoPath, paginated[i].Name)
		paginated[i].AheadMain = ahead
		paginated[i].BehindMain = behind
	}

	return &BranchListResult{
		Branches: paginated,
		Total:    total,
		HasMore:  end < total,
	}, nil
}

// sortBranches sorts branches by the specified field using O(n log n) sort
func sortBranches(branches []branchInfo, sortBy string, desc bool) {
	sort.Slice(branches, func(i, j int) bool {
		if sortBy == "date" {
			if desc {
				return branches[i].LastCommitDate.After(branches[j].LastCommitDate)
			}
			return branches[i].LastCommitDate.Before(branches[j].LastCommitDate)
		}
		// sortBy == "name"
		if desc {
			return branches[i].Name > branches[j].Name
		}
		return branches[i].Name < branches[j].Name
	})
}

// getAheadBehind returns the number of commits ahead and behind origin/main for a branch
func (rm *RepoManager) getAheadBehind(ctx context.Context, repoPath, branchName string) (ahead, behind int) {
	// Try origin/main first, then main
	bases := []string{"origin/main", "main", "origin/master", "master"}
	for _, base := range bases {
		cmd, cancel := gitCmdWithContext(ctx, repoPath, "rev-list", "--left-right", "--count", base+"..."+branchName)
		out, err := cmd.Output()
		cancel()
		if err != nil {
			continue
		}

		parts := strings.Fields(string(out))
		if len(parts) >= 2 {
			fmt.Sscanf(parts[0], "%d", &behind)
			fmt.Sscanf(parts[1], "%d", &ahead)
			return ahead, behind
		}
	}
	return 0, 0
}

// GetGitHubRemote extracts the GitHub owner and repo name from the origin remote URL
func (rm *RepoManager) GetGitHubRemote(ctx context.Context, repoPath string) (owner, repo string, err error) {
	cmd, cancel := gitCmdWithContext(ctx, repoPath, "remote", "get-url", "origin")
	defer cancel()
	out, err := cmd.Output()
	if err != nil {
		return "", "", fmt.Errorf("failed to get origin remote: %w", err)
	}

	remoteURL := strings.TrimSpace(string(out))

	// Parse various GitHub URL formats:
	// - https://github.com/owner/repo.git
	// - git@github.com:owner/repo.git
	// - ssh://git@github.com/owner/repo.git

	// Remove .git suffix if present
	remoteURL = strings.TrimSuffix(remoteURL, ".git")

	// Handle SSH format: git@github.com:owner/repo
	if strings.HasPrefix(remoteURL, "git@github.com:") {
		parts := strings.TrimPrefix(remoteURL, "git@github.com:")
		ownerRepo := strings.Split(parts, "/")
		if len(ownerRepo) >= 2 {
			return ownerRepo[0], ownerRepo[1], nil
		}
	}

	// Handle HTTPS format: https://github.com/owner/repo
	if strings.Contains(remoteURL, "github.com/") {
		parts := strings.Split(remoteURL, "github.com/")
		if len(parts) >= 2 {
			ownerRepo := strings.Split(parts[1], "/")
			if len(ownerRepo) >= 2 {
				return ownerRepo[0], ownerRepo[1], nil
			}
		}
	}

	return "", "", fmt.Errorf("unable to parse GitHub remote URL: %s", remoteURL)
}
