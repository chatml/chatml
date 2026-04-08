package loop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/chatml/chatml-core/agent"
	ctxpkg "github.com/chatml/chatml-core/context"
	core "github.com/chatml/chatml-core"
	"github.com/chatml/chatml-core/hook"
	"github.com/chatml/chatml-core/permission"
	"github.com/chatml/chatml-core/prompt"
	"github.com/chatml/chatml-core/provider"
	"github.com/chatml/chatml-core/tool"
	"github.com/chatml/chatml-core/tool/builtin"
)

// Runner implements agent.ConversationBackend using the native Go agentic loop.
// It replaces the agent-runner child process for conversations that opt into the
// "native" backend, while emitting the exact same AgentEvent types so the rest
// of the system (Manager, WebSocket hub, frontend) requires zero changes.
type Runner struct {
	// Immutable configuration
	opts         agent.ProcessOptions
	provider     provider.Provider
	toolRegistry *tool.Registry
	toolExecutor *tool.Executor

	// Output channel — read by Manager's handleConversationOutput goroutine.
	// Emits JSON-serialized AgentEvent strings, same as Process.Output().
	output     chan string
	closeOnce  sync.Once // Guards output channel close to prevent double-close panics

	// Done channel — closed when the runner has fully exited.
	done chan struct{}

	// Message input — user messages are queued here and consumed by the loop.
	messageQueue chan inputMsg

	// Cancel function for the loop's context (only called by Stop)
	cancel context.CancelFunc

	// Per-turn interrupt: cancels the current executeTurn without killing the loop
	turnCancel context.CancelFunc

	// Conversation state
	messages                 []provider.Message // Full conversation history
	streamingToolExecEnabled bool              // Enable streaming tool execution

	// Mutable state protected by mu
	mu                 sync.Mutex
	running            bool
	stopped            bool
	sessionID          string
	planModeActive     bool
	permissionMode     string
	fastMode           bool
	sawErrorEvent      bool
	producedOutput     bool
	inActiveTurn       bool
	pendingUserMessage *core.Message

	// Emitter for producing AgentEvent JSON
	emitter *emitter

	// System prompt builder
	promptBuilder *prompt.Builder

	// Context manager
	ctxManager *ctxpkg.Manager

	// Fallback model (used when primary model hits capacity/unsupported errors)
	fallbackModel       string
	consecutive529Count int // Track consecutive 529s for fallback trigger

	// Fast mode cooldown: when 429/529 received during fast mode, temporarily disable
	fastModeCooldownUntil time.Time

	// Memory extraction (background, after N turns)
	memoryExtractor   *MemoryExtractor
	sessionNotes      *SessionNotes
	bgWg              sync.WaitGroup    // Tracks background goroutines (memory extraction, etc.)
	bgExtractCancel   context.CancelFunc // Cancel function for the latest background extraction
	bgExtractCancelMu sync.Mutex        // Protects bgExtractCancel

	// Permission engine
	permEngine            *permission.Engine
	pendingApprovals      sync.Map // requestID -> chan permission.ApprovalResponse
	pendingBatchApprovals sync.Map // requestID -> chan permission.BatchApprovalResponse
	approvalCounter       int64

	// Tool result persistence for large outputs
	resultPersister *tool.ResultPersister

	// Session-level cost tracking (cumulative across all turns)
	sessionCost float64

	// Sub-agent tracking
	subAgents  map[string]*Runner
	subAgentMu sync.Mutex

	// Pending user question and plan approval channels
	pendingQuestions     sync.Map // requestID -> chan map[string]string
	pendingPlanApprovals sync.Map // requestID -> chan builtin.PlanApprovalResult

	// Hook engine for PreToolUse/PostToolUse/Session hooks
	hookEngine *hook.Engine

	// Read tracker for post-compact context restoration
	readTracker *tool.ReadTracker

	// Transcript writer for session persistence (enables resume)
	transcript *TranscriptWriter

	// MCP manager for cleanup
	mcpManager interface{ Close() }
}

// inputMsg represents a message sent to the runner by the Manager.
type inputMsg struct {
	Type    string
	Content string

	// Attachments for user messages
	Attachments []core.Attachment

	// Tool approval fields
	ToolApprovalRequestID    string
	ToolApprovalAction       string
	ToolApprovalSpecifier    string
	ToolApprovalUpdatedInput json.RawMessage

	// User question fields
	QuestionRequestID string
	Answers           map[string]string

	// Plan approval fields
	PlanApprovalRequestID string
	PlanApproved          *bool
	PlanApprovalReason    string

	// Model override
	Model string

	// Permission mode
	PermissionMode string

	// Fast mode
	FastMode *bool

	// Max thinking tokens
	MaxThinkingTokens int

	// Task management
	TaskId string
}

// NewRunner creates a new native Go loop runner.
func NewRunner(opts agent.ProcessOptions, prov provider.Provider) *Runner {
	return NewRunnerWithTools(opts, prov, nil)
}

// NewRunnerWithTools creates a runner with a pre-configured tool registry.
func NewRunnerWithTools(opts agent.ProcessOptions, prov provider.Provider, registry *tool.Registry) *Runner {
	return NewRunnerFull(opts, prov, registry, nil)
}

// NewRunnerFull creates a runner with tools and a permission engine.
func NewRunnerFull(opts agent.ProcessOptions, prov provider.Provider, registry *tool.Registry, permEngine *permission.Engine) *Runner {
	output := make(chan string, 1024)
	var executor *tool.Executor
	if registry != nil {
		executor = tool.NewExecutor(registry, 8)
	}
	r := &Runner{
		opts:           opts,
		provider:       prov,
		toolRegistry:   registry,
		toolExecutor:   executor,
		output:         output,
		done:           make(chan struct{}),
		messageQueue:   make(chan inputMsg, 32),
		permissionMode: opts.PermissionMode,
		planModeActive: opts.PlanMode,
		fastMode:       opts.FastMode,
		emitter:        &emitter{ch: output},
		permEngine:     permEngine,
	}

	// Initialize context manager (requires provider for context window size)
	if prov != nil {
		r.ctxManager = ctxpkg.NewManager(prov.MaxContextWindow())
		r.memoryExtractor = NewMemoryExtractor(prov, opts.Workdir, 10*time.Minute)
		r.sessionNotes = NewSessionNotes(prov)
	}

	return r
}

// Start launches the agentic loop goroutine. Implements agent.ConversationBackend.
func (r *Runner) Start() error {
	r.mu.Lock()
	if r.running {
		r.mu.Unlock()
		return fmt.Errorf("runner already started")
	}
	r.running = true
	r.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	r.mu.Lock()
	r.cancel = cancel
	r.mu.Unlock()

	go r.runLoop(ctx)
	return nil
}

// runLoop is the main agentic loop goroutine.
//
// Shutdown order: cleanup() runs first (session notes, tool cleanup), then
// emitComplete is sent, then the output channel is closed, then Done() fires.
// Callers watching Output() receive "complete" as the last event; callers
// waiting on Done() know cleanup has fully finished.
func (r *Runner) runLoop(ctx context.Context) {
	defer func() {
		// Run SessionEnd hooks before cleanup
		if r.hookEngine != nil {
			hookCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			r.hookEngine.RunSessionEnd(hookCtx, r.GetSessionID()) //nolint:errcheck
			cancel()
		}

		r.cleanup()
		r.emitter.emitComplete()
		r.mu.Lock()
		r.running = false
		r.mu.Unlock()
		r.closeOnce.Do(func() { close(r.output) })
		close(r.done)
	}()

	// Emit ready event
	r.emitter.emitReady(r.opts.Model, r.opts.Workdir)

	// Emit session started
	sessionID := r.opts.SdkSessionID
	if sessionID == "" {
		sessionID = r.opts.ConversationID
	}
	r.SetSessionID(sessionID)

	// Initialize transcript writer for session persistence
	if r.opts.Workdir != "" {
		tw, err := NewTranscriptWriter(TranscriptDir(r.opts.Workdir), sessionID, "")
		if err != nil {
			log.Printf("warning: failed to create transcript writer: %v (session resume will not be available)", err)
		} else {
			r.transcript = tw
			// Write session metadata
			tw.WriteMetadata(TranscriptMeta{ //nolint:errcheck
				Model:     r.opts.Model,
				CreatedAt: time.Now(),
			})
		}
	}

	// Resume: if ResumeSession is set, load prior messages
	if r.opts.ResumeSession != "" && r.opts.Workdir != "" {
		transcriptPath := FindTranscript(TranscriptDir(r.opts.Workdir), r.opts.ResumeSession)
		if transcriptPath != "" {
			msgs, _, err := ReadTranscript(transcriptPath)
			if err != nil {
				log.Printf("warning: failed to load transcript for resume: %v", err)
			} else if len(msgs) > 0 {
				r.messages = msgs
				log.Printf("Resumed session %s with %d messages", r.opts.ResumeSession, len(msgs))
			}
		}
	}

	r.emitter.emitSessionStarted(sessionID, "startup")

	// Run SessionStart hooks
	if r.hookEngine != nil {
		if result, err := r.hookEngine.RunSessionStart(ctx, sessionID); err != nil {
			log.Printf("SessionStart hook error: %v", err)
		} else if result != nil && result.PreventContinue {
			log.Printf("SessionStart hook prevented continuation: %s", result.StopReason)
			return
		}
	}

	// Main message loop — wait for user messages and execute turns
	for {
		select {
		case <-ctx.Done():
			return

		case msg, ok := <-r.messageQueue:
			if !ok {
				return
			}

			switch msg.Type {
			case "message":
				r.executeTurn(ctx, msg.Content, msg.Attachments)
			case "stop":
				return
			case "interrupt":
				// Dead code: SendInterrupt() calls turnCancel() directly, not via queue.
				// Kept for defensive compatibility in case queue-based interrupt is added later.
				continue
			case "set_fast_mode":
				if msg.FastMode != nil {
					r.mu.Lock()
					r.fastMode = *msg.FastMode
					r.mu.Unlock()
				}
			case "set_model":
				r.mu.Lock()
				r.opts.Model = msg.Model
				r.mu.Unlock()
			case "set_max_thinking_tokens":
				r.mu.Lock()
				r.opts.MaxThinkingTokens = msg.MaxThinkingTokens
				r.mu.Unlock()
			}
		}
	}
}

// executeTurn runs one complete agentic turn: sends messages to the LLM,
// processes tool calls, and loops until the LLM responds with no tool calls.
//
// A per-turn child context is created so that SendInterrupt can cancel the
// current turn without killing the outer message loop. The outer ctx (from
// runLoop) is used as parent, so Stop() still propagates.
//
// emitTurnComplete is always called on exit (including errors) to re-enable
// the input field on the frontend — this is intentional.
func (r *Runner) executeTurn(ctx context.Context, userContent string, attachments []core.Attachment) {
	// Create a per-turn context that can be cancelled by SendInterrupt
	turnCtx, turnCancel := context.WithCancel(ctx)
	defer turnCancel()

	r.mu.Lock()
	r.inActiveTurn = true
	r.turnCancel = turnCancel
	r.sawErrorEvent = false // Reset for new turn
	r.mu.Unlock()

	defer func() {
		r.mu.Lock()
		r.inActiveTurn = false
		r.turnCancel = nil
		r.mu.Unlock()
		r.emitter.emitTurnComplete()
	}()

	// Build user message content blocks
	var contentBlocks []provider.ContentBlock
	contentBlocks = append(contentBlocks, provider.NewTextBlock(userContent))

	// Convert attachments to content blocks
	for _, att := range attachments {
		switch {
		case strings.HasPrefix(att.MimeType, "image/"):
			if att.Base64Data != "" {
				contentBlocks = append(contentBlocks, provider.ContentBlock{
					Type:       provider.BlockImage,
					MediaType:  att.MimeType,
					Base64Data: att.Base64Data,
				})
			}
		default:
			// Text/file attachments — read from path or use preview
			label := att.Name
			if label == "" {
				label = "attachment"
			}
			content := att.Preview
			if content == "" && att.Path != "" {
				if data, err := os.ReadFile(att.Path); err == nil {
					content = string(data)
					// Limit to 100KB for text attachments
					if len(content) > 100*1024 {
						content = content[:100*1024] + "\n... (attachment truncated)"
					}
				}
			}
			if content != "" {
				contentBlocks = append(contentBlocks, provider.NewTextBlock(
					fmt.Sprintf("[%s]\n%s", label, content),
				))
			}
		}
	}

	// Inject plan mode system-reminder so the agent knows it's in plan mode
	// and should call ExitPlanMode when ready (mirrors Claude Code frontend behavior).
	r.mu.Lock()
	isPlanMode := r.planModeActive
	r.mu.Unlock()
	if isPlanMode {
		contentBlocks = append(contentBlocks, provider.NewTextBlock(`<system-reminder>
Plan mode is active. You MUST NOT make any edits, run non-readonly tools, or make changes to the system.
Use read-only tools (Read, Glob, Grep) to explore the codebase. Design your implementation plan, then call ExitPlanMode when your plan is ready for user review and approval.
Write/Edit/Bash tools are blocked in plan mode.
</system-reminder>`))
	}

	userMsg := provider.Message{
		Role:    provider.RoleUser,
		Content: contentBlocks,
	}
	r.messages = append(r.messages, userMsg)
	r.persistMessage(userMsg)

	turnCount := 0
	maxOutputRecoveryCount := 0
	const maxOutputRecoveryLimit = 3
	promptTooLongRetried := false
	var escalatedMaxTokens int     // Non-zero when we've escalated max output tokens
	var escalatedThinkingBudget int // Non-zero when adaptive thinking has escalated
	var activeModel string         // Tracks which model actually served each turn (for cost)
	thinkingBudgetAttempts := 0    // Adaptive thinking: tracks retry attempts
	const maxThinkingAttempts = 2

	// Track cumulative cost across the turn
	var cumulativeCost float64

	// Inner agentic loop — continues as long as the LLM returns tool calls
	for {
		turnCount++

		// Check max turns limit. Note: turnCount increments per inner loop
		// iteration (each LLM API call), not per user message. A user turn
		// that triggers 5 tool calls consumes 6 turnCount units.
		// SAFETY: MaxTurns and MaxBudgetUsd are immutable after construction,
		// so reading them without the lock is safe. Mutable fields (Model,
		// Workdir, etc.) are read under r.mu in buildChatRequest.
		if r.opts.MaxTurns > 0 && turnCount > r.opts.MaxTurns {
			r.emitter.emitAssistantText("\n\n[Max turns reached]")
			break
		}

		// Check cost budget limit (session-wide, not per-turn)
		if r.opts.MaxBudgetUsd > 0 {
			r.mu.Lock()
			over := r.sessionCost >= r.opts.MaxBudgetUsd
			cost := r.sessionCost
			r.mu.Unlock()
			if over {
				r.emitter.emitAssistantText(fmt.Sprintf("\n\n[Session budget limit: $%.4f / $%.4f]", cost, r.opts.MaxBudgetUsd))
				break
			}
		}

		// Proactive compaction BEFORE the API call (matches Claude Code's behavior).
		// This prevents prompt-too-long errors by trimming context proactively.
		if r.ctxManager != nil {
			lastTokens := r.ctxManager.LastTokenCount()

			// Microcompact FIRST (cheap). May free enough to skip auto-compact.
			if r.ctxManager.ShouldMicrocompact(2 * time.Minute) {
				r.messages = ctxpkg.Microcompact(r.messages, 10)
				r.ctxManager.RecordCompaction()
				lastTokens = ctxpkg.EstimateTokens(r.messages)
				r.ctxManager.UpdateTokenCount(lastTokens)
			}

			// Auto-compact: full LLM-based summarization when approaching limit
			if r.ctxManager.ShouldAutoCompact(lastTokens) {
				// Run PreCompact hooks
				if r.hookEngine != nil {
					r.hookEngine.RunPreCompact(turnCtx, r.GetSessionID()) //nolint:errcheck
				}

				compResult, compErr := ctxpkg.Compact(turnCtx, r.provider, r.messages, 4)
				if compErr != nil {
					r.ctxManager.RecordCompactFailure()
					r.emitter.emitError(fmt.Sprintf("Auto-compact failed: %v", compErr))
				} else {
					r.messages = compResult.Messages

					// Post-compact context restoration: re-inject recent files, tools, MCP info
					var toolNames []string
					if r.toolRegistry != nil {
						toolNames = r.toolRegistry.ToolNames()
					}
					restoreMsgs := ctxpkg.RestorePostCompact(ctxpkg.PostCompactRestorationConfig{
						MaxRecentFiles: 5,
						MaxFileTokens:  5000,
						ReadTracker:    r.readTracker,
						ToolNames:      toolNames,
					})
					if len(restoreMsgs) > 0 {
						r.messages = append(r.messages, restoreMsgs...)
					}

					r.ctxManager.RecordCompaction()
					r.ctxManager.ResetCompactFailures()

					// Run PostCompact hooks
					if r.hookEngine != nil {
						r.hookEngine.RunPostCompact(turnCtx, r.GetSessionID()) //nolint:errcheck
					}
				}
			}
		}

		// Build the chat request
		req := r.buildChatRequest()
		activeModel = req.Model // Track which model serves this turn (may change on fallback)

		// Apply escalated thinking budget if adaptive thinking has increased it
		if escalatedThinkingBudget > 0 {
			req.ThinkingBudget = escalatedThinkingBudget
		}

		// Apply escalated max tokens if we're in recovery mode
		if escalatedMaxTokens > 0 {
			req.MaxTokens = escalatedMaxTokens
		}

		// Stream the LLM response
		stream, err := r.provider.StreamChat(turnCtx, req)
		if err != nil {
			// Track consecutive 529s for fallback decision
			if is529Error(err) {
				r.consecutive529Count++
			} else {
				r.consecutive529Count = 0
			}

			// Fast mode cooldown: on 429/529 during fast mode, enter 30s cooldown
			// and retry immediately at standard speed (next buildChatRequest will
			// see the cooldown and disable fast mode).
			if req.FastMode && (is529Error(err) || is429Error(err)) {
				r.mu.Lock()
				model := r.opts.Model
				r.fastModeCooldownUntil = time.Now().Add(30 * time.Second)
				r.mu.Unlock()
				statusCode := 429
				if is529Error(err) {
					statusCode = 529
				}
				r.emitter.emitRateLimitReceived(statusCode, model, "Fast mode rate limited — retrying at standard speed")
				r.emitter.emitFastModeChanged(false, "Fast mode cooldown triggered (30s)")
				continue // Retry the turn at standard speed
			}

			// Try fallback model after 3+ consecutive 529s (matches Claude Code).
			// Build a new request with the fallback model directly rather than
			// mutating r.opts.Model to avoid TOCTOU races with concurrent readers.
			if r.fallbackModel != "" && r.consecutive529Count >= 3 && isFallbackEligible(err) {
				r.mu.Lock()
				currentModel := r.opts.Model
				r.mu.Unlock()
				r.emitter.emitModelFallback(currentModel, r.fallbackModel, fmt.Sprintf("%d consecutive 529 errors", r.consecutive529Count))

				req = r.buildChatRequest()
				req.Model = r.fallbackModel
				req.ThinkingBudget = 0
				stream, err = r.provider.StreamChat(turnCtx, req)

				if err == nil {
					r.consecutive529Count = 0 // Reset after successful fallback
					activeModel = r.fallbackModel // Cost uses fallback pricing
				} else {
					// Fallback also failed — break rather than falling through
					// to unrelated recovery paths (prompt-too-long, context-overflow)
					r.emitter.emitError(fmt.Sprintf("Fallback model %s also failed: %v", r.fallbackModel, err))
					break
				}
			}

			// 413 Prompt-too-long: emergency compact + retry (single-shot)
			if err != nil && isPromptTooLong(err) && !promptTooLongRetried {
				promptTooLongRetried = true
				r.emitter.emitError("Prompt too long — compacting and retrying")
				compResult, compErr := ctxpkg.Compact(turnCtx, r.provider, r.messages, 4)
				if compErr == nil {
					r.messages = compResult.Messages
					if r.ctxManager != nil {
						r.ctxManager.RecordCompaction()
						r.ctxManager.ResetCompactFailures()
					}
					req = r.buildChatRequest()
					stream, err = r.provider.StreamChat(turnCtx, req)
				}
			}

			// Token budget adjustment: on context overflow, parse the error to compute
			// the correct max_tokens rather than blindly halving.
			if err != nil && isContextOverflow(err) {
				r.emitter.emitError("Context overflow — retrying with reduced token budget")
				req = r.buildChatRequest()

				if inputTokens, contextLimit, ok := parseContextOverflow(err.Error()); ok && contextLimit > inputTokens {
					// Calculate exact budget: context limit - input tokens - thinking budget
					newMax := contextLimit - inputTokens
					if req.ThinkingBudget > 0 {
						newMax -= req.ThinkingBudget
					}
					if newMax < 1024 {
						newMax = 1024
					}
					req.MaxTokens = newMax
				} else {
					// Fallback: halve max_tokens
					req.MaxTokens = req.MaxTokens / 2
					if req.MaxTokens < 1024 {
						req.MaxTokens = 1024
					}
				}
				stream, err = r.provider.StreamChat(turnCtx, req)
			}

			if err != nil {
				r.emitter.emitError(fmt.Sprintf("LLM API error: %v", err))
				r.mu.Lock()
				r.sawErrorEvent = true
				r.mu.Unlock()
				break
			}
		} else {
			r.consecutive529Count = 0 // Reset on success
		}

		// Process the stream and collect the assistant response
		assistantMsg, toolCalls, usage, stopReason, streamExec := r.processStream(turnCtx, stream)

		// Only append assistant message if it has content (avoid corrupt history
		// from partial/empty messages when stream errors occur mid-response).
		hasContent := false
		for _, b := range assistantMsg.Content {
			if b.Type == provider.BlockText && strings.TrimSpace(b.Text) != "" {
				hasContent = true
				break
			}
			if b.Type == provider.BlockToolUse || b.Type == provider.BlockThinking {
				hasContent = true
				break
			}
		}
		r.mu.Lock()
		sawError := r.sawErrorEvent
		r.mu.Unlock()
		if !hasContent && sawError {
			// Skip appending empty/partial message from a failed stream
			break
		}
		r.messages = append(r.messages, assistantMsg)
		r.persistMessage(assistantMsg)

		// Track cost and context usage (update token count for next iteration's proactive check)
		if usage != nil {
			// Use activeModel (which reflects fallback) instead of r.opts.Model
			turnCost := provider.CalculateCost(activeModel, *usage)
			cumulativeCost += turnCost
			r.mu.Lock()
			r.sessionCost += turnCost
			r.mu.Unlock()

			// Update context manager BEFORE emitting so cumulative count is current
			if r.ctxManager != nil {
				r.ctxManager.UpdateFromUsage(usage)
			}
			cumulativeTokens := 0
			if r.ctxManager != nil {
				cumulativeTokens = r.ctxManager.LastTokenCount()
			}
			r.emitter.emitContextUsage(usage.InputTokens, usage.OutputTokens,
				r.provider.MaxContextWindow(), cumulativeTokens)

			if r.ctxManager != nil {
				// Emit context warning when approaching limit
				tokens := r.ctxManager.LastTokenCount()
				if r.ctxManager.ShouldWarn(tokens) {
					pct := tokens * 100 / r.ctxManager.ContextWindow()
					r.emitter.emitContextWarning(
						fmt.Sprintf("Context window %d%% full (%d/%d tokens). Consider compacting or starting a new conversation.",
							pct, tokens, r.ctxManager.ContextWindow()),
					)
				}
			}
		}

		// Adaptive thinking: if thinking was enabled and the model hit max_tokens
		// with thinking content but no text/tool output, the thinking budget was
		// likely too small. Increase it and retry (up to maxThinkingAttempts).
		if stopReason == "max_tokens" && len(toolCalls) == 0 && thinkingBudgetAttempts < maxThinkingAttempts {
			r.mu.Lock()
			currentBudget := r.opts.MaxThinkingTokens
			r.mu.Unlock()

			if currentBudget > 0 {
				// Check if the response was thinking-only (no text output produced)
				hasTextOutput := false
				for _, b := range assistantMsg.Content {
					if b.Type == provider.BlockText && strings.TrimSpace(b.Text) != "" {
						hasTextOutput = true
						break
					}
				}

				if !hasTextOutput {
					// Thinking was truncated — increase budget by 2x and retry.
					// Use a local variable to avoid permanently mutating opts.MaxThinkingTokens
					// (which would ratchet up across turns and overwrite user preferences).
					thinkingBudgetAttempts++
					escalatedThinkingBudget = currentBudget * 2

					log.Printf("adaptive thinking: increasing budget %d → %d (attempt %d/%d)",
						currentBudget, escalatedThinkingBudget, thinkingBudgetAttempts, maxThinkingAttempts)

					// Remove the truncated assistant message and retry.
					// Reset maxOutputRecoveryCount so the continuation prompt path
					// doesn't fire incorrectly when the retry produces actual output.
					r.messages = r.messages[:len(r.messages)-1]
					maxOutputRecoveryCount = 0
					continue
				}
			}
		}

		// Max output tokens recovery: if the model hit the output limit,
		// escalate max_tokens and inject a continuation prompt (up to 3 retries).
		if stopReason == "max_tokens" && len(toolCalls) == 0 {
			maxOutputRecoveryCount++
			if maxOutputRecoveryCount == 1 {
				// First hit: escalate max output tokens (8k → 64k)
				escalatedMaxTokens = 64000
			}
			if maxOutputRecoveryCount <= maxOutputRecoveryLimit {
				recoveryMsg := provider.Message{
					Role:    provider.RoleUser,
					Content: []provider.ContentBlock{provider.NewTextBlock("Your response was cut off. Please continue from where you stopped.")},
				}
				r.messages = append(r.messages, recoveryMsg)
				continue // Retry the turn
			}
			// Exhausted recovery attempts — fall through to end turn
			escalatedMaxTokens = 0 // Reset escalation
		} else if len(toolCalls) > 0 {
			// Successful tool call turn — reset recovery state
			maxOutputRecoveryCount = 0
			escalatedMaxTokens = 0
		}

		// If no tool calls, the turn is complete
		if len(toolCalls) == 0 {
			r.emitter.emitResult(usage, cumulativeCost, turnCount)
			break
		}

		// Pre-warm the API connection while tools execute. The next StreamChat
		// call will reuse the pooled connection, saving ~50-150ms of TCP+TLS handshake.
		r.provider.PrewarmConnection()

		// Execute tool calls and collect results
		toolResultMsg := r.executeTools(turnCtx, toolCalls, streamExec)
		r.messages = append(r.messages, toolResultMsg)
		r.persistMessage(toolResultMsg)

		// Track tool results for microcompact triggering
		if r.ctxManager != nil {
			r.ctxManager.IncrementToolResults(len(toolCalls))
		}

		// Loop back to send tool results to the LLM
	}

	// Background memory extraction (non-blocking)
	if r.memoryExtractor != nil {
		r.memoryExtractor.IncrementTurn()
		if r.memoryExtractor.ShouldExtract() {
			// Deep-copy messages to avoid data races: the outer slice AND the
			// Content backing arrays must be independent from the live history.
			msgSnapshot := cloneMessages(r.messages)

			// Use a bounded context so extraction doesn't run forever
			// after the runner is stopped (30s should be enough for an LLM call).
			// Tracked by bgWg so cleanup() can wait for completion.
			// The cancel func is stored so cleanup() can cancel promptly.
			extractCtx, extractCancel := context.WithTimeout(context.Background(), 30*time.Second)
			r.bgExtractCancelMu.Lock()
			r.bgExtractCancel = extractCancel
			r.bgExtractCancelMu.Unlock()
			r.bgWg.Add(1)
			go func() {
				defer r.bgWg.Done()
				defer extractCancel()
				r.memoryExtractor.Extract(extractCtx, msgSnapshot)
			}()
		}
	}
}

// buildChatRequest constructs a provider.ChatRequest from the current conversation state.
func (r *Runner) buildChatRequest() provider.ChatRequest {
	// Read all mutable opts under a single lock to avoid data races
	r.mu.Lock()
	model := r.opts.Model
	thinkingBudget := r.opts.MaxThinkingTokens
	effort := r.opts.Effort
	outputFormat := r.opts.StructuredOutput
	fastModeActive := r.fastMode && time.Now().After(r.fastModeCooldownUntil)
	r.mu.Unlock()

	// Inject tool prompts into the builder before assembling system prompt
	if r.promptBuilder != nil && r.toolRegistry != nil {
		r.promptBuilder.SetToolPrompts(r.toolRegistry.ToolPrompts())
	}

	// Build system prompt from workspace context
	systemPrompt := r.opts.Instructions
	if r.promptBuilder != nil {
		systemPrompt = r.promptBuilder.Build()
	}

	// Normalize messages and apply tool result budget before sending
	normalizedMsgs := normalizeMessages(r.messages)
	normalizedMsgs = applyToolResultBudget(normalizedMsgs, 0)

	// Enable prompt caching for Anthropic provider
	enableCache := false
	if r.provider != nil && r.provider.Capabilities().SupportsCaching {
		enableCache = true
	}

	req := provider.ChatRequest{
		Model:            model,
		Messages:         normalizedMsgs,
		SystemPrompt:     systemPrompt,
		ThinkingBudget:   thinkingBudget,
		AdaptiveThinking: thinkingBudget > 0, // Enable adaptive mode when thinking is requested
		CacheControl:     enableCache,
		Effort:         effort,
		OutputFormat:    outputFormat,
		FastMode:       fastModeActive,
	}

	// Add tool definitions from the registry
	if r.toolRegistry != nil {
		req.Tools = r.toolRegistry.ToolDefs()
	}

	// Add server-managed native web search when provider supports it
	if r.provider != nil && r.provider.Capabilities().SupportsNativeSearch {
		req.ServerTools = append(req.ServerTools, provider.ServerToolDef{
			Type:    "web_search_20250305",
			Name:    "web_search",
			MaxUses: 8,
		})
	}

	return req
}

// processStream reads streaming events and builds the assistant message.
// Returns the complete assistant message, any tool calls, usage stats, stop reason,
// and the streaming executor (if streaming tool execution was active).
// When streaming tool execution is enabled, concurrent-safe tools start executing
// immediately as their blocks complete.
func (r *Runner) processStream(ctx context.Context, stream <-chan provider.StreamEvent) (provider.Message, []provider.ToolUseBlock, *provider.Usage, string, *StreamingToolExecutor) {
	var (
		textAccum          strings.Builder
		thinkingAccum      strings.Builder
		toolCalls          []provider.ToolUseBlock
		lastUsage          *provider.Usage
		stopReason         string
		serverToolBlocks   []provider.ContentBlock // Track server tool use/result blocks for history
	)

	// Create streaming executor if enabled. Concurrent-safe tools (Read, Glob, Grep)
	// are auto-approved and can start during streaming regardless of permission mode.
	// Serial tools requiring permission are queued and handled by executeTools.
	var streamExec *StreamingToolExecutor
	if r.streamingToolExecEnabled && r.toolRegistry != nil && r.toolExecutor != nil {
		streamExec = NewStreamingToolExecutor(ctx, r.toolRegistry, r.toolExecutor)
	}

	// NOTE: On cancellation, partial tool call lists may be returned. The caller handles
	// this via per-tool context checks. The stream drain at line 885 blocks until the
	// provider closes the channel.
	streamLoop:
	for event := range stream {
		select {
		case <-ctx.Done():
			// Drain remaining events
			for range stream {
			}
			break streamLoop
		default:
		}

		switch event.Type {
		case provider.EventTextDelta:
			textAccum.WriteString(event.Text)
			r.emitter.emitAssistantText(event.Text)
			r.mu.Lock()
			r.producedOutput = true
			r.mu.Unlock()

		case provider.EventThinkingDelta:
			thinkingAccum.WriteString(event.Thinking)
			r.emitter.emitThinking(event.Thinking)

		case provider.EventToolUseStart:
			if event.ToolUse != nil {
				r.emitter.emitToolStart(event.ToolUse.ID, event.ToolUse.Name, nil)
			}

		case provider.EventToolUseEnd:
			if event.ToolUse != nil {
				toolCalls = append(toolCalls, *event.ToolUse)
				// Start concurrent-safe tools immediately during streaming
				if streamExec != nil {
					streamExec.AddTool(ctx, *event.ToolUse)
				}
			}

		case provider.EventMessageStart:
			// Anthropic sends input token counts in message_start
			if event.Usage != nil {
				if lastUsage == nil {
					lastUsage = event.Usage
				} else {
					// Merge: message_start has input tokens, message_delta has output tokens
					lastUsage.InputTokens = event.Usage.InputTokens
					if event.Usage.CacheReadInputTokens > 0 {
						lastUsage.CacheReadInputTokens = event.Usage.CacheReadInputTokens
					}
					if event.Usage.CacheCreationInputTokens > 0 {
						lastUsage.CacheCreationInputTokens = event.Usage.CacheCreationInputTokens
					}
				}
			}

		case provider.EventMessageDelta:
			// Anthropic sends output token counts in message_delta
			if event.Usage != nil {
				if lastUsage == nil {
					lastUsage = event.Usage
				} else {
					lastUsage.OutputTokens = event.Usage.OutputTokens
				}
			}
			if event.StopReason != "" {
				stopReason = event.StopReason
			}

		case provider.EventServerToolUseStart:
			// Server-managed tool (web search) started
			r.emitter.emitToolStart("ws-"+event.ServerToolUseID, "WebSearch", nil)
			serverToolBlocks = append(serverToolBlocks, provider.ContentBlock{
				Type:            provider.BlockServerToolUse,
				ServerToolUseID: event.ServerToolUseID,
				ServerToolName:  event.ServerToolName,
			})

		case provider.EventWebSearchResult:
			// Server-managed web search completed
			count := len(event.WebSearchResults)
			summary := fmt.Sprintf("Found %d results", count)
			if event.WebSearchError != "" {
				summary = "Search error: " + event.WebSearchError
				r.emitter.emitToolEnd("ws-"+event.ServerToolUseID, "WebSearch", false, summary, nil)
			} else {
				r.emitter.emitToolEnd("ws-"+event.ServerToolUseID, "WebSearch", true, summary, nil)
			}
			serverToolBlocks = append(serverToolBlocks, provider.ContentBlock{
				Type:             provider.BlockWebSearchResult,
				ForToolUseID:     event.ServerToolUseID,
				WebSearchResults: event.WebSearchResults,
				WebSearchError:   event.WebSearchError,
			})

		case provider.EventError:
			if event.Error != nil {
				r.emitter.emitError(event.Error.Error())
				r.mu.Lock()
				r.sawErrorEvent = true
				r.mu.Unlock()
			}
		}
	}

	// Post-stream completeness validation: if no content was produced and no
	// error was recorded, the stream was silently truncated.
	hasContent := textAccum.Len() > 0 || thinkingAccum.Len() > 0 || len(toolCalls) > 0 || len(serverToolBlocks) > 0
	if !hasContent && stopReason == "" {
		log.Printf("warning: stream completed with no content and no stop_reason (possible silent truncation)")
	}

	// Discard incomplete tool calls (started but no complete input JSON).
	// This can happen when the stream is truncated mid-tool-call.
	var validToolCalls []provider.ToolUseBlock
	for _, tc := range toolCalls {
		if tc.ID != "" && tc.Name != "" {
			validToolCalls = append(validToolCalls, tc)
		} else {
			log.Printf("warning: discarding incomplete tool call (id=%q name=%q)", tc.ID, tc.Name)
		}
	}
	toolCalls = validToolCalls

	// Build the assistant message with all content blocks
	var content []provider.ContentBlock

	if thinkingAccum.Len() > 0 {
		content = append(content, provider.NewThinkingBlock(thinkingAccum.String()))
	}
	if textAccum.Len() > 0 {
		content = append(content, provider.NewTextBlock(textAccum.String()))
	}
	for _, tc := range toolCalls {
		content = append(content, provider.NewToolUseBlock(tc.ID, tc.Name, tc.Input))
	}
	// Include server tool blocks (web search) for conversation history continuity
	content = append(content, serverToolBlocks...)

	return provider.Message{
		Role:    provider.RoleAssistant,
		Content: content,
	}, toolCalls, lastUsage, stopReason, streamExec
}

// Note: Claude Code waits INDEFINITELY for user approval (no timeout).
// We match this behavior — approval only ends via user response or context cancellation.

// executeTools runs tool calls through permission checks and then executes approved ones.
// If a streaming executor is provided, its concurrent-safe results are collected first,
// then serial tools go through the normal permission flow.
//
// tool_start events are emitted during processStream (EventToolUseStart), so we do NOT
// re-emit them here. We only emit tool_end after execution or denial.
func (r *Runner) executeTools(ctx context.Context, toolCalls []provider.ToolUseBlock, streamExec *StreamingToolExecutor) provider.Message {
	if r.toolExecutor == nil {
		var resultBlocks []provider.ContentBlock
		for _, tc := range toolCalls {
			result := fmt.Sprintf("Tool %q is not available (no tool registry configured).", tc.Name)
			r.emitter.emitToolEnd(tc.ID, tc.Name, false, result, rawToMap(tc.Input))
			resultBlocks = append(resultBlocks, provider.NewToolResultBlock(tc.ID, result, true))
		}
		return provider.Message{Role: provider.RoleUser, Content: resultBlocks}
	}

	// Collect pre-started concurrent-safe results and pending serial tools from the
	// streaming executor (if active). Serial tools are NOT executed by the streaming
	// executor — they go through permission checks below.
	var concurrentResults map[string]tool.ToolCallResult
	if streamExec != nil {
		concurrentResults, _ = streamExec.Collect(ctx)
	}

	// Build result blocks in original tool call order. For each tool call:
	// - If it was handled by the streaming executor (concurrent-safe), emit its result
	// - Otherwise, run through permission checks then execute
	var approvedCalls []tool.ToolCall
	resultsByID := make(map[string]provider.ContentBlock) // For pre-resolved tools
	var resultBlocks []provider.ContentBlock

	// Pass 1: resolve concurrent results, check permissions, collect tools needing approval.
	var needsApproval []batchApprovalEntry // Tools that need user approval (batched)

	for _, tc := range toolCalls {
		// Check if this tool was already executed by the streaming executor
		if concurrentResults != nil {
			if tcr, ok := concurrentResults[tc.ID]; ok {
				content := ""
				isError := false
				if tcr.Result != nil {
					content = tcr.Result.Content
					isError = tcr.Result.IsError
				}
				if !isError {
					content = r.maybePersistResult(tcr.ToolCall.ID, content)
				}
				summary := content
				if len(summary) > 200 {
					summary = summary[:200] + "..."
				}
				r.emitter.emitToolEnd(tcr.ToolCall.ID, tcr.ToolCall.Name, !isError, summary, rawToMap(tc.Input))
				resultsByID[tc.ID] = toolResultBlock(tcr.ToolCall.ID, content, isError, tcr.Result)
				continue
			}
		}

		// Tool needs permission check (either no streamExec, or it's a serial tool)
		if r.permEngine == nil {
			// No permission engine — allow everything (backwards compat)
			approvedCalls = append(approvedCalls, tool.ToolCall{ID: tc.ID, Name: tc.Name, Input: tc.Input})
			continue
		}

		check := r.permEngine.Check(tc.Name, tc.Input)

		switch check.Decision {
		case permission.Allow:
			approvedCalls = append(approvedCalls, tool.ToolCall{ID: tc.ID, Name: tc.Name, Input: tc.Input})
		case permission.Deny:
			msg := fmt.Sprintf("Permission denied: %s", check.DenyMessage)
			r.emitter.emitToolEnd(tc.ID, tc.Name, false, msg, rawToMap(tc.Input))
			resultsByID[tc.ID] = provider.NewToolResultBlock(tc.ID, msg, true)
		case permission.NeedApproval:
			needsApproval = append(needsApproval, batchApprovalEntry{tc: tc, check: check})
		}
	}

	// Pass 2: batch-approve all tools that need user approval in a single request.
	if len(needsApproval) > 0 {
		batchResults := r.requestBatchApproval(ctx, needsApproval)
		for _, e := range needsApproval {
			br, ok := batchResults[e.tc.ID]
			if !ok {
				msg := "Batch approval result missing"
				r.emitter.emitToolEnd(e.tc.ID, e.tc.Name, false, msg, rawToMap(e.tc.Input))
				resultsByID[e.tc.ID] = provider.NewToolResultBlock(e.tc.ID, msg, true)
				continue
			}
			switch br.decision.Decision {
			case permission.Allow:
				input := br.input
				if input == nil {
					input = e.tc.Input
				}
				approvedCalls = append(approvedCalls, tool.ToolCall{ID: e.tc.ID, Name: e.tc.Name, Input: input})
			case permission.Deny:
				msg := fmt.Sprintf("Permission denied: %s", br.decision.DenyMessage)
				r.emitter.emitToolEnd(e.tc.ID, e.tc.Name, false, msg, rawToMap(e.tc.Input))
				resultsByID[e.tc.ID] = provider.NewToolResultBlock(e.tc.ID, msg, true)
			}
		}
	}

	// Execute approved calls (with hook integration)
	if len(approvedCalls) > 0 {
		// Run PreToolUse hooks and filter out denied calls
		var hookFilteredCalls []tool.ToolCall
		for _, tc := range approvedCalls {
			if r.hookEngine != nil {
				hookOut, hookErr := r.hookEngine.RunPreToolUse(ctx, tc.Name, tc.Input)
				if hookErr != nil {
					log.Printf("PreToolUse hook error for %s: %v", tc.Name, hookErr)
				}
				if hookOut != nil && hookOut.PermissionDecision == "deny" {
					msg := "Hook denied tool execution"
					if hookOut.DenyMessage != "" {
						msg = hookOut.DenyMessage
					}
					r.emitter.emitToolEnd(tc.ID, tc.Name, false, msg, rawToMap(tc.Input))
					resultsByID[tc.ID] = provider.NewToolResultBlock(tc.ID, msg, true)
					continue // Skip this tool
				}
				if hookOut != nil && hookOut.UpdatedInput != nil {
					tc.Input = hookOut.UpdatedInput
				}
			}
			hookFilteredCalls = append(hookFilteredCalls, tc)
		}

		results := r.toolExecutor.Execute(ctx, hookFilteredCalls)
		for _, tcr := range results {
			content := ""
			isError := false
			if tcr.Result != nil {
				content = tcr.Result.Content
				isError = tcr.Result.IsError
			}

			// Persist large results to disk with a preview
			if !isError {
				content = r.maybePersistResult(tcr.ToolCall.ID, content)
			}

			summary := content
			if len(summary) > 200 {
				summary = summary[:200] + "..."
			}
			r.emitter.emitToolEnd(tcr.ToolCall.ID, tcr.ToolCall.Name, !isError, summary, rawToMap(tcr.ToolCall.Input))
			resultsByID[tcr.ToolCall.ID] = toolResultBlock(tcr.ToolCall.ID, content, isError, tcr.Result)

			// Run PostToolUse or PostToolUseFailure hooks
			if r.hookEngine != nil {
				if isError {
					r.hookEngine.RunPostToolUseFailure(ctx, tcr.ToolCall.Name, tcr.ToolCall.Input, content) //nolint:errcheck
				} else {
					r.hookEngine.RunPostToolUse(ctx, tcr.ToolCall.Name, tcr.ToolCall.Input, content) //nolint:errcheck
				}
			}
		}
	}

	// Build result blocks in original order
	for _, tc := range toolCalls {
		if block, ok := resultsByID[tc.ID]; ok {
			resultBlocks = append(resultBlocks, block)
		} else {
			// Shouldn't happen, but provide a safe fallback
			resultBlocks = append(resultBlocks, provider.NewToolResultBlock(tc.ID, "Tool execution result not found", true))
		}
	}

	return provider.Message{Role: provider.RoleUser, Content: resultBlocks}
}

// toolResultBlock creates the appropriate tool_result content block.
// If the result contains image data, it creates an image tool result block
// so the LLM can see the image visually. Otherwise, creates a text result.
// rawToMap converts json.RawMessage to map[string]interface{} for event params.
func rawToMap(raw json.RawMessage) map[string]interface{} {
	if len(raw) == 0 {
		return nil
	}
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	return m
}

func toolResultBlock(toolUseID, content string, isError bool, result *tool.Result) provider.ContentBlock {
	if !isError && result != nil && result.ImageData != nil {
		return provider.NewImageToolResultBlock(
			toolUseID,
			content,
			result.ImageData.MediaType,
			result.ImageData.Base64,
		)
	}
	return provider.NewToolResultBlock(toolUseID, content, isError)
}

// maybePersistResult runs a tool result through the persister if configured.
// Large results get written to disk with a preview returned inline.
func (r *Runner) maybePersistResult(toolUseID, content string) string {
	if r.resultPersister == nil {
		return content
	}
	inline, _ := r.resultPersister.MaybePersist(toolUseID, content)
	return inline
}

// checkPermission evaluates whether a tool call should be allowed, denied, or needs user approval.
// If approval is needed, it blocks until the user responds or the timeout expires.
func (r *Runner) checkPermission(ctx context.Context, tc provider.ToolUseBlock) (permission.CheckResult, json.RawMessage) {
	result := r.permEngine.Check(tc.Name, tc.Input)

	switch result.Decision {
	case permission.Allow:
		return result, tc.Input
	case permission.Deny:
		return result, nil
	case permission.NeedApproval:
		return r.requestApproval(ctx, tc, result)
	default:
		return result, tc.Input
	}
}

// requestApproval emits a tool_approval_request event and blocks until the user responds.
func (r *Runner) requestApproval(ctx context.Context, tc provider.ToolUseBlock, check permission.CheckResult) (permission.CheckResult, json.RawMessage) {
	requestID := fmt.Sprintf("tar-%d-%d", atomic.AddInt64(&r.approvalCounter, 1), time.Now().UnixMilli())

	// Create response channel
	respCh := make(chan permission.ApprovalResponse, 1)
	r.pendingApprovals.Store(requestID, respCh)
	defer r.pendingApprovals.Delete(requestID)

	// Unmarshal input for the event (frontend expects an object, not raw JSON string)
	var toolInputObj interface{}
	if err := json.Unmarshal(tc.Input, &toolInputObj); err != nil {
		log.Printf("warning: failed to unmarshal tool input for approval: %v", err)
	}

	// Emit approval request to frontend
	r.emitter.emitToolApprovalRequest(requestID, tc.Name, toolInputObj, check.Specifier)

	// Block waiting for response — no timeout (matches Claude Code behavior).
	// Only cancelled by context (runner stop/interrupt).
	select {
	case resp := <-respCh:
		return r.processApprovalResponse(check, resp, tc.Input)
	case <-ctx.Done():
		check.Decision = permission.Deny
		check.DenyMessage = "Tool approval cancelled"
		return check, nil
	}
}

// processApprovalResponse converts a user's approval response into a permission decision.
func (r *Runner) processApprovalResponse(check permission.CheckResult, resp permission.ApprovalResponse, originalInput json.RawMessage) (permission.CheckResult, json.RawMessage) {
	// Record session/always decisions
	r.permEngine.RecordApproval(check.RuleKey, resp)

	switch {
	case strings.HasPrefix(resp.Action, "allow"):
		check.Decision = permission.Allow
		input := originalInput
		if len(resp.UpdatedInput) > 0 {
			input = resp.UpdatedInput
		}
		return check, input
	default: // deny_once, deny_always
		check.Decision = permission.Deny
		check.DenyMessage = "User denied tool execution"
		return check, nil
	}
}

// batchApprovalEntry holds a tool that needs user approval along with its permission check result.
type batchApprovalEntry struct {
	tc    provider.ToolUseBlock
	check permission.CheckResult
}

// requestBatchApproval emits a single batch approval request for multiple tools
// and blocks until the user responds. Returns per-tool decisions.
func (r *Runner) requestBatchApproval(ctx context.Context, entries []batchApprovalEntry) map[string]struct {
	decision permission.CheckResult
	input    json.RawMessage
} {
	results := make(map[string]struct {
		decision permission.CheckResult
		input    json.RawMessage
	}, len(entries))

	// If only one tool, fall back to the existing single-approval path
	if len(entries) == 1 {
		e := entries[0]
		check, input := r.requestApproval(ctx, e.tc, e.check)
		results[e.tc.ID] = struct {
			decision permission.CheckResult
			input    json.RawMessage
		}{check, input}
		return results
	}

	requestID := fmt.Sprintf("btar-%d-%d", atomic.AddInt64(&r.approvalCounter, 1), time.Now().UnixMilli())

	// Build batch items
	items := make([]agent.BatchApprovalItem, len(entries))
	for i, e := range entries {
		var toolInputObj interface{}
		if err := json.Unmarshal(e.tc.Input, &toolInputObj); err != nil {
			log.Printf("warning: failed to unmarshal tool input for approval: %v", err)
		}
		items[i] = agent.BatchApprovalItem{
			ToolUseID: e.tc.ID,
			ToolName:  e.tc.Name,
			ToolInput: toolInputObj,
			Specifier: e.check.Specifier,
		}
	}

	// Create response channel and register
	respCh := make(chan permission.BatchApprovalResponse, 1)
	r.pendingBatchApprovals.Store(requestID, respCh)
	defer r.pendingBatchApprovals.Delete(requestID)

	// Emit batch request
	r.emitter.emitToolBatchApprovalRequest(requestID, items)

	// Block waiting for response
	select {
	case resp := <-respCh:
		for _, e := range entries {
			// Check for per-tool override first
			if perTool, ok := resp.PerTool[e.tc.ID]; ok {
				check, input := r.processApprovalResponse(e.check, perTool, e.tc.Input)
				results[e.tc.ID] = struct {
					decision permission.CheckResult
					input    json.RawMessage
				}{check, input}
			} else {
				// Apply default action
				defaultResp := permission.ApprovalResponse{
					Action:    resp.Action,
					Specifier: e.check.Specifier,
				}
				check, input := r.processApprovalResponse(e.check, defaultResp, e.tc.Input)
				results[e.tc.ID] = struct {
					decision permission.CheckResult
					input    json.RawMessage
				}{check, input}
			}
		}
	case <-ctx.Done():
		for _, e := range entries {
			check := e.check
			check.Decision = permission.Deny
			check.DenyMessage = "Batch tool approval cancelled"
			results[e.tc.ID] = struct {
				decision permission.CheckResult
				input    json.RawMessage
			}{check, nil}
		}
	}

	return results
}

// --- ConversationBackend interface implementation ---

func (r *Runner) SendMessage(content string) error {
	select {
	case r.messageQueue <- inputMsg{Type: "message", Content: content}:
		return nil
	default:
		// Queue capacity is 32 — this should not happen in normal single-turn flow.
		// Log so dropped messages are debuggable.
		log.Printf("WARNING: runner message queue full, dropping message (len=%d chars)", len(content))
		return fmt.Errorf("runner message queue full")
	}
}

func (r *Runner) SendMessageWithAttachments(content string, attachments []core.Attachment) error {
	select {
	case r.messageQueue <- inputMsg{Type: "message", Content: content, Attachments: attachments}:
		return nil
	default:
		log.Printf("WARNING: runner message queue full, dropping message with %d attachment(s) (len=%d chars)", len(attachments), len(content))
		return fmt.Errorf("runner message queue full")
	}
}

func (r *Runner) SendStop() error {
	select {
	case r.messageQueue <- inputMsg{Type: "stop"}:
		return nil
	default:
		return nil // Already stopping
	}
}

func (r *Runner) SendInterrupt() error {
	r.mu.Lock()
	turnCancel := r.turnCancel
	r.mu.Unlock()
	// Cancel the current turn only — the outer loop stays alive for subsequent messages.
	if turnCancel != nil {
		turnCancel()
	}
	return nil
}

func (r *Runner) Stop() {
	r.mu.Lock()
	if r.stopped {
		r.mu.Unlock()
		return
	}
	r.stopped = true
	cancel := r.cancel
	r.mu.Unlock()

	if cancel != nil {
		cancel()
	}
}

func (r *Runner) TryStop() bool {
	r.mu.Lock()
	if r.stopped {
		r.mu.Unlock()
		return false
	}
	r.stopped = true
	cancel := r.cancel
	r.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	return true
}

func (r *Runner) Output() <-chan string {
	return r.output
}

func (r *Runner) Done() <-chan struct{} {
	return r.done
}

// SessionCost returns the cumulative cost across all turns in this session.
func (r *Runner) SessionCost() float64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sessionCost
}

func (r *Runner) IsRunning() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.running
}

func (r *Runner) IsStopped() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.stopped
}

func (r *Runner) SetSessionID(sessionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessionID = sessionID
}

// SetWorkdir changes the runner's working directory (used by worktree tools).
func (r *Runner) SetWorkdir(dir string) {
	r.mu.Lock()
	r.opts.Workdir = dir
	r.mu.Unlock()
}

// GetWorkdir returns the runner's current working directory.
func (r *Runner) GetWorkdir() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.opts.Workdir
}

func (r *Runner) GetSessionID() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sessionID
}

func (r *Runner) SetPermissionMode(mode string) error {
	r.mu.Lock()
	r.permissionMode = mode
	r.planModeActive = (mode == "plan")
	r.mu.Unlock()

	// Sync the permission engine
	if r.permEngine != nil {
		r.permEngine.SetMode(mode)
	}

	r.emitter.emitPermissionModeChanged(mode)
	return nil
}

func (r *Runner) SetFastMode(enabled bool) error {
	// Direct mutation under lock is sufficient — buildChatRequest reads under the same lock.
	// No message queue needed; the queued path was redundant and created a race window.
	r.mu.Lock()
	r.fastMode = enabled
	r.mu.Unlock()
	return nil
}

func (r *Runner) SetModel(model string) error {
	r.mu.Lock()
	r.opts.Model = strings.TrimSuffix(model, "[1m]")
	r.mu.Unlock()
	return nil
}

func (r *Runner) SetMaxThinkingTokens(tokens int) error {
	r.mu.Lock()
	r.opts.MaxThinkingTokens = tokens
	r.mu.Unlock()
	return nil
}

func (r *Runner) SetPlanModeFromEvent(active bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.planModeActive = active
	r.opts.PlanMode = active
}

func (r *Runner) SetOptionsPlanMode(enabled bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.opts.PlanMode = enabled
	r.planModeActive = enabled
}

func (r *Runner) SetOptionsPermissionMode(mode string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.opts.PermissionMode = mode
}

func (r *Runner) IsPlanModeActive() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.planModeActive
}

func (r *Runner) SetInActiveTurn(active bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.inActiveTurn = active
}

func (r *Runner) IsInActiveTurn() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.inActiveTurn
}

func (r *Runner) StoreOrDeferMessage(msg *core.Message) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.inActiveTurn {
		r.pendingUserMessage = msg
		return false
	}
	return true
}

func (r *Runner) EndTurnAndTakePending() *core.Message {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.inActiveTurn = false
	msg := r.pendingUserMessage
	r.pendingUserMessage = nil
	return msg
}

// TakePendingUserMessage returns and clears the pending user message
// without changing the active turn state. Returns nil if no message is pending.
// Used to discard a deferred message when SendMessage fails.
func (r *Runner) TakePendingUserMessage() *core.Message {
	r.mu.Lock()
	defer r.mu.Unlock()
	msg := r.pendingUserMessage
	r.pendingUserMessage = nil
	return msg
}

// RegisterTool adds a tool to the runner's tool registry.
// Used by the backend adapter to register ChatML-specific tools after core initialization.
func (r *Runner) RegisterTool(t tool.Tool) {
	r.toolRegistry.Register(t)
}

func (r *Runner) SetSawErrorEvent() {
	r.mu.Lock()
	r.sawErrorEvent = true
	r.mu.Unlock()
}

func (r *Runner) SawErrorEvent() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sawErrorEvent
}

func (r *Runner) SetProducedOutput() {
	r.mu.Lock()
	r.producedOutput = true
	r.mu.Unlock()
}

func (r *Runner) ProducedOutput() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.producedOutput
}

func (r *Runner) StopTask(taskId string) error {
	r.subAgentMu.Lock()
	child, ok := r.subAgents[taskId]
	r.subAgentMu.Unlock()
	if !ok {
		return fmt.Errorf("no sub-agent with ID %q", taskId)
	}
	child.Stop()
	return nil
}

// SpawnSubAgent creates and runs a child runner as a sub-agent, blocking until
// the child completes. Implements builtin.AgentSpawner.
func (r *Runner) SpawnSubAgent(ctx context.Context, opts builtin.SubAgentOpts) (*builtin.SubAgentResult, error) {
	start := time.Now()

	// Generate agent ID
	agentId := fmt.Sprintf("agent-%d-%d", atomic.AddInt64(&r.approvalCounter, 1), time.Now().UnixMilli())

	// Emit subagent_started event
	r.emitter.emitSubagentStarted(agentId, opts.Description, "")

	// Run SubagentStart hooks
	if r.hookEngine != nil {
		r.hookEngine.RunSubagentStart(ctx, agentId, opts.Description) //nolint:errcheck
	}

	// Determine model: use override if set, otherwise use parent's model.
	// Resolve short aliases (haiku/sonnet/opus) to full model IDs.
	model := r.opts.Model
	if opts.Model != "" {
		model = resolveModelAlias(opts.Model)
	}

	// Create child ProcessOptions
	maxTurns := opts.MaxTurns
	if maxTurns == 0 {
		maxTurns = 30
	}
	childOpts := agent.ProcessOptions{
		ConversationID:    fmt.Sprintf("%s-sub-%s", r.opts.ConversationID, agentId),
		Workdir:           r.opts.Workdir,
		Model:             model,
		PermissionMode:    permission.ModeBypassPermissions, // Sub-agents bypass: parent already authorized
		MaxTurns:          maxTurns,
		MaxThinkingTokens: r.opts.MaxThinkingTokens,
	}

	// Create child runner with the SAME provider and tool registry.
	// The child runner gets its own output channel and conversation history
	// but shares the underlying LLM provider and tool implementations.
	// If the sub-agent opts specify a tool subset, filter the registry.
	childRegistry := r.toolRegistry
	if len(opts.Tools) > 0 && r.toolRegistry != nil {
		childRegistry = r.toolRegistry.Subset(opts.Tools)
	}
	// Create child runner with its OWN bypass permission engine.
	// Sub-agents must NOT share the parent's permission engine because
	// approval requests would deadlock — the child emits approval_request
	// on its output channel, but nobody responds to the child's pendingApprovals.
	childPermEngine := permission.NewEngineWithWorkdir(
		permission.ModeBypassPermissions,
		permission.NewRuleSet(nil),
		r.opts.Workdir,
	)
	childRunner := NewRunnerFull(childOpts, r.provider, childRegistry, childPermEngine)

	// CRITICAL: Share the parent's prompt builder so the child gets a proper
	// system prompt. Without this, the child has no system prompt and the LLM
	// will not behave correctly (no tool instructions, no identity, no guidelines).
	if r.promptBuilder != nil {
		childRunner.promptBuilder = r.promptBuilder
	}

	// Fork mode: deep-copy parent's messages into the child so it inherits
	// the full conversation context. This enables Anthropic prompt cache sharing
	// because the forked runner sends byte-identical API request prefixes.
	if opts.Fork && len(r.messages) > 0 {
		// Deep clone to avoid sharing Content slice backing arrays with the parent
		childRunner.messages = cloneMessages(r.messages)
	}

	// Track the sub-agent for StopTask
	r.subAgentMu.Lock()
	if r.subAgents == nil {
		r.subAgents = make(map[string]*Runner)
	}
	r.subAgents[agentId] = childRunner
	r.subAgentMu.Unlock()

	defer func() {
		r.subAgentMu.Lock()
		delete(r.subAgents, agentId)
		r.subAgentMu.Unlock()
	}()

	// Read child events in background, forwarding to parent and collecting output
	childOutput := childRunner.Output()
	var lastAssistantText strings.Builder
	var totalToolUses int
	var totalTokens int

	eventsDone := make(chan struct{})
	go func() {
		defer close(eventsDone)
		for line := range childOutput {
			// Parse the event to extract useful info
			var event agent.AgentEvent
			if err := json.Unmarshal([]byte(line), &event); err != nil {
				continue
			}

			switch event.Type {
			case "assistant_text":
				lastAssistantText.WriteString(event.Content)
			case "tool_end":
				totalToolUses++
			case "result":
				if event.Usage != nil {
					if in, ok := event.Usage["input_tokens"]; ok {
						if v, ok2 := in.(float64); ok2 {
							totalTokens += int(v)
						}
					}
					if out, ok := event.Usage["output_tokens"]; ok {
						if v, ok2 := out.(float64); ok2 {
							totalTokens += int(v)
						}
					}
				}
			case "turn_complete":
				// CRITICAL FIX: Sub-agents are one-shot — they process a single
				// prompt and should stop. Without this, the child runner's main
				// loop goes back to waiting for the next user message after
				// executeTurn() returns, but nobody sends one. The child hangs
				// forever, and the parent deadlocks on <-childRunner.Done().
				childRunner.Stop()
			case "error":
				if event.Message != "" {
					log.Printf("[subagent:%s] error: %s", agentId, event.Message)
				}
			}

			// Forward sub-agent output events to parent for CLI rendering
			r.emitter.emitSubagentOutput(agentId, line)
		}
	}()

	// Start the child runner. On failure, close the output channel (guarded by
	// sync.Once to prevent double-close if runLoop also tries to close it) so the
	// eventsDone goroutine can exit cleanly.
	if err := childRunner.Start(); err != nil {
		childRunner.closeOnce.Do(func() { close(childRunner.output) })
		<-eventsDone
		r.emitter.emitSubagentStopped(agentId, 0, 0, 0, "")
		return nil, fmt.Errorf("failed to start sub-agent: %w", err)
	}

	// Send the prompt as a user message
	if err := childRunner.SendMessage(opts.Prompt); err != nil {
		childRunner.Stop()
		<-childRunner.Done()
		<-eventsDone
		r.emitter.emitSubagentStopped(agentId, 0, 0, time.Since(start).Milliseconds(), "")
		return nil, fmt.Errorf("failed to send prompt to sub-agent: %w", err)
	}

	// Wait for completion, respecting parent context cancellation
	select {
	case <-ctx.Done():
		childRunner.Stop()
		<-childRunner.Done()
		<-eventsDone
		r.emitter.emitSubagentStopped(agentId, totalToolUses, totalTokens, time.Since(start).Milliseconds(), "cancelled")
		return nil, ctx.Err()
	case <-childRunner.Done():
		// Child completed naturally
	}

	// Wait for all events to be processed
	<-eventsDone

	// Roll up child session cost into parent
	r.mu.Lock()
	r.sessionCost += childRunner.SessionCost()
	r.mu.Unlock()

	elapsed := time.Since(start)

	output := lastAssistantText.String()
	if output == "" {
		output = "(no output)"
	}

	// Emit subagent_stopped with full metrics
	r.emitter.emitSubagentStopped(agentId, totalToolUses, totalTokens, elapsed.Milliseconds(), output)

	// Run SubagentStop hooks
	if r.hookEngine != nil {
		r.hookEngine.RunSubagentStop(ctx, agentId) //nolint:errcheck
	}

	return &builtin.SubAgentResult{
		Output:     output,
		ToolUses:   totalToolUses,
		Tokens:     totalTokens,
		DurationMs: elapsed.Milliseconds(),
		Success:    true,
	}, nil
}

func (r *Runner) SendToolApprovalResponse(requestId, action, specifier string, updatedInput json.RawMessage) error {
	val, ok := r.pendingApprovals.Load(requestId)
	if !ok {
		return fmt.Errorf("no pending approval request with ID %q", requestId)
	}

	ch, ok2 := val.(chan permission.ApprovalResponse)
	if !ok2 {
		return fmt.Errorf("invalid pending approval state for request %q", requestId)
	}
	resp := permission.ApprovalResponse{
		Action:       action,
		Specifier:    specifier,
		UpdatedInput: updatedInput,
	}

	select {
	case ch <- resp:
		return nil
	default:
		// Duplicate approval — the first response was already consumed.
		// This is a no-op (not a bug), but log it for debugging.
		log.Printf("warning: duplicate approval response for request %q (action=%s) — ignoring", requestId, action)
		return nil
	}
}

// SendBatchToolApprovalResponse handles the user's response to a batch approval request.
func (r *Runner) SendBatchToolApprovalResponse(requestId string, action string, perTool map[string]agent.ToolApprovalOverride) error {
	val, ok := r.pendingBatchApprovals.Load(requestId)
	if !ok {
		return fmt.Errorf("no pending batch approval request with ID %q", requestId)
	}
	ch, ok2 := val.(chan permission.BatchApprovalResponse)
	if !ok2 {
		return fmt.Errorf("invalid pending batch approval state for request %q", requestId)
	}
	// Convert agent-level overrides to permission-level responses
	var permPerTool map[string]permission.ApprovalResponse
	if len(perTool) > 0 {
		permPerTool = make(map[string]permission.ApprovalResponse, len(perTool))
		for id, override := range perTool {
			permPerTool[id] = permission.ApprovalResponse{
				Action:       override.Action,
				Specifier:    override.Specifier,
				UpdatedInput: override.UpdatedInput,
			}
		}
	}
	resp := permission.BatchApprovalResponse{
		Action:  action,
		PerTool: permPerTool,
	}
	select {
	case ch <- resp:
		return nil
	default:
		log.Printf("warning: duplicate batch approval response for request %q — ignoring", requestId)
		return nil
	}
}

func (r *Runner) SendUserQuestionResponse(requestId string, answers map[string]string) error {
	val, ok := r.pendingQuestions.Load(requestId)
	if !ok {
		return fmt.Errorf("no pending question request with ID %q", requestId)
	}
	ch, ok2 := val.(chan map[string]string)
	if !ok2 {
		return fmt.Errorf("invalid pending question state for request %q", requestId)
	}
	select {
	case ch <- answers:
		return nil
	default:
		return fmt.Errorf("question response channel full for request %q", requestId)
	}
}

func (r *Runner) SendPlanApprovalResponse(requestId string, approved bool, reason string) error {
	val, ok := r.pendingPlanApprovals.Load(requestId)
	if !ok {
		return fmt.Errorf("no pending plan approval request with ID %q", requestId)
	}
	ch, ok2 := val.(chan builtin.PlanApprovalResult)
	if !ok2 {
		return fmt.Errorf("invalid pending plan approval state for request %q", requestId)
	}
	select {
	case ch <- builtin.PlanApprovalResult{Approved: approved, Reason: reason}:
		return nil
	default:
		return fmt.Errorf("plan approval response channel full for request %q", requestId)
	}
}

// --- UserQuestionCallback interface ---

// EmitQuestionRequest implements builtin.UserQuestionCallback.
func (r *Runner) EmitQuestionRequest(requestID string, questions []builtin.QuestionDef) <-chan map[string]string {
	ch := make(chan map[string]string, 1)
	r.pendingQuestions.Store(requestID, ch)

	// Emit the user_question_request event
	r.emitter.emit(&agent.AgentEvent{
		Type:      "user_question_request",
		RequestID: requestID,
		Questions: convertQuestions(questions),
	})

	return ch
}

func convertQuestions(qs []builtin.QuestionDef) []agent.UserQuestion {
	result := make([]agent.UserQuestion, len(qs))
	for i, q := range qs {
		var opts []agent.UserQuestionOption
		for _, o := range q.Options {
			opts = append(opts, agent.UserQuestionOption{
				Label:       o.Label,
				Description: o.Description,
			})
		}
		result[i] = agent.UserQuestion{
			Question:    q.Text,
			Header:      q.ID,
			Options:     opts,
			MultiSelect: q.MultiSelect,
		}
	}
	return result
}

// --- PlanModeCallback interface ---

// EmitPlanApprovalRequest implements builtin.PlanModeCallback.
func (r *Runner) EmitPlanApprovalRequest(requestID string, planContent string) <-chan builtin.PlanApprovalResult {
	ch := make(chan builtin.PlanApprovalResult, 1)
	r.pendingPlanApprovals.Store(requestID, ch)

	// Emit the plan_approval_request event
	r.emitter.emit(&agent.AgentEvent{
		Type:        "plan_approval_request",
		RequestID:   requestID,
		PlanContent: planContent,
	})

	return ch
}

// PrePlanPermissionMode implements builtin.PlanModeCallback.
func (r *Runner) PrePlanPermissionMode() string {
	if r.permEngine != nil {
		return r.permEngine.PrePlanMode()
	}
	return ""
}

// SetPermissionModeDirect implements builtin.PlanModeCallback.
func (r *Runner) SetPermissionModeDirect(mode string) {
	r.mu.Lock()
	r.permissionMode = mode
	r.planModeActive = (mode == "plan")
	r.mu.Unlock()

	if r.permEngine != nil {
		r.permEngine.SetMode(mode)
	}

	r.emitter.emitPermissionModeChanged(mode)
}

// cleanup releases resources held by the runner on shutdown.
// Cleans up tools that implement tool.Cleanable and removes temp directories.
// Waits for background goroutines (memory extraction) to finish so the
// caller can safely tear down the provider after <-Done().
func (r *Runner) cleanup() {
	// Cancel then wait for outstanding background goroutines (e.g., memory extraction).
	// Cancelling first ensures we don't block shutdown for up to 30s waiting for
	// an LLM call to complete. The Wait() then returns quickly.
	r.bgExtractCancelMu.Lock()
	if r.bgExtractCancel != nil {
		r.bgExtractCancel()
	}
	r.bgExtractCancelMu.Unlock()
	r.bgWg.Wait()

	// Generate session notes for potential session resume
	if r.sessionNotes != nil && r.memoryExtractor != nil && len(r.messages) > 2 {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if notes, err := r.sessionNotes.GenerateNotes(ctx, r.messages); err == nil && notes != "" {
			if memDir, err := r.memoryExtractor.memoryDir(); err == nil {
				os.MkdirAll(memDir, 0755)
				notesPath := filepath.Join(memDir, "session_notes.md")
				os.WriteFile(notesPath, []byte(notes), 0644)
			}
		}
	}

	// Cleanup tools (e.g., BashTool kills background processes)
	if r.toolRegistry != nil {
		for _, t := range r.toolRegistry.All() {
			if c, ok := t.(tool.Cleanable); ok {
				c.Cleanup()
			}
		}
	}

	// Remove persisted tool result temp directory
	if r.resultPersister != nil {
		r.resultPersister.Cleanup()
	}

	// Close transcript writer
	if r.transcript != nil {
		r.transcript.Close() //nolint:errcheck
	}

	// Close MCP connections
	if r.mcpManager != nil {
		r.mcpManager.Close()
	}
}

// persistMessage writes a message to the transcript file (if active).
// Best-effort: errors are logged but don't block execution.
func (r *Runner) persistMessage(msg provider.Message) {
	if r.transcript != nil {
		if err := r.transcript.WriteMessage(msg); err != nil {
			log.Printf("warning: failed to persist message to transcript: %v", err)
		}
	}
}

func (r *Runner) Options() agent.ProcessOptions {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.opts
}

// isAPIStatusCode checks if the error is an *provider.APIError with one of the given status codes.
func isAPIStatusCode(err error, codes ...int) bool {
	var apiErr *provider.APIError
	if errors.As(err, &apiErr) {
		for _, code := range codes {
			if apiErr.StatusCode == code {
				return true
			}
		}
	}
	return false
}

// isFallbackEligible returns true if the error warrants trying a fallback model.
func isFallbackEligible(err error) bool {
	if err == nil {
		return false
	}
	// Prefer typed check
	if isAPIStatusCode(err, 529, 503, 502, 504) {
		return true
	}
	// Fallback to string matching for wrapped errors
	msg := err.Error()
	return strings.Contains(msg, "overloaded") ||
		strings.Contains(msg, "capacity")
}

// is529Error returns true if the error is specifically a 529 (overloaded) error.
func is529Error(err error) bool {
	if err == nil {
		return false
	}
	if isAPIStatusCode(err, 529) {
		return true
	}
	return strings.Contains(err.Error(), "529")
}

func is429Error(err error) bool {
	if err == nil {
		return false
	}
	return isAPIStatusCode(err, 429)
}

// isContextOverflow returns true if the error indicates a context window overflow.
// Claude Code handles this by reducing max_tokens and retrying.
func isContextOverflow(err error) bool {
	if err == nil {
		return false
	}
	// Fallback to string matching for context-overflow messages not tied to a status code
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "context_length_exceeded") ||
		strings.Contains(msg, "maximum context length") ||
		(strings.Contains(msg, "max_tokens") && strings.Contains(msg, "exceeds")) ||
		strings.Contains(msg, "too many tokens") ||
		strings.Contains(msg, "input is too long")
}

// contextOverflowRe matches error messages like:
// "input tokens (150000) + max_tokens (8192) must be <= context limit (200000)"
// or "input_tokens: 150000 ... context_window: 200000"
var contextOverflowRe = regexp.MustCompile(`(?i)input[_ ]tokens[:\s(]*(\d+).*context[_ ](?:limit|window)[:\s(]*(\d+)`)

// parseContextOverflow extracts the input token count and context limit from
// a context overflow error message. Returns ok=false if parsing fails.
func parseContextOverflow(errMsg string) (inputTokens, contextLimit int, ok bool) {
	matches := contextOverflowRe.FindStringSubmatch(errMsg)
	if len(matches) < 3 {
		return 0, 0, false
	}
	input, err1 := strconv.Atoi(matches[1])
	limit, err2 := strconv.Atoi(matches[2])
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return input, limit, true
}

// isPromptTooLong returns true if the error indicates the prompt exceeded
// the model's context window. This triggers reactive compaction + retry.
func isPromptTooLong(err error) bool {
	if err == nil {
		return false
	}
	if isAPIStatusCode(err, 413) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return (strings.Contains(msg, "prompt") && strings.Contains(msg, "too long")) ||
		strings.Contains(msg, "prompt_too_long")
}

// Ensure Runner implements ConversationBackend at compile time.
var _ agent.ConversationBackend = (*Runner)(nil)
