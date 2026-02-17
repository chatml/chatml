package automation

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/server"
	"github.com/chatml/chatml-backend/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================================
// Test helpers
// ============================================================================

func newTestEngine(t *testing.T) (*Engine, *store.SQLiteStore) {
	t.Helper()

	s, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })

	hub := server.NewHub()
	go hub.Run()

	engine := NewEngine(context.Background(), s, hub)
	return engine, s
}

// mockExecutor is a controllable StepExecutor for testing.
type mockExecutor struct {
	mu       sync.Mutex
	calls    []StepContext
	resultFn func(step StepContext) (*StepResult, error)
}

func newMockExecutor(fn func(step StepContext) (*StepResult, error)) *mockExecutor {
	return &mockExecutor{resultFn: fn}
}

func (m *mockExecutor) Execute(ctx context.Context, step StepContext) (*StepResult, error) {
	m.mu.Lock()
	m.calls = append(m.calls, step)
	m.mu.Unlock()
	return m.resultFn(step)
}

func (m *mockExecutor) callCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.calls)
}

// signallingBlockExecutor signals on a channel when Execute starts, then blocks until ctx is done.
type signallingBlockExecutor struct {
	started chan struct{}
}

func (e *signallingBlockExecutor) Execute(ctx context.Context, step StepContext) (*StepResult, error) {
	close(e.started)
	<-ctx.Done()
	return nil, ctx.Err()
}

// createTestWorkflow inserts a workflow with a given graph.
func createTestWorkflow(t *testing.T, s *store.SQLiteStore, graphJSON string) *models.Workflow {
	t.Helper()
	w := &models.Workflow{
		ID:        fmt.Sprintf("wf-%d", time.Now().UnixNano()),
		Name:      "Test Workflow",
		Enabled:   true,
		GraphJSON: graphJSON,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	require.NoError(t, s.AddWorkflow(context.Background(), w))
	return w
}

func simpleLinearGraph() string {
	return `{
		"nodes": [
			{"id": "trigger", "type": "trigger-manual", "data": {"kind": "trigger-manual", "label": "Start", "config": {}}},
			{"id": "action", "type": "action-webhook", "data": {"kind": "action-webhook", "label": "Webhook", "config": {"url": "http://example.com"}}}
		],
		"edges": [
			{"id": "e1", "source": "trigger", "target": "action"}
		]
	}`
}

func threeStepGraph() string {
	return `{
		"nodes": [
			{"id": "trigger", "type": "trigger-manual", "data": {"kind": "trigger-manual", "label": "Start", "config": {}}},
			{"id": "step1", "type": "action-webhook", "data": {"kind": "action-webhook", "label": "Step 1", "config": {}}},
			{"id": "step2", "type": "action-script", "data": {"kind": "action-script", "label": "Step 2", "config": {}}}
		],
		"edges": [
			{"id": "e1", "source": "trigger", "target": "step1"},
			{"id": "e2", "source": "step1", "target": "step2"}
		]
	}`
}

// ============================================================================
// StartRun
// ============================================================================

func TestStartRun_Success(t *testing.T) {
	engine, s := newTestEngine(t)
	engine.Start()
	defer engine.CancelRun("") // just in case

	// Register a mock executor that returns immediately
	mock := newMockExecutor(func(step StepContext) (*StepResult, error) {
		return &StepResult{OutputData: `{"ok": true}`}, nil
	})
	engine.RegisterExecutor("action-webhook", mock)

	w := createTestWorkflow(t, s, simpleLinearGraph())

	run, err := engine.StartRun(context.Background(), w.ID, "", "manual", map[string]interface{}{
		"trigger": "manual",
	})

	require.NoError(t, err)
	assert.NotEmpty(t, run.ID)
	assert.Equal(t, models.WorkflowRunStatusPending, run.Status)

	// Wait for completion
	require.Eventually(t, func() bool {
		r, _ := s.GetWorkflowRun(context.Background(), run.ID)
		return r != nil && r.Status == models.WorkflowRunStatusCompleted
	}, 3*time.Second, 50*time.Millisecond)

	assert.Equal(t, 1, mock.callCount())
}

func TestStartRun_WorkflowNotFound(t *testing.T) {
	engine, _ := newTestEngine(t)

	_, err := engine.StartRun(context.Background(), "nonexistent", "", "manual", nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestStartRun_WorkflowDisabled(t *testing.T) {
	engine, s := newTestEngine(t)

	w := createTestWorkflow(t, s, simpleLinearGraph())
	w.Enabled = false
	require.NoError(t, s.UpdateWorkflow(context.Background(), w))

	_, err := engine.StartRun(context.Background(), w.ID, "", "manual", nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "disabled")
}

// ============================================================================
// executeRun
// ============================================================================

func TestExecuteRun_LinearChain(t *testing.T) {
	engine, s := newTestEngine(t)
	engine.Start()

	callOrder := make([]string, 0)
	var mu sync.Mutex

	webhookMock := newMockExecutor(func(step StepContext) (*StepResult, error) {
		mu.Lock()
		callOrder = append(callOrder, "webhook")
		mu.Unlock()
		return &StepResult{OutputData: `{"step": 1}`}, nil
	})
	scriptMock := newMockExecutor(func(step StepContext) (*StepResult, error) {
		mu.Lock()
		callOrder = append(callOrder, "script")
		mu.Unlock()
		return &StepResult{OutputData: `{"step": 2}`}, nil
	})
	engine.RegisterExecutor("action-webhook", webhookMock)
	engine.RegisterExecutor("action-script", scriptMock)

	w := createTestWorkflow(t, s, threeStepGraph())
	run, err := engine.StartRun(context.Background(), w.ID, "", "manual", map[string]interface{}{})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		r, _ := s.GetWorkflowRun(context.Background(), run.ID)
		return r != nil && r.Status == models.WorkflowRunStatusCompleted
	}, 3*time.Second, 50*time.Millisecond)

	mu.Lock()
	assert.Equal(t, []string{"webhook", "script"}, callOrder)
	mu.Unlock()

	// Verify run output is last step's output
	finalRun, _ := s.GetWorkflowRun(context.Background(), run.ID)
	assert.Contains(t, finalRun.OutputData, `"step"`)
}

func TestExecuteRun_StepFailure_StopMode(t *testing.T) {
	engine, s := newTestEngine(t)
	engine.Start()

	webhookMock := newMockExecutor(func(step StepContext) (*StepResult, error) {
		return nil, fmt.Errorf("connection refused")
	})
	scriptMock := newMockExecutor(func(step StepContext) (*StepResult, error) {
		return &StepResult{OutputData: `{}`}, nil
	})
	engine.RegisterExecutor("action-webhook", webhookMock)
	engine.RegisterExecutor("action-script", scriptMock)

	w := createTestWorkflow(t, s, threeStepGraph())
	run, err := engine.StartRun(context.Background(), w.ID, "", "manual", map[string]interface{}{})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		r, _ := s.GetWorkflowRun(context.Background(), run.ID)
		return r != nil && r.Status == models.WorkflowRunStatusFailed
	}, 3*time.Second, 50*time.Millisecond)

	// Script should never have been called
	assert.Equal(t, 0, scriptMock.callCount())

	finalRun, _ := s.GetWorkflowRun(context.Background(), run.ID)
	assert.Contains(t, finalRun.Error, "connection refused")
}

func TestExecuteRun_StepFailure_SkipMode(t *testing.T) {
	engine, s := newTestEngine(t)
	engine.Start()

	// Step 1 fails but has onFailure: skip
	graphJSON := `{
		"nodes": [
			{"id": "trigger", "type": "trigger-manual", "data": {"kind": "trigger-manual", "label": "Start", "config": {}}},
			{"id": "step1", "type": "action-webhook", "data": {"kind": "action-webhook", "label": "Step 1", "config": {"onFailure": "skip"}}},
			{"id": "step2", "type": "action-script", "data": {"kind": "action-script", "label": "Step 2", "config": {}}}
		],
		"edges": [
			{"id": "e1", "source": "trigger", "target": "step1"},
			{"id": "e2", "source": "step1", "target": "step2"}
		]
	}`

	webhookMock := newMockExecutor(func(step StepContext) (*StepResult, error) {
		return nil, fmt.Errorf("webhook failed")
	})
	scriptMock := newMockExecutor(func(step StepContext) (*StepResult, error) {
		return &StepResult{OutputData: `{"done": true}`}, nil
	})
	engine.RegisterExecutor("action-webhook", webhookMock)
	engine.RegisterExecutor("action-script", scriptMock)

	w := createTestWorkflow(t, s, graphJSON)
	run, err := engine.StartRun(context.Background(), w.ID, "", "manual", map[string]interface{}{})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		r, _ := s.GetWorkflowRun(context.Background(), run.ID)
		return r != nil && (r.Status == models.WorkflowRunStatusCompleted || r.Status == models.WorkflowRunStatusFailed)
	}, 3*time.Second, 50*time.Millisecond)

	// Script should have been called (skip continues pipeline)
	assert.Equal(t, 1, scriptMock.callCount())

	finalRun, _ := s.GetWorkflowRun(context.Background(), run.ID)
	assert.Equal(t, models.WorkflowRunStatusCompleted, finalRun.Status)
}

func TestExecuteRun_StepFailure_RetryMode(t *testing.T) {
	engine, s := newTestEngine(t)
	engine.Start()

	graphJSON := `{
		"nodes": [
			{"id": "trigger", "type": "trigger-manual", "data": {"kind": "trigger-manual", "label": "Start", "config": {}}},
			{"id": "step1", "type": "action-webhook", "data": {"kind": "action-webhook", "label": "Retry Step", "config": {"onFailure": "retry", "maxRetries": 2}}}
		],
		"edges": [
			{"id": "e1", "source": "trigger", "target": "step1"}
		]
	}`

	callCount := 0
	var mu sync.Mutex
	webhookMock := newMockExecutor(func(step StepContext) (*StepResult, error) {
		mu.Lock()
		callCount++
		c := callCount
		mu.Unlock()
		if c <= 2 {
			return nil, fmt.Errorf("temporary error %d", c)
		}
		return &StepResult{OutputData: `{"retried": true}`}, nil
	})
	engine.RegisterExecutor("action-webhook", webhookMock)

	w := createTestWorkflow(t, s, graphJSON)
	run, err := engine.StartRun(context.Background(), w.ID, "", "manual", map[string]interface{}{})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		r, _ := s.GetWorkflowRun(context.Background(), run.ID)
		return r != nil && (r.Status == models.WorkflowRunStatusCompleted || r.Status == models.WorkflowRunStatusFailed)
	}, 15*time.Second, 100*time.Millisecond)

	finalRun, _ := s.GetWorkflowRun(context.Background(), run.ID)
	assert.Equal(t, models.WorkflowRunStatusCompleted, finalRun.Status)

	mu.Lock()
	assert.Equal(t, 3, callCount) // 1 initial + 2 retries
	mu.Unlock()
}

func TestExecuteRun_RetryExhausted(t *testing.T) {
	engine, s := newTestEngine(t)
	engine.Start()

	graphJSON := `{
		"nodes": [
			{"id": "trigger", "type": "trigger-manual", "data": {"kind": "trigger-manual", "label": "Start", "config": {}}},
			{"id": "step1", "type": "action-webhook", "data": {"kind": "action-webhook", "label": "Always Fails", "config": {"onFailure": "retry", "maxRetries": 1}}}
		],
		"edges": [
			{"id": "e1", "source": "trigger", "target": "step1"}
		]
	}`

	webhookMock := newMockExecutor(func(step StepContext) (*StepResult, error) {
		return nil, fmt.Errorf("permanent error")
	})
	engine.RegisterExecutor("action-webhook", webhookMock)

	w := createTestWorkflow(t, s, graphJSON)
	run, err := engine.StartRun(context.Background(), w.ID, "", "manual", map[string]interface{}{})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		r, _ := s.GetWorkflowRun(context.Background(), run.ID)
		return r != nil && r.Status == models.WorkflowRunStatusFailed
	}, 15*time.Second, 100*time.Millisecond)

	// Should have been called 2 times (initial + 1 retry)
	assert.Equal(t, 2, webhookMock.callCount())

	finalRun, _ := s.GetWorkflowRun(context.Background(), run.ID)
	assert.Contains(t, finalRun.Error, "permanent error")
	assert.Contains(t, finalRun.Error, "1 retries")
}

func TestExecuteRun_EmptyGraph(t *testing.T) {
	engine, s := newTestEngine(t)
	engine.Start()

	w := createTestWorkflow(t, s, `{"nodes": [], "edges": []}`)
	run, err := engine.StartRun(context.Background(), w.ID, "", "manual", map[string]interface{}{})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		r, _ := s.GetWorkflowRun(context.Background(), run.ID)
		return r != nil && r.Status == models.WorkflowRunStatusCompleted
	}, 3*time.Second, 50*time.Millisecond)
}

func TestExecuteRun_InvalidGraph(t *testing.T) {
	engine, s := newTestEngine(t)
	engine.Start()

	w := createTestWorkflow(t, s, `not valid json`)
	run, err := engine.StartRun(context.Background(), w.ID, "", "manual", map[string]interface{}{})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		r, _ := s.GetWorkflowRun(context.Background(), run.ID)
		return r != nil && r.Status == models.WorkflowRunStatusFailed
	}, 3*time.Second, 50*time.Millisecond)

	finalRun, _ := s.GetWorkflowRun(context.Background(), run.ID)
	assert.Contains(t, finalRun.Error, "parse graph")
}

func TestCancelRun_TracksActiveRuns(t *testing.T) {
	engine, _ := newTestEngine(t)

	// CancelRun on a non-existent run should not panic
	engine.CancelRun("nonexistent")

	// Verify activeRuns tracking works
	engine.mu.RLock()
	assert.Empty(t, engine.activeRuns)
	engine.mu.RUnlock()
}

func TestExecuteRun_CancelRun(t *testing.T) {
	engine, s := newTestEngine(t)
	engine.Start()

	graphJSON := `{
		"nodes": [
			{"id": "trigger", "type": "trigger-manual", "data": {"kind": "trigger-manual", "label": "Start", "config": {}}},
			{"id": "slow", "type": "action-webhook", "data": {"kind": "action-webhook", "label": "Slow", "config": {}}}
		],
		"edges": [
			{"id": "e1", "source": "trigger", "target": "slow"}
		]
	}`

	started := make(chan struct{})
	// Context-aware executor that signals when it starts, then blocks
	engine.RegisterExecutor("action-webhook", &signallingBlockExecutor{started: started})

	w := createTestWorkflow(t, s, graphJSON)
	run, err := engine.StartRun(context.Background(), w.ID, "", "manual", map[string]interface{}{})
	require.NoError(t, err)

	// Wait for executor to actually start
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("executor never started")
	}

	// Cancel the run
	engine.CancelRun(run.ID)

	// May end as cancelled or failed (context.Canceled error from executor)
	require.Eventually(t, func() bool {
		r, _ := s.GetWorkflowRun(context.Background(), run.ID)
		return r != nil && (r.Status == models.WorkflowRunStatusCancelled || r.Status == models.WorkflowRunStatusFailed)
	}, 5*time.Second, 50*time.Millisecond)
}

// ============================================================================
// buildStepInput
// ============================================================================

func TestBuildStepInput_RootNode(t *testing.T) {
	engine, _ := newTestEngine(t)

	g := buildGraph(
		[]nodeSpec{{"trigger", "trigger-manual"}},
		nil,
	)

	result := engine.buildStepInput(`{"trigger": "manual"}`, "trigger", g, map[string]string{})
	assert.Equal(t, `{"trigger": "manual"}`, result)
}

func TestBuildStepInput_SingleParent(t *testing.T) {
	engine, _ := newTestEngine(t)

	g := buildGraph(
		[]nodeSpec{{"trigger", "trigger-manual"}, {"action", "action-webhook"}},
		[][2]string{{"trigger", "action"}},
	)

	nodeOutputs := map[string]string{
		"trigger": `{"data": "hello"}`,
	}

	result := engine.buildStepInput(`{"trigger": "manual"}`, "action", g, nodeOutputs)

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result), &parsed))

	// Should have "trigger" (run input), "input" (single parent alias), and parent ID key
	assert.NotNil(t, parsed["trigger"])
	assert.NotNil(t, parsed["input"])
	assert.NotNil(t, parsed["trigger"])
}

func TestBuildStepInput_MultipleParents(t *testing.T) {
	engine, _ := newTestEngine(t)

	// n1 → n3, n2 → n3
	g := buildGraph(
		[]nodeSpec{{"n1", "trigger-manual"}, {"n2", "action-webhook"}, {"n3", "action-script"}},
		[][2]string{{"n1", "n3"}, {"n2", "n3"}},
	)

	nodeOutputs := map[string]string{
		"n1": `{"from": "n1"}`,
		"n2": `{"from": "n2"}`,
	}

	result := engine.buildStepInput(`{"run": true}`, "n3", g, nodeOutputs)

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(result), &parsed))

	// Should have both parents keyed by their node ID
	assert.NotNil(t, parsed["n1"])
	assert.NotNil(t, parsed["n2"])

	// "input" alias should NOT be set for multiple parents
	assert.Nil(t, parsed["input"])
}

// ============================================================================
// intFromConfig
// ============================================================================

func TestIntFromConfig_Float64(t *testing.T) {
	config := map[string]interface{}{"maxRetries": float64(3)}
	assert.Equal(t, 3, intFromConfig(config, "maxRetries", 0))
}

func TestIntFromConfig_Int(t *testing.T) {
	config := map[string]interface{}{"maxRetries": 5}
	assert.Equal(t, 5, intFromConfig(config, "maxRetries", 0))
}

func TestIntFromConfig_Missing(t *testing.T) {
	config := map[string]interface{}{}
	assert.Equal(t, 7, intFromConfig(config, "maxRetries", 7))
}

func TestIntFromConfig_InvalidType(t *testing.T) {
	config := map[string]interface{}{"maxRetries": "three"}
	assert.Equal(t, 0, intFromConfig(config, "maxRetries", 0))
}

// ============================================================================
// isTriggerKind
// ============================================================================

func TestIsTriggerKind(t *testing.T) {
	assert.True(t, isTriggerKind("trigger-manual"))
	assert.True(t, isTriggerKind("trigger-cron"))
	assert.True(t, isTriggerKind("trigger-webhook"))
	assert.True(t, isTriggerKind("trigger-event"))
	assert.False(t, isTriggerKind("action-agent"))
	assert.False(t, isTriggerKind("logic-conditional"))
	assert.False(t, isTriggerKind("data-transform"))
	assert.False(t, isTriggerKind("short"))
}

// ============================================================================
// timeSinceMs
// ============================================================================

func TestTimeSinceMs_Nil(t *testing.T) {
	assert.Equal(t, int64(0), timeSinceMs(nil))
}

func TestTimeSinceMs_Recent(t *testing.T) {
	now := time.Now()
	ms := timeSinceMs(&now)
	assert.GreaterOrEqual(t, ms, int64(0))
	assert.Less(t, ms, int64(100))
}

// ============================================================================
// StepRuns persistence
// ============================================================================

func TestExecuteRun_CreatesStepRuns(t *testing.T) {
	engine, s := newTestEngine(t)
	engine.Start()

	webhookMock := newMockExecutor(func(step StepContext) (*StepResult, error) {
		return &StepResult{OutputData: `{"ok": true}`}, nil
	})
	engine.RegisterExecutor("action-webhook", webhookMock)

	w := createTestWorkflow(t, s, simpleLinearGraph())
	run, err := engine.StartRun(context.Background(), w.ID, "", "manual", map[string]interface{}{})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		r, _ := s.GetWorkflowRun(context.Background(), run.ID)
		return r != nil && r.Status == models.WorkflowRunStatusCompleted
	}, 3*time.Second, 50*time.Millisecond)

	// Should have 2 step runs (trigger + action)
	steps, err := s.ListStepRuns(context.Background(), run.ID)
	require.NoError(t, err)
	assert.Len(t, steps, 2)

	// Both should be completed
	for _, step := range steps {
		assert.Equal(t, "completed", step.Status)
	}
}
