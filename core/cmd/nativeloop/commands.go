package main

import (
	"fmt"
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

// slashCmd describes a single slash command in the registry.
type slashCmd struct {
	name     string
	desc     string // for /help display
	usage    string // e.g. "/model <name>"
	minArgs  int    // minimum args required (0 for no-arg commands)
	validate func(args []string) error
	handler  func(m *model, args []string) tea.Cmd
}

// known permission modes for validation
var validPermModes = map[string]bool{
	"bypassPermissions": true,
	"default":           true,
	"acceptEdits":       true,
	"plan":              true,
	"dontAsk":           true,
}

// cmdRegistry is the canonical list of all slash commands.
// /help auto-generates from this. Tab completion uses this.
var cmdRegistry []slashCmd

func init() {
	cmdRegistry = []slashCmd{
		{name: "quit", desc: "Exit", usage: "/quit", minArgs: 0, handler: cmdQuit},
		{name: "exit", desc: "Exit", usage: "/exit", minArgs: 0, handler: cmdQuit},
		{name: "help", desc: "Show commands", usage: "/help", minArgs: 0, handler: cmdHelp},
		{name: "model", desc: "Switch model", usage: "/model <name>", minArgs: 1, validate: func(args []string) error {
			if strings.TrimSpace(args[0]) == "" {
				return fmt.Errorf("model name cannot be empty")
			}
			if strings.Contains(args[0], " ") {
				return fmt.Errorf("model name cannot contain spaces")
			}
			return nil
		}, handler: cmdModel},
		{name: "mode", desc: "Permission mode", usage: "/mode <bypass|default|acceptEdits|plan|dontAsk>", minArgs: 1, validate: func(args []string) error {
			mode := args[0]
			if mode == "bypass" {
				mode = "bypassPermissions"
			}
			if !validPermModes[mode] {
				return fmt.Errorf("unknown mode %q — valid modes: bypass, default, acceptEdits, plan, dontAsk", args[0])
			}
			return nil
		}, handler: cmdMode},
		{name: "fast", desc: "Toggle fast mode", usage: "/fast", minArgs: 0, handler: cmdFast},
		{name: "thinking", desc: "Set thinking budget", usage: "/thinking <N>", minArgs: 1, validate: func(args []string) error {
			n, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid number: %s", args[0])
			}
			if n < 0 || n > 65536 {
				return fmt.Errorf("thinking budget must be 0-65536, got %d", n)
			}
			return nil
		}, handler: cmdThinking},
		{name: "status", desc: "Show settings + session stats", usage: "/status", minArgs: 0, handler: cmdStatus},
		{name: "cost", desc: "Show cost breakdown", usage: "/cost", minArgs: 0, handler: cmdCost},
		{name: "context", desc: "Show context usage", usage: "/context", minArgs: 0, handler: cmdContext},
		{name: "verbose", desc: "Toggle verbose mode", usage: "/verbose", minArgs: 0, handler: cmdVerbose},
		{name: "clear", desc: "Clear messages", usage: "/clear", minArgs: 0, handler: cmdClear},
		{name: "interrupt", desc: "Interrupt current turn", usage: "/interrupt", minArgs: 0, handler: cmdInterrupt},
		{name: "compact", desc: "Trigger compaction", usage: "/compact", minArgs: 0, handler: cmdCompact},
		{name: "history", desc: "Show message history", usage: "/history", minArgs: 0, handler: cmdHistory},
		{name: "reset", desc: "Reset conversation", usage: "/reset", minArgs: 0, handler: cmdReset},
		{name: "doctor", desc: "Run diagnostic checks", usage: "/doctor", minArgs: 0, handler: cmdDoctor},
		{name: "permissions", desc: "Show permission rules", usage: "/permissions", minArgs: 0, handler: cmdPermissions},
		{name: "memory", desc: "Show auto-memory status", usage: "/memory", minArgs: 0, handler: cmdMemory},
		{name: "resume", desc: "Resume a previous session", usage: "/resume [session-id]", minArgs: 0, handler: cmdResume},
		{name: "sessions", desc: "Pick a session interactively", usage: "/sessions", minArgs: 0, handler: cmdSessions},
		{name: "mcp", desc: "Show MCP server status", usage: "/mcp", minArgs: 0, handler: cmdMcp},
		{name: "plan", desc: "Enter plan mode", usage: "/plan", minArgs: 0, handler: cmdPlan},
		{name: "export", desc: "Export conversation to file", usage: "/export", minArgs: 0, handler: cmdExport},
		{name: "notifications", desc: "Toggle terminal notifications", usage: "/notifications", minArgs: 0, handler: cmdNotifications},
		{name: "theme", desc: "Switch color theme", usage: "/theme <dark|light|auto>", minArgs: 1, validate: func(args []string) error {
			switch args[0] {
			case "dark", "light", "auto":
				return nil
			default:
				return fmt.Errorf("unknown theme %q — valid themes: dark, light, auto", args[0])
			}
		}, handler: cmdTheme},
		{name: "setup", desc: "Run initial setup", usage: "/setup", minArgs: 0, handler: nil}, // placeholder
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// addSystemMsg adds a system message. During idle (slash commands), it prints
// directly to scrollback. During a turn, it goes to activeMsgs.
func addSystemMsg(m *model, content string) {
	if m.state == stateIdle {
		m.pendingPrintln = append(m.pendingPrintln, m.s.gray.Render("  "+content))
	} else {
		m.appendActive(&displayMessage{kind: msgSystem, content: content})
	}
}

// addErrorMsg adds an error message. Same idle/running routing as addSystemMsg.
func addErrorMsg(m *model, content string) {
	if m.state == stateIdle {
		m.pendingPrintln = append(m.pendingPrintln, m.s.toolFail.Render("  ✗ Error: "+content))
	} else {
		m.appendActive(&displayMessage{kind: msgError, content: content})
	}
}

// ── Command handlers ─────────────────────────────────────────────────────────

func cmdQuit(_ *model, _ []string) tea.Cmd {
	return tea.Quit
}

func cmdHelp(m *model, _ []string) tea.Cmd {
	var lines []string
	lines = append(lines, "Commands:")
	for _, cmd := range cmdRegistry {
		if cmd.name == "exit" || cmd.name == "setup" {
			continue // skip aliases and placeholders from help
		}
		lines = append(lines, fmt.Sprintf("  /%-14s %s", cmd.name, cmd.desc))
	}
	lines = append(lines, "")
	lines = append(lines, "  Ctrl+C         Interrupt / quit")
	lines = append(lines, "  Ctrl+D         Quit")
	lines = append(lines, "  Ctrl+E         Toggle multi-line input")
	lines = append(lines, "  Ctrl+O         Toggle verbose mode")
	lines = append(lines, "  Shift+Tab      Cycle permission modes")
	lines = append(lines, "  Tab            Expand/collapse last tool output")
	lines = append(lines, "  PgUp/PgDn      Scroll conversation")
	addSystemMsg(m, strings.Join(lines, "\n"))
	return nil
}

func cmdModel(m *model, args []string) tea.Cmd {
	name := args[0]
	m.backend.SetModel(name)
	m.modelName = name
	addSystemMsg(m, "Model → "+name)
	return nil
}

func cmdMode(m *model, args []string) tea.Cmd {
	mode := args[0]
	if mode == "bypass" {
		mode = "bypassPermissions"
	}
	m.backend.SetPermissionMode(mode)
	m.permMode = mode
	addSystemMsg(m, "Mode → "+modeBadge(mode))
	return nil
}

func cmdFast(m *model, _ []string) tea.Cmd {
	m.fastMode = !m.fastMode
	m.backend.SetFastMode(m.fastMode)
	state := "off"
	if m.fastMode {
		state = "on"
	}
	addSystemMsg(m, "Fast mode → "+state)
	return nil
}

func cmdThinking(m *model, args []string) tea.Cmd {
	n, err := strconv.Atoi(args[0])
	if err != nil {
		addErrorMsg(m, "Invalid number: "+args[0])
		return nil
	}
	m.backend.SetMaxThinkingTokens(n)
	addSystemMsg(m, fmt.Sprintf("Thinking → %d tokens", n))
	return nil
}

func cmdStatus(m *model, _ []string) tea.Cmd {
	status := fmt.Sprintf("Model: %s\nMode: %s\nFast: %v\nVerbose: %v\nWorkdir: %s\nTurns: %d\nCost: $%.4f\nTokens: %s in / %s out\nContext: %d%%",
		m.modelName, modeBadge(m.permMode), m.fastMode, m.verbose, m.workdir,
		m.stats.totalTurns, m.stats.totalCost,
		formatNum(m.stats.totalInputTokens), formatNum(m.stats.totalOutputTokens),
		m.stats.lastContextPct)
	if m.stats.parseErrors > 0 {
		status += fmt.Sprintf("\nParse errors: %d (use /verbose to see details)", m.stats.parseErrors)
	}
	addSystemMsg(m, status)
	return nil
}

func cmdCost(m *model, _ []string) tea.Cmd {
	avg := 0.0
	if m.stats.totalTurns > 0 {
		avg = m.stats.totalCost / float64(m.stats.totalTurns)
	}
	cost := fmt.Sprintf("Session Cost: $%.4f\nTurns: %d · Avg: $%.4f/turn\nTokens: %s in · %s out\nCache: %s read",
		m.stats.totalCost, m.stats.totalTurns, avg,
		formatNum(m.stats.totalInputTokens), formatNum(m.stats.totalOutputTokens),
		formatNum(m.stats.totalCacheRead))
	addSystemMsg(m, cost)
	return nil
}

func cmdContext(m *model, _ []string) tea.Cmd {
	pct := m.stats.lastContextPct
	window := m.stats.lastContextWindow
	if window <= 0 {
		addSystemMsg(m, "No context data yet.")
		return nil
	}
	const barW = 30
	filled := pct * barW / 100
	if filled > barW {
		filled = barW
	}
	bar := strings.Repeat("█", filled) + strings.Repeat("░", barW-filled)
	totalK := fmt.Sprintf("%.0fk", float64(window)/1000)
	addSystemMsg(m, fmt.Sprintf("Context: [%s] %d%% of %s", bar, pct, totalK))
	return nil
}

func cmdVerbose(m *model, _ []string) tea.Cmd {
	m.verbose = !m.verbose
	state := "off"
	if m.verbose {
		state = "on"
	}
	addSystemMsg(m, "Verbose → "+state)
	return nil
}

func cmdClear(m *model, _ []string) tea.Cmd {
	m.activeMsgs = nil
	return nil
}

func cmdInterrupt(m *model, _ []string) tea.Cmd {
	if m.state == stateRunning {
		m.backend.SendInterrupt()
		addSystemMsg(m, "Interrupted")
	} else {
		addSystemMsg(m, "No active turn")
	}
	return nil
}

func cmdCompact(m *model, _ []string) tea.Cmd {
	// NOTE: The native runner has no slash command processing — SendMessage
	// would send "/compact" as a literal prompt to the LLM. Compaction
	// requires a dedicated backend method (not yet on ConversationBackend).
	addErrorMsg(m, "/compact is not yet implemented in the native runner. Context is compacted automatically when approaching the limit.")
	return nil
}

func cmdHistory(m *model, _ []string) tea.Cmd {
	if len(m.hist.entries) == 0 {
		addSystemMsg(m, "No messages yet.")
	} else {
		var lines []string
		for i, msg := range m.hist.entries {
			preview := msg
			if len(preview) > 100 {
				preview = preview[:97] + "..."
			}
			lines = append(lines, fmt.Sprintf("[%d] %s", i+1, preview))
		}
		addSystemMsg(m, strings.Join(lines, "\n"))
	}
	return nil
}

func cmdReset(m *model, _ []string) tea.Cmd {
	m.activeMsgs = nil
	m.hist.entries = nil
	m.stream.assistantBuf.Reset()
	m.stream.thinkingBuf.Reset()
	m.prompt.todos = nil
	addSystemMsg(m, "Display cleared. Note: conversation context is preserved — the LLM still sees prior messages. Cost and context usage continue accumulating.")
	return nil
}

func cmdDoctor(m *model, _ []string) tea.Cmd {
	report := runDoctor(m.workdir)
	addSystemMsg(m, report)
	return nil
}

func cmdPermissions(m *model, _ []string) tea.Cmd {
	addSystemMsg(m, fmt.Sprintf("Permission mode: %s\nRules sources: user (~/.claude/settings.json), project (.claude/settings.json), local (.claude/settings.local.json)\nUse /mode <name> to change mode.", modeBadge(m.permMode)))
	return nil
}

func cmdMemory(m *model, _ []string) tea.Cmd {
	addSystemMsg(m, "Memory paths:\n  User: ~/.claude/CLAUDE.md\n  Project: CLAUDE.md, .claude/CLAUDE.md\n  Local: CLAUDE.local.md\n  Auto-memory: .claude/memory/\n\nUse the /remember skill to review and manage memories.")
	return nil
}

func cmdResume(m *model, args []string) tea.Cmd {
	if len(args) >= 1 {
		return resumeSession(m, args[0])
	}
	addSystemMsg(m, "Usage: /resume <session-id> or use /sessions to pick interactively.")
	return nil
}

func cmdSessions(m *model, _ []string) tea.Cmd {
	sessions := loadSessionList(m.workdir)
	if len(sessions) == 0 {
		addSystemMsg(m, "No past sessions found.")
	} else {
		m.sessionList = sessions
		m.sessionSelected = 0
		m.state = stateSessionPicker
	}
	return nil
}

func cmdMcp(m *model, _ []string) tea.Cmd {
	addSystemMsg(m, "MCP servers loaded from .mcp.json in workspace root.\nFormat: { \"mcpServers\": { \"name\": { \"command\": \"...\", \"args\": [...] } } }\nSupported transports: stdio")
	return nil
}

func cmdPlan(m *model, _ []string) tea.Cmd {
	m.backend.SetPermissionMode("plan")
	m.permMode = "plan"
	addSystemMsg(m, "Entered plan mode. Write/Edit/Bash tools are restricted. Use ExitPlanMode to exit.")
	return nil
}

func cmdNotifications(m *model, _ []string) tea.Cmd {
	m.notifications = !m.notifications
	state := "off"
	if m.notifications {
		state = "on"
	}
	addSystemMsg(m, "Notifications → "+state)
	return nil
}

func cmdTheme(m *model, args []string) tea.Cmd {
	t := selectTheme(args[0])
	m.s = newStylesFromTheme(t)
	addSystemMsg(m, "Theme → "+t.Name)
	return nil
}

func cmdExport(m *model, _ []string) tea.Cmd {
	if len(m.hist.entries) == 0 {
		addSystemMsg(m, "No messages to export.")
	} else {
		addSystemMsg(m, fmt.Sprintf("Conversation has %d messages. Transcripts auto-saved to .claude/transcripts/", len(m.hist.entries)))
	}
	return nil
}
