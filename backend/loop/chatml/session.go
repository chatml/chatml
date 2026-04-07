package chatml

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/chatml/chatml-core/git"
	"github.com/chatml/chatml-core/tool"
)

// --- get_session_status ---

type getSessionStatusTool struct {
	svc    *Services
	repo   RepoManager
	ctx    *ToolContext
	linear *LinearIssueState
}

func (t *getSessionStatusTool) Name() string           { return "mcp__chatml__get_session_status" }
func (t *getSessionStatusTool) IsConcurrentSafe() bool { return true }
func (t *getSessionStatusTool) DeferLoading() bool     { return true }
func (t *getSessionStatusTool) Description() string {
	return "Get current session status including branch, worktree, and active Linear issue."
}
func (t *getSessionStatusTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{"type": "object", "properties": {}}`)
}

func (t *getSessionStatusTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("Session: %s\nWorkspace: %s\nCwd: %s\n", t.ctx.SessionID, t.ctx.WorkspaceID, t.ctx.Workdir))

	// Git status
	baseRef := t.ctx.TargetBranch
	if baseRef == "" {
		baseRef = "origin/main"
	}
	status, err := t.repo.GetStatus(ctx, t.ctx.Workdir, baseRef)
	if err != nil {
		sb.WriteString(fmt.Sprintf("Git status: error — %v\n", err))
	} else {
		sb.WriteString(fmt.Sprintf("Branch: %s (base: %s)\n", status.CurrentBranch, status.Sync.BaseBranch))
		sb.WriteString(fmt.Sprintf("Uncommitted changes: %v (%d staged, %d unstaged, %d untracked)\n",
			status.WorkingDirectory.HasChanges,
			status.WorkingDirectory.StagedCount,
			status.WorkingDirectory.UnstagedCount,
			status.WorkingDirectory.UntrackedCount))
		sb.WriteString(fmt.Sprintf("Ahead: %d, Behind: %d\n", status.Sync.AheadBy, status.Sync.BehindBy))
	}

	// Linear issue
	if issue := t.linear.Get(); issue != nil {
		sb.WriteString(fmt.Sprintf("\nLinear issue: %s — %s [%s]\n", issue.Identifier, issue.Title, issue.State))
	}

	return &tool.Result{Content: sb.String()}, nil
}

// --- get_workspace_diff ---

type getWorkspaceDiffTool struct {
	svc  *Services
	repo RepoManager
	ctx  *ToolContext
}

func (t *getWorkspaceDiffTool) Name() string           { return "mcp__chatml__get_workspace_diff" }
func (t *getWorkspaceDiffTool) IsConcurrentSafe() bool { return true }
func (t *getWorkspaceDiffTool) DeferLoading() bool     { return true }
func (t *getWorkspaceDiffTool) Description() string {
	return "Get a summary of all changes in the workspace compared to the base branch, including uncommitted changes."
}
func (t *getWorkspaceDiffTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"detailed": {"type": "boolean", "description": "Include full diff output instead of summary"},
			"file": {"type": "string", "description": "Get diff for a specific file path"}
		}
	}`)
}

func (t *getWorkspaceDiffTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var params struct {
		Detailed bool   `json:"detailed"`
		File     string `json:"file"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return tool.ErrorResult(fmt.Sprintf("invalid input: %v", err)), nil
	}

	baseRef := t.ctx.TargetBranch
	if baseRef == "" {
		baseRef = "origin/main"
	}
	const maxBytes = 120000

	// Single file diff
	if params.File != "" {
		diff, err := t.repo.GetFileDiffUnified(ctx, t.ctx.Workdir, baseRef, params.File, maxBytes)
		if err != nil {
			return tool.ErrorResult(fmt.Sprintf("failed to get diff for %s: %v", params.File, err)), nil
		}
		if diff == "" {
			return &tool.Result{Content: fmt.Sprintf("No changes found for %s", params.File)}, nil
		}
		return &tool.Result{Content: diff}, nil
	}

	// Full workspace diff
	if params.Detailed {
		diff, err := t.repo.GetDiffSummary(ctx, t.ctx.Workdir, baseRef, maxBytes)
		if err != nil {
			return tool.ErrorResult(fmt.Sprintf("failed to get diff: %v", err)), nil
		}
		if diff == "" {
			return &tool.Result{Content: "No changes found."}, nil
		}
		return &tool.Result{Content: diff}, nil
	}

	// Summary mode: file changes + commits
	var sb strings.Builder

	changes, err := t.repo.GetChangedFilesWithStats(ctx, t.ctx.Workdir, baseRef)
	if err != nil {
		sb.WriteString(fmt.Sprintf("Error getting changed files: %v\n", err))
	} else {
		untracked, _ := t.repo.GetUntrackedFiles(ctx, t.ctx.Workdir)
		allChanges := make([]git.FileChange, 0, len(changes)+len(untracked))
		allChanges = append(allChanges, changes...)
		allChanges = append(allChanges, untracked...)
		allChanges = t.repo.FilterGitIgnored(ctx, t.ctx.Workdir, allChanges)

		if len(allChanges) == 0 {
			sb.WriteString("No changes found.\n")
		} else {
			sb.WriteString(fmt.Sprintf("Changed files (%d):\n", len(allChanges)))
			for _, c := range allChanges {
				sb.WriteString(fmt.Sprintf("  %s %s (+%d/-%d)\n", c.Status, c.Path, c.Additions, c.Deletions))
			}
		}
	}

	commits, err := t.repo.GetCommitsAheadOfBase(ctx, t.ctx.Workdir, baseRef)
	if err == nil && len(commits) > 0 {
		sb.WriteString(fmt.Sprintf("\nCommits (%d):\n", len(commits)))
		for _, c := range commits {
			sb.WriteString(fmt.Sprintf("  %s %s (%s)\n", c.ShortSHA, c.Message, c.Author))
		}
	}

	content := sb.String()
	if content == "" {
		content = "No changes found."
	}
	return &tool.Result{Content: content}, nil
}

// --- get_recent_activity ---

type getRecentActivityTool struct {
	repo RepoManager
	ctx  *ToolContext
}

func (t *getRecentActivityTool) Name() string           { return "mcp__chatml__get_recent_activity" }
func (t *getRecentActivityTool) IsConcurrentSafe() bool { return true }
func (t *getRecentActivityTool) DeferLoading() bool     { return true }
func (t *getRecentActivityTool) Description() string {
	return "Get recent commits and file changes in the workspace."
}
func (t *getRecentActivityTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{"type": "object", "properties": {}}`)
}

func (t *getRecentActivityTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	baseRef := t.ctx.TargetBranch
	if baseRef == "" {
		baseRef = "origin/main"
	}

	commits, err := t.repo.GetCommitsAheadOfBase(ctx, t.ctx.Workdir, baseRef)
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("failed to get commits: %v", err)), nil
	}

	if len(commits) == 0 {
		return &tool.Result{Content: "No commits ahead of base branch."}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Commits ahead of %s (%d):\n\n", baseRef, len(commits)))
	for _, c := range commits {
		sb.WriteString(fmt.Sprintf("### %s — %s\n", c.ShortSHA, c.Message))
		sb.WriteString(fmt.Sprintf("Author: %s | %s\n", c.Author, c.Timestamp.Format("2006-01-02 15:04")))
		if len(c.Files) > 0 {
			for _, f := range c.Files {
				sb.WriteString(fmt.Sprintf("  %s %s (+%d/-%d)\n", f.Status, f.Path, f.Additions, f.Deletions))
			}
		}
		sb.WriteString("\n")
	}

	return &tool.Result{Content: sb.String()}, nil
}
