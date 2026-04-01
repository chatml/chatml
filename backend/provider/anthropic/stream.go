package anthropic

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"strings"

	"github.com/chatml/chatml-backend/provider"
)

// Anthropic SSE event types from the Messages API streaming format.
// See: https://docs.anthropic.com/en/api/messages-streaming
const (
	sseMessageStart      = "message_start"
	sseContentBlockStart = "content_block_start"
	sseContentBlockDelta = "content_block_delta"
	sseContentBlockStop  = "content_block_stop"
	sseMessageDelta      = "message_delta"
	sseMessageStop       = "message_stop"
	ssePing              = "ping"
	sseError             = "error"
)

// processStream reads the SSE stream from the Anthropic API response body,
// parses each event, and emits unified provider.StreamEvent values on ch.
// It always closes both ch and body when done.
func (c *Client) processStream(ctx context.Context, body io.ReadCloser, ch chan<- provider.StreamEvent) {
	defer close(ch)
	defer body.Close()

	scanner := bufio.NewScanner(body)
	// SSE events can have large data payloads (tool inputs)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var eventType string
	// Track current tool block for accumulating input deltas
	var currentToolID string
	var currentToolName string
	var inputAccumulator strings.Builder

	for scanner.Scan() {
		line := scanner.Text()

		// Check for context cancellation
		select {
		case <-ctx.Done():
			ch <- provider.StreamEvent{Type: provider.EventError, Error: ctx.Err()}
			return
		default:
		}

		// SSE format: "event: <type>" followed by "data: <json>"
		if strings.HasPrefix(line, "event: ") {
			eventType = strings.TrimPrefix(line, "event: ")
			continue
		}

		if !strings.HasPrefix(line, "data: ") {
			continue // Skip empty lines and comments
		}

		data := strings.TrimPrefix(line, "data: ")

		switch eventType {
		case ssePing:
			// Ignore keepalive pings

		case sseMessageStart:
			var msg struct {
				Message struct {
					Usage *provider.Usage `json:"usage"`
				} `json:"message"`
			}
			if err := json.Unmarshal([]byte(data), &msg); err == nil {
				ch <- provider.StreamEvent{
					Type:  provider.EventMessageStart,
					Usage: msg.Message.Usage,
				}
			}

		case sseContentBlockStart:
			var block struct {
				Index        int `json:"index"`
				ContentBlock struct {
					Type string `json:"type"`
					ID   string `json:"id,omitempty"`
					Name string `json:"name,omitempty"`
				} `json:"content_block"`
			}
			if err := json.Unmarshal([]byte(data), &block); err != nil {
				continue
			}

			switch block.ContentBlock.Type {
			case "tool_use":
				currentToolID = block.ContentBlock.ID
				currentToolName = block.ContentBlock.Name
				inputAccumulator.Reset()
				ch <- provider.StreamEvent{
					Type: provider.EventToolUseStart,
					ToolUse: &provider.ToolUseBlock{
						ID:   currentToolID,
						Name: currentToolName,
					},
				}
			// text and thinking blocks start implicitly with deltas
			}

		case sseContentBlockDelta:
			var delta struct {
				Delta struct {
					Type     string `json:"type"`
					Text     string `json:"text,omitempty"`
					Thinking string `json:"thinking,omitempty"`
					PartialJSON string `json:"partial_json,omitempty"`
				} `json:"delta"`
			}
			if err := json.Unmarshal([]byte(data), &delta); err != nil {
				continue
			}

			switch delta.Delta.Type {
			case "text_delta":
				ch <- provider.StreamEvent{
					Type: provider.EventTextDelta,
					Text: delta.Delta.Text,
				}
			case "thinking_delta":
				ch <- provider.StreamEvent{
					Type:     provider.EventThinkingDelta,
					Thinking: delta.Delta.Thinking,
				}
			case "input_json_delta":
				inputAccumulator.WriteString(delta.Delta.PartialJSON)
				ch <- provider.StreamEvent{
					Type:       provider.EventToolUseInputDelta,
					InputDelta: delta.Delta.PartialJSON,
				}
			}

		case sseContentBlockStop:
			// If we were accumulating tool input, emit the complete tool block
			if currentToolID != "" {
				inputJSON := inputAccumulator.String()
				if inputJSON == "" {
					inputJSON = "{}"
				}
				ch <- provider.StreamEvent{
					Type: provider.EventToolUseEnd,
					ToolUse: &provider.ToolUseBlock{
						ID:    currentToolID,
						Name:  currentToolName,
						Input: json.RawMessage(inputJSON),
					},
				}
				currentToolID = ""
				currentToolName = ""
				inputAccumulator.Reset()
			}
			ch <- provider.StreamEvent{Type: provider.EventContentBlockStop}

		case sseMessageDelta:
			var delta struct {
				Delta struct {
					StopReason string `json:"stop_reason,omitempty"`
				} `json:"delta"`
				Usage *provider.Usage `json:"usage,omitempty"`
			}
			if err := json.Unmarshal([]byte(data), &delta); err == nil {
				ch <- provider.StreamEvent{
					Type:       provider.EventMessageDelta,
					StopReason: delta.Delta.StopReason,
					Usage:      delta.Usage,
				}
			}

		case sseMessageStop:
			ch <- provider.StreamEvent{Type: provider.EventMessageStop}

		case sseError:
			var errResp struct {
				Error struct {
					Type    string `json:"type"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal([]byte(data), &errResp); err == nil {
				ch <- provider.StreamEvent{
					Type:  provider.EventError,
					Error: &APIError{Type: errResp.Error.Type, Message: errResp.Error.Message},
				}
			}
		}

		eventType = "" // Reset for next event
	}

	if err := scanner.Err(); err != nil {
		ch <- provider.StreamEvent{Type: provider.EventError, Error: err}
	}
}

// APIError represents an error from the Anthropic API.
type APIError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

func (e *APIError) Error() string {
	return "anthropic: " + e.Type + ": " + e.Message
}
