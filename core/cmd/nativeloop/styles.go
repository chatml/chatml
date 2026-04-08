package main

import "github.com/charmbracelet/lipgloss"

// styles holds all lipgloss styles used throughout the TUI.
type styles struct {
	banner     lipgloss.Style
	prompt     lipgloss.Style
	thinking   lipgloss.Style
	toolHeader lipgloss.Style // tool name header line (● ToolName)
	toolResult lipgloss.Style // tool result line (⎿ summary)
	toolOK     lipgloss.Style
	toolFail   lipgloss.Style
	errStyle   lipgloss.Style
	warn       lipgloss.Style
	gray       lipgloss.Style
	cmd        lipgloss.Style
	todo       lipgloss.Style
	ctxLow     lipgloss.Style // context bar green
	ctxMid     lipgloss.Style // context bar yellow
	ctxHigh    lipgloss.Style // context bar red
	toolLine   lipgloss.Style // tool detail lines
	diffAdd    lipgloss.Style
	diffDel    lipgloss.Style
	userMsg    lipgloss.Style
	bullet     lipgloss.Style // ● bullet for assistant text
	statusFaint lipgloss.Style
	exitOK      lipgloss.Style // green for [0] exit codes
	exitFail    lipgloss.Style // red for non-zero exit codes
	expandHint  lipgloss.Style // dim gray for "(ctrl+o to expand)"

	// Agent sub-agent tree rendering
	agentTree   lipgloss.Style // dimmed tree chars (├─/└─/│)
	agentMetric lipgloss.Style // metrics line (N tool uses · X tokens)

	// Status bar colors
	cyan lipgloss.Style
	blue lipgloss.Style

	// Dynamic border colors for input area
	borderIdle     lipgloss.Style
	borderRunning  lipgloss.Style
	borderApproval lipgloss.Style
}

// newStyles creates styles with the default dark theme.
// Prefer newStylesFromTheme(selectTheme(name)) for theme-aware initialization.
func newStyles() *styles {
	return newStylesFromTheme(darkTheme)
}
