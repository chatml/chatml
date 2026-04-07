package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chatml/chatml-core/tool"
)

// EditTool performs structured string replacements in files.
type EditTool struct {
	workdir     string
	readTracker *tool.ReadTracker
}

// NewEditTool creates an Edit tool for the given workspace.
func NewEditTool(workdir string) *EditTool {
	return &EditTool{workdir: workdir}
}

// NewEditToolWithTracker creates an Edit tool with a shared ReadTracker.
func NewEditToolWithTracker(workdir string, tracker *tool.ReadTracker) *EditTool {
	return &EditTool{workdir: workdir, readTracker: tracker}
}

func (t *EditTool) Name() string { return "Edit" }

func (t *EditTool) Description() string {
	return `Performs exact string replacements in files. The old_string must be unique in the file unless replace_all is true. Prefer this over Write for modifying existing files since it only sends the diff.`
}

func (t *EditTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"file_path": {
				"type": "string",
				"description": "The absolute path to the file to modify"
			},
			"old_string": {
				"type": "string",
				"description": "The text to replace"
			},
			"new_string": {
				"type": "string",
				"description": "The replacement text (must differ from old_string)"
			},
			"replace_all": {
				"type": "boolean",
				"description": "Replace all occurrences (default false)"
			}
		},
		"required": ["file_path", "old_string", "new_string"]
	}`)
}

func (t *EditTool) IsConcurrentSafe() bool { return false }

type editInput struct {
	FilePath   string `json:"file_path"`
	OldString  string `json:"old_string"`
	NewString  string `json:"new_string"`
	ReplaceAll bool   `json:"replace_all"`
}

func (t *EditTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in editInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	if in.FilePath == "" {
		return tool.ErrorResult("file_path is required"), nil
	}
	if in.OldString == "" {
		return tool.ErrorResult("old_string must not be empty"), nil
	}
	if in.OldString == in.NewString {
		return tool.ErrorResult("old_string and new_string must be different"), nil
	}

	filePath := t.resolvePath(in.FilePath)

	// Enforce read-before-edit: the file must have been read in this session.
	// This prevents blind edits to files the model hasn't seen.
	if t.readTracker != nil && !t.readTracker.HasBeenRead(filePath) {
		return tool.ErrorResult(fmt.Sprintf("You must read %s before editing it. Use the Read tool first.", in.FilePath)), nil
	}

	// Read current file content and preserve permissions
	info, statErr := os.Stat(filePath)
	if statErr != nil {
		if os.IsNotExist(statErr) {
			return tool.ErrorResult(fmt.Sprintf("File not found: %s", in.FilePath)), nil
		}
		return tool.ErrorResult(fmt.Sprintf("Cannot access file: %v", statErr)), nil
	}
	fileMode := info.Mode()

	data, err := os.ReadFile(filePath)
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("Cannot read file: %v", err)), nil
	}

	content := string(data)

	// Count occurrences
	count := strings.Count(content, in.OldString)
	if count == 0 {
		return tool.ErrorResult(fmt.Sprintf("old_string not found in %s. Make sure it matches exactly, including whitespace and indentation.", in.FilePath)), nil
	}

	if count > 1 && !in.ReplaceAll {
		return tool.ErrorResult(fmt.Sprintf("old_string found %d times in %s. Use replace_all: true to replace all occurrences, or provide more context to make the match unique.", count, in.FilePath)), nil
	}

	// Perform replacement
	var newContent string
	if in.ReplaceAll {
		newContent = strings.ReplaceAll(content, in.OldString, in.NewString)
	} else {
		newContent = strings.Replace(content, in.OldString, in.NewString, 1)
	}

	// Write back preserving original file permissions
	if err := os.WriteFile(filePath, []byte(newContent), fileMode); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Failed to write file: %v", err)), nil
	}

	replacements := 1
	if in.ReplaceAll {
		replacements = count
	}

	return &tool.Result{
		Content: fmt.Sprintf("Edited %s: replaced %d occurrence(s)", in.FilePath, replacements),
		Metadata: map[string]interface{}{
			"file_path":    in.FilePath,
			"replacements": replacements,
		},
	}, nil
}

func (t *EditTool) resolvePath(path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Clean(filepath.Join(t.workdir, path))
}

// Prompt implements tool.PromptProvider.
func (t *EditTool) Prompt() string {
	return `Performs exact string replacements in files.

Usage:
- You must use your ` + "`Read`" + ` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if ` + "`old_string`" + ` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use ` + "`replace_all`" + ` to change every instance of ` + "`old_string`" + `.
- Use ` + "`replace_all`" + ` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`
}

var _ tool.Tool = (*EditTool)(nil)
var _ tool.PromptProvider = (*EditTool)(nil)
