package hook

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Engine executes hook commands in response to lifecycle events.
// Thread-safe: may be called from multiple goroutines (e.g. concurrent tool execution).
type Engine struct {
	mu      sync.Mutex
	config  Config
	workdir string

	// Once-tracking: keys are "<event>|<matcher>|<hookIdx>" for hooks already fired.
	onceFired map[string]bool
}

// NewEngine creates a hook engine with the given working directory and configuration.
func NewEngine(workdir string, config Config) *Engine {
	return &Engine{
		config:    config,
		workdir:   workdir,
		onceFired: make(map[string]bool),
	}
}

// HookInput is the JSON payload sent to hook commands via stdin.
type HookInput struct {
	Event     string          `json:"event"`
	ToolName  string          `json:"tool_name,omitempty"`
	ToolInput json.RawMessage `json:"tool_input,omitempty"`
	Result    string          `json:"tool_result,omitempty"`
	IsError   bool            `json:"is_error,omitempty"`
	SessionID string          `json:"session_id,omitempty"`

	// Extra context (varies by event)
	Extra map[string]interface{} `json:"extra,omitempty"`
}

// HookOutput is the JSON payload a hook command can write to stdout.
type HookOutput struct {
	// Flow control
	Continue *bool  `json:"continue,omitempty"` // false = stop the operation
	Async    *bool  `json:"async,omitempty"`    // true = hook is async, don't wait
	Decision string `json:"decision,omitempty"` // "approve" or "block"
	Reason   string `json:"reason,omitempty"`   // Explanation for decision

	// PreToolUse-specific
	PermissionDecision string          `json:"permissionDecision,omitempty"` // "allow", "deny"
	UpdatedInput       json.RawMessage `json:"updatedInput,omitempty"`
	DenyMessage        string          `json:"denyMessage,omitempty"`

	// General
	AdditionalContext string `json:"additionalContext,omitempty"` // Extra context for the agent
	StopReason        string `json:"stopReason,omitempty"`        // Reason shown when continue=false
	SystemMessage     string `json:"systemMessage,omitempty"`     // Warning shown to user
	SuppressOutput    bool   `json:"suppressOutput,omitempty"`    // Hide stdout from transcript

	// hookSpecificOutput fields (flattened for simplicity in Go)
	UpdatedMCPToolOutput json.RawMessage `json:"updatedMCPToolOutput,omitempty"` // PostToolUse: update MCP output
	WatchPaths           []string        `json:"watchPaths,omitempty"`           // SessionStart/CwdChanged: paths to watch
	InitialUserMessage   string          `json:"initialUserMessage,omitempty"`   // SessionStart: set first message
	Retry                *bool           `json:"retry,omitempty"`                // PermissionDenied: retry the tool
}

// AggregatedResult combines results from multiple hooks for the same event.
type AggregatedResult struct {
	// Merged fields
	AdditionalContexts []string
	BlockingErrors     []BlockingError
	PreventContinue    bool
	StopReason         string

	// Permission-related (from PreToolUse / PermissionRequest hooks)
	PermissionDecision string          // "allow", "deny", "" (passthrough)
	PermissionReason   string
	UpdatedInput       json.RawMessage
	UpdatedMCPOutput   json.RawMessage

	// Other
	WatchPaths         []string
	InitialUserMessage string
	Retry              *bool
}

// BlockingError records a hook that blocked execution.
type BlockingError struct {
	Command string `json:"command"`
	Message string `json:"message"`
}

// RunPreToolUse runs hooks registered for the PreToolUse event.
// Returns an aggregated result that may deny, modify input, or add context.
func (e *Engine) RunPreToolUse(ctx context.Context, toolName string, input json.RawMessage) (*HookOutput, error) {
	result, err := e.runEvent(ctx, EventPreToolUse, &HookInput{
		Event:     EventPreToolUse,
		ToolName:  toolName,
		ToolInput: input,
	}, toolName)
	if err != nil {
		return nil, err
	}
	return aggregateToLegacyOutput(result), nil
}

// RunPostToolUse runs hooks registered for the PostToolUse event.
func (e *Engine) RunPostToolUse(ctx context.Context, toolName string, input json.RawMessage, result string) (*HookOutput, error) {
	agg, err := e.runEvent(ctx, EventPostToolUse, &HookInput{
		Event:     EventPostToolUse,
		ToolName:  toolName,
		ToolInput: input,
		Result:    result,
	}, toolName)
	if err != nil {
		return nil, err
	}
	return aggregateToLegacyOutput(agg), nil
}

// RunPostToolUseFailure runs hooks registered for the PostToolUseFailure event.
func (e *Engine) RunPostToolUseFailure(ctx context.Context, toolName string, input json.RawMessage, errMsg string) error {
	_, err := e.runEvent(ctx, EventPostToolUseFail, &HookInput{
		Event:     EventPostToolUseFail,
		ToolName:  toolName,
		ToolInput: input,
		Result:    errMsg,
		IsError:   true,
	}, toolName)
	return err
}

// RunSessionStart runs hooks registered for the SessionStart event.
func (e *Engine) RunSessionStart(ctx context.Context, sessionID string) (*AggregatedResult, error) {
	return e.runEvent(ctx, EventSessionStart, &HookInput{
		Event:     EventSessionStart,
		SessionID: sessionID,
	}, "")
}

// RunSessionEnd runs hooks registered for the SessionEnd event.
func (e *Engine) RunSessionEnd(ctx context.Context, sessionID string) error {
	_, err := e.runEvent(ctx, EventSessionEnd, &HookInput{
		Event:     EventSessionEnd,
		SessionID: sessionID,
	}, "")
	return err
}

// RunPreCompact runs hooks before context compaction.
func (e *Engine) RunPreCompact(ctx context.Context, sessionID string) error {
	_, err := e.runEvent(ctx, EventPreCompact, &HookInput{
		Event:     EventPreCompact,
		SessionID: sessionID,
	}, "")
	return err
}

// RunPostCompact runs hooks after context compaction.
func (e *Engine) RunPostCompact(ctx context.Context, sessionID string) error {
	_, err := e.runEvent(ctx, EventPostCompact, &HookInput{
		Event:     EventPostCompact,
		SessionID: sessionID,
	}, "")
	return err
}

// RunNotification runs Notification hooks.
func (e *Engine) RunNotification(ctx context.Context, message string) error {
	_, err := e.runEvent(ctx, EventNotification, &HookInput{
		Event: EventNotification,
		Extra: map[string]interface{}{"message": message},
	}, "")
	return err
}

// RunPermissionRequest runs PermissionRequest hooks.
func (e *Engine) RunPermissionRequest(ctx context.Context, toolName string, input json.RawMessage) (*AggregatedResult, error) {
	return e.runEvent(ctx, EventPermissionRequest, &HookInput{
		Event:     EventPermissionRequest,
		ToolName:  toolName,
		ToolInput: input,
	}, toolName)
}

// RunPermissionDenied runs PermissionDenied hooks.
func (e *Engine) RunPermissionDenied(ctx context.Context, toolName string, input json.RawMessage, reason string) (*AggregatedResult, error) {
	return e.runEvent(ctx, EventPermissionDenied, &HookInput{
		Event:     EventPermissionDenied,
		ToolName:  toolName,
		ToolInput: input,
		Extra:     map[string]interface{}{"reason": reason},
	}, toolName)
}

// RunSubagentStart runs SubagentStart hooks.
func (e *Engine) RunSubagentStart(ctx context.Context, agentID, description string) error {
	_, err := e.runEvent(ctx, EventSubagentStart, &HookInput{
		Event: EventSubagentStart,
		Extra: map[string]interface{}{"agent_id": agentID, "description": description},
	}, "")
	return err
}

// RunSubagentStop runs SubagentStop hooks.
func (e *Engine) RunSubagentStop(ctx context.Context, agentID string) error {
	_, err := e.runEvent(ctx, EventSubagentStop, &HookInput{
		Event: EventSubagentStop,
		Extra: map[string]interface{}{"agent_id": agentID},
	}, "")
	return err
}

// RunStop runs Stop hooks.
func (e *Engine) RunStop(ctx context.Context, sessionID string) error {
	_, err := e.runEvent(ctx, EventStop, &HookInput{
		Event:     EventStop,
		SessionID: sessionID,
	}, "")
	return err
}

// RunTaskCreated runs TaskCreated hooks.
func (e *Engine) RunTaskCreated(ctx context.Context, taskID, subject string) error {
	_, err := e.runEvent(ctx, EventTaskCreated, &HookInput{
		Event: EventTaskCreated,
		Extra: map[string]interface{}{"task_id": taskID, "subject": subject},
	}, "")
	return err
}

// RunTaskCompleted runs TaskCompleted hooks.
func (e *Engine) RunTaskCompleted(ctx context.Context, taskID, subject string) error {
	_, err := e.runEvent(ctx, EventTaskCompleted, &HookInput{
		Event: EventTaskCompleted,
		Extra: map[string]interface{}{"task_id": taskID, "subject": subject},
	}, "")
	return err
}

// RunWorktreeCreate runs WorktreeCreate hooks.
func (e *Engine) RunWorktreeCreate(ctx context.Context, path string) error {
	_, err := e.runEvent(ctx, EventWorktreeCreate, &HookInput{
		Event: EventWorktreeCreate,
		Extra: map[string]interface{}{"worktree_path": path},
	}, "")
	return err
}

// RunWorktreeRemove runs WorktreeRemove hooks.
func (e *Engine) RunWorktreeRemove(ctx context.Context, path string) error {
	_, err := e.runEvent(ctx, EventWorktreeRemove, &HookInput{
		Event: EventWorktreeRemove,
		Extra: map[string]interface{}{"worktree_path": path},
	}, "")
	return err
}

// RunUserPromptSubmit runs UserPromptSubmit hooks.
func (e *Engine) RunUserPromptSubmit(ctx context.Context, promptText string) (*AggregatedResult, error) {
	return e.runEvent(ctx, EventUserPromptSubmit, &HookInput{
		Event: EventUserPromptSubmit,
		Extra: map[string]interface{}{"prompt": promptText},
	}, "")
}

// RunFileChanged runs FileChanged hooks.
func (e *Engine) RunFileChanged(ctx context.Context, path string) error {
	_, err := e.runEvent(ctx, EventFileChanged, &HookInput{
		Event: EventFileChanged,
		Extra: map[string]interface{}{"path": path},
	}, "")
	return err
}

// RunGeneric runs hooks for any event type with arbitrary extra data.
func (e *Engine) RunGeneric(ctx context.Context, event string, extra map[string]interface{}) (*AggregatedResult, error) {
	return e.runEvent(ctx, event, &HookInput{
		Event: event,
		Extra: extra,
	}, "")
}

// ---------------------------------------------------------------------------
// Internal execution
// ---------------------------------------------------------------------------

// runEvent dispatches to all matching hooks for the given event.
func (e *Engine) runEvent(ctx context.Context, event string, input *HookInput, toolName string) (*AggregatedResult, error) {
	hooks := e.collectHooks(event, toolName)
	if len(hooks) == 0 {
		return nil, nil
	}

	agg := &AggregatedResult{}

	for _, rh := range hooks {
		// Check once-tracking
		if rh.def.Once {
			key := rh.onceKey()
			e.mu.Lock()
			if e.onceFired[key] {
				e.mu.Unlock()
				continue
			}
			e.onceFired[key] = true
			e.mu.Unlock()
		}

		// Async hooks run in a goroutine and don't block.
		// NOTE: Uses context.Background() intentionally — async hooks should complete
		// even if the triggering operation finishes. They are bounded by their own
		// timeout. A session-level context could be used to cancel on shutdown.
		if rh.def.Async {
			go func(h resolvedHook) {
				asyncCtx, cancel := context.WithTimeout(context.Background(), h.timeout())
				defer cancel()
				_, _ = e.executeHook(asyncCtx, h, input)
			}(rh)
			continue
		}

		// Synchronous execution
		out, err := e.executeHook(ctx, rh, input)
		if err != nil {
			log.Printf("hook error (%s/%s): %v", event, rh.describe(), err)
			continue
		}
		if out == nil {
			continue
		}

		// Merge into aggregated result
		mergeOutput(agg, out, rh)

		// If this hook explicitly stops continuation, break early
		if out.Continue != nil && !*out.Continue {
			agg.PreventContinue = true
			if out.StopReason != "" {
				agg.StopReason = out.StopReason
			}
			break
		}
	}

	return agg, nil
}

// resolvedHook is a hook definition matched to a specific event+matcher.
type resolvedHook struct {
	event      string
	matcherIdx int
	hookIdx    int
	matcher    string
	def        HookDef
}

func (h resolvedHook) onceKey() string {
	return fmt.Sprintf("%s|%s|%d", h.event, h.matcher, h.hookIdx)
}

func (h resolvedHook) timeout() time.Duration {
	if h.def.Timeout > 0 {
		return time.Duration(h.def.Timeout) * time.Second
	}
	return 10 * time.Second
}

func (h resolvedHook) describe() string {
	if h.def.Command != "" {
		return h.def.Command
	}
	if h.def.URL != "" {
		return h.def.URL
	}
	return "unknown"
}

// collectHooks gathers all hooks that match the event and optional tool name.
func (e *Engine) collectHooks(event, toolName string) []resolvedHook {
	var hooks []resolvedHook

	// New-format hooks (event → matcher groups)
	if groups, ok := e.config.Hooks[event]; ok {
		for mi, g := range groups {
			if g.Matcher != "" && toolName != "" && !matchPattern(g.Matcher, toolName) {
				continue
			}
			for hi, h := range g.Hooks {
				if h.If != "" && !matchIfCondition(h.If, toolName) {
					continue
				}
				hooks = append(hooks, resolvedHook{
					event:      event,
					matcherIdx: mi,
					hookIdx:    hi,
					matcher:    g.Matcher,
					def:        h,
				})
			}
		}
	}

	// Legacy hooks (flat array with events list)
	for i, lh := range e.config.LegacyHooks {
		if !matchesEvent(lh.Events, event) {
			continue
		}
		hooks = append(hooks, resolvedHook{
			event:   event,
			hookIdx: i,
			matcher: "__legacy__",
			def: HookDef{
				Type:    HookTypeCommand,
				Command: lh.Command,
				Timeout: lh.Timeout,
			},
		})
	}

	return hooks
}

// executeHook runs a single hook definition and returns its output.
func (e *Engine) executeHook(ctx context.Context, rh resolvedHook, input *HookInput) (*HookOutput, error) {
	hookCtx, cancel := context.WithTimeout(ctx, rh.timeout())
	defer cancel()

	switch rh.def.Type {
	case HookTypeHTTP:
		return e.executeHTTPHook(hookCtx, rh.def, input)
	default: // HookTypeCommand or empty (default to command)
		return e.executeCommandHook(hookCtx, rh.def, input)
	}
}

// executeCommandHook runs a shell command hook.
func (e *Engine) executeCommandHook(ctx context.Context, def HookDef, input *HookInput) (*HookOutput, error) {
	inputJSON, _ := json.Marshal(input)

	// ctx already carries the timeout from executeHook (via context.WithTimeout).
	// No need for a second timeout here.
	cmd := exec.CommandContext(ctx, "sh", "-c", def.Command)
	cmd.Dir = e.workdir
	cmd.Stdin = bytes.NewReader(inputJSON)

	// Pass hook input as environment variable too.
	// SECURITY: Tool names from MCP servers are untrusted and may contain shell
	// metacharacters. Sanitize before setting as env vars to prevent command
	// injection if a user's hook command uses $HOOK_TOOL_NAME unquoted.
	cmd.Env = append(os.Environ(),
		"HOOK_EVENT="+sanitizeEnvValue(input.Event),
		"HOOK_TOOL_NAME="+sanitizeEnvValue(input.ToolName),
	)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		// Non-zero exit code — treat as hook failure but don't block
		return nil, fmt.Errorf("hook command failed: %w (stderr: %s)", err, stderr.String())
	}

	if stdout.Len() == 0 {
		return nil, nil // No output = no opinion
	}

	var output HookOutput
	if err := json.Unmarshal(stdout.Bytes(), &output); err != nil {
		return nil, fmt.Errorf("invalid hook JSON output: %w", err)
	}

	return &output, nil
}

// executeHTTPHook sends hook input as POST to a URL.
func (e *Engine) executeHTTPHook(ctx context.Context, def HookDef, input *HookInput) (*HookOutput, error) {
	inputJSON, _ := json.Marshal(input)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, def.URL, bytes.NewReader(inputJSON))
	if err != nil {
		return nil, fmt.Errorf("create HTTP hook request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range def.Headers {
		// Expand environment variables in header values
		expanded := os.ExpandEnv(v)
		req.Header.Set(k, expanded)
	}

	hookClient := &http.Client{Timeout: 30 * time.Second}
	resp, err := hookClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HTTP hook request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1MB limit
	if err != nil {
		return nil, fmt.Errorf("read HTTP hook response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP hook returned status %d: %s", resp.StatusCode, string(body))
	}

	if len(body) == 0 {
		return nil, nil
	}

	var output HookOutput
	if err := json.Unmarshal(body, &output); err != nil {
		return nil, fmt.Errorf("invalid HTTP hook JSON response: %w", err)
	}

	return &output, nil
}

// ---------------------------------------------------------------------------
// Env var sanitization
// ---------------------------------------------------------------------------

// sanitizeEnvValue strips characters that could enable shell injection when the
// value is used in an unquoted shell expansion (e.g., $HOOK_TOOL_NAME).
// Allows alphanumerics, underscores, hyphens, dots, colons, slashes, and spaces.
// All other characters (;, |, &, `, $, etc.) are replaced with underscores.
func sanitizeEnvValue(s string) string {
	var sb strings.Builder
	sb.Grow(len(s))
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') ||
			r == '_' || r == '-' || r == '.' || r == ':' || r == '/' || r == ' ' || r == '@' {
			sb.WriteRune(r)
		} else {
			sb.WriteRune('_')
		}
	}
	return sb.String()
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

// matchPattern does simple glob matching for tool names.
// Supports: exact match, "*" wildcard prefix/suffix.
func matchPattern(pattern, value string) bool {
	if pattern == "" || pattern == "*" {
		return true
	}
	if pattern == value {
		return true
	}
	// Simple prefix/suffix wildcard
	if strings.HasSuffix(pattern, "*") {
		return strings.HasPrefix(value, strings.TrimSuffix(pattern, "*"))
	}
	if strings.HasPrefix(pattern, "*") {
		return strings.HasSuffix(value, strings.TrimPrefix(pattern, "*"))
	}
	return false
}

// matchIfCondition checks the "if" field against the tool name.
// Format: "ToolName(pattern)" e.g. "Bash(git *)"
func matchIfCondition(condition, toolName string) bool {
	if condition == "" {
		return true
	}

	// Parse "ToolName(args)" format
	parenIdx := strings.Index(condition, "(")
	if parenIdx < 0 {
		// Just a tool name
		return matchPattern(condition, toolName)
	}

	condTool := condition[:parenIdx]
	if !matchPattern(condTool, toolName) {
		return false
	}

	// Has argument pattern — for now, accept if tool matches.
	// Full argument matching would require access to parsed tool input.
	// NOTE: The argument portion (e.g., "git *" in "Bash(git *)") is currently
	// ignored. The hook fires for ALL invocations of the matched tool name.
	log.Printf("warning: hook `if` condition %q has an argument pattern that is not yet evaluated — matching on tool name only", condition)
	return true
}

func matchesEvent(events []string, target string) bool {
	for _, e := range events {
		if e == target {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Result aggregation
// ---------------------------------------------------------------------------

func mergeOutput(agg *AggregatedResult, out *HookOutput, rh resolvedHook) {
	if out.AdditionalContext != "" {
		agg.AdditionalContexts = append(agg.AdditionalContexts, out.AdditionalContext)
	}
	if out.PermissionDecision != "" && agg.PermissionDecision == "" {
		agg.PermissionDecision = out.PermissionDecision
		agg.PermissionReason = out.DenyMessage
		if agg.PermissionReason == "" {
			agg.PermissionReason = out.Reason
		}
	}
	if out.UpdatedInput != nil && agg.UpdatedInput == nil {
		agg.UpdatedInput = out.UpdatedInput
	}
	if out.UpdatedMCPToolOutput != nil && agg.UpdatedMCPOutput == nil {
		agg.UpdatedMCPOutput = out.UpdatedMCPToolOutput
	}
	if len(out.WatchPaths) > 0 {
		agg.WatchPaths = append(agg.WatchPaths, out.WatchPaths...)
	}
	if out.InitialUserMessage != "" && agg.InitialUserMessage == "" {
		agg.InitialUserMessage = out.InitialUserMessage
	}
	if out.Retry != nil && agg.Retry == nil {
		agg.Retry = out.Retry
	}

	// Decision field (for PermissionRequest hooks)
	if out.Decision == "block" || (out.Continue != nil && !*out.Continue) {
		msg := out.StopReason
		if msg == "" {
			msg = out.Reason
		}
		if msg == "" {
			msg = "Hook blocked execution"
		}
		agg.BlockingErrors = append(agg.BlockingErrors, BlockingError{
			Command: rh.describe(),
			Message: msg,
		})
	}
}

// aggregateToLegacyOutput converts an AggregatedResult back to the legacy HookOutput
// for backward compatibility with existing runner code.
func aggregateToLegacyOutput(agg *AggregatedResult) *HookOutput {
	if agg == nil {
		return nil
	}

	out := &HookOutput{
		PermissionDecision: agg.PermissionDecision,
		UpdatedInput:       agg.UpdatedInput,
		DenyMessage:        agg.PermissionReason,
	}

	if len(agg.AdditionalContexts) > 0 {
		out.AdditionalContext = strings.Join(agg.AdditionalContexts, "\n")
	}

	if agg.PreventContinue {
		f := false
		out.Continue = &f
	}

	if agg.StopReason != "" {
		out.StopReason = agg.StopReason
	}

	return out
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

// LoadConfig loads hook configuration from .claude/hooks.json or settings.json in the workdir.
func LoadConfig(workdir string) Config {
	// Try .claude/hooks.json first (new dedicated hook file)
	path := filepath.Join(workdir, ".claude", "hooks.json")
	data, err := os.ReadFile(path)
	if err == nil {
		return ParseConfig(data)
	}

	// Try .claude/settings.json "hooks" key
	settingsPath := filepath.Join(workdir, ".claude", "settings.json")
	data, err = os.ReadFile(settingsPath)
	if err == nil {
		var settings struct {
			Hooks json.RawMessage `json:"hooks"`
		}
		if json.Unmarshal(data, &settings) == nil && len(settings.Hooks) > 0 {
			return ParseConfig(settings.Hooks)
		}
	}

	// Try .chatml/config.json "hooks" key (ChatML-specific)
	chatmlPath := filepath.Join(workdir, ".chatml", "config.json")
	data, err = os.ReadFile(chatmlPath)
	if err == nil {
		var chatmlCfg struct {
			Hooks json.RawMessage `json:"hooks"`
		}
		if json.Unmarshal(data, &chatmlCfg) == nil && len(chatmlCfg.Hooks) > 0 {
			return ParseConfig(chatmlCfg.Hooks)
		}
	}

	return Config{}
}

// LoadUserConfig loads hook configuration from the user's home directory.
func LoadUserConfig() Config {
	home, err := os.UserHomeDir()
	if err != nil {
		return Config{}
	}

	// Try ~/.claude/settings.json "hooks" key
	path := filepath.Join(home, ".claude", "settings.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}
	}

	var settings struct {
		Hooks json.RawMessage `json:"hooks"`
	}
	if json.Unmarshal(data, &settings) == nil && len(settings.Hooks) > 0 {
		return ParseConfig(settings.Hooks)
	}

	return Config{}
}
