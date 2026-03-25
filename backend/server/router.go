package server

import (
	"context"
	"net/http"
	"os"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/ai"
	"github.com/chatml/chatml-backend/branch"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/linear"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/scripts"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"
	"github.com/rs/cors"
)

func NewRouter(ctx context.Context, s *store.SQLiteStore, hub *Hub, agentMgr *agent.Manager, ghClient *github.Client, linearClient *linear.Client, bw *branch.Watcher, prw *branch.PRWatcher, prCache *github.PRCache, issueCache *github.IssueCache, statsCache *SessionStatsCache, diffCache *DiffCache, snapshotCache *SnapshotCache, aiClient ai.Provider, scriptRunner *scripts.Runner) (http.Handler, *Handlers, func()) {
	r := chi.NewRouter()
	dirCacheConfig := LoadDirListingCacheConfig()
	h := NewHandlers(ctx, s, agentMgr, dirCacheConfig, bw, prw, hub, ghClient, prCache, issueCache, statsCache, diffCache, snapshotCache, aiClient, scriptRunner)
	auth := NewAuthHandlers(ghClient, s)
	linearAuth := NewLinearAuthHandlers(linearClient, s)
	// Relay is only enabled when CHATML_RELAY_URL is set (i.e., a cloud relay
	// exists to connect to). Without it, relay endpoints are not registered and
	// the mobile pairing UI hides itself automatically.
	var relayH *RelayHandlers
	if os.Getenv("CHATML_RELAY_URL") != "" {
		relayH = NewRelayHandlers(hub, os.Getenv("CHATML_AUTH_TOKEN"))
	}

	r.Use(middleware.Compress(5))
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(TokenAuthMiddleware)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"status": "ok", "version": buildVersion})
	})

	// Provider capabilities endpoint
	r.Get("/api/provider/capabilities", h.GetProviderCapabilities)

	// Auth endpoints (no rate limiting - they're naturally rate limited by OAuth)
	r.Route("/api/auth", func(r chi.Router) {
		r.Post("/github/callback", auth.GitHubCallback)
		r.Post("/token", auth.SetToken)
		r.Get("/status", auth.GetStatus)
		r.Post("/logout", auth.Logout)

		// Linear OAuth
		r.Post("/linear/callback", linearAuth.Callback)
		r.Get("/linear/status", linearAuth.GetStatus)
		r.Post("/linear/logout", linearAuth.Logout)

		// Linear issue endpoints
		r.Get("/linear/issues", linearAuth.ListMyIssues)
		r.Get("/linear/issues/search", linearAuth.SearchLinearIssues)
	})

	// WebSocket
	r.Get("/ws", hub.HandleWebSocket)

	// WebSocket stats endpoint (local desktop app only - no auth needed)
	// NOTE: If this app is ever exposed to a network, consider adding authentication
	r.Get("/ws/stats", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, hub.GetStats())
	})

	// Rate limiting middleware for sensitive operations
	agentRateLimiter := httprate.LimitByIP(10, 1*time.Minute)        // 10 agent spawns per minute
	conversationRateLimiter := httprate.LimitByIP(20, 1*time.Minute) // 20 conversations per minute
	messageRateLimiter := httprate.LimitByIP(60, 1*time.Minute)      // 60 messages per minute

	// Rate limiter for comment operations
	commentRateLimiter := httprate.LimitByIP(60, 1*time.Minute) // 60 comments per minute

	// Rate limiter for GitHub search operations (GitHub search API has 30 req/min limit)
	searchRateLimiter := httprate.LimitByIP(20, 1*time.Minute) // 20 searches per minute

	// Clone endpoint
	r.Post("/api/clone", h.CloneRepo)

	// GitHub integration endpoints
	r.Route("/api/github", func(r chi.Router) {
		r.With(searchRateLimiter).Get("/repos", h.ListGitHubRepos)
		r.Get("/orgs", h.ListGitHubOrgs)
		r.Post("/resolve-repo", h.ResolveGitHubRepo)
	})

	// PR Dashboard endpoint
	r.Get("/api/prs", h.ListPRs)

	// Resolve PR from URL (for "create session from PR" flow)
	r.Post("/api/resolve-pr", h.ResolvePR)

	// Avatar lookup endpoint
	r.Get("/api/avatars", h.GetAvatars)

	// Sessions endpoint — returns all sessions across all workspaces in a single query
	r.Get("/api/sessions", h.ListAllSessions)

	// Scheduled tasks endpoints
	r.Get("/api/scheduled-tasks", h.ListAllScheduledTasks)
	r.Route("/api/scheduled-tasks/{taskId}", func(r chi.Router) {
		r.Get("/", h.GetScheduledTask)
		r.Patch("/", h.UpdateScheduledTask)
		r.Delete("/", h.DeleteScheduledTask)
		r.Get("/runs", h.ListScheduledTaskRuns)
		r.Post("/trigger", h.TriggerScheduledTask)
	})

	// Available agents metadata (not workspace-specific)
	r.Get("/api/settings/available-agents", h.GetAvailableAgents)

	// Repository endpoints
	r.Route("/api/repos", func(r chi.Router) {
		r.Get("/", h.ListRepos)
		r.Post("/", h.AddRepo)
		r.Get("/{id}", h.GetRepo)
		r.Get("/{id}/details", h.GetRepoDetails)
		r.Patch("/{id}", h.UpdateRepoSettings)
		r.Delete("/{id}", h.DeleteRepo)
		r.Get("/{id}/remotes", h.GetRepoRemotes)
		r.Get("/{id}/branches", h.ListBranches)
		r.Post("/{id}/branches/analyze-cleanup", h.AnalyzeBranchCleanup)
		r.Post("/{id}/branches/cleanup", h.ExecuteBranchCleanup)
		r.Get("/{id}/conversations", h.ListWorkspaceConversations)
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
		r.Get("/{id}/sessions/{sessionId}/branch-commits", h.GetSessionBranchCommits)
		r.Get("/{id}/sessions/{sessionId}/git-status", h.GetSessionGitStatus)
		r.Get("/{id}/sessions/{sessionId}/snapshot", h.GetSessionSnapshot)
		r.Get("/{id}/sessions/{sessionId}/pr-status", h.GetSessionPRStatus)
		r.Post("/{id}/sessions/{sessionId}/pr-refresh", h.RefreshPRStatus)
		r.Post("/{id}/sessions/{sessionId}/pr/report", h.ReportPRCreated)
		r.Post("/{id}/sessions/{sessionId}/pr/report-merge", h.ReportPRMerged)
		r.Post("/{id}/sessions/{sessionId}/pr/unlink", h.UnlinkPR)
		r.Get("/{id}/settings/pr-template", h.GetPRTemplate)
		r.Put("/{id}/settings/pr-template", h.SetPRTemplate)
		r.Get("/{id}/settings/review-prompts", h.GetWorkspaceReviewPrompts)
		r.Put("/{id}/settings/review-prompts", h.SetWorkspaceReviewPrompts)
		r.Get("/{id}/settings/action-templates", h.GetWorkspaceActionTemplates)
		r.Put("/{id}/settings/action-templates", h.SetWorkspaceActionTemplates)
		r.Get("/{id}/settings/enabled-agents", h.GetEnabledAgents)
		r.Put("/{id}/settings/enabled-agents", h.SetEnabledAgents)
		// gstack skill pack endpoints
		r.Get("/{id}/gstack/status", h.GetGstackStatus)
		r.Post("/{id}/gstack/enable", h.EnableGstack)
		r.Post("/{id}/gstack/disable", h.DisableGstack)
		r.Post("/{id}/gstack/sync", h.SyncGstack)
		r.Get("/{id}/sessions/{sessionId}/branch-sync", h.GetSessionBranchSyncStatus)
		r.Post("/{id}/sessions/{sessionId}/branch-sync", h.SyncSessionBranch)
		r.Post("/{id}/sessions/{sessionId}/branch-sync/abort", h.AbortSessionSync)
		r.Get("/{id}/sessions/{sessionId}/diff", h.GetSessionFileDiff)
		r.Get("/{id}/sessions/{sessionId}/diff-summary", h.GetSessionDiffSummary)
		r.Get("/{id}/sessions/{sessionId}/file-history", h.GetSessionFileHistory)
		r.Get("/{id}/sessions/{sessionId}/file-at-ref", h.GetSessionFileAtRef)
		r.Get("/{id}/sessions/{sessionId}/file", h.GetSessionFileContent)
		r.Get("/{id}/sessions/{sessionId}/files", h.ListSessionFiles)
		r.Get("/{id}/sessions/{sessionId}/commands", h.ListUserCommands)
		r.With(messageRateLimiter).Post("/{id}/sessions/{sessionId}/message", h.SendSessionMessage)
		// Conversation endpoints nested under sessions
		r.Get("/{id}/sessions/{sessionId}/conversations", h.ListConversations)
		r.With(conversationRateLimiter).Post("/{id}/sessions/{sessionId}/conversations", h.CreateConversation)
		// Session-level summary listing
		r.Get("/{id}/sessions/{sessionId}/summaries", h.ListSessionSummaries)
		// Review comment endpoints nested under sessions
		r.Get("/{id}/sessions/{sessionId}/comments", h.ListReviewComments)
		r.With(commentRateLimiter).Post("/{id}/sessions/{sessionId}/comments", h.CreateReviewComment)
		r.Get("/{id}/sessions/{sessionId}/comments/stats", h.GetReviewCommentStats)
		r.Post("/{id}/sessions/{sessionId}/review-scorecards", h.CreateReviewScorecard)
		r.Get("/{id}/sessions/{sessionId}/review-scorecards", h.ListReviewScorecards)
		r.Patch("/{id}/sessions/{sessionId}/comments/{commentId}", h.UpdateReviewComment)
		r.Delete("/{id}/sessions/{sessionId}/comments/{commentId}", h.DeleteReviewComment)
		// CI/Actions endpoints
		r.Get("/{id}/sessions/{sessionId}/ci/runs", h.ListCIRuns)
		r.Get("/{id}/sessions/{sessionId}/ci/runs/{runId}", h.GetCIRun)
		r.Get("/{id}/sessions/{sessionId}/ci/runs/{runId}/jobs", h.ListCIJobs)
		r.Post("/{id}/sessions/{sessionId}/ci/runs/{runId}/rerun", h.RerunCIWorkflow)
		r.Get("/{id}/sessions/{sessionId}/ci/jobs/{jobId}/logs", h.GetCIJobLogs)
		r.Post("/{id}/sessions/{sessionId}/ci/analyze", h.AnalyzeCIFailure)
		r.Get("/{id}/sessions/{sessionId}/ci/failure-context", h.GetCIFailureContext)
		// Commit status endpoints
		r.Post("/{id}/sessions/{sessionId}/status", h.PostCommitStatus)
		r.Get("/{id}/sessions/{sessionId}/statuses", h.ListCommitStatuses)
		// Base session endpoints (preflight, branch management, stash)
		r.Get("/{id}/sessions/{sessionId}/preflight", h.PreflightCheck)
		r.Get("/{id}/sessions/{sessionId}/current-branch", h.GetCurrentSessionBranch)
		r.Post("/{id}/sessions/{sessionId}/branches/create", h.CreateSessionBranch)
		r.Post("/{id}/sessions/{sessionId}/branches/switch", h.SwitchSessionBranch)
		r.Delete("/{id}/sessions/{sessionId}/branches/{branchName}", h.DeleteSessionBranch)
		r.Get("/{id}/sessions/{sessionId}/stashes", h.ListStashes)
		r.Post("/{id}/sessions/{sessionId}/stashes", h.CreateStash)
		r.Post("/{id}/sessions/{sessionId}/stashes/{index}/apply", h.ApplyStash)
		r.Post("/{id}/sessions/{sessionId}/stashes/{index}/pop", h.PopStash)
		r.Delete("/{id}/sessions/{sessionId}/stashes/{index}", h.DropStash)
		r.Get("/{id}/agents", h.ListAgents)
		r.With(agentRateLimiter).Post("/{id}/agents", h.SpawnAgent)
		// File tabs
		r.Get("/{id}/tabs", h.ListFileTabs)
		r.Post("/{id}/tabs", h.SaveFileTabs)
		r.Delete("/{id}/tabs/{tabId}", h.DeleteFileTab)
		// GitHub Issues endpoints
		r.Get("/{id}/issues", h.ListIssues)
		r.With(searchRateLimiter).Get("/{id}/issues/search", h.SearchIssues)
		r.Get("/{id}/issues/{number}", h.GetIssueDetails)
		// Memory file endpoints (workspace-level)
		r.Get("/{id}/memory", h.ListMemoryFiles)
		r.Get("/{id}/memory/file", h.GetMemoryFile)
		r.Put("/{id}/memory/file", h.SaveMemoryFile)
		r.Delete("/{id}/memory/file", h.DeleteMemoryFile)
		// MCP server config endpoints
		r.Get("/{id}/mcp-servers", h.GetMcpServers)
		r.Put("/{id}/mcp-servers", h.SetMcpServers)
		// Workspace .mcp.json trust endpoints
		r.Get("/{id}/dot-mcp-trust", h.GetDotMcpTrust)
		r.Put("/{id}/dot-mcp-trust", h.SetDotMcpTrust)
		r.Get("/{id}/dot-mcp-info", h.GetDotMcpInfo)
		// Scripts config endpoints
		r.Get("/{id}/config", h.GetWorkspaceConfig)
		r.Put("/{id}/config", h.UpdateWorkspaceConfig)
		r.Get("/{id}/config/detect", h.DetectWorkspaceConfig)
		// Script execution endpoints
		r.Post("/{id}/sessions/{sessionId}/scripts/run", h.RunScript)
		r.Post("/{id}/sessions/{sessionId}/scripts/setup", h.RunSetupScripts)
		r.Post("/{id}/sessions/{sessionId}/scripts/stop", h.StopSessionScript)
		r.Get("/{id}/sessions/{sessionId}/scripts/runs", h.ListScriptRuns)
		// Scheduled task endpoints (workspace-scoped creation)
		r.Get("/{id}/scheduled-tasks", h.ListWorkspaceScheduledTasks)
		r.Post("/{id}/scheduled-tasks", h.CreateScheduledTask)
	})

	// Conversation endpoints (top-level for direct access)
	r.Route("/api/conversations", func(r chi.Router) {
		r.Get("/active-streaming", h.GetActiveStreamingConversations)
		r.Get("/interrupted", h.GetInterruptedConversations)
		r.Get("/{convId}", h.GetConversation)
		r.Get("/{convId}/messages", h.GetConversationMessages)
		r.Get("/{convId}/messages/{msgId}", h.GetMessage)
		r.With(messageRateLimiter).Post("/{convId}/messages", h.SendConversationMessage)
		r.Post("/{convId}/system-message", h.AddSystemMessage)
		r.Post("/{convId}/stop", h.StopConversation)
		r.Get("/{convId}/streaming-snapshot", h.GetStreamingSnapshot)
		r.Get("/{convId}/drop-stats", h.GetConversationDropStats)
		r.Post("/{convId}/rewind", h.RewindConversation)
		r.Post("/{convId}/plan-mode", h.SetConversationPlanMode)
		r.Post("/{convId}/permission-mode", h.SetConversationPermissionMode)
		r.Post("/{convId}/fast-mode", h.SetConversationFastMode)
		r.Post("/{convId}/max-thinking-tokens", h.SetConversationMaxThinkingTokens)
		r.Post("/{convId}/approve-plan", h.ApprovePlan)
		r.Post("/{convId}/approve-tool", h.ApproveTool)
		r.Post("/{convId}/answer-question", h.AnswerConversationQuestion)
		r.Post("/{convId}/answer-sprint-phase", h.AnswerSprintPhaseProposal)
		r.Post("/{convId}/answer-qa-handoff", h.AnswerQAHandoff)
		r.Post("/{convId}/resume-agent", h.ResumeAgent)
		r.Post("/{convId}/clear-snapshot", h.ClearStreamingSnapshot)
		r.Delete("/{convId}", h.DeleteConversation)
		// Summary endpoints
		r.With(conversationRateLimiter).Post("/{convId}/summary", h.GenerateConversationSummary)
		r.Get("/{convId}/summary", h.GetConversationSummary)
	})

	// Settings endpoints
	r.Get("/api/settings/workspaces-base-dir", h.GetWorkspacesBaseDir)
	r.Put("/api/settings/workspaces-base-dir", h.SetWorkspacesBaseDir)
	r.Get("/api/settings/review-prompts", h.GetReviewPrompts)
	r.Put("/api/settings/review-prompts", h.SetReviewPrompts)
	r.Get("/api/settings/custom-instructions", h.GetCustomInstructions)
	r.Put("/api/settings/custom-instructions", h.SetCustomInstructions)
	r.Get("/api/settings/env", h.GetEnvSettings)
	r.Put("/api/settings/env", h.SetEnvSettings)
	r.Get("/api/settings/pr-template", h.GetGlobalPRTemplate)
	r.Put("/api/settings/pr-template", h.SetGlobalPRTemplate)
	r.Get("/api/settings/anthropic-api-key", h.GetAnthropicApiKey)
	r.Put("/api/settings/anthropic-api-key", h.SetAnthropicApiKey)
	r.Get("/api/settings/github-personal-token", h.GetGitHubPersonalToken)
	r.Put("/api/settings/github-personal-token", h.SetGitHubPersonalToken)
	r.Get("/api/settings/action-templates", h.GetActionTemplates)
	r.Put("/api/settings/action-templates", h.SetActionTemplates)
	r.Get("/api/settings/claude-auth-status", h.GetClaudeAuthStatus)
	r.Get("/api/settings/claude-env", h.GetClaudeEnv)
	r.Get("/api/settings/never-load-dot-mcp", h.GetNeverLoadDotMcp)
	r.Put("/api/settings/never-load-dot-mcp", h.SetNeverLoadDotMcp)
	r.Post("/api/settings/aws-auth-refresh", h.RefreshAWSCredentials)
	r.Get("/api/settings/aws-sso-token-status", h.GetAWSSSOTokenStatus)

	// Attachment endpoints
	r.Get("/api/attachments/{attachmentId}/data", h.GetAttachmentData)

	// Agent endpoints (legacy)
	r.Route("/api/agents", func(r chi.Router) {
		r.Get("/{id}", h.GetAgent)
		r.Post("/{id}/stop", h.StopAgent)
		r.Get("/{id}/diff", h.GetAgentDiff)
		r.Post("/{id}/merge", h.MergeAgent)
		r.Delete("/{id}", h.DeleteAgent)
	})

	// Skills catalog endpoints
	r.Route("/api/skills", func(r chi.Router) {
		r.Get("/", h.ListSkills)
		r.Get("/installed", h.ListInstalledSkills)
		r.Post("/{id}/install", h.InstallSkill)
		r.Delete("/{id}/uninstall", h.UninstallSkill)
		r.Get("/{id}/content", h.GetSkillContent)
	})

	// Relay endpoints for mobile remote control (only when relay is configured)
	if relayH != nil {
		r.Route("/api/relay", func(r chi.Router) {
			r.Post("/pair/start", relayH.StartPairing)
			r.Post("/pair/cancel", relayH.CancelPairing)
			r.Get("/status", relayH.GetStatus)
			r.Post("/disconnect", relayH.Disconnect)
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

	// Set the router reference for the relay HTTP-over-WebSocket proxy.
	// This must happen after the CORS-wrapped handler is built so that
	// proxied requests go through the full middleware stack.
	if relayH != nil {
		relayH.SetRouter(handler)
	}

	return handler, h, h.Close
}
