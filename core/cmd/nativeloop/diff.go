package main

import (
	"fmt"
	"strings"
)

// renderEditDiff produces a colored unified-diff-style view of an Edit operation.
// Returns lines ready for display, using diffAdd/diffDel/toolLine styles.
func renderEditDiff(oldStr, newStr, filePath, workdir string, s *styles, maxLines int) []string {
	if maxLines <= 0 {
		maxLines = maxDiffLines
	}

	oldLines := splitLines(oldStr)
	newLines := splitLines(newStr)

	// Compute line-level diff
	diff := computeLineDiff(oldLines, newLines)

	var lines []string

	// File header — relative to workdir when inside it, full path otherwise
	dp := displayPath(filePath, workdir)
	lines = append(lines, s.toolLine.Render(fmt.Sprintf("    │ --- a/%s", dp)))
	lines = append(lines, s.toolLine.Render(fmt.Sprintf("    │ +++ b/%s", dp)))

	// Diff lines
	count := 0
	for _, d := range diff {
		if count >= maxLines {
			remaining := len(diff) - count
			if remaining > 0 {
				lines = append(lines, s.gray.Render(fmt.Sprintf("    │ ... %d more lines", remaining)))
			}
			break
		}

		line := d.text
		if len(line) > maxSummaryWidth {
			line = line[:maxSummaryWidth-3] + "..."
		}

		switch d.op {
		case diffOpAdd:
			lines = append(lines, s.diffAdd.Render(fmt.Sprintf("    │ + %s", line)))
		case diffOpDel:
			lines = append(lines, s.diffDel.Render(fmt.Sprintf("    │ - %s", line)))
		case diffOpContext:
			lines = append(lines, s.toolLine.Render(fmt.Sprintf("    │   %s", line)))
		}
		count++
	}

	return lines
}

// diffOp represents the type of a diff line.
type diffOp int

const (
	diffOpContext diffOp = iota
	diffOpAdd
	diffOpDel
)

// diffLine is a single line in a diff.
type diffLine struct {
	op   diffOp
	text string
}

// computeLineDiff produces a simple line-level diff between old and new.
// Uses a basic longest common subsequence (LCS) approach for small inputs,
// falling back to a simple "all deleted / all added" for large diffs.
func computeLineDiff(oldLines, newLines []string) []diffLine {
	// For very large diffs, skip LCS (too expensive) and show all del + all add
	if len(oldLines)*len(newLines) > 10000 {
		return simpleDiff(oldLines, newLines)
	}

	// LCS-based diff
	m, n := len(oldLines), len(newLines)

	// Build LCS table
	lcs := make([][]int, m+1)
	for i := range lcs {
		lcs[i] = make([]int, n+1)
	}
	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if oldLines[i-1] == newLines[j-1] {
				lcs[i][j] = lcs[i-1][j-1] + 1
			} else if lcs[i-1][j] > lcs[i][j-1] {
				lcs[i][j] = lcs[i-1][j]
			} else {
				lcs[i][j] = lcs[i][j-1]
			}
		}
	}

	// Backtrack to produce diff
	var result []diffLine
	i, j := m, n
	for i > 0 || j > 0 {
		if i > 0 && j > 0 && oldLines[i-1] == newLines[j-1] {
			result = append(result, diffLine{op: diffOpContext, text: oldLines[i-1]})
			i--
			j--
		} else if j > 0 && (i == 0 || lcs[i][j-1] >= lcs[i-1][j]) {
			result = append(result, diffLine{op: diffOpAdd, text: newLines[j-1]})
			j--
		} else {
			result = append(result, diffLine{op: diffOpDel, text: oldLines[i-1]})
			i--
		}
	}

	// Reverse (backtracking produces reversed output)
	for left, right := 0, len(result)-1; left < right; left, right = left+1, right-1 {
		result[left], result[right] = result[right], result[left]
	}

	// Trim leading/trailing context to show only relevant lines
	return trimContext(result, 2)
}

// simpleDiff shows all old lines as deletions and all new lines as additions.
func simpleDiff(oldLines, newLines []string) []diffLine {
	var result []diffLine
	for _, line := range oldLines {
		result = append(result, diffLine{op: diffOpDel, text: line})
	}
	for _, line := range newLines {
		result = append(result, diffLine{op: diffOpAdd, text: line})
	}
	return result
}

// trimContext removes context lines far from changes, keeping N lines of context.
func trimContext(diff []diffLine, contextLines int) []diffLine {
	if len(diff) == 0 {
		return diff
	}

	// Mark which lines are within contextLines of a change
	keep := make([]bool, len(diff))
	for i, d := range diff {
		if d.op != diffOpContext {
			// Mark surrounding context lines
			for j := max(0, i-contextLines); j <= min(len(diff)-1, i+contextLines); j++ {
				keep[j] = true
			}
		}
	}

	var result []diffLine
	skipping := false
	for i, d := range diff {
		if keep[i] {
			skipping = false
			result = append(result, d)
		} else if !skipping {
			skipping = true
			// Don't add separator for trimmed context
		}
	}

	return result
}

func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	lines := strings.Split(s, "\n")
	// Remove trailing empty line from trailing newline
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// Go 1.21+ builtins min/max are used directly — removed package-level wrappers.
