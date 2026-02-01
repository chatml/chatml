package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime/debug"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
)

const (
	// processOutputTimeout is how long to wait for buffer space before dropping
	// a message from stdout/stderr. This gives slow consumers time to catch up.
	processOutputTimeout = 5 * time.Second

)

// AgentRunnerPath can be set to override the default agent-runner location
var AgentRunnerPath string

// ProcessOptions contains options for creating a new process
type ProcessOptions struct {
	ID                  string
	Workdir             string
	ConversationID      string
	ResumeSession       string // Session ID to resume
	ForkSession         bool   // Whether to fork the session
	LinearIssue         string // Linear issue identifier (e.g., "LIN-123")
	ToolPreset          string // Tool preset: full, read-only, no-bash, safe-edit
	EnableCheckpointing bool   // Enable file checkpointing for rewind
	MaxBudgetUsd        float64
	MaxTurns            int
	MaxThinkingTokens   int
	PlanMode            bool   // Start agent in plan mode
	Instructions        string // Additional instructions for the agent (e.g., conversation summaries)
	StructuredOutput    string
	SettingSources      string // Comma-separated: project,user,local
	Betas               string // Comma-separated beta features
	Model               string // Model name override
	FallbackModel       string // Fallback model name
}

type Process struct {
	ID             string
	ConversationID string
	SessionID      string // Track the current session ID
	cmd            *exec.Cmd
	stdin          io.WriteCloser
	cancel         context.CancelFunc
	output         chan string
	done           chan struct{}
	mu              sync.Mutex
	running         bool
	stopped         bool // Prevents double-stop race conditions
	exitErr         error
	planModeActive  bool // Tracks whether the process is in plan mode
	droppedMessages    atomic.Uint64 // Count of messages dropped due to full output buffer
	instructionsFile   string        // Temp file for instructions, cleaned up on stop
}

// InputMessage represents a message sent to the agent runner via stdin
type InputMessage struct {
	Type           string              `json:"type"`
	Content        string              `json:"content,omitempty"`
	Model          string              `json:"model,omitempty"`
	PermissionMode string              `json:"permissionMode,omitempty"`
	CheckpointUuid string              `json:"checkpointUuid,omitempty"`
	Attachments    []models.Attachment `json:"attachments,omitempty"`
	// User question response fields (for AskUserQuestion tool)
	QuestionRequestID string            `json:"questionRequestId,omitempty"`
	Answers           map[string]string `json:"answers,omitempty"`
}

// findAgentRunner locates the agent-runner executable
func findAgentRunner() string {
	// 1. Check environment variable
	if path := os.Getenv("CHATML_AGENT_RUNNER"); path != "" {
		return path
	}

	// 2. Check package-level override
	if AgentRunnerPath != "" {
		return AgentRunnerPath
	}

	// 3. Try relative to current working directory (development)
	cwd, _ := os.Getwd()
	candidates := []string{
		filepath.Join(cwd, "agent-runner", "dist", "index.js"),
		filepath.Join(cwd, "..", "agent-runner", "dist", "index.js"),
		filepath.Join(cwd, "..", "..", "agent-runner", "dist", "index.js"),
	}

	for _, path := range candidates {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}

	// 4. Fallback to expecting it in PATH or configured location
	return "chatml-agent-runner"
}

// NewProcess creates a new agent process (backwards compatible)
func NewProcess(id, workdir, conversationID string) *Process {
	return NewProcessWithOptions(ProcessOptions{
		ID:             id,
		Workdir:        workdir,
		ConversationID: conversationID,
	})
}

// NewProcessWithOptions creates a new agent process with full options
func NewProcessWithOptions(opts ProcessOptions) *Process {
	ctx, cancel := context.WithCancel(context.Background())

	agentRunnerPath := findAgentRunner()

	// Build command arguments
	args := []string{
		agentRunnerPath,
		"--cwd", opts.Workdir,
		"--conversation-id", opts.ConversationID,
	}

	// Add session resume if specified
	if opts.ResumeSession != "" {
		args = append(args, "--resume", opts.ResumeSession)
	}

	// Add fork flag if specified
	if opts.ForkSession && opts.ResumeSession != "" {
		args = append(args, "--fork")
	}

	// Add Linear issue if specified
	if opts.LinearIssue != "" {
		args = append(args, "--linear-issue", opts.LinearIssue)
	}

	// Add tool preset if specified
	if opts.ToolPreset != "" {
		args = append(args, "--tool-preset", opts.ToolPreset)
	}

	// Add file checkpointing if enabled
	if opts.EnableCheckpointing {
		args = append(args, "--enable-checkpointing")
	}

	// Add budget controls
	if opts.MaxBudgetUsd > 0 {
		args = append(args, "--max-budget-usd", fmt.Sprintf("%.2f", opts.MaxBudgetUsd))
	}
	if opts.MaxTurns > 0 {
		args = append(args, "--max-turns", strconv.Itoa(opts.MaxTurns))
	}
	if opts.MaxThinkingTokens > 0 {
		args = append(args, "--max-thinking-tokens", strconv.Itoa(opts.MaxThinkingTokens))
	}
	if opts.PlanMode {
		args = append(args, "--permission-mode", "plan")
	}

	// Add instructions (e.g., from conversation summaries)
	var instructionsFile string
	if opts.Instructions != "" {
		// Write to temp file to avoid shell arg length limits
		tmpFile, err := os.CreateTemp("", "chatml-instructions-*.txt")
		if err == nil {
			_, _ = tmpFile.WriteString(opts.Instructions)
			tmpFile.Close()
			instructionsFile = tmpFile.Name()
			args = append(args, "--instructions-file", instructionsFile)
		}
	}

	// Add structured output schema if provided
	if opts.StructuredOutput != "" {
		args = append(args, "--structured-output", opts.StructuredOutput)
	}
	if opts.SettingSources != "" {
		args = append(args, "--setting-sources", opts.SettingSources)
	}
	if opts.Betas != "" {
		args = append(args, "--betas", opts.Betas)
	}
	if opts.Model != "" {
		args = append(args, "--model", opts.Model)
	}
	if opts.FallbackModel != "" {
		args = append(args, "--fallback-model", opts.FallbackModel)
	}

	// Spawn the Node agent runner
	cmd := exec.CommandContext(ctx, "node", args...)
	cmd.Dir = opts.Workdir

	return &Process{
		ID:             opts.ID,
		ConversationID: opts.ConversationID,
		cmd:            cmd,
		cancel:         cancel,
		// Buffer size of 4000 provides headroom for bursty agent output.
		// This allows the process to continue producing output even if
		// consumers (WebSocket clients) are temporarily slow. Large buffer
		// absorbs transient spikes from tool results and large code blocks.
		output:           make(chan string, 4000),
		done:             make(chan struct{}),
		planModeActive:   opts.PlanMode,
		instructionsFile: instructionsFile,
	}
}

func (p *Process) Start() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	stdin, err := p.cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("stdin pipe: %w", err)
	}
	p.stdin = stdin

	stdout, err := p.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}

	stderr, err := p.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	if err := p.cmd.Start(); err != nil {
		return fmt.Errorf("start: %w", err)
	}

	p.running = true

	// WaitGroup to track when stdout/stderr goroutines complete
	var outputWg sync.WaitGroup
	outputWg.Add(2)

	// Stream stdout
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Process.Errorf("[%s] PANIC in stdout reader: %v\n%s", p.ID, r, debug.Stack())
			}
			outputWg.Done()
		}()
		scanner := bufio.NewScanner(stdout)
		// Increase buffer for large JSON events
		buf := make([]byte, 0, 1024*1024)
		scanner.Buffer(buf, 10*1024*1024)
		for scanner.Scan() {
			select {
			case p.output <- scanner.Text():
				// Successfully queued
			case <-time.After(processOutputTimeout):
				// Buffer full after timeout - downstream reader is persistently slow
				dropped := p.droppedMessages.Add(1)
				logger.Process.Warnf("[%s] Output buffer full after %v timeout, dropping stdout message (total dropped: %d)", p.ID, processOutputTimeout, dropped)
			}
		}
	}()

	// Stream stderr
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Process.Errorf("[%s] PANIC in stderr reader: %v\n%s", p.ID, r, debug.Stack())
			}
			outputWg.Done()
		}()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			select {
			case p.output <- "[stderr] " + scanner.Text():
				// Successfully queued
			case <-time.After(processOutputTimeout):
				// Buffer full after timeout - downstream reader is persistently slow
				dropped := p.droppedMessages.Add(1)
				logger.Process.Warnf("[%s] Output buffer full after %v timeout, dropping stderr message (total dropped: %d)", p.ID, processOutputTimeout, dropped)
			}
		}
	}()

	// Wait for completion
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Process.Errorf("[%s] PANIC in completion handler: %v\n%s", p.ID, r, debug.Stack())
			}
		}()

		err := p.cmd.Wait()
		p.mu.Lock()
		p.running = false
		p.exitErr = err
		p.mu.Unlock()

		// Wait for stdout/stderr goroutines to finish before closing output channel
		outputWg.Wait()
		close(p.output)

		close(p.done)
	}()

	return nil
}

// SendMessage sends a user message to the running agent process
func (p *Process) SendMessage(content string) error {
	return p.sendInput(InputMessage{
		Type:    "message",
		Content: content,
	})
}

// SendMessageWithAttachments sends a user message with file attachments to the running agent process
func (p *Process) SendMessageWithAttachments(content string, attachments []models.Attachment) error {
	return p.sendInput(InputMessage{
		Type:        "message",
		Content:     content,
		Attachments: attachments,
	})
}

// SendStop sends a stop message to gracefully terminate the agent
func (p *Process) SendStop() error {
	return p.sendInput(InputMessage{
		Type: "stop",
	})
}

// SendInterrupt sends an interrupt message to stop the current operation
func (p *Process) SendInterrupt() error {
	return p.sendInput(InputMessage{
		Type: "interrupt",
	})
}

// SetModel sends a message to change the model
func (p *Process) SetModel(model string) error {
	return p.sendInput(InputMessage{
		Type:  "set_model",
		Model: model,
	})
}

// SetPermissionMode sends a message to change the permission mode
func (p *Process) SetPermissionMode(mode string) error {
	err := p.sendInput(InputMessage{
		Type:           "set_permission_mode",
		PermissionMode: mode,
	})
	if err == nil {
		p.mu.Lock()
		p.planModeActive = (mode == "plan")
		p.mu.Unlock()
	}
	return err
}

// IsPlanModeActive returns whether the process is currently in plan mode
func (p *Process) IsPlanModeActive() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.planModeActive
}

// GetSupportedModels requests the list of supported models
func (p *Process) GetSupportedModels() error {
	return p.sendInput(InputMessage{
		Type: "get_supported_models",
	})
}

// GetSupportedCommands requests the list of supported slash commands
func (p *Process) GetSupportedCommands() error {
	return p.sendInput(InputMessage{
		Type: "get_supported_commands",
	})
}

// GetMcpStatus requests the status of MCP servers
func (p *Process) GetMcpStatus() error {
	return p.sendInput(InputMessage{
		Type: "get_mcp_status",
	})
}

// GetAccountInfo requests account information
func (p *Process) GetAccountInfo() error {
	return p.sendInput(InputMessage{
		Type: "get_account_info",
	})
}

// RewindFiles rewinds file changes to a specific checkpoint
func (p *Process) RewindFiles(checkpointUuid string) error {
	return p.sendInput(InputMessage{
		Type:           "rewind_files",
		CheckpointUuid: checkpointUuid,
	})
}

// SendUserQuestionResponse sends the user's answers to a pending AskUserQuestion
func (p *Process) SendUserQuestionResponse(requestId string, answers map[string]string) error {
	return p.sendInput(InputMessage{
		Type:              "user_question_response",
		QuestionRequestID: requestId,
		Answers:           answers,
	})
}

// sendInput sends an input message to the agent process
func (p *Process) sendInput(msg InputMessage) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.running {
		return fmt.Errorf("process not running")
	}

	if p.stdin == nil {
		return fmt.Errorf("stdin not available")
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal message: %w", err)
	}

	// Write JSON line to stdin
	_, err = p.stdin.Write(append(data, '\n'))
	if err != nil {
		return fmt.Errorf("write to stdin: %w", err)
	}

	return nil
}

// doStopLocked performs the actual stop cleanup. Must be called with p.mu held.
// Sends SIGTERM first for graceful shutdown, then escalates to SIGKILL after 5s.
func (p *Process) doStopLocked() {
	if p.stdin != nil {
		p.stdin.Close()
		p.stdin = nil
	}

	// Clean up instructions temp file
	if p.instructionsFile != "" {
		_ = os.Remove(p.instructionsFile)
		p.instructionsFile = ""
	}

	// Try graceful shutdown with SIGTERM first
	if p.cmd != nil && p.cmd.Process != nil && p.running {
		_ = p.cmd.Process.Signal(syscall.SIGTERM)
		// Fire-and-forget goroutine: escalate to SIGKILL after timeout.
		// This intentionally outlives the caller's lock; p.cancel() is goroutine-safe.
		go func() {
			select {
			case <-p.done:
				// Process exited gracefully
			case <-time.After(5 * time.Second):
				// Force kill via context cancellation (sends SIGKILL)
				logger.Process.Warnf("[%s] Process did not exit after SIGTERM, sending SIGKILL", p.ID)
				p.cancel()
			}
		}()
	} else {
		p.cancel()
	}
}

// Stop stops the process. Safe to call multiple times (idempotent).
func (p *Process) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.stopped {
		return // Already stopped, no-op
	}
	p.stopped = true
	p.doStopLocked()
}

// TryStop attempts to stop the process and returns true if this call performed
// the stop, false if the process was already stopped by another goroutine.
// Use this when you need to know if you "own" the stop operation.
func (p *Process) TryStop() bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.stopped {
		return false // Someone else stopped it
	}
	p.stopped = true
	p.doStopLocked()
	return true
}

func (p *Process) Output() <-chan string {
	return p.output
}

// DroppedMessages returns the total number of messages dropped due to a full output buffer.
func (p *Process) DroppedMessages() uint64 {
	return p.droppedMessages.Load()
}

// SimulateDrops adds n to the drop counter. Intended for testing only.
func (p *Process) SimulateDrops(n uint64) {
	p.droppedMessages.Add(n)
}

func (p *Process) Done() <-chan struct{} {
	return p.done
}

func (p *Process) IsRunning() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.running
}

// IsStopped returns true if the process has been stopped.
func (p *Process) IsStopped() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.stopped
}

func (p *Process) ExitError() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.exitErr
}

// SetSessionID updates the current session ID
func (p *Process) SetSessionID(sessionID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.SessionID = sessionID
}

// GetSessionID returns the current session ID
func (p *Process) GetSessionID() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.SessionID
}
