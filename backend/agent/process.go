package agent

import (
	"bufio"
	"context"
	"encoding/base64"
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
	SdkSessionID        string // Full UUID for SDK session tracking (must be valid UUID)
	WorkspaceID         string // Backend workspace/repo ID for MCP tools
	BackendSessionID    string // Backend session ID for MCP tools (distinct from SDK session ID)
	ResumeSession       string // Session ID to resume
	ForkSession         bool   // Whether to fork the session
	LinearIssue         string // Linear issue identifier (e.g., "LIN-123")
	ToolPreset          string // Tool preset: full, read-only, no-bash, safe-edit
	EnableCheckpointing bool   // Enable file checkpointing for rewind
	MaxBudgetUsd        float64
	MaxTurns            int
	MaxThinkingTokens   int
	Effort              string // Reasoning effort: low, medium, high, max
	PlanMode            bool   // Start agent in plan mode
	Instructions        string // Additional instructions for the agent (e.g., conversation summaries)
	StructuredOutput    string
	SettingSources      string // Comma-separated: project,user,local
	Betas               string // Comma-separated beta features
	Model               string // Model name override
	FallbackModel       string // Fallback model name
	TargetBranch        string // Target branch for PR base and sync (e.g. "origin/develop")
	EnvVars             map[string]string // Custom environment variables to inject
	McpServersJSON      string            // JSON array of MCP server configs
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
	mcpServersFile     string        // Temp file for MCP server configs, cleaned up on stop
	opts               ProcessOptions // Original options for restart
	lastStderrLines    []string      // Ring buffer of last N stderr lines for crash diagnostics
	sawErrorEvent      bool          // Whether the agent emitted an error/auth_error event
	producedOutput     bool            // Whether any assistant text was emitted during this process lifetime
	inActiveTurn       bool            // Whether the agent is currently processing a turn (producing output)
	pendingUserMessage *models.Message // User message deferred until turn completes (correct DB position ordering)
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
	// Plan approval response fields (for ExitPlanMode tool)
	PlanApprovalRequestID string `json:"planApprovalRequestId,omitempty"`
	PlanApproved          *bool  `json:"planApproved,omitempty"`
	PlanApprovalReason    string `json:"planApprovalReason,omitempty"`
	// Max thinking tokens override (for runtime adjustment)
	MaxThinkingTokens int `json:"maxThinkingTokens,omitempty"`
	// MCP server management fields (SDK v0.2.21+)
	ServerName    string `json:"serverName,omitempty"`
	ServerEnabled *bool  `json:"serverEnabled,omitempty"`
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

	// Pass workspace and session IDs so MCP tools can reach the correct backend endpoints
	if opts.WorkspaceID != "" {
		args = append(args, "--workspace-id", opts.WorkspaceID)
	}
	if opts.BackendSessionID != "" {
		args = append(args, "--backend-session-id", opts.BackendSessionID)
	}

	// Pass a custom session ID to align SDK session tracking with our data model
	// (SDK v0.2.33+). The SDK requires a valid UUID and prohibits combining
	// --session-id with --resume unless --fork-session is also set, so only
	// pass it for new (non-resume) sessions.
	if opts.SdkSessionID != "" && opts.ResumeSession == "" {
		args = append(args, "--session-id", opts.SdkSessionID)
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
	if opts.Effort != "" {
		args = append(args, "--effort", opts.Effort)
	}
	if opts.PlanMode {
		args = append(args, "--permission-mode", "plan")
	}

	// Add instructions (e.g., from conversation summaries)
	var instructionsFile string
	if opts.Instructions != "" {
		// Write to temp file to avoid shell arg length limits
		tmpFile, err := os.CreateTemp("", "chatml-instructions-*.txt")
		if err != nil {
			logger.Process.Errorf("[%s] Failed to create instructions temp file: %v", opts.ID, err)
		} else {
			if _, writeErr := tmpFile.WriteString(opts.Instructions); writeErr != nil {
				logger.Process.Errorf("[%s] Failed to write instructions to temp file: %v", opts.ID, writeErr)
				tmpFile.Close()
				_ = os.Remove(tmpFile.Name())
			} else {
				tmpFile.Close()
				instructionsFile = tmpFile.Name()
				args = append(args, "--instructions-file", instructionsFile)
			}
		}
	}

	// Add MCP servers config (write to temp file like instructions)
	var mcpServersFile string
	if opts.McpServersJSON != "" {
		tmpFile, err := os.CreateTemp("", "chatml-mcp-servers-*.json")
		if err != nil {
			logger.Process.Errorf("[%s] Failed to create MCP servers temp file: %v", opts.ID, err)
		} else {
			if _, writeErr := tmpFile.WriteString(opts.McpServersJSON); writeErr != nil {
				logger.Process.Errorf("[%s] Failed to write MCP servers to temp file: %v", opts.ID, writeErr)
				tmpFile.Close()
				_ = os.Remove(tmpFile.Name())
			} else {
				tmpFile.Close()
				mcpServersFile = tmpFile.Name()
				args = append(args, "--mcp-servers-file", mcpServersFile)
			}
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
	if opts.TargetBranch != "" {
		args = append(args, "--target-branch", opts.TargetBranch)
	}

	// Spawn the Node agent runner
	logger.Process.Debugf("Starting agent with args: %v", args)
	cmd := exec.CommandContext(ctx, "node", args...)
	cmd.Dir = opts.Workdir

	// Inject custom environment variables if provided
	if len(opts.EnvVars) > 0 {
		cmd.Env = os.Environ()
		for k, v := range opts.EnvVars {
			cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
		}
	}

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
		mcpServersFile:   mcpServersFile,
		opts:             opts,
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
		// Timer for output backpressure: reused across iterations to detect when the
		// output channel is persistently full. On each Scan(), we Reset it. If the
		// channel send blocks until the timer fires, we drop the message. After a
		// successful send, we Stop/drain the timer to prevent a stale firing on the
		// next iteration (standard Go timer reuse pattern, see time.Timer docs).
		timer := time.NewTimer(processOutputTimeout)
		defer timer.Stop()
		for scanner.Scan() {
			timer.Reset(processOutputTimeout)
			select {
			case p.output <- scanner.Text():
				// Successfully queued — stop the timer to avoid leak
				if !timer.Stop() {
					<-timer.C
				}
			case <-timer.C:
				// Buffer full after timeout - downstream reader is persistently slow
				dropped := p.droppedMessages.Add(1)
				logger.Process.Warnf("[%s] Output buffer full after %v timeout, dropping stdout message (total dropped: %d)", p.ID, processOutputTimeout, dropped)
			}
		}
		if err := scanner.Err(); err != nil {
			logger.Process.Errorf("[%s] stdout scanner error (possible line exceeding 10MB buffer): %v", p.ID, err)
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
		timer := time.NewTimer(processOutputTimeout)
		defer timer.Stop()
		const maxStderrLines = 10
		for scanner.Scan() {
			line := scanner.Text()
			// Log to Go logger so stderr appears in sidecar logs (for debugging)
			logger.Process.Infof("[%s] %s", p.ID, line)
			// Keep last N stderr lines for crash diagnostics
			p.mu.Lock()
			if len(p.lastStderrLines) >= maxStderrLines {
				p.lastStderrLines = p.lastStderrLines[1:]
			}
			p.lastStderrLines = append(p.lastStderrLines, line)
			p.mu.Unlock()

			timer.Reset(processOutputTimeout)
			select {
			case p.output <- "[stderr] " + line:
				// Successfully queued — stop the timer to avoid leak
				if !timer.Stop() {
					<-timer.C
				}
			case <-timer.C:
				// Buffer full after timeout - downstream reader is persistently slow
				dropped := p.droppedMessages.Add(1)
				logger.Process.Warnf("[%s] Output buffer full after %v timeout, dropping stderr message (total dropped: %d)", p.ID, processOutputTimeout, dropped)
			}
		}
		if err := scanner.Err(); err != nil {
			logger.Process.Errorf("[%s] stderr scanner error: %v", p.ID, err)
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

// SendMessageWithAttachments sends a user message with file attachments to the running agent process.
// For image attachments, the base64 data is offloaded to a temp file so only the path
// travels through stdin — avoiding pipe buffer saturation in the SDK → cli.js chain.
func (p *Process) SendMessageWithAttachments(content string, attachments []models.Attachment) error {
	// Offload image base64 data to temp files to keep stdin payloads small.
	// The agent-runner reads the temp file and instructs Claude to use the Read tool.
	processed := make([]models.Attachment, len(attachments))
	copy(processed, attachments)

	for i := range processed {
		logger.Process.Debugf("[%s] Attachment[%d]: type=%q mimeType=%q name=%q base64Len=%d path=%q",
			p.ID, i, processed[i].Type, processed[i].MimeType, processed[i].Name, len(processed[i].Base64Data), processed[i].Path)
		if processed[i].Type != "image" || processed[i].Base64Data == "" {
			continue
		}

		// Decode base64 → raw bytes → temp file
		raw, err := base64.StdEncoding.DecodeString(processed[i].Base64Data)
		if err != nil {
			logger.Process.Errorf("[%s] Failed to decode base64 for image %q: %v", p.ID, processed[i].Name, err)
			continue // Fall back to inline base64
		}

		ext := ".png"
		switch processed[i].MimeType {
		case "image/jpeg":
			ext = ".jpg"
		case "image/gif":
			ext = ".gif"
		case "image/webp":
			ext = ".webp"
		}

		tmpFile, err := os.CreateTemp("", "chatml-img-*"+ext)
		if err != nil {
			logger.Process.Errorf("[%s] Failed to create temp file for image: %v", p.ID, err)
			continue // Fall back to inline base64
		}

		if _, err := tmpFile.Write(raw); err != nil {
			tmpFile.Close()
			_ = os.Remove(tmpFile.Name())
			logger.Process.Errorf("[%s] Failed to write image to temp file: %v", p.ID, err)
			continue // Fall back to inline base64
		}
		tmpFile.Close()

		logger.Process.Infof("[%s] Offloaded image %q (%d KB) to %s", p.ID, processed[i].Name, len(raw)/1024, tmpFile.Name())

		// Replace base64 with file path — agent-runner will use the Read tool approach
		processed[i].Base64Data = ""
		processed[i].Path = tmpFile.Name()
	}

	return p.sendInput(InputMessage{
		Type:        "message",
		Content:     content,
		Attachments: processed,
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

// SetMaxThinkingTokens sends a message to change the max thinking tokens at runtime
func (p *Process) SetMaxThinkingTokens(tokens int) error {
	return p.sendInput(InputMessage{
		Type:              "set_max_thinking_tokens",
		MaxThinkingTokens: tokens,
	})
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

// SendPlanApprovalResponse sends the user's approval/rejection to a pending ExitPlanMode
func (p *Process) SendPlanApprovalResponse(requestId string, approved bool, reason string) error {
	return p.sendInput(InputMessage{
		Type:                  "plan_approval_response",
		PlanApprovalRequestID: requestId,
		PlanApproved:          &approved,
		PlanApprovalReason:    reason,
	})
}

// ReconnectMcpServer requests the agent to reconnect a failed MCP server (SDK v0.2.21+)
func (p *Process) ReconnectMcpServer(serverName string) error {
	return p.sendInput(InputMessage{
		Type:       "reconnect_mcp_server",
		ServerName: serverName,
	})
}

// ToggleMcpServer enables or disables an MCP server at runtime (SDK v0.2.21+)
func (p *Process) ToggleMcpServer(serverName string, enabled bool) error {
	return p.sendInput(InputMessage{
		Type:          "toggle_mcp_server",
		ServerName:    serverName,
		ServerEnabled: &enabled,
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
	payloadKB := len(data) / 1024
	if payloadKB > 100 {
		// Log at Info level for large payloads (>100KB) — these are likely image attachments
		logger.Process.Infof("[%s] Writing %s to stdin (%d KB)", p.ID, msg.Type, payloadKB)
	} else {
		logger.Process.Debugf("Writing %s to stdin (%d bytes)", msg.Type, len(data))
	}
	_, err = p.stdin.Write(append(data, '\n'))
	if err != nil {
		logger.Process.Errorf("Failed to write %s to stdin: %v", msg.Type, err)
		return fmt.Errorf("write to stdin: %w", err)
	}
	if payloadKB > 100 {
		logger.Process.Infof("[%s] Stdin write complete for %s (%d KB)", p.ID, msg.Type, payloadKB)
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

	// Clean up MCP servers temp file
	if p.mcpServersFile != "" {
		_ = os.Remove(p.mcpServersFile)
		p.mcpServersFile = ""
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

// LastStderrLines returns the last N lines captured from stderr.
func (p *Process) LastStderrLines() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]string, len(p.lastStderrLines))
	copy(out, p.lastStderrLines)
	return out
}

// SetSawErrorEvent marks that the agent emitted an error or auth_error event.
func (p *Process) SetSawErrorEvent() {
	p.mu.Lock()
	p.sawErrorEvent = true
	p.mu.Unlock()
}

// SawErrorEvent returns whether the agent emitted an error or auth_error event.
func (p *Process) SawErrorEvent() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.sawErrorEvent
}

// SetProducedOutput marks that the agent emitted assistant text during this process lifetime.
func (p *Process) SetProducedOutput() {
	p.mu.Lock()
	p.producedOutput = true
	p.mu.Unlock()
}

// ProducedOutput returns whether any assistant text was emitted during this process lifetime.
func (p *Process) ProducedOutput() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.producedOutput
}

// SetInActiveTurn marks whether the agent is currently processing a turn.
// Set to true when the first output event of a turn arrives (assistant_text,
// tool_start, thinking_start). Set to false when a turn-ending event fires
// (turn_complete, complete, result) or when the process exits.
func (p *Process) SetInActiveTurn(active bool) {
	p.mu.Lock()
	p.inActiveTurn = active
	p.mu.Unlock()
}

// IsInActiveTurn returns whether the agent is currently processing a turn.
func (p *Process) IsInActiveTurn() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.inActiveTurn
}

// StoreOrDeferMessage atomically checks whether the process is in an active turn.
// If active, the message is deferred (stored as pending) and false is returned.
// If idle, true is returned and the caller should store the message immediately.
// This atomic check-and-set prevents a TOCTOU race between checking inActiveTurn
// and setting pendingUserMessage.
func (p *Process) StoreOrDeferMessage(msg *models.Message) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.inActiveTurn {
		if p.pendingUserMessage != nil {
			logger.Process.Warnf("Overwriting pending user message %s with %s — previous message will be lost",
				p.pendingUserMessage.ID, msg.ID)
		}
		p.pendingUserMessage = msg
		return false
	}
	return true
}

// EndTurnAndTakePending atomically clears the active turn flag and returns
// the pending user message (if any). This prevents a race where a concurrent
// SendConversationMessage sees inActiveTurn=false and stores a new message
// before the old deferred message is flushed.
func (p *Process) EndTurnAndTakePending() *models.Message {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.inActiveTurn = false
	msg := p.pendingUserMessage
	p.pendingUserMessage = nil
	return msg
}

// SetRunningForTest sets the running flag. Intended for testing only.
func (p *Process) SetRunningForTest(running bool) {
	p.mu.Lock()
	p.running = running
	p.mu.Unlock()
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

// Options returns the ProcessOptions used to create this process.
// Useful for re-creating a process with the same configuration on restart.
func (p *Process) Options() ProcessOptions {
	return p.opts
}

// SetPlanModeFromEvent updates the planModeActive state from an output event.
func (p *Process) SetPlanModeFromEvent(active bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.planModeActive = active
	p.opts.PlanMode = active
}

// SetOptionsPlanMode updates the plan mode in process options so it survives restart.
func (p *Process) SetOptionsPlanMode(enabled bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.opts.PlanMode = enabled
	p.planModeActive = enabled
}

// TakePendingUserMessage returns and clears the pending user message.
// Returns nil if no message is pending.
func (p *Process) TakePendingUserMessage() *models.Message {
	p.mu.Lock()
	defer p.mu.Unlock()
	msg := p.pendingUserMessage
	p.pendingUserMessage = nil
	return msg
}
