package scripts

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

// testCallbacks collects runner callback invocations for assertions
type testCallbacks struct {
	mu             sync.Mutex
	outputLines    []outputLine
	statusUpdates  []statusUpdate
	setupProgresses []setupProgressUpdate
}

type outputLine struct {
	sessionID string
	runID     string
	line      string
}

type statusUpdate struct {
	sessionID string
	run       *ScriptRun
}

type setupProgressUpdate struct {
	sessionID string
	current   int
	total     int
	status    string
}

func newTestCallbacks() *testCallbacks {
	return &testCallbacks{}
}

func (tc *testCallbacks) onOutput(sessionID, runID, line string) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	tc.outputLines = append(tc.outputLines, outputLine{sessionID, runID, line})
}

func (tc *testCallbacks) onStatus(sessionID string, run *ScriptRun) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	tc.statusUpdates = append(tc.statusUpdates, statusUpdate{sessionID, run})
}

func (tc *testCallbacks) onSetupProgress(sessionID string, current, total int, status string) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	tc.setupProgresses = append(tc.setupProgresses, setupProgressUpdate{sessionID, current, total, status})
}

func (tc *testCallbacks) getOutputLines() []outputLine {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	cp := make([]outputLine, len(tc.outputLines))
	copy(cp, tc.outputLines)
	return cp
}

func (tc *testCallbacks) getStatusUpdates() []statusUpdate {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	cp := make([]statusUpdate, len(tc.statusUpdates))
	copy(cp, tc.statusUpdates)
	return cp
}

func (tc *testCallbacks) getSetupProgresses() []setupProgressUpdate {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	cp := make([]setupProgressUpdate, len(tc.setupProgresses))
	copy(cp, tc.setupProgresses)
	return cp
}

func newTestRunner(tc *testCallbacks) *Runner {
	return NewRunner(tc.onOutput, tc.onStatus, tc.onSetupProgress)
}

func TestRunScript_Success(t *testing.T) {
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	runID, err := runner.RunScript(context.Background(), "sess-1", t.TempDir(), "test", ScriptDef{
		Name:    "Echo",
		Command: "echo hello world",
	})
	if err != nil {
		t.Fatalf("RunScript() error = %v", err)
	}
	if runID == "" {
		t.Fatal("RunScript() returned empty runID")
	}

	// Wait for script to finish
	waitForRunStatus(t, runner, runID, ScriptStatusSuccess, 5*time.Second)

	run := runner.GetRun(runID)
	if run == nil {
		t.Fatal("GetRun() returned nil")
	}
	if run.Status != ScriptStatusSuccess {
		t.Errorf("status = %q, want %q", run.Status, ScriptStatusSuccess)
	}
	if run.ExitCode == nil || *run.ExitCode != 0 {
		t.Errorf("exitCode = %v, want 0", run.ExitCode)
	}

	// Verify output was captured
	lines := tc.getOutputLines()
	found := false
	for _, l := range lines {
		if strings.Contains(l.line, "hello world") {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected 'hello world' in output lines")
	}
}

func TestRunScript_Failure(t *testing.T) {
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	runID, err := runner.RunScript(context.Background(), "sess-1", t.TempDir(), "test", ScriptDef{
		Name:    "Fail",
		Command: "exit 42",
	})
	if err != nil {
		t.Fatalf("RunScript() error = %v", err)
	}

	waitForRunStatus(t, runner, runID, ScriptStatusFailed, 5*time.Second)

	run := runner.GetRun(runID)
	if run.Status != ScriptStatusFailed {
		t.Errorf("status = %q, want %q", run.Status, ScriptStatusFailed)
	}
	if run.ExitCode == nil || *run.ExitCode != 42 {
		t.Errorf("exitCode = %v, want 42", run.ExitCode)
	}
}

func TestRunScript_OutputStreaming(t *testing.T) {
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	runID, err := runner.RunScript(context.Background(), "sess-1", t.TempDir(), "test", ScriptDef{
		Name:    "Multi-line",
		Command: "echo line1 && echo line2 && echo line3",
	})
	if err != nil {
		t.Fatalf("RunScript() error = %v", err)
	}

	waitForRunStatus(t, runner, runID, ScriptStatusSuccess, 5*time.Second)

	run := runner.GetRun(runID)
	run.mu.Lock()
	outputLen := len(run.Output)
	run.mu.Unlock()

	if outputLen < 3 {
		t.Errorf("expected at least 3 output lines, got %d", outputLen)
	}
}

func TestRunScript_Stderr(t *testing.T) {
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	runID, err := runner.RunScript(context.Background(), "sess-1", t.TempDir(), "test", ScriptDef{
		Name:    "Stderr",
		Command: "echo error_msg >&2",
	})
	if err != nil {
		t.Fatalf("RunScript() error = %v", err)
	}

	waitForRunStatus(t, runner, runID, ScriptStatusSuccess, 5*time.Second)

	lines := tc.getOutputLines()
	found := false
	for _, l := range lines {
		if strings.Contains(l.line, "error_msg") {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected stderr output to be captured")
	}
}

func TestRunScript_Workdir(t *testing.T) {
	dir := t.TempDir()
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	runID, err := runner.RunScript(context.Background(), "sess-1", dir, "test", ScriptDef{
		Name:    "PWD",
		Command: "pwd",
	})
	if err != nil {
		t.Fatalf("RunScript() error = %v", err)
	}

	waitForRunStatus(t, runner, runID, ScriptStatusSuccess, 5*time.Second)

	lines := tc.getOutputLines()
	found := false
	for _, l := range lines {
		if strings.Contains(l.line, dir) {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected workdir %q in output, got %v", dir, lines)
	}
}

func TestRunScript_StatusCallbacks(t *testing.T) {
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	runID, err := runner.RunScript(context.Background(), "sess-1", t.TempDir(), "test", ScriptDef{
		Name:    "Quick",
		Command: "true",
	})
	if err != nil {
		t.Fatalf("RunScript() error = %v", err)
	}

	waitForRunStatus(t, runner, runID, ScriptStatusSuccess, 5*time.Second)

	updates := tc.getStatusUpdates()
	// Should have at least 2 status updates: one for running, one for final status.
	// Note: since callbacks receive a pointer, the status may be mutated by the time
	// we inspect it, so we just verify the callback count.
	if len(updates) < 2 {
		t.Fatalf("expected at least 2 status updates (running + success), got %d", len(updates))
	}

	// Last update's run should be success
	lastRun := updates[len(updates)-1].run
	lastRun.mu.Lock()
	lastStatus := lastRun.Status
	lastRun.mu.Unlock()
	if lastStatus != ScriptStatusSuccess {
		t.Errorf("last status = %q, want %q", lastStatus, ScriptStatusSuccess)
	}
}

func TestStopScript(t *testing.T) {
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	runID, err := runner.RunScript(context.Background(), "sess-1", t.TempDir(), "test", ScriptDef{
		Name:    "Long",
		Command: "sleep 60",
	})
	if err != nil {
		t.Fatalf("RunScript() error = %v", err)
	}

	// Give it a moment to start
	time.Sleep(100 * time.Millisecond)

	if err := runner.StopScript(runID); err != nil {
		t.Fatalf("StopScript() error = %v", err)
	}

	waitForRunStatus(t, runner, runID, ScriptStatusCancelled, 5*time.Second)

	run := runner.GetRun(runID)
	if run.Status != ScriptStatusCancelled {
		t.Errorf("status = %q, want %q", run.Status, ScriptStatusCancelled)
	}
}

func TestStopScript_NotFound(t *testing.T) {
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	err := runner.StopScript("nonexistent")
	if err == nil {
		t.Error("StopScript() expected error for nonexistent run")
	}
}

func TestStopScript_AlreadyFinished(t *testing.T) {
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	runID, _ := runner.RunScript(context.Background(), "sess-1", t.TempDir(), "test", ScriptDef{
		Name:    "Quick",
		Command: "true",
	})

	waitForRunStatus(t, runner, runID, ScriptStatusSuccess, 5*time.Second)

	err := runner.StopScript(runID)
	if err == nil {
		t.Error("StopScript() expected error for finished run")
	}
}

func TestGetSessionRuns(t *testing.T) {
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	id1, _ := runner.RunScript(context.Background(), "sess-1", t.TempDir(), "a", ScriptDef{Name: "A", Command: "true"})
	id2, _ := runner.RunScript(context.Background(), "sess-1", t.TempDir(), "b", ScriptDef{Name: "B", Command: "true"})
	_, _ = runner.RunScript(context.Background(), "sess-2", t.TempDir(), "c", ScriptDef{Name: "C", Command: "true"})

	waitForRunStatus(t, runner, id1, ScriptStatusSuccess, 5*time.Second)
	waitForRunStatus(t, runner, id2, ScriptStatusSuccess, 5*time.Second)

	runs := runner.GetSessionRuns("sess-1")
	if len(runs) != 2 {
		t.Errorf("GetSessionRuns() returned %d runs, want 2", len(runs))
	}
}

func TestCancelSessionRuns(t *testing.T) {
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	id1, _ := runner.RunScript(context.Background(), "sess-1", t.TempDir(), "a", ScriptDef{Name: "A", Command: "sleep 60"})
	id2, _ := runner.RunScript(context.Background(), "sess-1", t.TempDir(), "b", ScriptDef{Name: "B", Command: "sleep 60"})

	time.Sleep(100 * time.Millisecond)

	runner.CancelSessionRuns("sess-1")

	waitForRunStatus(t, runner, id1, ScriptStatusCancelled, 5*time.Second)
	waitForRunStatus(t, runner, id2, ScriptStatusCancelled, 5*time.Second)
}

func TestRunSetupScripts_AllPass(t *testing.T) {
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	scripts := []ScriptDef{
		{Name: "Step 1", Command: "echo step1"},
		{Name: "Step 2", Command: "echo step2"},
		{Name: "Step 3", Command: "echo step3"},
	}

	err := runner.RunSetupScripts(context.Background(), "sess-1", t.TempDir(), scripts)
	if err != nil {
		t.Fatalf("RunSetupScripts() error = %v", err)
	}

	// Wait for setup to complete
	waitForSetupComplete(t, tc, "sess-1", 5*time.Second)

	progresses := tc.getSetupProgresses()
	// Should have progress events for each step + completed
	lastProgress := progresses[len(progresses)-1]
	if lastProgress.status != "completed" {
		t.Errorf("final progress status = %q, want %q", lastProgress.status, "completed")
	}
	if lastProgress.current != 3 || lastProgress.total != 3 {
		t.Errorf("final progress = %d/%d, want 3/3", lastProgress.current, lastProgress.total)
	}
}

func TestRunSetupScripts_StopsOnFailure(t *testing.T) {
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	scripts := []ScriptDef{
		{Name: "Step 1", Command: "echo ok"},
		{Name: "Step 2", Command: "exit 1"},
		{Name: "Step 3", Command: "echo should_not_run"},
	}

	err := runner.RunSetupScripts(context.Background(), "sess-1", t.TempDir(), scripts)
	if err != nil {
		t.Fatalf("RunSetupScripts() error = %v", err)
	}

	waitForSetupFailed(t, tc, "sess-1", 5*time.Second)

	progresses := tc.getSetupProgresses()
	lastProgress := progresses[len(progresses)-1]
	if lastProgress.status != "failed" {
		t.Errorf("final progress status = %q, want %q", lastProgress.status, "failed")
	}

	// Step 3 should not have run — check output
	lines := tc.getOutputLines()
	for _, l := range lines {
		if strings.Contains(l.line, "should_not_run") {
			t.Error("Step 3 should not have executed after Step 2 failed")
		}
	}
}

func TestRunSetupScripts_DuplicatePrevention(t *testing.T) {
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	scripts := []ScriptDef{
		{Name: "Long", Command: "sleep 5"},
	}

	err := runner.RunSetupScripts(context.Background(), "sess-1", t.TempDir(), scripts)
	if err != nil {
		t.Fatalf("first RunSetupScripts() error = %v", err)
	}

	// Give goroutine time to start
	time.Sleep(50 * time.Millisecond)

	// Second call should fail
	err = runner.RunSetupScripts(context.Background(), "sess-1", t.TempDir(), scripts)
	if err == nil {
		t.Error("second RunSetupScripts() expected error for duplicate setup")
	}

	// Cleanup
	runner.CancelSessionRuns("sess-1")
}

func TestNewRunner(t *testing.T) {
	runner := NewRunner(nil, nil, nil)
	if runner == nil {
		t.Fatal("NewRunner() returned nil")
	}
	if runner.activeRuns == nil {
		t.Error("activeRuns not initialized")
	}
	if runner.sessionSetups == nil {
		t.Error("sessionSetups not initialized")
	}
}

func TestRunScript_ContextCancellation(t *testing.T) {
	tc := newTestCallbacks()
	runner := newTestRunner(tc)

	ctx, cancel := context.WithCancel(context.Background())

	runID, err := runner.RunScript(ctx, "sess-1", t.TempDir(), "test", ScriptDef{
		Name:    "Long",
		Command: "sleep 60",
	})
	if err != nil {
		t.Fatalf("RunScript() error = %v", err)
	}

	time.Sleep(100 * time.Millisecond)
	cancel()

	waitForRunStatus(t, runner, runID, ScriptStatusCancelled, 5*time.Second)
}

// --- helpers ---

func waitForRunStatus(t *testing.T, runner *Runner, runID string, want ScriptStatus, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		run := runner.GetRun(runID)
		if run != nil {
			run.mu.Lock()
			status := run.Status
			run.mu.Unlock()
			if status == want {
				return
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for run %s to reach status %q", runID, want)
}

func waitForSetupComplete(t *testing.T, tc *testCallbacks, sessionID string, timeout time.Duration) {
	t.Helper()
	waitForSetupStatus(t, tc, sessionID, "completed", timeout)
}

func waitForSetupFailed(t *testing.T, tc *testCallbacks, sessionID string, timeout time.Duration) {
	t.Helper()
	waitForSetupStatus(t, tc, sessionID, "failed", timeout)
}

func waitForSetupStatus(t *testing.T, tc *testCallbacks, sessionID, wantStatus string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		progresses := tc.getSetupProgresses()
		for _, p := range progresses {
			if p.sessionID == sessionID && p.status == wantStatus {
				return
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for setup %s to reach status %q", sessionID, wantStatus)
}
