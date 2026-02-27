package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Review comment handlers

type CreateReviewCommentRequest struct {
	FilePath   string `json:"filePath"`
	LineNumber int    `json:"lineNumber"`
	Title      string `json:"title,omitempty"`
	Content    string `json:"content"`
	Source     string `json:"source"`             // "claude" or "user"
	Author     string `json:"author"`             // Display name
	Severity   string `json:"severity,omitempty"` // "error", "warning", "suggestion", "info"
}

func (h *Handlers) ListReviewComments(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Verify session exists
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Check if filtering by file path
	filePath := r.URL.Query().Get("filePath")
	var comments []*models.ReviewComment

	if filePath != "" {
		comments, err = h.store.ListReviewCommentsForFile(ctx, sessionID, filePath)
	} else {
		comments, err = h.store.ListReviewComments(ctx, sessionID)
	}

	if err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, comments)
}

func (h *Handlers) CreateReviewComment(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Verify session exists
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	var req CreateReviewCommentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Validate required fields
	if req.FilePath == "" {
		writeValidationError(w, "filePath is required")
		return
	}
	if req.LineNumber < 1 {
		writeValidationError(w, "lineNumber must be at least 1")
		return
	}
	if req.Content == "" {
		writeValidationError(w, "content is required")
		return
	}
	// Limit content size to prevent abuse (10KB max)
	if len(req.Content) > 10*1024 {
		writeValidationError(w, "content exceeds maximum length of 10KB")
		return
	}
	if req.Source != models.CommentSourceClaude && req.Source != models.CommentSourceUser {
		writeValidationError(w, "source must be 'claude' or 'user'")
		return
	}
	if req.Author == "" {
		writeValidationError(w, "author is required")
		return
	}

	// Validate severity if provided
	if req.Severity != "" && req.Severity != models.CommentSeverityError &&
		req.Severity != models.CommentSeverityWarning && req.Severity != models.CommentSeveritySuggestion &&
		req.Severity != models.CommentSeverityInfo {
		writeValidationError(w, "severity must be 'error', 'warning', 'suggestion', or 'info'")
		return
	}

	comment := &models.ReviewComment{
		ID:         uuid.New().String(),
		SessionID:  sessionID,
		FilePath:   req.FilePath,
		LineNumber: req.LineNumber,
		Title:      req.Title,
		Content:    req.Content,
		Source:     req.Source,
		Author:     req.Author,
		Severity:   req.Severity,
		CreatedAt:  time.Now(),
		Resolved:   false,
	}

	if err := h.store.AddReviewComment(ctx, comment); err != nil {
		writeDBError(w, err)
		return
	}

	// Broadcast WebSocket event for real-time updates
	if h.hub != nil {
		h.hub.Broadcast(Event{
			Type:      "comment_added",
			SessionID: sessionID,
			Payload:   comment,
		})
	}

	w.WriteHeader(http.StatusCreated)
	writeJSON(w, comment)
}

func (h *Handlers) GetReviewCommentStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Verify session exists
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	stats, err := h.store.GetReviewCommentStats(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, stats)
}

type UpdateReviewCommentRequest struct {
	Title          *string `json:"title,omitempty"`
	Content        *string `json:"content,omitempty"`
	Severity       *string `json:"severity,omitempty"`
	Resolved       *bool   `json:"resolved,omitempty"`
	ResolvedBy     *string `json:"resolvedBy,omitempty"`
	ResolutionType *string `json:"resolutionType,omitempty"`
}

func (h *Handlers) UpdateReviewComment(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	commentID := chi.URLParam(r, "commentId")

	// Verify session exists
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Get existing comment
	comment, err := h.store.GetReviewComment(ctx, commentID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if comment == nil || comment.SessionID != sessionID {
		writeNotFound(w, "comment")
		return
	}

	var req UpdateReviewCommentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Validate severity if provided
	if req.Severity != nil && *req.Severity != "" &&
		*req.Severity != models.CommentSeverityError &&
		*req.Severity != models.CommentSeverityWarning &&
		*req.Severity != models.CommentSeveritySuggestion &&
		*req.Severity != models.CommentSeverityInfo {
		writeValidationError(w, "severity must be 'error', 'warning', 'suggestion', or 'info'")
		return
	}

	// Validate resolution type if provided
	if req.ResolutionType != nil && *req.ResolutionType != "" &&
		*req.ResolutionType != models.CommentResolutionFixed &&
		*req.ResolutionType != models.CommentResolutionIgnored {
		writeValidationError(w, "resolutionType must be 'fixed' or 'ignored'")
		return
	}

	if err := h.store.UpdateReviewComment(ctx, commentID, func(c *models.ReviewComment) {
		if req.Title != nil {
			c.Title = *req.Title
		}
		if req.Content != nil {
			c.Content = *req.Content
		}
		if req.Severity != nil {
			c.Severity = *req.Severity
		}
		if req.Resolved != nil {
			c.Resolved = *req.Resolved
			if *req.Resolved {
				now := time.Now()
				c.ResolvedAt = &now
				if req.ResolvedBy != nil {
					c.ResolvedBy = *req.ResolvedBy
				}
				// Only apply resolutionType when resolving
				if req.ResolutionType != nil {
					c.ResolutionType = *req.ResolutionType
				}
			} else {
				c.ResolvedAt = nil
				c.ResolvedBy = ""
				c.ResolutionType = ""
			}
		}
	}); err != nil {
		writeDBError(w, err)
		return
	}

	// Get updated comment
	comment, err = h.store.GetReviewComment(ctx, commentID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if comment == nil {
		writeNotFound(w, "review comment")
		return
	}

	// Broadcast WebSocket event for real-time updates
	if h.hub != nil {
		eventType := "comment_updated"
		if comment.Resolved {
			eventType = "comment_resolved"
		}
		h.hub.Broadcast(Event{
			Type:      eventType,
			SessionID: sessionID,
			Payload:   comment,
		})
	}

	writeJSON(w, comment)
}

func (h *Handlers) DeleteReviewComment(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")
	commentID := chi.URLParam(r, "commentId")

	// Verify session exists
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Verify comment exists and belongs to session
	comment, err := h.store.GetReviewComment(ctx, commentID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if comment == nil || comment.SessionID != sessionID {
		writeNotFound(w, "comment")
		return
	}

	if err := h.store.DeleteReviewComment(ctx, commentID); err != nil {
		writeDBError(w, err)
		return
	}

	// Broadcast WebSocket event for real-time updates
	if h.hub != nil {
		h.hub.Broadcast(Event{
			Type:      "comment_deleted",
			SessionID: sessionID,
			Payload: map[string]string{
				"id":        commentID,
				"sessionId": sessionID,
			},
		})
	}

	w.WriteHeader(http.StatusNoContent)
}
