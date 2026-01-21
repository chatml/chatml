package models

import "time"

// OrchestratorAgent represents an agent definition with runtime state
type OrchestratorAgent struct {
	ID                string     `json:"id"`
	YAMLPath          string     `json:"yamlPath"`
	Enabled           bool       `json:"enabled"`
	PollingIntervalMs int        `json:"pollingIntervalMs,omitempty"`
	LastRunAt         *time.Time `json:"lastRunAt,omitempty"`
	LastError         string     `json:"lastError,omitempty"`
	TotalRuns         int        `json:"totalRuns"`
	TotalCost         float64    `json:"totalCost"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`

	// Loaded from YAML (not persisted in DB)
	Definition *AgentDefinition `json:"definition,omitempty"`
}

// AgentDefinition represents the YAML agent definition
type AgentDefinition struct {
	ID           string              `yaml:"id" json:"id"`
	Name         string              `yaml:"name" json:"name"`
	Type         string              `yaml:"type" json:"type"`
	Description  string              `yaml:"description" json:"description"`
	Execution    AgentExecution      `yaml:"execution" json:"execution"`
	Polling      *AgentPolling       `yaml:"polling,omitempty" json:"polling,omitempty"`
	Capabilities []string            `yaml:"capabilities" json:"capabilities"`
	SystemPrompt string              `yaml:"systemPrompt" json:"systemPrompt"`
	Limits       AgentLimits         `yaml:"limits" json:"limits"`
}

// AgentExecution defines how the agent runs
type AgentExecution struct {
	Mode             string `yaml:"mode" json:"mode"` // read-only, creates-session, uses-session
	WorkingDirectory string `yaml:"workingDirectory" json:"workingDirectory"` // root, session
}

// AgentPolling defines polling configuration
type AgentPolling struct {
	Interval string               `yaml:"interval" json:"interval"`
	Sources  []AgentPollingSource `yaml:"sources" json:"sources"`
}

// AgentPollingSource defines a source to poll
type AgentPollingSource struct {
	Type      string            `yaml:"type" json:"type"` // github, linear
	Owner     string            `yaml:"owner,omitempty" json:"owner,omitempty"`
	Repo      string            `yaml:"repo,omitempty" json:"repo,omitempty"`
	Resources []string          `yaml:"resources,omitempty" json:"resources,omitempty"`
	Filters   map[string]any    `yaml:"filters,omitempty" json:"filters,omitempty"`
}

// AgentLimits defines budget and rate limits
type AgentLimits struct {
	BudgetPerRun       float64 `yaml:"budgetPerRun" json:"budgetPerRun"`
	MaxSessionsPerHour int     `yaml:"maxSessionsPerHour" json:"maxSessionsPerHour"`
}

// AgentRun represents a single execution of an agent
type AgentRun struct {
	ID              string     `json:"id"`
	AgentID         string     `json:"agentId"`
	Trigger         string     `json:"trigger"` // poll, manual, event
	Status          string     `json:"status"`  // running, completed, failed
	ResultSummary   string     `json:"resultSummary,omitempty"`
	SessionsCreated []string   `json:"sessionsCreated,omitempty"`
	Cost            float64    `json:"cost"`
	StartedAt       time.Time  `json:"startedAt"`
	CompletedAt     *time.Time `json:"completedAt,omitempty"`
}

// AgentRunStatus constants
const (
	AgentRunStatusRunning   = "running"
	AgentRunStatusCompleted = "completed"
	AgentRunStatusFailed    = "failed"
)

// AgentTrigger constants
const (
	AgentTriggerPoll   = "poll"
	AgentTriggerManual = "manual"
	AgentTriggerEvent  = "event"
)

// AgentExecutionMode constants
const (
	AgentModeReadOnly       = "read-only"
	AgentModeCreatesSession = "creates-session"
	AgentModeUsesSession    = "uses-session"
)
