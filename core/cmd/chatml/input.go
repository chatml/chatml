package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chzyer/readline"
)

func (a *appState) runInputLoop() {
	// Build autocomplete from command registry
	var items []readline.PrefixCompleterInterface
	for _, cmd := range cmdRegistry {
		items = append(items, readline.PcItem("/"+cmd.name))
	}
	completer := readline.NewPrefixCompleter(items...)

	historyFile := ""
	home, err := os.UserHomeDir()
	if err == nil {
		historyFile = filepath.Join(home, ".chatml", "history")
		_ = os.MkdirAll(filepath.Join(home, ".chatml"), 0755)
	}

	rl, err := readline.NewEx(&readline.Config{
		Prompt:          "\033[32m>\033[0m ",
		HistoryFile:     historyFile,
		AutoComplete:    completer,
		InterruptPrompt: "^C",
		EOFPrompt:       "exit",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "readline error: %v\n", err)
		return
	}
	defer rl.Close()

	for {
		// Show status before prompt (read under lock to avoid data race with processEvents)
		a.mu.Lock()
		model := a.model
		mode := a.permMode
		cost := a.stats.totalCost
		start := a.stats.startTime
		a.mu.Unlock()
		a.renderer.printStatusLine(model, mode, cost, start)

		line, err := rl.Readline()
		if err != nil {
			if err == readline.ErrInterrupt {
				if a.isRunning() {
					_ = a.backend.SendInterrupt()
					continue
				}
				break
			}
			if err == io.EOF {
				break
			}
			continue
		}

		text := strings.TrimSpace(line)
		if text == "" {
			continue
		}

		// Slash commands
		if strings.HasPrefix(text, "/") {
			a.handleSlashCommand(text)
			continue
		}

		// Send to backend
		a.renderer.printUser(text)
		a.mu.Lock()
		a.running = true
		a.turnDone = make(chan struct{})
		a.stats.turnStartTime = time.Now()
		a.mu.Unlock()

		a.spinner.Start("Generating...")
		_ = a.backend.SendMessage(text)

		// Wait for turn to complete before showing next prompt
		a.waitForTurnComplete()
	}

	a.renderer.printSystem("Goodbye!")
}

func (a *appState) waitForTurnComplete() {
	a.mu.Lock()
	ch := a.turnDone
	a.mu.Unlock()
	if ch != nil {
		<-ch
	}
}

func (a *appState) handleSlashCommand(input string) {
	parts := strings.Fields(input)
	name := strings.TrimPrefix(parts[0], "/")
	args := parts[1:]

	for _, cmd := range cmdRegistry {
		if cmd.name == name {
			if len(args) < cmd.minArgs {
				a.renderer.printError("Usage: " + cmd.usage)
				return
			}
			cmd.handler(a, args)
			return
		}
	}
	a.renderer.printError("Unknown command: /" + name + " (try /help)")
}
