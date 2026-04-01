package builtin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"

	"github.com/chatml/chatml-backend/tool"
)

const grepDefaultHeadLimit = 250

// GrepTool searches file contents using ripgrep.
type GrepTool struct {
	workdir string
}

// NewGrepTool creates a Grep tool for the given workspace.
func NewGrepTool(workdir string) *GrepTool {
	return &GrepTool{workdir: workdir}
}

func (t *GrepTool) Name() string { return "Grep" }

func (t *GrepTool) Description() string {
	return `Searches file contents using ripgrep. Supports regex patterns, file type filtering, and multiple output modes. Default output mode is "files_with_matches" which shows only matching file paths.`
}

func (t *GrepTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"pattern": {
				"type": "string",
				"description": "The regular expression pattern to search for"
			},
			"path": {
				"type": "string",
				"description": "File or directory to search in. Defaults to workspace root."
			},
			"glob": {
				"type": "string",
				"description": "Glob pattern to filter files (e.g. \"*.js\", \"*.{ts,tsx}\")"
			},
			"type": {
				"type": "string",
				"description": "File type to search (e.g. \"js\", \"py\", \"go\")"
			},
			"output_mode": {
				"type": "string",
				"enum": ["content", "files_with_matches", "count"],
				"description": "Output mode. Defaults to files_with_matches."
			},
			"-i": {
				"type": "boolean",
				"description": "Case insensitive search"
			},
			"-n": {
				"type": "boolean",
				"description": "Show line numbers (content mode only, default true)"
			},
			"-A": {
				"type": "number",
				"description": "Lines to show after each match (content mode only)"
			},
			"-B": {
				"type": "number",
				"description": "Lines to show before each match (content mode only)"
			},
			"-C": {
				"type": "number",
				"description": "Lines to show before and after each match (content mode only)"
			},
			"context": {
				"type": "number",
				"description": "Alias for -C"
			},
			"head_limit": {
				"type": "number",
				"description": "Limit output to first N lines/entries. Default 250, pass 0 for unlimited."
			},
			"offset": {
				"type": "number",
				"description": "Skip first N lines/entries before applying limit"
			},
			"multiline": {
				"type": "boolean",
				"description": "Enable multiline mode where . matches newlines"
			}
		},
		"required": ["pattern"]
	}`)
}

func (t *GrepTool) IsConcurrentSafe() bool { return true }

type grepInput struct {
	Pattern    string  `json:"pattern"`
	Path       string  `json:"path"`
	Glob       string  `json:"glob"`
	Type       string  `json:"type"`
	OutputMode string  `json:"output_mode"`
	CaseI      bool    `json:"-i"`
	LineNums   *bool   `json:"-n"`
	After      float64 `json:"-A"`
	Before     float64 `json:"-B"`
	Context    float64 `json:"-C"`
	ContextAlt float64 `json:"context"`
	HeadLimit  *int    `json:"head_limit"`
	Offset     int     `json:"offset"`
	Multiline  bool    `json:"multiline"`
}

func (t *GrepTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in grepInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	if in.Pattern == "" {
		return tool.ErrorResult("pattern is required"), nil
	}

	// Build ripgrep arguments
	args := []string{"--hidden"}

	// Output mode
	outputMode := in.OutputMode
	if outputMode == "" {
		outputMode = "files_with_matches"
	}

	switch outputMode {
	case "files_with_matches":
		args = append(args, "-l")
	case "count":
		args = append(args, "-c")
	case "content":
		// Default rg behavior
		lineNums := true
		if in.LineNums != nil {
			lineNums = *in.LineNums
		}
		if lineNums {
			args = append(args, "-n")
		}

		// Context flags
		ctxVal := in.Context
		if in.ContextAlt > 0 {
			ctxVal = in.ContextAlt
		}
		if ctxVal > 0 {
			args = append(args, "-C", strconv.Itoa(int(ctxVal)))
		} else {
			if in.Before > 0 {
				args = append(args, "-B", strconv.Itoa(int(in.Before)))
			}
			if in.After > 0 {
				args = append(args, "-A", strconv.Itoa(int(in.After)))
			}
		}
	default:
		return tool.ErrorResult(fmt.Sprintf("Invalid output_mode: %s", outputMode)), nil
	}

	if in.CaseI {
		args = append(args, "-i")
	}

	if in.Multiline {
		args = append(args, "-U", "--multiline-dotall")
	}

	if in.Type != "" {
		args = append(args, "--type", in.Type)
	}

	if in.Glob != "" {
		args = append(args, "--glob", in.Glob)
	}

	// Max line length to avoid binary/minified content
	args = append(args, "--max-columns", "500")

	// Pattern (use -e to handle patterns starting with -)
	args = append(args, "-e", in.Pattern)

	// Search path
	searchPath := t.workdir
	if in.Path != "" {
		if strings.HasPrefix(in.Path, "/") {
			searchPath = in.Path
		} else {
			searchPath = fmt.Sprintf("%s/%s", t.workdir, in.Path)
		}
	}
	args = append(args, searchPath)

	// Execute ripgrep
	cmd := exec.CommandContext(ctx, "rg", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()

	output := stdout.String()

	// ripgrep returns exit code 1 when no matches found (not an error)
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			if exitErr.ExitCode() == 1 {
				return tool.TextResult("No matches found."), nil
			}
			if exitErr.ExitCode() == 2 {
				return tool.ErrorResult(fmt.Sprintf("Grep error: %s", stderr.String())), nil
			}
		}
		return tool.ErrorResult(fmt.Sprintf("Grep failed: %v\n%s", err, stderr.String())), nil
	}

	// Apply head_limit and offset
	headLimit := grepDefaultHeadLimit
	if in.HeadLimit != nil {
		headLimit = *in.HeadLimit
	}

	lines := strings.Split(strings.TrimRight(output, "\n"), "\n")

	// Apply offset
	if in.Offset > 0 && in.Offset < len(lines) {
		lines = lines[in.Offset:]
	} else if in.Offset >= len(lines) {
		lines = nil
	}

	// Apply limit
	truncated := false
	if headLimit > 0 && len(lines) > headLimit {
		lines = lines[:headLimit]
		truncated = true
	}

	// Relativize paths
	for i, line := range lines {
		if strings.HasPrefix(line, t.workdir) {
			lines[i] = strings.TrimPrefix(line, t.workdir+"/")
		}
	}

	result := strings.Join(lines, "\n")
	if truncated {
		result += fmt.Sprintf("\n... (limited to %d entries)", headLimit)
	}

	return &tool.Result{
		Content: result,
		Metadata: map[string]interface{}{
			"mode":     outputMode,
			"numLines": len(lines),
		},
	}, nil
}

var _ tool.Tool = (*GrepTool)(nil)
