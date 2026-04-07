package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/chatml/chatml-core/tool"
)

const globMaxResults = 100

// GlobTool finds files matching glob patterns.
type GlobTool struct {
	workdir string
}

// NewGlobTool creates a Glob tool for the given workspace.
func NewGlobTool(workdir string) *GlobTool {
	return &GlobTool{workdir: workdir}
}

func (t *GlobTool) Name() string { return "Glob" }

func (t *GlobTool) Description() string {
	return `Fast file pattern matching tool. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.`
}

func (t *GlobTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"pattern": {
				"type": "string",
				"description": "The glob pattern to match files against"
			},
			"path": {
				"type": "string",
				"description": "The directory to search in. Defaults to the workspace root."
			}
		},
		"required": ["pattern"]
	}`)
}

func (t *GlobTool) IsConcurrentSafe() bool { return true }

type globInput struct {
	Pattern string `json:"pattern"`
	Path    string `json:"path"`
}

func (t *GlobTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in globInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	if in.Pattern == "" {
		return tool.ErrorResult("pattern is required"), nil
	}

	// Absolute paths are allowed (consistent with ReadTool),
	// but relative paths are confined to workdir to prevent ".." traversal.
	searchDir := t.workdir
	if in.Path != "" {
		if filepath.IsAbs(in.Path) {
			searchDir = filepath.Clean(in.Path)
		} else {
			resolved := filepath.Clean(filepath.Join(t.workdir, in.Path))
			if !strings.HasPrefix(resolved+"/", t.workdir+"/") && resolved != t.workdir {
				return tool.ErrorResult(fmt.Sprintf("Relative path %q escapes the workspace directory", in.Path)), nil
			}
			searchDir = resolved
		}
	}

	// Verify directory exists
	info, err := os.Stat(searchDir)
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("Directory not found: %s", searchDir)), nil
	}
	if !info.IsDir() {
		return tool.ErrorResult(fmt.Sprintf("%s is not a directory", searchDir)), nil
	}

	start := time.Now()

	// Use filepath.Glob for simple patterns, walk for ** patterns
	var matches []string
	fullPattern := filepath.Join(searchDir, in.Pattern)

	if strings.Contains(in.Pattern, "**") {
		// Walk-based matching for ** patterns
		matches, err = walkGlob(searchDir, in.Pattern)
	} else {
		matches, err = filepath.Glob(fullPattern)
	}

	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("Glob error: %v", err)), nil
	}

	duration := time.Since(start)

	// Sort by modification time (newest first)
	type fileEntry struct {
		path    string
		modTime time.Time
	}
	entries := make([]fileEntry, 0, len(matches))
	for _, m := range matches {
		info, err := os.Stat(m)
		if err != nil {
			continue
		}
		if info.IsDir() {
			continue // Skip directories, only return files
		}
		entries = append(entries, fileEntry{m, info.ModTime()})
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].modTime.After(entries[j].modTime)
	})

	truncated := len(entries) > globMaxResults
	if truncated {
		entries = entries[:globMaxResults]
	}

	// Relativize paths
	var result strings.Builder
	for _, e := range entries {
		rel, err := filepath.Rel(t.workdir, e.path)
		if err != nil {
			rel = e.path
		}
		result.WriteString(rel)
		result.WriteString("\n")
	}

	numFiles := len(entries)
	summary := fmt.Sprintf("Found %d file(s) in %dms", numFiles, duration.Milliseconds())
	if truncated {
		summary += fmt.Sprintf(" (showing first %d)", globMaxResults)
	}

	return &tool.Result{
		Content: summary + "\n" + result.String(),
		Metadata: map[string]interface{}{
			"numFiles":  numFiles,
			"truncated": truncated,
			"durationMs": duration.Milliseconds(),
		},
	}, nil
}

// walkGlob walks the directory tree and matches files against a ** pattern.
func walkGlob(root, pattern string) ([]string, error) {
	var matches []string

	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}

		// Skip hidden directories (except the root)
		name := info.Name()
		if info.IsDir() && name != "." && strings.HasPrefix(name, ".") {
			return filepath.SkipDir
		}

		if info.IsDir() {
			return nil
		}

		// Get path relative to root for matching
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}

		// Simple ** matching: convert pattern to check
		if matchDoubleGlob(rel, pattern) {
			matches = append(matches, path)
		}

		return nil
	})

	return matches, err
}

// matchDoubleGlob performs basic ** glob matching.
// Handles patterns like "**/*.go", "src/**/*.ts", "**/*test*".
// Limitation: only one ** segment is supported. Patterns with multiple **
// (e.g., "src/**/test/**/*.go") will not match correctly.
func matchDoubleGlob(path, pattern string) bool {
	// Convert ** pattern to a suffix match
	// "**/*.go" → match any path ending in .go
	// "src/**/*.ts" → match paths starting with src/ ending in .ts
	parts := strings.SplitN(pattern, "**", 2)
	if len(parts) != 2 {
		// No ** found, use regular match
		matched, _ := filepath.Match(pattern, path)
		return matched
	}

	prefix := strings.TrimRight(parts[0], string(filepath.Separator))
	suffix := strings.TrimLeft(parts[1], string(filepath.Separator))

	// Check prefix
	if prefix != "" && !strings.HasPrefix(path, prefix+string(filepath.Separator)) && path != prefix {
		return false
	}

	// Check suffix (which may contain regular globs)
	if suffix == "" {
		return true
	}

	// Match suffix against the filename or remaining path
	remainingPath := path
	if prefix != "" {
		remainingPath = strings.TrimPrefix(path, prefix+string(filepath.Separator))
	}

	// Try matching suffix against the basename
	matched, _ := filepath.Match(suffix, filepath.Base(remainingPath))
	if matched {
		return true
	}

	// Try matching suffix against the remaining path
	matched, _ = filepath.Match(suffix, remainingPath)
	return matched
}

// Prompt implements tool.PromptProvider.
func (t *GlobTool) Prompt() string {
	return `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`
}

var _ tool.Tool = (*GlobTool)(nil)
var _ tool.PromptProvider = (*GlobTool)(nil)
