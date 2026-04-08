package main

import (
	"github.com/charmbracelet/glamour/ansi"
	glamourStyles "github.com/charmbracelet/glamour/styles"
	"github.com/charmbracelet/lipgloss"
)

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

	// Syntax highlighting
	ChromaStyle string // Chroma style name for code highlighting
}

var darkTheme = theme{
	Name:           "dark",
	Banner:         lipgloss.Color("#D77757"), // Claude Code brand orange
	Prompt:         lipgloss.Color("#4EBA65"), // CC success green
	Thinking:       lipgloss.Color("#999999"), // CC inactive
	ToolHead:       lipgloss.Color("#B1B9F9"), // CC permission (periwinkle)
	ToolRes:        lipgloss.Color("#999999"), // CC inactive
	ToolOK:         lipgloss.Color("#4EBA65"), // CC success
	ToolFail:       lipgloss.Color("#FF6B80"), // CC error (soft red-pink)
	Error:          lipgloss.Color("#FF6B80"), // CC error
	Warn:           lipgloss.Color("#FFC107"), // CC warning
	Gray:           lipgloss.Color("#999999"), // CC inactive
	Cmd:            lipgloss.Color("#AF87FF"), // CC merged purple
	Todo:           lipgloss.Color("#B1B9F9"), // CC permission
	ToolLine:       lipgloss.Color("#505050"), // CC subtle
	DiffAdd:        lipgloss.Color("#38A660"), // CC diffAddedWord
	DiffDel:        lipgloss.Color("#B3596B"), // CC diffRemovedWord (soft rose)
	CtxLow:         lipgloss.Color("#4EBA65"), // CC success
	CtxMid:         lipgloss.Color("#FFC107"), // CC warning
	CtxHigh:        lipgloss.Color("#FF6B80"), // CC error
	UserMsgFg:      lipgloss.Color("#FFFFFF"), // CC text
	UserMsgBg:      lipgloss.Color("#373737"), // CC userMessageBackground
	Bullet:         lipgloss.Color("#D77757"), // brand orange
	ExitOK:         lipgloss.Color("#4EBA65"), // CC success
	ExitFail:       lipgloss.Color("#FF6B80"), // CC error
	Hint:           lipgloss.Color("#505050"), // CC subtle
	AgentTree:      lipgloss.Color("#505050"), // CC subtle
	AgentMet:       lipgloss.Color("#999999"), // CC inactive
	Cyan:           lipgloss.Color("#48968C"), // CC planMode teal
	Blue:           lipgloss.Color("#B1B9F9"), // CC permission
	BorderIdle:     lipgloss.Color("#888888"), // CC promptBorder
	BorderRunning:  lipgloss.Color("#B1B9F9"), // CC permission
	BorderApproval: lipgloss.Color("#FFC107"), // CC warning
	ChromaStyle:    "monokai",
}

var lightTheme = theme{
	Name:           "light",
	Banner:         lipgloss.Color("#D77757"), // CC brand orange
	Prompt:         lipgloss.Color("#2C7A39"), // CC light success
	Thinking:       lipgloss.Color("#666666"), // mid-gray for light bg
	ToolHead:       lipgloss.Color("#5769F7"), // CC light permission
	ToolRes:        lipgloss.Color("#666666"), // subtle gray
	ToolOK:         lipgloss.Color("#2C7A39"), // CC light success
	ToolFail:       lipgloss.Color("#AB2B3F"), // CC light error
	Error:          lipgloss.Color("#AB2B3F"), // CC light error
	Warn:           lipgloss.Color("#966C1E"), // CC light warning
	Gray:           lipgloss.Color("#666666"), // neutral gray
	Cmd:            lipgloss.Color("#AF87FF"), // CC merged purple
	Todo:           lipgloss.Color("#5769F7"), // CC light permission
	ToolLine:       lipgloss.Color("#AFAFAF"), // subtle on light bg
	DiffAdd:        lipgloss.Color("#2F9D44"), // CC light diffAddedWord
	DiffDel:        lipgloss.Color("#D1454B"), // CC light diffRemovedWord
	CtxLow:         lipgloss.Color("#2C7A39"), // CC light success
	CtxMid:         lipgloss.Color("#966C1E"), // CC light warning
	CtxHigh:        lipgloss.Color("#AB2B3F"), // CC light error
	UserMsgFg:      lipgloss.Color("#000000"), // CC text (light)
	UserMsgBg:      lipgloss.Color("#F0F0F0"), // CC userMessageBackground
	Bullet:         lipgloss.Color("#D77757"), // brand orange
	ExitOK:         lipgloss.Color("#2C7A39"), // CC light success
	ExitFail:       lipgloss.Color("#AB2B3F"), // CC light error
	Hint:           lipgloss.Color("#AFAFAF"), // subtle
	AgentTree:      lipgloss.Color("#AFAFAF"), // subtle
	AgentMet:       lipgloss.Color("#666666"), // inactive
	Cyan:           lipgloss.Color("#006666"), // CC light planMode
	Blue:           lipgloss.Color("#5769F7"), // CC light permission
	BorderIdle:     lipgloss.Color("#999999"), // CC light promptBorder
	BorderRunning:  lipgloss.Color("#5769F7"), // CC light permission
	BorderApproval: lipgloss.Color("#966C1E"), // CC light warning
	ChromaStyle:    "github",
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

// ── Custom Glamour Styles ────────────────────────────────────────────────────
//
// These replace glamour's default dark/light styles to align with Claude Code's
// color palette. The key fix: inline code uses periwinkle (not red-orange ANSI 203)
// and headings use bold text styling (not colored backgrounds).

func glamourStyleForTheme(themeName string) ansi.StyleConfig {
	switch themeName {
	case "light":
		return glamourLightStyle()
	default:
		return glamourDarkStyle()
	}
}

func glamourDarkStyle() ansi.StyleConfig {
	s := glamourStyles.DarkStyleConfig

	// Inline code: periwinkle (not red-orange ANSI 203)
	s.Code = ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			Prefix:          " ",
			Suffix:          " ",
			Color:           stringPtr("#B1B9F9"),
			BackgroundColor: stringPtr("#373737"),
		},
	}

	// Headings: bold only, no colored backgrounds (matches Claude Code)
	s.Heading = ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			BlockSuffix: "\n",
			Bold:        boolPtr(true),
		},
	}
	s.H1 = ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			Bold:      boolPtr(true),
			Underline: boolPtr(true),
		},
	}

	// Links: periwinkle
	s.Link = ansi.StylePrimitive{
		Color:     stringPtr("#B1B9F9"),
		Underline: boolPtr(true),
	}
	s.LinkText = ansi.StylePrimitive{
		Color: stringPtr("#B1B9F9"),
		Bold:  boolPtr(true),
	}

	// Horizontal rule: subtle
	s.HorizontalRule = ansi.StylePrimitive{
		Color:  stringPtr("#505050"),
		Format: "\n--------\n",
	}

	// H6: subtle
	s.H6 = ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			Prefix: "###### ",
			Color:  stringPtr("#505050"),
			Bold:   boolPtr(false),
		},
	}

	// Code block background (defensive nil check for future glamour versions)
	if s.CodeBlock.Chroma != nil {
		s.CodeBlock.Chroma.Background = ansi.StylePrimitive{
			BackgroundColor: stringPtr("#373737"),
		}
	}

	return s
}

func glamourLightStyle() ansi.StyleConfig {
	s := glamourStyles.LightStyleConfig

	// Inline code: medium blue (not red-orange ANSI 203)
	s.Code = ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			Prefix:          " ",
			Suffix:          " ",
			Color:           stringPtr("#5769F7"),
			BackgroundColor: stringPtr("#F0F0F0"),
		},
	}

	// Headings: bold only, no colored backgrounds
	s.Heading = ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			BlockSuffix: "\n",
			Bold:        boolPtr(true),
		},
	}
	s.H1 = ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			Bold:      boolPtr(true),
			Underline: boolPtr(true),
		},
	}

	// Links: medium blue
	s.Link = ansi.StylePrimitive{
		Color:     stringPtr("#5769F7"),
		Underline: boolPtr(true),
	}
	s.LinkText = ansi.StylePrimitive{
		Color: stringPtr("#5769F7"),
		Bold:  boolPtr(true),
	}

	// Horizontal rule: subtle
	s.HorizontalRule = ansi.StylePrimitive{
		Color:  stringPtr("#AFAFAF"),
		Format: "\n--------\n",
	}

	// H6: subtle
	s.H6 = ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			Prefix: "###### ",
			Bold:   boolPtr(false),
		},
	}

	// Code block background (defensive nil check for future glamour versions)
	if s.CodeBlock.Chroma != nil {
		s.CodeBlock.Chroma.Background = ansi.StylePrimitive{
			BackgroundColor: stringPtr("#F0F0F0"),
		}
	}

	return s
}

func boolPtr(b bool) *bool      { return &b }
func stringPtr(s string) *string { return &s }
