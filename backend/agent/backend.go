package agent

import (
	"encoding/json"

	"github.com/chatml/chatml-backend/models"
)

// ConversationBackend abstracts over Process (agent-runner child process) and Runner
// (native Go agentic loop). Manager uses this interface so it doesn't know which
// implementation is running.
//
// Both backends emit the same AgentEvent types on Output(), so the WebSocket hub,
// frontend, and all downstream event handling code remain identical.
type ConversationBackend interface {
	// Start launches the backend. For Process this spawns a child process;
	// for Runner this starts the in-process agentic loop goroutine.
	Start() error

	// SendMessage sends a user message to the running agent.
	SendMessage(content string) error

	// SendMessageWithAttachments sends a user message with file attachments.
	SendMessageWithAttachments(content string, attachments []models.Attachment) error

	// SendStop sends a graceful stop signal.
	SendStop() error

	// SendInterrupt sends an interrupt to abort the current operation.
	SendInterrupt() error

	// Stop stops the backend. Safe to call multiple times (idempotent).
	Stop()

	// TryStop attempts to stop and returns true if this call performed the stop.
	TryStop() bool

	// Output returns a channel that emits output lines (JSON events for Process,
	// pre-serialized JSON for Runner). Closed when the backend exits.
	Output() <-chan string

	// Done returns a channel that's closed when the backend has fully exited.
	Done() <-chan struct{}

	// IsRunning returns whether the backend is currently active.
	IsRunning() bool

	// IsStopped returns whether the backend has been stopped.
	IsStopped() bool

	// --- Session tracking ---

	// SetSessionID updates the current session ID (set from session_started events).
	SetSessionID(sessionID string)

	// GetSessionID returns the current session ID.
	GetSessionID() string

	// --- Mode management ---

	// SetPermissionMode changes the permission mode at runtime.
	SetPermissionMode(mode string) error

	// SetFastMode toggles fast output mode.
	SetFastMode(enabled bool) error

	// SetModel changes the model at runtime.
	SetModel(model string) error

	// SetMaxThinkingTokens changes the thinking token budget at runtime.
	SetMaxThinkingTokens(tokens int) error

	// SetPlanModeFromEvent updates plan mode state from an output event.
	SetPlanModeFromEvent(active bool)

	// SetOptionsPlanMode updates plan mode in options so it survives restart.
	SetOptionsPlanMode(enabled bool)

	// SetOptionsPermissionMode updates permission mode in options so it survives restart.
	SetOptionsPermissionMode(mode string)

	// IsPlanModeActive returns whether plan mode is currently active.
	IsPlanModeActive() bool

	// --- Turn tracking ---

	// SetInActiveTurn marks whether the agent is currently processing a turn.
	SetInActiveTurn(active bool)

	// IsInActiveTurn returns whether the agent is currently processing a turn.
	IsInActiveTurn() bool

	// StoreOrDeferMessage atomically checks the active turn state.
	// If active, defers the message and returns false.
	// If idle, returns true and the caller should store the message.
	StoreOrDeferMessage(msg *models.Message) bool

	// EndTurnAndTakePending clears active turn and returns any deferred message.
	EndTurnAndTakePending() *models.Message

	// --- Output tracking ---

	// SetSawErrorEvent marks that an error event was emitted.
	SetSawErrorEvent()

	// SawErrorEvent returns whether an error event was emitted.
	SawErrorEvent() bool

	// SetProducedOutput marks that assistant text was emitted.
	SetProducedOutput()

	// ProducedOutput returns whether assistant text was emitted.
	ProducedOutput() bool

	// --- Task management ---

	// StopTask stops a specific background task/sub-agent.
	StopTask(taskId string) error

	// --- Tool approval ---

	// SendToolApprovalResponse sends a tool approval/denial response.
	SendToolApprovalResponse(requestId, action, specifier string, updatedInput json.RawMessage) error

	// --- User question ---

	// SendUserQuestionResponse sends answers to an AskUserQuestion request.
	SendUserQuestionResponse(requestId string, answers map[string]string) error

	// SendPlanApprovalResponse sends a plan approval/denial response.
	SendPlanApprovalResponse(requestId string, approved bool, reason string) error

	// --- Options ---

	// Options returns the ProcessOptions used to create this backend.
	Options() ProcessOptions
}

// Ensure Process implements ConversationBackend at compile time.
var _ ConversationBackend = (*Process)(nil)
