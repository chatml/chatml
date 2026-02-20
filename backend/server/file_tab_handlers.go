package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
)

// Attachment handlers

func (h *Handlers) GetAttachmentData(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	attachmentID := chi.URLParam(r, "attachmentId")
	data, err := h.store.GetAttachmentData(ctx, attachmentID)
	if err != nil {
		if errors.Is(err, store.ErrAttachmentNotFound) {
			writeNotFound(w, "attachment")
			return
		}
		writeDBError(w, err)
		return
	}
	writeJSON(w, map[string]string{"base64Data": data})
}

// File tab handlers

func (h *Handlers) ListFileTabs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")
	tabs, err := h.store.ListFileTabs(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	writeJSON(w, tabs)
}

type SaveFileTabsRequest struct {
	Tabs []FileTabRequest `json:"tabs"`
}

type FileTabRequest struct {
	ID             string `json:"id"`
	WorkspaceID    string `json:"workspaceId"`
	SessionID      string `json:"sessionId,omitempty"`
	Path           string `json:"path"`
	ViewMode       string `json:"viewMode"`
	IsPinned       bool   `json:"isPinned"`
	Position       int    `json:"position"`
	OpenedAt       string `json:"openedAt"`
	LastAccessedAt string `json:"lastAccessedAt"`
}

func (h *Handlers) SaveFileTabs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")
	repo, err := h.store.GetRepo(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	var req SaveFileTabsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Convert request to models
	tabs := make([]*models.FileTab, len(req.Tabs))
	for i, t := range req.Tabs {
		openedAt, err := time.Parse(time.RFC3339, t.OpenedAt)
		if err != nil {
			openedAt = time.Now()
		}
		lastAccessedAt, err := time.Parse(time.RFC3339, t.LastAccessedAt)
		if err != nil {
			lastAccessedAt = time.Now()
		}

		tabs[i] = &models.FileTab{
			ID:             t.ID,
			WorkspaceID:    workspaceID,
			SessionID:      t.SessionID,
			Path:           t.Path,
			ViewMode:       t.ViewMode,
			IsPinned:       t.IsPinned,
			Position:       i,
			OpenedAt:       openedAt,
			LastAccessedAt: lastAccessedAt,
		}
	}

	if err := h.store.SaveFileTabs(ctx, workspaceID, tabs); err != nil {
		writeDBError(w, err)
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

func (h *Handlers) DeleteFileTab(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tabID := chi.URLParam(r, "tabId")
	if err := h.store.DeleteFileTab(ctx, tabID); err != nil {
		writeDBError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
