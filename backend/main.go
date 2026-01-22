package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/branch"
	"github.com/chatml/chatml-backend/cleanup"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/naming"
	"github.com/chatml/chatml-backend/orchestrator"
	"github.com/chatml/chatml-backend/server"
	"github.com/chatml/chatml-backend/session"
	"github.com/chatml/chatml-backend/store"
)

func main() {
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
	cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
	if err := cleanup.CleanOrphanedWorktrees(cleanupCtx, s, wm); err != nil {
		log.Printf("Warning: orphan cleanup failed: %v", err)
		// Non-fatal - continue startup
	}
	cleanupCancel()

	agentMgr := agent.NewManager(s, wm)

	// GitHub OAuth client
	ghConfig := server.LoadGitHubConfig()
	ghClient := github.NewClient(ghConfig.ClientID, ghConfig.ClientSecret)

	// Agent orchestrator
	agentsDir := os.Getenv("CHATML_AGENTS_DIR")
	if agentsDir == "" {
		// Default to agents/ directory relative to working directory
		// In production, this should be configured explicitly
		wd, _ := os.Getwd()
		agentsDir = filepath.Join(wd, "..", "agents")
	}

	orch := orchestrator.New(s, orchestrator.Config{
		AgentsDir: agentsDir,
	})

	// Subscribe orchestrator events to WebSocket hub
	orch.Subscribe(func(event orchestrator.Event) {
		hub.BroadcastJSON(event)
	})

	// Start orchestrator
	if err := orch.Start(); err != nil {
		log.Printf("Warning: Failed to start orchestrator: %v", err)
		// Don't fatal - app can still work without orchestrator
	}
	defer orch.Stop()

	// Branch watcher for instant detection of git branch changes
	branchWatcher, err := branch.NewWatcher(func(event branch.BranchChangeEvent) {
		// Handle updates asynchronously to avoid blocking the watcher's event loop
		go func() {
			ctx := context.Background()

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

		// Initialize watches for existing sessions
		repos, listErr := s.ListRepos(context.Background())
		if listErr == nil {
			for _, repo := range repos {
				sessions, sessErr := s.ListSessions(context.Background(), repo.ID)
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

	router := server.NewRouter(s, hub, agentMgr, ghClient, orch, branchWatcher)

	log.Printf("ChatML backend starting on port %s", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatal(err)
	}
}
