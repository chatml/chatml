package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/ai"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Conversation handlers

func (h *Handlers) ListConversations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	convs, err := h.store.ListConversations(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, convs)
}

type CreateConversationRequest struct {
	Type              string              `json:"type"`              // "task", "review", "chat"
	Message           string              `json:"message"`           // Initial message (optional)
	Model             string              `json:"model"`             // Model name override (optional)
	PlanMode          bool                `json:"planMode"`          // Start in plan mode (optional)
	MaxThinkingTokens int                 `json:"maxThinkingTokens"` // Enable extended thinking (optional)
	Effort            string              `json:"effort"`            // Reasoning effort: low, medium, high, max (optional)
	Attachments       []models.Attachment `json:"attachments"`       // File attachments (optional)
	SummaryIDs        []string            `json:"summaryIds"`        // Summaries to attach as context (optional)
	LinearIssue       *struct {
		Identifier  string   `json:"identifier"`
		Title       string   `json:"title"`
		Description string   `json:"description,omitempty"`
		StateName   string   `json:"stateName"`
		Labels      []string `json:"labels"`
	} `json:"linearIssue,omitempty"` // Linked Linear issue (optional)
	LinkedWorkspaceIDs []string `json:"linkedWorkspaceIds,omitempty"` // Additional workspace IDs for context (optional)
}

func (h *Handlers) CreateConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	var req CreateConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Default to "task" type if not specified
	if req.Type == "" {
		req.Type = "task"
	}

	// Build instructions from attached summaries
	var instructions string
	if len(req.SummaryIDs) > 0 {
		var parts []string
		for _, sid := range req.SummaryIDs {
			summary, err := h.store.GetSummary(ctx, sid)
			if err != nil {
				if errors.Is(err, store.ErrNotFound) {
					writeValidationError(w, fmt.Sprintf("summary not found: %s", sid))
					return
				}
				writeInternalError(w, "failed to fetch summary", err)
				return
			}
			if summary.Status != models.SummaryStatusCompleted {
				continue
			}
			// Validate summary belongs to the same session
			if summary.SessionID != sessionID {
				writeValidationError(w, "summary does not belong to this session")
				return
			}
			// Look up conversation name for context
			convMeta, _ := h.store.GetConversationMeta(ctx, summary.ConversationID)
			convName := "Previous conversation"
			if convMeta != nil && convMeta.Name != "" {
				convName = convMeta.Name
			}
			parts = append(parts, fmt.Sprintf("### %s\n%s", convName, summary.Content))
		}
		if len(parts) > 0 {
			instructions = "## Context from Previous Conversations\n\n" + strings.Join(parts, "\n\n")
		}
	}

	// Build instructions from linked Linear issue
	if req.LinearIssue != nil {
		section := fmt.Sprintf("## Linked Linear Issue\n\n**%s: %s**\nStatus: %s",
			req.LinearIssue.Identifier, req.LinearIssue.Title, req.LinearIssue.StateName)
		if len(req.LinearIssue.Labels) > 0 {
			section += " | Labels: " + strings.Join(req.LinearIssue.Labels, ", ")
		}
		if req.LinearIssue.Description != "" {
			// Truncate very long descriptions to keep instructions manageable
			desc := req.LinearIssue.Description
			if len(desc) > 2000 {
				desc = desc[:2000] + "\n\n(description truncated)"
			}
			section += "\n\n" + desc
		}
		if instructions != "" {
			instructions += "\n\n"
		}
		instructions += section
	}

	// Build instructions from linked workspaces
	if len(req.LinkedWorkspaceIDs) > 0 {
		var wsParts []string
		for _, wsID := range req.LinkedWorkspaceIDs {
			repo, err := h.store.GetRepo(ctx, wsID)
			if err != nil || repo == nil {
				continue
			}
			wsParts = append(wsParts, fmt.Sprintf("- **%s** at %s (branch: %s)", repo.Name, repo.Path, repo.Branch))
		}
		if len(wsParts) > 0 {
			section := "## Linked Workspaces\n\nThe user has linked the following additional workspaces for reference:\n" +
				strings.Join(wsParts, "\n") +
				"\n\nThese workspaces provide additional context about related codebases. You can read files from these paths if needed."
			if instructions != "" {
				instructions += "\n\n"
			}
			instructions += section
		}
	}

	// Gracefully degrade features not supported by the current provider.
	// For Claude, all capabilities are true so these are no-ops today.
	// TODO: Replace DefaultProvider() with a session-aware lookup when multi-provider support lands.
	provider := agent.DefaultProvider()
	if req.PlanMode && !provider.SupportsPlanMode {
		req.PlanMode = false
	}
	if req.MaxThinkingTokens > 0 && !provider.SupportsThinking {
		req.MaxThinkingTokens = 0
	}
	if req.Effort != "" && !provider.SupportsEffort {
		req.Effort = ""
	}

	// Build options for starting the conversation
	var opts *agent.StartConversationOptions
	if req.MaxThinkingTokens > 0 || len(req.Attachments) > 0 || req.PlanMode || instructions != "" || req.Model != "" || req.Effort != "" {
		opts = &agent.StartConversationOptions{
			MaxThinkingTokens: req.MaxThinkingTokens,
			Effort:            req.Effort,
			Attachments:       req.Attachments,
			PlanMode:          req.PlanMode,
			Instructions:      instructions,
			Model:             req.Model,
		}
	}

	conv, err := h.agentManager.StartConversation(ctx, sessionID, req.Type, req.Message, opts)
	if err != nil {
		writeInternalError(w, "failed to start conversation", err)
		return
	}

	writeJSONStatus(w, http.StatusCreated, conv)
}

func (h *Handlers) GetConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}
	writeJSON(w, conv)
}

// GetStreamingSnapshot returns the current streaming snapshot for a conversation.
// Used by the frontend to restore its view after WebSocket reconnection.
func (h *Handlers) GetStreamingSnapshot(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	data, err := h.store.GetStreamingSnapshot(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if data == nil {
		writeJSON(w, nil)
		return
	}
	// data is already JSON — write it directly
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(data)
}

func (h *Handlers) GetConversationMessages(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")

	// Parse pagination params
	var beforePosition *int
	if beforeStr := r.URL.Query().Get("before"); beforeStr != "" {
		v, err := strconv.Atoi(beforeStr)
		if err != nil {
			writeValidationError(w, "invalid 'before' parameter")
			return
		}
		beforePosition = &v
	}

	limit := 50
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		v, err := strconv.Atoi(limitStr)
		if err != nil || v < 1 {
			writeValidationError(w, "invalid 'limit' parameter")
			return
		}
		if v > 200 {
			v = 200
		}
		limit = v
	}

	page, err := h.store.GetConversationMessages(ctx, convID, beforePosition, limit)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, page)
}

type SendConversationMessageRequest struct {
	Content     string              `json:"content"`
	Attachments []models.Attachment `json:"attachments"` // File attachments (optional)
	Model       string              `json:"model"`       // Model override for this message (optional)
	PlanMode    *bool               `json:"planMode"`    // Plan mode override for restart (optional)
}

func (h *Handlers) SendConversationMessage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	var req SendConversationMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Content == "" && len(req.Attachments) == 0 {
		writeValidationError(w, "content or attachments required")
		return
	}

	// Validate that image attachments have base64 data
	for _, att := range req.Attachments {
		if att.Type == "image" && att.Base64Data == "" {
			writeValidationError(w, fmt.Sprintf("image attachment %q is missing base64Data", att.Name))
			return
		}
	}

	// Switch model if specified
	if req.Model != "" {
		// Always persist model to DB first - this ensures auto-restart will use the correct model
		if err := h.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
			c.Model = req.Model
		}); err != nil {
			logger.Handlers.Warnf("Failed to persist model for conv %s: %v", convID, err)
		}
		// Also try to update running process if there is one
		if err := h.agentManager.SetConversationModel(convID, req.Model); err != nil {
			// Not an error - process may not be running yet, auto-restart will use DB value
			logger.Handlers.Debugf("Model change won't apply to running process for conv %s: %v", convID, err)
		}
	}

	if err := h.agentManager.SendConversationMessage(ctx, convID, req.Content, req.Attachments, req.PlanMode); err != nil {
		writeInternalError(w, "failed to send message", err)
		return
	}

	logger.Handlers.Infof("Accepted message for conv %s (content=%d chars, attachments=%d)", convID, len(req.Content), len(req.Attachments))
	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]string{"status": "sent"})
}

func (h *Handlers) StopConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	h.agentManager.StopConversation(ctx, convID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) GetConversationDropStats(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "convId")
	stats := h.agentManager.GetConversationDropStats(convID)
	if stats == nil {
		// No active process - return zero drops
		writeJSON(w, map[string]uint64{"droppedMessages": 0})
		return
	}
	writeJSON(w, stats)
}

func (h *Handlers) GetActiveStreamingConversations(w http.ResponseWriter, r *http.Request) {
	active := h.agentManager.GetActiveStreamingConversations()
	if active == nil {
		active = []string{}
	}
	writeJSON(w, map[string]interface{}{
		"conversationIds": active,
	})
}

// GetInterruptedConversations returns conversations that have a non-empty streaming
// snapshot but no running agent process (i.e., interrupted by app shutdown).
func (h *Handlers) GetInterruptedConversations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	interrupted, err := h.store.GetInterruptedConversations(ctx)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Filter out conversations that actually have a running process
	// (their snapshot hasn't been cleared yet but the agent is alive)
	active := h.agentManager.GetActiveStreamingConversations()
	activeSet := make(map[string]bool, len(active))
	for _, id := range active {
		activeSet[id] = true
	}

	type interruptedDTO struct {
		ID             string          `json:"id"`
		SessionID      string          `json:"sessionId"`
		AgentSessionID string          `json:"agentSessionId"`
		Snapshot       json.RawMessage `json:"snapshot"`
	}

	result := make([]interruptedDTO, 0)
	for _, ic := range interrupted {
		if activeSet[ic.ID] {
			continue // Agent is still running — not interrupted
		}
		result = append(result, interruptedDTO{
			ID:             ic.ID,
			SessionID:      ic.SessionID,
			AgentSessionID: ic.AgentSessionID,
			Snapshot:       json.RawMessage(ic.SnapshotJSON),
		})
	}
	writeJSON(w, result)
}

// ResumeAgent restarts a dead agent process for an interrupted conversation
// using the SDK resume mechanism.
func (h *Handlers) ResumeAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")

	if err := h.agentManager.ResumeConversation(ctx, convID); err != nil {
		writeInternalError(w, "failed to resume agent", err)
		return
	}
	writeJSON(w, map[string]string{"status": "resuming"})
}

// ClearStreamingSnapshot removes the streaming snapshot for a conversation.
// Used when the user dismisses an interrupted conversation banner.
func (h *Handlers) ClearStreamingSnapshot(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	if err := h.store.ClearStreamingSnapshot(ctx, convID); err != nil {
		writeInternalError(w, "failed to clear snapshot", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type RewindConversationRequest struct {
	CheckpointUuid string `json:"checkpointUuid"`
}

func (h *Handlers) RewindConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	var req RewindConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.CheckpointUuid == "" {
		writeValidationError(w, "checkpointUuid is required")
		return
	}

	if err := h.agentManager.RewindConversationFiles(convID, req.CheckpointUuid); err != nil {
		writeInternalError(w, "failed to rewind conversation", err)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]string{"status": "rewinding"})
}

// AnswerQuestionRequest represents user answers to AskUserQuestion tool
type AnswerQuestionRequest struct {
	RequestID string            `json:"requestId"`
	Answers   map[string]string `json:"answers"`
}

// AnswerConversationQuestion submits user answers to a pending AskUserQuestion
func (h *Handlers) AnswerConversationQuestion(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "convId")
	if convID == "" {
		writeValidationError(w, "conversation ID required")
		return
	}

	var req AnswerQuestionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.RequestID == "" {
		writeValidationError(w, "requestId is required")
		return
	}

	// Ensure answers map is initialized (defensive validation)
	if req.Answers == nil {
		req.Answers = make(map[string]string)
	}

	// Get the process for this conversation
	proc := h.agentManager.GetConversationProcess(convID)
	if proc == nil {
		writeNotFound(w, "no active process for conversation")
		return
	}

	// Send the answer to the agent process
	if err := proc.SendUserQuestionResponse(req.RequestID, req.Answers); err != nil {
		writeInternalError(w, "failed to send answer", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) DeleteConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	// Stop the conversation if running
	h.agentManager.StopConversation(ctx, convID)

	// Delete from store
	if err := h.store.DeleteConversation(ctx, convID); err != nil {
		writeDBError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type SetPlanModeRequest struct {
	Enabled bool `json:"enabled"`
}

func (h *Handlers) SetConversationPlanMode(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	var req SetPlanModeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if err := h.agentManager.SetConversationPlanMode(convID, req.Enabled); err != nil {
		writeInternalError(w, "failed to set plan mode", err)
		return
	}

	writeJSON(w, map[string]bool{"enabled": req.Enabled})
}

type SetMaxThinkingTokensRequest struct {
	MaxThinkingTokens int `json:"maxThinkingTokens"`
}

func (h *Handlers) SetConversationMaxThinkingTokens(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	var req SetMaxThinkingTokensRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.MaxThinkingTokens <= 0 {
		writeValidationError(w, "maxThinkingTokens must be positive")
		return
	}

	if err := h.agentManager.SetConversationMaxThinkingTokens(convID, req.MaxThinkingTokens); err != nil {
		writeInternalError(w, "failed to set max thinking tokens", err)
		return
	}

	writeJSON(w, map[string]int{"maxThinkingTokens": req.MaxThinkingTokens})
}

// PlanApprovalRequest represents user approval/rejection of an ExitPlanMode tool call
type PlanApprovalRequest struct {
	RequestID string `json:"requestId"`
	Approved  bool   `json:"approved"`
	Reason    string `json:"reason,omitempty"`
}

func (h *Handlers) ApprovePlan(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "convId")

	var req PlanApprovalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.RequestID == "" {
		writeValidationError(w, "requestId is required")
		return
	}

	// Get the process for this conversation
	proc := h.agentManager.GetConversationProcess(convID)
	if proc == nil {
		writeNotFound(w, "no active process for conversation")
		return
	}

	// Send the approval/rejection to the agent process
	if err := proc.SendPlanApprovalResponse(req.RequestID, req.Approved, req.Reason); err != nil {
		writeInternalError(w, "failed to send plan approval", err)
		return
	}

	writeJSON(w, map[string]bool{"approved": req.Approved})
}

// Summary handlers

func (h *Handlers) GenerateConversationSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	conv, err := h.store.GetConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	// Check AI client is available
	if h.aiClient == nil {
		writeServiceUnavailable(w, "AI features not configured (missing ANTHROPIC_API_KEY)")
		return
	}

	// Validate conversation has enough messages
	if conv.MessageCount < 2 {
		writeValidationError(w, "conversation needs at least 2 messages to summarize")
		return
	}

	// Check for existing summary
	existing, err := h.store.GetSummaryByConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if existing != nil {
		if existing.Status == models.SummaryStatusGenerating {
			writeConflict(w, "summary is already being generated")
			return
		}
		if existing.Status == models.SummaryStatusCompleted {
			// Return existing summary
			writeJSON(w, existing)
			return
		}
		// Failed summary - allow regeneration by deleting old one
		if existing.Status == models.SummaryStatusFailed {
			if err := h.store.DeleteSummary(ctx, existing.ID); err != nil {
				writeDBError(w, err)
				return
			}
		}
	}

	// Create summary record
	summary := &models.Summary{
		ID:             uuid.New().String(),
		ConversationID: convID,
		SessionID:      conv.SessionID,
		Status:         models.SummaryStatusGenerating,
		MessageCount:   conv.MessageCount,
		CreatedAt:      time.Now(),
	}
	if err := h.store.AddSummary(ctx, summary); err != nil {
		writeDBError(w, err)
		return
	}

	// Fetch all messages via paginated API
	allMessages, err := h.store.GetConversationMessages(ctx, convID, nil, conv.MessageCount)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Build messages for the AI
	var summaryMessages []ai.SummaryMessage
	for _, m := range allMessages.Messages {
		if m.Role == "system" && m.SetupInfo != nil {
			continue // Skip setup messages
		}
		content := m.Content
		// Strip RunSummary from content (it's metadata, not conversation)
		if m.RunSummary != nil && content == "" {
			continue
		}
		if content == "" {
			continue
		}
		summaryMessages = append(summaryMessages, ai.SummaryMessage{
			Role:    m.Role,
			Content: content,
		})
	}

	// Generate asynchronously
	go func() {
		bgCtx := context.Background()
		result, err := h.aiClient.GenerateConversationSummary(bgCtx, ai.GenerateSummaryRequest{
			ConversationName: conv.Name,
			Messages:         summaryMessages,
		})

		if err != nil {
			logger.Error.Errorf("Summary generation failed for %s: %v", convID, err)
			if dbErr := h.store.UpdateSummary(bgCtx, summary.ID, models.SummaryStatusFailed, "", err.Error()); dbErr != nil {
				logger.Error.Errorf("Failed to update summary %s to failed status: %v", summary.ID, dbErr)
			}
			h.hub.Broadcast(Event{
				Type:           "summary_updated",
				ConversationID: convID,
				Payload:        map[string]interface{}{"id": summary.ID, "status": models.SummaryStatusFailed, "errorMessage": err.Error()},
			})
			return
		}

		if dbErr := h.store.UpdateSummary(bgCtx, summary.ID, models.SummaryStatusCompleted, result, ""); dbErr != nil {
			logger.Error.Errorf("Failed to update summary %s to completed status: %v", summary.ID, dbErr)
			return
		}
		// Broadcast completion
		updatedSummary, _ := h.store.GetSummary(bgCtx, summary.ID)
		if updatedSummary != nil {
			h.hub.Broadcast(Event{
				Type:           "summary_updated",
				ConversationID: convID,
				Payload:        updatedSummary,
			})
		}
	}()

	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, summary)
}

// ---------- Regenerate / Edit + Regenerate ----------

type RegenerateMessageRequest struct {
	MessageID string `json:"messageId"` // The message to regenerate from
	Content   string `json:"content"`   // If provided: edit the user message then regenerate
}

// RegenerateMessage truncates the conversation after a message and re-sends it to the agent.
// If content is provided, the target user message is updated first (edit + regenerate).
// If content is empty, the last user message before the target is re-sent (pure regenerate).
func (h *Handlers) RegenerateMessage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")

	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	var req RegenerateMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.MessageID == "" {
		writeValidationError(w, "messageId is required")
		return
	}

	// Find the target message and verify it belongs to this conversation
	msg, msgConvID, position, err := h.store.GetMessageByID(ctx, req.MessageID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if msg == nil {
		writeNotFound(w, "message")
		return
	}
	if msgConvID != convID {
		writeValidationError(w, "message does not belong to this conversation")
		return
	}

	// Determine the user message to re-send and the truncation point.
	// If editing a user message: update its content, truncate everything after it, re-send.
	// If regenerating an assistant message: truncate from the assistant message onward,
	// find the preceding user message and re-send it.
	var userMessageContent string
	var truncateAfterPosition int
	var keepMessageID string // ID of the last message to keep (for frontend truncation)

	if msg.Role == "user" {
		// Edit + regenerate: update the user message content, truncate after it
		if req.Content != "" {
			if err := h.store.UpdateMessageContent(ctx, req.MessageID, req.Content); err != nil {
				writeDBError(w, err)
				return
			}
			userMessageContent = req.Content
		} else {
			userMessageContent = msg.Content
		}
		truncateAfterPosition = position
		keepMessageID = req.MessageID
	} else if msg.Role == "assistant" {
		// Pure regenerate of assistant: truncate from this message onward (position - 1),
		// then re-send the preceding user message
		truncateAfterPosition = position - 1

		// Find the preceding user message using a targeted query (no page size limit)
		content, found, err := h.store.GetLastUserMessageContentBefore(ctx, convID, position)
		if err != nil {
			writeDBError(w, err)
			return
		}
		if !found {
			writeValidationError(w, "no user message found before this assistant message")
			return
		}
		userMessageContent = content

		// Find the ID of the last message to keep (at truncateAfterPosition)
		keepID, err := h.store.GetMessageIDAtPosition(ctx, convID, truncateAfterPosition)
		if err != nil {
			logger.Handlers.Warnf("Failed to get keepMessageID for conv %s pos %d: %v", convID, truncateAfterPosition, err)
		}
		keepMessageID = keepID
	} else {
		writeValidationError(w, "can only regenerate user or assistant messages")
		return
	}

	// Stop the agent if it's currently running and wait for it to fully exit,
	// so no in-flight writes race with the truncation below.
	h.agentManager.StopAndWaitConversation(ctx, convID, 5*time.Second)

	// Delete all messages after the truncation point
	if err := h.store.DeleteMessagesAfterPosition(ctx, convID, truncateAfterPosition); err != nil {
		writeInternalError(w, "failed to truncate messages", err)
		return
	}

	// Clear the agent session ID to force a full restart (history changed)
	if err := h.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
		c.AgentSessionID = ""
	}); err != nil {
		logger.Handlers.Warnf("Failed to clear agent session for conv %s: %v", convID, err)
	}

	// Clear streaming snapshot since conversation state changed
	if err := h.store.ClearStreamingSnapshot(ctx, convID); err != nil {
		logger.Handlers.Warnf("Failed to clear streaming snapshot for conv %s: %v", convID, err)
	}

	// Broadcast truncation event so frontend removes messages from UI
	h.hub.Broadcast(Event{
		Type:           "conversation_truncated",
		ConversationID: convID,
		Payload: map[string]interface{}{
			"fromPosition":  truncateAfterPosition + 1,
			"keepMessageId": keepMessageID,
		},
	})

	// Re-send the user message to the agent
	if err := h.agentManager.SendConversationMessage(ctx, convID, userMessageContent, nil, nil); err != nil {
		writeInternalError(w, "failed to resend message", err)
		return
	}

	logger.Handlers.Infof("Regenerated conv %s from position %d", convID, truncateAfterPosition)
	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]interface{}{
		"status":           "regenerating",
		"truncatedFromPos": truncateAfterPosition + 1,
	})
}

// ---------- Conversation Forking ----------

type ForkConversationRequest struct {
	MessageID string `json:"messageId"` // Fork from this message (inclusive)
}

// ForkConversation creates a new conversation that copies messages up to a given point.
// The new conversation is idle — the user sends the first message to start the agent.
func (h *Handlers) ForkConversation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")

	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	var req ForkConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.MessageID == "" {
		writeValidationError(w, "messageId is required")
		return
	}

	// Find the message and its position
	msg, msgConvID, position, err := h.store.GetMessageByID(ctx, req.MessageID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if msg == nil {
		writeNotFound(w, "message")
		return
	}
	if msgConvID != convID {
		writeValidationError(w, "message does not belong to this conversation")
		return
	}

	// Create the new conversation
	now := time.Now()
	newConvID := uuid.New().String()[:8]
	forkName := conv.Name
	if !strings.HasSuffix(forkName, " (fork)") {
		forkName = forkName + " (fork)"
	}

	newConv := &models.Conversation{
		ID:        newConvID,
		SessionID: conv.SessionID,
		Type:      "task",
		Name:      forkName,
		Status:    "idle",
		Model:     conv.Model,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := h.store.AddConversation(ctx, newConv); err != nil {
		writeInternalError(w, "failed to create forked conversation", err)
		return
	}

	// Copy messages up to (and including) the fork point
	if err := h.store.CopyMessagesUpToPosition(ctx, convID, newConvID, position); err != nil {
		// Clean up the conversation on failure
		h.store.DeleteConversation(ctx, newConvID)
		writeInternalError(w, "failed to copy messages", err)
		return
	}

	// Return the new conversation
	result, err := h.store.GetConversation(ctx, newConvID)
	if err != nil {
		writeDBError(w, err)
		return
	}

	logger.Handlers.Infof("Forked conv %s to %s at position %d", convID, newConvID, position)
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, result)
}

func (h *Handlers) GetConversationSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")
	summary, err := h.store.GetSummaryByConversation(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if summary == nil {
		writeNotFound(w, "summary")
		return
	}
	writeJSON(w, summary)
}

// AddSystemMessage persists a lightweight system message (e.g. "context compacted")
// without triggering the agent.
type AddSystemMessageRequest struct {
	Content string `json:"content"`
}

func (h *Handlers) AddSystemMessage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	convID := chi.URLParam(r, "convId")

	conv, err := h.store.GetConversationMeta(ctx, convID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if conv == nil {
		writeNotFound(w, "conversation")
		return
	}

	var req AddSystemMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.Content == "" {
		writeValidationError(w, "content is required")
		return
	}

	msg := models.Message{
		ID:        uuid.New().String(),
		Role:      "system",
		Content:   req.Content,
		Timestamp: time.Now().UTC(),
	}
	if err := h.store.AddMessageToConversation(ctx, convID, msg); err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, map[string]string{"id": msg.ID})
}

func (h *Handlers) ListSessionSummaries(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	summaries, err := h.store.ListSummariesBySession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if summaries == nil {
		summaries = []*models.Summary{}
	}
	writeJSON(w, summaries)
}
