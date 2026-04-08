package main

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

// renderFileTree renders a list of file paths as an indented tree structure.
// Paths are made relative to workdir when possible.
func renderFileTree(paths []string, workdir string, s *styles, maxLines int) []string {
	if len(paths) == 0 {
		return nil
	}
	if maxLines <= 0 {
		maxLines = maxTreeLines
	}

	// Collapse single-child directory chains for more compact display.
	// e.g., "src/components/ui/" becomes one node instead of three.
	root := &treeNode{name: ".", children: make(map[string]*treeNode)}

	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		// Make relative to workdir when possible
		p = displayPath(p, workdir)
		parts := strings.Split(filepath.ToSlash(p), "/")
		insertPath(root, parts)
	}

	// Render the tree
	var lines []string
	renderNode(root, "", true, &lines, s, 0, 4)

	// Truncate
	if len(lines) > maxLines {
		lines = lines[:maxLines]
		lines = append(lines, s.gray.Render(fmt.Sprintf("    │ ... %d more entries", len(paths)-maxLines)))
	}

	return lines
}

type treeNode struct {
	name     string
	children map[string]*treeNode
	isFile   bool
	order    []string // preserve insertion order
}

func insertPath(root *treeNode, parts []string) {
	node := root
	for i, part := range parts {
		if part == "" {
			continue
		}
		child, exists := node.children[part]
		if !exists {
			child = &treeNode{name: part, children: make(map[string]*treeNode)}
			node.children[part] = child
			node.order = append(node.order, part)
		}
		if i == len(parts)-1 {
			child.isFile = true
		}
		node = child
	}
}

func renderNode(node *treeNode, prefix string, isRoot bool, lines *[]string, s *styles, depth, maxDepth int) {
	if !isRoot && depth > maxDepth {
		*lines = append(*lines, s.gray.Render(prefix+"..."))
		return
	}

	// Sort children: directories first, then files, both alphabetical
	sorted := make([]string, len(node.order))
	copy(sorted, node.order)
	sort.Slice(sorted, func(i, j int) bool {
		ci := node.children[sorted[i]]
		cj := node.children[sorted[j]]
		// Directories before files
		if !ci.isFile && cj.isFile {
			return true
		}
		if ci.isFile && !cj.isFile {
			return false
		}
		return sorted[i] < sorted[j]
	})

	for i, name := range sorted {
		child := node.children[name]
		isLast := i == len(sorted)-1

		// Choose connector
		connector := "├── "
		childPrefix := "│   "
		if isLast {
			connector = "└── "
			childPrefix = "    "
		}

		// Render this node
		displayName := name
		if len(child.children) > 0 && !child.isFile {
			displayName += "/"
		}

		line := s.toolLine.Render("    │ " + prefix + connector + displayName)
		*lines = append(*lines, line)

		// Recurse into children
		if len(child.children) > 0 {
			renderNode(child, prefix+childPrefix, false, lines, s, depth+1, maxDepth)
		}
	}
}

// renderGrepGrouped renders grep output as grouped-by-file results.
// Handles two formats:
//   - "file:line:content" (content mode) → grouped by file with line numbers
//   - plain file paths (files_with_matches mode) → file tree
//
// Uses a two-pass approach: first detects the output format, then parses accordingly.
// This prevents mixed-mode confusion where some lines match content format and others don't.
func renderGrepGrouped(summary, workdir string, s *styles, maxLines int) []string {
	if maxLines <= 0 {
		maxLines = maxTreeLines
	}

	rawLines := strings.Split(strings.TrimSpace(summary), "\n")
	if len(rawLines) == 0 {
		return nil
	}

	// Pass 1: detect format by checking if any line matches "file:line:content"
	isContentMode := false
	for _, line := range rawLines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if looksLikeGrepContent(line) {
			isContentMode = true
			break
		}
	}

	// Not content mode (just file paths) → render as file tree
	if !isContentMode {
		paths := make([]string, 0, len(rawLines))
		for _, line := range rawLines {
			line = strings.TrimSpace(line)
			if line != "" {
				paths = append(paths, line)
			}
		}
		return renderFileTree(paths, workdir, s, maxLines)
	}

	// Pass 2: parse content mode lines ("file:line:content").
	// NOTE: Splitting on ":" assumes Unix-style paths. Windows drive-letter paths
	// (e.g., "C:\foo:42:content") would mis-split, but those fail the isDigits check
	// gracefully, falling back to file-tree rendering.
	type grepMatch struct {
		lineNum string
		content string
	}
	fileMatches := make(map[string][]grepMatch)
	var fileOrder []string

	for _, line := range rawLines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		firstColon := strings.Index(line, ":")
		if firstColon <= 0 {
			continue // skip non-matching lines in content mode
		}
		rest := line[firstColon+1:]
		secondColon := strings.Index(rest, ":")
		if secondColon <= 0 {
			continue
		}
		lineNum := rest[:secondColon]
		if !isDigits(lineNum) {
			continue
		}

		filePath := line[:firstColon]
		content := rest[secondColon+1:]
		dp := displayPath(filePath, workdir)
		if _, exists := fileMatches[dp]; !exists {
			fileOrder = append(fileOrder, dp)
		}
		fileMatches[dp] = append(fileMatches[dp], grepMatch{
			lineNum: lineNum,
			content: strings.TrimSpace(content),
		})
	}

	// Render grouped by file
	var lines []string
	totalFiles := len(fileOrder)
	for fi, file := range fileOrder {
		if len(lines) >= maxLines {
			remaining := totalFiles - fi
			lines = append(lines, s.gray.Render(fmt.Sprintf("    │ ... %d more files", remaining)))
			break
		}

		matches := fileMatches[file]
		matchCount := fmt.Sprintf("(%d)", len(matches))
		lines = append(lines, s.toolLine.Render("    │ ")+s.toolHeader.Render(file)+s.gray.Render(" "+matchCount))

		shown := 0
		for _, m := range matches {
			if len(lines) >= maxLines {
				break
			}
			lineContent := m.content
			runes := []rune(lineContent)
			if len(runes) > maxSummaryWidth-10 {
				lineContent = string(runes[:maxSummaryWidth-13]) + "..."
			}
			lines = append(lines, s.toolLine.Render(fmt.Sprintf("    │   %s: ", m.lineNum))+s.gray.Render(lineContent))
			shown++
		}
		// If we truncated mid-file, hint how many matches were hidden
		if shown < len(matches) {
			lines = append(lines, s.gray.Render(fmt.Sprintf("    │   ... %d more matches", len(matches)-shown)))
		}
	}

	return lines
}

// looksLikeGrepContent returns true if a line matches "file:linenum:content" format.
func looksLikeGrepContent(line string) bool {
	firstColon := strings.Index(line, ":")
	if firstColon <= 0 {
		return false
	}
	rest := line[firstColon+1:]
	secondColon := strings.Index(rest, ":")
	if secondColon <= 0 {
		return false
	}
	return isDigits(rest[:secondColon])
}

// isDigits returns true if s is a non-empty string of ASCII digits.
func isDigits(s string) bool {
	if len(s) == 0 {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
