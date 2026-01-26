package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/branch"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/orchestrator"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"
	"github.com/rs/cors"
)

func NewRouter(s *store.SQLiteStore, hub *Hub, agentMgr *agent.Manager, ghClient *github.Client, orch *orchestrator.Orchestrator, bw *branch.Watcher, statsCache *SessionStatsCache) http.Handler {
	r := chi.NewRouter()
	dirCacheConfig := LoadDirListingCacheConfig()
	h := NewHandlers(s, agentMgr, dirCacheConfig, bw, hub, ghClient, statsCache)
	auth := NewAuthHandlers(ghClient)

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(TokenAuthMiddleware)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// Auth endpoints (no rate limiting - they're naturally rate limited by OAuth)
	r.Route("/api/auth", func(r chi.Router) {
		r.Post("/github/callback", auth.GitHubCallback)
		r.Post("/token", auth.SetToken)
		r.Get("/status", auth.GetStatus)
		r.Post("/logout", auth.Logout)
	})

	// WebSocket
	r.Get("/ws", hub.HandleWebSocket)

	// WebSocket stats endpoint (local desktop app only - no auth needed)
	// NOTE: If this app is ever exposed to a network, consider adding authentication
	r.Get("/ws/stats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(hub.GetStats())
	})

	// Rate limiting middleware for sensitive operations
	agentRateLimiter := httprate.LimitByIP(10, 1*time.Minute)        // 10 agent spawns per minute
	conversationRateLimiter := httprate.LimitByIP(20, 1*time.Minute) // 20 conversations per minute
	messageRateLimiter := httprate.LimitByIP(60, 1*time.Minute)      // 60 messages per minute

	// Rate limiter for comment operations
	commentRateLimiter := httprate.LimitByIP(60, 1*time.Minute) // 60 comments per minute

	// PR Dashboard endpoint
	r.Get("/api/prs", h.ListPRs)

	// Dashboard data endpoint - fetches all workspaces, sessions, and conversations in one request
	r.Get("/api/dashboard/data", h.GetDashboardData)

	// Repository endpoints
	r.Route("/api/repos", func(r chi.Router) {
		r.Get("/", h.ListRepos)
		r.Post("/", h.AddRepo)
		r.Get("/{id}", h.GetRepo)
		r.Get("/{id}/details", h.GetRepoDetails)
		r.Delete("/{id}", h.DeleteRepo)
		r.Get("/{id}/files", h.ListRepoFiles)
		r.Get("/{id}/file", h.GetRepoFileContent)
		r.Post("/{id}/file/save", h.SaveFile)
		r.Get("/{id}/diff", h.GetFileDiff)
		r.Get("/{id}/sessions", h.ListSessions)
		r.Post("/{id}/sessions", h.CreateSession)
		r.Get("/{id}/sessions/{sessionId}", h.GetSession)
		r.Patch("/{id}/sessions/{sessionId}", h.UpdateSession)
		r.Delete("/{id}/sessions/{sessionId}", h.DeleteSession)
		r.Get("/{id}/sessions/{sessionId}/changes", h.GetSessionChanges)
		r.Get("/{id}/sessions/{sessionId}/git-status", h.GetSessionGitStatus)
		r.Get("/{id}/sessions/{sessionId}/pr-status", h.GetSessionPRStatus)
		r.Get("/{id}/sessions/{sessionId}/diff", h.GetSessionFileDiff)
		r.Get("/{id}/sessions/{sessionId}/file-history", h.GetSessionFileHistory)
		r.Get("/{id}/sessions/{sessionId}/file-at-ref", h.GetSessionFileAtRef)
		r.Get("/{id}/sessions/{sessionId}/file", h.GetSessionFileContent)
		r.Get("/{id}/sessions/{sessionId}/files", h.ListSessionFiles)
		r.With(messageRateLimiter).Post("/{id}/sessions/{sessionId}/message", h.SendSessionMessage)
		// Conversation endpoints nested under sessions
		r.Get("/{id}/sessions/{sessionId}/conversations", h.ListConversations)
		r.With(conversationRateLimiter).Post("/{id}/sessions/{sessionId}/conversations", h.CreateConversation)
		// Review comment endpoints nested under sessions
		r.Get("/{id}/sessions/{sessionId}/comments", h.ListReviewComments)
		r.With(commentRateLimiter).Post("/{id}/sessions/{sessionId}/comments", h.CreateReviewComment)
		r.Get("/{id}/sessions/{sessionId}/comments/stats", h.GetReviewCommentStats)
		r.Patch("/{id}/sessions/{sessionId}/comments/{commentId}", h.UpdateReviewComment)
		r.Delete("/{id}/sessions/{sessionId}/comments/{commentId}", h.DeleteReviewComment)
		r.Get("/{id}/agents", h.ListAgents)
		r.With(agentRateLimiter).Post("/{id}/agents", h.SpawnAgent)
		// File tabs
		r.Get("/{id}/tabs", h.ListFileTabs)
		r.Post("/{id}/tabs", h.SaveFileTabs)
		r.Delete("/{id}/tabs/{tabId}", h.DeleteFileTab)
	})

	// Conversation endpoints (top-level for direct access)
	r.Route("/api/conversations", func(r chi.Router) {
		r.Get("/{convId}", h.GetConversation)
		r.With(messageRateLimiter).Post("/{convId}/messages", h.SendConversationMessage)
		r.Post("/{convId}/stop", h.StopConversation)
		r.Post("/{convId}/rewind", h.RewindConversation)
		r.Post("/{convId}/plan-mode", h.SetConversationPlanMode)
		r.Delete("/{convId}", h.DeleteConversation)
	})

	// Agent endpoints (legacy)
	r.Route("/api/agents", func(r chi.Router) {
		r.Get("/{id}", h.GetAgent)
		r.Post("/{id}/stop", h.StopAgent)
		r.Get("/{id}/diff", h.GetAgentDiff)
		r.Post("/{id}/merge", h.MergeAgent)
		r.Delete("/{id}", h.DeleteAgent)
	})

	// Orchestrator agent endpoints
	if orch != nil {
		oh := NewOrchestratorHandlers(orch)
		r.Route("/api/orchestrator/agents", func(r chi.Router) {
			r.Get("/", oh.ListAgents)
			r.Post("/reload", oh.ReloadAgents)

			r.Route("/{agentId}", func(r chi.Router) {
				r.Get("/", oh.GetAgent)
				r.Patch("/", oh.UpdateAgentState)
				r.Post("/run", oh.TriggerAgentRun)
				r.Get("/runs", oh.ListAgentRuns)
				r.Get("/runs/{runId}", oh.GetAgentRun)
				r.Post("/runs/{runId}/stop", oh.StopAgentRun)
			})
		})
	}

	// Wire up agent manager callbacks (legacy)
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

	// Wire up conversation event handlers
	agentMgr.SetConversationEventHandler(func(conversationID string, event *agent.AgentEvent) {
		hub.Broadcast(Event{
			Type:           event.Type,
			ConversationID: conversationID,
			Payload:        event,
		})
	})

	agentMgr.SetConversationStatusHandler(func(conversationID string, status string) {
		hub.Broadcast(Event{
			Type:           "conversation_status",
			ConversationID: conversationID,
			Payload:        status,
		})
	})

	// Wire up session event handler
	agentMgr.SetSessionEventHandler(func(sessionID string, event map[string]interface{}) {
		eventType, _ := event["type"].(string)
		hub.Broadcast(Event{
			Type:      eventType,
			SessionID: sessionID,
			Payload:   event,
		})
	})

	handler := cors.New(cors.Options{
		AllowedOrigins:   AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		AllowCredentials: false, // Not needed for this app
	}).Handler(r)

	return handler
}
