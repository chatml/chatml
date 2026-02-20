package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/ai"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListConversations_Empty(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/sess-1/conversations", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.ListConversations(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var convs []*models.Conversation
	err := json.Unmarshal(w.Body.Bytes(), &convs)
	require.NoError(t, err)
	assert.Empty(t, convs)
}

func TestListConversations_WithConversations(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")
	createTestConversation(t, s, "conv-2", "sess-1")

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/sess-1/conversations", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.ListConversations(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var convs []*models.Conversation
	err := json.Unmarshal(w.Body.Bytes(), &convs)
	require.NoError(t, err)
	assert.Len(t, convs, 2)
}

func TestGetConversation_Exists(t *testing.T) {
	h, s := setupTestHandlers(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	conv := createTestConversation(t, s, "conv-1", "sess-1")

	req := httptest.NewRequest("GET", "/api/conversations/conv-1", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.GetConversation(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var gotConv models.Conversation
	err := json.Unmarshal(w.Body.Bytes(), &gotConv)
	require.NoError(t, err)
	assert.Equal(t, conv.ID, gotConv.ID)
}

func TestGetConversation_NotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/conversations/nonexistent", nil)
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetConversation(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestDeleteConversation_Success(t *testing.T) {
	h, s, _ := setupTestHandlersWithAgentManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Verify conversation exists before delete
	conv, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	assert.NotNil(t, conv)

	req := httptest.NewRequest("DELETE", "/api/conversations/conv-1", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.DeleteConversation(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)

	// Verify conversation was deleted
	conv, err = s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	assert.Nil(t, conv)
}

func TestDeleteConversation_NotFound(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	req := httptest.NewRequest("DELETE", "/api/conversations/nonexistent", nil)
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.DeleteConversation(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestSetConversationPlanMode_NotFound(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	body := strings.NewReader(`{"enabled": true}`)
	req := httptest.NewRequest("POST", "/api/conversations/nonexistent/plan-mode", body)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.SetConversationPlanMode(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.Contains(t, w.Body.String(), "conversation not found")
}

func TestSetConversationPlanMode_InvalidRequest(t *testing.T) {
	h, s, _ := setupTestHandlersWithAgentManager(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Send invalid JSON
	body := strings.NewReader(`{invalid json}`)
	req := httptest.NewRequest("POST", "/api/conversations/conv-1/plan-mode", body)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.SetConversationPlanMode(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSetConversationPlanMode_ProcessNotRunning(t *testing.T) {
	h, s, _ := setupTestHandlersWithAgentManager(t)

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Conversation exists but no process is running — should succeed gracefully
	body := strings.NewReader(`{"enabled": true}`)
	req := httptest.NewRequest("POST", "/api/conversations/conv-1/plan-mode", body)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.SetConversationPlanMode(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify success response
	var resp map[string]bool
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.True(t, resp["enabled"])
}
func TestSendConversationMessage_NotFound(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	body := `{"content": "hello"}`
	req := httptest.NewRequest(http.MethodPost, "/api/conversations/nonexistent/messages", strings.NewReader(body))
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.SendConversationMessage(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestRewindConversation_NotFound(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	body := `{"checkpointUuid": "abc123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/conversations/nonexistent/rewind", strings.NewReader(body))
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.RewindConversation(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestStopConversation_ExistingConversation(t *testing.T) {
	h, s, _ := setupTestHandlersWithAgentManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Add a message so the conversation is non-trivial
	msg := models.Message{ID: "m1", Role: "user", Content: "Hello", Timestamp: time.Now()}
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", msg))

	req := httptest.NewRequest(http.MethodPost, "/api/conversations/conv-1/stop", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.StopConversation(w, req)

	// Should succeed (no running process, but that's OK — StopConversation is idempotent)
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestDeleteConversation_ExistingConversation(t *testing.T) {
	h, s, _ := setupTestHandlersWithAgentManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "ws-1", "/path/to/repo")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	req := httptest.NewRequest(http.MethodDelete, "/api/conversations/conv-1", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.DeleteConversation(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)

	// Verify conversation is deleted
	conv, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	assert.Nil(t, conv)
}
func TestCreateConversation_InvalidJSON(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "ws-1", repoPath)
	createTestSession(t, s, "sess-1", "ws-1")

	req := httptest.NewRequest("POST", "/api/repos/ws-1/sessions/sess-1/conversations", strings.NewReader(`{bad json`))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"workspaceId": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.CreateConversation(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateConversation_SessionNotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body := strings.NewReader(`{"type": "task", "message": "hello"}`)
	req := httptest.NewRequest("POST", "/api/repos/ws-1/sessions/nonexistent/conversations", body)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"workspaceId": "ws-1", "sessionId": "nonexistent"})
	w := httptest.NewRecorder()

	h.CreateConversation(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestCreateConversation_RequestParsing_WithPlanMode(t *testing.T) {
	// Verify that CreateConversationRequest correctly deserializes planMode
	tests := []struct {
		name     string
		body     string
		expected bool
	}{
		{
			name:     "planMode true",
			body:     `{"type": "task", "message": "hello", "planMode": true}`,
			expected: true,
		},
		{
			name:     "planMode false",
			body:     `{"type": "task", "message": "hello", "planMode": false}`,
			expected: false,
		},
		{
			name:     "planMode omitted defaults to false",
			body:     `{"type": "task", "message": "hello"}`,
			expected: false,
		},
		{
			name:     "planMode with thinking tokens",
			body:     `{"type": "task", "message": "hello", "planMode": true, "maxThinkingTokens": 5000}`,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var req CreateConversationRequest
			err := json.Unmarshal([]byte(tt.body), &req)
			require.NoError(t, err)
			assert.Equal(t, tt.expected, req.PlanMode)
		})
	}
}
func TestCreateConversation_RequestParsing_WithModel(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		expected string
	}{
		{
			name:     "model specified",
			body:     `{"type": "task", "message": "hello", "model": "claude-sonnet-4-6"}`,
			expected: "claude-sonnet-4-6",
		},
		{
			name:     "model omitted defaults to empty",
			body:     `{"type": "task", "message": "hello"}`,
			expected: "",
		},
		{
			name:     "model with plan mode and thinking",
			body:     `{"type": "task", "message": "hello", "model": "claude-haiku-4-5-20251001", "planMode": true, "maxThinkingTokens": 5000}`,
			expected: "claude-haiku-4-5-20251001",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var req CreateConversationRequest
			err := json.Unmarshal([]byte(tt.body), &req)
			require.NoError(t, err)
			assert.Equal(t, tt.expected, req.Model)
		})
	}
}

func TestSendConversationMessage_RequestParsing_WithModel(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		expected string
	}{
		{
			name:     "model specified",
			body:     `{"content": "hello", "model": "claude-opus-4-5-20251101"}`,
			expected: "claude-opus-4-5-20251101",
		},
		{
			name:     "model omitted defaults to empty",
			body:     `{"content": "hello"}`,
			expected: "",
		},
		{
			name:     "model with attachments",
			body:     `{"content": "check this", "model": "claude-sonnet-4-6", "attachments": []}`,
			expected: "claude-sonnet-4-6",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var req SendConversationMessageRequest
			err := json.Unmarshal([]byte(tt.body), &req)
			require.NoError(t, err)
			assert.Equal(t, tt.expected, req.Model)
		})
	}
}
func TestGetConversation_IncludesModel(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "ws-1", repoPath)
	createTestSession(t, s, "sess-1", "ws-1")

	// Create conversation with model set
	ctx := context.Background()
	conv := &models.Conversation{
		ID:        "conv-1",
		SessionID: "sess-1",
		Type:      "task",
		Name:      "Model Test",
		Status:    "active",
		Model:     "claude-haiku-4-5-20251001",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	require.NoError(t, s.AddConversation(ctx, conv))

	req := httptest.NewRequest("GET", "/api/conversations/conv-1", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.GetConversation(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var gotConv models.Conversation
	err := json.Unmarshal(w.Body.Bytes(), &gotConv)
	require.NoError(t, err)
	assert.Equal(t, "claude-haiku-4-5-20251001", gotConv.Model)
}

func TestListConversations_IncludesModel(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "ws-1", repoPath)
	createTestSession(t, s, "sess-1", "ws-1")

	ctx := context.Background()
	for _, tc := range []struct{ id, model string }{
		{"c1", "claude-opus-4-5-20251101"},
		{"c2", "claude-sonnet-4-6"},
	} {
		conv := &models.Conversation{
			ID: tc.id, SessionID: "sess-1", Type: "task",
			Name: "Conv " + tc.id, Status: "active", Model: tc.model,
			CreatedAt: time.Now(), UpdatedAt: time.Now(),
		}
		require.NoError(t, s.AddConversation(ctx, conv))
	}

	req := httptest.NewRequest("GET", "/api/repos/ws-1/sessions/sess-1/conversations", nil)
	req = withChiContext(req, map[string]string{"workspaceId": "ws-1", "sessionId": "sess-1"})
	w := httptest.NewRecorder()

	h.ListConversations(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var convs []models.Conversation
	err := json.Unmarshal(w.Body.Bytes(), &convs)
	require.NoError(t, err)
	require.Len(t, convs, 2)

	modelsByID := map[string]string{}
	for _, c := range convs {
		modelsByID[c.ID] = c.Model
	}
	assert.Equal(t, "claude-opus-4-5-20251101", modelsByID["c1"])
	assert.Equal(t, "claude-sonnet-4-6", modelsByID["c2"])
}
func TestApprovePlan_MissingRequestId(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	body := strings.NewReader(`{"approved": true}`)
	req := httptest.NewRequest("POST", "/api/conversations/conv-1/approve-plan", body)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.ApprovePlan(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "requestId is required")
}

func TestApprovePlan_NoProcess(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	body := strings.NewReader(`{"requestId": "plan-1", "approved": true}`)
	req := httptest.NewRequest("POST", "/api/conversations/conv-1/approve-plan", body)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.ApprovePlan(w, req)

	// Should fail because no process is running
	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.Contains(t, w.Body.String(), "no active process")
}

func TestApprovePlan_InvalidBody(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	body := strings.NewReader(`not valid json`)
	req := httptest.NewRequest("POST", "/api/conversations/conv-1/approve-plan", body)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.ApprovePlan(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "invalid request body")
}

func TestApprovePlan_EmptyBody(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	body := strings.NewReader(`{}`)
	req := httptest.NewRequest("POST", "/api/conversations/conv-1/approve-plan", body)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.ApprovePlan(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "requestId is required")
}

func TestApprovePlan_RejectionNoProcess(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	body := strings.NewReader(`{"requestId": "plan-1", "approved": false}`)
	req := httptest.NewRequest("POST", "/api/conversations/conv-1/approve-plan", body)
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.ApprovePlan(w, req)

	// Should fail because no process is running (same as approval)
	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.Contains(t, w.Body.String(), "no active process")
}
func TestGetConversationDropStats_NoActiveProcess(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	req := httptest.NewRequest("GET", "/api/conversations/conv-nonexistent/drop-stats", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-nonexistent"})
	w := httptest.NewRecorder()

	h.GetConversationDropStats(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var stats map[string]uint64
	err := json.Unmarshal(w.Body.Bytes(), &stats)
	require.NoError(t, err)
	assert.Equal(t, uint64(0), stats["droppedMessages"])
}

func TestGetConversationDropStats_WithActiveProcess(t *testing.T) {
	h, _, agentMgr := setupTestHandlersWithAgentManager(t)

	// Manually insert a process with some drops
	proc := agent.NewProcess("drop-proc", t.TempDir(), "conv-stats")
	agentMgr.InsertProcessForTest("conv-stats", proc)

	req := httptest.NewRequest("GET", "/api/conversations/conv-stats/drop-stats", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-stats"})
	w := httptest.NewRecorder()

	h.GetConversationDropStats(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var stats map[string]uint64
	err := json.Unmarshal(w.Body.Bytes(), &stats)
	require.NoError(t, err)
	assert.Equal(t, uint64(0), stats["droppedMessages"])
}

func TestGetConversationDropStats_ReflectsDropCount(t *testing.T) {
	h, _, agentMgr := setupTestHandlersWithAgentManager(t)

	// Create process and simulate drops
	proc := agent.NewProcess("drop-proc", t.TempDir(), "conv-stats")
	proc.SimulateDrops(17)
	agentMgr.InsertProcessForTest("conv-stats", proc)

	req := httptest.NewRequest("GET", "/api/conversations/conv-stats/drop-stats", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-stats"})
	w := httptest.NewRecorder()

	h.GetConversationDropStats(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var stats map[string]uint64
	err := json.Unmarshal(w.Body.Bytes(), &stats)
	require.NoError(t, err)
	assert.Equal(t, uint64(17), stats["droppedMessages"])
}

func TestGetConversationDropStats_ResponseFormat(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	req := httptest.NewRequest("GET", "/api/conversations/conv-format/drop-stats", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-format"})
	w := httptest.NewRecorder()

	h.GetConversationDropStats(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Header().Get("Content-Type"), "application/json")

	// Verify response is valid JSON with expected key
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	_, hasDropped := result["droppedMessages"]
	assert.True(t, hasDropped, "Response should contain droppedMessages key")
}
func TestGetConversationSummary_Found(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	repo := createTestRepo(t, s, "r1", "/fake/path")
	sess := createTestSession(t, s, "s1", repo.ID)
	conv := createTestConversation(t, s, "c1", sess.ID)

	err := s.AddSummary(ctx, &models.Summary{
		ID:             "sum1",
		ConversationID: conv.ID,
		SessionID:      sess.ID,
		Content:        "This conversation was about testing.",
		Status:         models.SummaryStatusCompleted,
		MessageCount:   5,
		CreatedAt:      time.Now(),
	})
	require.NoError(t, err)

	req := httptest.NewRequest("GET", "/api/conversations/c1/summary", nil)
	req = withChiContext(req, map[string]string{"convId": conv.ID})
	w := httptest.NewRecorder()

	h.GetConversationSummary(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var summary models.Summary
	err = json.Unmarshal(w.Body.Bytes(), &summary)
	require.NoError(t, err)
	assert.Equal(t, "sum1", summary.ID)
	assert.Equal(t, conv.ID, summary.ConversationID)
	assert.Equal(t, "This conversation was about testing.", summary.Content)
	assert.Equal(t, models.SummaryStatusCompleted, summary.Status)
	assert.Equal(t, 5, summary.MessageCount)
}

func TestGetConversationSummary_NotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/conversations/nonexistent/summary", nil)
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetConversationSummary(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)

	var apiErr APIError
	err := json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeNotFound, apiErr.Code)
}

func TestListSessionSummaries_ReturnsSummaries(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	repo := createTestRepo(t, s, "r1", "/fake/path")
	sess := createTestSession(t, s, "s1", repo.ID)
	conv1 := createTestConversation(t, s, "c1", sess.ID)
	conv2 := createTestConversation(t, s, "c2", sess.ID)

	err := s.AddSummary(ctx, &models.Summary{
		ID:             "sum1",
		ConversationID: conv1.ID,
		SessionID:      sess.ID,
		Content:        "Summary one",
		Status:         models.SummaryStatusCompleted,
		MessageCount:   3,
		CreatedAt:      time.Now(),
	})
	require.NoError(t, err)

	err = s.AddSummary(ctx, &models.Summary{
		ID:             "sum2",
		ConversationID: conv2.ID,
		SessionID:      sess.ID,
		Content:        "Summary two",
		Status:         models.SummaryStatusCompleted,
		MessageCount:   4,
		CreatedAt:      time.Now(),
	})
	require.NoError(t, err)

	req := httptest.NewRequest("GET", "/api/repos/r1/sessions/s1/summaries", nil)
	req = withChiContext(req, map[string]string{"sessionId": sess.ID})
	w := httptest.NewRecorder()

	h.ListSessionSummaries(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var summaries []*models.Summary
	err = json.Unmarshal(w.Body.Bytes(), &summaries)
	require.NoError(t, err)
	assert.Len(t, summaries, 2)
}

func TestListSessionSummaries_Empty(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/repos/r1/sessions/no-session/summaries", nil)
	req = withChiContext(req, map[string]string{"sessionId": "no-session"})
	w := httptest.NewRecorder()

	h.ListSessionSummaries(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Should return empty array, not null
	var summaries []*models.Summary
	err := json.Unmarshal(w.Body.Bytes(), &summaries)
	require.NoError(t, err)
	assert.NotNil(t, summaries)
	assert.Len(t, summaries, 0)
	assert.Equal(t, "[]", strings.TrimSpace(w.Body.String()))
}

func TestListSessionSummaries_OnlyCompleted(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	repo := createTestRepo(t, s, "r1", "/fake/path")
	sess := createTestSession(t, s, "s1", repo.ID)
	conv1 := createTestConversation(t, s, "c1", sess.ID)
	conv2 := createTestConversation(t, s, "c2", sess.ID)

	// Add a completed summary
	err := s.AddSummary(ctx, &models.Summary{
		ID:             "sum-completed",
		ConversationID: conv1.ID,
		SessionID:      sess.ID,
		Content:        "Done summary",
		Status:         models.SummaryStatusCompleted,
		MessageCount:   3,
		CreatedAt:      time.Now(),
	})
	require.NoError(t, err)

	// Add a generating summary - should be excluded
	err = s.AddSummary(ctx, &models.Summary{
		ID:             "sum-generating",
		ConversationID: conv2.ID,
		SessionID:      sess.ID,
		Content:        "",
		Status:         models.SummaryStatusGenerating,
		MessageCount:   2,
		CreatedAt:      time.Now(),
	})
	require.NoError(t, err)

	req := httptest.NewRequest("GET", "/api/repos/r1/sessions/s1/summaries", nil)
	req = withChiContext(req, map[string]string{"sessionId": sess.ID})
	w := httptest.NewRecorder()

	h.ListSessionSummaries(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var summaries []*models.Summary
	err = json.Unmarshal(w.Body.Bytes(), &summaries)
	require.NoError(t, err)
	assert.Len(t, summaries, 1)
	assert.Equal(t, "sum-completed", summaries[0].ID)
}

func TestGenerateConversationSummary_ConversationNotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("POST", "/api/conversations/nonexistent/summary", nil)
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GenerateConversationSummary(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)

	var apiErr APIError
	err := json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeNotFound, apiErr.Code)
}

func TestGenerateConversationSummary_NoAIClient(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	repo := createTestRepo(t, s, "r1", "/fake/path")
	sess := createTestSession(t, s, "s1", repo.ID)
	conv := createTestConversation(t, s, "c1", sess.ID)

	// Add enough messages
	err := s.AddMessageToConversation(ctx, conv.ID, models.Message{ID: "m1", Role: "user", Content: "Hello", Timestamp: time.Now()})
	require.NoError(t, err)
	err = s.AddMessageToConversation(ctx, conv.ID, models.Message{ID: "m2", Role: "assistant", Content: "Hi there", Timestamp: time.Now()})
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/conversations/c1/summary", nil)
	req = withChiContext(req, map[string]string{"convId": conv.ID})
	w := httptest.NewRecorder()

	h.GenerateConversationSummary(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)

	var apiErr APIError
	err = json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeServiceUnavailable, apiErr.Code)
}

func TestGenerateConversationSummary_TooFewMessages(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Set a non-nil aiClient so we get past the nil check
	h.aiClient = ai.NewClient("fake-test-key")

	repo := createTestRepo(t, s, "r1", "/fake/path")
	sess := createTestSession(t, s, "s1", repo.ID)
	conv := createTestConversation(t, s, "c1", sess.ID)

	// Add only 1 message (need at least 2 user/assistant messages)
	err := s.AddMessageToConversation(ctx, conv.ID, models.Message{ID: "m1", Role: "user", Content: "Hello", Timestamp: time.Now()})
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/conversations/c1/summary", nil)
	req = withChiContext(req, map[string]string{"convId": conv.ID})
	w := httptest.NewRecorder()

	h.GenerateConversationSummary(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var apiErr APIError
	err = json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeValidation, apiErr.Code)
	assert.Contains(t, apiErr.Error, "at least 2 messages")
}

func TestGenerateConversationSummary_AlreadyGenerating(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Set a non-nil aiClient so we get past the nil check
	h.aiClient = ai.NewClient("fake-test-key")

	repo := createTestRepo(t, s, "r1", "/fake/path")
	sess := createTestSession(t, s, "s1", repo.ID)
	conv := createTestConversation(t, s, "c1", sess.ID)

	// Add enough messages
	err := s.AddMessageToConversation(ctx, conv.ID, models.Message{ID: "m1", Role: "user", Content: "Hello", Timestamp: time.Now()})
	require.NoError(t, err)
	err = s.AddMessageToConversation(ctx, conv.ID, models.Message{ID: "m2", Role: "assistant", Content: "Hi there", Timestamp: time.Now()})
	require.NoError(t, err)

	// Add a generating summary
	err = s.AddSummary(ctx, &models.Summary{
		ID:             "sum-gen",
		ConversationID: conv.ID,
		SessionID:      sess.ID,
		Status:         models.SummaryStatusGenerating,
		MessageCount:   2,
		CreatedAt:      time.Now(),
	})
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/conversations/c1/summary", nil)
	req = withChiContext(req, map[string]string{"convId": conv.ID})
	w := httptest.NewRecorder()

	h.GenerateConversationSummary(w, req)

	assert.Equal(t, http.StatusConflict, w.Code)

	var apiErr APIError
	err = json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeConflict, apiErr.Code)
	assert.Contains(t, apiErr.Error, "already being generated")
}

func TestGenerateConversationSummary_AlreadyCompleted(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Set a non-nil aiClient so we get past the nil check
	h.aiClient = ai.NewClient("fake-test-key")

	repo := createTestRepo(t, s, "r1", "/fake/path")
	sess := createTestSession(t, s, "s1", repo.ID)
	conv := createTestConversation(t, s, "c1", sess.ID)

	// Add enough messages
	err := s.AddMessageToConversation(ctx, conv.ID, models.Message{ID: "m1", Role: "user", Content: "Hello", Timestamp: time.Now()})
	require.NoError(t, err)
	err = s.AddMessageToConversation(ctx, conv.ID, models.Message{ID: "m2", Role: "assistant", Content: "Hi there", Timestamp: time.Now()})
	require.NoError(t, err)

	// Add a completed summary
	err = s.AddSummary(ctx, &models.Summary{
		ID:             "sum-done",
		ConversationID: conv.ID,
		SessionID:      sess.ID,
		Content:        "Already summarized",
		Status:         models.SummaryStatusCompleted,
		MessageCount:   2,
		CreatedAt:      time.Now(),
	})
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/conversations/c1/summary", nil)
	req = withChiContext(req, map[string]string{"convId": conv.ID})
	w := httptest.NewRecorder()

	h.GenerateConversationSummary(w, req)

	// Should return 200 with existing summary, not start a new generation
	assert.Equal(t, http.StatusOK, w.Code)

	var summary models.Summary
	err = json.Unmarshal(w.Body.Bytes(), &summary)
	require.NoError(t, err)
	assert.Equal(t, "sum-done", summary.ID)
	assert.Equal(t, "Already summarized", summary.Content)
	assert.Equal(t, models.SummaryStatusCompleted, summary.Status)
}
func TestGetConversationMessagesHandler_DefaultParams(t *testing.T) {
	h, s := setupTestHandlers(t)
	createTestRepo(t, s, "ws-1", "/path/to/ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addTestMessages(t, s, "conv-1", 5)

	req := httptest.NewRequest("GET", "/api/conversations/conv-1/messages", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.GetConversationMessages(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var page models.MessagePage
	err := json.Unmarshal(w.Body.Bytes(), &page)
	require.NoError(t, err)
	assert.Len(t, page.Messages, 5)
	assert.Equal(t, 5, page.TotalCount)
	assert.False(t, page.HasMore)
}

func TestGetConversationMessagesHandler_WithLimit(t *testing.T) {
	h, s := setupTestHandlers(t)
	createTestRepo(t, s, "ws-1", "/path/to/ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addTestMessages(t, s, "conv-1", 10)

	req := httptest.NewRequest("GET", "/api/conversations/conv-1/messages?limit=3", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.GetConversationMessages(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var page models.MessagePage
	err := json.Unmarshal(w.Body.Bytes(), &page)
	require.NoError(t, err)
	assert.Len(t, page.Messages, 3)
	assert.Equal(t, 10, page.TotalCount)
	assert.True(t, page.HasMore)
}

func TestGetConversationMessagesHandler_WithCursor(t *testing.T) {
	h, s := setupTestHandlers(t)
	createTestRepo(t, s, "ws-1", "/path/to/ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addTestMessages(t, s, "conv-1", 10)

	// First request to get the cursor
	req1 := httptest.NewRequest("GET", "/api/conversations/conv-1/messages?limit=3", nil)
	req1 = withChiContext(req1, map[string]string{"convId": "conv-1"})
	w1 := httptest.NewRecorder()
	h.GetConversationMessages(w1, req1)

	var page1 models.MessagePage
	require.NoError(t, json.Unmarshal(w1.Body.Bytes(), &page1))

	// Second request with cursor
	url := fmt.Sprintf("/api/conversations/conv-1/messages?limit=3&before=%d", page1.OldestPosition)
	req2 := httptest.NewRequest("GET", url, nil)
	req2 = withChiContext(req2, map[string]string{"convId": "conv-1"})
	w2 := httptest.NewRecorder()
	h.GetConversationMessages(w2, req2)

	assert.Equal(t, http.StatusOK, w2.Code)

	var page2 models.MessagePage
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &page2))
	assert.Len(t, page2.Messages, 3)
	assert.True(t, page2.HasMore)

	// No overlap between pages
	page1IDs := make(map[string]bool)
	for _, m := range page1.Messages {
		page1IDs[m.ID] = true
	}
	for _, m := range page2.Messages {
		assert.False(t, page1IDs[m.ID], "page2 should not contain messages from page1")
	}
}

func TestGetConversationMessagesHandler_InvalidBefore(t *testing.T) {
	h, s := setupTestHandlers(t)
	createTestRepo(t, s, "ws-1", "/path/to/ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	req := httptest.NewRequest("GET", "/api/conversations/conv-1/messages?before=notanumber", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.GetConversationMessages(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetConversationMessagesHandler_InvalidLimit(t *testing.T) {
	h, s := setupTestHandlers(t)
	createTestRepo(t, s, "ws-1", "/path/to/ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	tests := []struct {
		name  string
		limit string
	}{
		{"non-numeric", "abc"},
		{"zero", "0"},
		{"negative", "-5"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/conversations/conv-1/messages?limit="+tt.limit, nil)
			req = withChiContext(req, map[string]string{"convId": "conv-1"})
			w := httptest.NewRecorder()

			h.GetConversationMessages(w, req)

			assert.Equal(t, http.StatusBadRequest, w.Code)
		})
	}
}

func TestGetConversationMessagesHandler_EmptyConversation(t *testing.T) {
	h, s := setupTestHandlers(t)
	createTestRepo(t, s, "ws-1", "/path/to/ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	req := httptest.NewRequest("GET", "/api/conversations/conv-1/messages", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.GetConversationMessages(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var page models.MessagePage
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &page))
	assert.Empty(t, page.Messages)
	assert.False(t, page.HasMore)
	assert.Equal(t, 0, page.TotalCount)
}

func TestGetConversationMessagesHandler_NonexistentConversation(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/conversations/nonexistent/messages", nil)
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetConversationMessages(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var page models.MessagePage
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &page))
	assert.Empty(t, page.Messages)
	assert.Equal(t, 0, page.TotalCount)
}

func TestGetConversationMessagesHandler_FullPagination(t *testing.T) {
	h, s := setupTestHandlers(t)
	createTestRepo(t, s, "ws-1", "/path/to/ws-1")
	createTestSession(t, s, "sess-1", "ws-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	addTestMessages(t, s, "conv-1", 11)

	// Walk through all pages via the HTTP handler
	var allMessages []models.Message
	baseURL := "/api/conversations/conv-1/messages?limit=4"
	cursorParam := ""

	for {
		req := httptest.NewRequest("GET", baseURL+cursorParam, nil)
		req = withChiContext(req, map[string]string{"convId": "conv-1"})
		w := httptest.NewRecorder()
		h.GetConversationMessages(w, req)

		require.Equal(t, http.StatusOK, w.Code)

		var page models.MessagePage
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &page))
		allMessages = append(allMessages, page.Messages...)

		if !page.HasMore {
			break
		}
		cursorParam = fmt.Sprintf("&before=%d", page.OldestPosition)
	}

	assert.Len(t, allMessages, 11)

	// Verify no duplicates
	seen := make(map[string]bool)
	for _, m := range allMessages {
		assert.False(t, seen[m.ID], "duplicate message: %s", m.ID)
		seen[m.ID] = true
	}
}
func TestGetActiveStreamingConversations_NoProcesses(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	req := httptest.NewRequest("GET", "/api/conversations/active-streaming", nil)
	w := httptest.NewRecorder()

	h.GetActiveStreamingConversations(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Header().Get("Content-Type"), "application/json")

	var result map[string][]string
	err := json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Empty(t, result["conversationIds"])
}

func TestGetActiveStreamingConversations_ReturnsEmptyArray(t *testing.T) {
	h, _, _ := setupTestHandlersWithAgentManager(t)

	req := httptest.NewRequest("GET", "/api/conversations/active-streaming", nil)
	w := httptest.NewRecorder()

	h.GetActiveStreamingConversations(w, req)

	// Verify it returns [] not null
	assert.Contains(t, w.Body.String(), `"conversationIds":[]`)
}

func TestGetActiveStreamingConversations_WithRunningProcess(t *testing.T) {
	h, _, agentMgr := setupTestHandlersWithAgentManager(t)

	proc := agent.NewProcess("proc-1", t.TempDir(), "conv-active")
	proc.SetRunningForTest(true)
	agentMgr.InsertProcessForTest("conv-active", proc)

	req := httptest.NewRequest("GET", "/api/conversations/active-streaming", nil)
	w := httptest.NewRecorder()

	h.GetActiveStreamingConversations(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string][]string
	err := json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Equal(t, []string{"conv-active"}, result["conversationIds"])
}

func TestGetActiveStreamingConversations_MixedProcesses(t *testing.T) {
	h, _, agentMgr := setupTestHandlersWithAgentManager(t)

	procRunning := agent.NewProcess("proc-1", t.TempDir(), "conv-running")
	procRunning.SetRunningForTest(true)
	agentMgr.InsertProcessForTest("conv-running", procRunning)

	procStopped := agent.NewProcess("proc-2", t.TempDir(), "conv-stopped")
	agentMgr.InsertProcessForTest("conv-stopped", procStopped)

	req := httptest.NewRequest("GET", "/api/conversations/active-streaming", nil)
	w := httptest.NewRecorder()

	h.GetActiveStreamingConversations(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string][]string
	err := json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Len(t, result["conversationIds"], 1)
	assert.Contains(t, result["conversationIds"], "conv-running")
}

func addTestMessages(t *testing.T, s *store.SQLiteStore, convID string, n int) {
	t.Helper()
	ctx := context.Background()
	for i := 0; i < n; i++ {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		msg := models.Message{
			ID:        fmt.Sprintf("msg-%s-%d", convID, i),
			Role:      role,
			Content:   fmt.Sprintf("Message %d", i),
			Timestamp: time.Now(),
		}
		require.NoError(t, s.AddMessageToConversation(ctx, convID, msg))
	}
}
