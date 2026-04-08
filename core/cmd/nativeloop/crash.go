package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
	"sort"
	"time"
)

// crashReport stores essential session state for post-crash diagnostics.
type crashReport struct {
	Timestamp    string   `json:"timestamp"`
	PanicMessage string   `json:"panic"`
	StackTrace   string   `json:"stackTrace"`
	SessionID    string   `json:"sessionId,omitempty"`
	Model        string   `json:"model"`
	Workdir      string   `json:"workdir"`
	TotalCost    float64  `json:"totalCost"`
	TotalTurns   int      `json:"totalTurns"`
	LastCommands []string `json:"lastCommands,omitempty"`
	Version      string   `json:"version"`
}

// crashReportDir returns the directory for crash reports.
func crashReportDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".chatml", "crash-reports")
}

// writeCrashReport saves a crash report to disk.
func writeCrashReport(report crashReport) string {
	dir := crashReportDir()
	if dir == "" {
		return ""
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return ""
	}
	filename := fmt.Sprintf("crash-%s-%d.json", time.Now().Format("20060102-150405"), time.Now().UnixNano()%10000)
	path := filepath.Join(dir, filename)
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return ""
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return ""
	}
	return path
}

// checkRecentCrash checks for crash reports from the last 24 hours and returns
// the most recent one, if any.
func checkRecentCrash() *crashReport {
	dir := crashReportDir()
	if dir == "" {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) == 0 {
		return nil
	}

	// Sort by name descending (newest first since names are timestamp-based)
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() > entries[j].Name()
	})

	// Check the most recent crash
	entry := entries[0]
	info, err := entry.Info()
	if err != nil {
		return nil
	}
	// Only report crashes from the last 24 hours
	if time.Since(info.ModTime()) > 24*time.Hour {
		return nil
	}

	path := filepath.Join(dir, entry.Name())
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var report crashReport
	if err := json.Unmarshal(data, &report); err != nil {
		return nil
	}
	return &report
}

// cleanOldCrashReports removes crash reports older than 7 days.
func cleanOldCrashReports() {
	dir := crashReportDir()
	if dir == "" {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if time.Since(info.ModTime()) > 7*24*time.Hour {
			os.Remove(filepath.Join(dir, entry.Name()))
		}
	}
}

// setupPanicRecovery installs a deferred panic handler that writes a crash report.
// Returns a function that should be deferred in main().
func setupPanicRecovery(m *model) func() {
	return func() {
		r := recover()
		if r == nil {
			return
		}

		stack := string(debug.Stack())
		panicMsg := fmt.Sprintf("%v", r)

		// Collect model state safely — m may be nil if panic occurs during init
		var lastCmds []string
		var modelName, workdir string
		var totalCost float64
		var totalTurns int
		if m != nil {
			modelName = m.modelName
			workdir = m.workdir
			totalCost = m.stats.totalCost
			totalTurns = m.stats.totalTurns
			max := 5
			start := len(m.hist.entries) - max
			if start < 0 {
				start = 0
			}
			lastCmds = append([]string{}, m.hist.entries[start:]...)
		}

		report := crashReport{
			Timestamp:    time.Now().Format(time.RFC3339),
			PanicMessage: panicMsg,
			StackTrace:   stack,
			Model:        modelName,
			Workdir:      workdir,
			TotalCost:    totalCost,
			TotalTurns:   totalTurns,
			LastCommands: lastCmds,
			Version:      version,
		}

		path := writeCrashReport(report)
		// Print to stderr since BubbleTea may have the terminal in a bad state
		fmt.Fprintf(os.Stderr, "\n\nChatML crashed: %s\n", panicMsg)
		if path != "" {
			fmt.Fprintf(os.Stderr, "Crash report saved to: %s\n", path)
		}
		fmt.Fprintf(os.Stderr, "\nStack trace:\n%s\n", stack)
		os.Exit(1)
	}
}
