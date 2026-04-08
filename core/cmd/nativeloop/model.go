package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/chatml/chatml-core/agent"
	"github.com/chatml/chatml-core/loop"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// ── CLI states ──────────────────────────────────────────────────────────────

type cliState int

const (
	stateIdle cliState = iota
	stateRunning
	stateApproval
	stateQuestion
	statePlanReview
	stateReason
	stateSessionPicker
)

// ── Session stats ───────────────────────────────────────────────────────────

type sessionStats struct {
	totalCost         float64
	totalInputTokens  int
	totalOutputTokens int
	totalCacheRead    int
	totalTurns        int
	lastContextPct    int
	lastContextWindow int
	parseErrors       int
	startTime         time.Time
}

// ── Substates ──────────────────────────────────────────────────────────────

// streamState tracks the current streaming turn's buffers and tool execution.
type streamState struct {
	assistantBuf    *strings.Builder
	thinkingBuf     *strings.Builder
	hadAssistant    bool
	thinkingStart   time.Time
	turnStart       time.Time
	turnVerb        string
	turnTokens      int
	toolStarts      map[string]time.Time
	pendingToolIdx  int    // index in activeMsgs of current running tool
	pendingToolID   string // requestID of current running tool
	streamingMsgIdx int    // index of the live-streaming assistant message (-1 = none)
	activeToolName  string // for status bar display
	activeToolParam string
}

// promptState holds approval/question/plan interaction state.
type promptState struct {
	approvalID        string
	approvalSel       int // 0=yes, 1=always, 2=session, 3=deny
	approvalToolName  string
	approvalSpecifier string
	questionID        string
	questions   []agent.UserQuestion
	planID      string
	selectedOpt int
	todos       []agent.TodoItem
}

// inputHistory tracks command history for up/down arrow browsing.
type inputHistory struct {
	entries []string
	idx     int    // -1 = new input, 0+ = browsing
	saved   string // saved current input when browsing
}

// ── Model ───────────────────────────────────────────────────────────────────
//
// Architecture: Println-based scrollback.
// - Completed turns are Println'd into terminal scrollback (permanent, scrollable)
// - Active turn messages live in activeMsgs (shown in BubbleTea managed area)
// - Terminal scrollbar, text selection, and scrollback all work natively
// - No alt-screen, no mouse capture

type model struct {
	// BubbleTea sub-models
	input     textinput.Model
	multiLine textarea.Model
	spinner   spinner.Model

	// Multi-line mode (toggle with Ctrl+E)
	multiLineMode bool

	// Layout (defaults set in newModel, updated on WindowSizeMsg)
	width, height int

	// Core state
	state   cliState
	backend agent.ConversationBackend

	// Active turn messages (shown in managed area, cleared on turn_complete)
	activeMsgs []*displayMessage

	// Substates
	stream streamState
	prompt promptState
	hist   inputHistory

	// Config
	modelName  string
	permMode   string
	fastMode   bool
	workdir    string
	verbose    bool
	maxBudget  float64
	promptMode bool
	promptText string

	// Session
	stats     sessionStats
	startTime time.Time
	mcpCount  int

	// Git state (refreshed at startup and on cwd_changed)
	gitBranch string
	gitDirty  bool

	// Notifications (bell debounce: skip if sent within bellCooldown)
	notifications bool
	lastBell      time.Time

	// Rendering
	s       *styles
	mdCache *mdCache

	// Session picker
	sessionList     []loop.TranscriptSummary
	sessionSelected int

	// Sub-agent tracking: agentID -> index in activeMsgs
	agentMsgIdx map[string]int

	// Buffered Println output from slash commands (flushed after handler returns)
	pendingPrintln []string
}

// now returns the current time — extracted for readability.
func now() time.Time { return time.Now() }

// newModel creates the initial BubbleTea model.
func newModel(backend agent.ConversationBackend, opts modelOpts) model {
	ti := textinput.New()
	ti.Prompt = "\u276f "
	ti.CharLimit = 0
	// NOT focused here — BubbleTea's terminal probes (OSC 11 bg color query)
	// produce responses that leak into the focused textinput. Focus is
	// deferred via a tea.Cmd in Init().

	ta := textarea.New()
	ta.Prompt = "❯ "
	ta.SetHeight(4)
	ta.ShowLineNumbers = false
	ta.FocusedStyle.CursorLine = lipgloss.NewStyle()
	ta.CharLimit = 0

	t := selectTheme(opts.themeName)

	sp := spinner.New()
	sp.Spinner = spinner.MiniDot
	sp.Style = lipgloss.NewStyle().Foreground(t.Warn)
	s := newStylesFromTheme(t)
	cache := newMDCache(100) // resized on first WindowSizeMsg

	return model{
		input:     ti,
		multiLine: ta,
		spinner:   sp,
		backend:   backend,
		width:   80, // sensible defaults until WindowSizeMsg arrives
		height:  24,
		stream: streamState{
			assistantBuf:    &strings.Builder{},
			thinkingBuf:     &strings.Builder{},
			toolStarts:      make(map[string]time.Time),
			pendingToolIdx:  -1,
			streamingMsgIdx: -1,
		},
		hist:        inputHistory{idx: -1},
		s:           s,
		mdCache:     cache,
		modelName:   opts.model,
		permMode:    opts.permMode,
		fastMode:    opts.fastMode,
		workdir:     opts.workdir,
		verbose:     opts.verbose,
		promptMode:  opts.promptMode,
		promptText:  opts.promptText,
		maxBudget:   opts.maxBudget,
		startTime:   time.Now(),
		notifications: true,
		agentMsgIdx:   make(map[string]int),
		stats: sessionStats{
			startTime: time.Now(),
		},
	}
}

type modelOpts struct {
	model      string
	permMode   string
	fastMode   bool
	workdir    string
	verbose    bool
	promptMode bool
	promptText string
	maxBudget  float64
	themeName  string
}

// submitInput is the shared submit path for both single-line and multi-line input.
// It formats the user prompt, transitions to stateRunning, and sends the message.
// displayText is the string shown in scrollback (may differ from text for multi-line).
func (m *model) submitInput(text, displayText string) (model, tea.Cmd) {
	userLine := m.s.userMsg.Render("  ❯ " + displayText)
	m.hist.entries = append(m.hist.entries, text)
	m.state = stateRunning
	m.stream.turnStart = now()
	m.stream.turnVerb = randomVerb()
	m.stream.turnTokens = 0
	m.stream.thinkingStart = time.Time{}
	m.stream.hadAssistant = false
	m.input.Blur()

	if err := m.backend.SendMessage(text); err != nil {
		m.appendActive(&displayMessage{kind: msgError, content: "Failed to send: " + err.Error()})
		m.state = stateIdle
		m.input.Focus()
		return *m, tea.Println(userLine)
	}
	return *m, tea.Println(userLine)
}

// ── Message helpers ─────────────────────────────────────────────────────────

// appendActive adds a message to the active turn buffer and returns its index.
func (m *model) appendActive(msg *displayMessage) int {
	idx := len(m.activeMsgs)
	m.activeMsgs = append(m.activeMsgs, msg)
	return idx
}

// activeAt returns the message at index in activeMsgs (or nil).
func (m *model) activeAt(idx int) *displayMessage {
	if idx < 0 || idx >= len(m.activeMsgs) {
		return nil
	}
	return m.activeMsgs[idx]
}

// activeCount returns the number of active messages.
func (m *model) activeCount() int {
	return len(m.activeMsgs)
}

// commitActiveMsgs renders all active messages and returns a tea.Println cmd
// that pushes them into terminal scrollback. Then clears activeMsgs.
func (m *model) commitActiveMsgs() tea.Cmd {
	if len(m.activeMsgs) == 0 {
		return nil
	}

	var rendered []string
	for _, msg := range m.activeMsgs {
		r := renderSingleMessage(msg, m.width, m.s, m.mdCache, m.verbose)
		if r != "" {
			rendered = append(rendered, r)
		}
	}
	m.activeMsgs = nil
	m.agentMsgIdx = make(map[string]int)

	if len(rendered) == 0 {
		return nil
	}

	output := strings.Join(rendered, "\n")
	return tea.Println(output)
}

// flushCompletedToScrollback moves completed (non-streaming) messages from
// activeMsgs into scrollback, keeping only the last streaming/running messages.
// This prevents the managed area from growing unboundedly during long turns.
func (m *model) flushCompletedToScrollback() tea.Cmd {
	// Find the cut point: keep streaming assistant msg + any running tools after it
	cutIdx := -1
	for i, msg := range m.activeMsgs {
		if msg.streaming || msg.kind == msgToolRunning {
			break
		}
		// This message is complete — safe to flush
		cutIdx = i
	}
	if cutIdx < 0 {
		return nil
	}

	// Render and Println messages [0..cutIdx]
	var rendered []string
	for i := 0; i <= cutIdx; i++ {
		r := renderSingleMessage(m.activeMsgs[i], m.width, m.s, m.mdCache, m.verbose)
		if r != "" {
			rendered = append(rendered, r)
		}
	}

	// Shift activeMsgs and fix indices
	m.activeMsgs = m.activeMsgs[cutIdx+1:]
	// Adjust streaming/tool indices
	if m.stream.streamingMsgIdx >= 0 {
		m.stream.streamingMsgIdx -= cutIdx + 1
		if m.stream.streamingMsgIdx < 0 {
			m.stream.streamingMsgIdx = -1
		}
	}
	if m.stream.pendingToolIdx >= 0 {
		m.stream.pendingToolIdx -= cutIdx + 1
		if m.stream.pendingToolIdx < 0 {
			m.stream.pendingToolIdx = -1
		}
	}
	// Rebuild agentMsgIdx
	newAgentIdx := make(map[string]int)
	for id, idx := range m.agentMsgIdx {
		newIdx := idx - cutIdx - 1
		if newIdx >= 0 {
			newAgentIdx[id] = newIdx
		}
	}
	m.agentMsgIdx = newAgentIdx

	if len(rendered) == 0 {
		return nil
	}
	return tea.Println(strings.Join(rendered, "\n"))
}

// focusInputMsg is sent after terminal probe responses have been consumed.
type focusInputMsg struct{}

// deferFocus returns a Cmd that sends focusInputMsg after a brief pause,
// giving BubbleTea time to consume terminal probe responses (OSC 11, DSR).
func deferFocus() tea.Cmd {
	return func() tea.Msg {
		time.Sleep(100 * time.Millisecond)
		return focusInputMsg{}
	}
}

// ── BubbleTea interface ─────────────────────────────────────────────────────

func (m model) Init() tea.Cmd {
	return tea.Batch(
		m.spinner.Tick,
		waitForEvent(m.backend), // start listening for backend events
		deferFocus(),            // focus input after terminal probes settle
	)
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {

	case focusInputMsg:
		// Only focus if idle — in prompt mode, handleReady may have already
		// transitioned to stateRunning and blurred the input before this
		// deferred message arrives.
		if m.state == stateIdle {
			m.input.Focus()
			cmds = append(cmds, textinput.Blink)
		}
		return m, tea.Batch(cmds...)

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.input.Width = m.width - inputWidthPadding
		m.multiLine.SetWidth(m.width - inputWidthPadding)
		// Update markdown cache width
		if m.mdCache != nil {
			m.mdCache.Invalidate(m.width)
		}
		// Falls through to tea.Batch(cmds...) below — cmds is empty here, so this is a no-op.

	case tea.KeyMsg:
		// Global keys
		switch msg.String() {
		case "ctrl+c":
			if m.state == stateRunning {
				m.backend.SendInterrupt()
				m.appendActive(&displayMessage{kind: msgSystem, content: "Interrupted"})
				return m, nil
			}
			return m, tea.Quit
		case "ctrl+d":
			return m, tea.Quit
		case "ctrl+o":
			m.verbose = !m.verbose
			return m, nil
		case "ctrl+e":
			if m.state == stateIdle {
				m.multiLineMode = !m.multiLineMode
				if m.multiLineMode {
					// Transfer content from single-line to multi-line
					m.multiLine.SetValue(m.input.Value())
					m.input.Blur()
					m.multiLine.Focus()
					m.multiLine.SetWidth(m.width - inputWidthPadding)
				} else {
					// Transfer back — join lines with spaces to avoid data loss
					val := m.multiLine.Value()
					val = strings.ReplaceAll(val, "\n", " ")
					val = strings.TrimSpace(val)
					m.input.SetValue(val)
					m.multiLine.Blur()
					m.input.Focus()
				}
				return m, nil
			}
		case "shift+tab":
			if m.state == stateIdle {
				newMode := nextPermMode(m.permMode)
				m.backend.SetPermissionMode(newMode)
				m.permMode = newMode
				return m, nil
			}
		}

		// State-specific key handling
		switch m.state {
		case stateIdle:
			// Multi-line mode: delegate most keys to textarea
			if m.multiLineMode {
				switch msg.String() {
				case "ctrl+enter":
					// Submit multi-line input
					text := strings.TrimSpace(m.multiLine.Value())
					if text == "" {
						return m, nil
					}
					m.multiLine.SetValue("")
					m.multiLineMode = false
					m.multiLine.Blur()

					// Format multi-line prompts: show first line + continuation count
					lines := strings.Split(text, "\n")
					displayText := lines[0]
					if len(lines) > 1 {
						displayText += fmt.Sprintf(" (+%d lines)", len(lines)-1)
					}
					updated, cmd := m.submitInput(text, displayText)
					return updated, cmd
				default:
					var cmd tea.Cmd
					m.multiLine, cmd = m.multiLine.Update(msg)
					return m, cmd
				}
			}

			switch msg.String() {
			case "up":
				if len(m.hist.entries) > 0 {
					if m.hist.idx == -1 {
						m.hist.saved = m.input.Value()
						m.hist.idx = len(m.hist.entries) - 1
					} else if m.hist.idx > 0 {
						m.hist.idx--
					}
					m.input.SetValue(m.hist.entries[m.hist.idx])
					m.input.CursorEnd()
					return m, nil
				}
			case "down":
				if m.hist.idx >= 0 {
					if m.hist.idx < len(m.hist.entries)-1 {
						m.hist.idx++
						m.input.SetValue(m.hist.entries[m.hist.idx])
					} else {
						m.hist.idx = -1
						m.input.SetValue(m.hist.saved)
					}
					m.input.CursorEnd()
					return m, nil
				}
			case "tab":
				text := m.input.Value()
				if strings.HasPrefix(text, "/") && !strings.Contains(text, " ") {
					completed := completeSlashCommand(text)
					if completed != "" {
						m.input.SetValue(completed)
						m.input.CursorEnd()
					}
					return m, nil
				}
				// Toggle collapse on last collapsible message
				if text == "" {
					for i := len(m.activeMsgs) - 1; i >= 0; i-- {
						msg := m.activeMsgs[i]
						if msg == nil {
							continue
						}
						if msg.kind == msgTool && msg.tool == "Agent" && msg.agentProg != nil && len(msg.agentProg.toolCalls) > 0 {
							msg.collapsed = !msg.collapsed
							break
						}
						if msg.kind == msgTool && msg.lineCount > collapseThreshold {
							msg.collapsed = !msg.collapsed
							if !msg.collapsed && msg.fullContent != "" {
								msg.summary = msg.fullContent
							}
							break
						}
					}
					return m, nil
				}
			case "enter":
				text := strings.TrimSpace(m.input.Value())
				if text == "" {
					return m, nil
				}
				m.input.SetValue("")
				m.hist.idx = -1

				// Slash commands
				if strings.HasPrefix(text, "/") {
					cmd := handleSlashCommand(&m, text)
					return m, cmd
				}

				// Println the user prompt into scrollback, then start the turn
				updated, cmd := m.submitInput(text, text)
				return updated, cmd

			default:
				var cmd tea.Cmd
				m.input, cmd = m.input.Update(msg)
				return m, cmd
			}

		case stateRunning:
			return m, nil

		case stateApproval:
			cmd := handleApprovalKey(&m, msg)
			return m, cmd

		case stateQuestion:
			cmd := handleQuestionKey(&m, msg)
			return m, cmd

		case statePlanReview, stateReason:
			cmd := handlePlanKey(&m, msg)
			return m, cmd

		case stateSessionPicker:
			cmd := handleSessionPickerKey(&m, msg)
			return m, cmd
		}

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		cmds = append(cmds, cmd)

		// Mid-stream flush: if managed area is getting too tall, Println
		// completed messages (tools, thinking) to scrollback to keep the
		// active area manageable. Keep only the streaming assistant message.
		if m.state == stateRunning && len(m.activeMsgs) > 5 && m.stream.pendingToolIdx < 0 {
			flushCmd := m.flushCompletedToScrollback()
			if flushCmd != nil {
				cmds = append(cmds, flushCmd)
			}
		}

	case gitStateMsg:
		m.gitBranch = msg.branch
		m.gitDirty = msg.dirty

	case parseErrorMsg:
		m.stats.parseErrors++
		if m.verbose {
			m.appendActive(&displayMessage{
				kind:    msgSystem,
				content: fmt.Sprintf("[parse error #%d] %s — %s", m.stats.parseErrors, msg.err.Error(), truncate(msg.raw, 120)),
			})
		}
		// Continue listening despite the error
		cmds = append(cmds, waitForEvent(m.backend))

	case agentEventMsg:
		cmd := processAgentEvent(&m, msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		// Chain: listen for the next event
		cmds = append(cmds, waitForEvent(m.backend))

	case backendDoneMsg:
		return m, tea.Quit
	}

	return m, tea.Batch(cmds...)
}

func (m model) View() string {
	var parts []string

	// Active turn messages (streaming content, tool progress, etc.)
	for _, msg := range m.activeMsgs {
		r := renderSingleMessage(msg, m.width, m.s, m.mdCache, m.verbose)
		if r != "" {
			parts = append(parts, r)
		}
	}

	// Spinner (if running)
	if m.state == stateRunning {
		parts = append(parts, m.renderSpinnerLine())
	}

	// Input bar + status bar (always shown)
	parts = append(parts, renderInput(&m))
	parts = append(parts, renderStatus(&m))

	return strings.Join(parts, "\n")
}

// renderSpinnerLine returns the spinner line shown while the agent is running.
func (m model) renderSpinnerLine() string {
	label := m.s.warn.Render("Waiting for response...")
	if m.stream.thinkingBuf.Len() > 0 {
		elapsed := time.Since(m.stream.thinkingStart).Truncate(time.Second)
		label = m.s.thinking.Render(fmt.Sprintf("∴ Thinking... (%s)", elapsed))
	} else if m.stream.turnTokens > 0 {
		label = m.s.warn.Render(fmt.Sprintf("Generating... %s tokens", formatNum(m.stream.turnTokens)))
	}
	return "  " + m.spinner.View() + " " + label
}

// flushAssistantText finalizes the streaming assistant message.
func (m *model) flushAssistantText() {
	if m.stream.assistantBuf.Len() == 0 {
		return
	}
	raw := m.stream.assistantBuf.String()
	m.stream.assistantBuf.Reset()
	m.stream.hadAssistant = false

	if m.stream.streamingMsgIdx >= 0 {
		msg := m.activeAt(m.stream.streamingMsgIdx)
		if msg != nil {
			msg.content = raw
			msg.streaming = false
		}
		m.stream.streamingMsgIdx = -1
	} else {
		m.appendActive(&displayMessage{
			kind:    msgAssistant,
			content: raw,
		})
	}
}

// flushThinking finalizes buffered thinking content.
func (m *model) flushThinking() {
	if m.stream.thinkingBuf.Len() == 0 {
		return
	}
	content := m.stream.thinkingBuf.String()
	m.stream.thinkingBuf.Reset()

	duration := time.Duration(0)
	if !m.stream.thinkingStart.IsZero() {
		duration = time.Since(m.stream.thinkingStart)
		m.stream.thinkingStart = time.Time{}
	}

	m.appendActive(&displayMessage{
		kind:     msgThinking,
		content:  content,
		duration: duration,
	})
}
