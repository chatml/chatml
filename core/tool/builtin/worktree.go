package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/chatml/chatml-core/tool"
)

// WorkdirSetter allows tools to change the runner's working directory.
type WorkdirSetter interface {
	SetWorkdir(dir string)
	GetWorkdir() string
}

// --- EnterWorktree ---

// EnterWorktreeTool creates an isolated git worktree for safe file modifications.
type EnterWorktreeTool struct {
	setter WorkdirSetter
}

// NewEnterWorktreeTool creates a new EnterWorktree tool.
func NewEnterWorktreeTool(setter WorkdirSetter) *EnterWorktreeTool {
	return &EnterWorktreeTool{setter: setter}
}

func (t *EnterWorktreeTool) Name() string { return "EnterWorktree" }
func (t *EnterWorktreeTool) Description() string {
	return "Creates an isolated git worktree for safe file modifications. Changes are made on a separate branch without affecting the main working directory."
}

func (t *EnterWorktreeTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"name": {
				"type": "string",
				"description": "Optional name for the worktree (alphanumeric, dots, dashes, underscores, max 64 chars)"
			}
		}
	}`)
}

func (t *EnterWorktreeTool) IsConcurrentSafe() bool { return false }

func (t *EnterWorktreeTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult("Invalid input: " + err.Error()), nil
	}

	workdir := t.setter.GetWorkdir()

	// Validate git repo
	cmd := exec.CommandContext(ctx, "git", "rev-parse", "--git-dir")
	cmd.Dir = workdir
	if err := cmd.Run(); err != nil {
		return tool.ErrorResult("Not a git repository"), nil
	}

	// Generate or validate name
	name := in.Name
	if name == "" {
		name = fmt.Sprintf("worktree-%d", time.Now().Unix())
	}
	if !isValidWorktreeName(name) {
		return tool.ErrorResult("Invalid worktree name. Use alphanumeric, dots, dashes, underscores (max 64 chars)"), nil
	}

	// Get current branch
	branchCmd := exec.CommandContext(ctx, "git", "rev-parse", "--abbrev-ref", "HEAD")
	branchCmd.Dir = workdir
	branchOut, _ := branchCmd.Output()
	originalBranch := strings.TrimSpace(string(branchOut))

	// Create worktree directory
	// NOTE: The .claude/worktrees/ directory should be listed in .gitignore
	// to prevent worktree artifacts from being committed to the repository.
	worktreeDir := filepath.Join(workdir, ".claude", "worktrees", name)
	os.MkdirAll(filepath.Dir(worktreeDir), 0755) //nolint:errcheck

	// Create git worktree
	wtCmd := exec.CommandContext(ctx, "git", "worktree", "add", worktreeDir, "-b", "chatml/"+name)
	wtCmd.Dir = workdir
	if out, err := wtCmd.CombinedOutput(); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Failed to create worktree: %s", string(out))), nil
	}

	// Switch workdir
	t.setter.SetWorkdir(worktreeDir)

	return tool.TextResult(fmt.Sprintf("Entered worktree: %s\nBranch: chatml/%s\nOriginal branch: %s\nOriginal directory: %s", worktreeDir, name, originalBranch, workdir)), nil
}

func isValidWorktreeName(name string) bool {
	if len(name) > 64 || len(name) == 0 {
		return false
	}
	if strings.Contains(name, "..") {
		return false
	}
	matched, _ := regexp.MatchString(`^[a-zA-Z0-9._-]+$`, name)
	return matched
}

// --- ExitWorktree ---

// ExitWorktreeTool exits the current git worktree and returns to the original working directory.
type ExitWorktreeTool struct {
	setter WorkdirSetter
}

// NewExitWorktreeTool creates a new ExitWorktree tool.
func NewExitWorktreeTool(setter WorkdirSetter) *ExitWorktreeTool {
	return &ExitWorktreeTool{setter: setter}
}

func (t *ExitWorktreeTool) Name() string { return "ExitWorktree" }
func (t *ExitWorktreeTool) Description() string {
	return "Exits the current git worktree and returns to the original working directory. Can keep the worktree on disk or remove it."
}

func (t *ExitWorktreeTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"action": {
				"type": "string",
				"enum": ["keep", "remove"],
				"description": "Whether to keep or remove the worktree"
			}
		},
		"required": ["action"]
	}`)
}

func (t *ExitWorktreeTool) IsConcurrentSafe() bool { return false }

func (t *ExitWorktreeTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in struct {
		Action string `json:"action"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult("Invalid input: " + err.Error()), nil
	}

	currentDir := t.setter.GetWorkdir()

	// Find original dir — list worktrees and find the main one
	topCmd := exec.CommandContext(ctx, "git", "worktree", "list", "--porcelain")
	topCmd.Dir = currentDir
	topOut, err := topCmd.Output()
	if err != nil {
		return tool.ErrorResult("Failed to list worktrees"), nil
	}

	// Parse worktree list to find the main worktree
	var mainWorktree string
	for _, line := range strings.Split(string(topOut), "\n") {
		if strings.HasPrefix(line, "worktree ") {
			path := strings.TrimPrefix(line, "worktree ")
			if !strings.Contains(path, ".claude/worktrees/") {
				mainWorktree = path
				break
			}
		}
	}
	if mainWorktree == "" {
		return tool.ErrorResult("Could not find main worktree"), nil
	}

	if in.Action == "remove" {
		// Check for uncommitted changes
		statusCmd := exec.CommandContext(ctx, "git", "status", "--porcelain")
		statusCmd.Dir = currentDir
		statusOut, _ := statusCmd.Output()
		if len(strings.TrimSpace(string(statusOut))) > 0 {
			return tool.ErrorResult("Worktree has uncommitted changes. Commit or discard before removing."), nil
		}

		// Switch back first
		t.setter.SetWorkdir(mainWorktree)

		// Remove worktree
		rmCmd := exec.CommandContext(ctx, "git", "worktree", "remove", currentDir, "--force")
		rmCmd.Dir = mainWorktree
		if out, err := rmCmd.CombinedOutput(); err != nil {
			return tool.ErrorResult(fmt.Sprintf("Failed to remove worktree: %s", string(out))), nil
		}

		return tool.TextResult(fmt.Sprintf("Worktree removed. Returned to: %s", mainWorktree)), nil
	}

	// Keep action — just switch back
	t.setter.SetWorkdir(mainWorktree)
	return tool.TextResult(fmt.Sprintf("Exited worktree (kept on disk at %s). Returned to: %s", currentDir, mainWorktree)), nil
}
