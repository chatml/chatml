package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/cleanup"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/orchestrator"
	"github.com/chatml/chatml-backend/server"
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

	go hub.Run()

	router := server.NewRouter(s, hub, agentMgr, ghClient, orch)

	log.Printf("ChatML backend starting on port %s", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatal(err)
	}
}
