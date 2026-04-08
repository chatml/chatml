// Package app wires together all backend subsystems and manages their lifecycle.
// It replaces the 700+ line main.go initialization with a structured App type.
package app

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/appdir"
	"github.com/chatml/chatml-backend/branch"
	"github.com/chatml/chatml-core/git"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/linear"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/loop"
	"github.com/chatml/chatml-backend/loop/chatml"
	"github.com/chatml/chatml-backend/models"
	ollamapkg "github.com/chatml/chatml-backend/ollama"
	"github.com/chatml/chatml-backend/scheduler"
	"github.com/chatml/chatml-backend/server"
	"github.com/chatml/chatml-backend/stats"
	"github.com/chatml/chatml-backend/store"
	"github.com/chatml/chatml-core/naming"
	"github.com/chatml/chatml-core/scripts"
	"github.com/google/uuid"
)

// App holds all backend subsystems and manages their lifecycle.
type App struct {
	Store         *store.SQLiteStore
	Hub           *server.Hub
	AgentMgr      *agent.Manager
	BranchWatcher *branch.Watcher
	PRWatcher     *branch.PRWatcher
	Stats         *stats.Computer
	Scheduler     *scheduler.Scheduler
	GitHub        *github.Client
	Linear        *linear.Client
	Ollama        *ollamapkg.Manager
	ScriptRunner  *scripts.Runner
	RepoManager   *git.RepoManager

	// Caches
	StatsCache    *server.SessionStatsCache
	DiffCache     *server.DiffCache
	SnapshotCache *server.SnapshotCache
	PRCache       *github.PRCache
	IssueCache    *github.IssueCache

	// HTTPRouter is the HTTP handler for the backend server.
	HTTPRouter http.Handler

	// Internal state
	ctx        context.Context
	nativeSvc  *chatml.Services
	handlers   *server.Handlers
	routerClnp func()
}

// New creates and wires all subsystems. Call Start() after to begin background work.
// On error, all resources created so far are cleaned up via Shutdown().
func New(ctx context.Context, port int) (_ *App, retErr error) {
	app := &App{ctx: ctx}
	// On any error, clean up partially-initialized resources.
	defer func() {
		if retErr != nil {
			app.Shutdown()
		}
	}()

	s, err := store.NewSQLiteStore()
	if err != nil {
		return nil, err
	}
	app.Store = s

	hub := server.NewHub()
	app.Hub = hub
	wm := git.NewWorktreeManager()
	rm := git.NewRepoManager()
	app.RepoManager = rm

	agentMgr := agent.NewManager(ctx, s, wm, port)
	app.AgentMgr = agentMgr

	// Services for native loop ChatML tools. PRWatcher is set later
	// because it depends on ghClient which is created after this point.
	nativeSvc := &chatml.Services{Store: s}
	app.nativeSvc = nativeSvc
	agentMgr.SetNativeBackendFactory(loop.NewBackendFactory(nativeSvc, rm))

	// Ollama manager for local model support
	ollamaDir := filepath.Join(appdir.Root(), "ollama")
	ollamaMgr := ollamapkg.NewManager(ollamaDir, func(evt ollamapkg.ProgressEvent) {
		hub.Broadcast(server.Event{
			Type:    evt.Type,
			Payload: evt,
		})
	})
	app.Ollama = ollamaMgr
	agentMgr.SetOllamaManager(ollamaMgr)
	if err := agentMgr.Init(ctx); err != nil {
		logger.Main.Errorf("Agent manager init: %v", err)
	}

	// GitHub OAuth client
	ghConfig := server.LoadGitHubConfig()
	ghClient := github.NewClient(ghConfig.ClientID, ghConfig.ClientSecret)
	ghClient.SetOnTokenRefresh(func(tokens *github.TokenSet) {
		if err := server.PersistGitHubTokens(ctx, s, tokens); err != nil {
			logger.GitHub.Errorf("Failed to persist refreshed GitHub tokens: %v", err)
		}
	})
	server.NewAuthHandlers(ghClient, s).RestoreFromStore(ctx)
	app.GitHub = ghClient

	// Linear OAuth client
	linearConfig := server.LoadLinearConfig()
	if linearConfig.ClientID == "" {
		logger.Linear.Warn("LINEAR_CLIENT_ID not configured — Linear integration disabled")
	}
	linearClient := linear.NewClient(linearConfig.ClientID)
	linearAuth := server.NewLinearAuthHandlers(linearClient, s)
	linearClient.SetOnTokenRefresh(func(tokens *linear.TokenSet) {
		if err := server.PersistLinearTokens(ctx, s, tokens); err != nil {
			logger.Linear.Errorf("Failed to persist refreshed Linear tokens: %v", err)
		}
	})
	linearAuth.RestoreFromStore(ctx)
	app.Linear = linearClient

	// Caches
	statsCache := server.NewSessionStatsCache(30 * time.Second)
	diffCache := server.NewDiffCache(10 * time.Second)
	snapshotCache := server.NewSnapshotCache(3 * time.Second)
	prCache := github.NewPRCache(45*time.Second, 10*time.Minute, 100)
	issueCache := github.NewIssueCache(2*time.Minute, 10*time.Minute)
	app.StatsCache = statsCache
	app.DiffCache = diffCache
	app.SnapshotCache = snapshotCache
	app.PRCache = prCache
	app.IssueCache = issueCache

	// Stats computer (replaces duplicated computation logic)
	sc := stats.New(rm, s, statsCache)
	sc.SetDiffCache(diffCache)
	sc.SetSnapshotCache(snapshotCache)
	app.Stats = sc

	// Branch watcher (non-fatal if it fails)
	branchWatcher, err := branch.NewWatcher(app.onBranchChange)
	if err != nil {
		logger.BranchWatcher.Warnf("Failed to start branch watcher: %v", err)
	}
	app.BranchWatcher = branchWatcher

	if branchWatcher != nil {
		branchWatcher.SetStatsInvalidateCallback(app.onStatsInvalidate)
	}

	// PR watcher
	prWatcher := branch.NewPRWatcher(ghClient, rm, s, prCache, app.onPRChange)
	app.PRWatcher = prWatcher
	nativeSvc.PRWatcher = prWatcher

	// Wire PR events to agent manager
	agentMgr.SetOnPRCreated(prWatcher.RegisterPRFromAgent)
	agentMgr.SetOnPRMerged(prWatcher.ForceCheckSession)

	// Notify PRWatcher when branches change
	if branchWatcher != nil {
		branchWatcher.SetBranchChangeNotifyCallback(func(sessionID, newBranch string) {
			prWatcher.UpdateSessionBranch(sessionID, newBranch)
		})
	}

	// Script runner with WebSocket output streaming
	scriptRunner := scripts.NewRunner(
		func(sessionID, runID, line string) {
			hub.Broadcast(server.Event{
				Type:      "script_output",
				SessionID: sessionID,
				Payload: map[string]interface{}{
					"runId": runID,
					"line":  line,
				},
			})
		},
		func(sessionID string, run *scripts.ScriptRun) {
			hub.Broadcast(server.Event{
				Type:      "script_status",
				SessionID: sessionID,
				Payload:   run,
			})
		},
		func(sessionID string, current, total int, status string) {
			hub.Broadcast(server.Event{
				Type:      "setup_progress",
				SessionID: sessionID,
				Payload: map[string]interface{}{
					"current": current,
					"total":   total,
					"status":  status,
				},
			})
		},
	)
	app.ScriptRunner = scriptRunner

	// Create router and handlers — pass shared RepoManager and StatsComputer
	// to avoid duplicate creation inside NewHandlers.
	router, handlers, routerCleanup := server.NewRouter(ctx, s, hub, agentMgr, ghClient, linearClient, branchWatcher, prWatcher, prCache, issueCache, statsCache, diffCache, snapshotCache, nil, scriptRunner, ollamaMgr, server.WithRepoManager(rm), server.WithStatsComputer(sc))
	app.HTTPRouter = router
	app.handlers = handlers
	app.routerClnp = routerCleanup

	// Scheduler
	taskScheduler := scheduler.NewScheduler(ctx, s, agentMgr, git.NewWorktreeManager(), func(eventType string, payload map[string]interface{}) {
		hub.Broadcast(server.Event{
			Type:    eventType,
			Payload: payload,
		})
	})
	handlers.SetScheduler(taskScheduler)
	app.Scheduler = taskScheduler

	return app, nil
}

// Start launches background goroutines: hub, scheduler, watchers, pre-warm tasks.
func (a *App) Start() {
	go a.Hub.Run()
	go a.Scheduler.Start()

	// Initialize watches for existing sessions
	a.initBranchWatches()
	a.initPRWatches()

	// Background tasks
	go a.validateRepos()
	go a.backfillBaseSessions()
	go a.preWarmStatsCache()
}

// Shutdown gracefully stops all subsystems.
// Safe to call on a partially-initialized App (nil guards on all fields).
func (a *App) Shutdown() {
	if a.Scheduler != nil {
		a.Scheduler.Stop()
	}
	if a.routerClnp != nil {
		a.routerClnp()
	}
	if a.BranchWatcher != nil {
		a.BranchWatcher.Close()
	}
	if a.PRWatcher != nil {
		a.PRWatcher.Close()
	}
	if a.PRCache != nil {
		a.PRCache.Close()
	}
	if a.IssueCache != nil {
		a.IssueCache.Close()
	}
	if a.StatsCache != nil {
		a.StatsCache.Close()
	}
	if a.DiffCache != nil {
		a.DiffCache.Close()
	}
	if a.SnapshotCache != nil {
		a.SnapshotCache.Close()
	}
	if a.Store != nil {
		a.Store.Close()
	}
}

// onBranchChange handles git branch changes detected by the file watcher.
func (a *App) onBranchChange(event branch.BranchChangeEvent) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.BranchWatcher.Errorf("PANIC recovered: %v\n%s", r, debug.Stack())
			}
		}()

		if a.ctx.Err() != nil {
			return
		}

		newName := naming.ExtractSessionNameFromBranch(event.NewBranch)
		if newName == "" {
			newName = event.NewBranch
		}

		now := time.Now()
		if err := a.Store.UpdateSession(a.ctx, event.SessionID, func(sess *models.Session) {
			sess.Branch = event.NewBranch
			sess.Name = newName
			sess.UpdatedAt = now
		}); err != nil {
			logger.BranchWatcher.Errorf("Failed to update session %s: %v", event.SessionID, err)
			return
		}

		logger.BranchWatcher.Infof("Updated session %s: branch=%q name=%q", event.SessionID, event.NewBranch, newName)

		a.Hub.Broadcast(server.Event{
			Type:      "session_name_update",
			SessionID: event.SessionID,
			Payload: map[string]interface{}{
				"type":   "session_name_update",
				"name":   newName,
				"branch": event.NewBranch,
			},
		})

		a.Hub.Broadcast(server.Event{
			Type: "branch_dashboard_update",
			Payload: map[string]interface{}{
				"sessionId": event.SessionID,
				"updatedAt": time.Now().Unix(),
			},
		})
	}()
}

// onStatsInvalidate handles stats cache invalidation from the branch watcher.
func (a *App) onStatsInvalidate(sessionID string) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.StatsWatcher.Errorf("PANIC recovered: %v\n%s", r, debug.Stack())
			}
		}()

		if a.ctx.Err() != nil {
			return
		}

		result := a.Stats.InvalidateAndRecompute(a.ctx, sessionID)

		a.Hub.Broadcast(server.Event{
			Type:      "session_stats_update",
			SessionID: sessionID,
			Payload: map[string]interface{}{
				"sessionId": sessionID,
				"stats":     result,
			},
		})
	}()
}

// onPRChange handles PR status changes detected by the PR watcher.
func (a *App) onPRChange(event branch.PRChangeEvent) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.PRWatcher.Errorf("PANIC recovered: %v\n%s", r, debug.Stack())
			}
		}()

		if a.ctx.Err() != nil {
			return
		}

		logger.PRWatcher.Infof("Broadcasting PR update for session %s: status=%s, pr=%d",
			event.SessionID, event.PRStatus, event.PRNumber)

		payload := map[string]interface{}{
			"prStatus":    event.PRStatus,
			"prNumber":    event.PRNumber,
			"prUrl":       event.PRUrl,
			"prTitle":     event.PRTitle,
			"checkStatus": event.CheckStatus,
			"mergeable":   event.Mergeable,
		}
		if sess, err := a.Store.GetSession(a.ctx, event.SessionID); err == nil && sess != nil {
			payload["taskStatus"] = sess.TaskStatus
		}

		a.Hub.Broadcast(server.Event{
			Type:      "session_pr_update",
			SessionID: event.SessionID,
			Payload:   payload,
		})

		a.Hub.Broadcast(server.Event{
			Type: "pr_dashboard_update",
			Payload: map[string]interface{}{
				"sessionId": event.SessionID,
				"updatedAt": time.Now().Unix(),
			},
		})

		a.AgentMgr.RegenerateSessionSuggestions(a.ctx, event.SessionID)
	}()
}

// initBranchWatches sets up file watchers for all existing sessions.
func (a *App) initBranchWatches() {
	if a.BranchWatcher == nil {
		return
	}
	repos, err := a.Store.ListRepos(a.ctx)
	if err != nil {
		return
	}
	for _, repo := range repos {
		sessions, err := a.Store.ListSessions(a.ctx, repo.ID, true)
		if err != nil {
			continue
		}
		for _, sess := range sessions {
			watchPath := sess.WorktreePath
			if watchPath == "" && sess.IsBaseSession() {
				watchPath = repo.Path
			}
			if watchPath != "" {
				if err := a.BranchWatcher.WatchSession(sess.ID, watchPath, sess.Branch); err != nil {
					logger.BranchWatcher.Warnf("Failed to watch existing session %s: %v", sess.ID, err)
				}
			}
		}
	}
}

// initPRWatches sets up PR monitoring for all existing sessions.
func (a *App) initPRWatches() {
	if !a.GitHub.IsAuthenticated() {
		return
	}
	repos, err := a.Store.ListRepos(a.ctx)
	if err != nil {
		return
	}
	for _, repo := range repos {
		sessions, err := a.Store.ListSessions(a.ctx, repo.ID, true)
		if err != nil {
			continue
		}
		for _, sess := range sessions {
			if sess.WorktreePath != "" && sess.Branch != "" {
				a.PRWatcher.WatchSession(sess.ID, sess.WorkspaceID, sess.Branch, repo.Path, sess.PRStatus, sess.PRNumber, sess.PRUrl)
			}
		}
	}
}

// validateRepos logs warnings for workspace paths that no longer exist on disk.
func (a *App) validateRepos() {
	defer func() {
		if r := recover(); r != nil {
			logger.Main.Errorf("PANIC in repo validation: %v\n%s", r, debug.Stack())
		}
	}()

	repos, err := a.Store.ListRepos(a.ctx)
	if err != nil {
		logger.Main.Warnf("Failed to list repos for validation: %v", err)
		return
	}
	for _, repo := range repos {
		if _, err := os.Stat(repo.Path); os.IsNotExist(err) {
			logger.Main.Warnf("Registered workspace %q (%s) no longer exists on disk at %s", repo.Name, repo.ID, repo.Path)
		}
	}
}

// backfillBaseSessions creates base sessions for workspaces that don't have one.
func (a *App) backfillBaseSessions() {
	defer func() {
		if r := recover(); r != nil {
			logger.Main.Errorf("PANIC in base session backfill: %v\n%s", r, debug.Stack())
		}
	}()

	repos, err := a.Store.ListRepos(a.ctx)
	if err != nil {
		logger.Main.Warnf("Base session backfill: failed to list repos: %v", err)
		return
	}

	for _, repo := range repos {
		existing, err := a.Store.GetBaseSessionForWorkspace(a.ctx, repo.ID)
		if err != nil {
			logger.Main.Warnf("Base session backfill: failed to check workspace %s: %v", repo.ID, err)
			continue
		}
		if existing != nil {
			continue
		}

		if _, statErr := os.Stat(repo.Path); os.IsNotExist(statErr) {
			continue
		}

		branchName, _ := a.RepoManager.GetCurrentBranch(a.ctx, repo.Path)
		now := time.Now()
		sess := &models.Session{
			ID:           uuid.New().String(),
			WorkspaceID:  repo.ID,
			Name:         repo.Name,
			Branch:       branchName,
			WorktreePath: repo.Path,
			SessionType:  models.SessionTypeBase,
			Status:       "idle",
			PRStatus:     "none",
			Priority:     models.PriorityNone,
			TaskStatus:   models.TaskStatusInProgress,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		if err := a.Store.AddSession(a.ctx, sess); err != nil {
			logger.Main.Warnf("Base session backfill: failed to create session for workspace %s: %v", repo.ID, err)
			continue
		}

		convID := uuid.New().String()[:8]
		conv := &models.Conversation{
			ID:          convID,
			SessionID:   sess.ID,
			Type:        models.ConversationTypeTask,
			Name:        "Untitled",
			Status:      models.ConversationStatusIdle,
			Messages:    []models.Message{},
			ToolSummary: []models.ToolAction{},
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		if err := a.Store.AddConversation(a.ctx, conv); err != nil {
			logger.Main.Warnf("Base session backfill: failed to create conversation for workspace %s: %v", repo.ID, err)
			continue
		}

		setupMsg := models.Message{
			ID:   uuid.New().String()[:8],
			Role: "system",
			SetupInfo: &models.SetupInfo{
				SessionName:  sess.Name,
				BranchName:   branchName,
				OriginBranch: branchName,
				SessionType:  models.SessionTypeBase,
			},
			Timestamp: now,
		}
		if err := a.Store.AddMessageToConversation(a.ctx, convID, setupMsg); err != nil {
			logger.Main.Warnf("Base session backfill: failed to create setup message for workspace %s: %v", repo.ID, err)
			continue
		}

		if a.BranchWatcher != nil {
			if watchErr := a.BranchWatcher.WatchSession(sess.ID, repo.Path, branchName); watchErr != nil {
				logger.Main.Warnf("Base session backfill: failed to watch session %s: %v", sess.ID, watchErr)
			}
		}

		logger.Main.Infof("Backfilled base session for workspace %q (%s)", repo.Name, repo.ID)
	}
}

// preWarmStatsCache computes stats for all active sessions in the background.
func (a *App) preWarmStatsCache() {
	repos, err := a.Store.ListRepos(a.ctx)
	if err != nil {
		logger.Main.Warnf("Stats pre-warm: failed to list repos: %v", err)
		return
	}
	for _, repo := range repos {
		sessions, err := a.Store.ListSessions(a.ctx, repo.ID, false)
		if err != nil {
			continue
		}
		for _, sess := range sessions {
			if sess.WorktreePath == "" || sess.Archived {
				continue
			}
			if _, ok := a.StatsCache.Get(sess.ID); ok {
				continue
			}
			a.Stats.ComputeAndCache(a.ctx, sess.ID)
		}
	}
	logger.Main.Info("Stats cache pre-warm complete")
}
