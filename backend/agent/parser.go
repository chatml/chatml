package agent

import (
	"encoding/json"
	"strings"
)

// AgentEvent represents a parsed event from the agent-runner stdout
type AgentEvent struct {
	Type           string                 `json:"type"`
	ConversationID string                 `json:"conversationId,omitempty"`
	Content        string                 `json:"content,omitempty"`
	ID             string                 `json:"id,omitempty"`
	Tool           string                 `json:"tool,omitempty"`
	Params         map[string]interface{} `json:"params,omitempty"`
	Success        bool                   `json:"success,omitempty"`
	Summary        string                 `json:"summary,omitempty"`
	Duration       int64                  `json:"duration,omitempty"`
	Name           string                 `json:"name,omitempty"`
	Message        string                 `json:"message,omitempty"`
	Model          string                 `json:"model,omitempty"`
	Tools          []string               `json:"tools,omitempty"`
	Cwd            string                 `json:"cwd,omitempty"`
	Reason         string                 `json:"reason,omitempty"`
	Subtype        string                 `json:"subtype,omitempty"`
	Errors         []string               `json:"errors,omitempty"`
	Cost           float64                `json:"cost,omitempty"`
	Turns          int                    `json:"turns,omitempty"`
	Todos          []TodoItem             `json:"todos,omitempty"`
	Raw            string                 `json:"-"`
}

// Event types from the agent-runner
const (
	EventTypeReady          = "ready"
	EventTypeInit           = "init"
	EventTypeAssistantText  = "assistant_text"
	EventTypeToolStart      = "tool_start"
	EventTypeToolEnd        = "tool_end"
	EventTypeNameSuggestion = "name_suggestion"
	EventTypeTodoUpdate     = "todo_update"
	EventTypeResult         = "result"
	EventTypeComplete       = "complete"
	EventTypeError          = "error"
	EventTypeShutdown       = "shutdown"
)

// TodoItem represents a single todo item from the agent's TodoWrite tool
type TodoItem struct {
	Content    string `json:"content"`
	Status     string `json:"status"`     // "pending", "in_progress", "completed"
	ActiveForm string `json:"activeForm"`
}

// ParseAgentLine parses a line of JSON output from the agent-runner
func ParseAgentLine(line string) *AgentEvent {
	line = strings.TrimSpace(line)
	if line == "" {
		return nil
	}

	// Handle stderr prefix
	if strings.HasPrefix(line, "[stderr] ") {
		return &AgentEvent{
			Type:    "stderr",
			Message: strings.TrimPrefix(line, "[stderr] "),
			Raw:     line,
		}
	}

	var event AgentEvent
	if err := json.Unmarshal([]byte(line), &event); err != nil {
		// Not JSON, return as plain text
		return &AgentEvent{
			Type:    "text",
			Content: line,
			Raw:     line,
		}
	}

	event.Raw = line
	return &event
}

// IsTextEvent returns true if the event contains text to display
func (e *AgentEvent) IsTextEvent() bool {
	return e.Type == EventTypeAssistantText
}

// IsToolEvent returns true if the event is tool-related
func (e *AgentEvent) IsToolEvent() bool {
	return e.Type == EventTypeToolStart || e.Type == EventTypeToolEnd
}

// IsTerminalEvent returns true if the event signals end of processing
func (e *AgentEvent) IsTerminalEvent() bool {
	return e.Type == EventTypeComplete || e.Type == EventTypeResult ||
		e.Type == EventTypeError || e.Type == EventTypeShutdown
}

// Legacy types for backwards compatibility with existing code
// These can be removed once the frontend is updated

// StreamEvent is kept for backwards compatibility
type StreamEvent struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	Raw     string `json:"-"`
}

// ParseStreamLine parses a line and returns a legacy StreamEvent
// Deprecated: Use ParseAgentLine instead
func ParseStreamLine(line string) StreamEvent {
	event := ParseAgentLine(line)
	if event == nil {
		return StreamEvent{}
	}

	// Convert to legacy format
	legacy := StreamEvent{
		Raw: event.Raw,
	}

	switch event.Type {
	case EventTypeAssistantText:
		legacy.Type = "text"
		legacy.Message = event.Content
	case EventTypeToolStart:
		legacy.Type = "tool_start"
		legacy.Message = event.Tool
	case EventTypeToolEnd:
		legacy.Type = "tool_result"
		legacy.Message = event.Summary
	case EventTypeNameSuggestion:
		legacy.Type = "name_suggestion"
		legacy.Message = event.Name
	case EventTypeComplete, EventTypeResult:
		legacy.Type = "done"
		legacy.Message = "Completed"
	case EventTypeError:
		legacy.Type = "error"
		legacy.Message = event.Message
	default:
		legacy.Type = event.Type
		legacy.Message = event.Content
		if legacy.Message == "" {
			legacy.Message = event.Message
		}
	}

	return legacy
}

// FormatEvent formats a StreamEvent for display
// Deprecated: Direct event handling is preferred
func FormatEvent(event StreamEvent) string {
	switch event.Type {
	case "text":
		return event.Message
	case "tool_start":
		return "🔧 Using: " + event.Message
	case "tool_result":
		return "✓ " + event.Message
	case "name_suggestion":
		return "" // Don't display, just update state
	case "done":
		return "✅ " + event.Message
	case "error":
		return "❌ " + event.Message
	default:
		if event.Message != "" && !strings.HasPrefix(event.Message, "{") {
			return event.Message
		}
		return ""
	}
}
