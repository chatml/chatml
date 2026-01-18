package main

import (
	"log"
	"net/http"
	"os"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/git"
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
	agentMgr := agent.NewManager(s, wm)

	go hub.Run()

	router := server.NewRouter(s, hub, agentMgr)

	log.Printf("ChatML backend starting on port %s", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatal(err)
	}
}
