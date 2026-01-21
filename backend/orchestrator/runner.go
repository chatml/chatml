package orchestrator

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/google/uuid"
)

// Store interface for runner persistence
type Store interface {
	CreateAgentRun(ctx context.Context, run *models.AgentRun) error
	UpdateAgentRun(ctx context.Context, run *models.AgentRun) error
	CompleteAgentRun(ctx context.Context, runID string, status string, summary string, cost float64, sessionsCreated []string) error
	RecordAgentRun(ctx context.Context, agentID string, cost float64) error
	SetAgentError(ctx context.Context, agentID string, errMsg string) error
	ClearAgentError(ctx context.Context, agentID string) error
}

// Runner executes agent runs
type Runner struct {
	mu       sync.RWMutex
	store    Store
	eventBus *EventBus
	running  map[string]*RunContext // runID -> context
}

// RunContext holds the state for a running agent
type RunContext struct {
	Run       *models.AgentRun
	Agent     *models.OrchestratorAgent
	Cancel    context.CancelFunc
	StartTime time.Time
}

// NewRunner creates a new runner
func NewRunner(store Store, eventBus *EventBus) *Runner {
	return &Runner{
		store:    store,
		eventBus: eventBus,
		running:  make(map[string]*RunContext),
	}
}

// StartRun begins executing an agent
func (r *Runner) StartRun(ctx context.Context, agent *models.OrchestratorAgent, trigger string) (*models.AgentRun, error) {
	// Check if agent is already running
	if r.IsAgentRunning(agent.ID) {
		return nil, fmt.Errorf("agent %s is already running", agent.ID)
	}

	// Create the run record
	run := &models.AgentRun{
		ID:        uuid.New().String(),
		AgentID:   agent.ID,
		Trigger:   trigger,
		Status:    models.AgentRunStatusRunning,
		StartedAt: time.Now(),
	}

	// Persist the run
	if err := r.store.CreateAgentRun(ctx, run); err != nil {
		return nil, fmt.Errorf("create agent run: %w", err)
	}

	// Clear any previous error
	if err := r.store.ClearAgentError(ctx, agent.ID); err != nil {
		log.Printf("[runner] Warning: failed to clear agent error: %v", err)
	}

	// Create run context with cancellation
	runCtx, cancel := context.WithCancel(ctx)
	rc := &RunContext{
		Run:       run,
		Agent:     agent,
		Cancel:    cancel,
		StartTime: time.Now(),
	}

	r.mu.Lock()
	r.running[run.ID] = rc
	r.mu.Unlock()

	// Publish start event
	r.eventBus.PublishAgentRunStarted(agent.ID, run.ID, trigger)

	// Execute the agent asynchronously
	go r.executeRun(runCtx, rc)

	return run, nil
}

// executeRun performs the actual agent execution
func (r *Runner) executeRun(ctx context.Context, rc *RunContext) {
	defer func() {
		r.mu.Lock()
		delete(r.running, rc.Run.ID)
		r.mu.Unlock()
	}()

	var resultStatus string
	var resultSummary string
	var cost float64
	var sessionsCreated []string

	// Execute based on agent type
	err := r.runAgent(ctx, rc)
	if err != nil {
		resultStatus = models.AgentRunStatusFailed
		resultSummary = fmt.Sprintf("Error: %v", err)
		log.Printf("[runner] Agent %s run %s failed: %v", rc.Agent.ID, rc.Run.ID, err)

		// Record the error
		if storeErr := r.store.SetAgentError(context.Background(), rc.Agent.ID, err.Error()); storeErr != nil {
			log.Printf("[runner] Warning: failed to set agent error: %v", storeErr)
		}
	} else {
		resultStatus = models.AgentRunStatusCompleted
		resultSummary = "Completed successfully"
		log.Printf("[runner] Agent %s run %s completed", rc.Agent.ID, rc.Run.ID)
	}

	// Calculate duration
	duration := time.Since(rc.StartTime)

	// Update the run record
	now := time.Now()
	rc.Run.Status = resultStatus
	rc.Run.ResultSummary = resultSummary
	rc.Run.Cost = cost
	rc.Run.SessionsCreated = sessionsCreated
	rc.Run.CompletedAt = &now

	if err := r.store.CompleteAgentRun(context.Background(), rc.Run.ID, resultStatus, resultSummary, cost, sessionsCreated); err != nil {
		log.Printf("[runner] Warning: failed to complete agent run: %v", err)
	}

	// Record run statistics
	if err := r.store.RecordAgentRun(context.Background(), rc.Agent.ID, cost); err != nil {
		log.Printf("[runner] Warning: failed to record agent run stats: %v", err)
	}

	// Publish completion event
	r.eventBus.PublishAgentRunCompleted(rc.Agent.ID, rc.Run, duration.Milliseconds())
}

// runAgent executes the agent logic
// This is a placeholder that will be expanded to actually run the agent
func (r *Runner) runAgent(ctx context.Context, rc *RunContext) error {
	// Check for cancellation
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	// TODO: In the full implementation, this will:
	// 1. Poll the configured sources (GitHub, Linear)
	// 2. Determine if there's work to do
	// 3. If agent mode is creates-session, spawn the agent-runner
	// 4. Track progress and report back

	// For now, publish a progress event and return success
	r.eventBus.PublishAgentRunProgress(rc.Agent.ID, rc.Run.ID, "Checking for updates...")

	// Simulate a brief check
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(100 * time.Millisecond):
	}

	r.eventBus.PublishAgentRunProgress(rc.Agent.ID, rc.Run.ID, "No actionable items found")

	return nil
}

// StopRun cancels a running agent
func (r *Runner) StopRun(runID string) error {
	r.mu.RLock()
	rc, ok := r.running[runID]
	r.mu.RUnlock()

	if !ok {
		return fmt.Errorf("run %s not found or already completed", runID)
	}

	rc.Cancel()
	return nil
}

// StopAgent stops all runs for an agent
func (r *Runner) StopAgent(agentID string) {
	r.mu.RLock()
	var toCancel []*RunContext
	for _, rc := range r.running {
		if rc.Agent.ID == agentID {
			toCancel = append(toCancel, rc)
		}
	}
	r.mu.RUnlock()

	for _, rc := range toCancel {
		rc.Cancel()
	}
}

// IsAgentRunning checks if an agent has an active run
func (r *Runner) IsAgentRunning(agentID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, rc := range r.running {
		if rc.Agent.ID == agentID {
			return true
		}
	}
	return false
}

// GetRunningRuns returns all currently running runs
func (r *Runner) GetRunningRuns() []*models.AgentRun {
	r.mu.RLock()
	defer r.mu.RUnlock()

	runs := make([]*models.AgentRun, 0, len(r.running))
	for _, rc := range r.running {
		runs = append(runs, rc.Run)
	}
	return runs
}

// GetRunContext returns the context for a specific run
func (r *Runner) GetRunContext(runID string) (*RunContext, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rc, ok := r.running[runID]
	return rc, ok
}

// StopAll cancels all running agents
func (r *Runner) StopAll() {
	r.mu.RLock()
	toCancel := make([]*RunContext, 0, len(r.running))
	for _, rc := range r.running {
		toCancel = append(toCancel, rc)
	}
	r.mu.RUnlock()

	for _, rc := range toCancel {
		rc.Cancel()
	}
}
