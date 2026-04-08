package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/chatml/chatml-core/agent"
	"github.com/chatml/chatml-core/loop"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/google/uuid"
)

// printBanner prints the welcome banner directly to stdout before BubbleTea starts.
func printBanner(modelName, permMode, workdir string, t theme) {
	brandStyle := lipgloss.NewStyle().Foreground(t.Banner)
	asciiArt := brandStyle.Render("" +
		"   ██████╗██╗  ██╗ █████╗ ████████╗███╗   ███╗██╗\n" +
		"  ██╔════╝██║  ██║██╔══██╗╚══██╔══╝████╗ ████║██║\n" +
		"  ██║     ███████║███████║   ██║   ██╔████╔██║██║\n" +
		"  ██║     ██╔══██║██╔══██║   ██║   ██║╚██╔╝██║██║\n" +
		"  ╚██████╗██║  ██║██║  ██║   ██║   ██║ ╚═╝ ██║███████╗\n" +
		"   ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝")
	fmt.Printf("\n%s\n\n  v%s · %s · %s\n  %s\n\n",
		asciiArt, version, modelName, modeBadge(permMode), workdir)
}

func main() {
	modelFlag := flag.String("model", defaultModel, "Model to use")
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
	maxBudget := flag.Float64("max-budget", 0, "Maximum session budget in USD (0=unlimited)")
	themeFlag := flag.String("theme", "auto", "Color theme: dark, light, auto")
	versionFlag := flag.Bool("version", false, "Print version and exit")
	flag.Parse()

	if *versionFlag {
		fmt.Printf("chatml %s\n", version)
		os.Exit(0)
	}

	// Resolve API key
	key := *apiKey
	if key == "" {
		key = os.Getenv("ANTHROPIC_API_KEY")
	}
	if key == "" {
		key = os.Getenv("OPENAI_API_KEY")
	}

	// First-run setup wizard
	if key == "" && detectFirstRun() {
		result := runWizard()
		if result != nil {
			key = result.APIKey
			if *modelFlag == defaultModel {
				*modelFlag = result.Model
			}
			if *mode == "bypassPermissions" {
				*mode = result.PermMode
			}
		}
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
		ConversationID:    uuid.New().String(),
		Workdir:           wd,
		Model:             *modelFlag,
		PermissionMode:    *mode,
		PlanMode:          *plan,
		FastMode:          *fast,
		MaxThinkingTokens: *thinking,
		Effort:            *effort,
		Instructions:      *instructions,
		MaxBudgetUsd:      *maxBudget,
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

	// Resolve theme once (avoids repeated terminal background queries)
	t := selectTheme(*themeFlag)

	// Print welcome banner before BubbleTea starts (avoids Init() Println race)
	printBanner(*modelFlag, *mode, wd, t)

	// Create the BubbleTea model
	m := newModel(backend, modelOpts{
		model:      *modelFlag,
		permMode:   *mode,
		fastMode:   *fast,
		workdir:    wd,
		verbose:    *verbose,
		promptMode: *prompt != "",
		promptText: *prompt,
		maxBudget:  *maxBudget,
		theme:      t,
	})

	// Detect git state for status bar
	m.gitBranch, m.gitDirty = detectGitState(wd)

	// Install panic recovery — writes crash report before exiting.
	// Note: &m points to the stack-local model; BubbleTea copies it, so crash
	// reports will contain initial state (not runtime state). The panic message
	// and stack trace — the most valuable parts — are always accurate.
	defer setupPanicRecovery(&m)()

	// Clean old crash reports and notify about recent crashes
	cleanOldCrashReports()
	if crash := checkRecentCrash(); crash != nil {
		// Use model styles for themed output (styles are initialized at this point)
		fmt.Printf("%s %s\n\n", m.s.warn.Render("  ⚠ Previous session crashed:"), truncate(crash.PanicMessage, 60))
	}

	// Create BubbleTea program — NO alt-screen so terminal scrollbar,
	// native text selection, and scrollback all work naturally.
	p := tea.NewProgram(m)

	// Run the TUI (event listener starts via Init() tea.Cmd — no goroutine race)
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error running TUI: %v\n", err)
		os.Exit(1)
	}

	// Shutdown: interrupt any in-flight operations, then stop.
	// Only send interrupt if the backend is still running (not already finished).
	select {
	case <-backend.Done():
		// Already finished — nothing to interrupt
	default:
		backend.SendInterrupt()
		backend.Stop()
		select {
		case <-backend.Done():
		case <-time.After(2 * time.Second):
			// Don't wait forever — force exit
		}
	}
}
