package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chatml/chatml-backend/tool"
)

// WriteTool writes content to a file, creating parent directories as needed.
type WriteTool struct {
	workdir string
}

// NewWriteTool creates a Write tool for the given workspace.
func NewWriteTool(workdir string) *WriteTool {
	return &WriteTool{workdir: workdir}
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
	_, existErr := os.Stat(filePath)
	isNew := os.IsNotExist(existErr)

	// Write file
	if err := os.WriteFile(filePath, []byte(in.Content), 0644); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Failed to write file: %v", err)), nil
	}

	action := "Updated"
	if isNew {
		action = "Created"
	}

	lines := 1
	for _, c := range in.Content {
		if c == '\n' {
			lines++
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

var _ tool.Tool = (*WriteTool)(nil)
