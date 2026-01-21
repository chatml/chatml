package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/chatml/chatml-backend/models"
)

// ============================================================================
// Orchestrator Agent methods
// ============================================================================

// CreateOrchestratorAgent creates a new orchestrator agent record
func (s *SQLiteStore) CreateOrchestratorAgent(ctx context.Context, agent *models.OrchestratorAgent) error {
	now := time.Now()
	if agent.CreatedAt.IsZero() {
		agent.CreatedAt = now
	}
	agent.UpdatedAt = now

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO orchestrator_agents (id, yaml_path, enabled, polling_interval_ms, last_run_at, last_error, total_runs, total_cost, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		agent.ID, agent.YAMLPath, boolToInt(agent.Enabled), agent.PollingIntervalMs,
		agent.LastRunAt, agent.LastError, agent.TotalRuns, agent.TotalCost,
		agent.CreatedAt, agent.UpdatedAt)
	if err != nil {
		return fmt.Errorf("CreateOrchestratorAgent: %w", err)
	}
	return nil
}

// GetOrchestratorAgent retrieves an orchestrator agent by ID
func (s *SQLiteStore) GetOrchestratorAgent(ctx context.Context, id string) (*models.OrchestratorAgent, error) {
	var agent models.OrchestratorAgent
	var enabled int
	var pollingInterval sql.NullInt64
	var lastRunAt sql.NullTime
	var lastError sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT id, yaml_path, enabled, polling_interval_ms, last_run_at, last_error, total_runs, total_cost, created_at, updated_at
		FROM orchestrator_agents WHERE id = ?`, id).Scan(
		&agent.ID, &agent.YAMLPath, &enabled, &pollingInterval,
		&lastRunAt, &lastError, &agent.TotalRuns, &agent.TotalCost,
		&agent.CreatedAt, &agent.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetOrchestratorAgent: %w", err)
	}

	agent.Enabled = intToBool(enabled)
	if pollingInterval.Valid {
		agent.PollingIntervalMs = int(pollingInterval.Int64)
	}
	if lastRunAt.Valid {
		agent.LastRunAt = &lastRunAt.Time
	}
	if lastError.Valid {
		agent.LastError = lastError.String
	}

	return &agent, nil
}

// ListOrchestratorAgents retrieves all orchestrator agents
func (s *SQLiteStore) ListOrchestratorAgents(ctx context.Context) ([]*models.OrchestratorAgent, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, yaml_path, enabled, polling_interval_ms, last_run_at, last_error, total_runs, total_cost, created_at, updated_at
		FROM orchestrator_agents
		ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("ListOrchestratorAgents: %w", err)
	}
	defer rows.Close()

	agents := []*models.OrchestratorAgent{}
	for rows.Next() {
		var agent models.OrchestratorAgent
		var enabled int
		var pollingInterval sql.NullInt64
		var lastRunAt sql.NullTime
		var lastError sql.NullString

		if err := rows.Scan(&agent.ID, &agent.YAMLPath, &enabled, &pollingInterval,
			&lastRunAt, &lastError, &agent.TotalRuns, &agent.TotalCost,
			&agent.CreatedAt, &agent.UpdatedAt); err != nil {
			return nil, fmt.Errorf("ListOrchestratorAgents scan: %w", err)
		}

		agent.Enabled = intToBool(enabled)
		if pollingInterval.Valid {
			agent.PollingIntervalMs = int(pollingInterval.Int64)
		}
		if lastRunAt.Valid {
			agent.LastRunAt = &lastRunAt.Time
		}
		if lastError.Valid {
			agent.LastError = lastError.String
		}

		agents = append(agents, &agent)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListOrchestratorAgents rows: %w", err)
	}
	return agents, nil
}

// UpdateOrchestratorAgent updates an orchestrator agent's runtime state
func (s *SQLiteStore) UpdateOrchestratorAgent(ctx context.Context, agent *models.OrchestratorAgent) error {
	agent.UpdatedAt = time.Now()

	result, err := s.db.ExecContext(ctx, `
		UPDATE orchestrator_agents
		SET yaml_path = ?, enabled = ?, polling_interval_ms = ?, last_run_at = ?, last_error = ?, total_runs = ?, total_cost = ?, updated_at = ?
		WHERE id = ?`,
		agent.YAMLPath, boolToInt(agent.Enabled), agent.PollingIntervalMs,
		agent.LastRunAt, agent.LastError, agent.TotalRuns, agent.TotalCost,
		agent.UpdatedAt, agent.ID)
	if err != nil {
		return fmt.Errorf("UpdateOrchestratorAgent: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("UpdateOrchestratorAgent rows: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("UpdateOrchestratorAgent: agent not found: %s", agent.ID)
	}
	return nil
}

// DeleteOrchestratorAgent removes an orchestrator agent
func (s *SQLiteStore) DeleteOrchestratorAgent(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM orchestrator_agents WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("DeleteOrchestratorAgent: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("DeleteOrchestratorAgent rows: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("DeleteOrchestratorAgent: agent not found: %s", id)
	}
	return nil
}

// UpsertOrchestratorAgent creates or updates an orchestrator agent
func (s *SQLiteStore) UpsertOrchestratorAgent(ctx context.Context, agent *models.OrchestratorAgent) error {
	now := time.Now()
	if agent.CreatedAt.IsZero() {
		agent.CreatedAt = now
	}
	agent.UpdatedAt = now

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO orchestrator_agents (id, yaml_path, enabled, polling_interval_ms, last_run_at, last_error, total_runs, total_cost, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			yaml_path = excluded.yaml_path,
			updated_at = excluded.updated_at`,
		agent.ID, agent.YAMLPath, boolToInt(agent.Enabled), agent.PollingIntervalMs,
		agent.LastRunAt, agent.LastError, agent.TotalRuns, agent.TotalCost,
		agent.CreatedAt, agent.UpdatedAt)
	if err != nil {
		return fmt.Errorf("UpsertOrchestratorAgent: %w", err)
	}
	return nil
}

// RecordAgentRun updates agent statistics after a run
func (s *SQLiteStore) RecordAgentRun(ctx context.Context, agentID string, cost float64) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx, `
		UPDATE orchestrator_agents
		SET last_run_at = ?, total_runs = total_runs + 1, total_cost = total_cost + ?, updated_at = ?
		WHERE id = ?`,
		now, cost, now, agentID)
	if err != nil {
		return fmt.Errorf("RecordAgentRun: %w", err)
	}
	return nil
}

// SetAgentError records an error for an agent
func (s *SQLiteStore) SetAgentError(ctx context.Context, agentID string, errMsg string) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx, `
		UPDATE orchestrator_agents
		SET last_error = ?, updated_at = ?
		WHERE id = ?`,
		errMsg, now, agentID)
	if err != nil {
		return fmt.Errorf("SetAgentError: %w", err)
	}
	return nil
}

// ClearAgentError clears the error for an agent
func (s *SQLiteStore) ClearAgentError(ctx context.Context, agentID string) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx, `
		UPDATE orchestrator_agents
		SET last_error = NULL, updated_at = ?
		WHERE id = ?`,
		now, agentID)
	if err != nil {
		return fmt.Errorf("ClearAgentError: %w", err)
	}
	return nil
}

// ============================================================================
// Agent Run methods
// ============================================================================

// CreateAgentRun creates a new agent run record
func (s *SQLiteStore) CreateAgentRun(ctx context.Context, run *models.AgentRun) error {
	if run.StartedAt.IsZero() {
		run.StartedAt = time.Now()
	}

	sessionsJSON, err := json.Marshal(run.SessionsCreated)
	if err != nil {
		return fmt.Errorf("CreateAgentRun marshal sessions: %w", err)
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO agent_runs (id, agent_id, trigger, status, result_summary, sessions_created, cost, started_at, completed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		run.ID, run.AgentID, run.Trigger, run.Status, run.ResultSummary,
		string(sessionsJSON), run.Cost, run.StartedAt, run.CompletedAt)
	if err != nil {
		return fmt.Errorf("CreateAgentRun: %w", err)
	}
	return nil
}

// GetAgentRun retrieves an agent run by ID
func (s *SQLiteStore) GetAgentRun(ctx context.Context, id string) (*models.AgentRun, error) {
	var run models.AgentRun
	var sessionsJSON sql.NullString
	var resultSummary sql.NullString
	var completedAt sql.NullTime

	err := s.db.QueryRowContext(ctx, `
		SELECT id, agent_id, trigger, status, result_summary, sessions_created, cost, started_at, completed_at
		FROM agent_runs WHERE id = ?`, id).Scan(
		&run.ID, &run.AgentID, &run.Trigger, &run.Status, &resultSummary,
		&sessionsJSON, &run.Cost, &run.StartedAt, &completedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetAgentRun: %w", err)
	}

	if resultSummary.Valid {
		run.ResultSummary = resultSummary.String
	}
	if completedAt.Valid {
		run.CompletedAt = &completedAt.Time
	}
	if sessionsJSON.Valid && sessionsJSON.String != "" {
		if err := json.Unmarshal([]byte(sessionsJSON.String), &run.SessionsCreated); err != nil {
			return nil, fmt.Errorf("GetAgentRun unmarshal sessions: %w", err)
		}
	}

	return &run, nil
}

// ListAgentRuns retrieves agent runs, optionally filtered by agent ID
func (s *SQLiteStore) ListAgentRuns(ctx context.Context, agentID string, limit int) ([]*models.AgentRun, error) {
	var rows *sql.Rows
	var err error

	if limit <= 0 {
		limit = 50
	}

	if agentID != "" {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, agent_id, trigger, status, result_summary, sessions_created, cost, started_at, completed_at
			FROM agent_runs
			WHERE agent_id = ?
			ORDER BY started_at DESC
			LIMIT ?`, agentID, limit)
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, agent_id, trigger, status, result_summary, sessions_created, cost, started_at, completed_at
			FROM agent_runs
			ORDER BY started_at DESC
			LIMIT ?`, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("ListAgentRuns: %w", err)
	}
	defer rows.Close()

	runs := []*models.AgentRun{}
	for rows.Next() {
		var run models.AgentRun
		var sessionsJSON sql.NullString
		var resultSummary sql.NullString
		var completedAt sql.NullTime

		if err := rows.Scan(&run.ID, &run.AgentID, &run.Trigger, &run.Status, &resultSummary,
			&sessionsJSON, &run.Cost, &run.StartedAt, &completedAt); err != nil {
			return nil, fmt.Errorf("ListAgentRuns scan: %w", err)
		}

		if resultSummary.Valid {
			run.ResultSummary = resultSummary.String
		}
		if completedAt.Valid {
			run.CompletedAt = &completedAt.Time
		}
		if sessionsJSON.Valid && sessionsJSON.String != "" {
			if err := json.Unmarshal([]byte(sessionsJSON.String), &run.SessionsCreated); err != nil {
				return nil, fmt.Errorf("ListAgentRuns unmarshal sessions: %w", err)
			}
		}

		runs = append(runs, &run)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListAgentRuns rows: %w", err)
	}
	return runs, nil
}

// UpdateAgentRun updates an agent run (typically to mark completion)
func (s *SQLiteStore) UpdateAgentRun(ctx context.Context, run *models.AgentRun) error {
	sessionsJSON, err := json.Marshal(run.SessionsCreated)
	if err != nil {
		return fmt.Errorf("UpdateAgentRun marshal sessions: %w", err)
	}

	result, err := s.db.ExecContext(ctx, `
		UPDATE agent_runs
		SET status = ?, result_summary = ?, sessions_created = ?, cost = ?, completed_at = ?
		WHERE id = ?`,
		run.Status, run.ResultSummary, string(sessionsJSON), run.Cost, run.CompletedAt, run.ID)
	if err != nil {
		return fmt.Errorf("UpdateAgentRun: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("UpdateAgentRun rows: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("UpdateAgentRun: run not found: %s", run.ID)
	}
	return nil
}

// CompleteAgentRun marks a run as completed
func (s *SQLiteStore) CompleteAgentRun(ctx context.Context, runID string, status string, summary string, cost float64, sessionsCreated []string) error {
	now := time.Now()
	sessionsJSON, err := json.Marshal(sessionsCreated)
	if err != nil {
		return fmt.Errorf("CompleteAgentRun marshal sessions: %w", err)
	}

	_, err = s.db.ExecContext(ctx, `
		UPDATE agent_runs
		SET status = ?, result_summary = ?, sessions_created = ?, cost = ?, completed_at = ?
		WHERE id = ?`,
		status, summary, string(sessionsJSON), cost, now, runID)
	if err != nil {
		return fmt.Errorf("CompleteAgentRun: %w", err)
	}
	return nil
}

// DeleteAgentRun removes an agent run
func (s *SQLiteStore) DeleteAgentRun(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM agent_runs WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("DeleteAgentRun: %w", err)
	}
	return nil
}

// DeleteAgentRuns removes all runs for an agent
func (s *SQLiteStore) DeleteAgentRuns(ctx context.Context, agentID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM agent_runs WHERE agent_id = ?`, agentID)
	if err != nil {
		return fmt.Errorf("DeleteAgentRuns: %w", err)
	}
	return nil
}

// GetAgentRunStats returns aggregate statistics for agent runs
func (s *SQLiteStore) GetAgentRunStats(ctx context.Context, agentID string, since time.Time) (runs int, cost float64, sessions int, err error) {
	var sessionsJSON sql.NullString

	row := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(cost), 0), GROUP_CONCAT(sessions_created, ',')
		FROM agent_runs
		WHERE agent_id = ? AND started_at >= ?`,
		agentID, since)

	err = row.Scan(&runs, &cost, &sessionsJSON)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("GetAgentRunStats: %w", err)
	}

	// Count sessions (imperfect but good enough for stats)
	if sessionsJSON.Valid && sessionsJSON.String != "" {
		// Count non-empty session arrays
		for _, s := range []byte(sessionsJSON.String) {
			if s == '[' {
				sessions++
			}
		}
	}

	return runs, cost, sessions, nil
}
