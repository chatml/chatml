package agent

import (
	"encoding/json"

	"github.com/chatml/chatml-backend/models"
)

// ToolApprovalOverride is imported from core/agent via type alias in core_types.go.

// ConversationBackend abstracts over Process (agent-runner child process) and Runner
// (native Go agentic loop). Manager uses this interface so it doesn't know which
// implementation is running.
//
// The interface is split into two concerns:
//   - BackendStateTracker (embedded): Manager-driven bookkeeping for turn tracking,
//     output tracking, session tracking, and plan/permission mode. Identical across
//     all backends. New implementations should embed DefaultBackendState to get these
//     for free rather than re-implementing ~14 methods.
//   - Core behavioral methods (below): lifecycle, messaging, and approval methods
//     that genuinely vary per backend implementation.
//
// Both backends emit the same AgentEvent types on Output(), so the WebSocket hub,
// frontend, and all downstream event handling code remain identical.
type ConversationBackend interface {
	// Embed state-tracking methods (see backend_state.go).
	// New backends: embed DefaultBackendState to satisfy this automatically.
	BackendStateTracker

	// --- Core lifecycle ---

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

	// --- Runtime configuration ---

	// SetPermissionMode changes the permission mode at runtime.
	SetPermissionMode(mode string) error

	// SetFastMode toggles fast output mode.
	SetFastMode(enabled bool) error

	// SetModel changes the model at runtime.
	SetModel(model string) error

	// SetMaxThinkingTokens changes the thinking token budget at runtime.
	SetMaxThinkingTokens(tokens int) error

	// --- Task management ---

	// StopTask stops a specific background task/sub-agent.
	StopTask(taskId string) error

	// --- Tool approval ---

	// SendToolApprovalResponse sends a tool approval/denial response.
	SendToolApprovalResponse(requestId, action, specifier string, updatedInput json.RawMessage) error

	// SendBatchToolApprovalResponse sends a batch tool approval/denial response.
	// perTool maps tool use IDs to individual overrides (action, specifier, updatedInput).
	// Returns nil gracefully for backends that don't support batch approvals.
	SendBatchToolApprovalResponse(requestId string, action string, perTool map[string]ToolApprovalOverride) error

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
