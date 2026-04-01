package anthropic

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"

	"github.com/chatml/chatml-backend/provider"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// sseFixture builds an SSE byte stream from event/data pairs.
func sseFixture(events ...string) io.ReadCloser {
	var sb strings.Builder
	for i := 0; i < len(events); i += 2 {
		sb.WriteString("event: " + events[i] + "\n")
		sb.WriteString("data: " + events[i+1] + "\n\n")
	}
	return io.NopCloser(strings.NewReader(sb.String()))
}

func collectEvents(ch <-chan provider.StreamEvent) []provider.StreamEvent {
	var events []provider.StreamEvent
	for ev := range ch {
		events = append(events, ev)
	}
	return events
}

func TestProcessStream_TextOnly(t *testing.T) {
	body := sseFixture(
		"message_start", `{"message":{"usage":{"input_tokens":10}}}`,
		"content_block_start", `{"index":0,"content_block":{"type":"text"}}`,
		"content_block_delta", `{"delta":{"type":"text_delta","text":"Hello "}}`,
		"content_block_delta", `{"delta":{"type":"text_delta","text":"world"}}`,
		"content_block_stop", `{"index":0}`,
		"message_delta", `{"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}`,
		"message_stop", `{}`,
	)

	c := &Client{}
	ch := make(chan provider.StreamEvent, 64)
	go c.processStream(context.Background(), body, ch)

	events := collectEvents(ch)

	// Verify we got text deltas
	var textParts []string
	for _, ev := range events {
		if ev.Type == provider.EventTextDelta {
			textParts = append(textParts, ev.Text)
		}
	}
	assert.Equal(t, []string{"Hello ", "world"}, textParts)

	// Verify message_delta with stop reason
	var stopReason string
	for _, ev := range events {
		if ev.Type == provider.EventMessageDelta {
			stopReason = ev.StopReason
		}
	}
	assert.Equal(t, "end_turn", stopReason)

	// Verify message_stop
	hasStop := false
	for _, ev := range events {
		if ev.Type == provider.EventMessageStop {
			hasStop = true
		}
	}
	assert.True(t, hasStop)
}

func TestProcessStream_ToolUse(t *testing.T) {
	body := sseFixture(
		"message_start", `{"message":{"usage":{"input_tokens":100}}}`,
		"content_block_start", `{"index":0,"content_block":{"type":"text"}}`,
		"content_block_delta", `{"delta":{"type":"text_delta","text":"Let me read the file."}}`,
		"content_block_stop", `{"index":0}`,
		"content_block_start", `{"index":1,"content_block":{"type":"tool_use","id":"tu_abc","name":"Read"}}`,
		"content_block_delta", `{"delta":{"type":"input_json_delta","partial_json":"{\"file_"}}`,
		"content_block_delta", `{"delta":{"type":"input_json_delta","partial_json":"path\":\"/tmp/x.go\"}"}}`,
		"content_block_stop", `{"index":1}`,
		"message_delta", `{"delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}`,
		"message_stop", `{}`,
	)

	c := &Client{}
	ch := make(chan provider.StreamEvent, 64)
	go c.processStream(context.Background(), body, ch)

	events := collectEvents(ch)

	// Verify tool_use_start
	var toolStartName string
	for _, ev := range events {
		if ev.Type == provider.EventToolUseStart {
			require.NotNil(t, ev.ToolUse)
			toolStartName = ev.ToolUse.Name
		}
	}
	assert.Equal(t, "Read", toolStartName)

	// Verify tool_use_end with accumulated input
	var toolEnd *provider.ToolUseBlock
	for _, ev := range events {
		if ev.Type == provider.EventToolUseEnd {
			toolEnd = ev.ToolUse
		}
	}
	require.NotNil(t, toolEnd)
	assert.Equal(t, "tu_abc", toolEnd.ID)
	assert.Equal(t, "Read", toolEnd.Name)

	var input map[string]interface{}
	err := json.Unmarshal(toolEnd.Input, &input)
	require.NoError(t, err)
	assert.Equal(t, "/tmp/x.go", input["file_path"])

	// Verify stop reason is tool_use
	for _, ev := range events {
		if ev.Type == provider.EventMessageDelta {
			assert.Equal(t, "tool_use", ev.StopReason)
		}
	}
}

func TestProcessStream_Thinking(t *testing.T) {
	body := sseFixture(
		"message_start", `{"message":{"usage":{"input_tokens":50}}}`,
		"content_block_start", `{"index":0,"content_block":{"type":"thinking"}}`,
		"content_block_delta", `{"delta":{"type":"thinking_delta","thinking":"Let me "}}`,
		"content_block_delta", `{"delta":{"type":"thinking_delta","thinking":"think..."}}`,
		"content_block_stop", `{"index":0}`,
		"content_block_start", `{"index":1,"content_block":{"type":"text"}}`,
		"content_block_delta", `{"delta":{"type":"text_delta","text":"Here is my answer."}}`,
		"content_block_stop", `{"index":1}`,
		"message_delta", `{"delta":{"stop_reason":"end_turn"}}`,
		"message_stop", `{}`,
	)

	c := &Client{}
	ch := make(chan provider.StreamEvent, 64)
	go c.processStream(context.Background(), body, ch)

	events := collectEvents(ch)

	var thinkingParts []string
	var textParts []string
	for _, ev := range events {
		if ev.Type == provider.EventThinkingDelta {
			thinkingParts = append(thinkingParts, ev.Thinking)
		}
		if ev.Type == provider.EventTextDelta {
			textParts = append(textParts, ev.Text)
		}
	}

	assert.Equal(t, []string{"Let me ", "think..."}, thinkingParts)
	assert.Equal(t, []string{"Here is my answer."}, textParts)
}

func TestProcessStream_MultipleToolCalls(t *testing.T) {
	body := sseFixture(
		"message_start", `{"message":{"usage":{"input_tokens":200}}}`,
		// Tool 1
		"content_block_start", `{"index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"Glob"}}`,
		"content_block_delta", `{"delta":{"type":"input_json_delta","partial_json":"{\"pattern\":\"*.go\"}"}}`,
		"content_block_stop", `{"index":0}`,
		// Tool 2
		"content_block_start", `{"index":1,"content_block":{"type":"tool_use","id":"tu_2","name":"Grep"}}`,
		"content_block_delta", `{"delta":{"type":"input_json_delta","partial_json":"{\"pattern\":\"func main\"}"}}`,
		"content_block_stop", `{"index":1}`,
		"message_delta", `{"delta":{"stop_reason":"tool_use"}}`,
		"message_stop", `{}`,
	)

	c := &Client{}
	ch := make(chan provider.StreamEvent, 64)
	go c.processStream(context.Background(), body, ch)

	events := collectEvents(ch)

	var toolEnds []*provider.ToolUseBlock
	for _, ev := range events {
		if ev.Type == provider.EventToolUseEnd {
			toolEnds = append(toolEnds, ev.ToolUse)
		}
	}

	require.Len(t, toolEnds, 2)
	assert.Equal(t, "tu_1", toolEnds[0].ID)
	assert.Equal(t, "Glob", toolEnds[0].Name)
	assert.Equal(t, "tu_2", toolEnds[1].ID)
	assert.Equal(t, "Grep", toolEnds[1].Name)
}

func TestProcessStream_Error(t *testing.T) {
	body := sseFixture(
		"error", `{"error":{"type":"overloaded_error","message":"API is overloaded"}}`,
	)

	c := &Client{}
	ch := make(chan provider.StreamEvent, 64)
	go c.processStream(context.Background(), body, ch)

	events := collectEvents(ch)

	var errEvent *provider.StreamEvent
	for i, ev := range events {
		if ev.Type == provider.EventError {
			errEvent = &events[i]
		}
	}

	require.NotNil(t, errEvent)
	assert.Contains(t, errEvent.Error.Error(), "overloaded_error")
	assert.Contains(t, errEvent.Error.Error(), "API is overloaded")
}

func TestProcessStream_ContextCancellation(t *testing.T) {
	// Create a long stream that won't finish naturally
	var sb strings.Builder
	sb.WriteString("event: message_start\n")
	sb.WriteString(`data: {"message":{"usage":{"input_tokens":10}}}` + "\n\n")
	for i := 0; i < 1000; i++ {
		sb.WriteString("event: content_block_delta\n")
		sb.WriteString(`data: {"delta":{"type":"text_delta","text":"chunk "}}` + "\n\n")
	}
	body := io.NopCloser(strings.NewReader(sb.String()))

	ctx, cancel := context.WithCancel(context.Background())

	c := &Client{}
	ch := make(chan provider.StreamEvent, 64)
	go c.processStream(ctx, body, ch)

	// Read a few events then cancel
	count := 0
	for range ch {
		count++
		if count >= 3 {
			cancel()
			break
		}
	}

	// Drain remaining events
	for range ch {
	}

	assert.GreaterOrEqual(t, count, 3)
}

func TestProcessStream_Ping(t *testing.T) {
	body := sseFixture(
		"ping", `{}`,
		"message_start", `{"message":{"usage":{"input_tokens":5}}}`,
		"content_block_delta", `{"delta":{"type":"text_delta","text":"hi"}}`,
		"message_stop", `{}`,
	)

	c := &Client{}
	ch := make(chan provider.StreamEvent, 64)
	go c.processStream(context.Background(), body, ch)

	events := collectEvents(ch)

	// Ping should be ignored, no error events
	for _, ev := range events {
		assert.NotEqual(t, provider.EventError, ev.Type, "ping should not cause errors")
	}

	// Should still have text
	var hasText bool
	for _, ev := range events {
		if ev.Type == provider.EventTextDelta {
			hasText = true
		}
	}
	assert.True(t, hasText)
}

func TestProcessStream_EmptyToolInput(t *testing.T) {
	// Some tools have no input (e.g., a tool that takes no arguments)
	body := sseFixture(
		"message_start", `{"message":{"usage":{"input_tokens":10}}}`,
		"content_block_start", `{"index":0,"content_block":{"type":"tool_use","id":"tu_empty","name":"ListFiles"}}`,
		"content_block_stop", `{"index":0}`,
		"message_delta", `{"delta":{"stop_reason":"tool_use"}}`,
		"message_stop", `{}`,
	)

	c := &Client{}
	ch := make(chan provider.StreamEvent, 64)
	go c.processStream(context.Background(), body, ch)

	events := collectEvents(ch)

	var toolEnd *provider.ToolUseBlock
	for _, ev := range events {
		if ev.Type == provider.EventToolUseEnd {
			toolEnd = ev.ToolUse
		}
	}

	require.NotNil(t, toolEnd)
	assert.Equal(t, "tu_empty", toolEnd.ID)
	// Empty input should default to "{}"
	assert.JSONEq(t, `{}`, string(toolEnd.Input))
}

func TestProcessStream_UsageTracking(t *testing.T) {
	body := sseFixture(
		"message_start", `{"message":{"usage":{"input_tokens":150,"cache_read_input_tokens":50}}}`,
		"content_block_delta", `{"delta":{"type":"text_delta","text":"hi"}}`,
		"message_delta", `{"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":25}}`,
		"message_stop", `{}`,
	)

	c := &Client{}
	ch := make(chan provider.StreamEvent, 64)
	go c.processStream(context.Background(), body, ch)

	events := collectEvents(ch)

	// Check message_start usage
	for _, ev := range events {
		if ev.Type == provider.EventMessageStart && ev.Usage != nil {
			assert.Equal(t, 150, ev.Usage.InputTokens)
			assert.Equal(t, 50, ev.Usage.CacheReadInputTokens)
		}
	}

	// Check message_delta usage
	for _, ev := range events {
		if ev.Type == provider.EventMessageDelta && ev.Usage != nil {
			assert.Equal(t, 25, ev.Usage.OutputTokens)
		}
	}
}
