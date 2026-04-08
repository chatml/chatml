package loop

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chatml/chatml-core/agent"
	core "github.com/chatml/chatml-core"
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

	msg := &core.Message{ID: "msg-1", Content: "hello"}

	// Not in active turn — should store immediately
	assert.True(t, r.StoreOrDeferMessage(msg))

	// In active turn — should defer
	r.SetInActiveTurn(true)
	msg2 := &core.Message{ID: "msg-2", Content: "world"}
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

func TestRunner_TrackPlanFilePath_Write(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)
	r.planModeActive = true

	input := json.RawMessage(`{"file_path": "/tmp/plans/my-plan.md"}`)
	r.trackPlanFilePath("Write", input)

	r.mu.Lock()
	assert.Equal(t, "/tmp/plans/my-plan.md", r.lastPlanFilePath)
	r.mu.Unlock()
}

func TestRunner_TrackPlanFilePath_Write_AnyPath(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)
	r.planModeActive = true

	// Write tracks any file, not just plan directories
	input := json.RawMessage(`{"file_path": "/tmp/some-random-file.txt"}`)
	r.trackPlanFilePath("Write", input)

	r.mu.Lock()
	assert.Equal(t, "/tmp/some-random-file.txt", r.lastPlanFilePath)
	r.mu.Unlock()
}

func TestRunner_TrackPlanFilePath_Read_PlanPath(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)
	r.planModeActive = true

	input := json.RawMessage(`{"file_path": "/home/user/.claude/plans/my-plan.md"}`)
	r.trackPlanFilePath("Read", input)

	r.mu.Lock()
	assert.Equal(t, "/home/user/.claude/plans/my-plan.md", r.lastPlanFilePath)
	r.mu.Unlock()
}

func TestRunner_TrackPlanFilePath_Read_ChatmlPath(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)
	r.planModeActive = true

	input := json.RawMessage(`{"file_path": "/home/user/.chatml/plans/my-plan.md"}`)
	r.trackPlanFilePath("Read", input)

	r.mu.Lock()
	assert.Equal(t, "/home/user/.chatml/plans/my-plan.md", r.lastPlanFilePath)
	r.mu.Unlock()
}

func TestRunner_TrackPlanFilePath_Read_IgnoresNonPlanPaths(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)
	r.planModeActive = true

	input := json.RawMessage(`{"file_path": "/home/user/src/main.go"}`)
	r.trackPlanFilePath("Read", input)

	r.mu.Lock()
	assert.Equal(t, "", r.lastPlanFilePath)
	r.mu.Unlock()
}

func TestRunner_TrackPlanFilePath_InvalidJSON(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)
	r.planModeActive = true

	r.trackPlanFilePath("Write", json.RawMessage(`{invalid`))

	r.mu.Lock()
	assert.Equal(t, "", r.lastPlanFilePath)
	r.mu.Unlock()
}

func TestRunner_TrackPlanFilePath_EmptyFilePath(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)
	r.planModeActive = true

	r.trackPlanFilePath("Write", json.RawMessage(`{"file_path": ""}`))

	r.mu.Lock()
	assert.Equal(t, "", r.lastPlanFilePath)
	r.mu.Unlock()
}

func TestRunner_TrackPlanFilePath_UnknownTool(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)
	r.planModeActive = true

	input := json.RawMessage(`{"file_path": "/tmp/file.md"}`)
	r.trackPlanFilePath("Edit", input)

	r.mu.Lock()
	assert.Equal(t, "", r.lastPlanFilePath)
	r.mu.Unlock()
}

func TestRunner_SetOptionsPlanMode_ClearsLastPlanFilePath(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	// Simulate a stale path from a previous plan cycle
	r.mu.Lock()
	r.lastPlanFilePath = "/old/plan.md"
	r.mu.Unlock()

	r.SetOptionsPlanMode(true)

	r.mu.Lock()
	assert.Equal(t, "", r.lastPlanFilePath)
	r.mu.Unlock()
	assert.True(t, r.IsPlanModeActive())
}

func TestRunner_EmitPlanApprovalRequest_AutoApprovesWhenNoContent(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	ch := r.EmitPlanApprovalRequest("req-auto", "")

	select {
	case result := <-ch:
		assert.True(t, result.Approved)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for auto-approval")
	}
}

func TestRunner_EmitPlanApprovalRequest_ReadsTrackedFile(t *testing.T) {
	// Create a temporary plan file
	tmpDir := t.TempDir()
	planPath := filepath.Join(tmpDir, "plan.md")
	require.NoError(t, os.WriteFile(planPath, []byte("# My Plan\n\nStep 1: Do the thing"), 0644))

	r := NewRunner(defaultOpts(), nil)
	r.mu.Lock()
	r.lastPlanFilePath = planPath
	r.mu.Unlock()

	// Drain the output channel to prevent blocking on emit
	go func() {
		for range r.output {
		}
	}()

	ch := r.EmitPlanApprovalRequest("req-file", "")

	// Should NOT auto-approve — it read content from the file
	select {
	case <-ch:
		t.Fatal("should not have auto-approved — plan content was read from file")
	case <-time.After(100 * time.Millisecond):
		// Expected: channel blocks because it's waiting for user approval
	}

	// Verify the path was cleared after emitting
	r.mu.Lock()
	assert.Equal(t, "", r.lastPlanFilePath)
	r.mu.Unlock()
}

func TestRunner_EmitPlanApprovalRequest_ResolvesRelativePath(t *testing.T) {
	// Create a temporary workdir with a plan file
	tmpDir := t.TempDir()
	plansDir := filepath.Join(tmpDir, ".claude", "plans")
	require.NoError(t, os.MkdirAll(plansDir, 0755))
	planPath := filepath.Join(plansDir, "plan.md")
	require.NoError(t, os.WriteFile(planPath, []byte("# Relative Plan"), 0644))

	opts := defaultOpts()
	opts.Workdir = tmpDir
	r := NewRunner(opts, nil)

	// Set a relative path (no leading /)
	r.mu.Lock()
	r.lastPlanFilePath = ".claude/plans/plan.md"
	r.mu.Unlock()

	go func() {
		for range r.output {
		}
	}()

	ch := r.EmitPlanApprovalRequest("req-rel", "")

	// Should NOT auto-approve — it resolved the relative path and read content
	select {
	case <-ch:
		t.Fatal("should not have auto-approved — plan content was read from file")
	case <-time.After(100 * time.Millisecond):
		// Expected: blocks waiting for approval
	}
}

func TestRunner_EmitPlanApprovalRequest_UsesExplicitContent(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	// Set a tracked path that should be ignored when explicit content is provided
	r.mu.Lock()
	r.lastPlanFilePath = "/should/not/be/read"
	r.mu.Unlock()

	go func() {
		for range r.output {
		}
	}()

	ch := r.EmitPlanApprovalRequest("req-explicit", "Explicit plan content")

	// Should NOT auto-approve — explicit content was provided
	select {
	case <-ch:
		t.Fatal("should not have auto-approved — explicit content was provided")
	case <-time.After(100 * time.Millisecond):
		// Expected: blocks waiting for approval
	}
}

func TestRunner_EmitPlanApprovalRequest_ClearsPathOnAutoApprove(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)

	// Set a path to a non-existent file — should fail to read, then auto-approve
	r.mu.Lock()
	r.lastPlanFilePath = "/nonexistent/plan.md"
	r.mu.Unlock()

	ch := r.EmitPlanApprovalRequest("req-missing", "")

	select {
	case result := <-ch:
		assert.True(t, result.Approved)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for auto-approval")
	}

	r.mu.Lock()
	assert.Equal(t, "", r.lastPlanFilePath)
	r.mu.Unlock()
}

func TestRunner_SendPlanApprovalResponse_ClearsLastPlanFilePath(t *testing.T) {
	r := NewRunner(defaultOpts(), nil)
	ch := make(chan builtin.PlanApprovalResult, 1)
	r.pendingPlanApprovals.Store("req-clear", ch)

	r.mu.Lock()
	r.lastPlanFilePath = "/some/plan.md"
	r.mu.Unlock()

	err := r.SendPlanApprovalResponse("req-clear", true, "approved")
	assert.NoError(t, err)

	r.mu.Lock()
	assert.Equal(t, "", r.lastPlanFilePath)
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
