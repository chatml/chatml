package models

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// ============================================================================
// Orchestrator Constant Tests
// ============================================================================

func TestAgentRunStatus_Constants(t *testing.T) {
	require.Equal(t, "running", AgentRunStatusRunning)
	require.Equal(t, "completed", AgentRunStatusCompleted)
	require.Equal(t, "failed", AgentRunStatusFailed)
}

func TestAgentTrigger_Constants(t *testing.T) {
	require.Equal(t, "poll", AgentTriggerPoll)
	require.Equal(t, "manual", AgentTriggerManual)
	require.Equal(t, "event", AgentTriggerEvent)
}

func TestAgentExecutionMode_Constants(t *testing.T) {
	require.Equal(t, "read-only", AgentModeReadOnly)
	require.Equal(t, "creates-session", AgentModeCreatesSession)
	require.Equal(t, "uses-session", AgentModeUsesSession)
}

// ============================================================================
// Orchestrator JSON Serialization Tests
// ============================================================================

func TestOrchestratorAgent_JSONSerialization(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	lastRun := now.Add(-time.Hour)

	agent := OrchestratorAgent{
		ID:                "agent-123",
		YAMLPath:          "/path/to/agent.yaml",
		Enabled:           true,
		PollingIntervalMs: 60000,
		LastRunAt:         &lastRun,
		LastError:         "previous error",
		TotalRuns:         10,
		TotalCost:         1.25,
		CreatedAt:         now,
		UpdatedAt:         now,
		Definition: &AgentDefinition{
			ID:          "agent-123",
			Name:        "Test Agent",
			Type:        "polling",
			Description: "A test agent",
		},
	}

	data, err := json.Marshal(agent)
	require.NoError(t, err)

	var decoded OrchestratorAgent
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, agent.ID, decoded.ID)
	require.Equal(t, agent.YAMLPath, decoded.YAMLPath)
	require.True(t, decoded.Enabled)
	require.Equal(t, 60000, decoded.PollingIntervalMs)
	require.NotNil(t, decoded.LastRunAt)
	require.Equal(t, agent.LastError, decoded.LastError)
	require.Equal(t, 10, decoded.TotalRuns)
	require.Equal(t, 1.25, decoded.TotalCost)
	require.NotNil(t, decoded.Definition)
	require.Equal(t, "Test Agent", decoded.Definition.Name)
}

func TestOrchestratorAgent_JSONSerialization_OmitEmpty(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	agent := OrchestratorAgent{
		ID:        "agent-123",
		YAMLPath:  "/path/to/agent.yaml",
		Enabled:   false,
		CreatedAt: now,
		UpdatedAt: now,
		// Optional fields omitted
	}

	data, err := json.Marshal(agent)
	require.NoError(t, err)

	var rawMap map[string]interface{}
	err = json.Unmarshal(data, &rawMap)
	require.NoError(t, err)

	_, hasLastRunAt := rawMap["lastRunAt"]
	require.False(t, hasLastRunAt, "lastRunAt should be omitted when nil")

	_, hasLastError := rawMap["lastError"]
	require.False(t, hasLastError, "lastError should be omitted when empty")

	_, hasPollingInterval := rawMap["pollingIntervalMs"]
	require.False(t, hasPollingInterval, "pollingIntervalMs should be omitted when zero")

	_, hasDefinition := rawMap["definition"]
	require.False(t, hasDefinition, "definition should be omitted when nil")
}

func TestAgentDefinition_JSONSerialization(t *testing.T) {
	def := AgentDefinition{
		ID:          "agent-def-123",
		Name:        "GitHub Issue Handler",
		Type:        "polling",
		Description: "Handles GitHub issues automatically",
		Execution: AgentExecution{
			Mode:             AgentModeCreatesSession,
			WorkingDirectory: "session",
		},
		Polling: &AgentPolling{
			Interval: "5m",
			Sources: []AgentPollingSource{
				{
					Type:      "github",
					Owner:     "myorg",
					Repo:      "myrepo",
					Resources: []string{"issues", "pull_requests"},
					Filters:   map[string]any{"state": "open", "labels": []string{"bug"}},
				},
			},
		},
		Capabilities: []string{"read_file", "write_file", "bash"},
		SystemPrompt: "You are a helpful assistant.",
		Limits: AgentLimits{
			BudgetPerRun:       0.50,
			MaxSessionsPerHour: 5,
		},
	}

	data, err := json.Marshal(def)
	require.NoError(t, err)

	var decoded AgentDefinition
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, def.ID, decoded.ID)
	require.Equal(t, def.Name, decoded.Name)
	require.Equal(t, def.Type, decoded.Type)
	require.Equal(t, def.Description, decoded.Description)
	require.Equal(t, AgentModeCreatesSession, decoded.Execution.Mode)
	require.Equal(t, "session", decoded.Execution.WorkingDirectory)
	require.NotNil(t, decoded.Polling)
	require.Equal(t, "5m", decoded.Polling.Interval)
	require.Len(t, decoded.Polling.Sources, 1)
	require.Equal(t, "github", decoded.Polling.Sources[0].Type)
	require.Equal(t, "myorg", decoded.Polling.Sources[0].Owner)
	require.Equal(t, "myrepo", decoded.Polling.Sources[0].Repo)
	require.Len(t, decoded.Capabilities, 3)
	require.Contains(t, decoded.Capabilities, "read_file")
	require.Equal(t, 0.50, decoded.Limits.BudgetPerRun)
	require.Equal(t, 5, decoded.Limits.MaxSessionsPerHour)
}

func TestAgentDefinition_JSONSerialization_OmitEmpty(t *testing.T) {
	def := AgentDefinition{
		ID:   "agent-123",
		Name: "Simple Agent",
		Type: "manual",
		Execution: AgentExecution{
			Mode:             AgentModeReadOnly,
			WorkingDirectory: "root",
		},
		// Polling omitted
	}

	data, err := json.Marshal(def)
	require.NoError(t, err)

	var rawMap map[string]interface{}
	err = json.Unmarshal(data, &rawMap)
	require.NoError(t, err)

	_, hasPolling := rawMap["polling"]
	require.False(t, hasPolling, "polling should be omitted when nil")
}

func TestAgentExecution_JSONSerialization(t *testing.T) {
	exec := AgentExecution{
		Mode:             AgentModeUsesSession,
		WorkingDirectory: "session",
	}

	data, err := json.Marshal(exec)
	require.NoError(t, err)

	var decoded AgentExecution
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, AgentModeUsesSession, decoded.Mode)
	require.Equal(t, "session", decoded.WorkingDirectory)
}

func TestAgentPolling_JSONSerialization(t *testing.T) {
	polling := AgentPolling{
		Interval: "10m",
		Sources: []AgentPollingSource{
			{Type: "github", Owner: "org1", Repo: "repo1"},
			{Type: "linear", Resources: []string{"issues"}},
		},
	}

	data, err := json.Marshal(polling)
	require.NoError(t, err)

	var decoded AgentPolling
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, "10m", decoded.Interval)
	require.Len(t, decoded.Sources, 2)
	require.Equal(t, "github", decoded.Sources[0].Type)
	require.Equal(t, "linear", decoded.Sources[1].Type)
}

func TestAgentPollingSource_JSONSerialization(t *testing.T) {
	source := AgentPollingSource{
		Type:      "github",
		Owner:     "myorg",
		Repo:      "myrepo",
		Resources: []string{"issues", "pull_requests"},
		Filters: map[string]any{
			"state":    "open",
			"assignee": "me",
			"labels":   []interface{}{"bug", "high-priority"},
		},
	}

	data, err := json.Marshal(source)
	require.NoError(t, err)

	var decoded AgentPollingSource
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, "github", decoded.Type)
	require.Equal(t, "myorg", decoded.Owner)
	require.Equal(t, "myrepo", decoded.Repo)
	require.Len(t, decoded.Resources, 2)
	require.Contains(t, decoded.Resources, "issues")
	require.Equal(t, "open", decoded.Filters["state"])
	require.Equal(t, "me", decoded.Filters["assignee"])
}

func TestAgentPollingSource_JSONSerialization_OmitEmpty(t *testing.T) {
	source := AgentPollingSource{
		Type: "linear",
		// Owner, Repo, Resources, Filters omitted
	}

	data, err := json.Marshal(source)
	require.NoError(t, err)

	var rawMap map[string]interface{}
	err = json.Unmarshal(data, &rawMap)
	require.NoError(t, err)

	_, hasOwner := rawMap["owner"]
	require.False(t, hasOwner, "owner should be omitted when empty")

	_, hasRepo := rawMap["repo"]
	require.False(t, hasRepo, "repo should be omitted when empty")

	_, hasResources := rawMap["resources"]
	require.False(t, hasResources, "resources should be omitted when nil")

	_, hasFilters := rawMap["filters"]
	require.False(t, hasFilters, "filters should be omitted when nil")
}

func TestAgentLimits_JSONSerialization(t *testing.T) {
	limits := AgentLimits{
		BudgetPerRun:       1.00,
		MaxSessionsPerHour: 10,
	}

	data, err := json.Marshal(limits)
	require.NoError(t, err)

	var decoded AgentLimits
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, 1.00, decoded.BudgetPerRun)
	require.Equal(t, 10, decoded.MaxSessionsPerHour)
}

func TestAgentRun_JSONSerialization(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	completed := now.Add(5 * time.Minute)

	run := AgentRun{
		ID:              "run-123",
		AgentID:         "agent-456",
		Trigger:         AgentTriggerManual,
		Status:          AgentRunStatusCompleted,
		ResultSummary:   "Successfully processed 5 issues",
		SessionsCreated: []string{"session-1", "session-2"},
		Cost:            0.25,
		StartedAt:       now,
		CompletedAt:     &completed,
	}

	data, err := json.Marshal(run)
	require.NoError(t, err)

	var decoded AgentRun
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, run.ID, decoded.ID)
	require.Equal(t, run.AgentID, decoded.AgentID)
	require.Equal(t, AgentTriggerManual, decoded.Trigger)
	require.Equal(t, AgentRunStatusCompleted, decoded.Status)
	require.Equal(t, run.ResultSummary, decoded.ResultSummary)
	require.Len(t, decoded.SessionsCreated, 2)
	require.Contains(t, decoded.SessionsCreated, "session-1")
	require.Equal(t, 0.25, decoded.Cost)
	require.NotNil(t, decoded.CompletedAt)
}

func TestAgentRun_JSONSerialization_OmitEmpty(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	run := AgentRun{
		ID:        "run-123",
		AgentID:   "agent-456",
		Trigger:   AgentTriggerPoll,
		Status:    AgentRunStatusRunning,
		StartedAt: now,
		// ResultSummary, SessionsCreated, CompletedAt omitted
	}

	data, err := json.Marshal(run)
	require.NoError(t, err)

	var rawMap map[string]interface{}
	err = json.Unmarshal(data, &rawMap)
	require.NoError(t, err)

	_, hasResultSummary := rawMap["resultSummary"]
	require.False(t, hasResultSummary, "resultSummary should be omitted when empty")

	_, hasSessionsCreated := rawMap["sessionsCreated"]
	require.False(t, hasSessionsCreated, "sessionsCreated should be omitted when nil")

	_, hasCompletedAt := rawMap["completedAt"]
	require.False(t, hasCompletedAt, "completedAt should be omitted when nil")
}

func TestAgentRun_AllTriggerTypes(t *testing.T) {
	triggers := []string{AgentTriggerPoll, AgentTriggerManual, AgentTriggerEvent}

	for _, trigger := range triggers {
		run := AgentRun{
			ID:        "run-123",
			AgentID:   "agent-456",
			Trigger:   trigger,
			Status:    AgentRunStatusRunning,
			StartedAt: time.Now(),
		}

		data, err := json.Marshal(run)
		require.NoError(t, err, "should marshal run with trigger %s", trigger)

		var decoded AgentRun
		err = json.Unmarshal(data, &decoded)
		require.NoError(t, err, "should unmarshal run with trigger %s", trigger)
		require.Equal(t, trigger, decoded.Trigger)
	}
}

func TestAgentRun_AllStatusTypes(t *testing.T) {
	statuses := []string{AgentRunStatusRunning, AgentRunStatusCompleted, AgentRunStatusFailed}

	for _, status := range statuses {
		run := AgentRun{
			ID:        "run-123",
			AgentID:   "agent-456",
			Trigger:   AgentTriggerManual,
			Status:    status,
			StartedAt: time.Now(),
		}

		data, err := json.Marshal(run)
		require.NoError(t, err, "should marshal run with status %s", status)

		var decoded AgentRun
		err = json.Unmarshal(data, &decoded)
		require.NoError(t, err, "should unmarshal run with status %s", status)
		require.Equal(t, status, decoded.Status)
	}
}

func TestAgentExecution_AllModes(t *testing.T) {
	modes := []string{AgentModeReadOnly, AgentModeCreatesSession, AgentModeUsesSession}

	for _, mode := range modes {
		exec := AgentExecution{
			Mode:             mode,
			WorkingDirectory: "root",
		}

		data, err := json.Marshal(exec)
		require.NoError(t, err, "should marshal execution with mode %s", mode)

		var decoded AgentExecution
		err = json.Unmarshal(data, &decoded)
		require.NoError(t, err, "should unmarshal execution with mode %s", mode)
		require.Equal(t, mode, decoded.Mode)
	}
}
