package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/chatml/chatml-backend/models"
)

// ============================================================================
// Workflow methods
// ============================================================================

func (s *SQLiteStore) AddWorkflow(ctx context.Context, w *models.Workflow) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO workflows (id, name, description, enabled, graph_json, tool_policy, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		w.ID, w.Name, w.Description, boolToInt(w.Enabled), w.GraphJSON, nullString(w.ToolPolicy),
		w.CreatedAt, w.UpdatedAt)
	if err != nil {
		return fmt.Errorf("AddWorkflow: %w", err)
	}
	return nil
}

func (s *SQLiteStore) GetWorkflow(ctx context.Context, id string) (*models.Workflow, error) {
	var w models.Workflow
	var enabled int
	var toolPolicy sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, description, enabled, graph_json, tool_policy, created_at, updated_at
		FROM workflows WHERE id = ?`, id).Scan(
		&w.ID, &w.Name, &w.Description, &enabled, &w.GraphJSON, &toolPolicy,
		&w.CreatedAt, &w.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetWorkflow: %w", err)
	}
	w.Enabled = intToBool(enabled)
	if toolPolicy.Valid {
		w.ToolPolicy = toolPolicy.String
	}
	return &w, nil
}

func (s *SQLiteStore) ListWorkflows(ctx context.Context) ([]*models.Workflow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, description, enabled, graph_json, tool_policy, created_at, updated_at
		FROM workflows ORDER BY updated_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("ListWorkflows: %w", err)
	}
	defer rows.Close()

	workflows := []*models.Workflow{}
	for rows.Next() {
		var w models.Workflow
		var enabled int
		var toolPolicy sql.NullString
		if err := rows.Scan(&w.ID, &w.Name, &w.Description, &enabled, &w.GraphJSON, &toolPolicy,
			&w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, fmt.Errorf("ListWorkflows scan: %w", err)
		}
		w.Enabled = intToBool(enabled)
		if toolPolicy.Valid {
			w.ToolPolicy = toolPolicy.String
		}
		workflows = append(workflows, &w)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListWorkflows rows: %w", err)
	}
	return workflows, nil
}

func (s *SQLiteStore) UpdateWorkflow(ctx context.Context, w *models.Workflow) error {
	w.UpdatedAt = time.Now()
	_, err := s.db.ExecContext(ctx, `
		UPDATE workflows SET name = ?, description = ?, enabled = ?, graph_json = ?, tool_policy = ?, updated_at = ?
		WHERE id = ?`,
		w.Name, w.Description, boolToInt(w.Enabled), w.GraphJSON, nullString(w.ToolPolicy),
		w.UpdatedAt, w.ID)
	if err != nil {
		return fmt.Errorf("UpdateWorkflow: %w", err)
	}
	return nil
}

func (s *SQLiteStore) DeleteWorkflow(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM workflows WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("DeleteWorkflow: %w", err)
	}
	return nil
}

// ============================================================================
// Trigger methods
// ============================================================================

func (s *SQLiteStore) AddTrigger(ctx context.Context, t *models.Trigger) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO triggers (id, workflow_id, type, config, enabled)
		VALUES (?, ?, ?, ?, ?)`,
		t.ID, t.WorkflowID, t.Type, t.Config, boolToInt(t.Enabled))
	if err != nil {
		return fmt.Errorf("AddTrigger: %w", err)
	}
	return nil
}

func (s *SQLiteStore) GetTrigger(ctx context.Context, id string) (*models.Trigger, error) {
	var t models.Trigger
	var enabled int
	err := s.db.QueryRowContext(ctx, `
		SELECT id, workflow_id, type, config, enabled
		FROM triggers WHERE id = ?`, id).Scan(
		&t.ID, &t.WorkflowID, &t.Type, &t.Config, &enabled)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetTrigger: %w", err)
	}
	t.Enabled = intToBool(enabled)
	return &t, nil
}

func (s *SQLiteStore) ListTriggers(ctx context.Context, workflowID string) ([]*models.Trigger, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, workflow_id, type, config, enabled
		FROM triggers WHERE workflow_id = ?`, workflowID)
	if err != nil {
		return nil, fmt.Errorf("ListTriggers: %w", err)
	}
	defer rows.Close()

	triggers := []*models.Trigger{}
	for rows.Next() {
		var t models.Trigger
		var enabled int
		if err := rows.Scan(&t.ID, &t.WorkflowID, &t.Type, &t.Config, &enabled); err != nil {
			return nil, fmt.Errorf("ListTriggers scan: %w", err)
		}
		t.Enabled = intToBool(enabled)
		triggers = append(triggers, &t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListTriggers rows: %w", err)
	}
	return triggers, nil
}

func (s *SQLiteStore) ListTriggersByType(ctx context.Context, triggerType models.TriggerType) ([]*models.Trigger, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, workflow_id, type, config, enabled
		FROM triggers WHERE type = ? AND enabled = 1`, triggerType)
	if err != nil {
		return nil, fmt.Errorf("ListTriggersByType: %w", err)
	}
	defer rows.Close()

	triggers := []*models.Trigger{}
	for rows.Next() {
		var t models.Trigger
		var enabled int
		if err := rows.Scan(&t.ID, &t.WorkflowID, &t.Type, &t.Config, &enabled); err != nil {
			return nil, fmt.Errorf("ListTriggersByType scan: %w", err)
		}
		t.Enabled = intToBool(enabled)
		triggers = append(triggers, &t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListTriggersByType rows: %w", err)
	}
	return triggers, nil
}

func (s *SQLiteStore) UpdateTrigger(ctx context.Context, t *models.Trigger) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE triggers SET type = ?, config = ?, enabled = ?
		WHERE id = ?`,
		t.Type, t.Config, boolToInt(t.Enabled), t.ID)
	if err != nil {
		return fmt.Errorf("UpdateTrigger: %w", err)
	}
	return nil
}

func (s *SQLiteStore) DeleteTrigger(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM triggers WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("DeleteTrigger: %w", err)
	}
	return nil
}

// ============================================================================
// WorkflowRun methods
// ============================================================================

func (s *SQLiteStore) AddWorkflowRun(ctx context.Context, r *models.WorkflowRun) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO workflow_runs (id, workflow_id, trigger_id, trigger_type, status, input_data, output_data, error, started_at, completed_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.WorkflowID, nullString(r.TriggerID), r.TriggerType, r.Status,
		r.InputData, r.OutputData, r.Error, r.StartedAt, r.CompletedAt, r.CreatedAt)
	if err != nil {
		return fmt.Errorf("AddWorkflowRun: %w", err)
	}
	return nil
}

func (s *SQLiteStore) GetWorkflowRun(ctx context.Context, id string) (*models.WorkflowRun, error) {
	var r models.WorkflowRun
	var triggerID sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT id, workflow_id, trigger_id, trigger_type, status, input_data, output_data, error, started_at, completed_at, created_at
		FROM workflow_runs WHERE id = ?`, id).Scan(
		&r.ID, &r.WorkflowID, &triggerID, &r.TriggerType, &r.Status,
		&r.InputData, &r.OutputData, &r.Error, &r.StartedAt, &r.CompletedAt, &r.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetWorkflowRun: %w", err)
	}
	if triggerID.Valid {
		r.TriggerID = triggerID.String
	}
	return &r, nil
}

func (s *SQLiteStore) ListWorkflowRuns(ctx context.Context, workflowID string) ([]*models.WorkflowRun, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, workflow_id, trigger_id, trigger_type, status, input_data, output_data, error, started_at, completed_at, created_at
		FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC`, workflowID)
	if err != nil {
		return nil, fmt.Errorf("ListWorkflowRuns: %w", err)
	}
	defer rows.Close()

	runs := []*models.WorkflowRun{}
	for rows.Next() {
		var r models.WorkflowRun
		var triggerID sql.NullString
		if err := rows.Scan(&r.ID, &r.WorkflowID, &triggerID, &r.TriggerType, &r.Status,
			&r.InputData, &r.OutputData, &r.Error, &r.StartedAt, &r.CompletedAt, &r.CreatedAt); err != nil {
			return nil, fmt.Errorf("ListWorkflowRuns scan: %w", err)
		}
		if triggerID.Valid {
			r.TriggerID = triggerID.String
		}
		runs = append(runs, &r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListWorkflowRuns rows: %w", err)
	}
	return runs, nil
}

func (s *SQLiteStore) UpdateWorkflowRun(ctx context.Context, r *models.WorkflowRun) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE workflow_runs SET status = ?, output_data = ?, error = ?, started_at = ?, completed_at = ?
		WHERE id = ?`,
		r.Status, r.OutputData, r.Error, r.StartedAt, r.CompletedAt, r.ID)
	if err != nil {
		return fmt.Errorf("UpdateWorkflowRun: %w", err)
	}
	return nil
}

// ============================================================================
// StepRun methods
// ============================================================================

func (s *SQLiteStore) AddStepRun(ctx context.Context, sr *models.StepRun) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO step_runs (id, run_id, node_id, node_label, status, input_data, output_data, error, retry_count, session_id, started_at, completed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sr.ID, sr.RunID, sr.NodeID, sr.NodeLabel, sr.Status,
		sr.InputData, sr.OutputData, sr.Error, sr.RetryCount,
		nullString(sr.SessionID), sr.StartedAt, sr.CompletedAt)
	if err != nil {
		return fmt.Errorf("AddStepRun: %w", err)
	}
	return nil
}

func (s *SQLiteStore) GetStepRun(ctx context.Context, id string) (*models.StepRun, error) {
	var sr models.StepRun
	var sessionID sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT id, run_id, node_id, node_label, status, input_data, output_data, error, retry_count, session_id, started_at, completed_at
		FROM step_runs WHERE id = ?`, id).Scan(
		&sr.ID, &sr.RunID, &sr.NodeID, &sr.NodeLabel, &sr.Status,
		&sr.InputData, &sr.OutputData, &sr.Error, &sr.RetryCount,
		&sessionID, &sr.StartedAt, &sr.CompletedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetStepRun: %w", err)
	}
	if sessionID.Valid {
		sr.SessionID = sessionID.String
	}
	return &sr, nil
}

func (s *SQLiteStore) ListStepRuns(ctx context.Context, runID string) ([]*models.StepRun, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, run_id, node_id, node_label, status, input_data, output_data, error, retry_count, session_id, started_at, completed_at
		FROM step_runs WHERE run_id = ?`, runID)
	if err != nil {
		return nil, fmt.Errorf("ListStepRuns: %w", err)
	}
	defer rows.Close()

	steps := []*models.StepRun{}
	for rows.Next() {
		var sr models.StepRun
		var sessionID sql.NullString
		if err := rows.Scan(&sr.ID, &sr.RunID, &sr.NodeID, &sr.NodeLabel, &sr.Status,
			&sr.InputData, &sr.OutputData, &sr.Error, &sr.RetryCount,
			&sessionID, &sr.StartedAt, &sr.CompletedAt); err != nil {
			return nil, fmt.Errorf("ListStepRuns scan: %w", err)
		}
		if sessionID.Valid {
			sr.SessionID = sessionID.String
		}
		steps = append(steps, &sr)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListStepRuns rows: %w", err)
	}
	return steps, nil
}

func (s *SQLiteStore) UpdateStepRun(ctx context.Context, sr *models.StepRun) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE step_runs SET status = ?, output_data = ?, error = ?, retry_count = ?, session_id = ?, started_at = ?, completed_at = ?
		WHERE id = ?`,
		sr.Status, sr.OutputData, sr.Error, sr.RetryCount,
		nullString(sr.SessionID), sr.StartedAt, sr.CompletedAt, sr.ID)
	if err != nil {
		return fmt.Errorf("UpdateStepRun: %w", err)
	}
	return nil
}
