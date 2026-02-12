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

	// Session management fields
	SessionID string `json:"sessionId,omitempty"`
	Resuming  bool   `json:"resuming,omitempty"`
	Forking   bool   `json:"forking,omitempty"`
	Source    string `json:"source,omitempty"` // For session_started: startup, resume, clear, compact

	// Enhanced init fields
	McpServers     []McpServerStatus `json:"mcpServers,omitempty"`
	SlashCommands  []string          `json:"slashCommands,omitempty"`
	Skills         []string          `json:"skills,omitempty"`
	Plugins        []PluginInfo      `json:"plugins,omitempty"`
	Agents         []string          `json:"agents,omitempty"`
	PermissionMode string            `json:"permissionMode,omitempty"`
	ClaudeCodeVer  string            `json:"claudeCodeVersion,omitempty"`
	ApiKeySource   string            `json:"apiKeySource,omitempty"`
	Betas          []string          `json:"betas,omitempty"`
	OutputStyle    string            `json:"outputStyle,omitempty"`

	// Result fields
	DurationMs    int64                  `json:"durationMs,omitempty"`
	DurationApiMs int64                  `json:"durationApiMs,omitempty"`
	Usage         map[string]interface{} `json:"usage,omitempty"`
	ModelUsage    map[string]interface{} `json:"modelUsage,omitempty"`
	StructuredOut interface{}            `json:"structuredOutput,omitempty"`
	Stats         *RunStats              `json:"stats,omitempty"`

	// Hook event fields
	ToolUseId        string      `json:"toolUseId,omitempty"`
	Input            interface{} `json:"input,omitempty"`
	Response         interface{} `json:"response,omitempty"`
	Title            string      `json:"title,omitempty"`
	NotificationType string      `json:"notificationType,omitempty"`
	Error            string      `json:"error,omitempty"`
	IsInterrupt      bool        `json:"isInterrupt,omitempty"`
	StopHookActive   bool        `json:"stopHookActive,omitempty"`

	// Subagent fields
	AgentId        string `json:"agentId,omitempty"`
	AgentType      string `json:"agentType,omitempty"`
	TranscriptPath string `json:"transcriptPath,omitempty"`

	// Compact boundary fields
	Trigger            string `json:"trigger,omitempty"`
	PreTokens          int    `json:"preTokens,omitempty"`
	CustomInstructions string `json:"customInstructions,omitempty"`

	// Context usage fields
	InputTokens              int `json:"inputTokens,omitempty"`
	OutputTokens             int `json:"outputTokens,omitempty"`
	CacheReadInputTokens     int `json:"cacheReadInputTokens,omitempty"`
	CacheCreationInputTokens int `json:"cacheCreationInputTokens,omitempty"`
	ContextWindow            int `json:"contextWindow,omitempty"`

	// Status fields
	Status string `json:"status,omitempty"`

	// Hook response fields
	HookName  string `json:"hookName,omitempty"`
	HookEvent string `json:"hookEvent,omitempty"`
	Stdout    string `json:"stdout,omitempty"`
	Stderr    string `json:"stderr,omitempty"`
	ExitCode  *int   `json:"exitCode,omitempty"`

	// Tool progress fields
	ToolName           string `json:"toolName,omitempty"`
	ElapsedTimeSeconds int    `json:"elapsedTimeSeconds,omitempty"`
	ParentToolUseId    string `json:"parentToolUseId,omitempty"`

	// Auth status fields
	IsAuthenticating bool     `json:"isAuthenticating,omitempty"`
	Output           []string `json:"output,omitempty"`

	// Query info response fields
	Models   []ModelInfo       `json:"models,omitempty"`
	Commands []SlashCmd        `json:"commands,omitempty"`
	Servers  []McpServerStatus `json:"servers,omitempty"`
	Info     *AccountInfo      `json:"info,omitempty"`
	Mode     string            `json:"mode,omitempty"`

	// Stderr data
	Data string `json:"data,omitempty"`

	// JSON parse error fields
	RawInput     string `json:"rawInput,omitempty"`
	ErrorDetails string `json:"errorDetails,omitempty"`

	// Command error fields
	Command string `json:"command,omitempty"`

	// User question fields (AskUserQuestion tool)
	RequestID string         `json:"requestId,omitempty"`
	Questions []UserQuestion `json:"questions,omitempty"`
}

// McpServerStatus represents MCP server connection status
type McpServerStatus struct {
	Name   string `json:"name"`
	Status string `json:"status"` // connected, failed, needs-auth, pending
}

// PluginInfo represents loaded plugin information
type PluginInfo struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// RunStats represents statistics from the agent run
type RunStats struct {
	ToolCalls           int            `json:"toolCalls"`
	ToolsByType         map[string]int `json:"toolsByType"`
	SubAgents           int            `json:"subAgents"`
	FilesRead           int            `json:"filesRead"`
	FilesWritten        int            `json:"filesWritten"`
	BashCommands        int            `json:"bashCommands"`
	WebSearches         int            `json:"webSearches"`
	TotalToolDurationMs int64          `json:"totalToolDurationMs"`
}

// ModelInfo represents available model information
type ModelInfo struct {
	Value       string `json:"value"`
	DisplayName string `json:"displayName"`
	Description string `json:"description"`
}

// SlashCmd represents a slash command/skill
type SlashCmd struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	ArgumentHint string `json:"argumentHint"`
}

// AccountInfo represents account information
type AccountInfo struct {
	Email            string `json:"email,omitempty"`
	Organization     string `json:"organization,omitempty"`
	SubscriptionType string `json:"subscriptionType,omitempty"`
	TokenSource      string `json:"tokenSource,omitempty"`
	ApiKeySource     string `json:"apiKeySource,omitempty"`
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
	EventTypeTurnComplete   = "turn_complete"
	EventTypeError          = "error"
	EventTypeShutdown       = "shutdown"

	// New event types
	EventTypeSessionStarted    = "session_started"
	EventTypeSessionEnded      = "session_ended"
	EventTypeSessionIdUpdate   = "session_id_update"
	EventTypeHookPreTool       = "hook_pre_tool"
	EventTypeHookPostTool      = "hook_post_tool"
	EventTypeHookToolFailure   = "hook_tool_failure"
	EventTypeAgentNotification = "agent_notification"
	EventTypeAgentStop         = "agent_stop"
	EventTypeSubagentStarted   = "subagent_started"
	EventTypeSubagentStopped   = "subagent_stopped"
	EventTypeCompactBoundary   = "compact_boundary"
	EventTypePreCompact        = "pre_compact"
	EventTypeStatusUpdate      = "status_update"
	EventTypeHookResponse      = "hook_response"
	EventTypeToolProgress      = "tool_progress"
	EventTypeAuthStatus        = "auth_status"
	EventTypeInterrupted       = "interrupted"
	EventTypeModelChanged      = "model_changed"
	EventTypePermModeChanged   = "permission_mode_changed"
	EventTypeSupportedModels   = "supported_models"
	EventTypeSupportedCommands = "supported_commands"
	EventTypeMcpStatus         = "mcp_status"
	EventTypeAccountInfo       = "account_info"
	EventTypeAgentStderr       = "agent_stderr"
	EventTypeThinking          = "thinking"
	EventTypeThinkingDelta     = "thinking_delta"
	EventTypeThinkingStart     = "thinking_start"
	EventTypeCheckpointCreated = "checkpoint_created"
	EventTypeFilesRewound      = "files_rewound"
	EventTypeJsonParseError    = "json_parse_error"

	// Warning events
	EventTypeStreamingWarning = "streaming_warning"
	EventTypeWarning          = "warning"

	// Context usage events
	EventTypeContextUsage      = "context_usage"
	EventTypeContextWindowSize = "context_window_size"

	// User question events (AskUserQuestion tool)
	EventTypeUserQuestionRequest = "user_question_request"
	EventTypeUserQuestionTimeout = "user_question_timeout"

	// Plan approval events (ExitPlanMode tool)
	EventTypePlanApprovalRequest = "plan_approval_request"

	// Command error (SDK runtime command failed)
	EventTypeCommandError = "command_error"

	// Auth error (OAuth token expired or API key invalid)
	EventTypeAuthError = "auth_error"
)

// TodoItem represents a single todo item from the agent's TodoWrite tool
type TodoItem struct {
	Content    string `json:"content"`
	Status     string `json:"status"` // "pending", "in_progress", "completed"
	ActiveForm string `json:"activeForm"`
}

// UserQuestion represents a question from the AskUserQuestion tool
type UserQuestion struct {
	Question    string               `json:"question"`
	Header      string               `json:"header"`
	Options     []UserQuestionOption `json:"options"`
	MultiSelect bool                 `json:"multiSelect"`
}

// UserQuestionOption represents an option for a user question
type UserQuestionOption struct {
	Label       string `json:"label"`
	Description string `json:"description"`
}

// StreamingSnapshot captures the current streaming state for reconnection recovery.
// Periodically flushed to DB so the frontend can restore its view on WebSocket reconnect.
type StreamingSnapshot struct {
	Text           string            `json:"text"`
	ActiveTools    []ActiveToolEntry `json:"activeTools"`
	Thinking       string            `json:"thinking,omitempty"`
	IsThinking     bool              `json:"isThinking"`
	PlanModeActive bool              `json:"planModeActive"`
	SubAgents      []SubAgentEntry   `json:"subAgents,omitempty"`
}

// ActiveToolEntry represents a tool currently in-flight during streaming.
type ActiveToolEntry struct {
	ID        string `json:"id"`
	Tool      string `json:"tool"`
	StartTime int64  `json:"startTime"`
	AgentId   string `json:"agentId,omitempty"`
}

// SubAgentEntry represents a sub-agent spawned during streaming.
type SubAgentEntry struct {
	AgentId         string            `json:"agentId"`
	AgentType       string            `json:"agentType"`
	ParentToolUseId string            `json:"parentToolUseId,omitempty"`
	StartTime       int64             `json:"startTime"`
	ActiveTools     []ActiveToolEntry `json:"activeTools"`
	Completed       bool              `json:"completed"`
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
	return e.Type == EventTypeToolStart || e.Type == EventTypeToolEnd ||
		e.Type == EventTypeHookPreTool || e.Type == EventTypeHookPostTool ||
		e.Type == EventTypeToolProgress
}

// IsHookEvent returns true if the event is hook-related
func (e *AgentEvent) IsHookEvent() bool {
	return e.Type == EventTypeHookPreTool || e.Type == EventTypeHookPostTool ||
		e.Type == EventTypeHookToolFailure || e.Type == EventTypeAgentNotification ||
		e.Type == EventTypeHookResponse
}

// IsSessionEvent returns true if the event is session-related
func (e *AgentEvent) IsSessionEvent() bool {
	return e.Type == EventTypeSessionStarted || e.Type == EventTypeSessionEnded ||
		e.Type == EventTypeSessionIdUpdate
}

// IsSubagentEvent returns true if the event is subagent-related
func (e *AgentEvent) IsSubagentEvent() bool {
	return e.Type == EventTypeSubagentStarted || e.Type == EventTypeSubagentStopped
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
		return "[tool] " + event.Message
	case "tool_result":
		return "[ok] " + event.Message
	case "name_suggestion":
		return "" // Don't display, just update state
	case "done":
		return "[done] " + event.Message
	case "error":
		return "[error] " + event.Message
	default:
		if event.Message != "" && !strings.HasPrefix(event.Message, "{") {
			return event.Message
		}
		return ""
	}
}
