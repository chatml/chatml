package main

import "github.com/charmbracelet/lipgloss"

// theme defines all named colors used throughout the TUI.
type theme struct {
	Name string

	// Core colors
	Banner    lipgloss.Color
	Prompt    lipgloss.Color
	Thinking  lipgloss.Color
	ToolHead  lipgloss.Color
	ToolRes   lipgloss.Color
	ToolOK    lipgloss.Color
	ToolFail  lipgloss.Color
	Error     lipgloss.Color
	Warn      lipgloss.Color
	Gray      lipgloss.Color
	Cmd       lipgloss.Color
	Todo      lipgloss.Color
	ToolLine  lipgloss.Color
	DiffAdd   lipgloss.Color
	DiffDel   lipgloss.Color
	CtxLow    lipgloss.Color
	CtxMid    lipgloss.Color
	CtxHigh   lipgloss.Color
	UserMsgFg lipgloss.Color
	UserMsgBg lipgloss.Color
	Bullet    lipgloss.Color
	ExitOK    lipgloss.Color
	ExitFail  lipgloss.Color
	Hint      lipgloss.Color
	AgentTree lipgloss.Color
	AgentMet  lipgloss.Color
	Cyan      lipgloss.Color
	Blue      lipgloss.Color

	// Border colors
	BorderIdle     lipgloss.Color
	BorderRunning  lipgloss.Color
	BorderApproval lipgloss.Color
}

var darkTheme = theme{
	Name:           "dark",
	Banner:         lipgloss.Color("#7C3AED"),
	Prompt:         lipgloss.Color("#22C55E"),
	Thinking:       lipgloss.Color("#94A3B8"),
	ToolHead:       lipgloss.Color("#3B82F6"),
	ToolRes:        lipgloss.Color("#6B7280"),
	ToolOK:         lipgloss.Color("#22C55E"),
	ToolFail:       lipgloss.Color("#EF4444"),
	Error:          lipgloss.Color("#EF4444"),
	Warn:           lipgloss.Color("#F59E0B"),
	Gray:           lipgloss.Color("#6B7280"),
	Cmd:            lipgloss.Color("#A78BFA"),
	Todo:           lipgloss.Color("#60A5FA"),
	ToolLine:       lipgloss.Color("#64748B"),
	DiffAdd:        lipgloss.Color("#22C55E"),
	DiffDel:        lipgloss.Color("#EF4444"),
	CtxLow:         lipgloss.Color("#22C55E"),
	CtxMid:         lipgloss.Color("#F59E0B"),
	CtxHigh:        lipgloss.Color("#EF4444"),
	UserMsgFg:      lipgloss.Color("#E2E8F0"),
	UserMsgBg:      lipgloss.Color("#1E1E2E"),
	Bullet:         lipgloss.Color("#7C3AED"),
	ExitOK:         lipgloss.Color("#22C55E"),
	ExitFail:       lipgloss.Color("#EF4444"),
	Hint:           lipgloss.Color("#4B5563"),
	AgentTree:      lipgloss.Color("#4B5563"),
	AgentMet:       lipgloss.Color("#6B7280"),
	Cyan:           lipgloss.Color("#06B6D4"),
	Blue:           lipgloss.Color("#3B82F6"),
	BorderIdle:     lipgloss.Color("#6B7280"),
	BorderRunning:  lipgloss.Color("#3B82F6"),
	BorderApproval: lipgloss.Color("#F59E0B"),
}

var lightTheme = theme{
	Name:           "light",
	Banner:         lipgloss.Color("#6D28D9"),
	Prompt:         lipgloss.Color("#16A34A"),
	Thinking:       lipgloss.Color("#64748B"),
	ToolHead:       lipgloss.Color("#2563EB"),
	ToolRes:        lipgloss.Color("#4B5563"),
	ToolOK:         lipgloss.Color("#16A34A"),
	ToolFail:       lipgloss.Color("#DC2626"),
	Error:          lipgloss.Color("#DC2626"),
	Warn:           lipgloss.Color("#D97706"),
	Gray:           lipgloss.Color("#4B5563"),
	Cmd:            lipgloss.Color("#7C3AED"),
	Todo:           lipgloss.Color("#2563EB"),
	ToolLine:       lipgloss.Color("#475569"),
	DiffAdd:        lipgloss.Color("#16A34A"),
	DiffDel:        lipgloss.Color("#DC2626"),
	CtxLow:         lipgloss.Color("#16A34A"),
	CtxMid:         lipgloss.Color("#D97706"),
	CtxHigh:        lipgloss.Color("#DC2626"),
	UserMsgFg:      lipgloss.Color("#1E293B"),
	UserMsgBg:      lipgloss.Color("#F1F5F9"),
	Bullet:         lipgloss.Color("#6D28D9"),
	ExitOK:         lipgloss.Color("#16A34A"),
	ExitFail:       lipgloss.Color("#DC2626"),
	Hint:           lipgloss.Color("#64748B"),
	AgentTree:      lipgloss.Color("#64748B"),
	AgentMet:       lipgloss.Color("#475569"),
	Cyan:           lipgloss.Color("#0891B2"),
	Blue:           lipgloss.Color("#2563EB"),
	BorderIdle:     lipgloss.Color("#64748B"),
	BorderRunning:  lipgloss.Color("#2563EB"),
	BorderApproval: lipgloss.Color("#D97706"),
}

// selectTheme returns the appropriate theme based on name or auto-detection.
func selectTheme(name string) theme {
	switch name {
	case "light":
		return lightTheme
	case "dark":
		return darkTheme
	case "auto", "":
		// Auto-detect: lipgloss checks terminal background
		if lipgloss.HasDarkBackground() {
			return darkTheme
		}
		return lightTheme
	default:
		// Unknown theme name — fall back to auto
		if lipgloss.HasDarkBackground() {
			return darkTheme
		}
		return lightTheme
	}
}

// newStylesFromTheme creates styles from a theme.
func newStylesFromTheme(t theme) *styles {
	return &styles{
		banner:     lipgloss.NewStyle().Bold(true).Foreground(t.Banner),
		prompt:     lipgloss.NewStyle().Bold(true).Foreground(t.Prompt),
		thinking:   lipgloss.NewStyle().Italic(true).Foreground(t.Thinking),
		toolHeader: lipgloss.NewStyle().Bold(true).Foreground(t.ToolHead),
		toolResult: lipgloss.NewStyle().Foreground(t.ToolRes),
		toolOK:     lipgloss.NewStyle().Foreground(t.ToolOK),
		toolFail:   lipgloss.NewStyle().Bold(true).Foreground(t.ToolFail),
		errStyle:   lipgloss.NewStyle().Bold(true).Foreground(t.Error),
		warn:       lipgloss.NewStyle().Foreground(t.Warn),
		gray:       lipgloss.NewStyle().Foreground(t.Gray),
		cmd:        lipgloss.NewStyle().Foreground(t.Cmd),
		todo:       lipgloss.NewStyle().Foreground(t.Todo),
		ctxLow:     lipgloss.NewStyle().Foreground(t.CtxLow),
		ctxMid:     lipgloss.NewStyle().Foreground(t.CtxMid),
		ctxHigh:    lipgloss.NewStyle().Foreground(t.CtxHigh),
		toolLine:   lipgloss.NewStyle().Foreground(t.ToolLine),
		diffAdd:    lipgloss.NewStyle().Foreground(t.DiffAdd),
		diffDel:    lipgloss.NewStyle().Foreground(t.DiffDel),
		userMsg:    lipgloss.NewStyle().Foreground(t.UserMsgFg).Background(t.UserMsgBg),
		bullet:     lipgloss.NewStyle().Bold(true).Foreground(t.Bullet),
		statusFaint: lipgloss.NewStyle().Faint(true),
		exitOK:      lipgloss.NewStyle().Foreground(t.ExitOK),
		exitFail:    lipgloss.NewStyle().Foreground(t.ExitFail),
		expandHint:  lipgloss.NewStyle().Foreground(t.Hint),
		agentTree:   lipgloss.NewStyle().Foreground(t.AgentTree),
		agentMetric: lipgloss.NewStyle().Foreground(t.AgentMet),
		cyan:        lipgloss.NewStyle().Foreground(t.Cyan),
		blue:        lipgloss.NewStyle().Foreground(t.Blue),
		borderIdle:     lipgloss.NewStyle().Foreground(t.BorderIdle),
		borderRunning:  lipgloss.NewStyle().Foreground(t.BorderRunning),
		borderApproval: lipgloss.NewStyle().Foreground(t.BorderApproval),
	}
}
