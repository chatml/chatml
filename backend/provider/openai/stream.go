package openai

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/chatml/chatml-backend/provider"
)

const streamIdleTimeout = 90 * time.Second

// OpenAI streaming chunk format (SSE with "data: {json}" lines).
// Each chunk is a ChatCompletionChunk with delta objects.
type streamChunk struct {
	ID      string         `json:"id"`
	Choices []streamChoice `json:"choices"`
	Usage   *chunkUsage    `json:"usage,omitempty"`
}

type streamChoice struct {
	Index        int         `json:"index"`
	Delta        streamDelta `json:"delta"`
	FinishReason *string     `json:"finish_reason"`
}

type streamDelta struct {
	Role      string              `json:"role,omitempty"`
	Content   *string             `json:"content,omitempty"`
	ToolCalls []streamToolCallDelta `json:"tool_calls,omitempty"`
}

type streamToolCallDelta struct {
	Index    int                  `json:"index"`
	ID       string               `json:"id,omitempty"`
	Type     string               `json:"type,omitempty"`
	Function *streamFunctionDelta `json:"function,omitempty"`
}

type streamFunctionDelta struct {
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

type chunkUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// toolCallState tracks the accumulated state of a streaming tool call.
type toolCallState struct {
	id        string
	name      string
	arguments strings.Builder
}

// processStream reads OpenAI SSE stream and emits unified provider.StreamEvents.
func processStream(ctx context.Context, body io.ReadCloser, ch chan<- provider.StreamEvent) {
	defer close(ch)
	defer body.Close()

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	// Line-reading goroutine for idle watchdog
	type scanResult struct {
		line string
	}
	lines := make(chan scanResult, 1)
	go func() {
		defer close(lines)
		for scanner.Scan() {
			lines <- scanResult{line: scanner.Text()}
		}
	}()

	// Track tool call state: OpenAI sends tool calls as deltas across multiple chunks
	activeCalls := make(map[int]*toolCallState) // index → state

	idleTimer := time.NewTimer(streamIdleTimeout)
	defer idleTimer.Stop()

	emittedStart := false

	for {
		var line string
		select {
		case sr, open := <-lines:
			if !open {
				// Stream finished — emit any pending tool calls
				emitPendingToolCalls(ch, activeCalls)
				return
			}
			line = sr.line
			if !idleTimer.Stop() {
				select {
				case <-idleTimer.C:
				default:
				}
			}
			idleTimer.Reset(streamIdleTimeout)

		case <-idleTimer.C:
			ch <- provider.StreamEvent{
				Type:  provider.EventError,
				Error: fmt.Errorf("stream idle timeout: no data received for %s", streamIdleTimeout),
			}
			return

		case <-ctx.Done():
			ch <- provider.StreamEvent{Type: provider.EventError, Error: ctx.Err()}
			return
		}

		// OpenAI SSE: "data: {json}" or "data: [DONE]"
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")

		if data == "[DONE]" {
			emitPendingToolCalls(ch, activeCalls)
			ch <- provider.StreamEvent{Type: provider.EventMessageStop}
			return
		}

		var chunk streamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		// Emit message start on first chunk
		if !emittedStart {
			emittedStart = true
			ch <- provider.StreamEvent{Type: provider.EventMessageStart}
		}

		// Process usage (comes in the final chunk with stream_options.include_usage)
		if chunk.Usage != nil {
			ch <- provider.StreamEvent{
				Type: provider.EventMessageDelta,
				Usage: &provider.Usage{
					InputTokens:  chunk.Usage.PromptTokens,
					OutputTokens: chunk.Usage.CompletionTokens,
				},
			}
		}

		for _, choice := range chunk.Choices {
			// Text content delta
			if choice.Delta.Content != nil && *choice.Delta.Content != "" {
				ch <- provider.StreamEvent{
					Type: provider.EventTextDelta,
					Text: *choice.Delta.Content,
				}
			}

			// Tool call deltas
			for _, tc := range choice.Delta.ToolCalls {
				state, exists := activeCalls[tc.Index]
				if !exists {
					state = &toolCallState{}
					activeCalls[tc.Index] = state
				}

				// First chunk for this tool call: has id and name
				if tc.ID != "" {
					state.id = tc.ID
				}
				if tc.Function != nil && tc.Function.Name != "" {
					state.name = tc.Function.Name
					// Emit tool use start
					ch <- provider.StreamEvent{
						Type: provider.EventToolUseStart,
						ToolUse: &provider.ToolUseBlock{
							ID:   state.id,
							Name: state.name,
						},
					}
				}

				// Accumulate function arguments
				if tc.Function != nil && tc.Function.Arguments != "" {
					state.arguments.WriteString(tc.Function.Arguments)
					ch <- provider.StreamEvent{
						Type:       provider.EventToolUseInputDelta,
						InputDelta: tc.Function.Arguments,
					}
				}
			}

			// Finish reason
			if choice.FinishReason != nil {
				stopReason := *choice.FinishReason
				// Map OpenAI finish reasons to our format
				mapped := stopReason
				switch stopReason {
				case "stop":
					mapped = "end_turn"
				case "length":
					mapped = "max_tokens"
				case "tool_calls":
					mapped = "tool_use"
				}
				ch <- provider.StreamEvent{
					Type:       provider.EventMessageDelta,
					StopReason: mapped,
				}
			}
		}
	}
}

// emitPendingToolCalls emits EventToolUseEnd for any accumulated tool calls.
func emitPendingToolCalls(ch chan<- provider.StreamEvent, calls map[int]*toolCallState) {
	for _, state := range calls {
		if state.id == "" {
			continue
		}
		args := state.arguments.String()
		if args == "" {
			args = "{}"
		}
		ch <- provider.StreamEvent{
			Type: provider.EventToolUseEnd,
			ToolUse: &provider.ToolUseBlock{
				ID:    state.id,
				Name:  state.name,
				Input: json.RawMessage(args),
			},
		}
	}
}
