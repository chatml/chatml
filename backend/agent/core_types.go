// core_types.go re-exports types, constants, and functions from the core agent
// package so that backend code can reference them as agent.AgentEvent, agent.EventTypeX,
// etc. without changing every call site. This eliminates ~300 lines of duplicated
// type definitions that previously lived in parser.go.
package agent

import (
	coreagent "github.com/chatml/chatml-core/agent"
)

// --- Type aliases (Go type aliases preserve full compatibility) ---

type AgentEvent = coreagent.AgentEvent
type TodoItem = coreagent.TodoItem
type RunStats = coreagent.RunStats
type PermissionDenial = coreagent.PermissionDenial
type FilePersistedEntry = coreagent.FilePersistedEntry
type FileFailedEntry = coreagent.FileFailedEntry
type McpServerStatus = coreagent.McpServerStatus
type PluginInfo = coreagent.PluginInfo
type ModelInfo = coreagent.ModelInfo
type SlashCmd = coreagent.SlashCmd
type AccountInfo = coreagent.AccountInfo
type UserQuestion = coreagent.UserQuestion
type UserQuestionOption = coreagent.UserQuestionOption
type SnapshotTextSegment = coreagent.SnapshotTextSegment
type StreamingSnapshot = coreagent.StreamingSnapshot
type PendingPlanApprovalSnapshot = coreagent.PendingPlanApprovalSnapshot
type PendingElicitationSnapshot = coreagent.PendingElicitationSnapshot
type PendingUserQuestionSnapshot = coreagent.PendingUserQuestionSnapshot
type ActiveToolEntry = coreagent.ActiveToolEntry
type SubAgentUsage = coreagent.SubAgentUsage
type SubAgentEntry = coreagent.SubAgentEntry
type BatchApprovalItem = coreagent.BatchApprovalItem
type StreamEvent = coreagent.StreamEvent
type ProcessOptions = coreagent.ProcessOptions
type ToolApprovalOverride = coreagent.ToolApprovalOverride

// --- Function re-exports ---

var ParseAgentLine = coreagent.ParseAgentLine
var ParseStreamLine = coreagent.ParseStreamLine
var FormatEvent = coreagent.FormatEvent

// --- Event type constants (re-declared from core — string constants are safe to copy) ---

const (
	EventTypeReady          = coreagent.EventTypeReady
	EventTypeInit           = coreagent.EventTypeInit
	EventTypeAssistantText  = coreagent.EventTypeAssistantText
	EventTypeToolStart      = coreagent.EventTypeToolStart
	EventTypeToolEnd        = coreagent.EventTypeToolEnd
	EventTypeNameSuggestion = coreagent.EventTypeNameSuggestion
	EventTypeTodoUpdate     = coreagent.EventTypeTodoUpdate
	EventTypeResult         = coreagent.EventTypeResult
	EventTypeComplete       = coreagent.EventTypeComplete
	EventTypeTurnComplete   = coreagent.EventTypeTurnComplete
	EventTypeError          = coreagent.EventTypeError
	EventTypeShutdown       = coreagent.EventTypeShutdown

	EventTypeSessionStarted           = coreagent.EventTypeSessionStarted
	EventTypeSessionEnded             = coreagent.EventTypeSessionEnded
	EventTypeSessionIdUpdate          = coreagent.EventTypeSessionIdUpdate
	EventTypeHookPreTool              = coreagent.EventTypeHookPreTool
	EventTypeHookPostTool             = coreagent.EventTypeHookPostTool
	EventTypeHookToolFailure          = coreagent.EventTypeHookToolFailure
	EventTypeAgentNotification        = coreagent.EventTypeAgentNotification
	EventTypeAgentStop                = coreagent.EventTypeAgentStop
	EventTypeSubagentStarted          = coreagent.EventTypeSubagentStarted
	EventTypeSubagentStopped          = coreagent.EventTypeSubagentStopped
	EventTypeSubagentOutput           = coreagent.EventTypeSubagentOutput
	EventTypeCompactBoundary          = coreagent.EventTypeCompactBoundary
	EventTypePreCompact               = coreagent.EventTypePreCompact
	EventTypePostCompact              = coreagent.EventTypePostCompact
	EventTypeStatusUpdate             = coreagent.EventTypeStatusUpdate
	EventTypeHookResponse             = coreagent.EventTypeHookResponse
	EventTypeToolProgress             = coreagent.EventTypeToolProgress
	EventTypeAuthStatus               = coreagent.EventTypeAuthStatus
	EventTypeInterrupted              = coreagent.EventTypeInterrupted
	EventTypeModelChanged             = coreagent.EventTypeModelChanged
	EventTypePermModeChanged          = coreagent.EventTypePermModeChanged
	EventTypeFastModeChanged          = coreagent.EventTypeFastModeChanged
	EventTypeMaxThinkingTokensChanged = coreagent.EventTypeMaxThinkingTokensChanged
	EventTypeSupportedModels          = coreagent.EventTypeSupportedModels
	EventTypeSupportedCommands        = coreagent.EventTypeSupportedCommands
	EventTypeMcpStatus                = coreagent.EventTypeMcpStatus
	EventTypeMcpServerReconnected     = coreagent.EventTypeMcpServerReconnected
	EventTypeMcpServerToggled         = coreagent.EventTypeMcpServerToggled
	EventTypeAccountInfo              = coreagent.EventTypeAccountInfo
	EventTypeAgentStderr              = coreagent.EventTypeAgentStderr
	EventTypeThinking                 = coreagent.EventTypeThinking
	EventTypeThinkingDelta            = coreagent.EventTypeThinkingDelta
	EventTypeThinkingStart            = coreagent.EventTypeThinkingStart
	EventTypeCheckpointCreated        = coreagent.EventTypeCheckpointCreated
	EventTypeFilesRewound             = coreagent.EventTypeFilesRewound
	EventTypeJsonParseError           = coreagent.EventTypeJsonParseError

	EventTypeStreamingWarning = coreagent.EventTypeStreamingWarning
	EventTypeWarning          = coreagent.EventTypeWarning

	EventTypeContextUsage      = coreagent.EventTypeContextUsage
	EventTypeContextWindowSize = coreagent.EventTypeContextWindowSize

	EventTypeUserQuestionRequest = coreagent.EventTypeUserQuestionRequest
	EventTypeUserQuestionTimeout = coreagent.EventTypeUserQuestionTimeout

	EventTypePlanApprovalRequest = coreagent.EventTypePlanApprovalRequest
	EventTypeToolApprovalRequest = coreagent.EventTypeToolApprovalRequest

	EventTypeCommandError      = coreagent.EventTypeCommandError
	EventTypeAuthError         = coreagent.EventTypeAuthError
	EventTypeSessionRecovering = coreagent.EventTypeSessionRecovering
	EventTypeInputSuggestion   = coreagent.EventTypeInputSuggestion
	EventTypeSubagentUsage     = coreagent.EventTypeSubagentUsage

	EventTypeRateLimit      = coreagent.EventTypeRateLimit
	EventTypeTaskStarted    = coreagent.EventTypeTaskStarted
	EventTypeTaskProgress   = coreagent.EventTypeTaskProgress
	EventTypeTaskStopped    = coreagent.EventTypeTaskStopped
	EventTypeFilesPersisted = coreagent.EventTypeFilesPersisted

	EventTypePromptSuggestion     = coreagent.EventTypePromptSuggestion
	EventTypeToolUseSummary       = coreagent.EventTypeToolUseSummary
	EventTypeInstructionsLoaded   = coreagent.EventTypeInstructionsLoaded
	EventTypeWorktreeCreated      = coreagent.EventTypeWorktreeCreated
	EventTypeWorktreeRemoved      = coreagent.EventTypeWorktreeRemoved
	EventTypeElicitationRequest   = coreagent.EventTypeElicitationRequest
	EventTypeElicitationResult    = coreagent.EventTypeElicitationResult
	EventTypeElicitationComplete  = coreagent.EventTypeElicitationComplete
	EventTypeHookProgress         = coreagent.EventTypeHookProgress
	EventTypeHookStarted          = coreagent.EventTypeHookStarted
	EventTypeSupportedAgents      = coreagent.EventTypeSupportedAgents
	EventTypeMcpServersUpdated    = coreagent.EventTypeMcpServersUpdated
	EventTypeInitializationResult = coreagent.EventTypeInitializationResult

	EventTypeSessionForked    = coreagent.EventTypeSessionForked
	EventTypeMessageCancelled = coreagent.EventTypeMessageCancelled

	EventTypeStopFailure         = coreagent.EventTypeStopFailure
	EventTypeCwdChanged          = coreagent.EventTypeCwdChanged
	EventTypeFileChanged         = coreagent.EventTypeFileChanged
	EventTypeTaskCreated         = coreagent.EventTypeTaskCreated
	EventTypeAPIRetry            = coreagent.EventTypeAPIRetry
	EventTypeSessionStateChanged = coreagent.EventTypeSessionStateChanged

	// ChatML-specific events (emitted by agent-runner, not the Claude SDK)
	EventTypeMessageReceived = "message_received"
)
