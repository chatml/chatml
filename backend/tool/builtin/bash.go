package builtin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/chatml/chatml-backend/tool"
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

// BashTool executes shell commands in the workspace directory.
type BashTool struct {
	workdir string
}

// NewBashTool creates a Bash tool that executes commands in the given directory.
func NewBashTool(workdir string) *BashTool {
	return &BashTool{workdir: workdir}
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
			}
		},
		"required": ["command"]
	}`)
}

func (t *BashTool) IsConcurrentSafe() bool { return false }

type bashInput struct {
	Command     string  `json:"command"`
	Description string  `json:"description"`
	Timeout     float64 `json:"timeout"`
}

func (t *BashTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in bashInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	if strings.TrimSpace(in.Command) == "" {
		return tool.ErrorResult("Command cannot be empty"), nil
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

	// Graceful shutdown: send SIGTERM first, then SIGKILL after grace period.
	// This matches Claude Code's behavior and gives processes a chance to clean up.
	cmd.Cancel = func() error {
		return cmd.Process.Signal(os.Interrupt) // SIGINT (more graceful than SIGTERM for shells)
	}
	cmd.WaitDelay = bashGracePeriod // After SIGINT, wait this long before SIGKILL

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()

	stdoutStr := stdout.String()
	stderrStr := stderr.String()

	// Truncate large outputs
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

var _ tool.Tool = (*BashTool)(nil)
