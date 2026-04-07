package builtin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-core/tool"
)

const (
	// bashGracePeriod is how long to wait after SIGTERM before sending SIGKILL.
	// Matches Claude Code's graceful shutdown pattern.
	bashGracePeriod = 5 * time.Second
)

const (
	bashDefaultTimeout = 120 * time.Second
	bashMaxTimeout     = 600 * time.Second
	bashMaxOutputBytes = 512 * 1024 // 512KB max output per command
)

// limitWriter caps the amount of data written to an internal buffer.
// Once the limit is reached, additional writes are silently discarded.
// This prevents unbounded memory growth from commands with large output.
type limitWriter struct {
	buf bytes.Buffer
	max int
}

func (w *limitWriter) Write(p []byte) (int, error) {
	remaining := w.max - w.buf.Len()
	if remaining <= 0 {
		return len(p), nil // Discard: pretend we wrote everything
	}
	if len(p) > remaining {
		w.buf.Write(p[:remaining])
		return len(p), nil // Report full write to satisfy io.Writer contract
	}
	return w.buf.Write(p)
}

// BashTool executes shell commands in the workspace directory.
type BashTool struct {
	workdir string

	// Background process tracking — these are killed on Cleanup().
	bgMu        sync.Mutex
	bgProcesses []*os.Process
}

// NewBashTool creates a Bash tool that executes commands in the given directory.
func NewBashTool(workdir string) *BashTool {
	return &BashTool{workdir: workdir}
}

// Cleanup sends SIGTERM to all tracked background processes.
// Call this when the session is being torn down.
func (t *BashTool) Cleanup() {
	t.bgMu.Lock()
	procs := t.bgProcesses
	t.bgProcesses = nil
	t.bgMu.Unlock()

	for _, p := range procs {
		if err := p.Signal(os.Interrupt); err != nil {
			// Process may have already exited — ignore.
			log.Printf("bash: cleanup: failed to signal PID %d: %v", p.Pid, err)
		}
	}
}

func (t *BashTool) Name() string { return "Bash" }

func (t *BashTool) Description() string {
	return `Executes a given bash command and returns its output. The working directory is the workspace root. Use for running tests, git commands, installing packages, and other system operations.`
}

func (t *BashTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"command": {
				"type": "string",
				"description": "The command to execute"
			},
			"description": {
				"type": "string",
				"description": "Clear, concise description of what this command does"
			},
			"timeout": {
				"type": "number",
				"description": "Optional timeout in milliseconds (max 600000)"
			},
			"run_in_background": {
				"type": "boolean",
				"description": "Run command in background. Returns immediately with a message. Use for long-running commands."
			}
		},
		"required": ["command"]
	}`)
}

func (t *BashTool) IsConcurrentSafe() bool { return false }

type bashInput struct {
	Command         string  `json:"command"`
	Description     string  `json:"description"`
	Timeout         float64 `json:"timeout"`
	RunInBackground bool    `json:"run_in_background"`
}

func (t *BashTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in bashInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	if strings.TrimSpace(in.Command) == "" {
		return tool.ErrorResult("Command cannot be empty"), nil
	}

	// Redirect commands that have dedicated tools — the model should use those instead.
	// Only check the primary command (first token), not piped or chained commands.
	if redirect := checkToolRedirect(in.Command); redirect != "" {
		return tool.ErrorResult(redirect), nil
	}

	// Background execution: start command and return immediately
	if in.RunInBackground {
		cmd := exec.Command("bash", "-c", in.Command)
		cmd.Dir = t.workdir
		cmd.Stdout = io.Discard // Prevent output leaking to server's stdout
		cmd.Stderr = io.Discard
		if err := cmd.Start(); err != nil {
			return tool.ErrorResult(fmt.Sprintf("Failed to start background command: %v", err)), nil
		}
		proc := cmd.Process

		// Track for cleanup on session teardown
		t.bgMu.Lock()
		t.bgProcesses = append(t.bgProcesses, proc)
		t.bgMu.Unlock()

		go func() {
			if err := cmd.Wait(); err != nil {
				log.Printf("bash: background command (PID %d) exited with error: %v", proc.Pid, err)
			}
			// Remove from tracking after exit
			t.bgMu.Lock()
			for i, p := range t.bgProcesses {
				if p.Pid == proc.Pid {
					t.bgProcesses = append(t.bgProcesses[:i], t.bgProcesses[i+1:]...)
					break
				}
			}
			t.bgMu.Unlock()
		}()
		return tool.TextResult(fmt.Sprintf("Command started in background (PID %d): %s", proc.Pid, in.Command)), nil
	}

	// Determine timeout
	timeout := bashDefaultTimeout
	if in.Timeout > 0 {
		timeout = time.Duration(in.Timeout) * time.Millisecond
		if timeout > bashMaxTimeout {
			timeout = bashMaxTimeout
		}
	}

	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, "bash", "-c", in.Command)
	cmd.Dir = t.workdir

	// TODO(security): OS-level sandboxing for bash commands. macOS sandbox-exec
	// (Seatbelt) is deprecated — need an alternative approach (e.g., App Sandbox
	// entitlements, or Linux-only landlock/seccomp).

	// Graceful shutdown: send SIGTERM first, then SIGKILL after grace period.
	// This matches Claude Code's behavior and gives processes a chance to clean up.
	cmd.Cancel = func() error {
		return cmd.Process.Signal(os.Interrupt) // SIGINT (more graceful than SIGTERM for shells)
	}
	cmd.WaitDelay = bashGracePeriod // After SIGINT, wait this long before SIGKILL

	// Use size-limited writers to prevent unbounded memory growth.
	// Without this, a command like `yes | head -c 1G` would allocate ~1GB
	// in a bytes.Buffer before post-hoc truncation.
	stdout := &limitWriter{max: bashMaxOutputBytes + 1024} // small overhead for truncation msg
	stderr := &limitWriter{max: bashMaxOutputBytes + 1024}
	cmd.Stdout = stdout
	cmd.Stderr = stderr

	err := cmd.Run()

	stdoutStr := stdout.buf.String()
	stderrStr := stderr.buf.String()

	// Truncate large outputs (limit writer caps the buffer, this trims to exact boundary)
	if len(stdoutStr) > bashMaxOutputBytes {
		stdoutStr = stdoutStr[:bashMaxOutputBytes] + "\n... (output truncated)"
	}
	if len(stderrStr) > bashMaxOutputBytes {
		stderrStr = stderrStr[:bashMaxOutputBytes] + "\n... (stderr truncated)"
	}

	// Build output
	var result strings.Builder
	if stdoutStr != "" {
		result.WriteString(stdoutStr)
	}
	if stderrStr != "" {
		if result.Len() > 0 {
			result.WriteString("\n")
		}
		result.WriteString("STDERR:\n")
		result.WriteString(stderrStr)
	}

	if err != nil {
		exitCode := -1
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
		if cmdCtx.Err() == context.DeadlineExceeded {
			return &tool.Result{
				Content: fmt.Sprintf("Command timed out after %s\n%s", timeout, result.String()),
				IsError: true,
			}, nil
		}
		return &tool.Result{
			Content: fmt.Sprintf("Exit code: %d\n%s", exitCode, result.String()),
			IsError: exitCode != 0,
		}, nil
	}

	return tool.TextResult(result.String()), nil
}

// Prompt implements tool.PromptProvider with comprehensive instructions ported
// from the reference Claude Code BashTool/prompt.ts.
func (t *BashTool) Prompt() string {
	return `Executes a given bash command and returns its output.

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).

IMPORTANT: Avoid using this tool to run ` + "`find`" + `, ` + "`grep`" + `, ` + "`cat`" + `, ` + "`head`" + `, ` + "`tail`" + `, ` + "`sed`" + `, ` + "`awk`" + `, or ` + "`echo`" + ` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user:

 - File search: Use Glob (NOT find or ls)
 - Content search: Use Grep (NOT grep or rg)
 - Read files: Use Read (NOT cat/head/tail)
 - Edit files: Use Edit (NOT sed/awk)
 - Write files: Use Write (NOT echo >/cat <<EOF)
While the Bash tool can do similar things, it's better to use the built-in tools as they provide a better user experience and make it easier to review tool calls and give permission.

# Instructions
 - If your command will create new directories or files, first use this tool to run ` + "`ls`" + ` to verify the parent directory exists and is the correct location.
 - Always quote file paths that contain spaces with double quotes in your command (e.g., cd "path with spaces/file.txt")
 - Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of ` + "`cd`" + `. You may use ` + "`cd`" + ` if the User explicitly requests it.
 - You may specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). By default, your command will timeout after 120000ms (2 minutes).
 - You can use the ` + "`run_in_background`" + ` parameter to run the command in the background. Only use this if you don't need the result immediately and are OK being notified when the command completes later. You do not need to check the output right away - you'll be notified when it finishes. You do not need to use '&' at the end of the command when using this parameter.
 - Write a clear, concise description of what your command does. For simple commands, keep it brief (5-10 words). For complex commands (piped commands, obscure flags, or anything hard to understand at a glance), include enough context so that the user can understand what your command will do.
 - When issuing multiple commands:
  - If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message. Example: if you need to run "git status" and "git diff", send a single message with two Bash tool calls in parallel.
  - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together.
  - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail.
  - DO NOT use newlines to separate commands (newlines are ok in quoted strings).
 - For git commands:
  - Prefer to create a new commit rather than amending an existing commit.
  - Before running destructive operations (e.g., git reset --hard, git push --force, git checkout --), consider whether there is a safer alternative that achieves the same goal. Only use destructive operations when they are truly the best approach.
  - Never skip hooks (--no-verify) or bypass signing (--no-gpg-sign, -c commit.gpgsign=false) unless the user has explicitly asked for it. If a hook fails, investigate and fix the underlying issue.
 - Avoid unnecessary ` + "`sleep`" + ` commands:
  - Do not sleep between commands that can run immediately — just run them.
  - If your command is long running and you would like to be notified when it finishes — use ` + "`run_in_background`" + `. No sleep needed.
  - Do not retry failing commands in a sleep loop — diagnose the root cause.
  - If waiting for a background task you started with ` + "`run_in_background`" + `, you will be notified when it completes — do not poll.
  - If you must poll an external process, use a check command (e.g. ` + "`gh run view`" + `) rather than sleeping first.
  - If you must sleep, keep the duration short (1-5 seconds) to avoid blocking the user.


# Committing changes with git

Only create commits when requested by the user. If unclear, ask first. When the user asks you to create a new git commit, follow these steps carefully:

You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. The numbered steps below indicate which commands should be batched in parallel.

Git Safety Protocol:
- NEVER update the git config
- NEVER run destructive git commands (push --force, reset --hard, checkout ., restore ., clean -f, branch -D) unless the user explicitly requests these actions. Taking unauthorized destructive actions is unhelpful and can result in lost work, so it's best to ONLY run these commands when given direct instructions
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- NEVER run force push to main/master, warn the user if they request it
- CRITICAL: Always create NEW commits rather than amending, unless the user explicitly requests a git amend. When a pre-commit hook fails, the commit did NOT happen — so --amend would modify the PREVIOUS commit, which may result in destroying work or losing previous changes. Instead, after hook failure, fix the issue, re-stage, and create a NEW commit
- When staging files, prefer adding specific files by name rather than using "git add -A" or "git add .", which can accidentally include sensitive files (.env, credentials) or large binaries
- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive

1. Run the following bash commands in parallel, each using the Bash tool:
  - Run a git status command to see all untracked files. IMPORTANT: Never use the -uall flag as it can cause memory issues on large repos.
  - Run a git diff command to see both staged and unstaged changes that will be committed.
  - Run a git log command to see recent commit messages, so that you can follow this repository's commit message style.
2. Analyze all staged changes (both previously staged and newly added) and draft a commit message:
  - Summarize the nature of the changes (eg. new feature, enhancement to an existing feature, bug fix, refactoring, test, docs, etc.). Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.).
  - Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files
  - Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"
  - Ensure it accurately reflects the changes and their purpose
3. Run the following commands in parallel:
   - Add relevant untracked files to the staging area.
   - Create the commit with a message ending with:
   Co-Authored-By: Claude <noreply@anthropic.com>
   - Run git status after the commit completes to verify success.
   Note: git status depends on the commit completing, so run it sequentially after the commit.
4. If the commit fails due to pre-commit hook: fix the issue and create a NEW commit

Important notes:
- NEVER run additional commands to read or explore code, besides git bash commands
- NEVER use the TodoWrite or Agent tools
- DO NOT push to the remote repository unless the user explicitly asks you to do so
- IMPORTANT: Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported.
- IMPORTANT: Do not use --no-edit with git rebase commands, as the --no-edit flag is not a valid option for git rebase.
- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit
- In order to ensure good formatting, ALWAYS pass the commit message via a HEREDOC, a la this example:
<example>
git commit -m "$(cat <<'EOF'
   Commit message here.

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
</example>

# Creating pull requests
Use the gh command via the Bash tool for ALL GitHub-related tasks including working with issues, pull requests, checks, and releases. If given a Github URL use the gh command to get the information needed.

IMPORTANT: When the user asks you to create a pull request, follow these steps carefully:

1. Run the following bash commands in parallel using the Bash tool, in order to understand the current state of the branch since it diverged from the main branch:
   - Run a git status command to see all untracked files (never use -uall flag)
   - Run a git diff command to see both staged and unstaged changes that will be committed
   - Check if the current branch tracks a remote branch and is up to date with the remote, so you know if you need to push to the remote
   - Run a git log command and ` + "`git diff [base-branch]...HEAD`" + ` to understand the full commit history for the current branch (from the time it diverged from the base branch)
2. Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request!!!), and draft a pull request title and summary:
   - Keep the PR title short (under 70 characters)
   - Use the description/body for details, not the title
3. Run the following commands in parallel:
   - Create new branch if needed
   - Push to remote with -u flag if needed
   - Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.
<example>
gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Test plan
[Bulleted markdown checklist of TODOs for testing the pull request...]
EOF
)"
</example>

Important:
- DO NOT use the TodoWrite or Agent tools
- Return the PR URL when you're done, so the user can see it

# Other common operations
- View comments on a Github PR: gh api repos/foo/bar/pulls/123/comments`
}

// toolRedirects maps commands to messages redirecting the model to use dedicated tools.
// Only the primary command is checked (before any pipes or chaining).
var toolRedirects = map[string]string{
	"cat":  "Use the Read tool instead of cat. The Read tool provides line numbers and handles binary/image/PDF files.",
	"head": "Use the Read tool with the limit parameter instead of head.",
	"tail": "Use the Read tool with the offset parameter instead of tail.",
	"sed":  "Use the Edit tool instead of sed. The Edit tool performs structured string replacements.",
	"awk":  "Use the Edit or Grep tool instead of awk.",
	"find": "Use the Glob tool instead of find. The Glob tool supports ** patterns and sorts by modification time.",
	"grep": "Use the Grep tool instead of grep. The Grep tool is built on ripgrep and provides structured output.",
	"rg":   "Use the Grep tool instead of rg. The Grep tool wraps ripgrep with a better interface.",
}

// checkToolRedirect returns a redirect error message if the command's primary
// program has a dedicated tool equivalent. Returns "" if no redirect needed.
func checkToolRedirect(command string) string {
	cmd := strings.TrimSpace(command)
	if cmd == "" {
		return ""
	}

	// Extract the first command (before any pipe, &&, ||, or ;).
	// NOTE: Not quote-aware — may split within quoted arguments. This is advisory
	// only (redirect suggestions), so false positives are acceptable.
	for _, sep := range []string{"|", "&&", "||", ";"} {
		if idx := strings.Index(cmd, sep); idx >= 0 {
			cmd = cmd[:idx]
		}
	}
	cmd = strings.TrimSpace(cmd)

	// Extract the first token (the command name)
	fields := strings.Fields(cmd)
	if len(fields) == 0 {
		return ""
	}

	// Strip path (e.g., /usr/bin/cat → cat)
	prog := fields[0]
	if idx := strings.LastIndex(prog, "/"); idx >= 0 {
		prog = prog[idx+1:]
	}

	return toolRedirects[prog]
}

var _ tool.Tool = (*BashTool)(nil)
var _ tool.PromptProvider = (*BashTool)(nil)
