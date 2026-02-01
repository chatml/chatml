package scripts

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime/debug"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/logger"
	"github.com/google/uuid"
)

const (
	// DefaultScriptTimeout is the maximum time a single script can run
	DefaultScriptTimeout = 5 * time.Minute

	// outputBufferSize is the channel buffer for script output lines
	outputBufferSize = 1000

	// maxOutputLines caps stored output per run to prevent memory issues
	maxOutputLines = 10000
)

// ScriptStatus represents the current state of a script run
type ScriptStatus string

const (
	ScriptStatusPending   ScriptStatus = "pending"
	ScriptStatusRunning   ScriptStatus = "running"
	ScriptStatusSuccess   ScriptStatus = "success"
	ScriptStatusFailed    ScriptStatus = "failed"
	ScriptStatusCancelled ScriptStatus = "cancelled"
)

// ScriptRun tracks the state of a single script execution
type ScriptRun struct {
	ID         string       `json:"id"`
	SessionID  string       `json:"sessionId"`
	ScriptKey  string       `json:"scriptKey,omitempty"`
	ScriptName string       `json:"scriptName"`
	Command    string       `json:"command"`
	Workdir    string       `json:"-"`
	Status     ScriptStatus `json:"status"`
	ExitCode   *int         `json:"exitCode,omitempty"`
	Output     []string     `json:"output"`
	StartedAt  *time.Time   `json:"startedAt,omitempty"`
	FinishedAt *time.Time   `json:"finishedAt,omitempty"`
	CreatedAt  time.Time    `json:"createdAt"`

	cancel context.CancelFunc `json:"-"`
	mu     sync.Mutex         `json:"-"`
}

// OutputHandler is called for each line of script output
type OutputHandler func(sessionID, runID, line string)

// StatusHandler is called when a script run changes status
type StatusHandler func(sessionID string, run *ScriptRun)

// SetupProgressHandler is called to report setup scripts progress
type SetupProgressHandler func(sessionID string, current, total int, status string)

// Runner manages script execution for sessions
type Runner struct {
	activeRuns    map[string]*ScriptRun // runID -> run
	sessionSetups map[string]bool       // sessionID -> setup in progress
	mu            sync.RWMutex

	onOutput        OutputHandler
	onStatus        StatusHandler
	onSetupProgress SetupProgressHandler
}

// NewRunner creates a new script runner with the given callbacks
func NewRunner(onOutput OutputHandler, onStatus StatusHandler, onSetupProgress SetupProgressHandler) *Runner {
	return &Runner{
		activeRuns:      make(map[string]*ScriptRun),
		sessionSetups:   make(map[string]bool),
		onOutput:        onOutput,
		onStatus:        onStatus,
		onSetupProgress: onSetupProgress,
	}
}

// RunScript starts a single script and returns its run ID.
// Output and status updates are sent via the configured callbacks.
func (r *Runner) RunScript(ctx context.Context, sessionID, workdir, scriptKey string, script ScriptDef) (string, error) {
	runID := uuid.New().String()[:8]
	now := time.Now()

	run := &ScriptRun{
		ID:         runID,
		SessionID:  sessionID,
		ScriptKey:  scriptKey,
		ScriptName: script.Name,
		Command:    script.Command,
		Workdir:    workdir,
		Status:     ScriptStatusRunning,
		Output:     make([]string, 0, 128),
		StartedAt:  &now,
		CreatedAt:  now,
	}

	ctx, cancel := context.WithTimeout(ctx, DefaultScriptTimeout)
	run.cancel = cancel

	r.mu.Lock()
	r.activeRuns[runID] = run
	r.mu.Unlock()

	r.emitStatus(run)

	go func() {
		defer cancel()
		r.executeScript(ctx, run)
	}()

	return runID, nil
}

// RunSetupScripts runs all setup scripts sequentially for a session.
// Stops on first failure. Returns error if setup is already in progress.
func (r *Runner) RunSetupScripts(ctx context.Context, sessionID, workdir string, scripts []ScriptDef) error {
	r.mu.Lock()
	if r.sessionSetups[sessionID] {
		r.mu.Unlock()
		return fmt.Errorf("setup already in progress for session %s", sessionID)
	}
	r.sessionSetups[sessionID] = true
	r.mu.Unlock()

	go func() {
		defer func() {
			if rec := recover(); rec != nil {
				logger.Scripts.Errorf("[setup:%s] PANIC: %v\n%s", sessionID, rec, debug.Stack())
			}
			r.mu.Lock()
			delete(r.sessionSetups, sessionID)
			r.mu.Unlock()
		}()

		total := len(scripts)
		for i, script := range scripts {
			r.emitSetupProgress(sessionID, i, total, "running")

			runID := uuid.New().String()[:8]
			now := time.Now()

			run := &ScriptRun{
				ID:         runID,
				SessionID:  sessionID,
				ScriptKey:  fmt.Sprintf("setup_%d", i),
				ScriptName: script.Name,
				Command:    script.Command,
				Workdir:    workdir,
				Status:     ScriptStatusRunning,
				Output:     make([]string, 0, 128),
				StartedAt:  &now,
				CreatedAt:  now,
			}

			scriptCtx, cancel := context.WithTimeout(ctx, DefaultScriptTimeout)
			run.cancel = cancel

			r.mu.Lock()
			r.activeRuns[runID] = run
			r.mu.Unlock()

			r.emitStatus(run)

			// Execute synchronously within the goroutine
			r.executeScript(scriptCtx, run)
			cancel()

			run.mu.Lock()
			status := run.Status
			run.mu.Unlock()

			if status == ScriptStatusFailed || status == ScriptStatusCancelled {
				r.emitSetupProgress(sessionID, i+1, total, "failed")
				return
			}
		}

		r.emitSetupProgress(sessionID, total, total, "completed")
	}()

	return nil
}

// StopScript cancels a running script
func (r *Runner) StopScript(runID string) error {
	r.mu.RLock()
	run, ok := r.activeRuns[runID]
	r.mu.RUnlock()

	if !ok {
		return fmt.Errorf("run %s not found", runID)
	}

	run.mu.Lock()
	if run.Status != ScriptStatusRunning {
		run.mu.Unlock()
		return fmt.Errorf("run %s is not running (status: %s)", runID, run.Status)
	}
	run.mu.Unlock()

	if run.cancel != nil {
		run.cancel()
	}

	return nil
}

// GetRun returns a script run by ID
func (r *Runner) GetRun(runID string) *ScriptRun {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.activeRuns[runID]
}

// GetSessionRuns returns all runs for a session
func (r *Runner) GetSessionRuns(sessionID string) []*ScriptRun {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var runs []*ScriptRun
	for _, run := range r.activeRuns {
		if run.SessionID == sessionID {
			runs = append(runs, run)
		}
	}
	return runs
}

// CancelSessionRuns cancels all active runs for a session
func (r *Runner) CancelSessionRuns(sessionID string) {
	r.mu.RLock()
	var toCancel []*ScriptRun
	for _, run := range r.activeRuns {
		if run.SessionID == sessionID {
			run.mu.Lock()
			if run.Status == ScriptStatusRunning {
				toCancel = append(toCancel, run)
			}
			run.mu.Unlock()
		}
	}
	r.mu.RUnlock()

	for _, run := range toCancel {
		if run.cancel != nil {
			run.cancel()
		}
	}
}

func (r *Runner) executeScript(ctx context.Context, run *ScriptRun) {
	defer func() {
		if rec := recover(); rec != nil {
			logger.Scripts.Errorf("[script:%s] PANIC: %v\n%s", run.ID, rec, debug.Stack())
			r.finishRun(run, ScriptStatusFailed, -1)
		}
	}()

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}

	cmd := exec.CommandContext(ctx, shell, "-c", run.Command)
	if run.Workdir != "" {
		cmd.Dir = run.Workdir
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		logger.Scripts.Errorf("[script:%s] stdout pipe: %v", run.ID, err)
		r.finishRun(run, ScriptStatusFailed, -1)
		return
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		logger.Scripts.Errorf("[script:%s] stderr pipe: %v", run.ID, err)
		r.finishRun(run, ScriptStatusFailed, -1)
		return
	}

	if err := cmd.Start(); err != nil {
		logger.Scripts.Errorf("[script:%s] start: %v", run.ID, err)
		r.finishRun(run, ScriptStatusFailed, -1)
		return
	}

	// Stream output from both stdout and stderr
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			r.appendOutput(run, scanner.Text())
		}
	}()

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			r.appendOutput(run, scanner.Text())
		}
	}()

	// Wait for output goroutines to finish before calling Wait
	wg.Wait()

	err = cmd.Wait()

	if ctx.Err() == context.DeadlineExceeded {
		r.appendOutput(run, "[script timed out]")
		r.finishRun(run, ScriptStatusFailed, -1)
		return
	}

	if ctx.Err() == context.Canceled {
		r.finishRun(run, ScriptStatusCancelled, -1)
		return
	}

	if err != nil {
		exitCode := -1
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
		r.finishRun(run, ScriptStatusFailed, exitCode)
		return
	}

	r.finishRun(run, ScriptStatusSuccess, 0)
}

func (r *Runner) appendOutput(run *ScriptRun, line string) {
	run.mu.Lock()
	if len(run.Output) < maxOutputLines {
		run.Output = append(run.Output, line)
	}
	run.mu.Unlock()

	if r.onOutput != nil {
		r.onOutput(run.SessionID, run.ID, line)
	}
}

func (r *Runner) finishRun(run *ScriptRun, status ScriptStatus, exitCode int) {
	now := time.Now()

	run.mu.Lock()
	run.Status = status
	run.FinishedAt = &now
	if exitCode >= 0 {
		run.ExitCode = &exitCode
	}
	run.cancel = nil // Release context resources
	run.mu.Unlock()

	r.emitStatus(run)

	// Clean up from active runs after a delay to allow clients to fetch final state
	go func() {
		time.Sleep(5 * time.Minute)
		r.mu.Lock()
		delete(r.activeRuns, run.ID)
		r.mu.Unlock()
	}()
}

func (r *Runner) emitStatus(run *ScriptRun) {
	if r.onStatus != nil {
		r.onStatus(run.SessionID, run)
	}
}

func (r *Runner) emitSetupProgress(sessionID string, current, total int, status string) {
	if r.onSetupProgress != nil {
		r.onSetupProgress(sessionID, current, total, status)
	}
}
