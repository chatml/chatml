// Package prompt handles system prompt construction for the native Go agentic loop.
// It loads CLAUDE.md files, memory, and environment context to build the complete
// system prompt that gives the LLM awareness of the project and workspace.
package prompt

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const maxClaudeMDChars = 40_000

// ClaudeMDEntry represents a loaded CLAUDE.md file with its source path and content.
type ClaudeMDEntry struct {
	Path     string // Source file path
	Content  string // File content (after processing)
	Priority int    // Higher = loaded later = higher priority
}

// LoadClaudeMD discovers and loads all CLAUDE.md files for the given workspace.
// Search order (lowest to highest priority):
//  1. ~/.claude/CLAUDE.md (user-level global)
//  2. CLAUDE.md files walking UP from workdir to root (parent dirs = lower priority)
//  3. .claude/CLAUDE.md in each directory
//  4. .claude/rules/*.md in each directory
//  5. CLAUDE.local.md in workdir (highest priority, project-local)
func LoadClaudeMD(workdir string) []ClaudeMDEntry {
	var entries []ClaudeMDEntry
	priority := 0

	// 1. User-level global: ~/.claude/CLAUDE.md
	if home, err := os.UserHomeDir(); err == nil {
		userMD := filepath.Join(home, ".claude", "CLAUDE.md")
		if content, err := readClaudeMDFile(userMD); err == nil {
			entries = append(entries, ClaudeMDEntry{Path: userMD, Content: content, Priority: priority})
			priority++
		}
	}

	// 2-4. Walk directory tree upward from workdir to root
	dirs := directoryChainToRoot(workdir)
	// Reverse so root is processed first (lowest priority)
	for i := len(dirs) - 1; i >= 0; i-- {
		dir := dirs[i]

		// CLAUDE.md in this directory
		mdPath := filepath.Join(dir, "CLAUDE.md")
		if content, err := readClaudeMDFile(mdPath); err == nil {
			entries = append(entries, ClaudeMDEntry{Path: mdPath, Content: content, Priority: priority})
			priority++
		}

		// .claude/CLAUDE.md
		dotClaudeMD := filepath.Join(dir, ".claude", "CLAUDE.md")
		if content, err := readClaudeMDFile(dotClaudeMD); err == nil {
			entries = append(entries, ClaudeMDEntry{Path: dotClaudeMD, Content: content, Priority: priority})
			priority++
		}

		// .claude/rules/*.md
		rulesDir := filepath.Join(dir, ".claude", "rules")
		if ruleFiles, err := filepath.Glob(filepath.Join(rulesDir, "*.md")); err == nil {
			sort.Strings(ruleFiles) // Deterministic order
			for _, rf := range ruleFiles {
				if content, err := readClaudeMDFile(rf); err == nil {
					entries = append(entries, ClaudeMDEntry{Path: rf, Content: content, Priority: priority})
					priority++
				}
			}
		}
	}

	// 5. CLAUDE.local.md (highest priority — project-local, not committed)
	localMD := filepath.Join(workdir, "CLAUDE.local.md")
	if content, err := readClaudeMDFile(localMD); err == nil {
		entries = append(entries, ClaudeMDEntry{Path: localMD, Content: content, Priority: priority})
	}

	return entries
}

// MergeClaudeMD combines all loaded entries into a single string, respecting
// the character limit. Higher-priority entries are kept if truncation is needed.
func MergeClaudeMD(entries []ClaudeMDEntry) string {
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
		content := e.Content
		if totalLen+len(content) > maxClaudeMDChars {
			remaining := maxClaudeMDChars - totalLen
			if remaining > 100 {
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

// readClaudeMDFile reads a file, strips block HTML comments, and trims whitespace.
func readClaudeMDFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	content := string(data)
	content = stripBlockComments(content)
	content = strings.TrimSpace(content)
	if content == "" {
		return "", os.ErrNotExist // Treat empty files as non-existent
	}
	return content, nil
}

// blockCommentRe matches HTML block comments <!-- ... --> (including multiline).
var blockCommentRe = regexp.MustCompile(`(?s)<!--.*?-->`)

// stripBlockComments removes HTML block comments from markdown content.
func stripBlockComments(content string) string {
	return blockCommentRe.ReplaceAllString(content, "")
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
