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

	// Dynamic border colors for input area
	borderIdle     lipgloss.Style
	borderRunning  lipgloss.Style
	borderApproval lipgloss.Style
}

func newStyles() *styles {
	return &styles{
		banner:     lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#7C3AED")),
		prompt:     lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#22C55E")),
		thinking:   lipgloss.NewStyle().Italic(true).Foreground(lipgloss.Color("#94A3B8")),
		toolHeader: lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#3B82F6")),
		toolResult: lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280")),
		toolOK:     lipgloss.NewStyle().Foreground(lipgloss.Color("#22C55E")),
		toolFail:   lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#EF4444")),
		errStyle:   lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#EF4444")),
		warn:       lipgloss.NewStyle().Foreground(lipgloss.Color("#F59E0B")),
		gray:       lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280")),
		cmd:        lipgloss.NewStyle().Foreground(lipgloss.Color("#A78BFA")),
		todo:       lipgloss.NewStyle().Foreground(lipgloss.Color("#60A5FA")),
		ctxLow:     lipgloss.NewStyle().Foreground(lipgloss.Color("#22C55E")),
		ctxMid:     lipgloss.NewStyle().Foreground(lipgloss.Color("#F59E0B")),
		ctxHigh:    lipgloss.NewStyle().Foreground(lipgloss.Color("#EF4444")),
		toolLine:   lipgloss.NewStyle().Foreground(lipgloss.Color("#64748B")),
		diffAdd:    lipgloss.NewStyle().Foreground(lipgloss.Color("#22C55E")),
		diffDel:    lipgloss.NewStyle().Foreground(lipgloss.Color("#EF4444")),
		userMsg:    lipgloss.NewStyle().Foreground(lipgloss.Color("#E2E8F0")).Background(lipgloss.Color("#1E1E2E")),
		bullet:     lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#7C3AED")),
		statusFaint: lipgloss.NewStyle().Faint(true),
		exitOK:      lipgloss.NewStyle().Foreground(lipgloss.Color("#22C55E")),
		exitFail:    lipgloss.NewStyle().Foreground(lipgloss.Color("#EF4444")),
		expandHint:  lipgloss.NewStyle().Foreground(lipgloss.Color("#4B5563")),

		agentTree:   lipgloss.NewStyle().Foreground(lipgloss.Color("#4B5563")),
		agentMetric: lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280")),

		borderIdle:     lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280")),
		borderRunning:  lipgloss.NewStyle().Foreground(lipgloss.Color("#3B82F6")),
		borderApproval: lipgloss.NewStyle().Foreground(lipgloss.Color("#F59E0B")),
	}
}
