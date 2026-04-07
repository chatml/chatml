package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/chatml/chatml-core/agent"
	"github.com/chatml/chatml-core/loop"
	"github.com/google/uuid"
	"golang.org/x/term"
)

func main() {
	// Same flags as nativeloop
	modelFlag := flag.String("model", defaultModel, "Model to use")
	workdir := flag.String("workdir", "", "Working directory")
	mode := flag.String("mode", "bypassPermissions", "Permission mode")
	fast := flag.Bool("fast", false, "Fast mode")
	thinking := flag.Int("thinking", 0, "Thinking token budget")
	effort := flag.String("effort", "", "Reasoning effort: low, medium, high, max")
	instructions := flag.String("instructions", "", "Custom instructions")
	apiKey := flag.String("api-key", "", "API key")
	plan := flag.Bool("plan", false, "Start in plan mode")
	verbose := flag.Bool("verbose", false, "Verbose mode")
	prompt := flag.String("prompt", "", "Single prompt (non-interactive)")
	maxBudget := flag.Float64("max-budget", 0, "Max budget USD")
	versionFlag := flag.Bool("version", false, "Print version")
	flag.Parse()

	if *versionFlag {
		fmt.Printf("chatml %s\n", version)
		os.Exit(0)
	}

	// Resolve API key (same as nativeloop)
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

	// Get terminal width
	width := 100
	if w, _, err := term.GetSize(int(os.Stdout.Fd())); err == nil && w > 0 {
		width = w
	}

	// Create renderer
	r := newRenderer(os.Stdout, width)

	// Print banner
	r.printBanner(version, *modelFlag, *mode, wd)

	// Create backend via factory
	factory := loop.NewBackendFactory()
	opts := agent.ProcessOptions{
		ConversationID:    uuid.New().String(),
		Workdir:           wd,
		Model:             *modelFlag,
		PermissionMode:    *mode,
		FastMode:          *fast,
		MaxThinkingTokens: *thinking,
		Effort:            *effort,
		Instructions:      *instructions,
		PlanMode:          *plan,
		MaxBudgetUsd:      *maxBudget,
	}

	backend, err := factory(opts, key, "")
	if err != nil {
		r.printError(fmt.Sprintf("Failed to create backend: %v", err))
		os.Exit(1)
	}

	if err := backend.Start(); err != nil {
		r.printError(fmt.Sprintf("Failed to start backend: %v", err))
		os.Exit(1)
	}

	// Create the app state
	app := &appState{
		renderer: r,
		backend:  backend,
		model:    *modelFlag,
		permMode: *mode,
		fastMode: *fast,
		verbose:  *verbose,
		workdir:  wd,
		width:    width,
		spinner:  newSpinner(r.out),
		stats: sessionStats{
			startTime: time.Now(),
		},
	}

	// Handle Ctrl+C gracefully
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		for range sigCh {
			if app.isRunning() {
				_ = backend.SendInterrupt()
				app.spinner.Stop()
				r.printSystem("\nInterrupted")
			} else {
				r.printSystem("\nGoodbye!")
				os.Exit(0)
			}
		}
	}()

	// Start event processing goroutine
	go app.processEvents()

	// Non-interactive mode
	if *prompt != "" {
		app.setRunning(true)
		if err := backend.SendMessage(*prompt); err != nil {
			r.printError(fmt.Sprintf("Failed to send message: %v", err))
			os.Exit(1)
		}
		<-backend.Done()
		app.spinner.Stop()
		return
	}

	// Interactive readline loop
	app.runInputLoop()
}

// formatToolHeaderLocal wraps the shared formatToolHeader function.
// Duplicated here because the nativeloop version lives in messages.go which
// is not copied (it contains BubbleTea-specific code).
func formatToolHeaderLocal(tool string, params string) string {
	return formatToolHeader(tool, params)
}

// cleanSummaryLocal wraps the shared cleanSummary function.
func cleanSummaryLocal(s string) string {
	return cleanSummary(s)
}

// buildToolDetailsLocal wraps shared function (defined in events.go of nativeloop,
// but the dispatch logic is simple enough to inline here).
func buildToolDetailsLocal(tool string, params map[string]interface{}, s *styles, workdir string) []string {
	if params == nil {
		return nil
	}
	if r, ok := toolRenderers[tool]; ok && r.buildDetails != nil {
		return r.buildDetails(params, s, workdir)
	}
	return nil
}

// enrichToolSummaryLocal wraps shared function.
func enrichToolSummaryLocal(tool, summary string, params map[string]interface{}, s *styles) string {
	if r, ok := toolRenderers[tool]; ok && r.enrichSummary != nil {
		return r.enrichSummary(summary, params)
	}
	return summary
}

// formatToolHeader formats a tool header line like "  Read path/to/file".
func formatToolHeader(tool string, params string) string {
	switch tool {
	case "Read", "Write", "Edit", "Bash", "Glob", "Grep":
		if params != "" {
			p := params
			if len(p) > maxSummaryWidth {
				p = p[:maxSummaryWidth-3] + "..."
			}
			return "  " + tool + " " + p
		}
		return "  " + tool
	case "Agent":
		if params != "" {
			p := params
			if len(p) > maxHeaderWidth {
				p = p[:maxHeaderWidth-3] + "..."
			}
			return "  " + tool + "(" + p + ")"
		}
		return "  " + tool
	case "TodoWrite":
		return "" // Hidden
	default:
		if params != "" {
			p := params
			if len(p) > maxHeaderWidth {
				p = p[:maxHeaderWidth-3] + "..."
			}
			return "  " + tool + "(" + p + ")"
		}
		return "  " + tool
	}
}

// cleanSummary truncates a tool result summary to a single line, max 80 chars.
func cleanSummary(s string) string {
	// Take only the first line
	if idx := indexByte(s, '\n'); idx >= 0 {
		s = s[:idx]
	}
	if len(s) > maxSummaryWidth {
		s = s[:maxSummaryWidth-3] + "..."
	}
	if s == "" {
		s = "done"
	}
	return s
}

// indexByte returns the index of the first instance of c in s, or -1.
func indexByte(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
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

// json is used in app.go for event processing
