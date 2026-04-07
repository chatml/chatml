package main

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

// renderStatus renders the colored status bar (Claude Code style).
func renderStatus(m *model) string {
	w := m.width

	// Colored segments
	green := lipgloss.NewStyle().Foreground(lipgloss.Color("#22C55E"))
	yellow := lipgloss.NewStyle().Foreground(lipgloss.Color("#F59E0B"))
	gray := lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280"))
	cyan := lipgloss.NewStyle().Foreground(lipgloss.Color("#06B6D4"))
	blue := lipgloss.NewStyle().Foreground(lipgloss.Color("#3B82F6"))

	// Line 1: project (green) · model (yellow) · [fast] · cost · context bar · duration
	name := filepath.Base(m.workdir)
	if name == "" || name == "." {
		name = "chatml"
	}
	projectName := green.Render(name)

	modelStr := fmt.Sprintf("[%s]", m.modelName)
	if m.fastMode {
		modelStr += " [F]"
	}
	modelInfo := yellow.Render(modelStr)

	var extras []string
	if m.stats.totalCost > 0 {
		if m.maxBudget > 0 {
			extras = append(extras, fmt.Sprintf("$%.4f/$%.2f", m.stats.totalCost, m.maxBudget))
		} else {
			extras = append(extras, fmt.Sprintf("$%.4f", m.stats.totalCost))
		}
	}

	// Context as mini progress bar
	if m.stats.lastContextPct > 0 {
		extras = append(extras, renderContextBar(m.stats.lastContextPct))
	}

	// Session duration
	if !m.startTime.IsZero() {
		dur := time.Since(m.startTime)
		extras = append(extras, formatDurationShort(dur))
	}

	// MCP server count
	if m.mcpCount > 0 {
		extras = append(extras, fmt.Sprintf("MCP:%d", m.mcpCount))
	}

	left := "  " + projectName + " " + modelInfo
	if len(extras) > 0 {
		left += " " + gray.Render(strings.Join(extras, " · "))
	}

	// Right side: mode badge
	right := cyan.Render("/" + modeBadge(m.permMode))

	// Pad to full width — ensure line fits within terminal
	leftLen := lipgloss.Width(left)
	rightLen := lipgloss.Width(right)
	padding := w - leftLen - rightLen - 2
	if padding < 1 {
		padding = 1
	}
	// If left+right exceeds width, truncate extras
	if leftLen+rightLen+2 > w {
		left = "  " + projectName + " " + modelInfo
		leftLen = lipgloss.Width(left)
		padding = w - leftLen - rightLen - 2
		if padding < 1 {
			padding = 1
		}
	}
	line1 := left + strings.Repeat(" ", padding) + right

	// Line 2: active tool while running, or mode cycle hint
	var line2 string
	if m.state == stateRunning && m.stream.activeToolName != "" {
		toolDisplay := m.stream.activeToolName
		if m.stream.activeToolParam != "" {
			toolDisplay += " " + m.stream.activeToolParam
		}
		if len(toolDisplay) > w-10 {
			toolDisplay = toolDisplay[:w-13] + "..."
		}
		line2 = blue.Render(fmt.Sprintf("  ▸ Running: %s", toolDisplay))
	} else {
		purple := lipgloss.NewStyle().Foreground(lipgloss.Color("#7C3AED"))
		line2 = purple.Render(fmt.Sprintf("  ▸▸ %s", modeBadge(m.permMode))) +
			gray.Render(" (shift+tab to cycle)")
	}

	return line1 + "\n" + line2
}

// renderContextBar renders a mini progress bar for context usage.
func renderContextBar(pct int) string {
	const barWidth = 10
	filled := pct * barWidth / 100
	if filled > barWidth {
		filled = barWidth
	}
	if filled < 0 {
		filled = 0
	}

	bar := strings.Repeat("█", filled) + strings.Repeat("░", barWidth-filled)

	// Color based on usage level
	var color string
	switch {
	case pct >= 80:
		color = "#EF4444" // red
	case pct >= 50:
		color = "#F59E0B" // yellow
	default:
		color = "#22C55E" // green
	}

	style := lipgloss.NewStyle().Foreground(lipgloss.Color(color))
	return fmt.Sprintf("[%s] %d%%", style.Render(bar), pct)
}

// formatDurationShort formats a duration as "1m", "12m", "1h23m".
func formatDurationShort(d time.Duration) string {
	d = d.Truncate(time.Minute)
	if d < time.Minute {
		return "<1m"
	}
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	if h > 0 {
		return fmt.Sprintf("%dh%dm", h, m)
	}
	return fmt.Sprintf("%dm", m)
}
