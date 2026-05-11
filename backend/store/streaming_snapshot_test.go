package store

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupInterruptedConv creates a conversation with an agent_session_id set (required
// by GetInterruptedConversations) and a streaming snapshot.
func setupInterruptedConv(t *testing.T, s *SQLiteStore, convID string, snapshot map[string]interface{}) {
	t.Helper()
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-"+convID)
	session := createTestSession(t, s, "sess-"+convID, repo.ID)
	createTestConversation(t, s, convID, session.ID)
	require.NoError(t, s.UpdateConversation(ctx, convID, func(c *models.Conversation) {
		c.AgentSessionID = "agent-session-" + convID
	}))
	data, err := json.Marshal(snapshot)
	require.NoError(t, err)
	require.NoError(t, s.SetStreamingSnapshot(ctx, convID, data))
}

func TestConvertSnapshotsToMessages_PlanOnly(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	setupInterruptedConv(t, s, "conv-1", map[string]interface{}{
		"text":     "",
		"thinking": "",
		"pendingPlanApproval": map[string]interface{}{
			"planContent": "Step 1: do the thing\nStep 2: profit",
		},
	})

	recovered, err := s.ConvertSnapshotsToMessages(ctx)
	require.NoError(t, err)
	assert.Equal(t, []string{"conv-1"}, recovered)

	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 10, false)
	require.NoError(t, err)
	require.Len(t, page.Messages, 1)

	msg := page.Messages[0]
	assert.Equal(t, "assistant", msg.Role)
	assert.Equal(t, "", msg.Content)
	assert.Equal(t, "Step 1: do the thing\nStep 2: profit", msg.PlanContent)
	require.Len(t, msg.Timeline, 1)
	assert.Equal(t, "plan", msg.Timeline[0].Type)
	assert.Equal(t, "Step 1: do the thing\nStep 2: profit", msg.Timeline[0].Content)

	// Snapshot should be cleared after conversion
	snap, err := s.GetStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
	assert.Nil(t, snap)
}

func TestConvertSnapshotsToMessages_TextAndPlan(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	setupInterruptedConv(t, s, "conv-1", map[string]interface{}{
		"text":     "Here is my plan:",
		"thinking": "let me think...",
		"pendingPlanApproval": map[string]interface{}{
			"planContent": "Step 1: do stuff",
		},
	})

	recovered, err := s.ConvertSnapshotsToMessages(ctx)
	require.NoError(t, err)
	assert.Equal(t, []string{"conv-1"}, recovered)

	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 10, false)
	require.NoError(t, err)
	require.Len(t, page.Messages, 1)

	msg := page.Messages[0]
	assert.Equal(t, "assistant", msg.Role)
	assert.Equal(t, "Here is my plan:", msg.Content)
	assert.Equal(t, "let me think...", msg.ThinkingContent)
	assert.Equal(t, "Step 1: do stuff", msg.PlanContent)

	types := make([]string, len(msg.Timeline))
	for i, e := range msg.Timeline {
		types[i] = e.Type
	}
	assert.Equal(t, []string{"thinking", "text", "plan"}, types)
}

func TestConvertSnapshotsToMessages_EmptyPlanContent(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// pendingPlanApproval present but planContent is empty — treated as empty snapshot
	setupInterruptedConv(t, s, "conv-1", map[string]interface{}{
		"text":     "",
		"thinking": "",
		"pendingPlanApproval": map[string]interface{}{
			"planContent": "",
		},
	})

	recovered, err := s.ConvertSnapshotsToMessages(ctx)
	require.NoError(t, err)
	assert.Empty(t, recovered)

	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 10, false)
	require.NoError(t, err)
	assert.Empty(t, page.Messages)

	// Empty snapshot should be cleared
	snap, err := s.GetStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
	assert.Nil(t, snap)
}

func TestConvertSnapshotsToMessages_DedupPlanOnly(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Simulate a previous recovery: there's already an assistant message with
	// empty content and planContent = "Plan A". A second snapshot with the same
	// plan content arrives — should be deduped and not create a duplicate message.
	repo := createTestRepo(t, s, "repo-conv-1")
	session := createTestSession(t, s, "sess-conv-1", repo.ID)
	createTestConversation(t, s, "conv-1", session.ID)
	require.NoError(t, s.UpdateConversation(ctx, "conv-1", func(c *models.Conversation) {
		c.AgentSessionID = "agent-session-conv-1"
	}))

	existingMsg := models.Message{
		ID:          "msg-1",
		Role:        "assistant",
		Content:     "",
		PlanContent: "Plan A",
	}
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", existingMsg))

	// Same content in the snapshot
	data := []byte(`{"text":"","thinking":"","pendingPlanApproval":{"planContent":"Plan A"}}`)
	require.NoError(t, s.SetStreamingSnapshot(ctx, "conv-1", data))

	recovered, err := s.ConvertSnapshotsToMessages(ctx)
	require.NoError(t, err)
	assert.Empty(t, recovered) // deduped, not recovered again

	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 10, false)
	require.NoError(t, err)
	assert.Len(t, page.Messages, 1) // still only the original message
}

func TestConvertSnapshotsToMessages_DifferentPlanNotDeduped(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Existing message has Plan A; snapshot has Plan B — must NOT be deduped.
	repo := createTestRepo(t, s, "repo-conv-1")
	session := createTestSession(t, s, "sess-conv-1", repo.ID)
	createTestConversation(t, s, "conv-1", session.ID)
	require.NoError(t, s.UpdateConversation(ctx, "conv-1", func(c *models.Conversation) {
		c.AgentSessionID = "agent-session-conv-1"
	}))

	existingMsg := models.Message{
		ID:          "msg-1",
		Role:        "assistant",
		Content:     "",
		PlanContent: "Plan A",
	}
	require.NoError(t, s.AddMessageToConversation(ctx, "conv-1", existingMsg))

	// Different plan in the snapshot
	data := []byte(`{"text":"","thinking":"","pendingPlanApproval":{"planContent":"Plan B"}}`)
	require.NoError(t, s.SetStreamingSnapshot(ctx, "conv-1", data))

	recovered, err := s.ConvertSnapshotsToMessages(ctx)
	require.NoError(t, err)
	assert.Equal(t, []string{"conv-1"}, recovered)

	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 10, false)
	require.NoError(t, err)
	require.Len(t, page.Messages, 2)
	assert.Equal(t, "Plan B", page.Messages[1].PlanContent)
}

func TestSetStreamingSnapshot_Basic(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "sess-1", repo.ID)
	conv := createTestConversation(t, s, "conv-1", session.ID)

	snapshot := map[string]interface{}{
		"text":        "Hello world",
		"activeTools": []interface{}{},
		"isThinking":  false,
	}
	data, err := json.Marshal(snapshot)
	require.NoError(t, err)

	err = s.SetStreamingSnapshot(ctx, conv.ID, data)
	require.NoError(t, err)

	got, err := s.GetStreamingSnapshot(ctx, conv.ID)
	require.NoError(t, err)
	require.NotNil(t, got)

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal(got, &parsed))
	assert.Equal(t, "Hello world", parsed["text"])
}

func TestGetStreamingSnapshot_EmptyReturnsNil(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "sess-1", repo.ID)
	createTestConversation(t, s, "conv-1", session.ID)

	// Never set a snapshot — default is empty string
	got, err := s.GetStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestGetStreamingSnapshot_NonexistentConversation(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	got, err := s.GetStreamingSnapshot(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestClearStreamingSnapshot(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "sess-1", repo.ID)
	conv := createTestConversation(t, s, "conv-1", session.ID)

	// Set a snapshot
	data := []byte(`{"text":"some content","activeTools":[],"isThinking":false}`)
	require.NoError(t, s.SetStreamingSnapshot(ctx, conv.ID, data))

	// Verify it exists
	got, err := s.GetStreamingSnapshot(ctx, conv.ID)
	require.NoError(t, err)
	require.NotNil(t, got)

	// Clear it
	require.NoError(t, s.ClearStreamingSnapshot(ctx, conv.ID))

	// Verify it's gone
	got, err = s.GetStreamingSnapshot(ctx, conv.ID)
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestSetStreamingSnapshot_Overwrite(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "sess-1", repo.ID)
	conv := createTestConversation(t, s, "conv-1", session.ID)

	// Set initial snapshot
	data1 := []byte(`{"text":"first","activeTools":[],"isThinking":false}`)
	require.NoError(t, s.SetStreamingSnapshot(ctx, conv.ID, data1))

	// Overwrite with new snapshot
	data2 := []byte(`{"text":"second","activeTools":[{"id":"t1","tool":"Bash","startTime":1234}],"isThinking":true}`)
	require.NoError(t, s.SetStreamingSnapshot(ctx, conv.ID, data2))

	got, err := s.GetStreamingSnapshot(ctx, conv.ID)
	require.NoError(t, err)
	require.NotNil(t, got)

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal(got, &parsed))
	assert.Equal(t, "second", parsed["text"])
	assert.True(t, parsed["isThinking"].(bool))

	tools := parsed["activeTools"].([]interface{})
	assert.Len(t, tools, 1)
}

func TestClearStreamingSnapshot_AlreadyEmpty(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "sess-1", repo.ID)
	createTestConversation(t, s, "conv-1", session.ID)

	// Clear when already empty — should not error
	err := s.ClearStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
}

func TestSetStreamingSnapshot_LargeContent(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "sess-1", repo.ID)
	conv := createTestConversation(t, s, "conv-1", session.ID)

	// Simulate a large assistant message (~100KB)
	largeText := make([]byte, 100*1024)
	for i := range largeText {
		largeText[i] = 'a' + byte(i%26)
	}

	snapshot := map[string]interface{}{
		"text":           string(largeText),
		"activeTools":    []interface{}{},
		"isThinking":     false,
		"planModeActive": false,
	}
	data, err := json.Marshal(snapshot)
	require.NoError(t, err)

	require.NoError(t, s.SetStreamingSnapshot(ctx, conv.ID, data))

	got, err := s.GetStreamingSnapshot(ctx, conv.ID)
	require.NoError(t, err)
	require.NotNil(t, got)

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal(got, &parsed))
	assert.Len(t, parsed["text"], 100*1024)
}

func TestStreamingSnapshot_MultipleConversations(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	repo := createTestRepo(t, s, "repo-1")
	session := createTestSession(t, s, "sess-1", repo.ID)
	createTestConversation(t, s, "conv-1", session.ID)
	createTestConversation(t, s, "conv-2", session.ID)

	// Set different snapshots for different conversations
	data1 := []byte(`{"text":"conv1 text","activeTools":[],"isThinking":false}`)
	data2 := []byte(`{"text":"conv2 text","activeTools":[],"isThinking":true}`)
	require.NoError(t, s.SetStreamingSnapshot(ctx, "conv-1", data1))
	require.NoError(t, s.SetStreamingSnapshot(ctx, "conv-2", data2))

	// Verify they're independent
	got1, err := s.GetStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
	got2, err := s.GetStreamingSnapshot(ctx, "conv-2")
	require.NoError(t, err)

	var p1, p2 map[string]interface{}
	require.NoError(t, json.Unmarshal(got1, &p1))
	require.NoError(t, json.Unmarshal(got2, &p2))

	assert.Equal(t, "conv1 text", p1["text"])
	assert.Equal(t, "conv2 text", p2["text"])

	// Clear one, other should remain
	require.NoError(t, s.ClearStreamingSnapshot(ctx, "conv-1"))

	got1, err = s.GetStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
	assert.Nil(t, got1)

	got2, err = s.GetStreamingSnapshot(ctx, "conv-2")
	require.NoError(t, err)
	assert.NotNil(t, got2)
}
