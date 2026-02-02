package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chatml/chatml-backend/agent"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetStreamingSnapshot_ReturnsSnapshot(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "repo-1", repoPath)
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Store a snapshot
	snapshot := agent.StreamingSnapshot{
		Text: "Hello from the agent",
		ActiveTools: []agent.ActiveToolEntry{
			{ID: "tool-1", Tool: "Bash", StartTime: 1706000001},
		},
		Thinking:       "analyzing the problem",
		IsThinking:     true,
		PlanModeActive: false,
	}
	data, err := json.Marshal(snapshot)
	require.NoError(t, err)
	require.NoError(t, s.SetStreamingSnapshot(t.Context(), "conv-1", data))

	// Request the snapshot
	req := httptest.NewRequest("GET", "/api/conversations/conv-1/streaming-snapshot", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.GetStreamingSnapshot(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))

	var got agent.StreamingSnapshot
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	assert.Equal(t, "Hello from the agent", got.Text)
	assert.Len(t, got.ActiveTools, 1)
	assert.Equal(t, "Bash", got.ActiveTools[0].Tool)
	assert.Equal(t, "analyzing the problem", got.Thinking)
	assert.True(t, got.IsThinking)
	assert.False(t, got.PlanModeActive)
}

func TestGetStreamingSnapshot_ReturnsNullWhenEmpty(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "repo-1", repoPath)
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Don't set any snapshot — default is empty
	req := httptest.NewRequest("GET", "/api/conversations/conv-1/streaming-snapshot", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.GetStreamingSnapshot(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "null\n", w.Body.String())
}

func TestGetStreamingSnapshot_ReturnsNullForMissingConversation(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/conversations/nonexistent/streaming-snapshot", nil)
	req = withChiContext(req, map[string]string{"convId": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetStreamingSnapshot(w, req)

	// Nonexistent conversation returns null (no row = nil snapshot)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "null\n", w.Body.String())
}

func TestGetStreamingSnapshot_AfterClear(t *testing.T) {
	h, s := setupTestHandlers(t)
	repoPath := createTestGitRepo(t)
	createTestRepo(t, s, "repo-1", repoPath)
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Set then clear
	data := []byte(`{"text":"some text","activeTools":[],"isThinking":false,"planModeActive":false}`)
	require.NoError(t, s.SetStreamingSnapshot(t.Context(), "conv-1", data))
	require.NoError(t, s.ClearStreamingSnapshot(t.Context(), "conv-1"))

	req := httptest.NewRequest("GET", "/api/conversations/conv-1/streaming-snapshot", nil)
	req = withChiContext(req, map[string]string{"convId": "conv-1"})
	w := httptest.NewRecorder()

	h.GetStreamingSnapshot(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "null\n", w.Body.String())
}
