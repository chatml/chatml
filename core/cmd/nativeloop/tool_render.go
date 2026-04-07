package main

import (
	"fmt"
	"strings"
)

// toolRenderer defines per-tool rendering functions.
type toolRenderer struct {
	// extractParams returns the display string for the tool header (e.g. file path, command)
	extractParams func(params map[string]interface{}, workdir string) string
	// buildDetails returns detail lines shown below the tool header
	buildDetails func(params map[string]interface{}, s *styles, workdir string) []string
	// enrichSummary transforms the raw tool summary into a richer display string
	enrichSummary func(summary string, params map[string]interface{}) string
}

// toolRenderers maps tool names to their renderers.
var toolRenderers = map[string]toolRenderer{
	"Read":         {readExtractParams, readBuildDetails, readEnrichSummary},
	"Write":        {writeExtractParams, nil, writeEnrichSummary},
	"Edit":         {editExtractParams, editBuildDetails, nil},
	"Bash":         {bashExtractParams, bashBuildDetails, bashEnrichSummary},
	"Glob":         {globExtractParams, nil, nil},
	"Grep":         {grepExtractParams, nil, grepEnrichSummary},
	"WebFetch":     {webFetchExtractParams, nil, webFetchEnrichSummary},
	"WebSearch":    {webSearchExtractParams, nil, webSearchEnrichSummary},
	"NotebookEdit": {notebookExtractParams, notebookBuildDetails, nil},
	"Agent":        {agentExtractParams, nil, nil},
}

// ── Read ────────────────────────────────────────────────────────────────────

func readExtractParams(params map[string]interface{}, workdir string) string {
	if fp, ok := params["file_path"]; ok {
		return displayPath(fmt.Sprintf("%v", fp), workdir)
	}
	return ""
}

func readBuildDetails(_ map[string]interface{}, _ *styles, _ string) []string {
	// No extra details — metadata shown in enriched summary
	return nil
}

func readEnrichSummary(summary string, params map[string]interface{}) string {
	var parts []string
	lines := countLines(summary)
	if lines > 0 {
		parts = append(parts, fmt.Sprintf("%d lines", lines))
	}
	if fp, ok := params["file_path"]; ok {
		lang := detectLanguageFromPath(fmt.Sprintf("%v", fp))
		if lang != "" {
			parts = append(parts, lang)
		}
	}
	if len(parts) > 0 {
		return strings.Join(parts, " · ")
	}
	return "read"
}

// ── Write ───────────────────────────────────────────────────────────────────

func writeExtractParams(params map[string]interface{}, workdir string) string {
	if fp, ok := params["file_path"]; ok {
		return displayPath(fmt.Sprintf("%v", fp), workdir)
	}
	return ""
}

func writeEnrichSummary(summary string, _ map[string]interface{}) string {
	lines := countLines(summary)
	if lines > 0 {
		return fmt.Sprintf("Wrote %d lines", lines)
	}
	return "file written"
}

// ── Edit ────────────────────────────────────────────────────────────────────

func editExtractParams(params map[string]interface{}, workdir string) string {
	if fp, ok := params["file_path"]; ok {
		return displayPath(fmt.Sprintf("%v", fp), workdir)
	}
	return ""
}

func editBuildDetails(params map[string]interface{}, s *styles, workdir string) []string {
	oldStr := fmt.Sprintf("%v", params["old_string"])
	newStr := fmt.Sprintf("%v", params["new_string"])
	filePath := ""
	if fp, ok := params["file_path"]; ok {
		filePath = fmt.Sprintf("%v", fp)
	}
	if oldStr == "<nil>" && newStr == "<nil>" {
		return nil
	}
	if oldStr == "<nil>" {
		oldStr = ""
	}
	if newStr == "<nil>" {
		newStr = ""
	}

	var details []string
	diffLines := renderEditDiff(oldStr, newStr, filePath, workdir, s, maxDiffLines)
	details = append(details, diffLines...)

	// Add line change summary after diff
	joined := strings.Join(diffLines, "\n")
	added := strings.Count(joined, "│ + ")
	removed := strings.Count(joined, "│ - ")
	if added > 0 || removed > 0 {
		var parts []string
		if added > 0 {
			parts = append(parts, s.diffAdd.Render(fmt.Sprintf("+%d", added)))
		}
		if removed > 0 {
			parts = append(parts, s.diffDel.Render(fmt.Sprintf("-%d", removed)))
		}
		details = append(details, s.toolLine.Render("    │ ")+strings.Join(parts, " "))
	}
	return details
}

// ── Bash ────────────────────────────────────────────────────────────────────

func bashExtractParams(params map[string]interface{}, _ string) string {
	if cmd, ok := params["command"]; ok {
		s := fmt.Sprintf("%v", cmd)
		// Take first line only for header
		if idx := strings.IndexByte(s, '\n'); idx >= 0 {
			s = s[:idx]
		}
		return s
	}
	return ""
}

func bashBuildDetails(params map[string]interface{}, s *styles, _ string) []string {
	cmd, ok := params["command"]
	if !ok {
		return nil
	}
	cmdStr := fmt.Sprintf("%v", cmd)
	var details []string
	lines := strings.SplitN(cmdStr, "\n", bashPreviewLines+1)
	for i, line := range lines {
		if i >= bashPreviewLines {
			details = append(details, s.toolLine.Render("    │ ..."))
			break
		}
		details = append(details, s.cmd.Render(fmt.Sprintf("    │ $ %s", line)))
	}
	return details
}

func bashEnrichSummary(summary string, _ map[string]interface{}) string {
	first := summary
	if idx := strings.IndexByte(first, '\n'); idx >= 0 {
		first = first[:idx]
	}
	if len(first) > maxSummaryWidth {
		first = first[:maxSummaryWidth-3] + "..."
	}
	if first == "" {
		first = "done"
	}
	return first
}

// ── Glob ────────────────────────────────────────────────────────────────────

func globExtractParams(params map[string]interface{}, workdir string) string {
	var parts []string
	if p, ok := params["pattern"]; ok {
		parts = append(parts, fmt.Sprintf(`pattern: "%v"`, p))
	}
	if p, ok := params["path"]; ok && fmt.Sprintf("%v", p) != "" {
		parts = append(parts, fmt.Sprintf(`path: "%s"`, displayPath(fmt.Sprintf("%v", p), workdir)))
	}
	return strings.Join(parts, ", ")
}

// ── Grep ────────────────────────────────────────────────────────────────────

func grepExtractParams(params map[string]interface{}, workdir string) string {
	var parts []string
	if p, ok := params["pattern"]; ok {
		parts = append(parts, fmt.Sprintf(`pattern: "%v"`, p))
	}
	if p, ok := params["path"]; ok && fmt.Sprintf("%v", p) != "" {
		parts = append(parts, fmt.Sprintf(`path: "%s"`, displayPath(fmt.Sprintf("%v", p), workdir)))
	}
	return strings.Join(parts, ", ")
}

func grepEnrichSummary(summary string, _ map[string]interface{}) string {
	lines := strings.Split(strings.TrimSpace(summary), "\n")
	fileSet := make(map[string]bool)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.Contains(line, "/") || strings.Contains(line, ".") {
			if idx := strings.Index(line, ":"); idx > 0 {
				fileSet[line[:idx]] = true
			} else {
				fileSet[line] = true
			}
		}
	}
	total := len(lines)
	files := len(fileSet)
	if files > 0 {
		return fmt.Sprintf("%d matches in %d files", total, files)
	}
	if total > 0 {
		return fmt.Sprintf("%d matches", total)
	}
	return summary
}

// ── WebFetch ────────────────────────────────────────────────────────────────

func webFetchExtractParams(params map[string]interface{}, _ string) string {
	if u, ok := params["url"]; ok {
		return fmt.Sprintf("%v", u)
	}
	return ""
}

func webFetchEnrichSummary(summary string, _ map[string]interface{}) string {
	size := formatFileSize(len(summary))
	return fmt.Sprintf("Received %s", size)
}

// ── WebSearch ───────────────────────────────────────────────────────────────

func webSearchExtractParams(params map[string]interface{}, _ string) string {
	if q, ok := params["query"]; ok {
		return fmt.Sprintf(`"%v"`, q)
	}
	return ""
}

func webSearchEnrichSummary(summary string, _ map[string]interface{}) string {
	resultCount := countLines(summary)
	if resultCount > 0 {
		return fmt.Sprintf("Found %d results", resultCount)
	}
	return summary
}

// ── NotebookEdit ────────────────────────────────────────────────────────────

func notebookExtractParams(params map[string]interface{}, workdir string) string {
	if fp, ok := params["file_path"]; ok {
		return displayPath(fmt.Sprintf("%v", fp), workdir)
	}
	return ""
}

func notebookBuildDetails(params map[string]interface{}, s *styles, _ string) []string {
	cellID := ""
	cellType := ""
	editMode := "replace"
	if v, ok := params["cell_id"]; ok {
		cellID = fmt.Sprintf("%v", v)
	}
	if v, ok := params["cell_type"]; ok {
		cellType = fmt.Sprintf("%v", v)
	}
	if v, ok := params["edit_mode"]; ok {
		editMode = fmt.Sprintf("%v", v)
	}
	if cellID == "" {
		return nil
	}
	info := fmt.Sprintf("    │ %s cell %s", editMode, cellID)
	if cellType != "" {
		info += fmt.Sprintf(" (%s)", cellType)
	}
	return []string{s.toolLine.Render(info)}
}

// ── Agent ───────────────────────────────────────────────────────────────────

func agentExtractParams(params map[string]interface{}, _ string) string {
	if d, ok := params["description"]; ok {
		return fmt.Sprintf("%v", d)
	}
	if d, ok := params["prompt"]; ok {
		s := fmt.Sprintf("%v", d)
		if len(s) > maxHeaderWidth {
			s = s[:maxHeaderWidth-3] + "..."
		}
		return s
	}
	return ""
}
