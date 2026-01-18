package server

import (
	"encoding/json"
	"net/http"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/cors"
)

func NewRouter(s *store.Store, hub *Hub, agentMgr *agent.Manager) http.Handler {
	r := chi.NewRouter()
	h := NewHandlers(s, agentMgr)

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// WebSocket
	r.Get("/ws", hub.HandleWebSocket)

	// Repository endpoints
	r.Route("/api/repos", func(r chi.Router) {
		r.Get("/", h.ListRepos)
		r.Post("/", h.AddRepo)
		r.Get("/{id}", h.GetRepo)
		r.Delete("/{id}", h.DeleteRepo)
		r.Get("/{id}/files", h.ListRepoFiles)
		r.Get("/{id}/agents", h.ListAgents)
		r.Post("/{id}/agents", h.SpawnAgent)
	})

	// Agent endpoints
	r.Route("/api/agents", func(r chi.Router) {
		r.Get("/{id}", h.GetAgent)
		r.Post("/{id}/stop", h.StopAgent)
		r.Get("/{id}/diff", h.GetAgentDiff)
		r.Post("/{id}/merge", h.MergeAgent)
		r.Delete("/{id}", h.DeleteAgent)
	})

	// Wire up agent manager callbacks
	agentMgr.SetOutputHandler(func(agentID, line string) {
		hub.Broadcast(Event{
			Type:    "output",
			AgentID: agentID,
			Payload: line,
		})
	})

	agentMgr.SetStatusHandler(func(agentID string, status models.AgentStatus) {
		hub.Broadcast(Event{
			Type:    "status",
			AgentID: agentID,
			Payload: string(status),
		})
	})

	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	}).Handler(r)

	return handler
}
