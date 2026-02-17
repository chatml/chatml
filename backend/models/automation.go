package models

import "time"

// TriggerType represents the kind of trigger that starts a workflow
type TriggerType string

const (
	TriggerTypeEvent   TriggerType = "event"
	TriggerTypeWebhook TriggerType = "webhook"
	TriggerTypeCron    TriggerType = "cron"
	TriggerTypeManual  TriggerType = "manual"
)

// ValidTriggerTypes is the set of valid trigger type values
var ValidTriggerTypes = map[TriggerType]bool{
	TriggerTypeEvent:   true,
	TriggerTypeWebhook: true,
	TriggerTypeCron:    true,
	TriggerTypeManual:  true,
}

// WorkflowRunStatus represents the status of a workflow run
type WorkflowRunStatus string

const (
	WorkflowRunStatusPending   WorkflowRunStatus = "pending"
	WorkflowRunStatusRunning   WorkflowRunStatus = "running"
	WorkflowRunStatusCompleted WorkflowRunStatus = "completed"
	WorkflowRunStatusFailed    WorkflowRunStatus = "failed"
	WorkflowRunStatusCancelled WorkflowRunStatus = "cancelled"
)

// Workflow represents a workflow definition with its visual graph
type Workflow struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	Enabled     bool      `json:"enabled"`
	GraphJSON   string    `json:"graphJson"`          // React Flow nodes + edges + viewport
	ToolPolicy  string    `json:"toolPolicy"`         // JSON: default ToolPolicyConfig for all steps
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Trigger defines what starts a workflow run
type Trigger struct {
	ID         string      `json:"id"`
	WorkflowID string      `json:"workflowId"`
	Type       TriggerType `json:"type"`
	Config     string      `json:"config"` // JSON blob (cron expression, event name, webhook secret, etc.)
	Enabled    bool        `json:"enabled"`
}

// ToolPolicyConfig defines tool access constraints for agent steps
type ToolPolicyConfig struct {
	ToolPreset      string   `json:"toolPreset,omitempty"`      // full, read-only, no-bash, safe-edit
	AllowedTools    []string `json:"allowedTools,omitempty"`
	DisallowedTools []string `json:"disallowedTools,omitempty"`
	MaxBudgetUsd    float64  `json:"maxBudgetUsd,omitempty"`
	MaxTurns        int      `json:"maxTurns,omitempty"`
}

// WorkflowRun represents a single execution of a workflow
type WorkflowRun struct {
	ID          string            `json:"id"`
	WorkflowID  string            `json:"workflowId"`
	TriggerID   string            `json:"triggerId,omitempty"`
	TriggerType string            `json:"triggerType"`
	Status      WorkflowRunStatus `json:"status"`
	InputData   string            `json:"inputData"`  // JSON
	OutputData  string            `json:"outputData"` // JSON
	Error       string            `json:"error,omitempty"`
	StartedAt   *time.Time        `json:"startedAt,omitempty"`
	CompletedAt *time.Time        `json:"completedAt,omitempty"`
	CreatedAt   time.Time         `json:"createdAt"`
}

// StepRun represents the execution of a single node within a workflow run
type StepRun struct {
	ID          string     `json:"id"`
	RunID       string     `json:"runId"`
	NodeID      string     `json:"nodeId"`    // React Flow node ID
	NodeLabel   string     `json:"nodeLabel"`
	Status      string     `json:"status"`    // pending, running, completed, failed, skipped
	InputData   string     `json:"inputData"`
	OutputData  string     `json:"outputData"`
	Error       string     `json:"error,omitempty"`
	RetryCount  int        `json:"retryCount"`
	SessionID   string     `json:"sessionId,omitempty"` // Links to sessions table for agent steps
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
}
