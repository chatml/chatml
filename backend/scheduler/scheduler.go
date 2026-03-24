package scheduler

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/google/uuid"
)

const (
	tickInterval = 60 * time.Second
	maxJitter    = 120 * time.Second
	graceWindow  = 1 * time.Hour
)

// BroadcastFunc is called to notify the frontend of scheduled task events
type BroadcastFunc func(eventType string, payload map[string]interface{})

// Scheduler polls for due scheduled tasks and triggers session creation
type Scheduler struct {
	store     *store.SQLiteStore
	agentMgr  *agent.Manager
	broadcast BroadcastFunc
	ctx       context.Context
	cancel    context.CancelFunc
	wg        sync.WaitGroup
}

func NewScheduler(ctx context.Context, s *store.SQLiteStore, agentMgr *agent.Manager, broadcast BroadcastFunc) *Scheduler {
	ctx, cancel := context.WithCancel(ctx)
	return &Scheduler{
		store:     s,
		agentMgr:  agentMgr,
		broadcast: broadcast,
		ctx:       ctx,
		cancel:    cancel,
	}
}

func (sc *Scheduler) Start() {
	sc.wg.Add(1)
	go sc.run()
}

func (sc *Scheduler) Stop() {
	sc.cancel()
	sc.wg.Wait()
}

func (sc *Scheduler) run() {
	defer sc.wg.Done()

	// On startup, handle missed schedules
	sc.handleMissedSchedules()

	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()

	for {
		select {
		case <-sc.ctx.Done():
			return
		case <-ticker.C:
			sc.tick()
		}
	}
}

func (sc *Scheduler) tick() {
	now := time.Now()
	tasks, err := sc.store.ListDueScheduledTasks(sc.ctx, now)
	if err != nil {
		logger.Main.Errorf("Scheduler: failed to list due tasks: %v", err)
		return
	}

	for _, task := range tasks {
		t := task // capture for goroutine
		sc.wg.Add(1)
		go func() {
			defer sc.wg.Done()
			// Add jitter (0-120s) to spread load
			jitter := time.Duration(rand.Int63n(int64(maxJitter)))
			select {
			case <-sc.ctx.Done():
				return
			case <-time.After(jitter):
			}
			sc.dispatchTask(sc.ctx, t, true)
		}()
	}
}

func (sc *Scheduler) handleMissedSchedules() {
	tasks, err := sc.store.ListAllScheduledTasks(sc.ctx)
	if err != nil {
		logger.Main.Errorf("Scheduler: failed to list tasks for missed schedule check: %v", err)
		return
	}

	now := time.Now()
	for _, task := range tasks {
		if !task.Enabled || task.NextRunAt == nil {
			continue
		}
		if task.NextRunAt.After(now) {
			continue // Not missed
		}
		if now.Sub(*task.NextRunAt) <= graceWindow {
			// Within grace period — trigger immediately in a goroutine
			logger.Main.Infof("Scheduler: triggering missed task %q (was due at %s)", task.Name, task.NextRunAt.Format(time.RFC3339))
			t := task
			sc.wg.Add(1)
			go func() {
				defer sc.wg.Done()
				sc.dispatchTask(sc.ctx, t, true)
			}()
		} else {
			// Too old — advance to next schedule
			logger.Main.Infof("Scheduler: skipping missed task %q (was due at %s, beyond grace window)", task.Name, task.NextRunAt.Format(time.RFC3339))
			nextRun := models.ComputeNextRun(task, now)
			_ = sc.store.UpdateScheduledTask(sc.ctx, task.ID, func(t *models.ScheduledTask) {
				t.NextRunAt = nextRun
			})
		}
	}
}

// dispatchTask is the shared core for creating a run, session, and starting a conversation.
// If updateNextRun is true, it also advances the task's next_run_at.
func (sc *Scheduler) dispatchTask(ctx context.Context, task *models.ScheduledTask, updateNextRun bool) (*models.ScheduledTaskRun, error) {
	now := time.Now()

	// Create run record
	runID := uuid.New().String()[:8]
	run := &models.ScheduledTaskRun{
		ID:              runID,
		ScheduledTaskID: task.ID,
		Status:          models.RunStatusPending,
		TriggeredAt:     now,
	}
	if err := sc.store.AddScheduledTaskRun(ctx, run); err != nil {
		logger.Main.Errorf("Scheduler: failed to create run for task %q: %v", task.Name, err)
		return nil, fmt.Errorf("failed to create run: %w", err)
	}

	// Create session for this run.
	// Scheduled tasks always create base sessions — worktree setup requires
	// branch creation and git operations that are handled by the session_handlers
	// create flow. UseWorktree is stored on the task for future support.
	sessionID := uuid.New().String()[:8]
	sessionName := fmt.Sprintf("%s – %s", now.Format("Jan 2"), task.Name)

	session := &models.Session{
		ID:              sessionID,
		WorkspaceID:     task.WorkspaceID,
		Name:            sessionName,
		SessionType:     models.SessionTypeBase,
		Status:          models.SessionStatusIdle,
		TaskStatus:      models.TaskStatusInProgress,
		ScheduledTaskID: task.ID,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := sc.store.AddSession(ctx, session); err != nil {
		logger.Main.Errorf("Scheduler: failed to create session for task %q: %v", task.Name, err)
		_ = sc.store.UpdateScheduledTaskRun(ctx, runID, func(r *models.ScheduledTaskRun) {
			r.Status = models.RunStatusFailed
			r.ErrorMessage = fmt.Sprintf("failed to create session: %v", err)
			completedAt := time.Now()
			r.CompletedAt = &completedAt
		})
		return run, fmt.Errorf("failed to create session: %w", err)
	}

	// Start conversation with the task prompt
	var opts *agent.StartConversationOptions
	if task.Model != "" || task.PermissionMode != "" {
		opts = &agent.StartConversationOptions{
			Model:          task.Model,
			PermissionMode: task.PermissionMode,
		}
	}

	_, err := sc.agentMgr.StartConversation(ctx, sessionID, "task", task.Prompt, opts)
	if err != nil {
		logger.Main.Errorf("Scheduler: failed to start conversation for task %q: %v", task.Name, err)
		_ = sc.store.UpdateScheduledTaskRun(ctx, runID, func(r *models.ScheduledTaskRun) {
			r.Status = models.RunStatusFailed
			r.SessionID = sessionID
			r.ErrorMessage = fmt.Sprintf("failed to start conversation: %v", err)
			completedAt := time.Now()
			r.CompletedAt = &completedAt
		})
		return run, fmt.Errorf("failed to start conversation: %w", err)
	}

	// Update run to running
	startedAt := time.Now()
	_ = sc.store.UpdateScheduledTaskRun(ctx, runID, func(r *models.ScheduledTaskRun) {
		r.Status = models.RunStatusRunning
		r.SessionID = sessionID
		r.StartedAt = &startedAt
	})

	// Update task: set last_run_at and optionally compute next_run_at
	_ = sc.store.UpdateScheduledTask(ctx, task.ID, func(t *models.ScheduledTask) {
		t.LastRunAt = &now
		if updateNextRun {
			t.NextRunAt = models.ComputeNextRun(task, now)
		}
	})

	// Broadcast event for UI update
	if sc.broadcast != nil {
		sc.broadcast("scheduled_task_run", map[string]interface{}{
			"taskId":    task.ID,
			"taskName":  task.Name,
			"runId":     runID,
			"sessionId": sessionID,
			"status":    models.RunStatusRunning,
		})
	}

	logger.Main.Infof("Scheduler: triggered task %q → session %s (run %s)", task.Name, sessionID, runID)

	run.Status = models.RunStatusRunning
	run.SessionID = sessionID
	run.StartedAt = &startedAt
	return run, nil
}

// TriggerNow manually triggers a scheduled task immediately, bypassing the schedule
func (sc *Scheduler) TriggerNow(ctx context.Context, taskID string) (*models.ScheduledTaskRun, error) {
	task, err := sc.store.GetScheduledTask(ctx, taskID)
	if err != nil {
		return nil, fmt.Errorf("failed to get task: %w", err)
	}
	if task == nil {
		return nil, fmt.Errorf("task not found: %s", taskID)
	}

	return sc.dispatchTask(ctx, task, false)
}
