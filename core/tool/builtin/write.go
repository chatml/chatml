package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chatml/chatml-core/tool"
)

// WriteTool writes content to a file, creating parent directories as needed.
type WriteTool struct {
	workdir     string
	readTracker *tool.ReadTracker
}

// NewWriteTool creates a Write tool for the given workspace.
func NewWriteTool(workdir string) *WriteTool {
	return &WriteTool{workdir: workdir}
}

// NewWriteToolWithTracker creates a Write tool with a shared ReadTracker.
func NewWriteToolWithTracker(workdir string, tracker *tool.ReadTracker) *WriteTool {
	return &WriteTool{workdir: workdir, readTracker: tracker}
}

func (t *WriteTool) Name() string { return "Write" }

func (t *WriteTool) Description() string {
	return `Writes content to a file on the local filesystem. Creates parent directories if they don't exist. Overwrites any existing file at the path.`
}

func (t *WriteTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"file_path": {
				"type": "string",
				"description": "The absolute path to the file to write"
			},
			"content": {
				"type": "string",
				"description": "The content to write to the file"
			}
		},
		"required": ["file_path", "content"]
	}`)
}

func (t *WriteTool) IsConcurrentSafe() bool { return false }

type writeInput struct {
	FilePath string `json:"file_path"`
	Content  string `json:"content"`
}

func (t *WriteTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in writeInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	if in.FilePath == "" {
		return tool.ErrorResult("file_path is required"), nil
	}

	filePath := t.resolvePath(in.FilePath)

	// Create parent directories
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Failed to create directory %s: %v", dir, err)), nil
	}

	// Check if file exists (for create vs update reporting)
	existInfo, existErr := os.Stat(filePath)
	isNew := os.IsNotExist(existErr)

	// Enforce read-before-overwrite: existing files must be read first.
	// This prevents accidentally destroying work the model hasn't seen.
	if !isNew && t.readTracker != nil && !t.readTracker.HasBeenRead(filePath) {
		return tool.ErrorResult(fmt.Sprintf("File %s already exists. You must read it first before overwriting. Use the Read tool first.", in.FilePath)), nil
	}

	// Preserve original permissions for existing files, default 0644 for new files
	fileMode := os.FileMode(0644)
	if !isNew && existInfo != nil {
		fileMode = existInfo.Mode()
	}

	// Write file
	if err := os.WriteFile(filePath, []byte(in.Content), fileMode); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Failed to write file: %v", err)), nil
	}

	action := "Updated"
	if isNew {
		action = "Created"
	}

	lines := 0
	if len(in.Content) > 0 {
		lines = 1
		for _, c := range in.Content {
			if c == '\n' {
				lines++
			}
		}
		// A trailing newline doesn't start a new line
		if in.Content[len(in.Content)-1] == '\n' {
			lines--
		}
	}

	return &tool.Result{
		Content: fmt.Sprintf("%s %s (%d lines)", action, in.FilePath, lines),
		Metadata: map[string]interface{}{
			"file_path": in.FilePath,
			"action":    action,
			"lines":     lines,
		},
	}, nil
}

func (t *WriteTool) resolvePath(path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Clean(filepath.Join(t.workdir, path))
}

// Prompt implements tool.PromptProvider.
func (t *WriteTool) Prompt() string {
	return `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`
}

var _ tool.Tool = (*WriteTool)(nil)
var _ tool.PromptProvider = (*WriteTool)(nil)
