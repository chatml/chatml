// Package logger provides colorful, component-specific logging with a factory
// for creating new loggers. Core-package loggers are defined here; backend
// (or other consumer) loggers should be defined in their own packages using New.
package logger

import (
	"os"
	"sync"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/log"
)

var (
	base     *log.Logger
	baseOnce sync.Once
)

// initBase lazily creates the shared base logger with custom level styles.
func initBase() *log.Logger {
	baseOnce.Do(func() {
		styles := log.DefaultStyles()

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

		base = log.NewWithOptions(os.Stderr, log.Options{
			TimeFormat:      "15:04:05",
			ReportTimestamp: true,
		})
		base.SetStyles(styles)
	})
	return base
}

// New creates a new named logger with a colored prefix.
// Use this from consumer packages to define their own loggers.
func New(prefix string, colorHex string) *log.Logger {
	style := lipgloss.NewStyle().Foreground(lipgloss.Color(colorHex))
	return initBase().WithPrefix(style.Render(prefix))
}

// Color constants for logger categories.
const (
	ColorCore    = "#4ade80" // green
	ColorWatch   = "#60a5fa" // blue
	ColorStorage = "#c084fc" // purple
	ColorHTTP    = "#22d3ee" // cyan
	ColorAgent   = "#fbbf24" // amber
	ColorUtil    = "#a3a3a3" // gray
)

// Core loggers — only for packages that live in the core module.
var (
	Main     *log.Logger // core application
	Cleanup  *log.Logger // git cleanup
	Scripts  *log.Logger // script runner
	DirCache *log.Logger // directory caching
)

func init() {
	Main = New("main", ColorCore)
	Cleanup = New("cleanup", ColorUtil)
	Scripts = New("scripts", ColorAgent)
	DirCache = New("dir-cache", ColorWatch)
}
