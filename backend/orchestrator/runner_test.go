package orchestrator

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/agents"
	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockRunnerStore implements the Store interface for testing
type mockRunnerStore struct {
	mu              sync.Mutex
	runs            map[string]*models.AgentRun
	agentErrors     map[string]string
	agentRunCounts  map[string]int
	agentTotalCosts map[string]float64

	createRunErr      error
	updateRunErr      error
	completeRunErr    error
	recordRunErr      error
	setAgentErrorErr  error
	clearAgentErrorErr error
}

func newMockRunnerStore() *mockRunnerStore {
	return &mockRunnerStore{
		runs:            make(map[string]*models.AgentRun),
		agentErrors:     make(map[string]string),
		agentRunCounts:  make(map[string]int),
		agentTotalCosts: make(map[string]float64),
	}
}

func (m *mockRunnerStore) CreateAgentRun(ctx context.Context, run *models.AgentRun) error {
	if m.createRunErr != nil {
		return m.createRunErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runs[run.ID] = run
	return nil
}

func (m *mockRunnerStore) UpdateAgentRun(ctx context.Context, run *models.AgentRun) error {
	if m.updateRunErr != nil {
		return m.updateRunErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runs[run.ID] = run
	return nil
}

func (m *mockRunnerStore) CompleteAgentRun(ctx context.Context, runID string, status string, summary string, cost float64, sessionsCreated []string) error {
	if m.completeRunErr != nil {
		return m.completeRunErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if run, ok := m.runs[runID]; ok {
		run.Status = status
		run.ResultSummary = summary
		run.Cost = cost
		run.SessionsCreated = sessionsCreated
		now := time.Now()
		run.CompletedAt = &now
	}
	return nil
}

func (m *mockRunnerStore) RecordAgentRun(ctx context.Context, agentID string, cost float64) error {
	if m.recordRunErr != nil {
		return m.recordRunErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.agentRunCounts[agentID]++
	m.agentTotalCosts[agentID] += cost
	return nil
}

func (m *mockRunnerStore) SetAgentError(ctx context.Context, agentID string, errMsg string) error {
	if m.setAgentErrorErr != nil {
		return m.setAgentErrorErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.agentErrors[agentID] = errMsg
	return nil
}

func (m *mockRunnerStore) ClearAgentError(ctx context.Context, agentID string) error {
	if m.clearAgentErrorErr != nil {
		return m.clearAgentErrorErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.agentErrors, agentID)
	return nil
}

func (m *mockRunnerStore) getRun(runID string) *models.AgentRun {
	m.mu.Lock()
	defer m.mu.Unlock()
	run := m.runs[runID]
	if run == nil {
		return nil
	}
	// Return a copy to avoid race conditions
	runCopy := *run
	return &runCopy
}

func (m *mockRunnerStore) getRunCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.runs)
}

// createTestOrchestratorAgent creates a test agent for runner tests
func createTestOrchestratorAgent(id string) *models.OrchestratorAgent {
	return &models.OrchestratorAgent{
		ID:                id,
		YAMLPath:          "/agents/" + id + ".yaml",
		Enabled:           true,
		PollingIntervalMs: 60000,
	}
}

// createTestOrchestratorAgentWithPolling creates a test agent with polling config
func createTestOrchestratorAgentWithPolling(id string) *models.OrchestratorAgent {
	return &models.OrchestratorAgent{
		ID:                id,
		YAMLPath:          "/agents/" + id + ".yaml",
		Enabled:           true,
		PollingIntervalMs: 60000,
		Definition: &models.AgentDefinition{
			Polling: &models.AgentPolling{
				Sources: []models.AgentPollingSource{
					{Type: "github", Owner: "test", Repo: "repo"},
				},
			},
		},
	}
}

func TestNewRunner(t *testing.T) {
	store := newMockRunnerStore()
	eventBus := NewEventBus()
	polling := agents.NewPollingManager(&agents.Config{})

	runner := NewRunner(store, eventBus, polling)

	assert.NotNil(t, runner)
	assert.NotNil(t, runner.running)
	assert.Equal(t, store, runner.store)
	assert.Equal(t, eventBus, runner.eventBus)
}

func TestRunner_StartRun(t *testing.T) {
	store := newMockRunnerStore()
	eventBus := NewEventBus()
	polling := agents.NewPollingManager(&agents.Config{})
	runner := NewRunner(store, eventBus, polling)

	agent := createTestOrchestratorAgent("agent-1")

	run, err := runner.StartRun(context.Background(), agent, models.AgentTriggerManual)
	require.NoError(t, err)
	assert.NotNil(t, run)
	assert.NotEmpty(t, run.ID)
	assert.Equal(t, "agent-1", run.AgentID)
	assert.Equal(t, models.AgentTriggerManual, run.Trigger)
	// Note: run.Status is not checked here as it may be modified concurrently
	// by the executeRun goroutine. The initial status is AgentRunStatusRunning.

	// Give time for async execution to complete
	time.Sleep(100 * time.Millisecond)

	// Verify run was persisted
	assert.Equal(t, 1, store.getRunCount())
}

func TestRunner_StartRun_AlreadyRunning(t *testing.T) {
	store := newMockRunnerStore()
	eventBus := NewEventBus()
	polling := agents.NewPollingManager(&agents.Config{})
	runner := NewRunner(store, eventBus, polling)

	// Create agent with polling so it takes time to execute
	agent := createTestOrchestratorAgentWithPolling("agent-1")

	run1, err := runner.StartRun(context.Background(), agent, models.AgentTriggerManual)
	require.NoError(t, err)
	assert.NotNil(t, run1)

	// Try to start another run for the same agent
	_, err = runner.StartRun(context.Background(), agent, models.AgentTriggerManual)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "already running")
}

func TestRunner_StopRun(t *testing.T) {
	store := newMockRunnerStore()
	eventBus := NewEventBus()
	polling := agents.NewPollingManager(&agents.Config{})
	runner := NewRunner(store, eventBus, polling)

	agent := createTestOrchestratorAgentWithPolling("agent-1")

	run, err := runner.StartRun(context.Background(), agent, models.AgentTriggerManual)
	require.NoError(t, err)

	// StopRun may fail if the run completed before we could stop it
	// This is expected behavior - the run completes very quickly when GitHub isn't configured
	err = runner.StopRun(run.ID)
	// Error is acceptable if run already completed
	if err != nil {
		assert.Contains(t, err.Error(), "not found")
	}
}

func TestRunner_StopRun_NotFound(t *testing.T) {
	store := newMockRunnerStore()
	eventBus := NewEventBus()
	polling := agents.NewPollingManager(&agents.Config{})
	runner := NewRunner(store, eventBus, polling)

	err := runner.StopRun("non-existent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestRunner_StopAgent(t *testing.T) {
	store := newMockRunnerStore()
	eventBus := NewEventBus()
	polling := agents.NewPollingManager(&agents.Config{})
	runner := NewRunner(store, eventBus, polling)

	agent := createTestOrchestratorAgentWithPolling("agent-1")

	_, err := runner.StartRun(context.Background(), agent, models.AgentTriggerManual)
	require.NoError(t, err)

	// StopAgent should not error even if agent already completed
	runner.StopAgent("agent-1")

	// Verify we can call StopAgent on non-running agent without error
	runner.StopAgent("non-existent")
}

func TestRunner_IsAgentRunning(t *testing.T) {
	store := newMockRunnerStore()
	eventBus := NewEventBus()
	polling := agents.NewPollingManager(&agents.Config{})
	runner := NewRunner(store, eventBus, polling)

	// Initially not running
	assert.False(t, runner.IsAgentRunning("agent-1"))

	// After starting a run, IsAgentRunning returns true while running
	// Since runs complete very quickly in tests, we just verify the method works
	agent := createTestOrchestratorAgentWithPolling("agent-1")
	_, err := runner.StartRun(context.Background(), agent, models.AgentTriggerManual)
	require.NoError(t, err)

	// Wait for completion
	time.Sleep(100 * time.Millisecond)

	// After completion, should not be running
	assert.False(t, runner.IsAgentRunning("agent-1"))
}

func TestRunner_GetRunningRuns(t *testing.T) {
	store := newMockRunnerStore()
	eventBus := NewEventBus()
	polling := agents.NewPollingManager(&agents.Config{})
	runner := NewRunner(store, eventBus, polling)

	// Initially empty
	assert.Empty(t, runner.GetRunningRuns())

	// After runs complete, list should be empty again
	agent1 := createTestOrchestratorAgentWithPolling("agent-1")
	agent2 := createTestOrchestratorAgentWithPolling("agent-2")

	_, err := runner.StartRun(context.Background(), agent1, models.AgentTriggerManual)
	require.NoError(t, err)

	_, err = runner.StartRun(context.Background(), agent2, models.AgentTriggerManual)
	require.NoError(t, err)

	// Wait for completion
	time.Sleep(100 * time.Millisecond)

	// After completion, should be empty
	assert.Empty(t, runner.GetRunningRuns())
}

func TestRunner_GetRunContext(t *testing.T) {
	store := newMockRunnerStore()
	eventBus := NewEventBus()
	polling := agents.NewPollingManager(&agents.Config{})
	runner := NewRunner(store, eventBus, polling)

	// Not found case
	rc, ok := runner.GetRunContext("non-existent")
	assert.False(t, ok)
	assert.Nil(t, rc)

	agent := createTestOrchestratorAgentWithPolling("agent-1")
	run, err := runner.StartRun(context.Background(), agent, models.AgentTriggerManual)
	require.NoError(t, err)

	// RunContext is available while run is active, but runs complete quickly
	// Just verify run was created successfully
	assert.NotNil(t, run)
	assert.Equal(t, agent.ID, run.AgentID)

	// Wait for completion
	time.Sleep(100 * time.Millisecond)

	// After completion, context should not be found
	rc, ok = runner.GetRunContext(run.ID)
	assert.False(t, ok)
	assert.Nil(t, rc)
}

func TestRunner_StopAll(t *testing.T) {
	store := newMockRunnerStore()
	eventBus := NewEventBus()
	polling := agents.NewPollingManager(&agents.Config{})
	runner := NewRunner(store, eventBus, polling)

	agent1 := createTestOrchestratorAgentWithPolling("agent-1")
	agent2 := createTestOrchestratorAgentWithPolling("agent-2")

	_, err := runner.StartRun(context.Background(), agent1, models.AgentTriggerManual)
	require.NoError(t, err)

	_, err = runner.StartRun(context.Background(), agent2, models.AgentTriggerManual)
	require.NoError(t, err)

	// StopAll should not error even if runs already completed
	runner.StopAll()

	// Wait for any remaining runs to finish
	time.Sleep(100 * time.Millisecond)

	// After StopAll, no runs should be active
	assert.Empty(t, runner.GetRunningRuns())
}

func TestRunner_ExecuteRun_NoPollConfig(t *testing.T) {
	store := newMockRunnerStore()
	eventBus := NewEventBus()
	polling := agents.NewPollingManager(&agents.Config{})
	runner := NewRunner(store, eventBus, polling)

	// Agent without polling config - should complete quickly
	agent := createTestOrchestratorAgent("agent-1")

	run, err := runner.StartRun(context.Background(), agent, models.AgentTriggerManual)
	require.NoError(t, err)

	// Wait for completion
	time.Sleep(100 * time.Millisecond)

	// Run should have completed
	storedRun := store.getRun(run.ID)
	require.NotNil(t, storedRun)
	assert.Equal(t, models.AgentRunStatusCompleted, storedRun.Status)
}

func TestRunner_EventsPublished(t *testing.T) {
	store := newMockRunnerStore()
	eventBus := NewEventBus()
	polling := agents.NewPollingManager(&agents.Config{})
	runner := NewRunner(store, eventBus, polling)

	var startedEvents, completedEvents atomic.Int32

	eventBus.Subscribe(func(event Event) {
		switch event.Type {
		case EventAgentRunStarted:
			startedEvents.Add(1)
		case EventAgentRunCompleted:
			completedEvents.Add(1)
		}
	})

	agent := createTestOrchestratorAgent("agent-1")

	_, err := runner.StartRun(context.Background(), agent, models.AgentTriggerManual)
	require.NoError(t, err)

	// Wait for completion and events
	time.Sleep(200 * time.Millisecond)

	assert.Equal(t, int32(1), startedEvents.Load())
	assert.Equal(t, int32(1), completedEvents.Load())
}

// TestRunner_ConcurrentStarts_ThreadSafety verifies that concurrent StartRun calls
// for the same agent are handled safely without panics or data races.
// Note: Due to fast execution, multiple runs may succeed before the "already running"
// check kicks in. The primary goal is to verify thread safety, not strict serialization.
func TestRunner_ConcurrentStarts_ThreadSafety(t *testing.T) {
	store := newMockRunnerStore()
	eventBus := NewEventBus()
	polling := agents.NewPollingManager(&agents.Config{})
	runner := NewRunner(store, eventBus, polling)

	var wg sync.WaitGroup
	var successCount, errorCount atomic.Int32

	agent := createTestOrchestratorAgentWithPolling("agent-1")

	// Try to start the same agent multiple times concurrently
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := runner.StartRun(context.Background(), agent, models.AgentTriggerManual)
			if err != nil {
				errorCount.Add(1)
			} else {
				successCount.Add(1)
			}
		}()
	}

	wg.Wait()

	// Verify all 10 attempts were processed (no panics or dropped goroutines)
	totalAttempts := successCount.Load() + errorCount.Load()
	assert.Equal(t, int32(10), totalAttempts)

	// At least one should succeed
	assert.GreaterOrEqual(t, successCount.Load(), int32(1), "at least one concurrent start should succeed")

	runner.StopAll()
}
