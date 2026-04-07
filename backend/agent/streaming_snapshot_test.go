package agent

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestProcessWithChannel creates a minimal Process with a writable output channel.
// Callers must close the channel when done to signal the output handler to exit.
func newTestProcessWithChannel(t *testing.T) (*Process, chan string) {
	t.Helper()
	ch := make(chan string, 100)
	proc := &Process{
		ID:     "test-proc",
		output: ch,
		done:   make(chan struct{}),
	}
	return proc, ch
}

// sendJSONEvent marshals an event and writes it to the channel.
func sendJSONEvent(t *testing.T, ch chan string, event map[string]interface{}) {
	t.Helper()
	data, err := json.Marshal(event)
	require.NoError(t, err)
	ch <- string(data)
}

func TestHandleConversationOutput_SnapshotOnAssistantText(t *testing.T) {
	manager, s := setupTestManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "repo-1")
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	proc, ch := newTestProcessWithChannel(t)

	// Send assistant_text events
	sendJSONEvent(t, ch, map[string]interface{}{"type": "assistant_text", "content": "Hello "})
	sendJSONEvent(t, ch, map[string]interface{}{"type": "assistant_text", "content": "world!"})

	// Close channel to end the output handler
	close(ch)

	// Run the output handler synchronously
	manager.handleConversationOutput("conv-1", proc, BackendAgentRunner)

	// After handler exits, snapshot should be cleared (process exited)
	snapshot, err := s.GetStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
	assert.Nil(t, snapshot, "snapshot should be cleared after process exit")
}

func TestHandleConversationOutput_SnapshotTracksToolState(t *testing.T) {
	manager, s := setupTestManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "repo-1")
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	proc, ch := newTestProcessWithChannel(t)

	// Capture events to verify they're forwarded
	var capturedEvents []*AgentEvent
	manager.SetConversationEventHandler(func(convID string, event *AgentEvent) {
		capturedEvents = append(capturedEvents, event)
	})

	// Send text + tool_start + tool_end sequence then close
	sendJSONEvent(t, ch, map[string]interface{}{"type": "assistant_text", "content": "Let me check "})
	sendJSONEvent(t, ch, map[string]interface{}{"type": "tool_start", "id": "tool-1", "tool": "Bash"})
	sendJSONEvent(t, ch, map[string]interface{}{"type": "tool_end", "id": "tool-1", "tool": "Bash", "success": true, "summary": "ran ls"})
	sendJSONEvent(t, ch, map[string]interface{}{"type": "assistant_text", "content": "Done."})
	close(ch)

	manager.handleConversationOutput("conv-1", proc, BackendAgentRunner)

	// Verify events were forwarded
	assert.True(t, len(capturedEvents) >= 4, "expected at least 4 events forwarded")

	// Snapshot cleared on exit
	snapshot, err := s.GetStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
	assert.Nil(t, snapshot)
}

func TestHandleConversationOutput_SnapshotClearedOnResult(t *testing.T) {
	manager, s := setupTestManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "repo-1")
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	proc, ch := newTestProcessWithChannel(t)

	// Send text then result
	sendJSONEvent(t, ch, map[string]interface{}{"type": "assistant_text", "content": "Final answer."})
	sendJSONEvent(t, ch, map[string]interface{}{"type": "result", "content": "done"})
	close(ch)

	manager.handleConversationOutput("conv-1", proc, BackendAgentRunner)

	// Snapshot should be cleared because result event clears it
	snapshot, err := s.GetStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
	assert.Nil(t, snapshot)

	// But the message should be persisted
	page, err := s.GetConversationMessages(ctx, "conv-1", nil, 50, false)
	require.NoError(t, err)
	assert.True(t, len(page.Messages) >= 1, "expected at least 1 persisted message")
}

func TestHandleConversationOutput_SnapshotClearedOnComplete(t *testing.T) {
	manager, s := setupTestManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "repo-1")
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	proc, ch := newTestProcessWithChannel(t)

	sendJSONEvent(t, ch, map[string]interface{}{"type": "assistant_text", "content": "Some text."})
	sendJSONEvent(t, ch, map[string]interface{}{"type": "complete"})
	close(ch)

	manager.handleConversationOutput("conv-1", proc, BackendAgentRunner)

	snapshot, err := s.GetStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
	assert.Nil(t, snapshot)
}

func TestHandleConversationOutput_DebouncedFlush(t *testing.T) {
	manager, s := setupTestManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "repo-1")
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	proc, ch := newTestProcessWithChannel(t)

	// Run handler in goroutine since we need the channel to stay open
	done := make(chan struct{})
	go func() {
		manager.handleConversationOutput("conv-1", proc, BackendAgentRunner)
		close(done)
	}()

	// Send some text
	sendJSONEvent(t, ch, map[string]interface{}{"type": "assistant_text", "content": "Hello "})
	sendJSONEvent(t, ch, map[string]interface{}{"type": "assistant_text", "content": "world!"})

	// Wait for debounce interval + margin
	time.Sleep(snapshotDebounceInterval + 200*time.Millisecond)

	// Snapshot should have been flushed
	snapshot, err := s.GetStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, snapshot, "snapshot should be flushed after debounce interval")

	var parsed StreamingSnapshot
	require.NoError(t, json.Unmarshal(snapshot, &parsed))
	assert.Equal(t, "Hello world!", parsed.Text)
	assert.Empty(t, parsed.ActiveTools)
	assert.False(t, parsed.IsThinking)

	// Close channel to terminate
	close(ch)
	<-done
}

func TestHandleConversationOutput_SnapshotIncludesActiveTools(t *testing.T) {
	manager, s := setupTestManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "repo-1")
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	proc, ch := newTestProcessWithChannel(t)

	done := make(chan struct{})
	go func() {
		manager.handleConversationOutput("conv-1", proc, BackendAgentRunner)
		close(done)
	}()

	// Send text + tool_start (tool stays active)
	sendJSONEvent(t, ch, map[string]interface{}{"type": "assistant_text", "content": "Running command..."})
	sendJSONEvent(t, ch, map[string]interface{}{"type": "tool_start", "id": "t1", "tool": "Bash"})

	// Wait for debounce
	time.Sleep(snapshotDebounceInterval + 200*time.Millisecond)

	snapshot, err := s.GetStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, snapshot)

	var parsed StreamingSnapshot
	require.NoError(t, json.Unmarshal(snapshot, &parsed))
	assert.Equal(t, "Running command...", parsed.Text)
	assert.Len(t, parsed.ActiveTools, 1)
	assert.Equal(t, "t1", parsed.ActiveTools[0].ID)
	assert.Equal(t, "Bash", parsed.ActiveTools[0].Tool)

	close(ch)
	<-done
}

func TestHandleConversationOutput_SnapshotIncludesThinking(t *testing.T) {
	manager, s := setupTestManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "repo-1")
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	proc, ch := newTestProcessWithChannel(t)

	done := make(chan struct{})
	go func() {
		manager.handleConversationOutput("conv-1", proc, BackendAgentRunner)
		close(done)
	}()

	// Send thinking events
	sendJSONEvent(t, ch, map[string]interface{}{"type": "thinking", "content": "Let me think"})
	sendJSONEvent(t, ch, map[string]interface{}{"type": "thinking_delta", "content": " about this..."})

	time.Sleep(snapshotDebounceInterval + 200*time.Millisecond)

	snapshot, err := s.GetStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, snapshot)

	var parsed StreamingSnapshot
	require.NoError(t, json.Unmarshal(snapshot, &parsed))
	assert.Equal(t, "Let me think about this...", parsed.Thinking)
	assert.True(t, parsed.IsThinking)

	close(ch)
	<-done
}

func TestHandleConversationOutput_ToolEndRemovesFromSnapshot(t *testing.T) {
	manager, s := setupTestManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "repo-1")
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	proc, ch := newTestProcessWithChannel(t)

	done := make(chan struct{})
	go func() {
		manager.handleConversationOutput("conv-1", proc, BackendAgentRunner)
		close(done)
	}()

	// Start two tools
	sendJSONEvent(t, ch, map[string]interface{}{"type": "tool_start", "id": "t1", "tool": "Bash"})
	sendJSONEvent(t, ch, map[string]interface{}{"type": "tool_start", "id": "t2", "tool": "Read"})

	time.Sleep(snapshotDebounceInterval + 200*time.Millisecond)

	// Verify both tools in snapshot
	snapshot, err := s.GetStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, snapshot)
	var parsed StreamingSnapshot
	require.NoError(t, json.Unmarshal(snapshot, &parsed))
	assert.Len(t, parsed.ActiveTools, 2)

	// End one tool
	sendJSONEvent(t, ch, map[string]interface{}{"type": "tool_end", "id": "t1", "tool": "Bash", "success": true, "summary": "ok"})

	time.Sleep(snapshotDebounceInterval + 200*time.Millisecond)

	// Only one tool should remain
	snapshot, err = s.GetStreamingSnapshot(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, snapshot)
	require.NoError(t, json.Unmarshal(snapshot, &parsed))
	assert.Len(t, parsed.ActiveTools, 1)
	assert.Equal(t, "t2", parsed.ActiveTools[0].ID)

	close(ch)
	<-done
}
