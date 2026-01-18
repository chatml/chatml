package server

import (
	"encoding/json"
	"net/http"

	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/cors"
)

func NewRouter(s *store.Store) http.Handler {
	r := chi.NewRouter()
	h := NewHandlers(s)

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// Repository endpoints
	r.Route("/api/repos", func(r chi.Router) {
		r.Get("/", h.ListRepos)
		r.Post("/", h.AddRepo)
		r.Get("/{id}", h.GetRepo)
		r.Delete("/{id}", h.DeleteRepo)
		r.Get("/{id}/agents", h.ListAgents)
	})

	// Agent endpoints
	r.Route("/api/agents", func(r chi.Router) {
		r.Get("/{id}", h.GetAgent)
		r.Get("/{id}/diff", h.GetAgentDiff)
		r.Post("/{id}/merge", h.MergeAgent)
		r.Delete("/{id}", h.DeleteAgent)
	})

	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	}).Handler(r)

	return handler
}
