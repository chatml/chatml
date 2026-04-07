package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/chatml/chatml-core/agent"
	"github.com/charmbracelet/glamour"
)

// ── Message types ───────────────────────────────────────────────────────────

type messageKind int

const (
	msgUser messageKind = iota
	msgAssistant
	msgTool        // merged tool start+end (completed)
	msgToolRunning // tool currently executing (no end yet)
	msgThinking
	msgSystem
	msgError
	msgApproval
	msgQuestion
	msgPlanReview
)

// agentToolCall records a completed inner tool call from a sub-agent.
type agentToolCall struct {
	tool     string
	params   string
	summary  string
	success  bool
	duration time.Duration
}

// agentProgress tracks a running sub-agent's inner activity.
type agentProgress struct {
	agentID      string
	toolCalls    []agentToolCall // All completed inner tool calls
	runningTool  string          // Currently executing tool name (empty = idle)
	runningParam string          // Params of the running tool
	toolCount    int             // Total completed tool calls
	tokenCount   int             // Accumulated tokens
}

// displayMessage represents a single renderable message in the viewport.
type displayMessage struct {
	kind      messageKind
	content   string    // assistant text, or error text
	tool      string    // tool name
	params    string    // tool params (file_path, command, etc.)
	summary   string    // tool result summary
	success   bool
	duration  time.Duration
	expanded  bool
	timestamp time.Time

	// For tool details (Bash command lines, Edit diffs)
	details []string

	// For collapsible results
	fullContent string // Full untruncated tool output
	lineCount   int    // Total line count of tool output
	collapsed   bool   // Whether this tool result is collapsed

	// For sub-agent progress tracking
	agentProg *agentProgress

	// For questions
	options  []agent.UserQuestionOption
	question string

	// Streaming state
	streaming       bool   // true while tokens are arriving
	lastRenderTime  time.Time // last time glamour rendered this message
	lastRenderedMD  string    // cached glamour output for throttled streaming
}

// ── Rendering ───────────────────────────────────────────────────────────────

// renderMessages renders all messages to a single string.
// NOTE: This is unused since the Println-based scrollback architecture was adopted.
// Kept for potential fallback / debugging. All production rendering goes through
// renderSingleMessage in mdcache.go.
func renderMessages(msgs []displayMessage, width int, s *styles, mdRenderer *glamour.TermRenderer, verbose bool) string { //nolint:unused
	var b strings.Builder

	for i, msg := range msgs {
		// Skip TodoWrite tool messages entirely
		if (msg.kind == msgTool || msg.kind == msgToolRunning) && msg.tool == "TodoWrite" {
			continue
		}

		// Simple spacing: blank line between every message (except the first)
		if i > 0 {
			b.WriteString("\n")
		}

		switch msg.kind {
		case msgUser:
			b.WriteString(s.userMsg.Render("  ❯ "+msg.content) + "\n")

		case msgAssistant:
			// Render markdown content via glamour (which handles syntax highlighting internally)
			content := msg.content
			if mdRenderer != nil && len(content) > 0 {
				rendered, err := mdRenderer.Render(content)
				if err == nil {
					content = strings.TrimLeft(rendered, "\n \t")
					content = strings.TrimRight(content, "\n")
				}
			}
			// Simple bullet prefix — no lipgloss styling on bullet to avoid ANSI width issues
			b.WriteString("● " + content + "\n")

		case msgTool:
			renderToolMessage(&b, s, &msg, verbose)

		case msgToolRunning:
			renderToolRunningMessage(&b, s, &msg)

		case msgThinking:
			renderThinkingMessage(&b, s, &msg, verbose)

		case msgSystem:
			b.WriteString(s.gray.Render("  "+msg.content) + "\n")

		case msgError:
			b.WriteString(s.toolFail.Render("  ✗ Error: "+msg.content) + "\n")

		case msgApproval:
			renderApprovalMessage(&b, s, &msg)

		case msgQuestion:
			renderQuestionMessage(&b, s, &msg)

		case msgPlanReview:
			renderPlanReviewMessage(&b, s, &msg, mdRenderer)
		}
	}

	return b.String()
}

// renderToolMessage renders a completed tool call (collapsed or expanded).
func renderToolMessage(b *strings.Builder, s *styles, msg *displayMessage, verbose bool) {
	// TodoWrite is hidden
	if msg.tool == "TodoWrite" {
		return
	}

	// Header
	header := formatToolHeader(msg.tool, msg.params)
	if header != "" {
		b.WriteString(s.toolHeader.Render(header) + "\n")
	}

	// Agent: special rendering with expand/collapse for tool call list
	if msg.tool == "Agent" && msg.agentProg != nil {
		renderAgentCompleted(b, s, msg)
		return
	}

	// Details (only in expanded/verbose mode)
	if (msg.expanded || verbose) && len(msg.details) > 0 {
		for _, d := range msg.details {
			b.WriteString(d + "\n")
		}
	}

	// Result line with collapse/expand support
	elapsed := ""
	if msg.duration > 0 {
		elapsed = " · " + formatDuration(msg.duration)
	}
	summary := cleanSummary(msg.summary)

	// Collapsible: if the summary is long (>10 lines), show truncated with expand hint
	if msg.collapsed && msg.lineCount > collapseThreshold && msg.fullContent != "" {
		lines := strings.SplitN(summary, "\n", 6)
		if len(lines) > 5 {
			summary = strings.Join(lines[:5], "\n")
		}
		expandHint := s.expandHint.Render(fmt.Sprintf("  [+%d more lines, Tab to expand]", msg.lineCount-5))
		if msg.success {
			b.WriteString(s.toolResult.Render(fmt.Sprintf("  ⎿ %s%s", summary, elapsed)) + "\n" + expandHint + "\n")
		} else {
			b.WriteString(s.toolFail.Render(fmt.Sprintf("  ✗ %s%s", summary, elapsed)) + "\n" + expandHint + "\n")
		}
		return
	}

	// Expanded or short: show full summary
	expandHint := ""
	if !verbose && !msg.expanded && len(msg.details) > 0 {
		expandHint = s.expandHint.Render("  (ctrl+o to expand)")
	}

	if msg.success {
		b.WriteString(s.toolResult.Render(fmt.Sprintf("  ⎿ %s%s", summary, elapsed)) + expandHint + "\n")
	} else {
		b.WriteString(s.toolFail.Render(fmt.Sprintf("  ✗ %s%s", summary, elapsed)) + expandHint + "\n")
	}
}

// renderToolRunningMessage renders a tool that is still executing.
func renderToolRunningMessage(b *strings.Builder, s *styles, msg *displayMessage) {
	if msg.tool == "TodoWrite" {
		return
	}

	header := formatToolHeader(msg.tool, msg.params)
	if header != "" {
		b.WriteString(s.toolHeader.Render(header) + "\n")
	}

	// Agent: show inner tool progress
	if msg.tool == "Agent" && msg.agentProg != nil {
		renderAgentProgress(b, s, msg.agentProg)
		return
	}

	b.WriteString(s.toolResult.Render("  ⎿ running...") + "\n")
}

// renderAgentProgress renders the inner tool call list for a running agent.
func renderAgentProgress(b *strings.Builder, s *styles, prog *agentProgress) {
	const maxShow = agentProgressMaxShow

	// Show last N completed tool calls with tree chars
	calls := prog.toolCalls
	startIdx := 0
	if len(calls) > maxShow {
		startIdx = len(calls) - maxShow
		hidden := len(calls) - maxShow
		b.WriteString(s.agentTree.Render(fmt.Sprintf("  ├─ ...%d more tool uses", hidden)) + "\n")
	}

	for i := startIdx; i < len(calls); i++ {
		tc := calls[i]
		isLast := i == len(calls)-1 && prog.runningTool == ""
		prefix := "├─"
		if isLast {
			prefix = "└─"
		}
		dur := ""
		if tc.duration > 0 {
			dur = " · " + formatDuration(tc.duration)
		}
		toolLine := fmt.Sprintf("  %s %s", prefix, tc.tool)
		if tc.params != "" {
			toolLine += " " + tc.params
		}
		toolLine += dur
		if !tc.success {
			b.WriteString(s.toolFail.Render(toolLine) + "\n")
		} else {
			b.WriteString(s.agentTree.Render(toolLine) + "\n")
		}
	}

	// Show currently running tool
	if prog.runningTool != "" {
		toolLine := fmt.Sprintf("  └─ %s", prog.runningTool)
		if prog.runningParam != "" {
			toolLine += " " + prog.runningParam
		}
		b.WriteString(s.toolHeader.Render(toolLine) + "\n")
		b.WriteString(s.toolResult.Render("     ⎿ running...") + "\n")
	}

	// Status line with metrics
	metrics := fmt.Sprintf("  ⎿ %d tool use(s)", prog.toolCount)
	if prog.tokenCount > 0 {
		metrics += fmt.Sprintf(" · %s tokens", formatNum(prog.tokenCount))
	}
	b.WriteString(s.agentMetric.Render(metrics) + "\n")
}

// renderThinkingMessage renders collapsed or expanded thinking.
// Claude Code style: collapsed shows "Thinking... (duration · char count)"
// Expanded (Ctrl+O) shows full thinking content indented.
func renderThinkingMessage(b *strings.Builder, s *styles, msg *displayMessage, verbose bool) {
	charCount := len([]rune(msg.content))

	if verbose || msg.expanded {
		// Expanded: show full thinking content
		header := "  ∴ Thinking"
		if msg.duration > 0 {
			header += fmt.Sprintf(" · %s", formatDuration(msg.duration))
		}
		header += fmt.Sprintf(" · %s chars", formatNum(charCount))
		b.WriteString(s.thinking.Render(header) + "\n")

		// Indent and render each line
		lines := strings.Split(msg.content, "\n")
		maxLines := thinkingMaxLines
		for i, line := range lines {
			if i >= maxLines {
				b.WriteString(s.expandHint.Render(fmt.Sprintf("    ... %d more lines", len(lines)-maxLines)) + "\n")
				break
			}
			b.WriteString(s.thinking.Render("    │ "+line) + "\n")
		}
		b.WriteString(s.expandHint.Render("") + "\n") // Blank line after thinking
	} else {
		// Collapsed: single line with metrics
		summary := "  ∴ Thinking"
		if msg.duration > 0 {
			summary += fmt.Sprintf(" · %s", formatDuration(msg.duration))
		}
		if charCount > 0 {
			summary += fmt.Sprintf(" · %s chars", formatNum(charCount))
		}
		b.WriteString(s.thinking.Render(summary) + "\n")
	}
}

// renderApprovalMessage renders a compact tool approval notice (actions in input bar).
func renderApprovalMessage(b *strings.Builder, s *styles, msg *displayMessage) {
	spec := ""
	if msg.params != "" {
		spec = "(" + msg.params + ")"
		if len(spec) > maxHeaderWidth-10 {
			spec = "(" + msg.params[:maxHeaderWidth-13] + "...)"
		}
	}
	b.WriteString(s.warn.Render(fmt.Sprintf("  ● %s%s requires approval", msg.tool, spec)) + "\n")
}

// renderQuestionMessage renders a user question with options.
func renderQuestionMessage(b *strings.Builder, s *styles, msg *displayMessage) {
	b.WriteString(s.warn.Render("  □ "+msg.question) + "\n")
}

// renderPlanReviewMessage renders a plan review prompt.
func renderPlanReviewMessage(b *strings.Builder, s *styles, msg *displayMessage, mdRenderer *glamour.TermRenderer) {
	b.WriteString("\n")
	if msg.content != "" {
		b.WriteString(s.gray.Render("  ── Plan Content ──────────────────────────────────") + "\n")
		if mdRenderer != nil {
			out, err := mdRenderer.Render(msg.content)
			if err == nil {
				b.WriteString(strings.TrimRight(out, "\n") + "\n")
			}
		}
		b.WriteString(s.gray.Render("  ─────────────────────────────────────────────────") + "\n")
	}
	b.WriteString("\n")
	b.WriteString("  " + s.banner.Render("□ Plan Ready for Review") + "\n")
	b.WriteString(s.gray.Render("  The agent has finished planning. Review the plan above.") + "\n")
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// formatToolHeader builds the tool header line with tool-aware formatting.
// renderAgentCompleted renders a completed Agent block with expand/collapse.
func renderAgentCompleted(b *strings.Builder, s *styles, msg *displayMessage) {
	prog := msg.agentProg

	// Expanded: show tool call list
	if !msg.collapsed && prog != nil && len(prog.toolCalls) > 0 {
		const maxExpand = agentExpandMaxShow
		calls := prog.toolCalls
		startIdx := 0
		if len(calls) > maxExpand {
			startIdx = len(calls) - maxExpand
		}

		if startIdx > 0 {
			b.WriteString(s.agentTree.Render(fmt.Sprintf("  ├─ ...%d more tool uses", startIdx)) + "\n")
		}
		for i := startIdx; i < len(calls); i++ {
			tc := calls[i]
			isLast := i == len(calls)-1
			prefix := "├─"
			if isLast {
				prefix = "└─"
			}
			dur := ""
			if tc.duration > 0 {
				dur = " · " + formatDuration(tc.duration)
			}
			line := fmt.Sprintf("  %s %s", prefix, tc.tool)
			if tc.params != "" {
				line += " " + tc.params
			}
			line += dur
			if !tc.success {
				b.WriteString(s.toolFail.Render(line) + "\n")
			} else {
				b.WriteString(s.agentTree.Render(line) + "\n")
			}
		}
	}

	// Summary line
	elapsed := ""
	if msg.duration > 0 {
		elapsed = " · " + formatDuration(msg.duration)
	}
	summary := cleanSummary(msg.summary)
	expandHint := ""
	if msg.collapsed && prog != nil && len(prog.toolCalls) > 0 {
		expandHint = s.expandHint.Render("  (Tab to expand)")
	}

	if msg.success {
		b.WriteString(s.toolResult.Render(fmt.Sprintf("  ⎿ %s%s", summary, elapsed)) + expandHint + "\n")
	} else {
		b.WriteString(s.toolFail.Render(fmt.Sprintf("  ✗ %s%s", summary, elapsed)) + expandHint + "\n")
	}
}

func formatToolHeader(tool string, params string) string {
	switch tool {
	case "Read", "Write", "Edit", "Bash", "Glob", "Grep":
		if params != "" {
			p := params
			if len(p) > maxSummaryWidth {
				p = p[:maxSummaryWidth-3] + "..."
			}
			return "  " + tool + " " + p
		}
		return "  " + tool
	case "Agent":
		if params != "" {
			p := params
			if len(p) > maxHeaderWidth {
				p = p[:maxHeaderWidth-3] + "..."
			}
			return "  " + tool + "(" + p + ")"
		}
		return "  " + tool
	case "TodoWrite":
		return "" // Hidden
	default:
		if params != "" {
			p := params
			if len(p) > maxHeaderWidth {
				p = p[:maxHeaderWidth-3] + "..."
			}
			return "  " + tool + "(" + p + ")"
		}
		return "  " + tool
	}
}

// cleanSummary truncates a tool result summary to a single line, max 80 chars.
func cleanSummary(s string) string {
	// Take only the first line
	if idx := strings.IndexByte(s, '\n'); idx >= 0 {
		s = s[:idx]
	}
	if len(s) > maxSummaryWidth {
		s = s[:maxSummaryWidth-3] + "..."
	}
	if s == "" {
		s = "done"
	}
	return s
}

// formatDuration formats a duration nicely: "12ms", "1.2s", "5.3s"
func formatDuration(d time.Duration) string {
	if d < time.Second {
		return fmt.Sprintf("%dms", d.Milliseconds())
	}
	return fmt.Sprintf("%.1fs", d.Seconds())
}
