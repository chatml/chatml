package context

import (
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/chatml/chatml-core/provider"
	"github.com/chatml/chatml-core/tool"
)

// PostCompactRestorationConfig controls what context is restored after compaction.
type PostCompactRestorationConfig struct {
	// MaxRecentFiles is the number of recently-read files to re-inject (default 5).
	MaxRecentFiles int
	// MaxFileTokens is the max estimated tokens per file (default 5000 ~= 5K tokens).
	MaxFileTokens int
	// ReadTracker provides the list of recently-read files.
	ReadTracker *tool.ReadTracker
	// ToolNames is the list of available tool names (for tool reminder context).
	ToolNames []string
	// MCPInstructions is additional context from MCP servers to re-inject.
	MCPInstructions string
}

// RestorePostCompact generates additional context messages to inject after compaction.
// This matches Claude Code's post-compact restoration behavior:
// - Re-inject recent file reads (up to 5 files, 5K tokens each)
// - Re-inject MCP server instructions
// - Re-inject available tool names as a reminder
//
// Returns additional messages to append to the compacted conversation, or nil if nothing to restore.
func RestorePostCompact(cfg PostCompactRestorationConfig) []provider.Message {
	maxFiles := cfg.MaxRecentFiles
	if maxFiles <= 0 {
		maxFiles = 5
	}
	maxFileTokens := cfg.MaxFileTokens
	if maxFileTokens <= 0 {
		maxFileTokens = 5000
	}

	var sections []string

	// 1. Re-inject recent file reads in parallel
	if cfg.ReadTracker != nil {
		recentFiles := cfg.ReadTracker.RecentFiles(maxFiles)
		if len(recentFiles) > 0 {
			fileContents := readFilesParallel(recentFiles, maxFileTokens)
			if len(fileContents) > 0 {
				var fileSB strings.Builder
				fileSB.WriteString("<system-reminder>\nRecent file states (restored after context compaction):\n\n")
				for _, fc := range fileContents {
					fmt.Fprintf(&fileSB, "--- %s ---\n%s\n\n", fc.path, fc.content)
				}
				fileSB.WriteString("</system-reminder>")
				sections = append(sections, fileSB.String())
			}
		}
	}

	// 2. Re-inject MCP instructions
	if cfg.MCPInstructions != "" {
		sections = append(sections, fmt.Sprintf("<system-reminder>\nMCP server instructions (restored after compaction):\n%s\n</system-reminder>", cfg.MCPInstructions))
	}

	// 3. Re-inject tool names as a reminder (helps model remember available tools)
	if len(cfg.ToolNames) > 0 {
		sections = append(sections, fmt.Sprintf("<system-reminder>\nAvailable tools: %s\n</system-reminder>", strings.Join(cfg.ToolNames, ", ")))
	}

	if len(sections) == 0 {
		return nil
	}

	// Combine all sections into a single user message
	combined := strings.Join(sections, "\n\n")
	return []provider.Message{
		{
			Role: provider.RoleUser,
			Content: []provider.ContentBlock{
				provider.NewTextBlock(combined),
			},
		},
		{
			Role: provider.RoleAssistant,
			Content: []provider.ContentBlock{
				provider.NewTextBlock("I've noted the restored context from the recent files and available tools. Continuing from where we left off."),
			},
		},
	}
}

// fileContent holds a read file's path and content.
type fileContent struct {
	path    string
	content string
}

// readFilesParallel reads multiple files concurrently, returning their contents.
// Each file is truncated to maxTokens estimated tokens (~4 chars/token).
func readFilesParallel(paths []string, maxTokens int) []fileContent {
	maxChars := maxTokens * 4 // ~4 chars per token

	// Pre-allocate indexed results to maintain deterministic order for prompt caching.
	// Limit concurrency to avoid file descriptor exhaustion on large path lists.
	results := make([]fileContent, len(paths))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 10)
	for i, p := range paths {
		wg.Add(1)
		go func(idx int, filePath string) {
			sem <- struct{}{}
			defer func() { <-sem }()
			defer wg.Done()

			data, err := os.ReadFile(filePath)
			if err != nil {
				return // Skip unreadable files silently (zero-value entry)
			}

			content := string(data)
			if len(content) > maxChars {
				content = content[:maxChars] + "\n... (truncated for context restoration)"
			}

			results[idx] = fileContent{path: filePath, content: content}
		}(i, p)
	}
	wg.Wait()

	// Filter out zero-value entries (unreadable files)
	filtered := make([]fileContent, 0, len(results))
	for _, fc := range results {
		if fc.path != "" {
			filtered = append(filtered, fc)
		}
	}
	return filtered
}
