package main

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/chatml/chatml-core/permission"
)

// renderInput renders the input area: bar → input → bar (Claude Code style).
func renderInput(m *model) string {
	// Thin horizontal lines above and below input
	lineColor := lipgloss.Color("#6B7280")
	lineStyle := lipgloss.NewStyle().Foreground(lineColor)
	topBar := lineStyle.Render(strings.Repeat("─", m.width))
	bottomBar := lineStyle.Render(strings.Repeat("─", m.width))

	var inputLine string
	switch m.state {
	case stateRunning:
		inputLine = m.s.gray.Render("  (running — Ctrl+C to interrupt)")
	case stateApproval:
		// Smart wildcard label for option 2 (always allow — persisted to settings)
		alwaysLabel := "Yes, always allow"
		if suggestion := permission.SuggestWildcard(m.prompt.approvalToolName, m.prompt.approvalSpecifier); suggestion != nil {
			alwaysLabel = suggestion.Label
		}
		approvalOpts := []string{"Yes, allow this", alwaysLabel, "Yes, for this session", "No, deny this"}
		var optLines []string
		for i, opt := range approvalOpts {
			if i == m.prompt.approvalSel {
				optLines = append(optLines, m.s.warn.Render(fmt.Sprintf("  › %d. %s", i+1, opt)))
			} else {
				optLines = append(optLines, m.s.gray.Render(fmt.Sprintf("    %d. %s", i+1, opt)))
			}
		}
		inputLine = strings.Join(optLines, "\n")
	case stateQuestion:
		var optLines []string
		for _, q := range m.prompt.questions {
			if len(q.Options) > 0 {
				for j, opt := range q.Options {
					label := opt.Label
					if opt.Description != "" {
						label += " — " + opt.Description
					}
					if j == m.prompt.selectedOpt {
						optLines = append(optLines, m.s.warn.Render(fmt.Sprintf("  › %d. %s", j+1, label)))
					} else {
						optLines = append(optLines, m.s.gray.Render(fmt.Sprintf("    %d. %s", j+1, label)))
					}
				}
			}
		}
		if len(optLines) > 0 {
			inputLine = strings.Join(optLines, "\n")
		} else {
			inputLine = m.input.View() // free-form input if no options
		}
	case statePlanReview:
		planOpts := []string{"Approve and proceed", "Reject with feedback"}
		var optLines []string
		for i, opt := range planOpts {
			if i == m.prompt.selectedOpt {
				optLines = append(optLines, m.s.warn.Render(fmt.Sprintf("  › %d. %s", i+1, opt)))
			} else {
				optLines = append(optLines, m.s.gray.Render(fmt.Sprintf("    %d. %s", i+1, opt)))
			}
		}
		inputLine = strings.Join(optLines, "\n")
	case stateReason:
		inputLine = m.input.View()
	case stateSessionPicker:
		inputLine = renderSessionPicker(m.sessionList, m.sessionSelected, m.s, m.width)
	default:
		inputLine = m.input.View()
	}

	return topBar + "\n" + inputLine + "\n" + bottomBar
}

// completeSlashCommand returns the completed command if there's exactly one match,
// or the longest common prefix if multiple matches. Uses cmdRegistry as source.
func completeSlashCommand(partial string) string {
	var matches []string
	for _, cmd := range cmdRegistry {
		full := "/" + cmd.name
		if strings.HasPrefix(full, partial) {
			matches = append(matches, full)
		}
	}
	if len(matches) == 1 {
		return matches[0]
	}
	if len(matches) > 1 {
		// Return longest common prefix
		prefix := matches[0]
		for _, m := range matches[1:] {
			for len(prefix) > 0 && !strings.HasPrefix(m, prefix) {
				prefix = prefix[:len(prefix)-1]
			}
		}
		if len(prefix) > len(partial) {
			return prefix
		}
	}
	return ""
}

// handleSlashCommand processes a slash command via the registry and returns a tea.Cmd.
// Output from addSystemMsg/addErrorMsg is buffered in pendingPrintln and flushed here.
func handleSlashCommand(m *model, input string) tea.Cmd {
	parts := strings.Fields(input)
	name := strings.TrimPrefix(parts[0], "/")
	args := parts[1:]

	var handlerCmd tea.Cmd
	found := false
	for _, cmd := range cmdRegistry {
		if cmd.name == name {
			found = true
			if cmd.handler == nil {
				addErrorMsg(m, "Command /"+name+" is not yet implemented.")
				return flushPendingPrintln(m)
			}
			if len(args) < cmd.minArgs {
				addErrorMsg(m, "Usage: "+cmd.usage)
				return flushPendingPrintln(m)
			}
			handlerCmd = cmd.handler(m, args)
			break
		}
	}
	if !found {
		addErrorMsg(m, "Unknown command: /"+name+" (try /help)")
	}

	printCmd := flushPendingPrintln(m)
	if handlerCmd != nil && printCmd != nil {
		return tea.Batch(printCmd, handlerCmd)
	}
	if handlerCmd != nil {
		return handlerCmd
	}
	return printCmd
}

// flushPendingPrintln drains pendingPrintln into a single tea.Println command.
func flushPendingPrintln(m *model) tea.Cmd {
	if len(m.pendingPrintln) == 0 {
		return nil
	}
	output := strings.Join(m.pendingPrintln, "\n")
	m.pendingPrintln = nil
	return tea.Println(output)
}
