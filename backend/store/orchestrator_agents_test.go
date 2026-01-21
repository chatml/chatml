package store

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Helper to create a test orchestrator agent
func createTestOrchestratorAgent(id string) *models.OrchestratorAgent {
	return &models.OrchestratorAgent{
		ID:                id,
		YAMLPath:          "/agents/" + id + ".yaml",
		Enabled:           true,
		PollingIntervalMs: 60000,
		TotalRuns:         0,
		TotalCost:         0,
	}
}

// ============================================================================
// OrchestratorAgent Tests
// ============================================================================

func TestCreateOrchestratorAgent(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	agent := createTestOrchestratorAgent("agent-1")

	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	// Verify it was created with timestamps
	assert.False(t, agent.CreatedAt.IsZero())
	assert.False(t, agent.UpdatedAt.IsZero())
}

func TestCreateOrchestratorAgent_DuplicateID(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	agent1 := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent1)
	require.NoError(t, err)

	// Try to create another with the same ID
	agent2 := createTestOrchestratorAgent("agent-1")
	err = s.CreateOrchestratorAgent(ctx, agent2)
	require.Error(t, err)
}

func TestGetOrchestratorAgent(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	agent := createTestOrchestratorAgent("agent-1")
	agent.PollingIntervalMs = 30000
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	retrieved, err := s.GetOrchestratorAgent(ctx, "agent-1")
	require.NoError(t, err)
	require.NotNil(t, retrieved)

	assert.Equal(t, "agent-1", retrieved.ID)
	assert.Equal(t, "/agents/agent-1.yaml", retrieved.YAMLPath)
	assert.True(t, retrieved.Enabled)
	assert.Equal(t, 30000, retrieved.PollingIntervalMs)
}

func TestGetOrchestratorAgent_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	retrieved, err := s.GetOrchestratorAgent(ctx, "non-existent")
	require.NoError(t, err)
	assert.Nil(t, retrieved)
}

func TestListOrchestratorAgents(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Create multiple agents
	for i := 1; i <= 3; i++ {
		agent := createTestOrchestratorAgent(fmt.Sprintf("agent-%d", i))
		err := s.CreateOrchestratorAgent(ctx, agent)
		require.NoError(t, err)
	}

	agents, err := s.ListOrchestratorAgents(ctx)
	require.NoError(t, err)
	assert.Len(t, agents, 3)
}

func TestListOrchestratorAgents_Empty(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	agents, err := s.ListOrchestratorAgents(ctx)
	require.NoError(t, err)
	assert.Empty(t, agents)
}

func TestUpdateOrchestratorAgent(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	// Update the agent
	agent.Enabled = false
	agent.PollingIntervalMs = 120000
	agent.TotalRuns = 5
	agent.TotalCost = 0.15

	err = s.UpdateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	// Retrieve and verify
	retrieved, err := s.GetOrchestratorAgent(ctx, "agent-1")
	require.NoError(t, err)
	assert.False(t, retrieved.Enabled)
	assert.Equal(t, 120000, retrieved.PollingIntervalMs)
	assert.Equal(t, 5, retrieved.TotalRuns)
	assert.Equal(t, 0.15, retrieved.TotalCost)
}

func TestUpdateOrchestratorAgent_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	agent := createTestOrchestratorAgent("non-existent")
	err := s.UpdateOrchestratorAgent(ctx, agent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestDeleteOrchestratorAgent(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	err = s.DeleteOrchestratorAgent(ctx, "agent-1")
	require.NoError(t, err)

	// Verify it's gone
	retrieved, err := s.GetOrchestratorAgent(ctx, "agent-1")
	require.NoError(t, err)
	assert.Nil(t, retrieved)
}

func TestDeleteOrchestratorAgent_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	err := s.DeleteOrchestratorAgent(ctx, "non-existent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestUpsertOrchestratorAgent_Create(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	agent := createTestOrchestratorAgent("agent-1")

	err := s.UpsertOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	// Verify it was created
	retrieved, err := s.GetOrchestratorAgent(ctx, "agent-1")
	require.NoError(t, err)
	require.NotNil(t, retrieved)
	assert.Equal(t, "agent-1", retrieved.ID)
}

func TestUpsertOrchestratorAgent_Update(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	// Upsert with updated values
	agent.YAMLPath = "/new/path/agent-1.yaml"
	err = s.UpsertOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	// Verify only yaml_path was updated (per the upsert logic)
	retrieved, err := s.GetOrchestratorAgent(ctx, "agent-1")
	require.NoError(t, err)
	assert.Equal(t, "/new/path/agent-1.yaml", retrieved.YAMLPath)
}

func TestRecordAgentRun(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	// Record a run
	err = s.RecordAgentRun(ctx, "agent-1", 0.05)
	require.NoError(t, err)

	retrieved, err := s.GetOrchestratorAgent(ctx, "agent-1")
	require.NoError(t, err)
	assert.Equal(t, 1, retrieved.TotalRuns)
	assert.Equal(t, 0.05, retrieved.TotalCost)
	assert.NotNil(t, retrieved.LastRunAt)

	// Record another run
	err = s.RecordAgentRun(ctx, "agent-1", 0.03)
	require.NoError(t, err)

	retrieved, err = s.GetOrchestratorAgent(ctx, "agent-1")
	require.NoError(t, err)
	assert.Equal(t, 2, retrieved.TotalRuns)
	assert.Equal(t, 0.08, retrieved.TotalCost)
}

func TestSetAgentError(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	// Set an error
	err = s.SetAgentError(ctx, "agent-1", "test error message")
	require.NoError(t, err)

	retrieved, err := s.GetOrchestratorAgent(ctx, "agent-1")
	require.NoError(t, err)
	assert.Equal(t, "test error message", retrieved.LastError)
}

func TestClearAgentError(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	// Set then clear error
	err = s.SetAgentError(ctx, "agent-1", "test error")
	require.NoError(t, err)

	err = s.ClearAgentError(ctx, "agent-1")
	require.NoError(t, err)

	retrieved, err := s.GetOrchestratorAgent(ctx, "agent-1")
	require.NoError(t, err)
	assert.Empty(t, retrieved.LastError)
}

// ============================================================================
// AgentRun Tests
// ============================================================================

func createTestAgentRun(id, agentID string) *models.AgentRun {
	return &models.AgentRun{
		ID:        id,
		AgentID:   agentID,
		Trigger:   models.AgentTriggerManual,
		Status:    models.AgentRunStatusRunning,
		StartedAt: time.Now(),
	}
}

func TestCreateAgentRun(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Create the agent first (foreign key constraint)
	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	run := createTestAgentRun("run-1", "agent-1")
	err = s.CreateAgentRun(ctx, run)
	require.NoError(t, err)
}

func TestGetAgentRun(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Create the agent first (foreign key constraint)
	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	run := createTestAgentRun("run-1", "agent-1")
	run.ResultSummary = "Test summary"
	run.Cost = 0.05
	err = s.CreateAgentRun(ctx, run)
	require.NoError(t, err)

	retrieved, err := s.GetAgentRun(ctx, "run-1")
	require.NoError(t, err)
	require.NotNil(t, retrieved)

	assert.Equal(t, "run-1", retrieved.ID)
	assert.Equal(t, "agent-1", retrieved.AgentID)
	assert.Equal(t, models.AgentTriggerManual, retrieved.Trigger)
	assert.Equal(t, models.AgentRunStatusRunning, retrieved.Status)
	assert.Equal(t, "Test summary", retrieved.ResultSummary)
	assert.Equal(t, 0.05, retrieved.Cost)
}

func TestGetAgentRun_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	retrieved, err := s.GetAgentRun(ctx, "non-existent")
	require.NoError(t, err)
	assert.Nil(t, retrieved)
}

func TestListAgentRuns(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Create the agent first (foreign key constraint)
	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	// Create runs for multiple agents
	for i := 1; i <= 5; i++ {
		run := createTestAgentRun(fmt.Sprintf("run-%d", i), "agent-1")
		time.Sleep(10 * time.Millisecond) // Ensure different started_at times
		err := s.CreateAgentRun(ctx, run)
		require.NoError(t, err)
	}

	runs, err := s.ListAgentRuns(ctx, "", 10)
	require.NoError(t, err)
	assert.Len(t, runs, 5)
}

func TestListAgentRuns_FilterByAgent(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Create agents first (foreign key constraint)
	agentA := createTestOrchestratorAgent("agent-a")
	err := s.CreateOrchestratorAgent(ctx, agentA)
	require.NoError(t, err)

	agentB := createTestOrchestratorAgent("agent-b")
	err = s.CreateOrchestratorAgent(ctx, agentB)
	require.NoError(t, err)

	// Create runs for different agents
	for i := 1; i <= 3; i++ {
		run := createTestAgentRun(fmt.Sprintf("run-a%d", i), "agent-a")
		err := s.CreateAgentRun(ctx, run)
		require.NoError(t, err)
	}

	for i := 1; i <= 2; i++ {
		run := createTestAgentRun(fmt.Sprintf("run-b%d", i), "agent-b")
		err := s.CreateAgentRun(ctx, run)
		require.NoError(t, err)
	}

	// Filter by agent-a
	runs, err := s.ListAgentRuns(ctx, "agent-a", 10)
	require.NoError(t, err)
	assert.Len(t, runs, 3)

	for _, run := range runs {
		assert.Equal(t, "agent-a", run.AgentID)
	}
}

func TestListAgentRuns_Limit(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Create the agent first (foreign key constraint)
	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	// Create 10 runs
	for i := 1; i <= 10; i++ {
		run := createTestAgentRun(fmt.Sprintf("run-%02d", i), "agent-1")
		time.Sleep(5 * time.Millisecond)
		err := s.CreateAgentRun(ctx, run)
		require.NoError(t, err)
	}

	// Get only 3
	runs, err := s.ListAgentRuns(ctx, "", 3)
	require.NoError(t, err)
	assert.Len(t, runs, 3)
}

func TestListAgentRuns_DefaultLimit(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Create the agent first (foreign key constraint)
	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	// Create a few runs
	for i := 1; i <= 5; i++ {
		run := createTestAgentRun(fmt.Sprintf("run-%d", i), "agent-1")
		err := s.CreateAgentRun(ctx, run)
		require.NoError(t, err)
	}

	// Pass 0 to get default limit
	runs, err := s.ListAgentRuns(ctx, "", 0)
	require.NoError(t, err)
	assert.Len(t, runs, 5) // All 5 should be returned (default limit is 50)
}

func TestUpdateAgentRun(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Create the agent first (foreign key constraint)
	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	run := createTestAgentRun("run-1", "agent-1")
	err = s.CreateAgentRun(ctx, run)
	require.NoError(t, err)

	// Update the run
	run.Status = models.AgentRunStatusCompleted
	run.ResultSummary = "Completed successfully"
	run.Cost = 0.10
	now := time.Now()
	run.CompletedAt = &now
	run.SessionsCreated = []string{"session-1", "session-2"}

	err = s.UpdateAgentRun(ctx, run)
	require.NoError(t, err)

	// Retrieve and verify
	retrieved, err := s.GetAgentRun(ctx, "run-1")
	require.NoError(t, err)
	assert.Equal(t, models.AgentRunStatusCompleted, retrieved.Status)
	assert.Equal(t, "Completed successfully", retrieved.ResultSummary)
	assert.Equal(t, 0.10, retrieved.Cost)
	assert.NotNil(t, retrieved.CompletedAt)
	assert.Equal(t, []string{"session-1", "session-2"}, retrieved.SessionsCreated)
}

func TestUpdateAgentRun_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	run := &models.AgentRun{ID: "non-existent"}
	err := s.UpdateAgentRun(ctx, run)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestCompleteAgentRun(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Create the agent first (foreign key constraint)
	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	run := createTestAgentRun("run-1", "agent-1")
	err = s.CreateAgentRun(ctx, run)
	require.NoError(t, err)

	err = s.CompleteAgentRun(ctx, "run-1", models.AgentRunStatusCompleted, "All done", 0.05, []string{"session-x"})
	require.NoError(t, err)

	retrieved, err := s.GetAgentRun(ctx, "run-1")
	require.NoError(t, err)
	assert.Equal(t, models.AgentRunStatusCompleted, retrieved.Status)
	assert.Equal(t, "All done", retrieved.ResultSummary)
	assert.Equal(t, 0.05, retrieved.Cost)
	assert.NotNil(t, retrieved.CompletedAt)
	assert.Equal(t, []string{"session-x"}, retrieved.SessionsCreated)
}

func TestDeleteAgentRun(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Create the agent first (foreign key constraint)
	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	run := createTestAgentRun("run-1", "agent-1")
	err = s.CreateAgentRun(ctx, run)
	require.NoError(t, err)

	err = s.DeleteAgentRun(ctx, "run-1")
	require.NoError(t, err)

	retrieved, err := s.GetAgentRun(ctx, "run-1")
	require.NoError(t, err)
	assert.Nil(t, retrieved)
}

func TestDeleteAgentRuns(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Create agents first (foreign key constraint)
	agentA := createTestOrchestratorAgent("agent-a")
	err := s.CreateOrchestratorAgent(ctx, agentA)
	require.NoError(t, err)

	agentB := createTestOrchestratorAgent("agent-b")
	err = s.CreateOrchestratorAgent(ctx, agentB)
	require.NoError(t, err)

	// Create runs for two agents
	for i := 1; i <= 3; i++ {
		run := createTestAgentRun(fmt.Sprintf("run-a%d", i), "agent-a")
		err := s.CreateAgentRun(ctx, run)
		require.NoError(t, err)
	}

	run := createTestAgentRun("run-b1", "agent-b")
	err = s.CreateAgentRun(ctx, run)
	require.NoError(t, err)

	// Delete all runs for agent-a
	err = s.DeleteAgentRuns(ctx, "agent-a")
	require.NoError(t, err)

	// Verify agent-a runs are gone
	runs, err := s.ListAgentRuns(ctx, "agent-a", 10)
	require.NoError(t, err)
	assert.Empty(t, runs)

	// Verify agent-b run still exists
	runs, err = s.ListAgentRuns(ctx, "agent-b", 10)
	require.NoError(t, err)
	assert.Len(t, runs, 1)
}

func TestGetAgentRunStats(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Create the agent first (foreign key constraint)
	agent := createTestOrchestratorAgent("agent-1")
	err := s.CreateOrchestratorAgent(ctx, agent)
	require.NoError(t, err)

	// Create completed runs with costs
	for i := 1; i <= 3; i++ {
		run := createTestAgentRun(fmt.Sprintf("run-%d", i), "agent-1")
		run.Cost = 0.10
		run.SessionsCreated = []string{fmt.Sprintf("session-%d", i)}
		err := s.CreateAgentRun(ctx, run)
		require.NoError(t, err)
	}

	since := time.Now().Add(-time.Hour)
	runs, cost, sessions, err := s.GetAgentRunStats(ctx, "agent-1", since)
	require.NoError(t, err)

	assert.Equal(t, 3, runs)
	assert.InDelta(t, 0.30, cost, 0.001)
	assert.Greater(t, sessions, 0) // At least some sessions counted
}
