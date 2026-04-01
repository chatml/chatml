package builtin

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chatml/chatml-backend/tool"
)

const (
	readDefaultLimit = 2000 // Default number of lines to read
	readMaxFileSize  = 10 * 1024 * 1024 // 10MB max file size
)

// ReadTool reads files from the filesystem with optional line number ranges.
type ReadTool struct {
	workdir string
}

// NewReadTool creates a Read tool for the given workspace.
func NewReadTool(workdir string) *ReadTool {
	return &ReadTool{workdir: workdir}
}

func (t *ReadTool) Name() string { return "Read" }

func (t *ReadTool) Description() string {
	return `Reads a file from the local filesystem. Results are returned with line numbers (cat -n format). Use offset and limit to read specific ranges of large files.`
}

func (t *ReadTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"file_path": {
				"type": "string",
				"description": "The absolute path to the file to read"
			},
			"offset": {
				"type": "number",
				"description": "The line number to start reading from (1-indexed)"
			},
			"limit": {
				"type": "number",
				"description": "The number of lines to read"
			}
		},
		"required": ["file_path"]
	}`)
}

func (t *ReadTool) IsConcurrentSafe() bool { return true }

type readInput struct {
	FilePath string `json:"file_path"`
	Offset   int    `json:"offset"`
	Limit    int    `json:"limit"`
}

func (t *ReadTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in readInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	filePath := t.resolvePath(in.FilePath)

	// Check file exists and size
	info, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return tool.ErrorResult(fmt.Sprintf("File not found: %s", in.FilePath)), nil
		}
		return tool.ErrorResult(fmt.Sprintf("Cannot access file: %v", err)), nil
	}

	if info.IsDir() {
		return tool.ErrorResult(fmt.Sprintf("%s is a directory, not a file. Use Bash with ls to list directory contents.", in.FilePath)), nil
	}

	if info.Size() > readMaxFileSize {
		return tool.ErrorResult(fmt.Sprintf("File too large (%d bytes). Use offset and limit to read specific ranges.", info.Size())), nil
	}

	// Open and read file
	f, err := os.Open(filePath)
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("Cannot open file: %v", err)), nil
	}
	defer f.Close()

	limit := in.Limit
	if limit <= 0 {
		limit = readDefaultLimit
	}

	offset := in.Offset
	if offset < 1 {
		offset = 1
	}

	scanner := bufio.NewScanner(f)
	// Handle large lines
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var result strings.Builder
	lineNum := 0
	linesRead := 0

	for scanner.Scan() {
		lineNum++
		if lineNum < offset {
			continue
		}
		if linesRead >= limit {
			break
		}

		fmt.Fprintf(&result, "%6d\t%s\n", lineNum, scanner.Text())
		linesRead++
	}

	if err := scanner.Err(); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Error reading file: %v", err)), nil
	}

	if linesRead == 0 {
		if offset > 1 {
			return tool.TextResult(fmt.Sprintf("No content at offset %d (file has %d lines)", offset, lineNum)), nil
		}
		return tool.TextResult("(empty file)"), nil
	}

	return tool.TextResult(result.String()), nil
}

// resolvePath resolves a file path, making relative paths absolute from workdir.
func (t *ReadTool) resolvePath(path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Clean(filepath.Join(t.workdir, path))
}

var _ tool.Tool = (*ReadTool)(nil)
