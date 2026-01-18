package agent

import (
	"encoding/json"
	"fmt"
	"strings"
)

// StreamEvent represents a parsed event from claude --output-format stream-json
type StreamEvent struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	Raw     string `json:"-"`
}

// ClaudeStreamMessage represents the JSON structure from claude CLI
type ClaudeStreamMessage struct {
	Type         string        `json:"type"`
	Subtype      string        `json:"subtype,omitempty"`
	Message      *MessageBlock `json:"message,omitempty"`
	ContentBlock *ContentBlock `json:"content_block,omitempty"`
	Delta        *DeltaBlock   `json:"delta,omitempty"`
	Index        int           `json:"index,omitempty"`
}

type MessageBlock struct {
	Role    string         `json:"role,omitempty"`
	Content []ContentBlock `json:"content,omitempty"`
}

type ContentBlock struct {
	Type      string      `json:"type"`
	Text      string      `json:"text,omitempty"`
	ID        string      `json:"id,omitempty"`
	Name      string      `json:"name,omitempty"`
	Input     interface{} `json:"input,omitempty"`
	Thinking  string      `json:"thinking,omitempty"`
	ToolUseID string      `json:"tool_use_id,omitempty"`
	Content   string      `json:"content,omitempty"`
}

type DeltaBlock struct {
	Type         string `json:"type,omitempty"`
	Text         string `json:"text,omitempty"`
	Thinking     string `json:"thinking,omitempty"`
	PartialJSON  string `json:"partial_json,omitempty"`
	StopReason   string `json:"stop_reason,omitempty"`
}

// ParseStreamLine parses a line of stream-json output and returns a formatted event
func ParseStreamLine(line string) StreamEvent {
	line = strings.TrimSpace(line)
	if line == "" {
		return StreamEvent{}
	}

	var msg ClaudeStreamMessage
	if err := json.Unmarshal([]byte(line), &msg); err != nil {
		// Not JSON, return as plain text
		return StreamEvent{
			Type:    "text",
			Message: line,
			Raw:     line,
		}
	}

	event := StreamEvent{Raw: line}

	switch msg.Type {
	case "message_start":
		event.Type = "status"
		event.Message = "Starting..."

	case "content_block_start":
		if msg.ContentBlock != nil {
			switch msg.ContentBlock.Type {
			case "thinking":
				event.Type = "thinking"
				event.Message = "Thinking..."
			case "tool_use":
				event.Type = "tool_start"
				event.Message = fmt.Sprintf("Using tool: %s", msg.ContentBlock.Name)
			case "text":
				event.Type = "text_start"
				event.Message = ""
			}
		}

	case "content_block_delta":
		if msg.Delta != nil {
			switch msg.Delta.Type {
			case "thinking_delta":
				event.Type = "thinking"
				event.Message = msg.Delta.Thinking
			case "text_delta":
				event.Type = "text"
				event.Message = msg.Delta.Text
			case "input_json_delta":
				event.Type = "tool_input"
				event.Message = msg.Delta.PartialJSON
			}
		}

	case "content_block_stop":
		event.Type = "block_done"
		event.Message = ""

	case "message_delta":
		if msg.Delta != nil && msg.Delta.StopReason != "" {
			event.Type = "status"
			event.Message = fmt.Sprintf("Stop reason: %s", msg.Delta.StopReason)
		}

	case "message_stop":
		event.Type = "done"
		event.Message = "Completed"

	case "assistant":
		// Tool results or assistant messages
		if msg.Message != nil && len(msg.Message.Content) > 0 {
			for _, c := range msg.Message.Content {
				if c.Type == "tool_result" {
					event.Type = "tool_result"
					event.Message = fmt.Sprintf("Tool result for %s", c.ToolUseID)
				}
			}
		}

	case "result":
		event.Type = "result"
		event.Message = "Task completed"

	default:
		// Pass through unknown types
		event.Type = msg.Type
		if event.Type == "" {
			event.Type = "unknown"
		}
		event.Message = line
	}

	return event
}

// FormatEvent formats a StreamEvent for display
func FormatEvent(event StreamEvent) string {
	switch event.Type {
	case "thinking":
		if event.Message != "" {
			return fmt.Sprintf("💭 %s", event.Message)
		}
		return ""
	case "tool_start":
		return fmt.Sprintf("🔧 %s", event.Message)
	case "tool_input":
		return "" // Skip partial JSON
	case "tool_result":
		return fmt.Sprintf("✓ %s", event.Message)
	case "text":
		return event.Message
	case "status":
		return fmt.Sprintf("⏳ %s", event.Message)
	case "done", "result":
		return fmt.Sprintf("✅ %s", event.Message)
	case "block_done", "text_start":
		return ""
	default:
		if event.Message != "" && !strings.HasPrefix(event.Message, "{") {
			return event.Message
		}
		return ""
	}
}
