package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"strconv"
	"syscall"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/ai"
	"github.com/chatml/chatml-backend/appdir"
	"github.com/chatml/chatml-backend/automation"
	"github.com/chatml/chatml-backend/branch"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/linear"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/naming"
	"github.com/chatml/chatml-backend/scripts"
	"github.com/chatml/chatml-backend/server"
	"github.com/chatml/chatml-backend/store"
)

const (
	// DefaultPort is the preferred port for the backend server
	DefaultPort = 9876
	// MinPort is the start of the port range for fallback
	MinPort = 9876
	// MaxPort is the end of the port range for fallback
	// NOTE: If you change this range, you must also update the CSP in
	// src-tauri/tauri.conf.json to include all ports in the range.
	// CSP wildcards (localhost:*) are not supported.
	MaxPort = 9899
)

// acquireListener finds an available port, trying the preferred port first,
// then falling back to the range MinPort-MaxPort.
// Returns the listener (caller must close) to avoid TOCTOU race conditions.
func acquireListener(preferred int) (net.Listener, int, error) {
	// Try preferred port first
	if l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", preferred)); err == nil {
		return l, preferred, nil
	}

	// Try range from MinPort to MaxPort
	for port := MinPort; port <= MaxPort; port++ {
		if port == preferred {
			continue // Already tried
		}
		if l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port)); err == nil {
			return l, port, nil
		}
	}

	return nil, 0, fmt.Errorf("no available port in range %d-%d", MinPort, MaxPort)
}

func main() {
	// Create root context that cancels on SIGINT/SIGTERM
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Determine preferred port from environment or use default
	preferredPort := DefaultPort
	if p := os.Getenv("PORT"); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil {
			preferredPort = parsed
		}
	}

	// Acquire a listener on an available port (tries preferred first, then range)
	// We keep the listener open to avoid TOCTOU race conditions where another
	// process could claim the port between checking and binding.
	listener, actualPort, err := acquireListener(preferredPort)
	if err != nil {
		logger.Main.Fatalf("Failed to acquire port: %v", err)
	}

	// Output port for Tauri to capture - MUST be first output line
	// This protocol allows the Tauri wrapper to discover which port we bound to
	fmt.Printf("CHATML_PORT=%d\n", actualPort)

	appdir.Init()

	s, err := store.NewSQLiteStore()
	if err != nil {
		logger.Main.Fatalf("Failed to initialize store: %v", err)
	}
	defer s.Close()

	hub := server.NewHub()
	wm := git.NewWorktreeManager()

	// Validate that registered repos still exist on disk (diagnostic only).
	// This logs warnings for operator awareness but does not remove stale entries,
	// since the repo may be on a temporarily unmounted volume or network drive.
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Main.Errorf("PANIC in repo validation: %v\n%s", r, debug.Stack())
			}
		}()

		repos, err := s.ListRepos(ctx)
		if err != nil {
			logger.Main.Warnf("Failed to list repos for validation: %v", err)
			return
		}
		for _, repo := range repos {
			if _, err := os.Stat(repo.Path); os.IsNotExist(err) {
				logger.Main.Warnf("Registered workspace %q (%s) no longer exists on disk at %s", repo.Name, repo.ID, repo.Path)
			}
		}
	}()

	agentMgr := agent.NewManager(ctx, s, wm)

	// GitHub OAuth client
	ghConfig := server.LoadGitHubConfig()
	ghClient := github.NewClient(ghConfig.ClientID, ghConfig.ClientSecret)

	// Set up GitHub token refresh persistence callback
	ghClient.SetOnTokenRefresh(func(tokens *github.TokenSet) {
		if err := server.PersistGitHubTokens(ctx, s, tokens); err != nil {
			logger.GitHub.Errorf("Failed to persist refreshed GitHub tokens: %v", err)
		}
	})

	// Restore GitHub auth from persisted settings (uses a temporary AuthHandlers for RestoreFromStore)
	server.NewAuthHandlers(ghClient, s).RestoreFromStore(ctx)

	// Linear OAuth client
	linearConfig := server.LoadLinearConfig()
	linearClient := linear.NewClient(linearConfig.ClientID)

	// Set up token refresh persistence callback
	linearAuth := server.NewLinearAuthHandlers(linearClient, s)
	linearClient.SetOnTokenRefresh(func(tokens *linear.TokenSet) {
		if err := server.PersistLinearTokens(ctx, s, tokens); err != nil {
			logger.Linear.Errorf("Failed to persist refreshed Linear tokens: %v", err)
		}
	})

	// Restore Linear auth from persisted settings
	linearAuth.RestoreFromStore(ctx)

	// Session stats cache with 30 second TTL
	statsCache := server.NewSessionStatsCache(30 * time.Second)
	defer statsCache.Close()

	// Repo manager for stats computation in callbacks
	repoManager := git.NewRepoManager()

	// Branch watcher for instant detection of git branch changes
	branchWatcher, err := branch.NewWatcher(func(event branch.BranchChangeEvent) {
		// Handle updates asynchronously to avoid blocking the watcher's event loop
		go func() {
			defer func() {
				if r := recover(); r != nil {
					logger.BranchWatcher.Errorf("PANIC recovered: %v\n%s", r, debug.Stack())
				}
			}()

			// Check if we're shutting down
			if ctx.Err() != nil {
				return
			}

			// Extract display name from the new branch
			newName := naming.ExtractSessionNameFromBranch(event.NewBranch)
			if newName == "" {
				newName = event.NewBranch // Fallback to full branch name
			}

			// Update session in database
			now := time.Now()
			if updateErr := s.UpdateSession(ctx, event.SessionID, func(sess *models.Session) {
				sess.Branch = event.NewBranch
				sess.Name = newName
				sess.UpdatedAt = now
			}); updateErr != nil {
				logger.BranchWatcher.Errorf("Failed to update session %s: %v", event.SessionID, updateErr)
				return
			}

			logger.BranchWatcher.Infof("Updated session %s: branch=%q name=%q", event.SessionID, event.NewBranch, newName)

			// Emit WebSocket event for frontend
			hub.Broadcast(server.Event{
				Type:      "session_name_update",
				SessionID: event.SessionID,
				Payload: map[string]interface{}{
					"type":   "session_name_update",
					"name":   newName,
					"branch": event.NewBranch,
				},
			})

			// Emit dashboard-level invalidation signal for branches dashboard
			hub.Broadcast(server.Event{
				Type: "branch_dashboard_update",
				Payload: map[string]interface{}{
					"sessionId": event.SessionID,
					"updatedAt": time.Now().Unix(),
				},
			})
		}()
	})
	if err != nil {
		logger.BranchWatcher.Warnf("Failed to start branch watcher: %v", err)
		// Non-fatal - app can still work without instant branch detection
	}
	if branchWatcher != nil {
		defer branchWatcher.Close()

		// Set up stats invalidation callback for real-time stats updates
		branchWatcher.SetStatsInvalidateCallback(func(sessionID string) {
			go func() {
				defer func() {
					if r := recover(); r != nil {
						logger.StatsWatcher.Errorf("PANIC recovered: %v\n%s", r, debug.Stack())
					}
				}()

				// Check if we're shutting down
				if ctx.Err() != nil {
					return
				}

				// Invalidate cache first
				statsCache.Invalidate(sessionID)

				// Get session and workspace data to recompute stats
				sess, err := s.GetSession(ctx, sessionID)
				if err != nil || sess == nil || sess.WorktreePath == "" {
					return
				}

				// Get workspace for branch info
				repo, err := s.GetRepo(ctx, sess.WorkspaceID)
				if err != nil {
					return
				}

				// Determine base ref using merge-base for accurate diff base,
				// consistent with getSessionAndWorkspace and computeSessionStats.
				// Use EffectiveTargetBranch logic: per-session override, then remote/branch.
				remoteRef := sess.TargetBranch
				if remoteRef == "" {
					remote := "origin"
					branch := "main"
					if repo != nil {
						if repo.Remote != "" {
							remote = repo.Remote
						}
						if repo.Branch != "" {
							branch = repo.Branch
						}
					}
					remoteRef = remote + "/" + branch
				}
				baseRef, mbErr := repoManager.GetMergeBase(ctx, sess.WorktreePath, remoteRef, "HEAD")
				if mbErr != nil || baseRef == "" {
					baseRef = sess.BaseCommitSHA
					if baseRef == "" && repo != nil {
						baseRef = repo.Branch
					}
					if baseRef == "" {
						baseRef = "main"
					}
				}

				// Compute stats
				changes, err := repoManager.GetChangedFilesWithStats(ctx, sess.WorktreePath, baseRef)
				if err != nil {
					return
				}
				untracked, _ := repoManager.GetUntrackedFiles(ctx, sess.WorktreePath)

				var additions, deletions int
				for _, c := range changes {
					additions += c.Additions
					deletions += c.Deletions
				}
				for _, u := range untracked {
					additions += u.Additions
				}

				var stats *models.SessionStats
				if additions > 0 || deletions > 0 {
					stats = &models.SessionStats{Additions: additions, Deletions: deletions}
				}

				// Update cache with new stats
				statsCache.Set(sessionID, stats)

				// Broadcast WebSocket event for real-time update
				hub.Broadcast(server.Event{
					Type:      "session_stats_update",
					SessionID: sessionID,
					Payload: map[string]interface{}{
						"sessionId": sessionID,
						"stats":     stats,
					},
				})
			}()
		})

		// Initialize watches for existing sessions
		// Include archived sessions since we need to track all worktrees
		repos, listErr := s.ListRepos(ctx)
		if listErr == nil {
			for _, repo := range repos {
				sessions, sessErr := s.ListSessions(ctx, repo.ID, true)
				if sessErr != nil {
					continue
				}
				for _, sess := range sessions {
					if sess.WorktreePath != "" {
						if watchErr := branchWatcher.WatchSession(sess.ID, sess.WorktreePath, sess.Branch); watchErr != nil {
							logger.BranchWatcher.Warnf("Failed to watch existing session %s: %v", sess.ID, watchErr)
						}
					}
				}
			}
		}
	}

	go hub.Run()

	// Shared PR cache used by both PRWatcher and HTTP handlers
	prCache := github.NewPRCache(2*time.Minute, 10*time.Minute)
	defer prCache.Close()

	// PR watcher for background GitHub PR status monitoring
	// Creates a watcher that polls GitHub for PR changes and broadcasts updates via WebSocket
	prWatcher := branch.NewPRWatcher(ghClient, repoManager, s, prCache, func(event branch.PRChangeEvent) {
		// Handle updates asynchronously to avoid blocking the watcher
		go func() {
			defer func() {
				if r := recover(); r != nil {
					logger.PRWatcher.Errorf("PANIC recovered: %v\n%s", r, debug.Stack())
				}
			}()

			// Check if we're shutting down
			if ctx.Err() != nil {
				return
			}

			logger.PRWatcher.Infof("Broadcasting PR update for session %s: status=%s, pr=%d",
				event.SessionID, event.PRStatus, event.PRNumber)

			// Read back the session to get auto-updated taskStatus
			payload := map[string]interface{}{
				"prStatus":    event.PRStatus,
				"prNumber":    event.PRNumber,
				"prUrl":       event.PRUrl,
				"checkStatus": event.CheckStatus,
				"mergeable":   event.Mergeable,
			}
			if sess, err := s.GetSession(ctx, event.SessionID); err == nil && sess != nil {
				payload["taskStatus"] = sess.TaskStatus
			}

			// Emit per-session WebSocket event for session views
			hub.Broadcast(server.Event{
				Type:      "session_pr_update",
				SessionID: event.SessionID,
				Payload:   payload,
			})

			// Emit dashboard-level invalidation signal for PR dashboard
			hub.Broadcast(server.Event{
				Type: "pr_dashboard_update",
				Payload: map[string]interface{}{
					"sessionId": event.SessionID,
					"updatedAt": time.Now().Unix(),
				},
			})

			// Regenerate input suggestions for the session so they reflect current PR state
			agentMgr.RegenerateSessionSuggestions(ctx, event.SessionID)
		}()
	})
	defer prWatcher.Close()

	// Initialize PR watches for existing sessions
	// Include archived sessions since PRs may still exist for them
	if ghClient.IsAuthenticated() {
		repos, listErr := s.ListRepos(ctx)
		if listErr == nil {
			for _, repo := range repos {
				sessions, sessErr := s.ListSessions(ctx, repo.ID, true)
				if sessErr != nil {
					continue
				}
				for _, sess := range sessions {
					if sess.WorktreePath != "" && sess.Branch != "" {
						prWatcher.WatchSession(sess.ID, sess.WorkspaceID, sess.Branch, repo.Path, sess.PRStatus, sess.PRNumber, sess.PRUrl)
					}
				}
			}
		}
	}

	// Notify PRWatcher when branches change so it can update its in-memory state
	// and invalidate the PR cache for immediate re-detection
	if branchWatcher != nil {
		branchWatcher.SetBranchChangeNotifyCallback(func(sessionID, newBranch string) {
			prWatcher.UpdateSessionBranch(sessionID, newBranch)
		})
	}

	// PR callbacks are set below after the automation engine is initialized,
	// so they can also emit automation events alongside PRWatcher notifications.

	// Issue cache for GitHub Issues API
	issueCache := github.NewIssueCache(2*time.Minute, 10*time.Minute)
	defer issueCache.Close()

	// AI client for PR description generation
	aiClient := ai.NewClient(os.Getenv("ANTHROPIC_API_KEY"))

	// Script runner for setup/run scripts with WebSocket output streaming
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

	router, handlers := server.NewRouter(s, hub, agentMgr, ghClient, linearClient, branchWatcher, prWatcher, prCache, issueCache, statsCache, aiClient, scriptRunner)

	// Automation engine: orchestrates workflow execution
	autoEngine := automation.NewEngine(ctx, s, hub)
	autoEngine.RegisterExecutor("action-webhook", automation.NewWebhookExecutor())
	autoEngine.RegisterExecutor("action-script", automation.NewScriptExecutor())
	autoEngine.RegisterExecutor("logic-conditional", automation.NewConditionalExecutor())
	autoEngine.RegisterExecutor("logic-delay", automation.NewDelayExecutor())
	autoEngine.RegisterExecutor("data-transform", automation.NewTransformExecutor())
	autoEngine.RegisterExecutor("data-variable", automation.NewVariableExecutor())
	autoEngine.Start()
	handlers.SetAutomationEngine(autoEngine)
	webhookHandler := automation.NewWebhookHandler(autoEngine, s)
	handlers.SetWebhookHandler(webhookHandler.HandleWebhook)

	// Automation event bus: routes internal events to matching workflow triggers
	eventBus := automation.NewEventBus(ctx, autoEngine, s)

	// Automation cron scheduler: fires workflow runs on schedule
	cronScheduler := automation.NewScheduler(ctx, autoEngine, s)
	cronScheduler.Start()
	defer cronScheduler.Stop()

	// Wire PR callbacks: PRWatcher for instant UI updates + EventBus for automation triggers
	agentMgr.SetOnPRCreated(func(sessionID string) {
		prWatcher.ForceCheckSession(sessionID)
		eventBus.Emit(automation.EventPRCreated, map[string]interface{}{"sessionId": sessionID})
	})
	agentMgr.SetOnPRMerged(func(sessionID string) {
		prWatcher.ForceCheckSession(sessionID)
		eventBus.Emit(automation.EventPRMerged, map[string]interface{}{"sessionId": sessionID})
	})

	// Create HTTP server with graceful shutdown support
	srv := &http.Server{
		Handler:     router,
		ReadTimeout: 15 * time.Second,
		// NOTE: WriteTimeout is intentionally omitted. Setting it would kill
		// long-lived WebSocket connections that are idle beyond the timeout.
		IdleTimeout: 60 * time.Second,
	}

	// Start server in goroutine using the already-acquired listener
	// This avoids TOCTOU race conditions since we keep the listener open
	go func() {
		logger.Main.Infof("ChatML backend starting on port %d", actualPort)
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			logger.Main.Fatalf("Server error: %v", err)
		}
	}()

	// Wait for shutdown signal
	<-ctx.Done()
	logger.Main.Info("Shutdown signal received, stopping server...")

	// Give outstanding requests a short deadline to complete
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Main.Errorf("Server shutdown error: %v", err)
	}

	logger.Main.Info("Server stopped")
}
