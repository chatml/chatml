// Package main provides an interactive CLI for testing the ChatML native Go
// agentic loop directly, without the HTTP server or frontend. Similar to
// Claude Code's CLI — type a message, see streaming output, approve tools.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/loop"
	"github.com/charmbracelet/lipgloss"
	"github.com/google/uuid"
)

// ── Defaults ────────────────────────────────────────────────────────────────

const defaultModel = "claude-sonnet-4-6"

// ── Lipgloss styles ─────────────────────────────────────────────────────────

type styles struct {
	banner    lipgloss.Style
	prompt    lipgloss.Style
	thinking  lipgloss.Style
	toolStart lipgloss.Style
	toolOK    lipgloss.Style
	toolFail  lipgloss.Style
	errStyle  lipgloss.Style
	warn      lipgloss.Style
	gray      lipgloss.Style
	cmd       lipgloss.Style
	todo      lipgloss.Style
}

func newStyles() *styles {
	return &styles{
		banner:    lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#7C3AED")),
		prompt:    lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#22C55E")),
		thinking:  lipgloss.NewStyle().Italic(true).Foreground(lipgloss.Color("#94A3B8")),
		toolStart: lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#3B82F6")),
		toolOK:    lipgloss.NewStyle().Foreground(lipgloss.Color("#22C55E")),
		toolFail:  lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#EF4444")),
		errStyle:  lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#EF4444")),
		warn:      lipgloss.NewStyle().Foreground(lipgloss.Color("#F59E0B")),
		gray:      lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280")),
		cmd:       lipgloss.NewStyle().Foreground(lipgloss.Color("#A78BFA")),
		todo:      lipgloss.NewStyle().Foreground(lipgloss.Color("#60A5FA")),
	}
}

// ── CLI state ───────────────────────────────────────────────────────────────

type cliState int32

const (
	stateIdle     cliState = iota
	stateRunning
	stateApproval
	stateQuestion
	statePlanReview
)

type cli struct {
	mu      sync.Mutex
	backend agent.ConversationBackend
	s       *styles
	state   atomic.Int32 // cliState
	ready   chan struct{}
	verbose bool

	// Current config
	model    string
	fastMode bool
	permMode string
	workdir  string

	// Pending interactive request
	pendingApprovalID string
	pendingQuestionID string
	pendingQuestions  []agent.UserQuestion
	pendingPlanID     string

	// Tracking
	hadAssistantText bool
	thinkingBuf      strings.Builder // accumulates thinking chunks; flushed on next non-thinking event
	pendingTodos     []agent.TodoItem // deferred until turn_complete
	history          []string         // user messages for /history

	// Non-interactive mode: send prompt then exit
	promptMode  bool
	promptDone  chan struct{}
}

func (c *cli) getState() cliState  { return cliState(c.state.Load()) }
func (c *cli) setState(s cliState) { c.state.Store(int32(s)) }

// ── main ────────────────────────────────────────────────────────────────────

func main() {
	model := flag.String("model", defaultModel, "Model to use")
	workdir := flag.String("workdir", "", "Working directory (default: current)")
	mode := flag.String("mode", "bypassPermissions", "Permission mode")
	fast := flag.Bool("fast", false, "Enable fast mode")
	thinking := flag.Int("thinking", 0, "Thinking token budget (0=disabled)")
	effort := flag.String("effort", "", "Reasoning effort: low, medium, high, max")
	instructions := flag.String("instructions", "", "Custom system instructions")
	apiKey := flag.String("api-key", "", "API key (default: ANTHROPIC_API_KEY env)")
	plan := flag.Bool("plan", false, "Start in plan mode")
	verbose := flag.Bool("verbose", false, "Show debug events")
	prompt := flag.String("prompt", "", "Send a single prompt and exit (non-interactive)")
	flag.Parse()

	// Resolve API key
	key := *apiKey
	if key == "" {
		key = os.Getenv("ANTHROPIC_API_KEY")
	}
	if key == "" {
		key = os.Getenv("OPENAI_API_KEY")
	}
	if key == "" {
		fmt.Fprintln(os.Stderr, "Error: No API key. Set ANTHROPIC_API_KEY or use --api-key")
		os.Exit(1)
	}

	// Resolve workdir
	wd := *workdir
	if wd == "" {
		var err error
		wd, err = os.Getwd()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
	}

	// Build ProcessOptions
	opts := agent.ProcessOptions{
		ConversationID: uuid.New().String(),
		Workdir:        wd,
		Model:          *model,
		PermissionMode: *mode,
		PlanMode:       *plan,
		FastMode:       *fast,
		MaxThinkingTokens: *thinking,
		Effort:         *effort,
		Instructions:   *instructions,
	}

	// Create backend via factory
	factory := loop.NewBackendFactory()
	backend, err := factory(opts, key, "")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating backend: %v\n", err)
		os.Exit(1)
	}

	if err := backend.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Error starting backend: %v\n", err)
		os.Exit(1)
	}

	c := &cli{
		backend:    backend,
		s:          newStyles(),
		ready:      make(chan struct{}),
		verbose:    *verbose,
		model:      *model,
		fastMode:   *fast,
		permMode:   *mode,
		workdir:    wd,
		promptMode: *prompt != "",
		promptDone: make(chan struct{}),
	}

	// Signal handling: Ctrl+C interrupts turn, doesn't exit
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT)
	go func() {
		for range sigCh {
			if c.getState() == stateRunning {
				c.backend.SendInterrupt()
			} else {
				if !c.promptMode {
					c.mu.Lock()
					fmt.Println("\n" + c.s.gray.Render("Use /quit or Ctrl+D to exit"))
					c.printPrompt()
					c.mu.Unlock()
				}
			}
		}
	}()

	if !c.promptMode {
		c.printBanner()
	}
	go c.eventLoop()

	// Wait for ready event
	select {
	case <-c.ready:
	case <-time.After(30 * time.Second):
		fmt.Fprintln(os.Stderr, "Timeout waiting for backend ready")
		os.Exit(1)
	}

	if c.promptMode {
		c.setState(stateRunning)
		if err := c.backend.SendMessage(*prompt); err != nil {
			fmt.Fprintf(os.Stderr, "Error sending prompt: %v\n", err)
			os.Exit(1)
		}
		<-c.promptDone
		c.backend.Stop()
		select {
		case <-c.backend.Done():
		case <-time.After(5 * time.Second):
		}
		return
	}

	c.run()
}

// ── Banner ──────────────────────────────────────────────────────────────────

func (c *cli) printBanner() {
	border := lipgloss.NewStyle().
		BorderStyle(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("#7C3AED")).
		Padding(0, 1)

	content := fmt.Sprintf(
		"%s\n%s\n%s\n%s",
		c.s.banner.Render("ChatML Native Loop"),
		c.s.gray.Render(fmt.Sprintf("Model: %s", c.model)),
		c.s.gray.Render(fmt.Sprintf("Workdir: %s", c.workdir)),
		c.s.gray.Render("Type /help for commands, Ctrl+C to interrupt"),
	)
	fmt.Println(border.Render(content))
}

// ── REPL loop ───────────────────────────────────────────────────────────────

func (c *cli) run() {
	scanner := bufio.NewScanner(os.Stdin)
	var multiLine strings.Builder

	c.printPrompt()

	for scanner.Scan() {
		line := scanner.Text()

		// Multi-line: line ending with \ continues
		if strings.HasSuffix(line, "\\") {
			multiLine.WriteString(strings.TrimSuffix(line, "\\"))
			multiLine.WriteString("\n")
			fmt.Print("... ")
			continue
		}

		// Complete multi-line or use single line
		if multiLine.Len() > 0 {
			multiLine.WriteString(line)
			line = multiLine.String()
			multiLine.Reset()
		}

		line = strings.TrimSpace(line)
		if line == "" {
			c.printPrompt()
			continue
		}

		// Handle state-specific input
		switch c.getState() {
		case stateApproval:
			c.handleApprovalInput(line)
			continue
		case stateQuestion:
			c.handleQuestionInput(line)
			continue
		case statePlanReview:
			c.handlePlanInput(line)
			continue
		}

		// Slash commands
		if strings.HasPrefix(line, "/") {
			done := c.handleSlashCommand(line)
			if done {
				return
			}
			c.printPrompt()
			continue
		}

		// Track history
		c.history = append(c.history, line)

		// Send message to agent
		c.setState(stateRunning)
		c.hadAssistantText = false
		if err := c.backend.SendMessage(line); err != nil {
			c.mu.Lock()
			fmt.Println(c.s.errStyle.Render("  ✗ Failed to send: " + err.Error()))
			c.mu.Unlock()
			c.setState(stateIdle)
			c.printPrompt()
		}
	}

	// EOF (Ctrl+D)
	c.shutdown()
}

// ── Slash commands ──────────────────────────────────────────────────────────

// handleSlashCommand processes a slash command. Returns true if the CLI should exit.
func (c *cli) handleSlashCommand(input string) bool {
	parts := strings.Fields(input)
	cmd := parts[0]

	switch cmd {
	case "/quit", "/exit":
		c.shutdown()
		return true

	case "/help":
		fmt.Println(c.s.cmd.Render("Commands:"))
		fmt.Println("  /quit          Exit")
		fmt.Println("  /model <name>  Switch model")
		fmt.Println("  /mode <mode>   Switch permission mode (bypass/default/acceptEdits/plan/dontAsk)")
		fmt.Println("  /fast          Toggle fast mode")
		fmt.Println("  /thinking <N>  Set thinking budget")
		fmt.Println("  /status        Show current settings")
		fmt.Println("  /clear         Clear terminal")
		fmt.Println("  /interrupt     Interrupt current turn")
		fmt.Println("  /compact       Trigger conversation compaction")
		fmt.Println("  /history       Show sent messages this session")
		fmt.Println("  /reset         Clear conversation and start fresh")
		fmt.Println()
		fmt.Println("  Ctrl+C         Interrupt during turn")
		fmt.Println("  Ctrl+D         Exit")
		fmt.Println("  \\              Continue multi-line input")

	case "/model":
		if len(parts) < 2 {
			fmt.Println(c.s.errStyle.Render("Usage: /model <name>"))
			return false
		}
		name := parts[1]
		c.backend.SetModel(name)
		c.model = name
		fmt.Println(c.s.gray.Render("  Model → " + name))

	case "/mode":
		if len(parts) < 2 {
			fmt.Println(c.s.errStyle.Render("Usage: /mode <bypass|default|acceptEdits|plan|dontAsk>"))
			return false
		}
		mode := parts[1]
		// Normalize shorthand
		if mode == "bypass" {
			mode = "bypassPermissions"
		}
		c.backend.SetPermissionMode(mode)
		c.permMode = mode
		fmt.Println(c.s.gray.Render("  Permission mode → " + mode))

	case "/fast":
		c.fastMode = !c.fastMode
		c.backend.SetFastMode(c.fastMode)
		state := "off"
		if c.fastMode {
			state = "on"
		}
		fmt.Println(c.s.gray.Render("  Fast mode → " + state))

	case "/thinking":
		if len(parts) < 2 {
			fmt.Println(c.s.errStyle.Render("Usage: /thinking <N>"))
			return false
		}
		n, err := strconv.Atoi(parts[1])
		if err != nil {
			fmt.Println(c.s.errStyle.Render("Invalid number: " + parts[1]))
			return false
		}
		c.backend.SetMaxThinkingTokens(n)
		fmt.Println(c.s.gray.Render(fmt.Sprintf("  Thinking budget → %d tokens", n)))

	case "/status":
		fmt.Println(c.s.gray.Render(fmt.Sprintf("  Model:    %s", c.model)))
		fmt.Println(c.s.gray.Render(fmt.Sprintf("  Mode:     %s", c.permMode)))
		fmt.Println(c.s.gray.Render(fmt.Sprintf("  Fast:     %v", c.fastMode)))
		fmt.Println(c.s.gray.Render(fmt.Sprintf("  Workdir:  %s", c.workdir)))

	case "/clear":
		fmt.Print("\033[H\033[2J")
		c.printBanner()

	case "/interrupt":
		if c.getState() == stateRunning {
			c.backend.SendInterrupt()
		} else {
			fmt.Println(c.s.gray.Render("  No active turn to interrupt"))
		}

	case "/compact":
		c.setState(stateRunning)
		if err := c.backend.SendMessage("/compact"); err != nil {
			fmt.Println(c.s.errStyle.Render("  ✗ Failed to send compact: " + err.Error()))
			c.setState(stateIdle)
		}

	case "/history":
		if len(c.history) == 0 {
			fmt.Println(c.s.gray.Render("  No messages sent yet."))
		} else {
			fmt.Println(c.s.cmd.Render("  Message history:"))
			for i, msg := range c.history {
				preview := msg
				if len(preview) > 120 {
					preview = preview[:117] + "..."
				}
				fmt.Println(c.s.gray.Render(fmt.Sprintf("  [%d] %s", i+1, preview)))
			}
		}

	case "/reset":
		c.mu.Lock()
		c.history = nil
		c.thinkingBuf.Reset()
		c.pendingTodos = nil
		c.hadAssistantText = false
		c.mu.Unlock()
		// Send /reset to backend to clear its conversation state
		c.setState(stateRunning)
		if err := c.backend.SendMessage("/reset"); err != nil {
			fmt.Println(c.s.errStyle.Render("  ✗ Failed to reset: " + err.Error()))
			c.setState(stateIdle)
		} else {
			fmt.Println(c.s.gray.Render("  Conversation reset."))
		}

	default:
		fmt.Println(c.s.errStyle.Render("Unknown command: " + cmd + " (try /help)"))
	}
	return false
}

// ── Event loop ──────────────────────────────────────────────────────────────

func (c *cli) eventLoop() {
	for line := range c.backend.Output() {
		var event agent.AgentEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			if c.verbose {
				fmt.Fprintf(os.Stderr, "[parse error] %s\n", line)
			}
			continue
		}
		c.renderEvent(&event)
	}
}

// ── Event rendering ─────────────────────────────────────────────────────────

func (c *cli) renderEvent(e *agent.AgentEvent) {
	c.mu.Lock()
	defer c.mu.Unlock()

	switch e.Type {
	case "ready":
		select {
		case <-c.ready:
		default:
			close(c.ready)
		}

	case "session_started":
		if c.verbose {
			fmt.Println(c.s.gray.Render(fmt.Sprintf("  Session: %s", e.SessionID)))
		}

	case "assistant_text":
		c.flushThinking()
		fmt.Print(e.Content)
		c.hadAssistantText = true

	case "thinking":
		c.thinkingBuf.WriteString(e.Content)

	case "tool_start":
		c.flushThinking()
		if c.hadAssistantText {
			fmt.Println()
			c.hadAssistantText = false
		}
		param := extractToolParam(e)
		if param != "" {
			fmt.Println(c.s.toolStart.Render(fmt.Sprintf("  ⚙ %s %s", e.Tool, param)))
		} else {
			fmt.Println(c.s.toolStart.Render(fmt.Sprintf("  ⚙ %s", e.Tool)))
		}

	case "tool_end":
		summary := e.Summary
		if len(summary) > 100 {
			summary = summary[:100] + "..."
		}
		if e.Success {
			fmt.Println(c.s.toolOK.Render(fmt.Sprintf("  ✓ %s — %s", e.Tool, summary)))
		} else {
			fmt.Println(c.s.toolFail.Render(fmt.Sprintf("  ✗ %s — %s", e.Tool, summary)))
		}

	case "tool_approval_request":
		c.pendingApprovalID = e.RequestID
		fmt.Println()
		toolName := e.ToolName
		if len(toolName) > 40 {
			toolName = toolName[:37] + "..."
		}
		spec := e.Specifier
		if len(spec) > 40 {
			spec = spec[:37] + "..."
		}
		fmt.Println(c.s.warn.Render("  ┌─ Tool Approval Required ───────────────────┐"))
		fmt.Println(c.s.warn.Render(fmt.Sprintf("  │ Tool:   %-38s │", toolName)))
		if spec != "" {
			fmt.Println(c.s.warn.Render(fmt.Sprintf("  │ Target: %-38s │", spec)))
		}
		fmt.Println(c.s.warn.Render("  │                                             │"))
		fmt.Println(c.s.warn.Render("  │ [y] Allow once  [n] Deny  [a] Session       │"))
		fmt.Println(c.s.warn.Render("  └─────────────────────────────────────────────┘"))
		fmt.Print("  > ")
		c.setState(stateApproval)

	case "user_question_request":
		c.pendingQuestionID = e.RequestID
		c.pendingQuestions = e.Questions
		fmt.Println()
		fmt.Println(c.s.warn.Render("  ┌─ Question from Agent ─────────────────────┐"))
		for i, q := range e.Questions {
			fmt.Println(c.s.warn.Render(fmt.Sprintf("  │ [%d] %-38s │", i+1, q.Question)))
			for j, opt := range q.Options {
				letter := string(rune('a' + j))
				fmt.Println(c.s.warn.Render(fmt.Sprintf("  │     (%s) %-34s │", letter, opt.Label)))
			}
		}
		fmt.Println(c.s.warn.Render("  └───────────────────────────────────────────┘"))
		fmt.Print("  > ")
		c.setState(stateQuestion)

	case "plan_approval_request":
		c.pendingPlanID = e.RequestID
		fmt.Println()
		fmt.Println(c.s.warn.Render("  ┌─ Plan Ready for Review ───────────────────┐"))
		fmt.Println(c.s.warn.Render("  │ [a] Approve and proceed                   │"))
		fmt.Println(c.s.warn.Render("  │ [r] Reject with feedback                  │"))
		fmt.Println(c.s.warn.Render("  └───────────────────────────────────────────┘"))
		fmt.Print("  > ")
		c.setState(statePlanReview)

	case "result":
		if c.hadAssistantText {
			fmt.Println()
			c.hadAssistantText = false
		}
		c.renderUsageStats(e)

	case "turn_complete":
		c.flushThinking()
		if c.hadAssistantText {
			fmt.Println()
			c.hadAssistantText = false
		}
		// Render any deferred todos
		if len(c.pendingTodos) > 0 {
			c.renderTodosLocked(c.pendingTodos)
			c.pendingTodos = nil
		}
		c.setState(stateIdle)
		if c.promptMode {
			select {
			case <-c.promptDone:
			default:
				close(c.promptDone)
			}
			return
		}
		c.printPrompt()

	case "error":
		fmt.Println(c.s.errStyle.Render(fmt.Sprintf("  ✗ Error: %s", e.Message)))

	case "complete":
		fmt.Println(c.s.gray.Render("\n  Session complete."))
		if c.promptMode {
			select {
			case <-c.promptDone:
			default:
				close(c.promptDone)
			}
			return
		}
		go c.shutdown()

	case "context_warning":
		fmt.Println(c.s.warn.Render(fmt.Sprintf("  ⚠ %s", e.Message)))

	case "context_usage":
		if c.verbose {
			pct := 0
			if e.ContextWindow > 0 {
				pct = (e.InputTokens + e.OutputTokens) * 100 / e.ContextWindow
			}
			fmt.Println(c.s.gray.Render(fmt.Sprintf("  Context: %d in / %d out / %d window (%d%%)",
				e.InputTokens, e.OutputTokens, e.ContextWindow, pct)))
		}

	case "todo_update":
		// Defer to turn_complete to avoid interrupting streaming output
		c.pendingTodos = e.Todos

	case "permission_mode_changed":
		fmt.Println(c.s.gray.Render(fmt.Sprintf("  Mode changed to: %s", e.Mode)))

	default:
		if c.verbose {
			fmt.Println(c.s.gray.Render(fmt.Sprintf("  [%s] %s", e.Type, truncate(line2str(e), 80))))
		}
	}
}

// ── Approval handling ───────────────────────────────────────────────────────

func (c *cli) handleApprovalInput(input string) {
	input = strings.TrimSpace(strings.ToLower(input))
	var action string
	switch input {
	case "y", "yes":
		action = "allow_once"
	case "n", "no":
		action = "deny_once"
	case "a", "always", "s", "session":
		action = "allow_session"
	default:
		fmt.Print("  Invalid. [y/n/a] > ")
		return
	}

	if err := c.backend.SendToolApprovalResponse(c.pendingApprovalID, action, "", nil); err != nil {
		c.mu.Lock()
		fmt.Println(c.s.errStyle.Render("  Error: " + err.Error()))
		c.mu.Unlock()
	}
	c.setState(stateRunning)
}

// ── Question handling ───────────────────────────────────────────────────────

func (c *cli) handleQuestionInput(input string) {
	input = strings.TrimSpace(input)
	answers := make(map[string]string)
	for i, q := range c.pendingQuestions {
		answer := input
		if len(q.Options) > 0 && len(input) > 0 {
			idx := int(input[0]) - int('a')
			if idx >= 0 && idx < len(q.Options) {
				answer = q.Options[idx].Label
			}
		}
		answers[fmt.Sprintf("%d", i)] = answer
	}

	if err := c.backend.SendUserQuestionResponse(c.pendingQuestionID, answers); err != nil {
		c.mu.Lock()
		fmt.Println(c.s.errStyle.Render("  Error: " + err.Error()))
		c.mu.Unlock()
	}
	c.setState(stateRunning)
}

// ── Plan approval handling ──────────────────────────────────────────────────

func (c *cli) handlePlanInput(input string) {
	input = strings.TrimSpace(strings.ToLower(input))
	switch input {
	case "a", "approve", "y", "yes":
		c.backend.SendPlanApprovalResponse(c.pendingPlanID, true, "")
		c.mu.Lock()
		fmt.Println(c.s.toolOK.Render("  Plan approved."))
		c.mu.Unlock()
	case "r", "reject", "n", "no":
		fmt.Print("  Reason (optional): ")
		scanner := bufio.NewScanner(os.Stdin)
		reason := ""
		if scanner.Scan() {
			reason = scanner.Text()
		}
		c.backend.SendPlanApprovalResponse(c.pendingPlanID, false, reason)
	default:
		fmt.Print("  [a]pprove / [r]eject > ")
		return
	}
	c.setState(stateRunning)
}

// ── Todos ───────────────────────────────────────────────────────────────────

// renderTodosLocked renders the todo list. Must be called with c.mu held.
func (c *cli) renderTodosLocked(todos []agent.TodoItem) {
	if len(todos) == 0 {
		return
	}
	fmt.Println(c.s.todo.Render("  📋 Tasks:"))
	for _, t := range todos {
		icon := "[ ]"
		switch t.Status {
		case "in_progress":
			icon = "[~]"
		case "completed":
			icon = "[x]"
		}
		fmt.Println(c.s.todo.Render(fmt.Sprintf("   %s %s", icon, t.Content)))
	}
}

// ── Usage stats ─────────────────────────────────────────────────────────────

func (c *cli) renderUsageStats(e *agent.AgentEvent) {
	if e.Usage == nil {
		return
	}
	inputTokens := 0
	outputTokens := 0
	if v, ok := e.Usage["input_tokens"]; ok {
		if f, ok := v.(float64); ok {
			inputTokens = int(f)
		}
	}
	if v, ok := e.Usage["output_tokens"]; ok {
		if f, ok := v.(float64); ok {
			outputTokens = int(f)
		}
	}
	cost := e.Cost
	turns := e.Turns

	stats := fmt.Sprintf("  Tokens: %d in / %d out", inputTokens, outputTokens)
	if cost > 0 {
		stats += fmt.Sprintf("  Cost: $%.4f", cost)
	}
	if turns > 0 {
		stats += fmt.Sprintf("  (%d turn(s))", turns)
	}
	fmt.Println(c.s.gray.Render(stats))
}

// ── Helpers ─────────────────────────────────────────────────────────────────

func (c *cli) printPrompt() {
	fmt.Print(c.s.prompt.Render("> "))
}

// flushThinking renders buffered thinking content and resets the buffer.
// Must be called with c.mu held.
func (c *cli) flushThinking() {
	if c.thinkingBuf.Len() == 0 {
		return
	}
	content := c.thinkingBuf.String()
	c.thinkingBuf.Reset()
	// Truncate very long thinking blocks for readability
	if len(content) > 500 {
		content = content[:500] + "…"
	}
	fmt.Println(c.s.thinking.Render("[thinking] " + content))
}

func (c *cli) shutdown() {
	fmt.Println(c.s.gray.Render("\n  Shutting down..."))
	c.backend.Stop()

	select {
	case <-c.backend.Done():
	case <-time.After(5 * time.Second):
		fmt.Fprintln(os.Stderr, "  Timeout waiting for backend shutdown")
	}

	fmt.Println(c.s.gray.Render("  Goodbye."))
}

func extractToolParam(e *agent.AgentEvent) string {
	if e.Params == nil {
		return ""
	}
	// Try common param keys
	for _, key := range []string{"command", "file_path", "pattern", "url", "query"} {
		if v, ok := e.Params[key]; ok {
			s := fmt.Sprintf("%v", v)
			if len(s) > 80 {
				s = s[:77] + "..."
			}
			return s
		}
	}
	return ""
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-3] + "..."
}

func line2str(e *agent.AgentEvent) string {
	data, _ := json.Marshal(e)
	return string(data)
}
