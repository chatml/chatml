// Package loop implements the native Go agentic loop that replaces the
// agent-runner child process. It uses the provider package for LLM API calls
// and emits the same AgentEvent types as the existing Process implementation,
// ensuring zero changes to the WebSocket hub, frontend, and all downstream code.
package loop

import (
	"encoding/json"
	"log"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-core/provider"
)

// Event type constants matching the agent-runner's stdout JSON protocol.
// These MUST match the values in agent/parser.go EventType* constants.
const (
	eventReady           = "ready"
	eventAssistantText   = "assistant_text"
	eventThinking        = "thinking"
	eventToolStart       = "tool_start"
	eventToolEnd         = "tool_end"
	eventResult          = "result"
	eventComplete        = "complete"
	eventTurnComplete    = "turn_complete"
	eventError           = "error"
	eventSessionStarted  = "session_started"
	eventPermissionMode      = "permission_mode_changed"
	eventContextUsage        = "context_usage"
	eventToolApprovalRequest = "tool_approval_request"
	eventContextWarning      = "context_warning"
)

// emitter wraps a channel and provides helper methods for emitting AgentEvent types
// as JSON strings, matching the format that handleConversationOutput expects.
type emitter struct {
	ch chan<- string
}

// emit serializes an AgentEvent to JSON and sends it on the output channel.
// Uses a non-blocking send: if the channel is full (1024 buffer exhausted),
// the event is dropped with a warning log rather than blocking the agentic loop.
// This prevents a slow WebSocket consumer from stalling tool execution.
func (e *emitter) emit(event *agent.AgentEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		// Should never happen with our well-typed events, but use json.Marshal
		// to safely escape the error message (fmt.Sprintf would produce invalid
		// JSON if the error contains quotes or backslashes).
		if errJSON, jsonErr := json.Marshal(map[string]string{
			"type":    "error",
			"message": "failed to marshal event: " + err.Error(),
		}); jsonErr == nil {
			select {
			case e.ch <- string(errJSON):
			default:
			}
		}
		return
	}
	select {
	case e.ch <- string(data):
	default:
		log.Printf("warning: output channel full, dropping event type=%s", event.Type)
	}
}

// emitReady signals that the runner is initialized and ready to accept messages.
func (e *emitter) emitReady(model, cwd string) {
	e.emit(&agent.AgentEvent{
		Type:  eventReady,
		Model: model,
		Cwd:   cwd,
	})
}

// emitSessionStarted signals the session has started or resumed.
func (e *emitter) emitSessionStarted(sessionID, source string) {
	e.emit(&agent.AgentEvent{
		Type:      eventSessionStarted,
		SessionID: sessionID,
		Source:    source,
	})
}

// emitAssistantText streams a chunk of assistant text content.
func (e *emitter) emitAssistantText(text string) {
	e.emit(&agent.AgentEvent{
		Type:    eventAssistantText,
		Content: text,
	})
}

// emitThinking streams a chunk of thinking content.
func (e *emitter) emitThinking(text string) {
	e.emit(&agent.AgentEvent{
		Type:    eventThinking,
		Content: text,
	})
}

// emitToolStart signals the beginning of a tool execution.
func (e *emitter) emitToolStart(toolUseID, toolName string, params map[string]interface{}) {
	e.emit(&agent.AgentEvent{
		Type:   eventToolStart,
		ID:     toolUseID,
		Tool:   toolName,
		Params: params,
	})
}

// emitToolEnd signals the completion of a tool execution.
func (e *emitter) emitToolEnd(toolUseID, toolName string, success bool, summary string, params map[string]interface{}) {
	e.emit(&agent.AgentEvent{
		Type:    eventToolEnd,
		ID:      toolUseID,
		Tool:    toolName,
		Success: success,
		Summary: summary,
		Params:  params,
	})
}

// emitResult signals the end of a turn with usage stats.
func (e *emitter) emitResult(usage *provider.Usage, cost float64, turns int) {
	usageMap := map[string]interface{}{}
	if usage != nil {
		usageMap["input_tokens"] = usage.InputTokens
		usageMap["output_tokens"] = usage.OutputTokens
		if usage.CacheReadInputTokens > 0 {
			usageMap["cache_read_input_tokens"] = usage.CacheReadInputTokens
		}
		if usage.CacheCreationInputTokens > 0 {
			usageMap["cache_creation_input_tokens"] = usage.CacheCreationInputTokens
		}
	}
	e.emit(&agent.AgentEvent{
		Type:  eventResult,
		Cost:  cost,
		Turns: turns,
		Usage: usageMap,
	})
}

// emitTurnComplete signals the end of a conversation turn (agent is idle, waiting for user input).
func (e *emitter) emitTurnComplete() {
	e.emit(&agent.AgentEvent{
		Type: eventTurnComplete,
	})
}

// emitComplete signals the end of the entire conversation.
func (e *emitter) emitComplete() {
	e.emit(&agent.AgentEvent{
		Type: eventComplete,
	})
}

// emitError signals an error.
func (e *emitter) emitError(message string) {
	e.emit(&agent.AgentEvent{
		Type:    eventError,
		Message: message,
	})
}

// emitContextUsage reports current context window usage.
func (e *emitter) emitContextUsage(inputTokens, outputTokens, contextWindow, cumulativeTokens int) {
	e.emit(&agent.AgentEvent{
		Type:             eventContextUsage,
		InputTokens:     inputTokens,
		OutputTokens:    outputTokens,
		ContextWindow:   contextWindow,
		CumulativeTokens: cumulativeTokens,
	})
}

// emitToolApprovalRequest asks the user to approve a tool execution.
// Emits the same event shape that the frontend's useWebSocket.ts expects.
func (e *emitter) emitToolApprovalRequest(requestID, toolName string, toolInput interface{}, specifier string) {
	e.emit(&agent.AgentEvent{
		Type:      eventToolApprovalRequest,
		RequestID: requestID,
		ToolName:  toolName,
		ToolInput: toolInput,
		Specifier: specifier,
	})
}

// emitPermissionModeChanged signals a change in permission mode.
func (e *emitter) emitPermissionModeChanged(mode string) {
	e.emit(&agent.AgentEvent{
		Type: eventPermissionMode,
		Mode: mode,
	})
}

// emitContextWarning warns the user that the context window is filling up.
func (e *emitter) emitContextWarning(message string) {
	e.emit(&agent.AgentEvent{
		Type:    eventContextWarning,
		Message: message,
	})
}
