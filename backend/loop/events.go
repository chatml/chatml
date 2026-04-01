// Package loop implements the native Go agentic loop that replaces the
// agent-runner child process. It uses the provider package for LLM API calls
// and emits the same AgentEvent types as the existing Process implementation,
// ensuring zero changes to the WebSocket hub, frontend, and all downstream code.
package loop

import (
	"encoding/json"
	"fmt"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/provider"
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
)

// emitter wraps a channel and provides helper methods for emitting AgentEvent types
// as JSON strings, matching the format that handleConversationOutput expects.
type emitter struct {
	ch chan<- string
}

// emit serializes an AgentEvent to JSON and sends it on the output channel.
// This mirrors how the agent-runner emits events on stdout.
func (e *emitter) emit(event *agent.AgentEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		// Should never happen with our well-typed events
		e.ch <- fmt.Sprintf(`{"type":"error","message":"failed to marshal event: %s"}`, err.Error())
		return
	}
	e.ch <- string(data)
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
func (e *emitter) emitToolEnd(toolUseID, toolName string, success bool, summary string) {
	e.emit(&agent.AgentEvent{
		Type:    eventToolEnd,
		ID:      toolUseID,
		Tool:    toolName,
		Success: success,
		Summary: summary,
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
func (e *emitter) emitContextUsage(inputTokens, outputTokens, contextWindow int) {
	e.emit(&agent.AgentEvent{
		Type:          eventContextUsage,
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		ContextWindow: contextWindow,
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
