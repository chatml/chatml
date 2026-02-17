package automation

import "context"

// StepContext carries the runtime context for a single step execution.
type StepContext struct {
	RunID    string
	NodeID   string
	NodeKind string
	Config   map[string]interface{}
	Input    string // JSON
}

// StepResult is returned by a StepExecutor after execution.
type StepResult struct {
	OutputData string // JSON
	SessionID  string // set by agent executor, empty for others
}

// StepExecutor is the interface for executing a single workflow node.
type StepExecutor interface {
	Execute(ctx context.Context, step StepContext) (*StepResult, error)
}
