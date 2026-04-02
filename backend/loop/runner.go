package loop

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/chatml/chatml-backend/agent"
	ctxpkg "github.com/chatml/chatml-backend/context"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/permission"
	"github.com/chatml/chatml-backend/prompt"
	"github.com/chatml/chatml-backend/provider"
	"github.com/chatml/chatml-backend/tool"
	"github.com/chatml/chatml-backend/tool/builtin"
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
	output chan string

	// Done channel — closed when the runner has fully exited.
	done chan struct{}

	// Message input — user messages are queued here and consumed by the loop.
	messageQueue chan inputMsg

	// Cancel function for the loop's context
	cancel context.CancelFunc

	// Conversation state
	messages []provider.Message // Full conversation history

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
	pendingUserMessage *models.Message

	// Emitter for producing AgentEvent JSON
	emitter *emitter

	// System prompt builder
	promptBuilder *prompt.Builder

	// Context manager
	ctxManager *ctxpkg.Manager

	// Fallback model (used when primary model hits capacity/unsupported errors)
	fallbackModel string

	// Permission engine
	permEngine       *permission.Engine
	pendingApprovals sync.Map // requestID -> chan permission.ApprovalResponse
	approvalCounter  int64

	// Pending user question and plan approval channels
	pendingQuestions     sync.Map // requestID -> chan map[string]string
	pendingPlanApprovals sync.Map // requestID -> chan builtin.PlanApprovalResult
}

// inputMsg represents a message sent to the runner by the Manager.
type inputMsg struct {
	Type    string
	Content string

	// Attachments for user messages
	Attachments []models.Attachment

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
		promptBuilder:  prompt.NewBuilder(opts.Workdir, opts.Model, opts.Instructions),
		permEngine:     permEngine,
	}

	// Initialize context manager (requires provider for context window size)
	if prov != nil {
		r.ctxManager = ctxpkg.NewManager(prov.MaxContextWindow())
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
	r.cancel = cancel

	go r.runLoop(ctx)
	return nil
}

// runLoop is the main agentic loop goroutine.
func (r *Runner) runLoop(ctx context.Context) {
	defer func() {
		r.mu.Lock()
		r.running = false
		r.mu.Unlock()
		close(r.output)
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
	r.emitter.emitSessionStarted(sessionID, "startup")

	// Main message loop — wait for user messages and execute turns
	for {
		select {
		case <-ctx.Done():
			r.emitter.emitComplete()
			return

		case msg, ok := <-r.messageQueue:
			if !ok {
				r.emitter.emitComplete()
				return
			}

			switch msg.Type {
			case "message":
				r.executeTurn(ctx, msg.Content, msg.Attachments)
			case "stop":
				r.emitter.emitComplete()
				return
			case "interrupt":
				// Interrupt is handled by context cancellation within executeTurn
				continue
			case "set_permission_mode":
				r.mu.Lock()
				r.permissionMode = msg.PermissionMode
				r.planModeActive = (msg.PermissionMode == "plan")
				r.mu.Unlock()
				r.emitter.emitPermissionModeChanged(msg.PermissionMode)
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
func (r *Runner) executeTurn(ctx context.Context, userContent string, attachments []models.Attachment) {
	r.mu.Lock()
	r.inActiveTurn = true
	r.mu.Unlock()

	defer func() {
		r.mu.Lock()
		r.inActiveTurn = false
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

	userMsg := provider.Message{
		Role:    provider.RoleUser,
		Content: contentBlocks,
	}
	r.messages = append(r.messages, userMsg)

	turnCount := 0
	maxOutputRecoveryCount := 0
	const maxOutputRecoveryLimit = 3

	// Track cumulative cost across the turn
	var cumulativeCost float64

	// Inner agentic loop — continues as long as the LLM returns tool calls
	for {
		turnCount++

		// Check max turns limit
		if r.opts.MaxTurns > 0 && turnCount > r.opts.MaxTurns {
			r.emitter.emitAssistantText("\n\n[Max turns reached]")
			break
		}

		// Build the chat request
		req := r.buildChatRequest()

		// Stream the LLM response
		stream, err := r.provider.StreamChat(ctx, req)
		if err != nil {
			// Try fallback model if available and this is a capacity/model error
			if r.fallbackModel != "" && isFallbackEligible(err) {
				r.mu.Lock()
				originalModel := r.opts.Model
				r.opts.Model = r.fallbackModel
				r.mu.Unlock()

				r.emitter.emitError(fmt.Sprintf("Switching to fallback model %s: %v", r.fallbackModel, err))

				// Retry with fallback model (strip thinking blocks from messages)
				req = r.buildChatRequest()
				req.ThinkingBudget = 0 // Fallback model may not support thinking
				stream, err = r.provider.StreamChat(ctx, req)

				// Restore original model for next turn
				r.mu.Lock()
				r.opts.Model = originalModel
				r.mu.Unlock()
			}

			if err != nil {
				r.emitter.emitError(fmt.Sprintf("LLM API error: %v", err))
				r.mu.Lock()
				r.sawErrorEvent = true
				r.mu.Unlock()
				break
			}
		}

		// Process the stream and collect the assistant response
		assistantMsg, toolCalls, usage, stopReason := r.processStream(ctx, stream)

		// Append assistant message to history
		r.messages = append(r.messages, assistantMsg)

		// Track cost and context usage
		if usage != nil {
			r.mu.Lock()
			model := r.opts.Model
			r.mu.Unlock()
			cumulativeCost += provider.CalculateCost(model, *usage)
			r.emitter.emitContextUsage(usage.InputTokens, usage.OutputTokens, r.provider.MaxContextWindow())

			// Update context manager with token count
			if r.ctxManager != nil {
				currentTokens := ctxpkg.ContextTokensFromUsage(usage)
				r.ctxManager.UpdateTokenCount(currentTokens)

				// Check if microcompact is needed
				if r.ctxManager.ShouldMicrocompact(r.ctxManager.LastTokenCount(), 2*time.Minute) {
					r.messages = ctxpkg.Microcompact(r.messages, 10)
					r.ctxManager.RecordCompaction()
				}

				// Check if auto-compact is needed
				if r.ctxManager.ShouldAutoCompact(currentTokens) {
					result, compErr := ctxpkg.Compact(ctx, r.provider, r.messages, 4)
					if compErr != nil {
						r.ctxManager.RecordCompactFailure()
						r.emitter.emitError(fmt.Sprintf("Auto-compact failed: %v", compErr))
					} else {
						r.messages = result.Messages
						r.ctxManager.RecordCompaction()
						r.ctxManager.ResetCompactFailures()
					}
				}
			}
		}

		// Max output tokens recovery: if the model hit the output limit,
		// inject a continuation prompt and retry (up to 3 times).
		if stopReason == "max_tokens" && len(toolCalls) == 0 {
			maxOutputRecoveryCount++
			if maxOutputRecoveryCount <= maxOutputRecoveryLimit {
				recoveryMsg := provider.Message{
					Role:    provider.RoleUser,
					Content: []provider.ContentBlock{provider.NewTextBlock("Your response was cut off. Please continue from where you stopped.")},
				}
				r.messages = append(r.messages, recoveryMsg)
				continue // Retry the turn
			}
			// Exhausted recovery attempts — fall through to end turn
		} else if len(toolCalls) > 0 {
			// Successful tool call turn — reset recovery counter
			maxOutputRecoveryCount = 0
		}

		// If no tool calls, the turn is complete
		if len(toolCalls) == 0 {
			r.emitter.emitResult(usage, cumulativeCost, turnCount)
			break
		}

		// Execute tool calls and collect results
		toolResultMsg := r.executeTools(ctx, toolCalls)
		r.messages = append(r.messages, toolResultMsg)

		// Track tool results for microcompact triggering
		if r.ctxManager != nil {
			r.ctxManager.IncrementToolResults(len(toolCalls))
		}

		// Loop back to send tool results to the LLM
	}
}

// buildChatRequest constructs a provider.ChatRequest from the current conversation state.
func (r *Runner) buildChatRequest() provider.ChatRequest {
	r.mu.Lock()
	model := r.opts.Model
	thinkingBudget := r.opts.MaxThinkingTokens
	r.mu.Unlock()

	// Build system prompt from workspace context
	systemPrompt := r.opts.Instructions
	if r.promptBuilder != nil {
		systemPrompt = r.promptBuilder.Build()
	}

	// Normalize messages and apply tool result budget before sending
	normalizedMsgs := normalizeMessages(r.messages)
	normalizedMsgs = applyToolResultBudget(normalizedMsgs, 0)

	req := provider.ChatRequest{
		Model:          model,
		Messages:       normalizedMsgs,
		SystemPrompt:   systemPrompt,
		ThinkingBudget: thinkingBudget,
	}

	// Add tool definitions from the registry
	if r.toolRegistry != nil {
		req.Tools = r.toolRegistry.ToolDefs()
	}

	return req
}

// processStream reads streaming events and builds the assistant message.
// Returns the complete assistant message, any tool calls, and usage stats.
func (r *Runner) processStream(ctx context.Context, stream <-chan provider.StreamEvent) (provider.Message, []provider.ToolUseBlock, *provider.Usage, string) {
	var (
		textAccum     strings.Builder
		thinkingAccum strings.Builder
		toolCalls     []provider.ToolUseBlock
		lastUsage     *provider.Usage
		stopReason    string
	)

	for event := range stream {
		select {
		case <-ctx.Done():
			// Drain remaining events
			for range stream {
			}
			break
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
				// Emit tool_start event — params will be populated on tool_end
				r.emitter.emitToolStart(event.ToolUse.ID, event.ToolUse.Name, nil)
			}

		case provider.EventToolUseEnd:
			if event.ToolUse != nil {
				toolCalls = append(toolCalls, *event.ToolUse)
			}

		case provider.EventMessageDelta:
			lastUsage = event.Usage
			if event.StopReason != "" {
				stopReason = event.StopReason
			}

		case provider.EventError:
			if event.Error != nil {
				r.emitter.emitError(event.Error.Error())
				r.mu.Lock()
				r.sawErrorEvent = true
				r.mu.Unlock()
			}
		}
	}

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

	return provider.Message{
		Role:    provider.RoleAssistant,
		Content: content,
	}, toolCalls, lastUsage, stopReason
}

// Note: Claude Code waits INDEFINITELY for user approval (no timeout).
// We match this behavior — approval only ends via user response or context cancellation.

// executeTools runs tool calls through permission checks and then executes approved ones.
func (r *Runner) executeTools(ctx context.Context, toolCalls []provider.ToolUseBlock) provider.Message {
	if r.toolExecutor == nil {
		// No tool registry — return errors for all tool calls
		var resultBlocks []provider.ContentBlock
		for _, tc := range toolCalls {
			result := fmt.Sprintf("Tool %q is not available (no tool registry configured).", tc.Name)
			r.emitter.emitToolEnd(tc.ID, tc.Name, false, result)
			resultBlocks = append(resultBlocks, provider.NewToolResultBlock(tc.ID, result, true))
		}
		return provider.Message{Role: provider.RoleUser, Content: resultBlocks}
	}

	var approvedCalls []tool.ToolCall
	var resultBlocks []provider.ContentBlock

	// Phase 1: Check permissions for each tool call (sequential — may block on user approval)
	for _, tc := range toolCalls {
		if r.permEngine == nil {
			// No permission engine — allow everything (backwards compat)
			approvedCalls = append(approvedCalls, tool.ToolCall{ID: tc.ID, Name: tc.Name, Input: tc.Input})
			r.emitter.emitToolStart(tc.ID, tc.Name, nil)
			continue
		}

		check, input := r.checkPermission(ctx, tc)

		switch check.Decision {
		case permission.Allow:
			approvedCalls = append(approvedCalls, tool.ToolCall{ID: tc.ID, Name: tc.Name, Input: input})
			r.emitter.emitToolStart(tc.ID, tc.Name, nil)
		case permission.Deny:
			msg := fmt.Sprintf("Permission denied: %s", check.DenyMessage)
			r.emitter.emitToolStart(tc.ID, tc.Name, nil)
			r.emitter.emitToolEnd(tc.ID, tc.Name, false, msg)
			resultBlocks = append(resultBlocks, provider.NewToolResultBlock(tc.ID, msg, true))
		case permission.NeedApproval:
			// This shouldn't happen — checkPermission resolves NeedApproval via requestApproval
			msg := "Permission check returned unexpected NeedApproval"
			r.emitter.emitToolStart(tc.ID, tc.Name, nil)
			r.emitter.emitToolEnd(tc.ID, tc.Name, false, msg)
			resultBlocks = append(resultBlocks, provider.NewToolResultBlock(tc.ID, msg, true))
		}
	}

	// Phase 2: Execute approved calls
	if len(approvedCalls) > 0 {
		results := r.toolExecutor.Execute(ctx, approvedCalls)
		for _, tcr := range results {
			content := ""
			isError := false
			if tcr.Result != nil {
				content = tcr.Result.Content
				isError = tcr.Result.IsError
			}

			summary := content
			if len(summary) > 200 {
				summary = summary[:200] + "..."
			}
			r.emitter.emitToolEnd(tcr.ToolCall.ID, tcr.ToolCall.Name, !isError, summary)
			resultBlocks = append(resultBlocks, provider.NewToolResultBlock(tcr.ToolCall.ID, content, isError))
		}
	}

	return provider.Message{Role: provider.RoleUser, Content: resultBlocks}
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
	json.Unmarshal(tc.Input, &toolInputObj)

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

// --- ConversationBackend interface implementation ---

func (r *Runner) SendMessage(content string) error {
	select {
	case r.messageQueue <- inputMsg{Type: "message", Content: content}:
		return nil
	default:
		return fmt.Errorf("runner message queue full")
	}
}

func (r *Runner) SendMessageWithAttachments(content string, attachments []models.Attachment) error {
	select {
	case r.messageQueue <- inputMsg{Type: "message", Content: content, Attachments: attachments}:
		return nil
	default:
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
	if r.cancel != nil {
		r.cancel()
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
	r.mu.Unlock()

	if r.cancel != nil {
		r.cancel()
	}
}

func (r *Runner) TryStop() bool {
	r.mu.Lock()
	if r.stopped {
		r.mu.Unlock()
		return false
	}
	r.stopped = true
	r.mu.Unlock()

	if r.cancel != nil {
		r.cancel()
	}
	return true
}

func (r *Runner) Output() <-chan string {
	return r.output
}

func (r *Runner) Done() <-chan struct{} {
	return r.done
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

	select {
	case r.messageQueue <- inputMsg{Type: "set_permission_mode", PermissionMode: mode}:
		return nil
	default:
		return nil // Best effort
	}
}

func (r *Runner) SetFastMode(enabled bool) error {
	r.mu.Lock()
	r.fastMode = enabled
	r.mu.Unlock()

	select {
	case r.messageQueue <- inputMsg{Type: "set_fast_mode", FastMode: &enabled}:
		return nil
	default:
		return nil
	}
}

func (r *Runner) SetModel(model string) error {
	r.mu.Lock()
	r.opts.Model = model
	r.mu.Unlock()

	select {
	case r.messageQueue <- inputMsg{Type: "set_model", Model: model}:
		return nil
	default:
		return nil
	}
}

func (r *Runner) SetMaxThinkingTokens(tokens int) error {
	r.mu.Lock()
	r.opts.MaxThinkingTokens = tokens
	r.mu.Unlock()

	select {
	case r.messageQueue <- inputMsg{Type: "set_max_thinking_tokens", MaxThinkingTokens: tokens}:
		return nil
	default:
		return nil
	}
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

func (r *Runner) StoreOrDeferMessage(msg *models.Message) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.inActiveTurn {
		r.pendingUserMessage = msg
		return false
	}
	return true
}

func (r *Runner) EndTurnAndTakePending() *models.Message {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.inActiveTurn = false
	msg := r.pendingUserMessage
	r.pendingUserMessage = nil
	return msg
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
	// TODO: Implement sub-agent task stopping
	return fmt.Errorf("StopTask not yet implemented in native runner")
}

func (r *Runner) SendToolApprovalResponse(requestId, action, specifier string, updatedInput json.RawMessage) error {
	val, ok := r.pendingApprovals.Load(requestId)
	if !ok {
		return fmt.Errorf("no pending approval request with ID %q", requestId)
	}

	ch := val.(chan permission.ApprovalResponse)
	resp := permission.ApprovalResponse{
		Action:       action,
		Specifier:    specifier,
		UpdatedInput: updatedInput,
	}

	select {
	case ch <- resp:
		return nil
	default:
		return fmt.Errorf("approval response channel full for request %q", requestId)
	}
}

func (r *Runner) SendUserQuestionResponse(requestId string, answers map[string]string) error {
	val, ok := r.pendingQuestions.Load(requestId)
	if !ok {
		return fmt.Errorf("no pending question request with ID %q", requestId)
	}
	ch := val.(chan map[string]string)
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
	ch := val.(chan builtin.PlanApprovalResult)
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
		result[i] = agent.UserQuestion{
			Question: q.Text,
			Header:   q.ID,
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

func (r *Runner) Options() agent.ProcessOptions {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.opts
}

// isFallbackEligible returns true if the error warrants trying a fallback model.
// Eligible errors: 529 (overloaded), 503 (service unavailable), model-specific capacity errors.
func isFallbackEligible(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "529") ||
		strings.Contains(msg, "503") ||
		strings.Contains(msg, "overloaded") ||
		strings.Contains(msg, "capacity")
}

// Ensure Runner implements ConversationBackend at compile time.
var _ agent.ConversationBackend = (*Runner)(nil)
