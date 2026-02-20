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
