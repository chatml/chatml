package builtin

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/chatml/chatml-backend/tool"
)

const (
	readDefaultLimit = 2000 // Default number of lines to read
	readMaxFileSize  = 10 * 1024 * 1024 // 10MB max file size
)

// ReadTool reads files from the filesystem with optional line number ranges.
type ReadTool struct {
	workdir     string
	readTracker *tool.ReadTracker
}

// NewReadTool creates a Read tool for the given workspace.
func NewReadTool(workdir string) *ReadTool {
	return &ReadTool{workdir: workdir, readTracker: tool.NewReadTracker()}
}

// NewReadToolWithTracker creates a Read tool with a shared ReadTracker.
// Use this when Edit/Write tools need to check if a file has been read.
func NewReadToolWithTracker(workdir string, tracker *tool.ReadTracker) *ReadTool {
	return &ReadTool{workdir: workdir, readTracker: tracker}
}

// ReadTracker returns the read tracker for sharing with Edit/Write tools.
func (t *ReadTool) ReadTracker() *tool.ReadTracker {
	return t.readTracker
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
			},
			"pages": {
				"type": "string",
				"description": "Page range for PDF files (e.g., \"1-5\", \"3\", \"10-20\"). Only applicable to PDF files. Maximum 20 pages per request."
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
	Pages    string `json:"pages"`
}

func (t *ReadTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in readInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	filePath := t.resolvePath(in.FilePath)

	// Block dangerous device paths that can hang or produce infinite output
	if isDangerousDevicePath(filePath) {
		return tool.ErrorResult(fmt.Sprintf("Cannot read device path %s — this could hang or produce infinite output. Use Bash if you need to interact with device files.", in.FilePath)), nil
	}

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

	// Handle special file types by extension
	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg":
		if t.readTracker != nil {
			t.readTracker.MarkRead(filePath)
		}
		return t.readImage(filePath, ext, info.Size())
	case ".ipynb":
		if t.readTracker != nil {
			t.readTracker.MarkRead(filePath)
		}
		return t.readNotebook(filePath)
	case ".pdf":
		if t.readTracker != nil {
			t.readTracker.MarkRead(filePath)
		}
		return t.readPDF(ctx, filePath, in.Pages)
	}

	// Detect binary files (check first 512 bytes)
	if isBinaryFile(filePath) {
		return tool.ErrorResult(fmt.Sprintf("%s appears to be a binary file. Use Bash to inspect it with appropriate tools.", in.FilePath)), nil
	}

	// Open and read text file
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

	// Track successful read for Edit/Write validation
	if t.readTracker != nil {
		t.readTracker.MarkRead(filePath)
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

// readImage reads an image file and returns base64-encoded content with metadata.
func (t *ReadTool) readImage(filePath, ext string, size int64) (*tool.Result, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("Cannot read image: %v", err)), nil
	}

	b64 := base64.StdEncoding.EncodeToString(data)
	mediaType := "image/" + strings.TrimPrefix(ext, ".")
	if ext == ".jpg" {
		mediaType = "image/jpeg"
	}
	if ext == ".svg" {
		mediaType = "image/svg+xml"
	}

	return &tool.Result{
		Content: fmt.Sprintf("[Image: %s, %d bytes, %s]", filepath.Base(filePath), size, mediaType),
		ImageData: &tool.ImageResultData{
			MediaType: mediaType,
			Base64:    b64,
		},
		Metadata: map[string]interface{}{
			"type":      "image",
			"file_path": filePath,
		},
	}, nil
}

// readNotebook reads a Jupyter notebook and returns cells with their outputs.
func (t *ReadTool) readNotebook(filePath string) (*tool.Result, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("Cannot read notebook: %v", err)), nil
	}

	var notebook struct {
		Cells []struct {
			CellType string        `json:"cell_type"`
			Source   []string      `json:"source"`
			Outputs []interface{} `json:"outputs"`
		} `json:"cells"`
	}
	if err := json.Unmarshal(data, &notebook); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid notebook format: %v", err)), nil
	}

	var result strings.Builder
	for i, cell := range notebook.Cells {
		fmt.Fprintf(&result, "--- Cell %d [%s] ---\n", i+1, cell.CellType)
		for _, line := range cell.Source {
			result.WriteString(line)
		}
		result.WriteString("\n")
		if len(cell.Outputs) > 0 {
			result.WriteString("[Has output]\n")
		}
		result.WriteString("\n")
	}

	return &tool.Result{
		Content: result.String(),
		Metadata: map[string]interface{}{
			"type":      "notebook",
			"num_cells": len(notebook.Cells),
		},
	}, nil
}

// readPDF extracts text from a PDF file using pdftotext (poppler-utils).
// Supports optional page range specification (e.g., "1-5", "3", "10-20").
// Uses the caller's context to enforce timeout and cancellation.
func (t *ReadTool) readPDF(ctx context.Context, filePath, pages string) (*tool.Result, error) {
	// Check if pdftotext is available
	if _, err := exec.LookPath("pdftotext"); err != nil {
		return tool.ErrorResult("PDF reading requires pdftotext (install poppler-utils). Alternatively, use Bash with a PDF-to-text tool."), nil
	}

	args := []string{}

	// Parse page range if specified
	if pages != "" {
		first, last, err := parsePageRange(pages)
		if err != nil {
			return tool.ErrorResult(fmt.Sprintf("Invalid page range %q: %v", pages, err)), nil
		}
		if last-first+1 > 20 {
			return tool.ErrorResult("Maximum 20 pages per request. Please specify a smaller range."), nil
		}
		args = append(args, "-f", strconv.Itoa(first), "-l", strconv.Itoa(last))
	}

	// pdftotext <args> <input> - (output to stdout)
	// Use "--" to prevent flag injection if filePath somehow starts with "-".
	args = append(args, "--", filePath, "-")
	cmd := exec.CommandContext(ctx, "pdftotext", args...)
	out, err := cmd.Output()
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("pdftotext failed: %v", err)), nil
	}

	content := string(out)
	if strings.TrimSpace(content) == "" {
		return tool.TextResult("(PDF contains no extractable text — it may be image-based. Use OCR tools for scanned documents.)"), nil
	}

	return &tool.Result{
		Content: content,
		Metadata: map[string]interface{}{
			"type":      "pdf",
			"file_path": filePath,
			"pages":     pages,
		},
	}, nil
}

// parsePageRange parses a page range string like "1-5", "3", or "10-20".
// Returns first and last page numbers (1-indexed).
func parsePageRange(spec string) (first, last int, err error) {
	spec = strings.TrimSpace(spec)
	if strings.Contains(spec, "-") {
		parts := strings.SplitN(spec, "-", 2)
		first, err = strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil {
			return 0, 0, fmt.Errorf("invalid first page: %v", err)
		}
		last, err = strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil {
			return 0, 0, fmt.Errorf("invalid last page: %v", err)
		}
	} else {
		first, err = strconv.Atoi(spec)
		if err != nil {
			return 0, 0, fmt.Errorf("invalid page number: %v", err)
		}
		last = first
	}
	if first < 1 {
		return 0, 0, fmt.Errorf("page numbers must be >= 1")
	}
	if last < first {
		return 0, 0, fmt.Errorf("last page must be >= first page")
	}
	return first, last, nil
}

// isBinaryFile checks if a file appears to be binary by examining the first 512 bytes.
func isBinaryFile(filePath string) bool {
	f, err := os.Open(filePath)
	if err != nil {
		return false
	}
	defer f.Close()

	buf := make([]byte, 512)
	n, err := f.Read(buf)
	if err != nil {
		return false
	}
	buf = buf[:n]

	// Count null bytes — binary files typically have many
	nullCount := 0
	for _, b := range buf {
		if b == 0 {
			nullCount++
		}
	}

	// If more than 10% null bytes, likely binary
	return nullCount > n/10
}

// Prompt implements tool.PromptProvider.
func (t *ReadTool) Prompt() string {
	return `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- When you already know which part of the file you need, only read that part. This can be important for larger files.
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`
}

// isDangerousDevicePath returns true for system device paths that could hang
// or produce infinite output when read. Blocks /dev/, /proc/, /sys/ paths.
func isDangerousDevicePath(path string) bool {
	cleaned := filepath.Clean(path)
	return strings.HasPrefix(cleaned, "/dev/") ||
		strings.HasPrefix(cleaned, "/proc/") ||
		strings.HasPrefix(cleaned, "/sys/")
}

var _ tool.Tool = (*ReadTool)(nil)
var _ tool.PromptProvider = (*ReadTool)(nil)
