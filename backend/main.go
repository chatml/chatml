package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/branch"
	"github.com/chatml/chatml-backend/cleanup"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/naming"
	"github.com/chatml/chatml-backend/server"
	"github.com/chatml/chatml-backend/session"
	"github.com/chatml/chatml-backend/store"
)

func main() {
	// Create root context that cancels on SIGINT/SIGTERM
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	port := os.Getenv("PORT")
	if port == "" {
		port = "9876"
	}

	s, err := store.NewSQLiteStore()
	if err != nil {
		log.Fatalf("Failed to initialize store: %v", err)
	}
	defer s.Close()

	hub := server.NewHub()
	wm := git.NewWorktreeManager()

	// Clean up orphaned worktrees from previous crashes or failed session creations
	// Use a timeout to prevent startup from hanging indefinitely on git lock issues
	cleanupCtx, cleanupCancel := context.WithTimeout(ctx, 30*time.Second)
	if err := cleanup.CleanOrphanedWorktrees(cleanupCtx, s, wm); err != nil {
		log.Printf("Warning: orphan cleanup failed: %v", err)
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
					log.Printf("[branch-watcher] PANIC recovered: %v\n%s", r, debug.Stack())
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
				log.Printf("[branch-watcher] Failed to update session %s: %v", event.SessionID, updateErr)
				return
			}

			// Update session metadata file
			if meta, err := session.ReadMetadata(event.SessionID); err == nil {
				meta.Name = newName
				meta.Branch = event.NewBranch
				if err := session.WriteMetadata(meta); err != nil {
					log.Printf("[branch-watcher] Failed to update metadata for %s: %v", event.SessionID, err)
				}
			}

			log.Printf("[branch-watcher] Updated session %s: branch=%q name=%q", event.SessionID, event.NewBranch, newName)

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
		log.Printf("Warning: Failed to start branch watcher: %v", err)
		// Non-fatal - app can still work without instant branch detection
	}
	if branchWatcher != nil {
		defer branchWatcher.Close()

		// Set up stats invalidation callback for real-time stats updates
		branchWatcher.SetStatsInvalidateCallback(func(sessionID string) {
			go func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[stats-watcher] PANIC recovered: %v\n%s", r, debug.Stack())
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
							log.Printf("Warning: Failed to watch existing session %s: %v", sess.ID, watchErr)
						}
					}
				}
			}
		}
	}

	go hub.Run()

	router := server.NewRouter(s, hub, agentMgr, ghClient, nil, branchWatcher, statsCache)

	// Create HTTP server with graceful shutdown support
	srv := &http.Server{
		Addr:    ":" + port,
		Handler: router,
	}

	// Start server in goroutine
	go func() {
		log.Printf("ChatML backend starting on port %s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Wait for shutdown signal
	<-ctx.Done()
	log.Println("Shutdown signal received, stopping server...")

	// Give outstanding requests a short deadline to complete
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}

	log.Println("Server stopped")
}
