package main

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// renderEditDiff produces a colored unified-diff-style view of an Edit operation.
// Returns lines ready for display, using diffAdd/diffDel/toolLine styles.
func renderEditDiff(oldStr, newStr, filePath, workdir string, s *styles, maxLines int) []string {
	if maxLines <= 0 {
		maxLines = maxDiffLines
	}

	oldLines := splitLines(oldStr)
	newLines := splitLines(newStr)

	// Compute line-level diff, then detect word-level modifications
	diff := computeLineDiff(oldLines, newLines)
	detectModifications(diff)

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

		switch d.op {
		case diffOpAdd:
			if len(d.segments) > 0 {
				lines = append(lines, renderWordDiffLine("    │ + ", d.segments, s.diffAdd, s.diffAddHL))
			} else {
				line := d.text
				if len(line) > maxSummaryWidth {
					line = line[:maxSummaryWidth-3] + "..."
				}
				lines = append(lines, s.diffAdd.Render(fmt.Sprintf("    │ + %s", line)))
			}
		case diffOpDel:
			if len(d.segments) > 0 {
				lines = append(lines, renderWordDiffLine("    │ - ", d.segments, s.diffDel, s.diffDelHL))
			} else {
				line := d.text
				if len(line) > maxSummaryWidth {
					line = line[:maxSummaryWidth-3] + "..."
				}
				lines = append(lines, s.diffDel.Render(fmt.Sprintf("    │ - %s", line)))
			}
		case diffOpContext:
			line := d.text
			if len(line) > maxSummaryWidth {
				line = line[:maxSummaryWidth-3] + "..."
			}
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
	op       diffOp
	text     string
	segments []wordSegment // non-nil for word-level highlighted lines (modified pairs)
}

// wordSegment represents a portion of a line in a word-level diff.
type wordSegment struct {
	text    string
	changed bool // true if this segment was modified
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

// detectModifications scans a diff for consecutive del+add runs that represent
// line modifications. For each run, it pairs deletions with additions positionally
// (del[0]↔add[0], del[1]↔add[1], etc.) and computes word-level diffs for
// sufficiently similar pairs.
func detectModifications(diff []diffLine) {
	i := 0
	for i < len(diff) {
		// Find consecutive del run
		delStart := i
		for i < len(diff) && diff[i].op == diffOpDel {
			i++
		}
		delEnd := i

		// Find consecutive add run immediately after
		addStart := i
		for i < len(diff) && diff[i].op == diffOpAdd {
			i++
		}
		addEnd := i

		// Pair deletions with additions positionally
		pairs := min(delEnd-delStart, addEnd-addStart)
		for j := 0; j < pairs; j++ {
			di := delStart + j
			ai := addStart + j
			if lineSimilarity(diff[di].text, diff[ai].text) >= 0.5 {
				oldSegs, newSegs := computeWordDiff(diff[di].text, diff[ai].text)
				diff[di].segments = oldSegs
				diff[ai].segments = newSegs
			}
		}

		// If we didn't advance (hit a context line), skip it
		if i == delStart {
			i++
		}
	}
}

// lineSimilarity returns 0.0–1.0 indicating how similar two lines are,
// based on the fraction of characters shared in common prefix + suffix.
func lineSimilarity(a, b string) float64 {
	ar, br := []rune(a), []rune(b)
	maxLen := max(len(ar), len(br))
	if maxLen == 0 {
		return 1.0
	}
	prefixLen := 0
	minLen := min(len(ar), len(br))
	for prefixLen < minLen && ar[prefixLen] == br[prefixLen] {
		prefixLen++
	}
	suffixLen := 0
	for suffixLen < minLen-prefixLen && ar[len(ar)-1-suffixLen] == br[len(br)-1-suffixLen] {
		suffixLen++
	}
	return float64(prefixLen+suffixLen) / float64(maxLen)
}

// computeWordDiff finds the common prefix and suffix between two similar lines,
// returning segments with change markers for the differing middle portion.
func computeWordDiff(oldLine, newLine string) (oldSegs, newSegs []wordSegment) {
	oldRunes := []rune(oldLine)
	newRunes := []rune(newLine)

	// Find common prefix
	prefixLen := 0
	minLen := min(len(oldRunes), len(newRunes))
	for prefixLen < minLen && oldRunes[prefixLen] == newRunes[prefixLen] {
		prefixLen++
	}

	// Find common suffix (not overlapping with prefix)
	suffixLen := 0
	for suffixLen < minLen-prefixLen &&
		oldRunes[len(oldRunes)-1-suffixLen] == newRunes[len(newRunes)-1-suffixLen] {
		suffixLen++
	}

	prefix := string(oldRunes[:prefixLen])
	oldMiddle := string(oldRunes[prefixLen : len(oldRunes)-suffixLen])
	newMiddle := string(newRunes[prefixLen : len(newRunes)-suffixLen])
	suffix := ""
	if suffixLen > 0 {
		suffix = string(oldRunes[len(oldRunes)-suffixLen:])
	}

	oldSegs = buildWordSegments(prefix, oldMiddle, suffix)
	newSegs = buildWordSegments(prefix, newMiddle, suffix)
	return
}

// buildWordSegments constructs a slice of word segments from prefix/middle/suffix.
func buildWordSegments(prefix, middle, suffix string) []wordSegment {
	var segs []wordSegment
	if prefix != "" {
		segs = append(segs, wordSegment{text: prefix, changed: false})
	}
	if middle != "" {
		segs = append(segs, wordSegment{text: middle, changed: true})
	}
	if suffix != "" {
		segs = append(segs, wordSegment{text: suffix, changed: false})
	}
	return segs
}

// renderWordDiffLine renders a line with word-level highlighting.
// The gutter (prefix like "    │ + ") uses the base style, while content segments
// alternate between base and highlight styles for changed portions.
// Segments are truncated to maxSummaryWidth to prevent wrapping on narrow terminals.
func renderWordDiffLine(gutter string, segs []wordSegment, baseStyle, hlStyle lipgloss.Style) string {
	var b strings.Builder
	b.WriteString(baseStyle.Render(gutter))
	remaining := maxSummaryWidth - len([]rune(gutter)) // subtract gutter width from content budget
	for _, seg := range segs {
		text := seg.text
		runes := []rune(text)
		if len(runes) > remaining {
			if remaining > 3 {
				text = string(runes[:remaining-3]) + "..."
			} else {
				// Always show ellipsis for visual truncation clarity, even if slightly over budget
				text = "..."
			}
			if seg.changed {
				b.WriteString(hlStyle.Render(text))
			} else {
				b.WriteString(baseStyle.Render(text))
			}
			break
		}
		remaining -= len(runes)
		if seg.changed {
			b.WriteString(hlStyle.Render(text))
		} else {
			b.WriteString(baseStyle.Render(text))
		}
	}
	return b.String()
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
