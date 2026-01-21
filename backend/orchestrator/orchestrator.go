package orchestrator

import (
	"context"
	"fmt"
	"log"
	"sync"

	"github.com/chatml/chatml-backend/agents"
	"github.com/chatml/chatml-backend/models"
)

// OrchestratorStore defines the store interface needed by the orchestrator
type OrchestratorStore interface {
	Store // Embed runner store interface
	GetOrchestratorAgent(ctx context.Context, id string) (*models.OrchestratorAgent, error)
	ListOrchestratorAgents(ctx context.Context) ([]*models.OrchestratorAgent, error)
	CreateOrchestratorAgent(ctx context.Context, agent *models.OrchestratorAgent) error
	UpdateOrchestratorAgent(ctx context.Context, agent *models.OrchestratorAgent) error
	UpsertOrchestratorAgent(ctx context.Context, agent *models.OrchestratorAgent) error
	DeleteOrchestratorAgent(ctx context.Context, id string) error
	ListAgentRuns(ctx context.Context, agentID string, limit int) ([]*models.AgentRun, error)
	GetAgentRun(ctx context.Context, id string) (*models.AgentRun, error)
}

// Orchestrator coordinates agent lifecycle and execution
type Orchestrator struct {
	mu        sync.RWMutex
	store     OrchestratorStore
	loader    *agents.Loader
	scheduler *Scheduler
	runner    *Runner
	eventBus  *EventBus

	// In-memory cache of agents with their definitions
	agents map[string]*models.OrchestratorAgent

	ctx    context.Context
	cancel context.CancelFunc
}

// Config holds orchestrator configuration
type Config struct {
	AgentsDir string // Directory containing agent YAML files
}

// New creates a new orchestrator
func New(store OrchestratorStore, config Config) *Orchestrator {
	ctx, cancel := context.WithCancel(context.Background())

	eventBus := NewEventBus()
	runner := NewRunner(store, eventBus)

	o := &Orchestrator{
		store:    store,
		loader:   agents.NewLoader(config.AgentsDir),
		eventBus: eventBus,
		runner:   runner,
		agents:   make(map[string]*models.OrchestratorAgent),
		ctx:      ctx,
		cancel:   cancel,
	}

	// Create scheduler with callback to the orchestrator
	o.scheduler = NewScheduler(o.onScheduledRun)

	return o
}

// Start initializes the orchestrator and begins scheduling
func (o *Orchestrator) Start() error {
	log.Printf("[orchestrator] Starting...")

	// Load agent definitions from YAML files
	if err := o.loadAgents(); err != nil {
		return fmt.Errorf("load agents: %w", err)
	}

	// Schedule enabled agents
	o.scheduleAllAgents()

	log.Printf("[orchestrator] Started with %d agents", len(o.agents))
	return nil
}

// Stop shuts down the orchestrator
func (o *Orchestrator) Stop() {
	log.Printf("[orchestrator] Stopping...")
	o.cancel()
	o.scheduler.Stop()
	o.runner.StopAll()
	log.Printf("[orchestrator] Stopped")
}

// loadAgents loads agent definitions and syncs with database
func (o *Orchestrator) loadAgents() error {
	// Load from YAML files
	yamlAgents, err := o.loader.LoadAll()
	if err != nil {
		log.Printf("[orchestrator] Warning: failed to load agent files: %v", err)
		// Continue - we might have agents in the database
	}

	// Get existing agents from database
	dbAgents, err := o.store.ListOrchestratorAgents(o.ctx)
	if err != nil {
		return fmt.Errorf("list agents from store: %w", err)
	}

	// Create a map of database agents
	dbAgentMap := make(map[string]*models.OrchestratorAgent)
	for _, a := range dbAgents {
		dbAgentMap[a.ID] = a
	}

	// Sync YAML agents to database
	for _, yamlAgent := range yamlAgents {
		if dbAgent, exists := dbAgentMap[yamlAgent.ID]; exists {
			// Agent exists - update YAML path and keep runtime state
			yamlAgent.Enabled = dbAgent.Enabled
			yamlAgent.LastRunAt = dbAgent.LastRunAt
			yamlAgent.LastError = dbAgent.LastError
			yamlAgent.TotalRuns = dbAgent.TotalRuns
			yamlAgent.TotalCost = dbAgent.TotalCost
			yamlAgent.CreatedAt = dbAgent.CreatedAt

			// Update the yaml path in case it changed
			if err := o.store.UpsertOrchestratorAgent(o.ctx, yamlAgent); err != nil {
				log.Printf("[orchestrator] Warning: failed to update agent %s: %v", yamlAgent.ID, err)
			}
		} else {
			// New agent - create in database
			if err := o.store.CreateOrchestratorAgent(o.ctx, yamlAgent); err != nil {
				log.Printf("[orchestrator] Warning: failed to create agent %s: %v", yamlAgent.ID, err)
			}
		}

		// Store in memory cache
		o.mu.Lock()
		o.agents[yamlAgent.ID] = yamlAgent
		o.mu.Unlock()
	}

	// Handle agents that exist in DB but not in YAML (orphaned)
	yamlAgentIDs := make(map[string]bool)
	for _, a := range yamlAgents {
		yamlAgentIDs[a.ID] = true
	}
	for _, dbAgent := range dbAgents {
		if !yamlAgentIDs[dbAgent.ID] {
			log.Printf("[orchestrator] Agent %s exists in database but has no YAML file", dbAgent.ID)
			// Keep it in memory but mark as potentially orphaned
			// Don't delete - user might want to keep the history
			o.mu.Lock()
			o.agents[dbAgent.ID] = dbAgent
			o.mu.Unlock()
		}
	}

	return nil
}

// scheduleAllAgents schedules all enabled agents
func (o *Orchestrator) scheduleAllAgents() {
	o.mu.RLock()
	defer o.mu.RUnlock()

	for _, agent := range o.agents {
		if agent.Enabled && agent.PollingIntervalMs > 0 {
			o.scheduler.Schedule(agent.ID, agent.PollingIntervalMs)
		}
	}
}

// onScheduledRun is called when a scheduled agent should run
func (o *Orchestrator) onScheduledRun(agentID string) {
	o.mu.RLock()
	agent, ok := o.agents[agentID]
	o.mu.RUnlock()

	if !ok {
		log.Printf("[orchestrator] Scheduled run for unknown agent: %s", agentID)
		return
	}

	if !agent.Enabled {
		log.Printf("[orchestrator] Skipping disabled agent: %s", agentID)
		return
	}

	// Start the run
	_, err := o.runner.StartRun(o.ctx, agent, models.AgentTriggerPoll)
	if err != nil {
		log.Printf("[orchestrator] Failed to start scheduled run for agent %s: %v", agentID, err)
	}
}

// ReloadAgents reloads agent definitions from YAML files
func (o *Orchestrator) ReloadAgents() error {
	log.Printf("[orchestrator] Reloading agents...")

	// Stop all schedulers
	o.scheduler.Stop()

	// Recreate scheduler
	o.scheduler = NewScheduler(o.onScheduledRun)

	// Reload agents
	if err := o.loadAgents(); err != nil {
		return err
	}

	// Reschedule
	o.scheduleAllAgents()

	log.Printf("[orchestrator] Reloaded %d agents", len(o.agents))
	return nil
}

// GetAgent returns an agent by ID
func (o *Orchestrator) GetAgent(id string) (*models.OrchestratorAgent, bool) {
	o.mu.RLock()
	defer o.mu.RUnlock()
	agent, ok := o.agents[id]
	return agent, ok
}

// ListAgents returns all agents
func (o *Orchestrator) ListAgents() []*models.OrchestratorAgent {
	o.mu.RLock()
	defer o.mu.RUnlock()

	result := make([]*models.OrchestratorAgent, 0, len(o.agents))
	for _, agent := range o.agents {
		result = append(result, agent)
	}
	return result
}

// EnableAgent enables an agent and starts scheduling
func (o *Orchestrator) EnableAgent(id string) error {
	o.mu.Lock()
	agent, ok := o.agents[id]
	if !ok {
		o.mu.Unlock()
		return fmt.Errorf("agent not found: %s", id)
	}

	agent.Enabled = true
	o.mu.Unlock()

	// Update in database
	if err := o.store.UpdateOrchestratorAgent(o.ctx, agent); err != nil {
		return fmt.Errorf("update agent: %w", err)
	}

	// Schedule the agent
	if agent.PollingIntervalMs > 0 {
		o.scheduler.Schedule(id, agent.PollingIntervalMs)
	}

	// Publish event
	o.eventBus.PublishAgentStateChanged(id, true, "")

	return nil
}

// DisableAgent disables an agent and stops scheduling
func (o *Orchestrator) DisableAgent(id string) error {
	o.mu.Lock()
	agent, ok := o.agents[id]
	if !ok {
		o.mu.Unlock()
		return fmt.Errorf("agent not found: %s", id)
	}

	agent.Enabled = false
	o.mu.Unlock()

	// Update in database
	if err := o.store.UpdateOrchestratorAgent(o.ctx, agent); err != nil {
		return fmt.Errorf("update agent: %w", err)
	}

	// Stop scheduling
	o.scheduler.Unschedule(id)

	// Stop any running runs
	o.runner.StopAgent(id)

	// Publish event
	o.eventBus.PublishAgentStateChanged(id, false, "")

	return nil
}

// UpdateAgentInterval updates the polling interval for an agent
func (o *Orchestrator) UpdateAgentInterval(id string, intervalMs int) error {
	o.mu.Lock()
	agent, ok := o.agents[id]
	if !ok {
		o.mu.Unlock()
		return fmt.Errorf("agent not found: %s", id)
	}

	agent.PollingIntervalMs = intervalMs
	o.mu.Unlock()

	// Update in database
	if err := o.store.UpdateOrchestratorAgent(o.ctx, agent); err != nil {
		return fmt.Errorf("update agent: %w", err)
	}

	// Update schedule if enabled
	if agent.Enabled && intervalMs > 0 {
		o.scheduler.UpdateInterval(id, intervalMs)
	} else {
		o.scheduler.Unschedule(id)
	}

	return nil
}

// TriggerAgentRun manually triggers an agent run
func (o *Orchestrator) TriggerAgentRun(id string) (*models.AgentRun, error) {
	o.mu.RLock()
	agent, ok := o.agents[id]
	o.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("agent not found: %s", id)
	}

	return o.runner.StartRun(o.ctx, agent, models.AgentTriggerManual)
}

// GetAgentRuns returns recent runs for an agent
func (o *Orchestrator) GetAgentRuns(agentID string, limit int) ([]*models.AgentRun, error) {
	return o.store.ListAgentRuns(o.ctx, agentID, limit)
}

// GetAgentRun returns a specific run
func (o *Orchestrator) GetAgentRun(runID string) (*models.AgentRun, error) {
	return o.store.GetAgentRun(o.ctx, runID)
}

// IsAgentRunning checks if an agent has an active run
func (o *Orchestrator) IsAgentRunning(agentID string) bool {
	return o.runner.IsAgentRunning(agentID)
}

// StopAgentRun stops a running agent run
func (o *Orchestrator) StopAgentRun(runID string) error {
	return o.runner.StopRun(runID)
}

// Subscribe adds an event handler
func (o *Orchestrator) Subscribe(handler EventHandler) {
	o.eventBus.Subscribe(handler)
}

// EventBus returns the event bus for external subscriptions
func (o *Orchestrator) EventBus() *EventBus {
	return o.eventBus
}
