package loop

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-core/permission"
	"github.com/chatml/chatml-core/tool/builtin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func defaultOpts() agent.ProcessOptions {
	return agent.ProcessOptions{
		ID:             "test-runner",
		Workdir:        "/tmp/test",
		ConversationID: "conv-123",
		SdkSessionID:   "sess-456",
		Model:          "claude-sonnet-4-6",
	}
}

func TestNewRunner(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	assert.NotNil(t, r)
	assert.NotNil(t, r.output)
	assert.NotNil(t, r.done)
	assert.NotNil(t, r.messageQueue)
	assert.False(t, r.IsRunning())
	assert.False(t, r.IsStopped())
}

func TestRunner_ImplementsConversationBackend(t *testing.T) {
	// Compile-time check is in runner.go, but let's also verify at runtime
	var _ agent.ConversationBackend = (*Runner)(nil)
}

func TestRunner_StartAndStop(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	err := r.Start()
	require.NoError(t, err)
	assert.True(t, r.IsRunning())

	// Read the ready and session_started events
	readEventWithTimeout(t, r.Output(), 1*time.Second)
	readEventWithTimeout(t, r.Output(), 1*time.Second)

	r.Stop()
	<-r.Done()
	assert.False(t, r.IsRunning())
	assert.True(t, r.IsStopped())
}

func TestRunner_DoubleStart(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	err := r.Start()
	require.NoError(t, err)

	// Must drain output to prevent goroutine from blocking on channel send
	go func() { for range r.Output() {} }()

	err = r.Start()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "already started")

	r.Stop()
	<-r.Done()
}

func TestRunner_DoubleStop(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	err := r.Start()
	require.NoError(t, err)

	// Drain events
	go func() { for range r.Output() {} }()

	r.Stop()
	<-r.Done()

	// Second stop should not panic
	r.Stop()
}

func TestRunner_TryStop(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	err := r.Start()
	require.NoError(t, err)
	go func() { for range r.Output() {} }()

	// First TryStop should succeed
	assert.True(t, r.TryStop())

	<-r.Done()

	// Second TryStop should return false
	assert.False(t, r.TryStop())
}

func TestRunner_EmitsReadyAndSessionStarted(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	err := r.Start()
	require.NoError(t, err)
	defer r.Stop()

	// First event: ready
	readyJSON := readEventWithTimeout(t, r.Output(), 2*time.Second)
	var readyEvent agent.AgentEvent
	require.NoError(t, json.Unmarshal([]byte(readyJSON), &readyEvent))
	assert.Equal(t, "ready", readyEvent.Type)
	assert.Equal(t, "claude-sonnet-4-6", readyEvent.Model)
	assert.Equal(t, "/tmp/test", readyEvent.Cwd)

	// Second event: session_started
	sessionJSON := readEventWithTimeout(t, r.Output(), 2*time.Second)
	var sessionEvent agent.AgentEvent
	require.NoError(t, json.Unmarshal([]byte(sessionJSON), &sessionEvent))
	assert.Equal(t, "session_started", sessionEvent.Type)
	assert.Equal(t, "sess-456", sessionEvent.SessionID)

	// Drain remaining
	go func() { for range r.Output() {} }()
	r.Stop()
	<-r.Done()
}

func TestRunner_SendStop(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	err := r.Start()
	require.NoError(t, err)

	// Drain events in background
	events := make(chan string, 100)
	go func() {
		for ev := range r.Output() {
			events <- ev
		}
		close(events)
	}()

	// Send stop
	err = r.SendStop()
	require.NoError(t, err)

	<-r.Done()

	// Verify a complete event was emitted
	var gotComplete bool
	for ev := range events {
		var event agent.AgentEvent
		if json.Unmarshal([]byte(ev), &event) == nil && event.Type == "complete" {
			gotComplete = true
		}
	}
	assert.True(t, gotComplete)
}

func TestRunner_SessionID(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	r.SetSessionID("new-session")
	assert.Equal(t, "new-session", r.GetSessionID())
}

func TestRunner_PermissionMode(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	assert.False(t, r.IsPlanModeActive())

	err := r.SetPermissionMode("plan")
	assert.NoError(t, err)
	assert.True(t, r.IsPlanModeActive())

	err = r.SetPermissionMode("default")
	assert.NoError(t, err)
	assert.False(t, r.IsPlanModeActive())
}

func TestRunner_PlanMode(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	r.SetPlanModeFromEvent(true)
	assert.True(t, r.IsPlanModeActive())
	assert.True(t, r.Options().PlanMode)

	r.SetPlanModeFromEvent(false)
	assert.False(t, r.IsPlanModeActive())
	assert.False(t, r.Options().PlanMode)
}

func TestRunner_SetOptionsPlanMode(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	r.SetOptionsPlanMode(true)
	assert.True(t, r.IsPlanModeActive())

	r.SetOptionsPlanMode(false)
	assert.False(t, r.IsPlanModeActive())
}

func TestRunner_SetOptionsPermissionMode(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	r.SetOptionsPermissionMode("acceptEdits")
	assert.Equal(t, "acceptEdits", r.Options().PermissionMode)
}

func TestRunner_TurnTracking(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	assert.False(t, r.IsInActiveTurn())

	r.SetInActiveTurn(true)
	assert.True(t, r.IsInActiveTurn())

	r.SetInActiveTurn(false)
	assert.False(t, r.IsInActiveTurn())
}

func TestRunner_StoreOrDeferMessage(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	msg := &models.Message{ID: "msg-1", Content: "hello"}

	// Not in active turn — should store immediately
	assert.True(t, r.StoreOrDeferMessage(msg))

	// In active turn — should defer
	r.SetInActiveTurn(true)
	msg2 := &models.Message{ID: "msg-2", Content: "world"}
	assert.False(t, r.StoreOrDeferMessage(msg2))

	// End turn and take pending
	pending := r.EndTurnAndTakePending()
	require.NotNil(t, pending)
	assert.Equal(t, "msg-2", pending.ID)
	assert.False(t, r.IsInActiveTurn())

	// No more pending
	assert.Nil(t, r.EndTurnAndTakePending())
}

func TestRunner_ErrorTracking(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	assert.False(t, r.SawErrorEvent())
	r.SetSawErrorEvent()
	assert.True(t, r.SawErrorEvent())
}

func TestRunner_OutputTracking(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	assert.False(t, r.ProducedOutput())
	r.SetProducedOutput()
	assert.True(t, r.ProducedOutput())
}

func TestRunner_Options(t *testing.T) {
	opts := defaultOpts()
	opts.MaxTurns = 10
	opts.MaxBudgetUsd = 5.0

	r := NewRunner(opts, nil)
	retrieved := r.Options()

	assert.Equal(t, "test-runner", retrieved.ID)
	assert.Equal(t, 10, retrieved.MaxTurns)
	assert.Equal(t, 5.0, retrieved.MaxBudgetUsd)
}

func TestRunner_SetModel(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	err := r.SetModel("claude-opus-4-6")
	assert.NoError(t, err)
	assert.Equal(t, "claude-opus-4-6", r.Options().Model)
}

func TestRunner_SetMaxThinkingTokens(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	err := r.SetMaxThinkingTokens(8192)
	assert.NoError(t, err)
	assert.Equal(t, 8192, r.Options().MaxThinkingTokens)
}

func TestRunner_SetFastMode(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	err := r.SetFastMode(true)
	assert.NoError(t, err)

	r.mu.Lock()
	assert.True(t, r.fastMode)
	r.mu.Unlock()
}

func TestRunner_SendToolApprovalResponse_NoPending(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)
	err := r.SendToolApprovalResponse("req-1", "allow", "Bash(ls)", nil)
	assert.Error(t, err) // No pending request — should error
	assert.Contains(t, err.Error(), "no pending approval")
}

func TestRunner_SendToolApprovalResponse_WithPending(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	// Simulate a pending approval
	ch := make(chan permission.ApprovalResponse, 1)
	r.pendingApprovals.Store("req-1", ch)

	err := r.SendToolApprovalResponse("req-1", "allow_once", "Bash(ls)", nil)
	assert.NoError(t, err)

	// Verify the response was sent to the channel
	resp := <-ch
	assert.Equal(t, "allow_once", resp.Action)
	assert.Equal(t, "Bash(ls)", resp.Specifier)
}

func TestRunner_SendUserQuestionResponse_NoPending(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)
	err := r.SendUserQuestionResponse("req-1", map[string]string{"q1": "answer"})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no pending question")
}

func TestRunner_SendUserQuestionResponse_WithPending(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)
	ch := make(chan map[string]string, 1)
	r.pendingQuestions.Store("req-1", ch)

	err := r.SendUserQuestionResponse("req-1", map[string]string{"q1": "answer"})
	assert.NoError(t, err)

	resp := <-ch
	assert.Equal(t, "answer", resp["q1"])
}

func TestRunner_SendPlanApprovalResponse_NoPending(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)
	err := r.SendPlanApprovalResponse("req-1", true, "looks good")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no pending plan approval")
}

func TestRunner_SendPlanApprovalResponse_WithPending(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)
	ch := make(chan builtin.PlanApprovalResult, 1)
	r.pendingPlanApprovals.Store("req-1", ch)

	err := r.SendPlanApprovalResponse("req-1", true, "looks good")
	assert.NoError(t, err)

	resp := <-ch
	assert.True(t, resp.Approved)
	assert.Equal(t, "looks good", resp.Reason)
}

func TestRunner_PlanModeFromOptions(t *testing.T) {
	opts := defaultOpts()
	opts.PlanMode = true
	opts.PermissionMode = "plan"

	r := NewRunner(opts, nil)
	assert.True(t, r.IsPlanModeActive())
}

func TestRunner_FastModeFromOptions(t *testing.T) {
	opts := defaultOpts()
	opts.FastMode = true

	r := NewRunner(opts, nil)
	r.mu.Lock()
	assert.True(t, r.fastMode)
	r.mu.Unlock()
}

// readEventWithTimeout reads one event from the channel with a timeout.
func readEventWithTimeout(t *testing.T, ch <-chan string, timeout time.Duration) string {
	t.Helper()
	select {
	case ev, ok := <-ch:
		require.True(t, ok, "channel closed before event received")
		return ev
	case <-time.After(timeout):
		t.Fatal("timed out waiting for event")
		return ""
	}
}
