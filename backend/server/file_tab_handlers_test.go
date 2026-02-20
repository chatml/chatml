package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetAttachmentData_Success(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Create fixture chain: repo → session → conversation → message → attachment
	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	msg := models.Message{
		ID:        "m1",
		Role:      "user",
		Content:   "See image",
		Timestamp: time.Now(),
	}
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	att := models.Attachment{
		ID:         "att-1",
		Type:       "image",
		Name:       "test.png",
		MimeType:   "image/png",
		Size:       512,
		Base64Data: "dGVzdGRhdGE=",
	}
	require.NoError(t, s.SaveAttachments(ctx, "m1", []models.Attachment{att}))

	// Call handler
	req := httptest.NewRequest(http.MethodGet, "/api/attachments/att-1/data", nil)
	req = withChiContext(req, map[string]string{"attachmentId": "att-1"})
	w := httptest.NewRecorder()

	h.GetAttachmentData(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
	assert.Equal(t, "dGVzdGRhdGE=", response["base64Data"])
}

func TestGetAttachmentData_NotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest(http.MethodGet, "/api/attachments/nonexistent/data", nil)
	req = withChiContext(req, map[string]string{"attachmentId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetAttachmentData(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}
