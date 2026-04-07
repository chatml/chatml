package permission

import (
	"encoding/json"
	"log"
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
	Action       string          // allow_once, allow_session, allow_always, deny_once, deny_always (allow_always persists to disk via SaveRule)
	Specifier    string          // Optional override specifier from frontend
	UpdatedInput json.RawMessage // User-edited input (only for allow actions)
}

// BatchApprovalResponse is the user's response to a batch approval request.
// Action applies to all tools in the batch (allow_once, allow_session, deny_once, etc.).
// PerTool overrides allow individual decisions; keys are tool use IDs.
type BatchApprovalResponse struct {
	Action  string                       // Default action for all tools
	PerTool map[string]ApprovalResponse  // Per-tool overrides (keyed by tool use ID)
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

// alwaysAllowedTools are tools that are always allowed regardless of mode.
var alwaysAllowedTools = map[string]bool{
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

	// Denial tracking: consecutive denials per tool trigger fallback to ask mode.
	// Protected by mu.
	denialCounts map[string]int

	// Denial limit: after this many consecutive denials for a tool,
	// the engine forces user prompting regardless of auto/classifier mode.
	denialLimit int
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
		mode = ModeDefault
	}
	return &Engine{
		mode:             mode,
		workdir:          workdir,
		rules:            rules,
		sessionApprovals: make(map[string]string),
		denialCounts:     make(map[string]int),
		denialLimit:      5, // Default: after 5 consecutive denials, force user prompt
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

	// 1.5. Safety checks for bypass mode: dangerous paths/commands require explicit
	// approval even when all other permissions are bypassed.
	// NOTE: There is a companion check at step 6.5 for non-bypass modes that runs
	// AFTER session cache and persistent rules. This split is intentional:
	// - In bypass mode: no session cache or rules are checked, so we must catch here.
	// - In other modes: session cache/rules may already allow the command, so we
	//   defer to step 6.5 (after those lookups) to avoid redundant prompts.
	// In bypass mode, catch dangerous file writes and commands here (before step 2 allows everything).
	// For non-bypass modes, companion checks at step 6.5 run AFTER session/rules lookups.
	if effectiveMode == ModeBypassPermissions {
		if writesToFile(toolName) && specifier != "" && IsDangerousPath(specifier) {
			result.Decision = NeedApproval
			return result
		}
	}
	if toolName == "Bash" && specifier != "" && IsDangerousCommandAST(specifier) {
		if effectiveMode == ModeBypassPermissions {
			result.Decision = NeedApproval
			return result
		}
	}

	// 2. Bypass mode: allow everything (safety checks already handled above)
	if effectiveMode == ModeBypassPermissions {
		result.Decision = Allow
		return result
	}

	// 3. Read-only tools: always allowed
	if alwaysAllowedTools[toolName] {
		result.Decision = Allow
		return result
	}

	// 4. First-party MCP tools: always allowed.
	// SECURITY: This relies on mcp.IsReservedServerName() preventing user-configured
	// MCP servers from using the "chatml" name. Without that validation, a malicious
	// server config could register tools as mcp__chatml__* and bypass all permission checks.
	if strings.HasPrefix(toolName, "mcp__chatml__") {
		result.Decision = Allow
		return result
	}

	// 5. Session approvals cache
	// NOTE: Session-approved dangerous commands (via allow_session) bypass the 6.5 safety
	// check for that session. This is by design — session approvals are explicit user decisions.
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

	// 6.5. Dangerous path/command checks for non-bypass modes. These are the
	// companions to step 1.5 and catch dangerous operations that were NOT already
	// allowed by session cache (step 5) or persistent rules (step 6).
	if writesToFile(toolName) && specifier != "" && IsDangerousPath(specifier) {
		result.Decision = NeedApproval
		return result
	}
	if toolName == "Bash" && specifier != "" && IsDangerousCommandAST(specifier) {
		result.Decision = NeedApproval
		return result
	}

	// 7. acceptEdits mode: auto-allow Write/Edit/NotebookEdit WITHIN working directory only
	if effectiveMode == ModeAcceptEdits && acceptEditsTools[toolName] {
		e.mu.RLock()
		workdir := e.workdir
		e.mu.RUnlock()

		// If specifier is empty (no file path), require approval rather than auto-allowing
		if specifier == "" {
			// Can't determine file path — fall through to NeedApproval
		} else if workdir == "" || IsWithinDirectory(specifier, workdir) {
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

	// Extract tool name from ruleKey for denial tracking
	toolName := ruleKey
	if idx := strings.Index(ruleKey, ":"); idx > 0 {
		toolName = ruleKey[:idx]
	}

	switch response.Action {
	case "allow_once":
		// Not cached, but reset denial counter
		e.denialCounts[toolName] = 0

	case "allow_session":
		e.sessionApprovals[ruleKey] = "allow"
		e.denialCounts[toolName] = 0

	case "allow_always":
		// Persist to user settings AND cache in session
		e.sessionApprovals[ruleKey] = "allow"
		e.denialCounts[toolName] = 0

		// Persist the rule to ~/.claude/settings.json (best-effort)
		rule := Rule{
			Tool:   toolName,
			Action: "allow",
			Source: SourceUser,
		}
		if response.Specifier != "" {
			rule.Specifier = response.Specifier
		} else if idx := strings.Index(ruleKey, ":"); idx > 0 {
			rule.Specifier = ruleKey[idx+1:]
		}
		// Fire-and-forget: don't block on I/O, but log errors
		go func() {
			if err := SaveRule(rule); err != nil {
				log.Printf("permission: failed to persist allow rule %s: %v", ruleKey, err)
			}
		}()

	case "deny_once":
		// Increment denial counter
		e.incrementDenialCount(toolName)

	case "deny_always":
		e.sessionApprovals[ruleKey] = "deny"

		// Persist to user settings
		rule := Rule{
			Tool:   toolName,
			Action: "deny",
			Source: SourceUser,
		}
		if response.Specifier != "" {
			rule.Specifier = response.Specifier
		} else if idx := strings.Index(ruleKey, ":"); idx > 0 {
			rule.Specifier = ruleKey[idx+1:]
		}
		go func() {
			if err := SaveRule(rule); err != nil {
				log.Printf("permission: failed to persist deny rule %s: %v", ruleKey, err)
			}
		}()
	}
}

// incrementDenialCount increments the consecutive denial counter for a tool.
// Must be called with mu held.
func (e *Engine) incrementDenialCount(toolName string) {
	e.denialCounts[toolName]++
}

// DenialCount returns the consecutive denial count for a tool. Thread-safe.
func (e *Engine) DenialCount(toolName string) int {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.denialCounts[toolName]
}

// ExceededDenialLimit returns true if a tool has been denied too many times consecutively.
func (e *Engine) ExceededDenialLimit(toolName string) bool {
	return e.DenialCount(toolName) >= e.denialLimit
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
