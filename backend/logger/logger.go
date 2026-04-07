// Package logger defines backend-specific loggers using the core logger factory.
// Core loggers (Main, Cleanup, Scripts, DirCache) are re-exported for convenience
// so backend files only need a single logger import.
package logger

import (
	"github.com/charmbracelet/log"
	corelogger "github.com/chatml/chatml-core/logger"
)

// Re-exported core loggers (pointer snapshots captured during init;
// these will not track later reassignments to the core variables).
var (
	Main     *log.Logger
	Cleanup  *log.Logger
	Scripts  *log.Logger
	DirCache *log.Logger
)

// Backend-specific loggers.
var (
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

	// Relay
	Relay *log.Logger

	// External services
	GitHub *log.Logger
	Linear *log.Logger
)

func init() {
	// Re-export core loggers so backend files need only one import.
	Main = corelogger.Main
	Cleanup = corelogger.Cleanup
	Scripts = corelogger.Scripts
	DirCache = corelogger.DirCache

	// Backend-specific loggers
	BranchWatcher = corelogger.New("branch-watcher", corelogger.ColorWatch)
	PRWatcher = corelogger.New("pr-watcher", corelogger.ColorWatch)
	StatsWatcher = corelogger.New("stats-watcher", corelogger.ColorWatch)

	Store = corelogger.New("store", corelogger.ColorStorage)
	SQLite = corelogger.New("sqlite", corelogger.ColorStorage)
	DBRetry = corelogger.New("db-retry", corelogger.ColorStorage)

	Handlers = corelogger.New("handlers", corelogger.ColorHTTP)
	WebSocket = corelogger.New("websocket", corelogger.ColorHTTP)
	Config = corelogger.New("config", corelogger.ColorHTTP)
	Error = corelogger.New("error", corelogger.ColorHTTP)

	Manager = corelogger.New("manager", corelogger.ColorAgent)
	Process = corelogger.New("process", corelogger.ColorAgent)

	Relay = corelogger.New("relay", corelogger.ColorHTTP)

	GitHub = corelogger.New("github", corelogger.ColorUtil)
	Linear = corelogger.New("linear", corelogger.ColorUtil)
}
