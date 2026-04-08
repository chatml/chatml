// Package loop provides a thin adapter that wraps core/loop.Runner to satisfy
// the backend's ConversationBackend interface. The adapter bridges the type
// difference between backend/models (models.Message, models.Attachment) and
// core types (core.Message, core.Attachment) while delegating all behavioral
// and state-tracking methods to the core runner.
package loop

import (
	"encoding/json"
	"sync"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/models"
	core "github.com/chatml/chatml-core"
	coreloop "github.com/chatml/chatml-core/loop"
)

// Runner adapts core/loop.Runner to satisfy backend/agent.ConversationBackend.
// It delegates all behavioral and state methods to the core runner, and handles
// the type mismatch for *models.Message and []models.Attachment methods.
type Runner struct {
	core *coreloop.Runner

	// For *models.Message methods (StoreOrDeferMessage, EndTurnAndTakePending,
	// TakePendingUserMessage). These use adapter's own mutex because backend's
	// interface requires *models.Message while core uses *core.Message.
	// Lock ordering: adapter.mu → core.mu (safe: core never calls adapter).
	mu                 sync.Mutex
	pendingUserMessage *models.Message
}

// Compile-time interface check.
var _ agent.ConversationBackend = (*Runner)(nil)

// --- Lifecycle (direct delegation) ---

func (r *Runner) Start() error        { return r.core.Start() }
func (r *Runner) SendMessage(content string) error { return r.core.SendMessage(content) }
func (r *Runner) SendStop() error      { return r.core.SendStop() }
func (r *Runner) SendInterrupt() error { return r.core.SendInterrupt() }
func (r *Runner) Stop()               { r.core.Stop() }
func (r *Runner) TryStop() bool       { return r.core.TryStop() }
func (r *Runner) Output() <-chan string { return r.core.Output() }
func (r *Runner) Done() <-chan struct{} { return r.core.Done() }
func (r *Runner) IsRunning() bool      { return r.core.IsRunning() }
func (r *Runner) IsStopped() bool      { return r.core.IsStopped() }

// --- Runtime configuration (direct delegation) ---

func (r *Runner) SetPermissionMode(mode string) error   { return r.core.SetPermissionMode(mode) }
func (r *Runner) SetFastMode(enabled bool) error         { return r.core.SetFastMode(enabled) }
func (r *Runner) SetModel(model string) error            { return r.core.SetModel(model) }
func (r *Runner) SetMaxThinkingTokens(tokens int) error  { return r.core.SetMaxThinkingTokens(tokens) }
func (r *Runner) SetEffort(effort string) error           { return r.core.SetEffort(effort) }

// --- Task management ---

func (r *Runner) StopTask(taskId string) error { return r.core.StopTask(taskId) }

// --- Tool approval (direct delegation) ---

func (r *Runner) SendToolApprovalResponse(requestId, action, specifier string, updatedInput json.RawMessage) error {
	return r.core.SendToolApprovalResponse(requestId, action, specifier, updatedInput)
}

func (r *Runner) SendBatchToolApprovalResponse(requestId string, action string, perTool map[string]agent.ToolApprovalOverride) error {
	return r.core.SendBatchToolApprovalResponse(requestId, action, perTool)
}

func (r *Runner) SendUserQuestionResponse(requestId string, answers map[string]string) error {
	return r.core.SendUserQuestionResponse(requestId, answers)
}

func (r *Runner) SendPlanApprovalResponse(requestId string, approved bool, reason string) error {
	return r.core.SendPlanApprovalResponse(requestId, approved, reason)
}

// --- State delegation (must go to core runner — its internal loop reads these) ---

func (r *Runner) SetSessionID(id string)              { r.core.SetSessionID(id) }
func (r *Runner) GetSessionID() string                { return r.core.GetSessionID() }
func (r *Runner) SetPlanModeFromEvent(active bool)     { r.core.SetPlanModeFromEvent(active) }
func (r *Runner) SetOptionsPlanMode(enabled bool)      { r.core.SetOptionsPlanMode(enabled) }
func (r *Runner) SetOptionsPermissionMode(mode string) { r.core.SetOptionsPermissionMode(mode) }
func (r *Runner) IsPlanModeActive() bool               { return r.core.IsPlanModeActive() }
func (r *Runner) SetInActiveTurn(active bool)          { r.core.SetInActiveTurn(active) }
func (r *Runner) IsInActiveTurn() bool                 { return r.core.IsInActiveTurn() }
func (r *Runner) SetSawErrorEvent()                    { r.core.SetSawErrorEvent() }
func (r *Runner) SawErrorEvent() bool                  { return r.core.SawErrorEvent() }
func (r *Runner) SetProducedOutput()                   { r.core.SetProducedOutput() }
func (r *Runner) ProducedOutput() bool                 { return r.core.ProducedOutput() }

// --- Type-adapting methods ---

// SendMessageWithAttachments converts backend Attachment types to core types.
func (r *Runner) SendMessageWithAttachments(content string, attachments []models.Attachment) error {
	return r.core.SendMessageWithAttachments(content, convertAttachments(attachments))
}

// convertAttachments converts backend models.Attachment to core.Attachment.
func convertAttachments(attachments []models.Attachment) []core.Attachment {
	out := make([]core.Attachment, len(attachments))
	for i, a := range attachments {
		out[i] = core.Attachment{
			ID:         a.ID,
			Type:       a.Type,
			Name:       a.Name,
			Path:       a.Path,
			MimeType:   a.MimeType,
			Size:       a.Size,
			LineCount:  a.LineCount,
			Width:      a.Width,
			Height:     a.Height,
			Base64Data: a.Base64Data,
			Preview:    a.Preview,
		}
	}
	return out
}

// --- Message deferral (adapter's own mutex + core's inActiveTurn) ---
//
// These methods bridge the type gap: backend's BackendStateTracker uses
// *models.Message while core's runner uses *core.Message. The adapter stores
// the models.Message locally and uses core's IsInActiveTurn for atomic checks.
//
// INVARIANT: The core runner's own StoreOrDeferMessage/EndTurnAndTakePending/
// TakePendingUserMessage methods are NEVER called internally by the core loop.
// They exist only on the ConversationBackend interface for external callers
// (backend/agent/manager.go). The adapter intercepts all such calls, so the
// core runner's pendingUserMessage field remains permanently nil. This means
// there is no dual-state conflict — the adapter owns the pending message,
// the core owns the inActiveTurn flag, and adapter.mu serializes access.

// StoreOrDeferMessage atomically checks whether the agent is in an active turn.
// If active, defers the message and returns false. If idle, returns true.
func (r *Runner) StoreOrDeferMessage(msg *models.Message) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.core.IsInActiveTurn() {
		r.pendingUserMessage = msg
		return false
	}
	return true
}

// EndTurnAndTakePending clears the active turn flag and returns any deferred message.
func (r *Runner) EndTurnAndTakePending() *models.Message {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.core.SetInActiveTurn(false)
	msg := r.pendingUserMessage
	r.pendingUserMessage = nil
	return msg
}

// TakePendingUserMessage returns and clears the pending user message
// without changing the active turn state.
func (r *Runner) TakePendingUserMessage() *models.Message {
	r.mu.Lock()
	defer r.mu.Unlock()
	msg := r.pendingUserMessage
	r.pendingUserMessage = nil
	return msg
}

// --- Options ---

// Options returns ProcessOptions from the core runner so runtime changes
// (plan mode, permission mode) are reflected.
func (r *Runner) Options() agent.ProcessOptions {
	return r.core.Options()
}
