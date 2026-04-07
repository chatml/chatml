package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// ── Defaults ────────────────────────────────────────────────────────────────

const (
	defaultModel = "claude-sonnet-4-6"
	version      = "0.1.0"
)

// ── Spinner verbs (inspired by Claude Code) ─────────────────────────────────

var spinnerVerbs = []string{
	"Pondering", "Reasoning", "Analyzing", "Synthesizing", "Evaluating",
	"Architecting", "Composing", "Formulating", "Deliberating", "Contemplating",
	"Brewing", "Simmering", "Marinating", "Sautéing", "Percolating",
	"Crystallizing", "Distilling", "Calibrating", "Harmonizing", "Orchestrating",
	"Weaving", "Sculpting", "Illuminating", "Navigating", "Deciphering",
}

func randomVerb() string {
	return spinnerVerbs[rand.Intn(len(spinnerVerbs))]
}

// formatNum formats an integer with comma separators: 1234567 -> "1,234,567"
func formatNum(n int) string {
	if n < 0 {
		return "-" + formatNum(-n)
	}
	s := strconv.Itoa(n)
	if len(s) <= 3 {
		return s
	}
	var result strings.Builder
	remainder := len(s) % 3
	if remainder > 0 {
		result.WriteString(s[:remainder])
	}
	for i := remainder; i < len(s); i += 3 {
		if result.Len() > 0 {
			result.WriteByte(',')
		}
		result.WriteString(s[i : i+3])
	}
	return result.String()
}

// truncate shortens a string to n characters with ellipsis.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	if n <= 3 {
		return s[:n]
	}
	return s[:n-3] + "..."
}

// extractToolParam returns the primary parameter for display from a tool event.
func extractToolParam(tool string, params map[string]interface{}) string {
	preferred := map[string][]string{
		"web_search":        {"query"},
		"web_fetch":         {"url"},
		"bash":              {"command"},
		"computer":          {"action"},
		"read_file":         {"file_path"},
		"write_file":        {"file_path"},
		"edit_file":         {"file_path"},
		"str_replace_based": {"file_path"},
	}
	fallback := []string{"query", "url", "file_path", "pattern", "command"}

	keys := fallback
	if pref, ok := preferred[tool]; ok {
		keys = append(pref, fallback...)
	}
	seen := map[string]bool{}
	for _, key := range keys {
		if seen[key] {
			continue
		}
		seen[key] = true
		if v, ok := params[key]; ok {
			s := fmt.Sprintf("%v", v)
			if len(s) > maxSummaryWidth {
				s = s[:maxSummaryWidth-3] + "..."
			}
			return s
		}
	}
	return ""
}

// toInt converts an interface{} (typically from JSON) to int.
func toInt(v interface{}) (int, bool) {
	switch val := v.(type) {
	case float64:
		return int(val), true
	case int:
		return val, true
	case int64:
		return int(val), true
	case json.Number:
		n, err := val.Int64()
		if err != nil {
			return 0, false
		}
		return int(n), true
	}
	return 0, false
}

// displayPath converts an absolute path to a relative or tilde-prefixed path for display.
func displayPath(fullPath, workdir string) string {
	if rel, err := filepath.Rel(workdir, fullPath); err == nil && !strings.HasPrefix(rel, "..") {
		return rel
	}
	if home, err := os.UserHomeDir(); err == nil && strings.HasPrefix(fullPath, home) {
		return "~" + fullPath[len(home):]
	}
	return fullPath
}

// extractToolParams returns the primary display parameter for a tool, using tool-aware extraction.
// Dispatches to per-tool renderers defined in tool_render.go.
func extractToolParams(tool string, params map[string]interface{}, workdir string) string {
	if params == nil {
		return ""
	}
	if r, ok := toolRenderers[tool]; ok && r.extractParams != nil {
		return r.extractParams(params, workdir)
	}
	// Generic fallback
	return extractToolParam(tool, params)
}

// modeBadge shortens "bypassPermissions" to "bypass" for display.
func modeBadge(mode string) string {
	if mode == "bypassPermissions" {
		return "bypass"
	}
	return mode
}

// nextPermMode cycles through permission modes.
func nextPermMode(current string) string {
	modes := []string{"bypassPermissions", "default", "acceptEdits", "plan"}
	for i, m := range modes {
		if m == current {
			return modes[(i+1)%len(modes)]
		}
	}
	return "bypassPermissions"
}

// formatFileSize formats a byte count as a human-readable size string.
func formatFileSize(bytes int) string {
	switch {
	case bytes >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(bytes)/float64(1<<20))
	case bytes >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(bytes)/float64(1<<10))
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}

// extractExitCode tries to find an exit code in a bash tool summary.
// Looks for patterns like "Exit code: N" or trailing "[N]".
func extractExitCode(summary string) (int, bool) {
	// Pattern: "Exit code: N"
	if idx := strings.Index(summary, "Exit code: "); idx >= 0 {
		numStr := strings.TrimSpace(summary[idx+len("Exit code: "):])
		if spIdx := strings.IndexByte(numStr, ' '); spIdx >= 0 {
			numStr = numStr[:spIdx]
		}
		if spIdx := strings.IndexByte(numStr, '\n'); spIdx >= 0 {
			numStr = numStr[:spIdx]
		}
		if n, err := strconv.Atoi(numStr); err == nil {
			return n, true
		}
	}
	// Pattern: last line is just a number (exit code)
	lines := strings.Split(strings.TrimSpace(summary), "\n")
	if len(lines) > 0 {
		last := strings.TrimSpace(lines[len(lines)-1])
		if n, err := strconv.Atoi(last); err == nil && n >= 0 && n < 256 {
			return n, true
		}
	}
	return 0, false
}

// detectLanguageFromPath returns a short language name from a file extension.
func detectLanguageFromPath(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".go":
		return "Go"
	case ".ts", ".tsx":
		return "TypeScript"
	case ".js", ".jsx":
		return "JavaScript"
	case ".py":
		return "Python"
	case ".rs":
		return "Rust"
	case ".rb":
		return "Ruby"
	case ".java":
		return "Java"
	case ".c", ".h":
		return "C"
	case ".cpp", ".cc", ".cxx", ".hpp":
		return "C++"
	case ".cs":
		return "C#"
	case ".swift":
		return "Swift"
	case ".kt":
		return "Kotlin"
	case ".sh", ".bash":
		return "Shell"
	case ".yaml", ".yml":
		return "YAML"
	case ".json":
		return "JSON"
	case ".toml":
		return "TOML"
	case ".md":
		return "Markdown"
	case ".html", ".htm":
		return "HTML"
	case ".css":
		return "CSS"
	case ".sql":
		return "SQL"
	case ".proto":
		return "Protobuf"
	case ".dockerfile":
		return "Dockerfile"
	default:
		return ""
	}
}

// countLines counts the number of lines in a string.
func countLines(s string) int {
	if s == "" {
		return 0
	}
	n := strings.Count(s, "\n") + 1
	if strings.HasSuffix(s, "\n") {
		n--
	}
	return n
}
