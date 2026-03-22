// Package logger provides colorful, component-specific logging for the ChatML backend.
package logger

import (
	"os"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/log"
)

// Component loggers with distinct colored prefixes
var (
	// Core application
	Main *log.Logger

	// Branch and PR watching
	BranchWatcher *log.Logger
	PRWatcher     *log.Logger
	StatsWatcher  *log.Logger

	// Storage
	Store   *log.Logger
	SQLite  *log.Logger
	DBRetry *log.Logger

	// HTTP and WebSocket
	Handlers  *log.Logger
	WebSocket *log.Logger
	Config    *log.Logger
	Error     *log.Logger

	// Agent management
	Manager *log.Logger
	Process *log.Logger

	// Scripts
	Scripts *log.Logger

	// Caching
	DirCache *log.Logger

	// Relay
	Relay *log.Logger

	// Utilities
	Cleanup *log.Logger
	GitHub  *log.Logger
	Linear  *log.Logger
)

// Define colors for different component categories
var (
	// Category colors (using lipgloss for styled prefixes)
	colorCore    = lipgloss.NewStyle().Foreground(lipgloss.Color("#4ade80")) // green
	colorWatch   = lipgloss.NewStyle().Foreground(lipgloss.Color("#60a5fa")) // blue
	colorStorage = lipgloss.NewStyle().Foreground(lipgloss.Color("#c084fc")) // purple
	colorHTTP    = lipgloss.NewStyle().Foreground(lipgloss.Color("#22d3ee")) // cyan
	colorAgent   = lipgloss.NewStyle().Foreground(lipgloss.Color("#fbbf24")) // amber
	colorUtil    = lipgloss.NewStyle().Foreground(lipgloss.Color("#a3a3a3")) // gray
)

func init() {
	// Base styles
	styles := log.DefaultStyles()

	// Customize level styles
	styles.Levels[log.DebugLevel] = lipgloss.NewStyle().
		SetString("DEBUG").
		Foreground(lipgloss.Color("#737373")).
		Bold(true)
	styles.Levels[log.InfoLevel] = lipgloss.NewStyle().
		SetString("INFO").
		Foreground(lipgloss.Color("#22d3ee")).
		Bold(true)
	styles.Levels[log.WarnLevel] = lipgloss.NewStyle().
		SetString("WARN").
		Foreground(lipgloss.Color("#eab308")).
		Bold(true)
	styles.Levels[log.ErrorLevel] = lipgloss.NewStyle().
		SetString("ERROR").
		Foreground(lipgloss.Color("#ef4444")).
		Bold(true)
	styles.Levels[log.FatalLevel] = lipgloss.NewStyle().
		SetString("FATAL").
		Foreground(lipgloss.Color("#ef4444")).
		Bold(true).
		Background(lipgloss.Color("#450a0a"))

	// Create base logger
	base := log.NewWithOptions(os.Stderr, log.Options{
		TimeFormat:      "15:04:05",
		ReportTimestamp: true,
	})
	base.SetStyles(styles)

	// Core application
	Main = base.WithPrefix(colorCore.Render("main"))

	// Branch and PR watching
	BranchWatcher = base.WithPrefix(colorWatch.Render("branch-watcher"))
	PRWatcher = base.WithPrefix(colorWatch.Render("pr-watcher"))
	StatsWatcher = base.WithPrefix(colorWatch.Render("stats-watcher"))

	// Storage
	Store = base.WithPrefix(colorStorage.Render("store"))
	SQLite = base.WithPrefix(colorStorage.Render("sqlite"))
	DBRetry = base.WithPrefix(colorStorage.Render("db-retry"))

	// HTTP and WebSocket
	Handlers = base.WithPrefix(colorHTTP.Render("handlers"))
	WebSocket = base.WithPrefix(colorHTTP.Render("websocket"))
	Config = base.WithPrefix(colorHTTP.Render("config"))
	Error = base.WithPrefix(colorHTTP.Render("error"))

	// Agent management
	Manager = base.WithPrefix(colorAgent.Render("manager"))
	Process = base.WithPrefix(colorAgent.Render("process"))

	// Scripts
	Scripts = base.WithPrefix(colorAgent.Render("scripts"))

	// Caching
	DirCache = base.WithPrefix(colorWatch.Render("dir-cache"))

	// Relay
	Relay = base.WithPrefix(colorHTTP.Render("relay"))

	// Utilities
	Cleanup = base.WithPrefix(colorUtil.Render("cleanup"))
	GitHub = base.WithPrefix(colorUtil.Render("github"))
	Linear = base.WithPrefix(colorUtil.Render("linear"))
}
