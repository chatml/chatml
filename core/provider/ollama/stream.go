package ollama

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/chatml/chatml-core/provider"
)

const streamIdleTimeout = 5 * time.Minute // Local inference can be slow on CPU

// Ollama NDJSON streaming format for /api/chat.
// Each line is a complete JSON object.
type chatResponse struct {
	Model     string       `json:"model"`
	CreatedAt string       `json:"created_at"`
	Message   chatMessage  `json:"message"`
	Done      bool         `json:"done"`
	DoneReason string      `json:"done_reason,omitempty"` // "stop", "length", "load", "unload"

	// Final response includes usage stats
	TotalDuration      int64 `json:"total_duration,omitempty"`
	LoadDuration       int64 `json:"load_duration,omitempty"`
	PromptEvalCount    int   `json:"prompt_eval_count,omitempty"`
	PromptEvalDuration int64 `json:"prompt_eval_duration,omitempty"`
	EvalCount          int   `json:"eval_count,omitempty"`
	EvalDuration       int64 `json:"eval_duration,omitempty"`

	// Error from Ollama
	Error string `json:"error,omitempty"`
}

type chatMessage struct {
	Role      string     `json:"role"`
	Content   string     `json:"content"`
	ToolCalls []toolCall `json:"tool_calls,omitempty"`
}

type toolCall struct {
	Function toolCallFunction `json:"function"`
}

type toolCallFunction struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

// processStream reads Ollama's NDJSON chat stream and emits unified provider.StreamEvents.
func processStream(ctx context.Context, body io.ReadCloser, ch chan<- provider.StreamEvent) {
	defer close(ch)
	defer body.Close()

	decoder := json.NewDecoder(body)
	emittedStart := false
	toolCallCounter := 0
	// Unique prefix per stream to prevent tool-call ID collisions across turns.
	streamEpoch := time.Now().UnixNano()

	// Decoder goroutine — reads from the HTTP body in a separate goroutine so
	// the main select can enforce an idle timeout and context cancellation.
	//
	// Goroutine lifecycle: the goroutine blocks on decoder.Decode() which reads
	// from body. On context cancellation, processStream returns and the deferred
	// body.Close() fires, unblocking the Decode. The goroutine then either sends
	// the error on results (buffer=1) or sees ctx.Done() and exits. The brief
	// interval between ctx cancel and body close is acceptable — no resources
	// leak because close(results) happens in the goroutine's defer.
	type decodeResult struct {
		resp chatResponse
		err  error
	}
	results := make(chan decodeResult, 1)
	go func() {
		defer close(results)
		for {
			var resp chatResponse
			if err := decoder.Decode(&resp); err != nil {
				if err != io.EOF {
					select {
					case results <- decodeResult{err: err}:
					case <-ctx.Done():
					}
				}
				return
			}
			select {
			case results <- decodeResult{resp: resp}:
			case <-ctx.Done():
				return
			}
		}
	}()

	idleTimer := time.NewTimer(streamIdleTimeout)
	defer idleTimer.Stop()

	for {
		select {
		case dr, open := <-results:
			if !open {
				// Stream finished
				return
			}
			if !idleTimer.Stop() {
				select {
				case <-idleTimer.C:
				default:
				}
			}
			idleTimer.Reset(streamIdleTimeout)

			if dr.err != nil {
				ch <- provider.StreamEvent{
					Type:  provider.EventError,
					Error: fmt.Errorf("ollama stream decode: %w", dr.err),
				}
				return
			}

			resp := dr.resp

			// Check for error from Ollama
			if resp.Error != "" {
				ch <- provider.StreamEvent{
					Type:  provider.EventError,
					Error: fmt.Errorf("ollama: %s", resp.Error),
				}
				return
			}

			// Emit message start on first chunk
			if !emittedStart {
				emittedStart = true
				ch <- provider.StreamEvent{Type: provider.EventMessageStart}
			}

			// Text content
			if resp.Message.Content != "" {
				ch <- provider.StreamEvent{
					Type: provider.EventTextDelta,
					Text: resp.Message.Content,
				}
			}

			// Tool calls — Ollama sends complete tool calls (not deltas) in the message
			for _, tc := range resp.Message.ToolCalls {
				toolCallCounter++
				toolID := fmt.Sprintf("ollama_tc_%d_%d", streamEpoch, toolCallCounter)

				// Emit start
				ch <- provider.StreamEvent{
					Type: provider.EventToolUseStart,
					ToolUse: &provider.ToolUseBlock{
						ID:   toolID,
						Name: tc.Function.Name,
					},
				}

				// Emit complete input
				args := tc.Function.Arguments
				if len(args) == 0 {
					args = json.RawMessage("{}")
				}
				ch <- provider.StreamEvent{
					Type:       provider.EventToolUseInputDelta,
					InputDelta: string(args),
				}

				// Emit end with complete block
				ch <- provider.StreamEvent{
					Type: provider.EventToolUseEnd,
					ToolUse: &provider.ToolUseBlock{
						ID:    toolID,
						Name:  tc.Function.Name,
						Input: args,
					},
				}
			}

			// Done — final chunk with usage stats
			if resp.Done {
				// Map stop reason
				stopReason := "end_turn"
				switch resp.DoneReason {
				case "length":
					stopReason = "max_tokens"
				case "stop", "":
					stopReason = "end_turn"
				}

				// If we had tool calls, the stop reason is tool_use
				if toolCallCounter > 0 {
					stopReason = "tool_use"
				}

				ch <- provider.StreamEvent{
					Type:       provider.EventMessageDelta,
					StopReason: stopReason,
					Usage: &provider.Usage{
						InputTokens:  resp.PromptEvalCount,
						OutputTokens: resp.EvalCount,
					},
				}
				ch <- provider.StreamEvent{Type: provider.EventMessageStop}
				return
			}

		case <-idleTimer.C:
			ch <- provider.StreamEvent{
				Type:  provider.EventError,
				Error: fmt.Errorf("ollama stream idle timeout: no data for %s", streamIdleTimeout),
			}
			return

		case <-ctx.Done():
			ch <- provider.StreamEvent{Type: provider.EventError, Error: ctx.Err()}
			return
		}
	}
}
