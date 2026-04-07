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
