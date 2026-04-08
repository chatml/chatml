package main

import (
	"fmt"
	"strings"
)

// slashMenuState tracks the ephemeral slash command menu overlay.
// Zero values are correct for initial state (hidden, no matches).
type slashMenuState struct {
	visible   bool
	matches   []slashCmd // filtered commands matching current prefix
	selected  int        // index into matches (0-based)
	scrollOff int        // scroll offset for viewport
}

// resetSlashMenu hides the menu and clears all state.
func resetSlashMenu(m *model) {
	m.slashMenu.visible = false
	m.slashMenu.matches = nil
	m.slashMenu.selected = 0
	m.slashMenu.scrollOff = 0
}

// updateSlashMenu synchronizes the slash menu state with the current input.
// Called after every input change in stateIdle.
func updateSlashMenu(m *model) {
	text := m.input.Value()

	// Menu only shows in single-line idle mode when input starts with "/"
	// and has no spaces (no args typed yet).
	if m.state != stateIdle || m.multiLineMode || !strings.HasPrefix(text, "/") || strings.Contains(text, " ") {
		resetSlashMenu(m)
		return
	}

	prefix := strings.TrimPrefix(text, "/")
	var matches []slashCmd
	for _, cmd := range cmdRegistry {
		if cmd.hidden {
			continue
		}
		if strings.HasPrefix(cmd.name, prefix) {
			matches = append(matches, cmd)
		}
	}

	if len(matches) == 0 {
		resetSlashMenu(m)
		return
	}

	m.slashMenu.visible = true
	m.slashMenu.matches = matches

	// Clamp selected index
	if m.slashMenu.selected >= len(matches) {
		m.slashMenu.selected = len(matches) - 1
	}
	if m.slashMenu.selected < 0 {
		m.slashMenu.selected = 0
	}

	clampSlashMenuScroll(m)
}

// clampSlashMenuScroll ensures the selected item is within the visible viewport.
func clampSlashMenuScroll(m *model) {
	maxVis := slashMenuMaxVisible
	if len(m.slashMenu.matches) < maxVis {
		maxVis = len(m.slashMenu.matches)
	}
	if m.slashMenu.selected >= m.slashMenu.scrollOff+maxVis {
		m.slashMenu.scrollOff = m.slashMenu.selected - maxVis + 1
	}
	if m.slashMenu.selected < m.slashMenu.scrollOff {
		m.slashMenu.scrollOff = m.slashMenu.selected
	}
}

// renderSlashMenu renders the slash command menu overlay.
// Returns empty string if menu is not visible.
func renderSlashMenu(m *model) string {
	if !m.slashMenu.visible || len(m.slashMenu.matches) == 0 {
		return ""
	}

	var sb strings.Builder

	maxVis := slashMenuMaxVisible
	if len(m.slashMenu.matches) < maxVis {
		maxVis = len(m.slashMenu.matches)
	}

	end := m.slashMenu.scrollOff + maxVis
	if end > len(m.slashMenu.matches) {
		end = len(m.slashMenu.matches)
	}

	// Scroll indicator (top)
	if m.slashMenu.scrollOff > 0 {
		sb.WriteString(m.s.gray.Render("    ↑ more") + "\n")
	}

	for i := m.slashMenu.scrollOff; i < end; i++ {
		cmd := m.slashMenu.matches[i]
		name := "/" + cmd.name
		desc := cmd.desc

		// Pad name to fixed width for alignment
		padded := fmt.Sprintf("%-18s %s", name, desc)

		if i == m.slashMenu.selected {
			sb.WriteString(m.s.warn.Render("  › " + padded))
		} else {
			sb.WriteString(m.s.gray.Render("    " + padded))
		}
		if i < end-1 {
			sb.WriteString("\n")
		}
	}

	// Scroll indicator (bottom)
	if end < len(m.slashMenu.matches) {
		sb.WriteString("\n" + m.s.gray.Render("    ↓ more"))
	}

	return sb.String()
}

// selectSlashMenuItem inserts the selected slash command into the input.
// Does not call updateSlashMenu — the completed text (e.g. "/help") would
// re-match and show the menu again, so we reset directly.
func selectSlashMenuItem(m *model) {
	if !m.slashMenu.visible || m.slashMenu.selected < 0 || m.slashMenu.selected >= len(m.slashMenu.matches) {
		return
	}
	cmd := m.slashMenu.matches[m.slashMenu.selected]
	text := "/" + cmd.name
	if cmd.minArgs > 0 {
		text += " "
	}
	m.input.SetValue(text)
	m.input.CursorEnd()
	resetSlashMenu(m)
}
