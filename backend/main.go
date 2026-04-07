package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime/debug"
	"strconv"
	"syscall"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/appdir"
	"github.com/chatml/chatml-backend/branch"
	"github.com/chatml/chatml-backend/loop"
	"github.com/chatml/chatml-backend/loop/chatml"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/linear"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/naming"
	"github.com/chatml/chatml-backend/scheduler"
	"github.com/chatml/chatml-backend/scripts"
	"github.com/chatml/chatml-backend/server"
	"github.com/chatml/chatml-backend/store"

	"github.com/google/uuid"
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

	// Clean up orphaned temp files from any previous crash before starting processes.
	if removed, failed, err := appdir.CleanupTempDir(); err != nil {
		logger.Main.Warnf("Temp file cleanup: %v", err)
	} else {
		if removed > 0 {
			logger.Main.Infof("Cleaned up %d orphaned temp files", removed)
		}
		if failed > 0 {
			logger.Main.Warnf("Failed to remove %d orphaned temp files", failed)
		}
	}

	s, err := store.NewSQLiteStore()
	if err != nil {
		logger.Main.Fatalf("Failed to initialize store: %v", err)
	}
	defer s.Close()

	// Write the actual port to a well-known file so external tools (e.g., Claude Code MCP)
	// can discover the backend without requiring CHATML_BACKEND_URL to be set.
	// Written here — after all Fatalf-capable initialization — so the file is only
	// created when the backend is actually going to start serving requests.
	// defer os.Remove runs on clean exit (SIGINT/SIGTERM); hard crashes leave the
	// file behind, but the next successful startup overwrites it.
	portFile := filepath.Join(appdir.StateDir(), "backend.port")
	if err := os.WriteFile(portFile, []byte(strconv.Itoa(actualPort)), 0644); err != nil {
		logger.Main.Warnf("Failed to write port file: %v", err)
	} else {
		defer os.Remove(portFile)
	}

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

	agentMgr := agent.NewManager(ctx, s, wm, actualPort)
	// Services for native loop ChatML tools. PRWatcher is set later (line ~410)
	// because it depends on ghClient which is created after this point.
	// The factory closure captures the pointer so it sees the updated field.
	nativeSvc := &chatml.Services{Store: s}
	agentMgr.SetNativeBackendFactory(loop.NewBackendFactory(nativeSvc, git.NewRepoManager()))
	if err := agentMgr.Init(ctx); err != nil {
		logger.Main.Errorf("Agent manager init: %v", err)
	}

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
	if linearConfig.ClientID == "" {
		logger.Linear.Warn("LINEAR_CLIENT_ID not configured — Linear integration disabled")
	}
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

	// Diff cache with 10 second TTL — avoids repeated git show subprocess spawns
	diffCache := server.NewDiffCache(10 * time.Second)
	defer diffCache.Close()

	// Snapshot cache with 3 second TTL — coalesces concurrent session switch requests
	snapshotCache := server.NewSnapshotCache(3 * time.Second)
	defer snapshotCache.Close()

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

				// Invalidate caches first
				statsCache.Invalidate(sessionID)
				diffCache.InvalidateSession(sessionID)
				snapshotCache.Invalidate(sessionID)

				// Get session and workspace data to recompute stats
				sess, err := s.GetSession(ctx, sessionID)
				if err != nil || sess == nil {
					return
				}

				// Get workspace for branch info
				repo, err := s.GetRepo(ctx, sess.WorkspaceID)
				if err != nil || repo == nil {
					return
				}

				// Resolve working path: worktree path for worktree sessions,
				// workspace path for base sessions
				workingPath := sess.WorktreePath
				// Defensive fallback for legacy base sessions created before
				// WorktreePath was populated. Current creation paths always set it.
				if workingPath == "" && sess.IsBaseSession() {
					workingPath = repo.Path
				}
				if workingPath == "" {
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
				baseRef, mbErr := repoManager.GetMergeBase(ctx, workingPath, remoteRef, "HEAD")
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
				changes, err := repoManager.GetChangedFilesWithStats(ctx, workingPath, baseRef)
				if err != nil {
					return
				}
				untracked, _ := repoManager.GetUntrackedFiles(ctx, workingPath)

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
					watchPath := sess.WorktreePath
					if watchPath == "" && sess.IsBaseSession() {
						watchPath = repo.Path // Base sessions use workspace path
					}
					if watchPath != "" {
						if watchErr := branchWatcher.WatchSession(sess.ID, watchPath, sess.Branch); watchErr != nil {
							logger.BranchWatcher.Warnf("Failed to watch existing session %s: %v", sess.ID, watchErr)
						}
					}
				}
			}
		}
	}

	go hub.Run()

	// Shared PR cache used by both PRWatcher and HTTP handlers
	prCache := github.NewPRCache(45*time.Second, 10*time.Minute, 100)
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
				"prTitle":     event.PRTitle,
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
	// Backfill for native loop ChatML tools. Safe because HTTP handlers
	// (which invoke the factory) are registered after this assignment,
	// guaranteeing happens-before ordering per the Go memory model.
	nativeSvc.PRWatcher = prWatcher

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

	// Notify PRWatcher immediately when an agent creates or merges a PR via bash,
	// bypassing the 30-second polling delay for instant UI updates.
	// RegisterPRFromAgent updates the session directly with the PR number/URL
	// extracted from the gh pr create stdout, then falls back to ForceCheckSession
	// for additional metadata (checks, mergeable, title).
	agentMgr.SetOnPRCreated(prWatcher.RegisterPRFromAgent)
	agentMgr.SetOnPRMerged(prWatcher.ForceCheckSession)

	// Issue cache for GitHub Issues API
	issueCache := github.NewIssueCache(2*time.Minute, 10*time.Minute)
	defer issueCache.Close()

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

	// AI client: nil at init — handlers.getAIClient() resolves dynamically via
	// agentMgr.CreateAIClient() on each call, picking up credentials as they
	// become available (env var, keychain, credentials file, cached SDK token).
	router, handlers, routerCleanup := server.NewRouter(ctx, s, hub, agentMgr, ghClient, linearClient, branchWatcher, prWatcher, prCache, issueCache, statsCache, diffCache, snapshotCache, nil, scriptRunner)
	defer routerCleanup()

	// Initialize and start the scheduled task scheduler
	taskScheduler := scheduler.NewScheduler(ctx, s, agentMgr, git.NewWorktreeManager(), func(eventType string, payload map[string]interface{}) {
		hub.Broadcast(server.Event{
			Type:    eventType,
			Payload: payload,
		})
	})
	handlers.SetScheduler(taskScheduler)
	go taskScheduler.Start()
	defer taskScheduler.Stop()

	// Backfill base sessions for existing workspaces that don't have one yet.
	// This handles upgrades from versions that didn't auto-create base sessions.
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Main.Errorf("PANIC in base session backfill: %v\n%s", r, debug.Stack())
			}
		}()

		repos, err := s.ListRepos(ctx)
		if err != nil {
			logger.Main.Warnf("Base session backfill: failed to list repos: %v", err)
			return
		}

		for _, repo := range repos {
			// Check if workspace already has a base session
			existing, err := s.GetBaseSessionForWorkspace(ctx, repo.ID)
			if err != nil {
				logger.Main.Warnf("Base session backfill: failed to check workspace %s: %v", repo.ID, err)
				continue
			}
			if existing != nil {
				continue // already has one
			}

			// Verify the repo path still exists on disk
			if _, statErr := os.Stat(repo.Path); os.IsNotExist(statErr) {
				continue
			}

			branch, _ := repoManager.GetCurrentBranch(ctx, repo.Path)
			now := time.Now()
			sess := &models.Session{
				ID:           uuid.New().String(),
				WorkspaceID:  repo.ID,
				Name:         repo.Name,
				Branch:       branch,
				WorktreePath: repo.Path,
				SessionType:  models.SessionTypeBase,
				Status:       "idle",
				PRStatus:     "none",
				Priority:     models.PriorityNone,
				TaskStatus:   models.TaskStatusInProgress,
				CreatedAt:    now,
				UpdatedAt:    now,
			}
			if err := s.AddSession(ctx, sess); err != nil {
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
			if err := s.AddConversation(ctx, conv); err != nil {
				logger.Main.Warnf("Base session backfill: failed to create conversation for workspace %s: %v", repo.ID, err)
				continue
			}

			setupMsg := models.Message{
				ID:   uuid.New().String()[:8],
				Role: "system",
				SetupInfo: &models.SetupInfo{
					SessionName:  sess.Name,
					BranchName:   branch,
					OriginBranch: branch,
					SessionType:  models.SessionTypeBase,
				},
				Timestamp: now,
			}
			if err := s.AddMessageToConversation(ctx, convID, setupMsg); err != nil {
				logger.Main.Warnf("Base session backfill: failed to create setup message for workspace %s: %v", repo.ID, err)
				continue
			}

			// Start branch watching for the backfilled session
			if branchWatcher != nil {
				if watchErr := branchWatcher.WatchSession(sess.ID, repo.Path, branch); watchErr != nil {
					logger.Main.Warnf("Base session backfill: failed to watch session %s: %v", sess.ID, watchErr)
				}
			}

			logger.Main.Infof("Backfilled base session for workspace %q (%s)", repo.Name, repo.ID)
		}
	}()

	// Pre-warm session stats cache in background so the first getDashboardData
	// returns stats from cache instead of computing them on-the-fly.
	go func() {
		repos, err := s.ListRepos(ctx)
		if err != nil {
			logger.Main.Warnf("Stats pre-warm: failed to list repos: %v", err)
			return
		}
		for _, repo := range repos {
			sessions, err := s.ListSessions(ctx, repo.ID, false)
			if err != nil {
				continue
			}
			for _, sess := range sessions {
				if sess.WorktreePath == "" || sess.Archived {
					continue
				}
				// Skip if already cached (e.g. branch watcher beat us)
				if _, ok := statsCache.Get(sess.ID); ok {
					continue
				}
				effectiveTarget := sess.TargetBranch
				if effectiveTarget == "" {
					remote := "origin"
					branch := "main"
					if repo.Remote != "" {
						remote = repo.Remote
					}
					if repo.Branch != "" {
						branch = repo.Branch
					}
					effectiveTarget = remote + "/" + branch
				}
				baseRef, mbErr := repoManager.GetMergeBase(ctx, sess.WorktreePath, effectiveTarget, "HEAD")
				if mbErr != nil || baseRef == "" {
					baseRef = sess.BaseCommitSHA
					if baseRef == "" {
						baseRef = effectiveTarget
					}
				}
				changes, err := repoManager.GetChangedFilesWithStats(ctx, sess.WorktreePath, baseRef)
				if err != nil {
					continue
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
				statsCache.Set(sess.ID, stats)
			}
		}
		logger.Main.Info("Stats cache pre-warm complete")
	}()

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
