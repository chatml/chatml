package scheduler

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-core/git"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-core/naming"
	"github.com/chatml/chatml-backend/store"
	"github.com/google/uuid"
)

const (
	tickInterval = 60 * time.Second
	maxJitter    = 120 * time.Second
)

// graceWindowFor returns the maximum age of a missed schedule that should still
// be dispatched on startup. Shorter frequencies get shorter windows so we don't
// fire extremely stale runs (e.g. an hourly task from 23 hours ago).
func graceWindowFor(frequency string) time.Duration {
	switch frequency {
	case models.FrequencyHourly:
		return 2 * time.Hour
	case models.FrequencyDaily:
		return 24 * time.Hour
	case models.FrequencyWeekly:
		return 48 * time.Hour
	case models.FrequencyMonthly:
		return 48 * time.Hour
	default:
		return 24 * time.Hour
	}
}

// BroadcastFunc is called to notify the frontend of scheduled task events
type BroadcastFunc func(eventType string, payload map[string]interface{})

// Scheduler polls for due scheduled tasks and triggers session creation
type Scheduler struct {
	store           *store.SQLiteStore
	agentMgr        *agent.Manager
	worktreeManager *git.WorktreeManager
	broadcast       BroadcastFunc
	ctx             context.Context
	cancel          context.CancelFunc
	wg              sync.WaitGroup
}

func NewScheduler(ctx context.Context, s *store.SQLiteStore, agentMgr *agent.Manager, wm *git.WorktreeManager, broadcast BroadcastFunc) *Scheduler {
	ctx, cancel := context.WithCancel(ctx)
	return &Scheduler{
		store:           s,
		agentMgr:        agentMgr,
		worktreeManager: wm,
		broadcast:       broadcast,
		ctx:             ctx,
		cancel:          cancel,
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
		grace := graceWindowFor(task.Frequency)
		if now.Sub(*task.NextRunAt) <= grace {
			// Within grace period — trigger immediately in a goroutine
			logger.Main.Infof("Scheduler: triggering missed task %q (was due at %s)", task.Name, task.NextRunAt.Format(time.RFC3339))
			t := task
			sc.wg.Add(1)
			go func() {
				defer sc.wg.Done()
				sc.dispatchTask(sc.ctx, t, true)
			}()
		} else {
			// Too old — advance to next schedule and record a skipped run for visibility
			logger.Main.Infof("Scheduler: skipping missed task %q (was due at %s, beyond grace window)", task.Name, task.NextRunAt.Format(time.RFC3339))
			completedAt := now
			if err := sc.store.AddScheduledTaskRun(sc.ctx, &models.ScheduledTaskRun{
				ID:              uuid.New().String()[:8],
				ScheduledTaskID: task.ID,
				Status:          models.RunStatusSkipped,
				TriggeredAt:     *task.NextRunAt,
				CompletedAt:     &completedAt,
				ErrorMessage:    fmt.Sprintf("Skipped: app was not running at scheduled time (%s)", task.NextRunAt.Format("Jan 2 15:04")),
			}); err != nil {
				logger.Main.Errorf("Scheduler: failed to record skipped run for task %q: %v", task.Name, err)
			}
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

	failRun := func(sessionID, msg string) {
		_ = sc.store.UpdateScheduledTaskRun(ctx, runID, func(r *models.ScheduledTaskRun) {
			r.Status = models.RunStatusFailed
			r.SessionID = sessionID
			r.ErrorMessage = msg
			completedAt := time.Now()
			r.CompletedAt = &completedAt
		})
	}

	// ── Create a proper worktree session (same as regular session creation) ──

	// Look up workspace/repo
	repo, err := sc.store.GetRepo(ctx, task.WorkspaceID)
	if err != nil {
		failRun("", fmt.Sprintf("failed to get workspace: %v", err))
		return run, fmt.Errorf("failed to get workspace: %w", err)
	}
	if repo == nil {
		failRun("", fmt.Sprintf("workspace not found: %s", task.WorkspaceID))
		return run, fmt.Errorf("workspace not found: %s", task.WorkspaceID)
	}

	// Resolve workspaces base directory
	workspacesDir, err := git.WorkspacesBaseDir()
	if err != nil {
		failRun("", fmt.Sprintf("failed to get workspaces dir: %v", err))
		return run, fmt.Errorf("failed to get workspaces dir: %w", err)
	}
	if err := os.MkdirAll(workspacesDir, 0755); err != nil {
		failRun("", fmt.Sprintf("failed to create workspaces dir: %v", err))
		return run, fmt.Errorf("failed to create workspaces dir: %w", err)
	}

	// Resolve target branch (same logic as CreateSession handler)
	remote := repo.Remote
	if remote == "" {
		remote = "origin"
	}
	targetBranch := remote + "/" + repo.Branch
	if targetBranch == remote+"/" {
		targetBranch = remote + "/main"
	}

	// Generate session name and create worktree with retry on collisions
	const maxRetries = 5
	var sessionName, branchName, worktreePath, baseCommitSHA string
	for attempt := 0; attempt < maxRetries; attempt++ {
		candidateName := naming.GenerateUniqueSessionName(nil)
		candidateBranch := fmt.Sprintf("session/%s", candidateName)

		sessionPath, dirErr := git.CreateSessionDirectoryAtomic(workspacesDir, candidateName)
		if dirErr != nil {
			if errors.Is(dirErr, git.ErrDirectoryExists) {
				continue // Name collision — retry
			}
			failRun("", fmt.Sprintf("failed to create session directory: %v", dirErr))
			return run, fmt.Errorf("failed to create session directory: %w", dirErr)
		}

		wtPath, wtBranch, wtCommit, wtErr := sc.worktreeManager.CreateInExistingDir(ctx, repo.Path, sessionPath, candidateBranch, targetBranch)
		if wtErr == nil {
			sessionName = candidateName
			branchName = wtBranch
			worktreePath = wtPath
			baseCommitSHA = wtCommit
			break
		}

		// Branch collision — clean up directory and retry
		if errors.Is(wtErr, git.ErrLocalBranchExists) || errors.Is(wtErr, git.ErrBranchAlreadyCheckedOut) {
			_ = os.RemoveAll(sessionPath)
			logger.Main.Infof("Scheduler: branch collision on %q, retrying (attempt %d/%d)", candidateBranch, attempt+1, maxRetries)
			continue
		}

		// Non-collision error — clean up and fail
		_ = os.RemoveAll(sessionPath)
		failRun("", fmt.Sprintf("failed to create worktree: %v", wtErr))
		return run, fmt.Errorf("failed to create worktree: %w", wtErr)
	}

	if sessionName == "" {
		failRun("", "failed to generate unique session name after retries")
		return run, fmt.Errorf("failed to generate unique session name after %d retries", maxRetries)
	}

	// Create session with full worktree info
	sessionID := uuid.New().String()[:8]
	session := &models.Session{
		ID:              sessionID,
		WorkspaceID:     task.WorkspaceID,
		Name:            sessionName,
		Branch:          branchName,
		WorktreePath:    worktreePath,
		BaseCommitSHA:   baseCommitSHA,
		SessionType:     models.SessionTypeScheduled,
		Status:          models.SessionStatusIdle,
		TaskStatus:      models.TaskStatusInProgress,
		ScheduledTaskID: task.ID,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := sc.store.AddSession(ctx, session); err != nil {
		logger.Main.Errorf("Scheduler: failed to create session for task %q: %v", task.Name, err)
		// Clean up worktree on failure
		sc.worktreeManager.RemoveAtPath(context.Background(), repo.Path, worktreePath, branchName)
		failRun("", fmt.Sprintf("failed to create session: %v", err))
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

	_, err = sc.agentMgr.StartConversation(ctx, sessionID, "task", task.Prompt, opts)
	if err != nil {
		logger.Main.Errorf("Scheduler: failed to start conversation for task %q: %v", task.Name, err)
		// Clean up worktree on failure (use background ctx so cleanup isn't cancelled)
		sc.worktreeManager.RemoveAtPath(context.Background(), repo.Path, worktreePath, branchName)
		failRun(sessionID, fmt.Sprintf("failed to start conversation: %v", err))
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

	logger.Main.Infof("Scheduler: triggered task %q → session %s (run %s, branch %s)", task.Name, sessionID, runID, branchName)

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
