package main

import (
	"fmt"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/chatml/chatml-core/loop"
	"github.com/chatml/chatml-core/provider"
)

// Session picker state is integrated into the model via stateSessionPicker.

// loadSessionList loads available transcripts and sorts by recency.
func loadSessionList(workdir string) []loop.TranscriptSummary {
	dir := loop.TranscriptDir(workdir)
	summaries, err := loop.ListTranscripts(dir)
	if err != nil || len(summaries) == 0 {
		return nil
	}
	// Sort by mod time descending (most recent first)
	sort.Slice(summaries, func(i, j int) bool {
		return summaries[i].ModTime.After(summaries[j].ModTime)
	})
	// Limit to 20 most recent
	if len(summaries) > 20 {
		summaries = summaries[:20]
	}
	return summaries
}

// renderSessionPicker renders the session selection UI.
func renderSessionPicker(sessions []loop.TranscriptSummary, selected int, s *styles, width int) string {
	var sb strings.Builder
	sb.WriteString(s.toolHeader.Render("  Select a session to resume:") + "\n\n")

	for i, sess := range sessions {
		// Format age
		age := formatAge(sess.ModTime)

		// Title or ID
		title := sess.Title
		if title == "" {
			title = sess.SessionID
		}
		if len(title) > 50 {
			title = title[:47] + "..."
		}

		// Model
		model := sess.Model
		if model == "" {
			model = "unknown"
		}

		// Cost
		cost := ""
		if sess.CostUSD > 0 {
			cost = fmt.Sprintf(" · $%.4f", sess.CostUSD)
		}

		line := fmt.Sprintf("  %s  [%s]%s  (%s)", title, model, cost, age)

		if i == selected {
			sb.WriteString(s.warn.Render("  › " + line) + "\n")
		} else {
			sb.WriteString(s.gray.Render("    " + line) + "\n")
		}
	}

	sb.WriteString("\n" + s.gray.Render("  ↑/↓ navigate · Enter select · Esc cancel"))
	return sb.String()
}

// handleSessionPickerKey handles keyboard input in the session picker.
func handleSessionPickerKey(m *model, key tea.KeyMsg) tea.Cmd {
	switch key.String() {
	case "up":
		if m.sessionSelected > 0 {
			m.sessionSelected--
		}
	case "down":
		if m.sessionSelected < len(m.sessionList)-1 {
			m.sessionSelected++
		}
	case "enter":
		if m.sessionSelected >= 0 && m.sessionSelected < len(m.sessionList) {
			sess := m.sessionList[m.sessionSelected]
			return resumeSession(m, sess.SessionID)
		}
	case "esc", "q":
		m.state = stateIdle
		// Use addSystemMsg which prints to scrollback when idle, avoiding
		// stale messages in the active area.
		addSystemMsg(m, "Session picker cancelled.")
	}
	return nil
}

// resumeSession loads a transcript and displays its messages.
func resumeSession(m *model, sessionID string) tea.Cmd {
	dir := loop.TranscriptDir(m.workdir)
	path := loop.FindTranscript(dir, sessionID)
	if path == "" {
		m.state = stateIdle
		addErrorMsg(m, fmt.Sprintf("Session %q not found", sessionID))
		return flushPendingPrintln(m)
	}

	msgs, meta, err := loop.ReadTranscript(path)
	if err != nil {
		m.state = stateIdle
		addErrorMsg(m, "Failed to load session: "+err.Error())
		return flushPendingPrintln(m)
	}

	// Clear current messages and display the loaded ones
	m.activeMsgs = nil

	// Show resume header
	resumeInfo := fmt.Sprintf("Resumed session %s", sessionID)
	if meta != nil && meta.Model != "" {
		resumeInfo += fmt.Sprintf(" (model: %s)", meta.Model)
	}
	if meta != nil && meta.CostUSD > 0 {
		resumeInfo += fmt.Sprintf(" · $%.4f", meta.CostUSD)
	}
	m.appendActive(&displayMessage{kind: msgSystem, content: resumeInfo})

	// Convert provider.Messages to displayMessages
	for _, msg := range msgs {
		dm := providerMessageToDisplay(msg)
		if dm != nil {
			m.appendActive(dm)
		}
	}

	m.appendActive(&displayMessage{kind: msgSystem, content: "--- End of resumed session ---"})

	m.state = stateIdle
	return nil
}

// providerMessageToDisplay converts a provider.Message to a displayMessage.
func providerMessageToDisplay(msg provider.Message) *displayMessage {
	for _, block := range msg.Content {
		switch block.Type {
		case provider.BlockText:
			if block.Text == "" {
				continue
			}
			if msg.Role == provider.RoleUser {
				return &displayMessage{kind: msgUser, content: block.Text}
			}
			return &displayMessage{kind: msgAssistant, content: block.Text}
		case provider.BlockToolUse:
			return &displayMessage{
				kind:     msgTool,
				tool:     block.ToolName,
				params:   string(block.Input),
				success:  true,
				exitCode: -1, // -1 = not set; 0 is a valid exit code
			}
		case provider.BlockToolResult:
			// Skip tool results in display (they're paired with tool_use)
			continue
		}
	}
	return nil
}

// formatAge formats a time as a human-readable age string.
func formatAge(t time.Time) string {
	if t.IsZero() {
		return "unknown"
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		days := int(d.Hours()) / 24
		if days == 1 {
			return "yesterday"
		}
		return fmt.Sprintf("%dd ago", days)
	}
}
