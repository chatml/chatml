// Package prompt handles system prompt construction for the native Go agentic loop.
// It loads CLAUDE.md files, memory, and environment context to build the complete
// system prompt that gives the LLM awareness of the project and workspace.
package prompt

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/chatml/chatml-core/paths"
)

const maxClaudeMDChars = 40_000

// ClaudeMDEntry represents a loaded CLAUDE.md file with its source path and content.
type ClaudeMDEntry struct {
	Path       string   // Source file path
	Content    string   // File content (after processing)
	Priority   int      // Higher = loaded later = higher priority
	PathGlobs  []string // Optional: file path patterns this rule applies to (from frontmatter paths:)
}

// LoadClaudeMD discovers and loads all instruction files for the given workspace.
// Checks CHATML.md (primary) and CLAUDE.md (fallback) at each location.
// Search order (lowest to highest priority):
//  1. ~/.chatml/CHATML.md OR ~/.claude/CLAUDE.md (user-level global)
//  2. CHATML.md/CLAUDE.md files walking UP from workdir to root
//  3. .chatml/CHATML.md OR .claude/CLAUDE.md in each directory
//  4. .chatml/rules/*.md OR .claude/rules/*.md in each directory
//  5. CHATML.local.md OR CLAUDE.local.md in workdir (highest priority)
func LoadClaudeMD(workdir string) []ClaudeMDEntry {
	var entries []ClaudeMDEntry
	priority := 0

	// Helper: load from first existing path (primary then fallback)
	loadFirst := func(primaryPath, fallbackPath string) {
		for _, p := range []string{primaryPath, fallbackPath} {
			if content, err := readClaudeMDFile(p); err == nil {
				entry := ClaudeMDEntry{Path: p, Content: content, Priority: priority}
				if raw, readErr := os.ReadFile(p); readErr == nil {
					entry.PathGlobs = parseFrontmatterPaths(string(raw))
				}
				entries = append(entries, entry)
				priority++
				return // Only load first found
			}
		}
	}

	// Helper: load from ALL existing paths (for merging both .chatml + .claude)
	loadAll := func(primaryPath, fallbackPath string) {
		for _, p := range []string{primaryPath, fallbackPath} {
			if content, err := readClaudeMDFile(p); err == nil {
				entry := ClaudeMDEntry{Path: p, Content: content, Priority: priority}
				if raw, readErr := os.ReadFile(p); readErr == nil {
					entry.PathGlobs = parseFrontmatterPaths(string(raw))
				}
				entries = append(entries, entry)
				priority++
			}
		}
	}

	// 1. User-level global: ~/.chatml/CHATML.md or ~/.claude/CLAUDE.md
	primary, fallback := paths.HomeInstructionPaths()
	loadFirst(primary, fallback)

	// 2-4. Walk directory tree upward from workdir to root
	dirs := directoryChainToRoot(workdir)
	// Reverse so root is processed first (lowest priority)
	for i := len(dirs) - 1; i >= 0; i-- {
		dir := dirs[i]

		// CHATML.md / CLAUDE.md in this directory
		p, fb := paths.InstructionPaths(dir)
		loadFirst(p, fb)

		// .chatml/CHATML.md / .claude/CLAUDE.md
		p, fb = paths.ConfigInstructionPaths(dir)
		loadFirst(p, fb)

		// .chatml/rules/*.md AND .claude/rules/*.md (merge both)
		pRules, fbRules := paths.RulesDirPaths(dir)
		for _, rulesDir := range []string{pRules, fbRules} {
			if ruleFiles, err := filepath.Glob(filepath.Join(rulesDir, "*.md")); err == nil {
				sort.Strings(ruleFiles)
				for _, rf := range ruleFiles {
					if content, err := readClaudeMDFile(rf); err == nil {
						entry := ClaudeMDEntry{Path: rf, Content: content, Priority: priority}
						if raw, readErr := os.ReadFile(rf); readErr == nil {
							entry.PathGlobs = parseFrontmatterPaths(string(raw))
						}
						entries = append(entries, entry)
						priority++
					}
				}
			}
		}
	}

	// 5. CHATML.local.md / CLAUDE.local.md (highest priority)
	p, fb := paths.LocalInstructionPaths(workdir)
	loadAll(p, fb)

	return entries
}

// MergeClaudeMD combines all loaded entries into a single string, respecting
// the character limit. Higher-priority entries are kept if truncation is needed.
// Entries with PathGlobs are only included if at least one glob matches the workdir.
// The workdir parameter is the current working directory used for path glob matching.
// If empty, path-conditional entries are skipped.
func MergeClaudeMD(entries []ClaudeMDEntry, workdir string) string {
	if len(entries) == 0 {
		return ""
	}

	// Sort by priority (ascending — build up from lowest)
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Priority < entries[j].Priority
	})

	var parts []string
	totalLen := 0

	for _, e := range entries {
		// Skip entries with path patterns that don't match the working directory
		if len(e.PathGlobs) > 0 && (workdir == "" || !matchesAnyGlob(workdir, e.PathGlobs)) {
			continue
		}

		content := e.Content
		if totalLen+len(content) > maxClaudeMDChars {
			remaining := maxClaudeMDChars - totalLen
			if remaining > 50 {
				content = content[:remaining] + "\n... (truncated)"
			} else {
				break
			}
		}
		parts = append(parts, content)
		totalLen += len(content)
	}

	return strings.Join(parts, "\n\n")
}

// matchesAnyGlob checks if the given directory path matches any of the glob patterns.
// Called with the working directory to filter path-conditional CLAUDE.md entries.
func matchesAnyGlob(dir string, patterns []string) bool {
	for _, pattern := range patterns {
		// Match pattern against the full directory path
		if matched, _ := filepath.Match(pattern, dir); matched {
			return true
		}
		// Also try matching against the directory basename
		if matched, _ := filepath.Match(pattern, filepath.Base(dir)); matched {
			return true
		}
	}
	// If no patterns match, the rule doesn't apply
	return false
}

// readClaudeMDFile reads a file, processes @include directives, strips block
// HTML comments, and trims whitespace.
func readClaudeMDFile(path string) (string, error) {
	return readClaudeMDFileWithDepth(path, 0, nil)
}

const maxIncludeDepth = 5

func readClaudeMDFileWithDepth(path string, depth int, visited map[string]bool) (string, error) {
	if depth > maxIncludeDepth {
		return "", fmt.Errorf("@include depth exceeded (max %d)", maxIncludeDepth)
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}

	// Circular reference detection
	if visited == nil {
		visited = make(map[string]bool)
	}
	if visited[absPath] {
		return "", fmt.Errorf("circular @include: %s", absPath)
	}
	visited[absPath] = true

	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	content := string(data)

	// Strip frontmatter before processing
	content = stripFrontmatter(content)

	// Process @include directives
	content = processIncludes(content, filepath.Dir(path), depth, visited)

	content = stripBlockComments(content)
	content = strings.TrimSpace(content)
	if content == "" {
		return "", os.ErrNotExist // Treat empty files as non-existent
	}
	return content, nil
}

// includeRe matches @include directives with relative paths only.
// Accepts both @./path and @path (bare relative paths without ./ prefix).
// Absolute and home-relative (~/) paths are NOT supported to prevent
// exfiltration of sensitive files (SSH keys, credentials) via malicious
// CLAUDE.md files in untrusted repositories.
var includeRe = regexp.MustCompile(`(?m)^@(\.?/?[^\s]+)\s*$`)

// processIncludes resolves @include directives in CLAUDE.md content.
// Only relative paths are supported (both ./path and bare path forms),
// and they must resolve within the baseDir directory tree (no escaping via "..").
func processIncludes(content, baseDir string, depth int, visited map[string]bool) string {
	absBaseDir, err := filepath.Abs(baseDir)
	if err != nil {
		return content // Can't resolve base dir — skip all includes
	}

	return includeRe.ReplaceAllStringFunc(content, func(match string) string {
		ref := strings.TrimSpace(match[1:]) // Strip leading @

		// Resolve relative path
		resolved := filepath.Clean(filepath.Join(baseDir, ref))

		// Security: verify the resolved path stays within baseDir.
		// This prevents path traversal via @./../../../etc/passwd.
		absResolved, err := filepath.Abs(resolved)
		if err != nil {
			return "" // Silently skip unresolvable paths
		}
		if !isPathWithin(absBaseDir, absResolved) {
			return fmt.Sprintf("[Blocked: @include path escapes project directory: %s]", ref)
		}

		// Only include text files (with explicit extension)
		ext := strings.ToLower(filepath.Ext(resolved))
		if !isTextFileExt(ext) {
			return fmt.Sprintf("[Cannot include non-text file: %s]", ref)
		}

		included, err := readClaudeMDFileWithDepth(resolved, depth+1, visited)
		if err != nil {
			return "" // Silently skip missing includes
		}
		return included
	})
}

// isPathWithin returns true if candidate is inside (or equal to) the base directory.
func isPathWithin(base, candidate string) bool {
	rel, err := filepath.Rel(base, candidate)
	if err != nil {
		return false
	}
	return !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != ".."
}

// isTextFileExt returns true if the extension is a known text file type.
// Files with no extension are NOT allowed to prevent inclusion of credential
// files (SSH keys, .aws/credentials, .netrc, etc.) which have no extension.
func isTextFileExt(ext string) bool {
	textExts := map[string]bool{
		".md": true, ".txt": true, ".json": true, ".yaml": true, ".yml": true,
		".ts": true, ".js": true, ".go": true, ".py": true, ".rs": true,
		".toml": true, ".cfg": true, ".ini": true, ".sh": true, ".bash": true,
		".zsh": true, ".fish": true, ".css": true, ".html": true, ".xml": true,
		".svg": true, ".sql": true, ".graphql": true, ".proto": true,
		".java": true, ".kt": true, ".swift": true, ".c": true, ".h": true,
		".cpp": true, ".hpp": true, ".rb": true, ".php": true, ".lua": true,
		".r": true, ".ex": true, ".exs": true, ".erl": true, ".hs": true,
	}
	return textExts[ext]
}

// frontmatterRe matches YAML frontmatter blocks at the start of a file.
var frontmatterRe = regexp.MustCompile(`(?s)\A---\n.*?\n---\n?`)

// stripFrontmatter removes YAML frontmatter from the start of content.
func stripFrontmatter(content string) string {
	return frontmatterRe.ReplaceAllString(content, "")
}

// parseFrontmatterPaths extracts the paths: field from YAML frontmatter.
// Returns nil if no paths field is found. The paths field is used for
// conditional rules — the entry only applies to files matching these patterns.
func parseFrontmatterPaths(content string) []string {
	if !strings.HasPrefix(content, "---\n") {
		return nil
	}
	end := strings.Index(content[4:], "\n---")
	if end < 0 {
		return nil
	}
	fm := content[4 : 4+end]

	var paths []string
	inPaths := false
	for _, line := range strings.Split(fm, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "paths:") {
			inPaths = true
			// Check for inline value: paths: src/**
			val := strings.TrimSpace(strings.TrimPrefix(trimmed, "paths:"))
			if val != "" {
				for _, p := range splitPathPatterns(val) {
					paths = append(paths, p)
				}
			}
			continue
		}
		// YAML list continuation: "  - src/**"
		if inPaths && (strings.HasPrefix(line, "  ") || strings.HasPrefix(line, "\t")) {
			val := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
			if val != "" {
				paths = append(paths, val)
			}
			continue
		}
		inPaths = false
	}
	return paths
}

// splitPathPatterns splits a paths value on commas, semicolons, and newlines.
func splitPathPatterns(val string) []string {
	val = strings.ReplaceAll(val, ";", ",")
	parts := strings.Split(val, ",")
	var result []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" && p != "**" {
			result = append(result, p)
		}
	}
	return result
}

// blockCommentRe matches HTML block comments <!-- ... --> (including multiline).
var blockCommentRe = regexp.MustCompile(`(?s)<!--.*?-->`)

// codeFenceRe matches markdown code fence boundaries (``` or ~~~).
var codeFenceRe = regexp.MustCompile("(?m)^(```|~~~)")

// stripBlockComments removes HTML block comments from markdown content,
// but preserves comments inside code blocks (fenced with ``` or ~~~).
func stripBlockComments(content string) string {
	// Split on code fence boundaries
	fenceIndices := codeFenceRe.FindAllStringIndex(content, -1)
	if len(fenceIndices) == 0 {
		// No code blocks — strip all comments
		return blockCommentRe.ReplaceAllString(content, "")
	}

	// Build list of code block ranges (pairs of fence positions)
	type codeRange struct{ start, end int }
	var codeRanges []codeRange
	for i := 0; i+1 < len(fenceIndices); i += 2 {
		codeRanges = append(codeRanges, codeRange{
			start: fenceIndices[i][0],
			end:   fenceIndices[i+1][1],
		})
	}

	// Replace comments only if they're outside all code blocks.
	// Use FindAllStringIndex to get exact positions instead of strings.Index
	// (which always returns the first occurrence and breaks on duplicate comments).
	commentIndices := blockCommentRe.FindAllStringIndex(content, -1)
	if len(commentIndices) == 0 {
		return content
	}

	var result strings.Builder
	lastEnd := 0
	for _, idx := range commentIndices {
		start, end := idx[0], idx[1]
		// Check if this comment is inside a code block
		insideCode := false
		for _, cr := range codeRanges {
			if start >= cr.start && start < cr.end {
				insideCode = true
				break
			}
		}
		result.WriteString(content[lastEnd:start])
		if insideCode {
			result.WriteString(content[start:end]) // Preserve
		}
		// else: strip (don't write the comment)
		lastEnd = end
	}
	result.WriteString(content[lastEnd:])
	return result.String()
}

// directoryChainToRoot returns the chain of directories from dir up to the root.
// E.g., "/home/user/project/src" → ["/home/user/project/src", "/home/user/project", "/home/user", "/home", "/"]
func directoryChainToRoot(dir string) []string {
	dir = filepath.Clean(dir)
	var chain []string
	for {
		chain = append(chain, dir)
		parent := filepath.Dir(dir)
		if parent == dir {
			break // Reached root
		}
		dir = parent
	}
	return chain
}
