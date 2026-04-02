package permission

import (
	"encoding/json"
	"strings"
	"sync"
)

// Decision is the result of a permission check.
type Decision int

const (
	// Allow means the tool call should be executed.
	Allow Decision = iota
	// Deny means the tool call should be blocked.
	Deny
	// NeedApproval means the user must approve/deny the tool call.
	NeedApproval
)

// CheckResult contains the full permission decision details.
type CheckResult struct {
	Decision    Decision
	DenyMessage string // Set when Decision == Deny
	Specifier   string // Computed specifier for the tool call
	RuleKey     string // "ToolName" or "ToolName:specifier" — used for session caching
}

// ApprovalResponse is what the user sends back for a tool approval request.
type ApprovalResponse struct {
	Action       string          // allow_once, allow_session, allow_always, deny_once, deny_always
	Specifier    string          // Optional override specifier from frontend
	UpdatedInput json.RawMessage // User-edited input (only for allow actions)
}

// Permission mode constants.
const (
	ModeDefault           = "default"
	ModeAcceptEdits       = "acceptEdits"
	ModeBypassPermissions = "bypassPermissions"
	ModePlan              = "plan"
	ModeDontAsk           = "dontAsk"
)

// Tools that are denied in plan mode (they modify state).
var planModeDeniedTools = map[string]bool{
	"Write":      true,
	"Edit":       true,
	"Bash":       true,
	"NotebookEdit": true,
}

// Read-only tools that are always allowed regardless of mode.
var readOnlyTools = map[string]bool{
	"Read":             true,
	"Glob":             true,
	"Grep":             true,
	"TodoWrite":        true,
	"AskUserQuestion":  true,
	"ExitPlanMode":     true,
	"EnterPlanMode":    true,
	"EnterWorktree":    true,
	"ExitWorktree":     true,
}

// Tools auto-allowed in acceptEdits mode.
var acceptEditsTools = map[string]bool{
	"Write":        true,
	"Edit":         true,
	"NotebookEdit": true,
}

// Engine evaluates permission decisions for tool calls.
type Engine struct {
	mu               sync.RWMutex
	mode             string
	prePlanMode      string
	workdir          string // Workspace root directory for acceptEdits gate
	rules            *RuleSet
	sessionApprovals map[string]string // ruleKey -> "allow" | "deny"
}

// NewEngine creates a permission engine with the given mode and rules.
func NewEngine(mode string, rules *RuleSet) *Engine {
	return NewEngineWithWorkdir(mode, rules, "")
}

// NewEngineWithWorkdir creates a permission engine with a workspace directory.
// The workdir is used to gate acceptEdits mode — only files within the workdir
// are auto-allowed.
func NewEngineWithWorkdir(mode string, rules *RuleSet, workdir string) *Engine {
	if rules == nil {
		rules = NewRuleSet(nil)
	}
	if mode == "" {
		mode = ModeBypassPermissions
	}
	return &Engine{
		mode:             mode,
		workdir:          workdir,
		rules:            rules,
		sessionApprovals: make(map[string]string),
	}
}

// SetMode changes the permission mode. Thread-safe.
func (e *Engine) SetMode(mode string) {
	e.mu.Lock()
	defer e.mu.Unlock()

	// If entering plan mode, save the current mode to restore later
	if mode == ModePlan && e.mode != ModePlan {
		e.prePlanMode = e.mode
	}

	e.mode = mode
}

// Mode returns the current permission mode. Thread-safe.
func (e *Engine) Mode() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.mode
}

// PrePlanMode returns the mode that was active before plan mode was entered.
func (e *Engine) PrePlanMode() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.prePlanMode
}

// Check evaluates whether a tool call should be allowed, denied, or needs approval.
func (e *Engine) Check(toolName string, input json.RawMessage) CheckResult {
	e.mu.RLock()
	mode := e.mode
	prePlanMode := e.prePlanMode
	e.mu.RUnlock()

	specifier := BuildSpecifier(toolName, input)
	ruleKey := toolName
	if specifier != "" {
		ruleKey = toolName + ":" + specifier
	}

	result := CheckResult{
		Specifier: specifier,
		RuleKey:   ruleKey,
	}

	// 1. Plan mode gate: deny state-modifying tools
	if mode == ModePlan && planModeDeniedTools[toolName] {
		result.Decision = Deny
		result.DenyMessage = "Tool denied in plan mode. Use ExitPlanMode to exit plan mode first."
		return result
	}

	// Determine effective mode (plan mode uses the pre-plan mode for other checks)
	effectiveMode := mode
	if mode == ModePlan {
		effectiveMode = prePlanMode
		if effectiveMode == "" {
			effectiveMode = ModeDefault
		}
	}

	// 1.5. Safety checks: dangerous PATHS require explicit approval even in bypass mode.
	// This MUST run before the bypass mode check.
	if writesToFile(toolName) && specifier != "" && IsDangerousPath(specifier) {
		result.Decision = NeedApproval
		return result
	}

	// 2. Bypass mode: allow everything (safety checks already handled above)
	if effectiveMode == ModeBypassPermissions {
		result.Decision = Allow
		return result
	}

	// 3. Read-only tools: always allowed
	if readOnlyTools[toolName] {
		result.Decision = Allow
		return result
	}

	// 4. First-party MCP tools: always allowed
	if strings.HasPrefix(toolName, "mcp__chatml__") {
		result.Decision = Allow
		return result
	}

	// 5. Session approvals cache
	e.mu.RLock()
	if action, ok := e.sessionApprovals[ruleKey]; ok {
		e.mu.RUnlock()
		if action == "allow" {
			result.Decision = Allow
		} else {
			result.Decision = Deny
			result.DenyMessage = "Tool denied by session rule"
		}
		return result
	}
	// Also check tool-wide session approval (without specifier)
	if specifier != "" {
		if action, ok := e.sessionApprovals[toolName]; ok {
			e.mu.RUnlock()
			if action == "allow" {
				result.Decision = Allow
			} else {
				result.Decision = Deny
				result.DenyMessage = "Tool denied by session rule"
			}
			return result
		}
	}
	e.mu.RUnlock()

	// 6. Persistent rules: deny -> ask -> allow
	ruleAction := e.rules.Evaluate(toolName, specifier)
	switch ruleAction {
	case "deny":
		result.Decision = Deny
		result.DenyMessage = "Tool denied by permission rule"
		return result
	case "allow":
		result.Decision = Allow
		return result
	case "ask":
		// Fall through to NeedApproval
	}

	// 6.5. Dangerous command detection: Bash commands that invoke interpreters,
	// network tools, or privilege escalation require approval if not already
	// allowed by session cache or persistent rules.
	if toolName == "Bash" && specifier != "" && IsDangerousCommand(specifier) {
		result.Decision = NeedApproval
		return result
	}

	// 7. acceptEdits mode: auto-allow Write/Edit/NotebookEdit WITHIN working directory only
	if effectiveMode == ModeAcceptEdits && acceptEditsTools[toolName] {
		e.mu.RLock()
		workdir := e.workdir
		e.mu.RUnlock()

		// If no workdir set, or file is within workdir, allow
		if workdir == "" || specifier == "" || IsWithinDirectory(specifier, workdir) {
			result.Decision = Allow
			return result
		}
		// File is outside workdir — fall through to NeedApproval
	}

	// 8. dontAsk mode: deny anything not already allowed by rules
	if effectiveMode == ModeDontAsk {
		result.Decision = Deny
		result.DenyMessage = "Tool not pre-approved (dontAsk mode)"
		return result
	}

	// 9. Default: need user approval
	result.Decision = NeedApproval
	return result
}

// RecordApproval records a user's approval decision into session state.
func (e *Engine) RecordApproval(ruleKey string, response ApprovalResponse) {
	e.mu.Lock()
	defer e.mu.Unlock()

	switch response.Action {
	case "allow_session":
		e.sessionApprovals[ruleKey] = "allow"
	case "deny_always":
		e.sessionApprovals[ruleKey] = "deny"
	// allow_once and deny_once are not cached
	// allow_always would need persistent storage (future)
	}
}

// ClearSession resets all session-scoped approvals.
func (e *Engine) ClearSession() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.sessionApprovals = make(map[string]string)
}

// writesToFile returns true if the tool modifies files (and thus the specifier is a file path).
func writesToFile(toolName string) bool {
	switch toolName {
	case "Write", "Edit", "NotebookEdit":
		return true
	default:
		return false
	}
}
