package agent

import (
	"sync"

	"github.com/chatml/chatml-backend/models"
)

// BackendStateTracker provides the Manager-driven state tracking that
// the Manager reads and writes on all conversation backends. These methods
// are bookkeeping for turn tracking, output tracking, session tracking,
// and plan/permission mode — state the Manager drives externally.
//
// This interface is separated from ConversationBackend so the split between
// "behavioral methods that vary per backend" and "Manager-driven tracking
// that is identical across backends" is explicit. New backend implementations
// should embed DefaultBackendState to get these methods for free rather than
// re-implementing them.
type BackendStateTracker interface {
	// --- Session tracking ---

	// SetSessionID updates the current session ID (set from session_started events).
	SetSessionID(sessionID string)

	// GetSessionID returns the current session ID.
	GetSessionID() string

	// --- Plan/permission mode tracking ---

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

	// TakePendingUserMessage returns and clears the pending user message
	// without changing the active turn state. Returns nil if no message is pending.
	// Used to discard a deferred message when SendMessage fails.
	TakePendingUserMessage() *models.Message

	// --- Output tracking ---

	// SetSawErrorEvent marks that an error event was emitted.
	SetSawErrorEvent()

	// SawErrorEvent returns whether an error event was emitted.
	SawErrorEvent() bool

	// SetProducedOutput marks that assistant text was emitted.
	SetProducedOutput()

	// ProducedOutput returns whether assistant text was emitted.
	ProducedOutput() bool
}

// DefaultBackendState is a ready-to-embed implementation of BackendStateTracker.
// New ConversationBackend implementations should embed this struct to get all
// state-tracking methods for free. Thread-safe via internal mutex.
//
// NOTE: SetOptionsPlanMode and SetOptionsPermissionMode have default implementations
// that only track state (planModeActive / no-op respectively). Backend implementations
// that need to persist these to ProcessOptions should override these methods and call
// through to the embedded defaults for the state-tracking part.
//
// Example:
//
//	type MyBackend struct {
//	    agent.DefaultBackendState
//	    opts agent.ProcessOptions
//	    // ... other fields
//	}
//
//	func (b *MyBackend) SetOptionsPlanMode(enabled bool) {
//	    b.opts.PlanMode = enabled
//	    b.DefaultBackendState.SetOptionsPlanMode(enabled)
//	}
type DefaultBackendState struct {
	mu                 sync.Mutex
	sessionID          string
	planModeActive     bool
	inActiveTurn       bool
	sawErrorEvent      bool
	producedOutput     bool
	pendingUserMessage *models.Message
}

func (s *DefaultBackendState) SetSessionID(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessionID = sessionID
}

func (s *DefaultBackendState) GetSessionID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessionID
}

func (s *DefaultBackendState) SetPlanModeFromEvent(active bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.planModeActive = active
}

// SetOptionsPlanMode sets planModeActive. Override this in backends that need to
// also persist to ProcessOptions.
func (s *DefaultBackendState) SetOptionsPlanMode(enabled bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.planModeActive = enabled
}

// SetOptionsPermissionMode is a no-op in the default state tracker.
// Override this in backends that need to persist the mode to ProcessOptions.
func (s *DefaultBackendState) SetOptionsPermissionMode(mode string) {
	// No-op: DefaultBackendState doesn't hold ProcessOptions.
	// Backend implementations should override this.
}

func (s *DefaultBackendState) IsPlanModeActive() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.planModeActive
}

func (s *DefaultBackendState) SetInActiveTurn(active bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.inActiveTurn = active
}

func (s *DefaultBackendState) IsInActiveTurn() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.inActiveTurn
}

func (s *DefaultBackendState) StoreOrDeferMessage(msg *models.Message) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.inActiveTurn {
		s.pendingUserMessage = msg
		return false
	}
	return true
}

func (s *DefaultBackendState) EndTurnAndTakePending() *models.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.inActiveTurn = false
	msg := s.pendingUserMessage
	s.pendingUserMessage = nil
	return msg
}

func (s *DefaultBackendState) TakePendingUserMessage() *models.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	msg := s.pendingUserMessage
	s.pendingUserMessage = nil
	return msg
}

func (s *DefaultBackendState) SetSawErrorEvent() {
	s.mu.Lock()
	s.sawErrorEvent = true
	s.mu.Unlock()
}

func (s *DefaultBackendState) SawErrorEvent() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sawErrorEvent
}

func (s *DefaultBackendState) SetProducedOutput() {
	s.mu.Lock()
	s.producedOutput = true
	s.mu.Unlock()
}

func (s *DefaultBackendState) ProducedOutput() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.producedOutput
}

// ResetPerTurnState resets the per-turn tracking flags. Called at the start
// of each turn to clear state from the previous turn.
func (s *DefaultBackendState) ResetPerTurnState() {
	s.mu.Lock()
	s.sawErrorEvent = false
	s.producedOutput = false
	s.mu.Unlock()
}

// ResetSawErrorEvent clears the error event flag. Used when retrying after
// transient errors (e.g., fast mode cooldown).
func (s *DefaultBackendState) ResetSawErrorEvent() {
	s.mu.Lock()
	s.sawErrorEvent = false
	s.mu.Unlock()
}

// SetPlanModeActive sets the planModeActive flag directly. Useful for backends
// that need to set plan mode state from multiple code paths (e.g., permission
// mode changes, event handlers).
func (s *DefaultBackendState) SetPlanModeActive(active bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.planModeActive = active
}

// Ensure DefaultBackendState implements BackendStateTracker at compile time.
var _ BackendStateTracker = (*DefaultBackendState)(nil)
