// Package automation provides workflow orchestration: parsing React Flow graphs
// into DAGs, executing nodes in topological order, and piping data between steps.
package automation

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/server"
	"github.com/chatml/chatml-backend/store"
	"github.com/google/uuid"
)

// Engine orchestrates workflow execution: trigger → DAG parse → step execution → broadcast.
type Engine struct {
	ctx        context.Context
	store      *store.SQLiteStore
	hub        *server.Hub
	executors  map[string]StepExecutor
	runQueue   chan runRequest
	activeRuns map[string]context.CancelFunc
	mu         sync.RWMutex
}

type runRequest struct {
	run      *models.WorkflowRun
	workflow *models.Workflow
}

// NewEngine creates a new automation engine.
func NewEngine(ctx context.Context, s *store.SQLiteStore, hub *server.Hub) *Engine {
	e := &Engine{
		ctx:        ctx,
		store:      s,
		hub:        hub,
		executors:  make(map[string]StepExecutor),
		runQueue:   make(chan runRequest, 64),
		activeRuns: make(map[string]context.CancelFunc),
	}
	return e
}

// RegisterExecutor registers a StepExecutor for a given node kind prefix (e.g. "action-agent").
func (e *Engine) RegisterExecutor(kind string, exec StepExecutor) {
	e.executors[kind] = exec
}

// Start begins processing the run queue. Call once during server startup.
func (e *Engine) Start() {
	go e.processQueue()
	logger.Automation.Info("Automation engine started")
}

// StartRun creates a workflow run and enqueues it for execution.
func (e *Engine) StartRun(ctx context.Context, workflowID, triggerID, triggerType string, inputData map[string]interface{}) (*models.WorkflowRun, error) {
	workflow, err := e.store.GetWorkflow(ctx, workflowID)
	if err != nil {
		return nil, fmt.Errorf("get workflow: %w", err)
	}
	if workflow == nil {
		return nil, fmt.Errorf("workflow %s not found", workflowID)
	}
	if !workflow.Enabled {
		return nil, fmt.Errorf("workflow %s is disabled", workflowID)
	}

	inputJSON, _ := json.Marshal(inputData)
	now := time.Now()
	run := &models.WorkflowRun{
		ID:          uuid.New().String(),
		WorkflowID:  workflowID,
		TriggerID:   triggerID,
		TriggerType: triggerType,
		Status:      models.WorkflowRunStatusPending,
		InputData:   string(inputJSON),
		OutputData:  "{}",
		CreatedAt:   now,
	}

	if err := e.store.AddWorkflowRun(ctx, run); err != nil {
		return nil, fmt.Errorf("create run: %w", err)
	}

	e.broadcastRunEvent("workflow:run_started", run, nil)

	// Return a snapshot to the caller so the goroutine can safely mutate run.
	snapshot := *run

	select {
	case e.runQueue <- runRequest{run: run, workflow: workflow}:
	default:
		// Queue full — mark as failed
		run.Status = models.WorkflowRunStatusFailed
		run.Error = "run queue full"
		completedAt := time.Now()
		run.CompletedAt = &completedAt
		_ = e.store.UpdateWorkflowRun(ctx, run)
		e.broadcastRunEvent("workflow:run_completed", run, nil)
		return run, fmt.Errorf("run queue full")
	}

	return &snapshot, nil
}

// CancelRun cancels a running workflow. Returns true if the run was active and
// cancellation was signalled (the engine goroutine will update the DB).
func (e *Engine) CancelRun(runID string) bool {
	e.mu.RLock()
	cancel, ok := e.activeRuns[runID]
	e.mu.RUnlock()
	if ok {
		cancel()
	}
	return ok
}

// processQueue is the main loop that picks runs off the queue and executes them.
func (e *Engine) processQueue() {
	for {
		select {
		case <-e.ctx.Done():
			return
		case req := <-e.runQueue:
			go e.executeRun(req)
		}
	}
}

// executeRun parses the workflow graph into a DAG, topologically sorts nodes,
// and executes each step in order, passing output data along edges.
func (e *Engine) executeRun(req runRequest) {
	runCtx, cancel := context.WithCancel(e.ctx)
	defer cancel()

	run := req.run
	workflow := req.workflow

	e.mu.Lock()
	e.activeRuns[run.ID] = cancel
	e.mu.Unlock()
	defer func() {
		e.mu.Lock()
		delete(e.activeRuns, run.ID)
		e.mu.Unlock()
	}()

	// Mark as running
	now := time.Now()
	run.Status = models.WorkflowRunStatusRunning
	run.StartedAt = &now
	_ = e.store.UpdateWorkflowRun(runCtx, run)

	logger.Automation.Infof("Starting run %s for workflow %s (%s)", run.ID, workflow.ID, workflow.Name)

	// Parse graph
	graph, err := ParseGraph(workflow.GraphJSON)
	if err != nil {
		e.failRun(runCtx, run, fmt.Sprintf("parse graph: %v", err))
		return
	}

	// Topological sort
	sorted, err := graph.TopologicalSort()
	if err != nil {
		e.failRun(runCtx, run, fmt.Sprintf("topological sort: %v", err))
		return
	}

	if len(sorted) == 0 {
		e.completeRun(runCtx, run, "{}")
		return
	}

	// Node output accumulator: nodeID -> output JSON
	nodeOutputs := make(map[string]string)

	// Execute each node in topological order
	for _, nodeID := range sorted {
		if runCtx.Err() != nil {
			e.cancelRun(runCtx, run)
			return
		}

		node, ok := graph.Nodes[nodeID]
		if !ok {
			continue
		}

		// Collect input from upstream nodes (merge all parent outputs)
		stepInput := e.buildStepInput(run.InputData, nodeID, graph, nodeOutputs)

		// Create step run record
		stepRun := &models.StepRun{
			ID:        uuid.New().String(),
			RunID:     run.ID,
			NodeID:    nodeID,
			NodeLabel: node.Label,
			Status:    "running",
			InputData: stepInput,
		}
		stepStarted := time.Now()
		stepRun.StartedAt = &stepStarted
		_ = e.store.AddStepRun(runCtx, stepRun)

		e.broadcastNodeEvent("workflow:node_started", run.ID, nodeID, nil)

		// Find executor for this node kind
		executor, hasExecutor := e.executors[node.Kind]
		if !hasExecutor {
			// Skip trigger nodes and unknown kinds
			if isTriggerKind(node.Kind) {
				stepRun.Status = "completed"
				stepRun.OutputData = stepInput // Pass through
				completedAt := time.Now()
				stepRun.CompletedAt = &completedAt
				_ = e.store.UpdateStepRun(runCtx, stepRun)
				nodeOutputs[nodeID] = stepInput
				e.broadcastNodeEvent("workflow:node_completed", run.ID, nodeID, map[string]interface{}{
					"status":     "completed",
					"durationMs": time.Since(stepStarted).Milliseconds(),
				})
				continue
			}
			stepRun.Status = "failed"
			stepRun.Error = fmt.Sprintf("no executor for node kind: %s", node.Kind)
			completedAt := time.Now()
			stepRun.CompletedAt = &completedAt
			_ = e.store.UpdateStepRun(runCtx, stepRun)
			e.broadcastNodeEvent("workflow:node_completed", run.ID, nodeID, map[string]interface{}{
				"status": "failed",
				"error":  stepRun.Error,
			})
			e.failRun(runCtx, run, fmt.Sprintf("node %s: %s", nodeID, stepRun.Error))
			return
		}

		// Execute the step with retry support
		maxRetries := intFromConfig(node.Config, "maxRetries", 0)
		onFailure, _ := node.Config["onFailure"].(string)

		var result *StepResult
		var execErr error

		for attempt := 0; attempt <= maxRetries; attempt++ {
			if attempt > 0 {
				// Exponential backoff: 1s, 2s, 4s, 8s... capped at 60s
				backoff := time.Duration(math.Min(float64(time.Second)*math.Pow(2, float64(attempt-1)), float64(60*time.Second)))
				logger.Automation.Infof("Run %s node %s: retry %d/%d after %v", run.ID, nodeID, attempt, maxRetries, backoff)

				stepRun.RetryCount = attempt
				_ = e.store.UpdateStepRun(runCtx, stepRun)

				select {
				case <-runCtx.Done():
					e.cancelRun(runCtx, run)
					return
				case <-time.After(backoff):
				}
			}

			result, execErr = executor.Execute(runCtx, StepContext{
				RunID:    run.ID,
				NodeID:   nodeID,
				NodeKind: node.Kind,
				Config:   node.Config,
				Input:    stepInput,
			})

			if execErr == nil {
				break
			}

			// Only retry if onFailure is "retry" and we have attempts left
			if onFailure != "retry" || attempt >= maxRetries {
				break
			}
		}

		completedAt := time.Now()
		stepRun.CompletedAt = &completedAt

		if execErr != nil {
			// Check if the run was cancelled (context cancelled)
			if runCtx.Err() != nil {
				stepRun.Status = "cancelled"
				stepRun.Error = "cancelled"
				_ = e.store.UpdateStepRun(runCtx, stepRun)
				e.cancelRun(context.Background(), run)
				return
			}

			stepRun.Status = "failed"
			stepRun.Error = execErr.Error()
			_ = e.store.UpdateStepRun(runCtx, stepRun)
			e.broadcastNodeEvent("workflow:node_completed", run.ID, nodeID, map[string]interface{}{
				"status":     "failed",
				"error":      execErr.Error(),
				"durationMs": time.Since(stepStarted).Milliseconds(),
				"retries":    stepRun.RetryCount,
			})

			switch onFailure {
			case "skip":
				nodeOutputs[nodeID] = "{}"
				continue
			default: // "stop" or "retry" (exhausted retries)
				e.failRun(runCtx, run, fmt.Sprintf("node %s (%s) failed after %d retries: %v", nodeID, node.Label, stepRun.RetryCount, execErr))
				return
			}
		}

		stepRun.Status = "completed"
		stepRun.OutputData = result.OutputData
		stepRun.SessionID = result.SessionID
		_ = e.store.UpdateStepRun(runCtx, stepRun)
		nodeOutputs[nodeID] = result.OutputData

		e.broadcastNodeEvent("workflow:node_completed", run.ID, nodeID, map[string]interface{}{
			"status":     "completed",
			"durationMs": time.Since(stepStarted).Milliseconds(),
			"retries":    stepRun.RetryCount,
		})
	}

	// Last node's output becomes the run output
	lastNodeID := sorted[len(sorted)-1]
	finalOutput := nodeOutputs[lastNodeID]
	if finalOutput == "" {
		finalOutput = "{}"
	}
	e.completeRun(runCtx, run, finalOutput)
}

// buildStepInput merges the run's initial input with outputs from upstream nodes.
func (e *Engine) buildStepInput(runInputData string, nodeID string, graph *Graph, nodeOutputs map[string]string) string {
	parents := graph.IncomingNodes(nodeID)
	if len(parents) == 0 {
		// Root node (trigger) — use the run's input data
		return runInputData
	}

	// Merge parent outputs into a single input object
	merged := make(map[string]interface{})

	// Always include the original run input as "trigger"
	var triggerData interface{}
	if err := json.Unmarshal([]byte(runInputData), &triggerData); err == nil {
		merged["trigger"] = triggerData
	}

	// Each parent's output keyed by its node ID
	for _, parentID := range parents {
		output, ok := nodeOutputs[parentID]
		if !ok {
			continue
		}
		var parsed interface{}
		if err := json.Unmarshal([]byte(output), &parsed); err == nil {
			merged[parentID] = parsed
		}
	}

	// If there's exactly one parent, also set "input" as a convenience alias
	if len(parents) == 1 {
		output := nodeOutputs[parents[0]]
		var parsed interface{}
		if err := json.Unmarshal([]byte(output), &parsed); err == nil {
			merged["input"] = parsed
		}
	}

	result, _ := json.Marshal(merged)
	return string(result)
}

func (e *Engine) failRun(ctx context.Context, run *models.WorkflowRun, errMsg string) {
	run.Status = models.WorkflowRunStatusFailed
	run.Error = errMsg
	completedAt := time.Now()
	run.CompletedAt = &completedAt
	_ = e.store.UpdateWorkflowRun(ctx, run)
	logger.Automation.Errorf("Run %s failed: %s", run.ID, errMsg)
	e.broadcastRunEvent("workflow:run_completed", run, map[string]interface{}{
		"status":     "failed",
		"error":      errMsg,
		"durationMs": timeSinceMs(run.StartedAt),
	})
}

func (e *Engine) completeRun(ctx context.Context, run *models.WorkflowRun, output string) {
	run.Status = models.WorkflowRunStatusCompleted
	run.OutputData = output
	completedAt := time.Now()
	run.CompletedAt = &completedAt
	_ = e.store.UpdateWorkflowRun(ctx, run)
	logger.Automation.Infof("Run %s completed successfully", run.ID)
	e.broadcastRunEvent("workflow:run_completed", run, map[string]interface{}{
		"status":     "completed",
		"durationMs": timeSinceMs(run.StartedAt),
	})
}

func (e *Engine) cancelRun(ctx context.Context, run *models.WorkflowRun) {
	run.Status = models.WorkflowRunStatusCancelled
	completedAt := time.Now()
	run.CompletedAt = &completedAt
	_ = e.store.UpdateWorkflowRun(ctx, run)
	logger.Automation.Infof("Run %s cancelled", run.ID)
	e.broadcastRunEvent("workflow:run_completed", run, map[string]interface{}{
		"status":     "cancelled",
		"durationMs": timeSinceMs(run.StartedAt),
	})
}

func (e *Engine) broadcastRunEvent(eventType string, run *models.WorkflowRun, extra map[string]interface{}) {
	payload := map[string]interface{}{
		"workflowId": run.WorkflowID,
		"runId":      run.ID,
		"status":     string(run.Status),
		"timestamp":  time.Now().UnixMilli(),
	}
	for k, v := range extra {
		payload[k] = v
	}
	e.hub.Broadcast(server.Event{
		Type:    eventType,
		Payload: payload,
	})
}

func (e *Engine) broadcastNodeEvent(eventType string, runID, nodeID string, extra map[string]interface{}) {
	payload := map[string]interface{}{
		"runId":     runID,
		"nodeId":    nodeID,
		"timestamp": time.Now().UnixMilli(),
	}
	for k, v := range extra {
		payload[k] = v
	}
	e.hub.Broadcast(server.Event{
		Type:    eventType,
		Payload: payload,
	})
}

func isTriggerKind(kind string) bool {
	return len(kind) >= 8 && kind[:8] == "trigger-"
}

func timeSinceMs(t *time.Time) int64 {
	if t == nil {
		return 0
	}
	return time.Since(*t).Milliseconds()
}

// intFromConfig extracts an int from a config map, returning def if missing or not a number.
func intFromConfig(config map[string]interface{}, key string, def int) int {
	v, ok := config[key]
	if !ok {
		return def
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	default:
		return def
	}
}
