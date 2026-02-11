package orchestrator

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/agents"
	"github.com/chatml/chatml-backend/logger"
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

// SessionCreator creates sessions for orchestrator agents operating in creates-session mode.
// The implementation is responsible for worktree creation, session persistence, and
// spawning the agent-runner process with an initial message describing the polled item.
type SessionCreator interface {
	CreateSessionForItem(ctx context.Context, agent *models.OrchestratorAgent, item agents.PollItem) (sessionID string, err error)
}

// Runner executes agent runs
type Runner struct {
	mu             sync.RWMutex
	store          Store
	eventBus       *EventBus
	polling        *agents.PollingManager
	sessionCreator SessionCreator
	running        map[string]*RunContext // runID -> context
}

// RunContext holds the state for a running agent
type RunContext struct {
	Run       *models.AgentRun
	Agent     *models.OrchestratorAgent
	Cancel    context.CancelFunc
	StartTime time.Time
}

// NewRunner creates a new runner. The optional sessionCreator enables creates-session mode;
// if nil, agents in creates-session mode will log items but not create sessions.
func NewRunner(store Store, eventBus *EventBus, polling *agents.PollingManager, sessionCreator SessionCreator) *Runner {
	return &Runner{
		store:          store,
		eventBus:       eventBus,
		polling:        polling,
		sessionCreator: sessionCreator,
		running:        make(map[string]*RunContext),
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
		logger.Runner.Warnf("Failed to clear agent error: %v", err)
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
	// TODO: Populate cost from polling results when cost tracking is available in the polling response.
	var cost float64

	// Execute based on agent type
	sessionsCreated, err := r.runAgent(ctx, rc)
	if err != nil {
		resultStatus = models.AgentRunStatusFailed
		resultSummary = fmt.Sprintf("Error: %v", err)
		logger.Runner.Errorf("Agent %s run %s failed: %v", rc.Agent.ID, rc.Run.ID, err)

		// Record the error
		if storeErr := r.store.SetAgentError(context.Background(), rc.Agent.ID, err.Error()); storeErr != nil {
			logger.Runner.Warnf("Failed to set agent error: %v", storeErr)
		}
	} else {
		resultStatus = models.AgentRunStatusCompleted
		resultSummary = "Completed successfully"
		logger.Runner.Infof("Agent %s run %s completed", rc.Agent.ID, rc.Run.ID)
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
		logger.Runner.Warnf("Failed to complete agent run: %v", err)
	}

	// Record run statistics
	if err := r.store.RecordAgentRun(context.Background(), rc.Agent.ID, cost); err != nil {
		logger.Runner.Warnf("Failed to record agent run stats: %v", err)
	}

	// Publish completion event
	r.eventBus.PublishAgentRunCompleted(rc.Agent.ID, rc.Run, duration.Milliseconds())
}

// runAgent executes the agent logic. Returns the list of created session IDs (if any) and an error.
func (r *Runner) runAgent(ctx context.Context, rc *RunContext) ([]string, error) {
	// Check for cancellation
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	agent := rc.Agent

	// Check if agent has polling configuration
	if agent.Definition == nil || agent.Definition.Polling == nil {
		r.eventBus.PublishAgentRunProgress(agent.ID, rc.Run.ID, "No polling configuration")
		return nil, nil
	}

	r.eventBus.PublishAgentRunProgress(agent.ID, rc.Run.ID, "Polling for updates...")

	// Execute polling — ctx propagates cancellation to the polling adapters
	// (GitHubAdapter.Poll and LinearAdapter.Poll both accept context.Context).
	results, err := r.polling.Poll(ctx, agent)
	if err != nil {
		return nil, fmt.Errorf("polling failed: %w", err)
	}

	// Process results — collect all actionable items for session creation
	var totalItems int
	var actionableItems []agents.PollItem
	var summaryParts []string

	for _, result := range results {
		// Check for cancellation between processing results
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		if result.Error != nil {
			logger.Runner.Warnf("Agent %s: %s polling error: %v", agent.ID, result.Source, result.Error)
			continue
		}

		if result.RateLimited {
			summaryParts = append(summaryParts, fmt.Sprintf("%s: rate limited", result.Source))
			continue
		}

		if result.NotModified {
			summaryParts = append(summaryParts, fmt.Sprintf("%s: no changes", result.Source))
			continue
		}

		totalItems += len(result.Items)

		if len(result.Items) > 0 {
			actionableItems = append(actionableItems, result.Items...)

			// Report what was found
			r.eventBus.PublishAgentRunProgress(agent.ID, rc.Run.ID,
				fmt.Sprintf("Found %d items from %s", len(result.Items), result.Source))

			// Group items by type
			issues := 0
			prs := 0
			for _, item := range result.Items {
				if item.Type == "pull_request" {
					prs++
				} else {
					issues++
				}
			}

			if issues > 0 && prs > 0 {
				summaryParts = append(summaryParts, fmt.Sprintf("%s: %d issues, %d PRs", result.Source, issues, prs))
			} else if issues > 0 {
				summaryParts = append(summaryParts, fmt.Sprintf("%s: %d issues", result.Source, issues))
			} else if prs > 0 {
				summaryParts = append(summaryParts, fmt.Sprintf("%s: %d PRs", result.Source, prs))
			}
		} else {
			summaryParts = append(summaryParts, fmt.Sprintf("%s: no items", result.Source))
		}
	}

	// Build final summary
	if len(summaryParts) > 0 {
		rc.Run.ResultSummary = strings.Join(summaryParts, "; ")
	} else {
		rc.Run.ResultSummary = "No actionable items found"
	}

	r.eventBus.PublishAgentRunProgress(agent.ID, rc.Run.ID, rc.Run.ResultSummary)

	// Create sessions for actionable items if agent is in creates-session mode
	var sessionsCreated []string
	if agent.Definition.Execution.Mode == models.AgentModeCreatesSession && len(actionableItems) > 0 {
		sessionsCreated = r.createSessionsForItems(ctx, rc, agent, actionableItems)
	}

	return sessionsCreated, nil
}

// createSessionsForItems creates sessions for each actionable poll item, respecting rate limits.
func (r *Runner) createSessionsForItems(ctx context.Context, rc *RunContext, agent *models.OrchestratorAgent, items []agents.PollItem) []string {
	if r.sessionCreator == nil {
		logger.Runner.Warnf("Agent %s is in creates-session mode but no SessionCreator is configured", agent.ID)
		return nil
	}

	maxSessions := agent.Definition.Limits.MaxSessionsPerHour
	if maxSessions <= 0 {
		maxSessions = 5 // default limit
	}

	var sessionsCreated []string
	for _, item := range items {
		// Check for cancellation
		select {
		case <-ctx.Done():
			logger.Runner.Infof("Agent %s: session creation cancelled", agent.ID)
			return sessionsCreated
		default:
		}

		// Enforce per-run session limit
		if len(sessionsCreated) >= maxSessions {
			logger.Runner.Infof("Agent %s: reached max sessions per hour (%d), skipping remaining items", agent.ID, maxSessions)
			break
		}

		r.eventBus.PublishAgentRunProgress(agent.ID, rc.Run.ID,
			fmt.Sprintf("Creating session for %s: %s", item.Identifier, item.Title))

		sessionID, err := r.sessionCreator.CreateSessionForItem(ctx, agent, item)
		if err != nil {
			logger.Runner.Warnf("Agent %s: failed to create session for item %s: %v", agent.ID, item.Identifier, err)
			continue
		}

		sessionsCreated = append(sessionsCreated, sessionID)
		logger.Runner.Infof("Agent %s: created session %s for item %s", agent.ID, sessionID, item.Identifier)
	}

	return sessionsCreated
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
