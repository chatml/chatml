package loop

import (
	"encoding/json"
	"testing"

	"github.com/chatml/chatml-core/agent"
	"github.com/chatml/chatml-core/provider"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestEmitter() (*emitter, chan string) {
	ch := make(chan string, 64)
	return &emitter{ch: ch}, ch
}

func readEvent(t *testing.T, ch <-chan string) agent.AgentEvent {
	t.Helper()
	raw := <-ch
	var event agent.AgentEvent
	require.NoError(t, json.Unmarshal([]byte(raw), &event))
	return event
}

func TestEmitter_EmitReady(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitReady("claude-sonnet-4-6", "/tmp/work")

	event := readEvent(t, ch)
	assert.Equal(t, "ready", event.Type)
	assert.Equal(t, "claude-sonnet-4-6", event.Model)
	assert.Equal(t, "/tmp/work", event.Cwd)
}

func TestEmitter_EmitSessionStarted(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitSessionStarted("sess-abc", "startup")

	event := readEvent(t, ch)
	assert.Equal(t, "session_started", event.Type)
	assert.Equal(t, "sess-abc", event.SessionID)
	assert.Equal(t, "startup", event.Source)
}

func TestEmitter_EmitAssistantText(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitAssistantText("Hello world")

	event := readEvent(t, ch)
	assert.Equal(t, "assistant_text", event.Type)
	assert.Equal(t, "Hello world", event.Content)
}

func TestEmitter_EmitThinking(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitThinking("Let me think...")

	event := readEvent(t, ch)
	assert.Equal(t, "thinking", event.Type)
	assert.Equal(t, "Let me think...", event.Content)
}

func TestEmitter_EmitToolStart(t *testing.T) {
	e, ch := newTestEmitter()
	params := map[string]interface{}{
		"command": "ls -la",
	}
	e.emitToolStart("tu_123", "Bash", params)

	event := readEvent(t, ch)
	assert.Equal(t, "tool_start", event.Type)
	assert.Equal(t, "tu_123", event.ID)
	assert.Equal(t, "Bash", event.Tool)
	assert.Equal(t, "ls -la", event.Params["command"])
}

func TestEmitter_EmitToolEnd(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitToolEnd("tu_123", "Bash", true, "Listed files successfully", map[string]interface{}{"command": "ls"})

	event := readEvent(t, ch)
	assert.Equal(t, "tool_end", event.Type)
	assert.Equal(t, "tu_123", event.ID)
	assert.Equal(t, "Bash", event.Tool)
	assert.True(t, event.Success)
	assert.Equal(t, "Listed files successfully", event.Summary)
}

func TestEmitter_EmitToolEnd_Failure(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitToolEnd("tu_456", "Write", false, "permission denied", nil)

	event := readEvent(t, ch)
	assert.Equal(t, "tool_end", event.Type)
	assert.False(t, event.Success)
}

func TestEmitter_EmitResult(t *testing.T) {
	e, ch := newTestEmitter()
	usage := &provider.Usage{
		InputTokens:          1500,
		OutputTokens:         500,
		CacheReadInputTokens: 200,
	}
	e.emitResult(usage, 0.05, 3)

	event := readEvent(t, ch)
	assert.Equal(t, "result", event.Type)
	assert.Equal(t, 0.05, event.Cost)
	assert.Equal(t, 3, event.Turns)
	assert.NotNil(t, event.Usage)
	assert.Equal(t, float64(1500), event.Usage["input_tokens"])
	assert.Equal(t, float64(500), event.Usage["output_tokens"])
	assert.Equal(t, float64(200), event.Usage["cache_read_input_tokens"])
}

func TestEmitter_EmitResult_NilUsage(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitResult(nil, 0, 1)

	event := readEvent(t, ch)
	assert.Equal(t, "result", event.Type)
	assert.Equal(t, 1, event.Turns)
	// Empty usage map is omitted by json omitempty, so it unmarshals as nil
	assert.Nil(t, event.Usage)
}

func TestEmitter_EmitTurnComplete(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitTurnComplete()

	event := readEvent(t, ch)
	assert.Equal(t, "turn_complete", event.Type)
}

func TestEmitter_EmitComplete(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitComplete()

	event := readEvent(t, ch)
	assert.Equal(t, "complete", event.Type)
}

func TestEmitter_EmitError(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitError("something went wrong")

	event := readEvent(t, ch)
	assert.Equal(t, "error", event.Type)
	assert.Equal(t, "something went wrong", event.Message)
}

func TestEmitter_EmitContextUsage(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitContextUsage(50000, 2000, 200000, 120000)

	event := readEvent(t, ch)
	assert.Equal(t, "context_usage", event.Type)
	assert.Equal(t, 50000, event.InputTokens)
	assert.Equal(t, 2000, event.OutputTokens)
	assert.Equal(t, 200000, event.ContextWindow)
	assert.Equal(t, 120000, event.CumulativeTokens)
}

func TestEmitter_EmitPermissionModeChanged(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitPermissionModeChanged("plan")

	event := readEvent(t, ch)
	assert.Equal(t, "permission_mode_changed", event.Type)
	assert.Equal(t, "plan", event.Mode)
}

func TestEmitter_JSONFormat(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitAssistantText("test")

	raw := <-ch

	// Verify it's valid JSON
	assert.True(t, json.Valid([]byte(raw)), "emitted event should be valid JSON")

	// Verify it can be parsed by the existing agent parser
	event := agent.ParseAgentLine(raw)
	assert.Equal(t, "assistant_text", event.Type)
	assert.Equal(t, "test", event.Content)
}

func TestEmitter_EmitToolApprovalRequest(t *testing.T) {
	e, ch := newTestEmitter()

	toolInput := map[string]interface{}{"command": "rm -rf /"}
	e.emitToolApprovalRequest("tar-1-12345", "Bash", toolInput, "rm -rf /")

	event := readEvent(t, ch)
	assert.Equal(t, "tool_approval_request", event.Type)
	assert.Equal(t, "tar-1-12345", event.RequestID)
	assert.Equal(t, "Bash", event.ToolName)
	assert.Equal(t, "rm -rf /", event.Specifier)
	assert.NotNil(t, event.ToolInput)
}

func TestEmitter_EmitToolApprovalRequest_NilInput(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitToolApprovalRequest("tar-2-99999", "Write", nil, "/etc/passwd")

	event := readEvent(t, ch)
	assert.Equal(t, "tool_approval_request", event.Type)
	assert.Equal(t, "tar-2-99999", event.RequestID)
	assert.Equal(t, "Write", event.ToolName)
	assert.Equal(t, "/etc/passwd", event.Specifier)
}

func TestEmitter_SpecialCharacters(t *testing.T) {
	e, ch := newTestEmitter()
	e.emitAssistantText("Hello \"world\" \n\ttab & <html>")

	raw := <-ch
	assert.True(t, json.Valid([]byte(raw)))

	var event agent.AgentEvent
	require.NoError(t, json.Unmarshal([]byte(raw), &event))
	assert.Equal(t, "Hello \"world\" \n\ttab & <html>", event.Content)
}
