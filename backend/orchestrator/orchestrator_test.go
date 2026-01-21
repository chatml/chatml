package orchestrator

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockOrchestratorStore implements the OrchestratorStore interface for testing
type mockOrchestratorStore struct {
	mockRunnerStore
	mu     sync.Mutex
	agents map[string]*models.OrchestratorAgent
}

func newMockOrchestratorStore() *mockOrchestratorStore {
	return &mockOrchestratorStore{
		mockRunnerStore: *newMockRunnerStore(),
		agents:          make(map[string]*models.OrchestratorAgent),
	}
}

func (m *mockOrchestratorStore) GetOrchestratorAgent(ctx context.Context, id string) (*models.OrchestratorAgent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	agent, ok := m.agents[id]
	if !ok {
		return nil, nil
	}
	return agent, nil
}

func (m *mockOrchestratorStore) ListOrchestratorAgents(ctx context.Context) ([]*models.OrchestratorAgent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]*models.OrchestratorAgent, 0, len(m.agents))
	for _, agent := range m.agents {
		result = append(result, agent)
	}
	return result, nil
}

func (m *mockOrchestratorStore) CreateOrchestratorAgent(ctx context.Context, agent *models.OrchestratorAgent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.agents[agent.ID] = agent
	return nil
}

func (m *mockOrchestratorStore) UpdateOrchestratorAgent(ctx context.Context, agent *models.OrchestratorAgent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.agents[agent.ID]; !ok {
		return nil
	}
	m.agents[agent.ID] = agent
	return nil
}

func (m *mockOrchestratorStore) UpsertOrchestratorAgent(ctx context.Context, agent *models.OrchestratorAgent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.agents[agent.ID] = agent
	return nil
}

func (m *mockOrchestratorStore) DeleteOrchestratorAgent(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.agents, id)
	return nil
}

func (m *mockOrchestratorStore) ListAgentRuns(ctx context.Context, agentID string, limit int) ([]*models.AgentRun, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var runs []*models.AgentRun
	for _, run := range m.runs {
		if agentID == "" || run.AgentID == agentID {
			runs = append(runs, run)
		}
	}
	if limit > 0 && len(runs) > limit {
		runs = runs[:limit]
	}
	return runs, nil
}

func (m *mockOrchestratorStore) GetAgentRun(ctx context.Context, id string) (*models.AgentRun, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.runs[id], nil
}

func (m *mockOrchestratorStore) addAgent(agent *models.OrchestratorAgent) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.agents[agent.ID] = agent
}

func TestNew(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: "/tmp/agents"}

	o := New(store, config)
	defer o.Stop()

	assert.NotNil(t, o)
	assert.NotNil(t, o.store)
	assert.NotNil(t, o.loader)
	assert.NotNil(t, o.scheduler)
	assert.NotNil(t, o.runner)
	assert.NotNil(t, o.eventBus)
	assert.NotNil(t, o.agents)
	assert.NotNil(t, o.ctx)
	assert.NotNil(t, o.cancel)
}

func TestOrchestrator_Start(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()} // Empty directory

	o := New(store, config)
	defer o.Stop()

	err := o.Start()
	require.NoError(t, err)
}

func TestOrchestrator_Stop(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)

	err := o.Start()
	require.NoError(t, err)

	// Stop should not panic or error
	o.Stop()
}

func TestOrchestrator_GetAgent(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	// Add an agent directly to the orchestrator's memory
	agent := &models.OrchestratorAgent{
		ID:       "test-agent",
		YAMLPath: "/agents/test.yaml",
		Enabled:  true,
	}
	o.mu.Lock()
	o.agents["test-agent"] = agent
	o.mu.Unlock()

	// Get existing agent
	retrieved, ok := o.GetAgent("test-agent")
	assert.True(t, ok)
	assert.NotNil(t, retrieved)
	assert.Equal(t, "test-agent", retrieved.ID)
}

func TestOrchestrator_GetAgent_NotFound(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	retrieved, ok := o.GetAgent("non-existent")
	assert.False(t, ok)
	assert.Nil(t, retrieved)
}

func TestOrchestrator_ListAgents(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	// Initially empty
	agents := o.ListAgents()
	assert.Empty(t, agents)

	// Add agents
	o.mu.Lock()
	o.agents["agent-1"] = &models.OrchestratorAgent{ID: "agent-1", Enabled: true}
	o.agents["agent-2"] = &models.OrchestratorAgent{ID: "agent-2", Enabled: false}
	o.mu.Unlock()

	agents = o.ListAgents()
	assert.Len(t, agents, 2)
}

func TestOrchestrator_EnableAgent(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	// Add disabled agent
	agent := &models.OrchestratorAgent{
		ID:                "test-agent",
		YAMLPath:          "/agents/test.yaml",
		Enabled:           false,
		PollingIntervalMs: 60000,
	}
	o.mu.Lock()
	o.agents["test-agent"] = agent
	o.mu.Unlock()
	store.addAgent(agent)

	err := o.EnableAgent("test-agent")
	require.NoError(t, err)

	// Verify agent is now enabled
	retrieved, ok := o.GetAgent("test-agent")
	assert.True(t, ok)
	assert.True(t, retrieved.Enabled)

	// Verify scheduler has it scheduled
	assert.True(t, o.scheduler.IsScheduled("test-agent"))
}

func TestOrchestrator_EnableAgent_NotFound(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	err := o.EnableAgent("non-existent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestOrchestrator_DisableAgent(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	// Add enabled agent
	agent := &models.OrchestratorAgent{
		ID:                "test-agent",
		YAMLPath:          "/agents/test.yaml",
		Enabled:           true,
		PollingIntervalMs: 60000,
	}
	o.mu.Lock()
	o.agents["test-agent"] = agent
	o.mu.Unlock()
	store.addAgent(agent)

	// Schedule the agent first
	o.scheduler.Schedule("test-agent", 60000)

	err := o.DisableAgent("test-agent")
	require.NoError(t, err)

	// Verify agent is now disabled
	retrieved, ok := o.GetAgent("test-agent")
	assert.True(t, ok)
	assert.False(t, retrieved.Enabled)

	// Verify scheduler removed it
	assert.False(t, o.scheduler.IsScheduled("test-agent"))
}

func TestOrchestrator_UpdateAgentInterval(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	// Add agent
	agent := &models.OrchestratorAgent{
		ID:                "test-agent",
		YAMLPath:          "/agents/test.yaml",
		Enabled:           true,
		PollingIntervalMs: 60000,
	}
	o.mu.Lock()
	o.agents["test-agent"] = agent
	o.mu.Unlock()
	store.addAgent(agent)
	o.scheduler.Schedule("test-agent", 60000)

	err := o.UpdateAgentInterval("test-agent", 30000)
	require.NoError(t, err)

	// Verify interval was updated
	retrieved, ok := o.GetAgent("test-agent")
	assert.True(t, ok)
	assert.Equal(t, 30000, retrieved.PollingIntervalMs)

	// Verify scheduler was updated
	assert.Equal(t, 30000*time.Millisecond, o.scheduler.GetInterval("test-agent"))
}

func TestOrchestrator_UpdateAgentInterval_NotFound(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	err := o.UpdateAgentInterval("non-existent", 30000)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestOrchestrator_TriggerAgentRun(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	// Add agent
	agent := &models.OrchestratorAgent{
		ID:                "test-agent",
		YAMLPath:          "/agents/test.yaml",
		Enabled:           true,
		PollingIntervalMs: 60000,
	}
	o.mu.Lock()
	o.agents["test-agent"] = agent
	o.mu.Unlock()
	store.addAgent(agent)

	run, err := o.TriggerAgentRun("test-agent")
	require.NoError(t, err)
	assert.NotNil(t, run)
	assert.Equal(t, "test-agent", run.AgentID)
	assert.Equal(t, models.AgentTriggerManual, run.Trigger)
}

func TestOrchestrator_TriggerAgentRun_NotFound(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	_, err := o.TriggerAgentRun("non-existent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestOrchestrator_GetAgentRuns(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	// Add some runs to the store
	run1 := &models.AgentRun{ID: "run-1", AgentID: "agent-1", Status: "completed"}
	run2 := &models.AgentRun{ID: "run-2", AgentID: "agent-1", Status: "completed"}
	store.runs["run-1"] = run1
	store.runs["run-2"] = run2

	runs, err := o.GetAgentRuns("agent-1", 10)
	require.NoError(t, err)
	assert.Len(t, runs, 2)
}

func TestOrchestrator_GetAgentRun(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	// Add a run to the store
	run := &models.AgentRun{ID: "run-1", AgentID: "agent-1", Status: "completed"}
	store.runs["run-1"] = run

	retrieved, err := o.GetAgentRun("run-1")
	require.NoError(t, err)
	assert.NotNil(t, retrieved)
	assert.Equal(t, "run-1", retrieved.ID)
}

func TestOrchestrator_IsAgentRunning(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	// Initially not running
	assert.False(t, o.IsAgentRunning("test-agent"))
}

func TestOrchestrator_Subscribe(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	var received atomic.Bool

	o.Subscribe(func(event Event) {
		received.Store(true)
	})

	// Publish an event directly
	o.eventBus.Publish(Event{Type: "test"})

	// Wait for async handler
	time.Sleep(50 * time.Millisecond)
	assert.True(t, received.Load())
}

func TestOrchestrator_EventBus(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	eb := o.EventBus()
	assert.NotNil(t, eb)
	assert.Equal(t, o.eventBus, eb)
}

func TestOrchestrator_ReloadAgents(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()} // Empty directory

	o := New(store, config)
	defer o.Stop()

	err := o.Start()
	require.NoError(t, err)

	// Reload should work with empty directory
	err = o.ReloadAgents()
	require.NoError(t, err)
}

func TestOrchestrator_StopAgentRun(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	// Add agent
	agent := &models.OrchestratorAgent{
		ID:                "test-agent",
		YAMLPath:          "/agents/test.yaml",
		Enabled:           true,
		PollingIntervalMs: 60000,
	}
	o.mu.Lock()
	o.agents["test-agent"] = agent
	o.mu.Unlock()
	store.addAgent(agent)

	run, err := o.TriggerAgentRun("test-agent")
	require.NoError(t, err)

	// StopAgentRun may fail if run already completed (which happens very quickly)
	err = o.StopAgentRun(run.ID)
	// Error is acceptable if run already completed
	if err != nil {
		assert.Contains(t, err.Error(), "not found")
	}
}

func TestOrchestrator_ConcurrentOperations(t *testing.T) {
	store := newMockOrchestratorStore()
	config := Config{AgentsDir: t.TempDir()}

	o := New(store, config)
	defer o.Stop()

	// Add some agents
	for i := 0; i < 5; i++ {
		agent := &models.OrchestratorAgent{
			ID:                "agent-" + string(rune('0'+i)),
			YAMLPath:          "/agents/test.yaml",
			Enabled:           true,
			PollingIntervalMs: 60000,
		}
		o.mu.Lock()
		o.agents[agent.ID] = agent
		o.mu.Unlock()
		store.addAgent(agent)
	}

	var wg sync.WaitGroup

	// Concurrent reads
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			o.ListAgents()
			o.GetAgent("agent-0")
			o.IsAgentRunning("agent-0")
		}()
	}

	wg.Wait()
}
