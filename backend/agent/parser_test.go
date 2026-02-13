package agent

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseAgentLine_EmptyInput(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"empty string", ""},
		{"whitespace only", "   "},
		{"newline only", "\n"},
		{"tabs and spaces", "  \t  "},
		{"whitespace with newline", "  \n  "},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ParseAgentLine(tt.input)
			assert.Nil(t, result)
		})
	}
}

func TestParseAgentLine_StderrPrefix(t *testing.T) {
	tests := []struct {
		name            string
		input           string
		expectedMessage string
	}{
		{"simple error", "[stderr] error msg", "error msg"},
		{"single char message", "[stderr] x", "x"},
		{"multiword message", "[stderr] something went wrong here", "something went wrong here"},
		{"with special chars", "[stderr] Error: file not found!", "Error: file not found!"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ParseAgentLine(tt.input)
			require.NotNil(t, result)
			assert.Equal(t, "stderr", result.Type)
			assert.Equal(t, tt.expectedMessage, result.Message)
			assert.Equal(t, tt.input, result.Raw)
		})
	}
}

func TestParseAgentLine_ValidJSON(t *testing.T) {
	tests := []struct {
		name         string
		input        string
		expectedType string
		checkFields  func(t *testing.T, event *AgentEvent)
	}{
		{
			name:         "assistant_text",
			input:        `{"type":"assistant_text","content":"Hello world"}`,
			expectedType: EventTypeAssistantText,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.Equal(t, "Hello world", event.Content)
			},
		},
		{
			name:         "tool_start",
			input:        `{"type":"tool_start","tool":"read_file","id":"tool-123"}`,
			expectedType: EventTypeToolStart,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.Equal(t, "read_file", event.Tool)
				assert.Equal(t, "tool-123", event.ID)
			},
		},
		{
			name:         "tool_end_success",
			input:        `{"type":"tool_end","success":true,"summary":"File read successfully","duration":150}`,
			expectedType: EventTypeToolEnd,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.True(t, event.Success)
				assert.Equal(t, "File read successfully", event.Summary)
				assert.Equal(t, int64(150), event.Duration)
			},
		},
		{
			name:         "tool_end_failure",
			input:        `{"type":"tool_end","success":false,"summary":"File not found"}`,
			expectedType: EventTypeToolEnd,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.False(t, event.Success)
				assert.Equal(t, "File not found", event.Summary)
			},
		},
		{
			name:         "name_suggestion",
			input:        `{"type":"name_suggestion","name":"Fix authentication bug"}`,
			expectedType: EventTypeNameSuggestion,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.Equal(t, "Fix authentication bug", event.Name)
			},
		},
		{
			name:         "todo_update",
			input:        `{"type":"todo_update","todos":[{"content":"Write tests","status":"in_progress","activeForm":"Writing tests"}]}`,
			expectedType: EventTypeTodoUpdate,
			checkFields: func(t *testing.T, event *AgentEvent) {
				require.Len(t, event.Todos, 1)
				assert.Equal(t, "Write tests", event.Todos[0].Content)
				assert.Equal(t, "in_progress", event.Todos[0].Status)
				assert.Equal(t, "Writing tests", event.Todos[0].ActiveForm)
			},
		},
		{
			name:         "complete",
			input:        `{"type":"complete"}`,
			expectedType: EventTypeComplete,
			checkFields:  func(t *testing.T, event *AgentEvent) {},
		},
		{
			name:         "result",
			input:        `{"type":"result","cost":0.05,"turns":3}`,
			expectedType: EventTypeResult,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.Equal(t, 0.05, event.Cost)
				assert.Equal(t, 3, event.Turns)
			},
		},
		{
			name:         "error",
			input:        `{"type":"error","message":"Something went wrong"}`,
			expectedType: EventTypeError,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.Equal(t, "Something went wrong", event.Message)
			},
		},
		{
			name:         "shutdown",
			input:        `{"type":"shutdown","reason":"user requested"}`,
			expectedType: EventTypeShutdown,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.Equal(t, "user requested", event.Reason)
			},
		},
		{
			name:         "ready",
			input:        `{"type":"ready"}`,
			expectedType: EventTypeReady,
			checkFields:  func(t *testing.T, event *AgentEvent) {},
		},
		{
			name:         "init",
			input:        `{"type":"init","model":"claude-3-sonnet","tools":["read","write"],"cwd":"/home/user"}`,
			expectedType: EventTypeInit,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.Equal(t, "claude-3-sonnet", event.Model)
				assert.Equal(t, []string{"read", "write"}, event.Tools)
				assert.Equal(t, "/home/user", event.Cwd)
			},
		},
		{
			name:         "with_conversation_id",
			input:        `{"type":"assistant_text","conversationId":"conv-123","content":"Hi"}`,
			expectedType: EventTypeAssistantText,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.Equal(t, "conv-123", event.ConversationID)
				assert.Equal(t, "Hi", event.Content)
			},
		},
		{
			name:         "tool_with_params",
			input:        `{"type":"tool_start","tool":"write_file","params":{"path":"test.txt","content":"hello"}}`,
			expectedType: EventTypeToolStart,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.Equal(t, "write_file", event.Tool)
				require.NotNil(t, event.Params)
				assert.Equal(t, "test.txt", event.Params["path"])
				assert.Equal(t, "hello", event.Params["content"])
			},
		},
		{
			name:         "error_with_errors_array",
			input:        `{"type":"error","message":"Multiple errors","errors":["err1","err2"]}`,
			expectedType: EventTypeError,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.Equal(t, "Multiple errors", event.Message)
				assert.Equal(t, []string{"err1", "err2"}, event.Errors)
			},
		},
		{
			name:         "json_parse_error",
			input:        `{"type":"json_parse_error","message":"Failed to parse input: Unexpected token","rawInput":"{invalid json}","errorDetails":"Unexpected token"}`,
			expectedType: EventTypeJsonParseError,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.Equal(t, "Failed to parse input: Unexpected token", event.Message)
				assert.Equal(t, "{invalid json}", event.RawInput)
				assert.Equal(t, "Unexpected token", event.ErrorDetails)
			},
		},
		{
			name:         "context_usage",
			input:        `{"type":"context_usage","inputTokens":15000,"outputTokens":3000,"cacheReadInputTokens":5000,"cacheCreationInputTokens":2000}`,
			expectedType: EventTypeContextUsage,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.Equal(t, 15000, event.InputTokens)
				assert.Equal(t, 3000, event.OutputTokens)
				assert.Equal(t, 5000, event.CacheReadInputTokens)
				assert.Equal(t, 2000, event.CacheCreationInputTokens)
			},
		},
		{
			name:         "context_window_size",
			input:        `{"type":"context_window_size","contextWindow":200000}`,
			expectedType: EventTypeContextWindowSize,
			checkFields: func(t *testing.T, event *AgentEvent) {
				assert.Equal(t, 200000, event.ContextWindow)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ParseAgentLine(tt.input)
			require.NotNil(t, result)
			assert.Equal(t, tt.expectedType, result.Type)
			assert.Equal(t, tt.input, result.Raw)
			tt.checkFields(t, result)
		})
	}
}

func TestParseAgentLine_InvalidJSON(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"plain text", "not json at all"},
		{"partial json", `{"type":`},
		{"malformed json", `{"type": "test",}`},
		{"incomplete object", `{"type": "test"`},
		{"array instead of object", `["type", "test"]`},
		{"random text with braces", "some {text} here"},
		{"stderr without space", "[stderr]msg"}, // Note: requires space after [stderr]
		{"stderr empty", "[stderr]"},            // No space, treated as text
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ParseAgentLine(tt.input)
			require.NotNil(t, result)
			assert.Equal(t, "text", result.Type)
			assert.Equal(t, tt.input, result.Content)
			assert.Equal(t, tt.input, result.Raw)
		})
	}
}

func TestAgentEvent_IsTextEvent(t *testing.T) {
	tests := []struct {
		eventType string
		expected  bool
	}{
		{EventTypeAssistantText, true},
		{EventTypeToolStart, false},
		{EventTypeToolEnd, false},
		{EventTypeComplete, false},
		{EventTypeError, false},
		{EventTypeReady, false},
		{EventTypeInit, false},
		{EventTypeNameSuggestion, false},
		{EventTypeTodoUpdate, false},
		{EventTypeResult, false},
		{EventTypeShutdown, false},
		{"text", false},
		{"stderr", false},
	}

	for _, tt := range tests {
		t.Run(tt.eventType, func(t *testing.T) {
			event := &AgentEvent{Type: tt.eventType}
			assert.Equal(t, tt.expected, event.IsTextEvent())
		})
	}
}

func TestAgentEvent_IsToolEvent(t *testing.T) {
	tests := []struct {
		eventType string
		expected  bool
	}{
		{EventTypeToolStart, true},
		{EventTypeToolEnd, true},
		{EventTypeAssistantText, false},
		{EventTypeComplete, false},
		{EventTypeError, false},
		{EventTypeReady, false},
		{EventTypeInit, false},
		{EventTypeNameSuggestion, false},
		{EventTypeTodoUpdate, false},
		{EventTypeResult, false},
		{EventTypeShutdown, false},
		{"text", false},
		{"stderr", false},
	}

	for _, tt := range tests {
		t.Run(tt.eventType, func(t *testing.T) {
			event := &AgentEvent{Type: tt.eventType}
			assert.Equal(t, tt.expected, event.IsToolEvent())
		})
	}
}

func TestAgentEvent_IsTerminalEvent(t *testing.T) {
	tests := []struct {
		eventType string
		expected  bool
	}{
		{EventTypeComplete, true},
		{EventTypeResult, true},
		{EventTypeError, true},
		{EventTypeShutdown, true},
		{EventTypeAssistantText, false},
		{EventTypeToolStart, false},
		{EventTypeToolEnd, false},
		{EventTypeReady, false},
		{EventTypeInit, false},
		{EventTypeNameSuggestion, false},
		{EventTypeTodoUpdate, false},
		{EventTypeJsonParseError, false}, // json_parse_error is NOT terminal - agent continues
		{"text", false},
		{"stderr", false},
	}

	for _, tt := range tests {
		t.Run(tt.eventType, func(t *testing.T) {
			event := &AgentEvent{Type: tt.eventType}
			assert.Equal(t, tt.expected, event.IsTerminalEvent())
		})
	}
}

func TestParseStreamLine_BackwardsCompatibility(t *testing.T) {
	tests := []struct {
		name            string
		input           string
		expectedType    string
		expectedMessage string
		expectNonEmpty  bool
	}{
		{
			name:           "empty input",
			input:          "",
			expectNonEmpty: false,
		},
		{
			name:            "assistant_text converts to text",
			input:           `{"type":"assistant_text","content":"Hello"}`,
			expectedType:    "text",
			expectedMessage: "Hello",
			expectNonEmpty:  true,
		},
		{
			name:            "tool_start keeps type",
			input:           `{"type":"tool_start","tool":"read_file"}`,
			expectedType:    "tool_start",
			expectedMessage: "read_file",
			expectNonEmpty:  true,
		},
		{
			name:            "tool_end converts to tool_result",
			input:           `{"type":"tool_end","summary":"Done"}`,
			expectedType:    "tool_result",
			expectedMessage: "Done",
			expectNonEmpty:  true,
		},
		{
			name:            "name_suggestion keeps type",
			input:           `{"type":"name_suggestion","name":"Fix bug"}`,
			expectedType:    "name_suggestion",
			expectedMessage: "Fix bug",
			expectNonEmpty:  true,
		},
		{
			name:            "complete converts to done",
			input:           `{"type":"complete"}`,
			expectedType:    "done",
			expectedMessage: "Completed",
			expectNonEmpty:  true,
		},
		{
			name:            "result converts to done",
			input:           `{"type":"result","cost":0.01}`,
			expectedType:    "done",
			expectedMessage: "Completed",
			expectNonEmpty:  true,
		},
		{
			name:            "error keeps type",
			input:           `{"type":"error","message":"oops"}`,
			expectedType:    "error",
			expectedMessage: "oops",
			expectNonEmpty:  true,
		},
		{
			name:            "unknown type passes through with content",
			input:           `{"type":"unknown","content":"data"}`,
			expectedType:    "unknown",
			expectedMessage: "data",
			expectNonEmpty:  true,
		},
		{
			name:            "unknown type with message field",
			input:           `{"type":"custom","message":"info"}`,
			expectedType:    "custom",
			expectedMessage: "info",
			expectNonEmpty:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ParseStreamLine(tt.input)
			if !tt.expectNonEmpty {
				assert.Empty(t, result.Type)
				return
			}
			assert.Equal(t, tt.expectedType, result.Type)
			assert.Equal(t, tt.expectedMessage, result.Message)
		})
	}
}

func TestFormatEvent_AllTypes(t *testing.T) {
	tests := []struct {
		name     string
		event    StreamEvent
		expected string
	}{
		{
			name:     "text event",
			event:    StreamEvent{Type: "text", Message: "Hello world"},
			expected: "Hello world",
		},
		{
			name:     "tool_start event",
			event:    StreamEvent{Type: "tool_start", Message: "read_file"},
			expected: "[tool] read_file",
		},
		{
			name:     "tool_result event",
			event:    StreamEvent{Type: "tool_result", Message: "success"},
			expected: "[ok] success",
		},
		{
			name:     "name_suggestion event returns empty",
			event:    StreamEvent{Type: "name_suggestion", Message: "Fix bug"},
			expected: "",
		},
		{
			name:     "done event",
			event:    StreamEvent{Type: "done", Message: "Completed"},
			expected: "[done] Completed",
		},
		{
			name:     "error event",
			event:    StreamEvent{Type: "error", Message: "Something failed"},
			expected: "[error] Something failed",
		},
		{
			name:     "unknown type with message",
			event:    StreamEvent{Type: "custom", Message: "data"},
			expected: "data",
		},
		{
			name:     "unknown type with json-like message returns empty",
			event:    StreamEvent{Type: "custom", Message: `{"key":"value"}`},
			expected: "",
		},
		{
			name:     "unknown type with empty message",
			event:    StreamEvent{Type: "custom", Message: ""},
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := FormatEvent(tt.event)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestParseAgentLine_WhitespaceHandling(t *testing.T) {
	// Test that leading/trailing whitespace is properly trimmed
	tests := []struct {
		name  string
		input string
	}{
		{"leading space", "  " + `{"type":"complete"}`},
		{"trailing space", `{"type":"complete"}` + "  "},
		{"both spaces", "  " + `{"type":"complete"}` + "  "},
		{"leading newline", "\n" + `{"type":"complete"}`},
		{"trailing newline", `{"type":"complete"}` + "\n"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ParseAgentLine(tt.input)
			require.NotNil(t, result)
			assert.Equal(t, EventTypeComplete, result.Type)
		})
	}
}

func TestTodoItem_Fields(t *testing.T) {
	input := `{"type":"todo_update","todos":[
		{"content":"Task 1","status":"pending","activeForm":"Doing task 1"},
		{"content":"Task 2","status":"in_progress","activeForm":"Working on task 2"},
		{"content":"Task 3","status":"completed","activeForm":"Finished task 3"}
	]}`

	result := ParseAgentLine(input)
	require.NotNil(t, result)
	require.Len(t, result.Todos, 3)

	// Check first todo
	assert.Equal(t, "Task 1", result.Todos[0].Content)
	assert.Equal(t, "pending", result.Todos[0].Status)
	assert.Equal(t, "Doing task 1", result.Todos[0].ActiveForm)

	// Check second todo
	assert.Equal(t, "Task 2", result.Todos[1].Content)
	assert.Equal(t, "in_progress", result.Todos[1].Status)
	assert.Equal(t, "Working on task 2", result.Todos[1].ActiveForm)

	// Check third todo
	assert.Equal(t, "Task 3", result.Todos[2].Content)
	assert.Equal(t, "completed", result.Todos[2].Status)
	assert.Equal(t, "Finished task 3", result.Todos[2].ActiveForm)
}

// ============================================================================
// Streaming Warning Event Tests
// ============================================================================

func TestEventTypeStreamingWarning(t *testing.T) {
	assert.Equal(t, "streaming_warning", EventTypeStreamingWarning)
}

func TestParseAgentLine_StreamingWarning(t *testing.T) {
	line := `{"type":"streaming_warning","source":"hub","reason":"broadcast_timeout","message":"Some streaming events were dropped"}`

	event := ParseAgentLine(line)
	require.NotNil(t, event)

	assert.Equal(t, EventTypeStreamingWarning, event.Type)
	assert.Equal(t, "hub", event.Source)
	assert.Equal(t, "broadcast_timeout", event.Reason)
	assert.Equal(t, "Some streaming events were dropped", event.Message)
}

func TestParseAgentLine_StreamingWarning_ProcessSource(t *testing.T) {
	line := `{"type":"streaming_warning","source":"process","reason":"buffer_full","message":"Some streaming events were dropped due to slow processing"}`

	event := ParseAgentLine(line)
	require.NotNil(t, event)

	assert.Equal(t, EventTypeStreamingWarning, event.Type)
	assert.Equal(t, "process", event.Source)
	assert.Equal(t, "buffer_full", event.Reason)
	assert.Equal(t, "Some streaming events were dropped due to slow processing", event.Message)
}

// ============================================================================
// Context Usage Event Tests
// ============================================================================

func TestEventTypeContextUsageConstants(t *testing.T) {
	assert.Equal(t, "context_usage", EventTypeContextUsage)
	assert.Equal(t, "context_window_size", EventTypeContextWindowSize)
}

func TestParseAgentLine_ContextUsage(t *testing.T) {
	line := `{"type":"context_usage","inputTokens":70400,"outputTokens":3000,"cacheReadInputTokens":5000,"cacheCreationInputTokens":1500}`

	event := ParseAgentLine(line)
	require.NotNil(t, event)

	assert.Equal(t, EventTypeContextUsage, event.Type)
	assert.Equal(t, 70400, event.InputTokens)
	assert.Equal(t, 3000, event.OutputTokens)
	assert.Equal(t, 5000, event.CacheReadInputTokens)
	assert.Equal(t, 1500, event.CacheCreationInputTokens)
}

func TestParseAgentLine_ContextUsage_ZeroValues(t *testing.T) {
	// When only inputTokens is non-zero, other fields should be 0
	line := `{"type":"context_usage","inputTokens":10000}`

	event := ParseAgentLine(line)
	require.NotNil(t, event)

	assert.Equal(t, EventTypeContextUsage, event.Type)
	assert.Equal(t, 10000, event.InputTokens)
	assert.Equal(t, 0, event.OutputTokens)
	assert.Equal(t, 0, event.CacheReadInputTokens)
	assert.Equal(t, 0, event.CacheCreationInputTokens)
}

func TestParseAgentLine_ContextWindowSize(t *testing.T) {
	line := `{"type":"context_window_size","contextWindow":1000000}`

	event := ParseAgentLine(line)
	require.NotNil(t, event)

	assert.Equal(t, EventTypeContextWindowSize, event.Type)
	assert.Equal(t, 1000000, event.ContextWindow)
}

func TestParseAgentLine_ContextWindowSize_200k(t *testing.T) {
	line := `{"type":"context_window_size","contextWindow":200000}`

	event := ParseAgentLine(line)
	require.NotNil(t, event)

	assert.Equal(t, 200000, event.ContextWindow)
}

func TestAgentEvent_ContextFieldsRoundTrip(t *testing.T) {
	// Verify that marshaling and unmarshaling preserves context fields
	original := &AgentEvent{
		Type:                     EventTypeContextUsage,
		InputTokens:              15000,
		OutputTokens:             3000,
		CacheReadInputTokens:     5000,
		CacheCreationInputTokens: 2000,
	}

	data, err := json.Marshal(original)
	require.NoError(t, err)

	var parsed AgentEvent
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, original.Type, parsed.Type)
	assert.Equal(t, original.InputTokens, parsed.InputTokens)
	assert.Equal(t, original.OutputTokens, parsed.OutputTokens)
	assert.Equal(t, original.CacheReadInputTokens, parsed.CacheReadInputTokens)
	assert.Equal(t, original.CacheCreationInputTokens, parsed.CacheCreationInputTokens)
}

func TestAgentEvent_ContextWindowRoundTrip(t *testing.T) {
	original := &AgentEvent{
		Type:          EventTypeContextWindowSize,
		ContextWindow: 200000,
	}

	data, err := json.Marshal(original)
	require.NoError(t, err)

	var parsed AgentEvent
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, original.Type, parsed.Type)
	assert.Equal(t, original.ContextWindow, parsed.ContextWindow)
}

// ============================================================================
// Plan Approval Request Event Tests
// ============================================================================

func TestEventTypePlanApprovalRequestConstant(t *testing.T) {
	assert.Equal(t, "plan_approval_request", EventTypePlanApprovalRequest)
}

func TestParseAgentLine_PlanApprovalRequest(t *testing.T) {
	line := `{"type":"plan_approval_request","requestId":"plan-approval-1-1700000000000","sessionId":"session-abc"}`

	event := ParseAgentLine(line)
	require.NotNil(t, event)

	assert.Equal(t, EventTypePlanApprovalRequest, event.Type)
	assert.Equal(t, "plan-approval-1-1700000000000", event.RequestID)
	assert.Equal(t, "session-abc", event.SessionID)
}

func TestParseAgentLine_PlanApprovalRequest_MinimalFields(t *testing.T) {
	line := `{"type":"plan_approval_request","requestId":"plan-approval-2-1700000000001"}`

	event := ParseAgentLine(line)
	require.NotNil(t, event)

	assert.Equal(t, EventTypePlanApprovalRequest, event.Type)
	assert.Equal(t, "plan-approval-2-1700000000001", event.RequestID)
	assert.Empty(t, event.SessionID)
}

func TestParseAgentLine_PlanApprovalRequest_RoundTrip(t *testing.T) {
	original := &AgentEvent{
		Type:      EventTypePlanApprovalRequest,
		RequestID: "plan-approval-3-1700000000002",
		SessionID: "session-xyz",
	}

	data, err := json.Marshal(original)
	require.NoError(t, err)

	var parsed AgentEvent
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, original.Type, parsed.Type)
	assert.Equal(t, original.RequestID, parsed.RequestID)
	assert.Equal(t, original.SessionID, parsed.SessionID)
}

func TestAgentEvent_ContextUsageOmitsZeroFields(t *testing.T) {
	// Verify that zero-value fields are omitted in JSON (due to omitempty)
	event := &AgentEvent{
		Type:        EventTypeContextUsage,
		InputTokens: 10000,
		// All other context fields are zero
	}

	data, err := json.Marshal(event)
	require.NoError(t, err)

	jsonStr := string(data)
	assert.Contains(t, jsonStr, `"inputTokens":10000`)
	assert.NotContains(t, jsonStr, `"outputTokens"`)
	assert.NotContains(t, jsonStr, `"cacheReadInputTokens"`)
	assert.NotContains(t, jsonStr, `"cacheCreationInputTokens"`)
	assert.NotContains(t, jsonStr, `"contextWindow"`)
}

// ============================================================================
// Additional Event Type Tests (Phase 4)
// ============================================================================

func TestParseAgentLine_SessionStarted(t *testing.T) {
	line := `{"type":"session_started","sessionId":"sess-abc123","source":"startup"}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeSessionStarted, event.Type)
	assert.Equal(t, "sess-abc123", event.SessionID)
	assert.Equal(t, "startup", event.Source)
}

func TestParseAgentLine_SessionStarted_Resume(t *testing.T) {
	line := `{"type":"session_started","sessionId":"sess-resume","source":"resume","resuming":true}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeSessionStarted, event.Type)
	assert.True(t, event.Resuming)
	assert.Equal(t, "resume", event.Source)
}

func TestParseAgentLine_SessionEnded(t *testing.T) {
	line := `{"type":"session_ended","sessionId":"sess-ended"}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeSessionEnded, event.Type)
	assert.Equal(t, "sess-ended", event.SessionID)
}

func TestParseAgentLine_HookPreTool(t *testing.T) {
	line := `{"type":"hook_pre_tool","toolUseId":"tu-123","tool":"Bash","input":{"command":"ls"}}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeHookPreTool, event.Type)
	assert.Equal(t, "tu-123", event.ToolUseId)
	assert.Equal(t, "Bash", event.Tool)
	assert.NotNil(t, event.Input)
}

func TestParseAgentLine_HookPostTool(t *testing.T) {
	line := `{"type":"hook_post_tool","toolUseId":"tu-456","tool":"Read","response":"file content"}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeHookPostTool, event.Type)
	assert.Equal(t, "tu-456", event.ToolUseId)
}

func TestParseAgentLine_SubagentStarted(t *testing.T) {
	line := `{"type":"subagent_started","agentId":"agent-1","agentType":"Explore","description":"Searching codebase","parentToolUseId":"tu-789"}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeSubagentStarted, event.Type)
	assert.Equal(t, "agent-1", event.AgentId)
	assert.Equal(t, "Explore", event.AgentType)
	assert.Equal(t, "Searching codebase", event.AgentDescription)
	assert.Equal(t, "tu-789", event.ParentToolUseId)
}

func TestParseAgentLine_SubagentStopped(t *testing.T) {
	line := `{"type":"subagent_stopped","agentId":"agent-1"}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeSubagentStopped, event.Type)
	assert.Equal(t, "agent-1", event.AgentId)
}

func TestParseAgentLine_SubagentOutput(t *testing.T) {
	line := `{"type":"subagent_output","agentId":"agent-1","agentOutput":"Found 3 matching files"}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeSubagentOutput, event.Type)
	assert.Equal(t, "agent-1", event.AgentId)
	assert.Equal(t, "Found 3 matching files", event.AgentOutput)
}

func TestParseAgentLine_CompactBoundary(t *testing.T) {
	line := `{"type":"compact_boundary","trigger":"auto","preTokens":180000}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeCompactBoundary, event.Type)
	assert.Equal(t, "auto", event.Trigger)
	assert.Equal(t, 180000, event.PreTokens)
}

func TestParseAgentLine_CliCrashRecovery(t *testing.T) {
	line := `{"type":"session_recovering","attempt":2,"maxAttempts":3}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeSessionRecovering, event.Type)
	assert.Equal(t, 2, event.Attempt)
	assert.Equal(t, 3, event.MaxAttempts)
}

func TestParseAgentLine_UserQuestionRequest(t *testing.T) {
	line := `{"type":"user_question_request","requestId":"q-123","questions":[{"question":"Select environment","header":"Deploy config","options":[{"label":"Production","description":"Main server"}],"multiSelect":false}]}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeUserQuestionRequest, event.Type)
	assert.Equal(t, "q-123", event.RequestID)
	require.Len(t, event.Questions, 1)
	assert.Equal(t, "Select environment", event.Questions[0].Question)
	assert.Equal(t, "Deploy config", event.Questions[0].Header)
	require.Len(t, event.Questions[0].Options, 1)
	assert.Equal(t, "Production", event.Questions[0].Options[0].Label)
	assert.False(t, event.Questions[0].MultiSelect)
}

func TestParseAgentLine_ToolProgress(t *testing.T) {
	line := `{"type":"tool_progress","toolName":"Bash","elapsedTimeSeconds":5}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeToolProgress, event.Type)
	assert.Equal(t, "Bash", event.ToolName)
	assert.Equal(t, 5, event.ElapsedTimeSeconds)
}

func TestParseAgentLine_AuthError(t *testing.T) {
	line := `{"type":"auth_error","message":"OAuth token expired"}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeAuthError, event.Type)
	assert.Equal(t, "OAuth token expired", event.Message)
}

func TestParseAgentLine_PermModeChanged(t *testing.T) {
	line := `{"type":"permission_mode_changed","mode":"plan"}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypePermModeChanged, event.Type)
	assert.Equal(t, "plan", event.Mode)
}

func TestParseAgentLine_TurnComplete(t *testing.T) {
	line := `{"type":"turn_complete"}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeTurnComplete, event.Type)
}

func TestParseAgentLine_SessionIdUpdate(t *testing.T) {
	line := `{"type":"session_id_update","sessionId":"new-sess-id"}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeSessionIdUpdate, event.Type)
	assert.Equal(t, "new-sess-id", event.SessionID)
}

func TestParseAgentLine_StatusUpdate(t *testing.T) {
	line := `{"type":"status_update","status":"running","message":"Processing request"}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeStatusUpdate, event.Type)
	assert.Equal(t, "running", event.Status)
	assert.Equal(t, "Processing request", event.Message)
}

func TestParseAgentLine_ThinkingDelta(t *testing.T) {
	line := `{"type":"thinking_delta","content":"Let me consider this..."}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeThinkingDelta, event.Type)
	assert.Equal(t, "Let me consider this...", event.Content)
}

func TestParseAgentLine_ModelChanged(t *testing.T) {
	line := `{"type":"model_changed","model":"claude-sonnet-4-5-20250929"}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeModelChanged, event.Type)
	assert.Equal(t, "claude-sonnet-4-5-20250929", event.Model)
}

func TestParseAgentLine_HookResponse(t *testing.T) {
	line := `{"type":"hook_response","hookName":"pre-commit","hookEvent":"tool_start","stdout":"ok","stderr":"","exitCode":0}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeHookResponse, event.Type)
	assert.Equal(t, "pre-commit", event.HookName)
	assert.Equal(t, "tool_start", event.HookEvent)
	assert.Equal(t, "ok", event.Stdout)
	require.NotNil(t, event.ExitCode)
	assert.Equal(t, 0, *event.ExitCode)
}

func TestParseAgentLine_CheckpointCreated(t *testing.T) {
	line := `{"type":"checkpoint_created","id":"cp-abc"}`
	event := ParseAgentLine(line)
	require.NotNil(t, event)
	assert.Equal(t, EventTypeCheckpointCreated, event.Type)
	assert.Equal(t, "cp-abc", event.ID)
}

func TestAgentEvent_IsHookEvent(t *testing.T) {
	tests := []struct {
		eventType string
		expected  bool
	}{
		{EventTypeHookPreTool, true},
		{EventTypeHookPostTool, true},
		{EventTypeHookToolFailure, true},
		{EventTypeAgentNotification, true},
		{EventTypeHookResponse, true},
		{EventTypeAssistantText, false},
		{EventTypeToolStart, false},
		{EventTypeComplete, false},
	}
	for _, tt := range tests {
		t.Run(tt.eventType, func(t *testing.T) {
			event := &AgentEvent{Type: tt.eventType}
			assert.Equal(t, tt.expected, event.IsHookEvent())
		})
	}
}

func TestAgentEvent_IsSessionEvent(t *testing.T) {
	tests := []struct {
		eventType string
		expected  bool
	}{
		{EventTypeSessionStarted, true},
		{EventTypeSessionEnded, true},
		{EventTypeSessionIdUpdate, true},
		{EventTypeAssistantText, false},
		{EventTypeToolStart, false},
		{EventTypeComplete, false},
	}
	for _, tt := range tests {
		t.Run(tt.eventType, func(t *testing.T) {
			event := &AgentEvent{Type: tt.eventType}
			assert.Equal(t, tt.expected, event.IsSessionEvent())
		})
	}
}

func TestAgentEvent_IsSubagentEvent(t *testing.T) {
	tests := []struct {
		eventType string
		expected  bool
	}{
		{EventTypeSubagentStarted, true},
		{EventTypeSubagentStopped, true},
		{EventTypeSubagentOutput, true},
		{EventTypeAssistantText, false},
		{EventTypeToolStart, false},
	}
	for _, tt := range tests {
		t.Run(tt.eventType, func(t *testing.T) {
			event := &AgentEvent{Type: tt.eventType}
			assert.Equal(t, tt.expected, event.IsSubagentEvent())
		})
	}
}

func TestStreamingSnapshot_JSON(t *testing.T) {
	snapshot := StreamingSnapshot{
		Text: "Hello world",
		ActiveTools: []ActiveToolEntry{
			{ID: "t1", Tool: "Read", StartTime: 1700000000},
		},
		Thinking:       "thinking...",
		IsThinking:     true,
		PlanModeActive: false,
		SubAgents: []SubAgentEntry{
			{AgentId: "a1", AgentType: "Explore", StartTime: 1700000001},
		},
	}

	data, err := json.Marshal(snapshot)
	require.NoError(t, err)

	var parsed StreamingSnapshot
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, "Hello world", parsed.Text)
	require.Len(t, parsed.ActiveTools, 1)
	assert.Equal(t, "t1", parsed.ActiveTools[0].ID)
	assert.Equal(t, "thinking...", parsed.Thinking)
	assert.True(t, parsed.IsThinking)
	assert.False(t, parsed.PlanModeActive)
	require.Len(t, parsed.SubAgents, 1)
	assert.Equal(t, "a1", parsed.SubAgents[0].AgentId)
}
