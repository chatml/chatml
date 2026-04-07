package main

import (
	"fmt"
	"os"
	"strings"
	"time"
)

type slashCmd struct {
	name    string
	desc    string
	usage   string
	minArgs int
	handler func(a *appState, args []string)
}

var cmdRegistry []slashCmd

func init() {
	cmdRegistry = []slashCmd{
		{"quit", "Exit", "", 0, cmdQuit},
		{"exit", "Exit", "", 0, cmdQuit},
		{"help", "Show commands", "", 0, cmdHelp},
		{"model", "Switch model", "/model <name>", 1, cmdModel},
		{"mode", "Permission mode", "/mode <mode>", 1, cmdMode},
		{"fast", "Toggle fast mode", "", 0, cmdFast},
		{"status", "Show status", "", 0, cmdStatus},
		{"cost", "Show cost", "", 0, cmdCost},
		{"verbose", "Toggle verbose", "", 0, cmdVerbose},
		{"compact", "Trigger compaction", "", 0, cmdCompact},
		{"doctor", "Run diagnostics", "", 0, cmdDoctor},
	}
}

func cmdQuit(a *appState, _ []string) {
	a.renderer.printSystem("Goodbye!")
	a.backend.Stop()
	os.Exit(0)
}

func cmdHelp(a *appState, _ []string) {
	var sb strings.Builder
	sb.WriteString("Commands:\n")
	for _, cmd := range cmdRegistry {
		usage := "/" + cmd.name
		if cmd.usage != "" {
			usage = cmd.usage
		}
		sb.WriteString(fmt.Sprintf("  %-20s %s\n", usage, cmd.desc))
	}
	sb.WriteString("\n  Ctrl+C             Interrupt / quit")
	a.renderer.printSystem(sb.String())
}

func cmdModel(a *appState, args []string) {
	name := args[0]
	if err := a.backend.SetModel(name); err != nil {
		a.renderer.printError("Failed to set model: " + err.Error())
		return
	}
	a.mu.Lock()
	a.model = name
	a.mu.Unlock()
	a.renderer.printSystem("Model -> " + name)
}

func cmdMode(a *appState, args []string) {
	mode := args[0]
	if mode == "bypass" {
		mode = "bypassPermissions"
	}
	if err := a.backend.SetPermissionMode(mode); err != nil {
		a.renderer.printError("Failed to set mode: " + err.Error())
		return
	}
	a.mu.Lock()
	a.permMode = mode
	a.mu.Unlock()
	a.renderer.printSystem("Mode -> " + mode)
}

func cmdFast(a *appState, _ []string) {
	a.mu.Lock()
	a.fastMode = !a.fastMode
	fast := a.fastMode
	a.mu.Unlock()
	if err := a.backend.SetFastMode(fast); err != nil {
		a.renderer.printError("Failed to set fast mode: " + err.Error())
		// Revert local state
		a.mu.Lock()
		a.fastMode = !a.fastMode
		a.mu.Unlock()
		return
	}
	state := "off"
	if fast {
		state = "on"
	}
	a.renderer.printSystem("Fast mode -> " + state)
}

func cmdStatus(a *appState, _ []string) {
	a.mu.Lock()
	status := fmt.Sprintf("Model: %s\nMode: %s\nFast: %v\nVerbose: %v\nWorkdir: %s\nTurns: %d\nCost: $%.4f\nDuration: %s",
		a.model, a.permMode, a.fastMode, a.verbose, a.workdir,
		a.stats.totalTurns, a.stats.totalCost,
		time.Since(a.stats.startTime).Truncate(time.Second))
	a.mu.Unlock()
	a.renderer.printSystem(status)
}

func cmdCost(a *appState, _ []string) {
	a.mu.Lock()
	cost := fmt.Sprintf("Session Cost: $%.4f\nTurns: %d\nTokens: %s in | %s out",
		a.stats.totalCost, a.stats.totalTurns,
		formatNum(a.stats.totalInputTokens), formatNum(a.stats.totalOutputTokens))
	a.mu.Unlock()
	a.renderer.printSystem(cost)
}

func cmdVerbose(a *appState, _ []string) {
	a.mu.Lock()
	a.verbose = !a.verbose
	v := a.verbose
	a.mu.Unlock()
	state := "off"
	if v {
		state = "on"
	}
	a.renderer.printSystem("Verbose -> " + state)
}

func cmdCompact(a *appState, _ []string) {
	a.renderer.printSystem("Compacting...")
	_ = a.backend.SendMessage("/compact")
}

func cmdDoctor(a *appState, _ []string) {
	report := runDoctor(a.workdir)
	a.renderer.printSystem(report)
}
