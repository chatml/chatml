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
	"github.com/chatml/chatml-backend/branch"
	"github.com/chatml/chatml-backend/cleanup"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/naming"
	"github.com/chatml/chatml-backend/server"
	"github.com/chatml/chatml-backend/session"
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

	s, err := store.NewSQLiteStore()
	if err != nil {
		logger.Main.Fatalf("Failed to initialize store: %v", err)
	}
	defer s.Close()

	hub := server.NewHub()
	wm := git.NewWorktreeManager()

	// Clean up orphaned worktrees from previous crashes or failed session creations
	// Use a timeout to prevent startup from hanging indefinitely on git lock issues
	cleanupCtx, cleanupCancel := context.WithTimeout(ctx, 30*time.Second)
	if err := cleanup.CleanOrphanedWorktrees(cleanupCtx, s, wm); err != nil {
		logger.Cleanup.Warnf("Orphan cleanup failed: %v", err)
		// Non-fatal - continue startup
	}
	cleanupCancel()

	agentMgr := agent.NewManager(s, wm)

	// GitHub OAuth client
	ghConfig := server.LoadGitHubConfig()
	ghClient := github.NewClient(ghConfig.ClientID, ghConfig.ClientSecret)

	// Session stats cache with 30 second TTL
	statsCache := server.NewSessionStatsCache(30 * time.Second)
	defer statsCache.Close()

	// Repo manager for stats computation in callbacks
	repoManager := git.NewRepoManager()

	// Agent orchestrator disabled - feature hidden for later release
	// To re-enable: uncomment orchestrator initialization and pass orch to NewRouter

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

			// Update session metadata file
			if meta, err := session.ReadMetadata(event.SessionID); err == nil {
				meta.Name = newName
				meta.Branch = event.NewBranch
				if err := session.WriteMetadata(meta); err != nil {
					logger.BranchWatcher.Errorf("Failed to update metadata for %s: %v", event.SessionID, err)
				}
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

				// Determine base ref
				baseRef := sess.BaseCommitSHA
				if baseRef == "" && repo != nil {
					baseRef = repo.Branch
				}
				if baseRef == "" {
					baseRef = "main"
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
		repos, listErr := s.ListRepos(ctx)
		if listErr == nil {
			for _, repo := range repos {
				sessions, sessErr := s.ListSessions(ctx, repo.ID)
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

	// PR watcher for background GitHub PR status monitoring
	// Creates a watcher that polls GitHub for PR changes and broadcasts updates via WebSocket
	prWatcher := branch.NewPRWatcher(ghClient, repoManager, s, func(event branch.PRChangeEvent) {
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

			// Emit WebSocket event for frontend
			hub.Broadcast(server.Event{
				Type:      "session_pr_update",
				SessionID: event.SessionID,
				Payload: map[string]interface{}{
					"prStatus":    event.PRStatus,
					"prNumber":    event.PRNumber,
					"prUrl":       event.PRUrl,
					"checkStatus": event.CheckStatus,
					"mergeable":   event.Mergeable,
				},
			})
		}()
	})
	defer prWatcher.Close()

	// Initialize PR watches for existing sessions
	if ghClient.IsAuthenticated() {
		repos, listErr := s.ListRepos(ctx)
		if listErr == nil {
			for _, repo := range repos {
				sessions, sessErr := s.ListSessions(ctx, repo.ID)
				if sessErr != nil {
					continue
				}
				for _, sess := range sessions {
					if sess.WorktreePath != "" && sess.Branch != "" {
						prWatcher.WatchSession(sess.ID, sess.WorkspaceID, sess.Branch, repo.Path, sess.PRStatus)
					}
				}
			}
		}
	}

	router := server.NewRouter(s, hub, agentMgr, ghClient, nil, branchWatcher, prWatcher, statsCache)

	// Create HTTP server with graceful shutdown support
	srv := &http.Server{
		Handler: router,
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
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Main.Errorf("Server shutdown error: %v", err)
	}

	logger.Main.Info("Server stopped")
}
