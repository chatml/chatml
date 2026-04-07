package hook

import "encoding/json"

// Event type constants matching Claude Code's hook event system.
// These are the events that hooks can subscribe to.
const (
	EventPreToolUse        = "PreToolUse"
	EventPostToolUse       = "PostToolUse"
	EventPostToolUseFail   = "PostToolUseFailure"
	EventNotification      = "Notification"
	EventUserPromptSubmit  = "UserPromptSubmit"
	EventSessionStart      = "SessionStart"
	EventSessionEnd        = "SessionEnd"
	EventStop              = "Stop"
	EventStopFailure       = "StopFailure"
	EventSubagentStart     = "SubagentStart"
	EventSubagentStop      = "SubagentStop"
	EventPreCompact        = "PreCompact"
	EventPostCompact       = "PostCompact"
	EventPermissionRequest = "PermissionRequest"
	EventPermissionDenied  = "PermissionDenied"
	EventSetup             = "Setup"
	EventTeammateIdle      = "TeammateIdle"
	EventTaskCreated       = "TaskCreated"
	EventTaskCompleted     = "TaskCompleted"
	EventElicitation       = "Elicitation"
	EventElicitationResult = "ElicitationResult"
	EventConfigChange      = "ConfigChange"
	EventWorktreeCreate    = "WorktreeCreate"
	EventWorktreeRemove    = "WorktreeRemove"
	EventInstructionsLoad  = "InstructionsLoaded"
	EventCwdChanged        = "CwdChanged"
	EventFileChanged       = "FileChanged"
)

// AllEvents is the canonical list of supported hook events.
var AllEvents = []string{
	EventPreToolUse, EventPostToolUse, EventPostToolUseFail,
	EventNotification, EventUserPromptSubmit,
	EventSessionStart, EventSessionEnd,
	EventStop, EventStopFailure,
	EventSubagentStart, EventSubagentStop,
	EventPreCompact, EventPostCompact,
	EventPermissionRequest, EventPermissionDenied,
	EventSetup, EventTeammateIdle,
	EventTaskCreated, EventTaskCompleted,
	EventElicitation, EventElicitationResult,
	EventConfigChange,
	EventWorktreeCreate, EventWorktreeRemove,
	EventInstructionsLoad, EventCwdChanged, EventFileChanged,
}

// HookType discriminates the execution strategy.
const (
	HookTypeCommand = "command" // Shell command
	HookTypeHTTP    = "http"   // HTTP POST webhook
)

// HookDef defines a single hook within a matcher group.
type HookDef struct {
	Type    string `json:"type"`              // "command" or "http"
	Command string `json:"command,omitempty"` // Shell command (type=command)

	// HTTP hook fields
	URL     string            `json:"url,omitempty"`     // URL to POST (type=http)
	Headers map[string]string `json:"headers,omitempty"` // Extra request headers

	// Common fields
	If            string `json:"if,omitempty"`            // Permission-rule filter (e.g. "Bash(git *)")
	Timeout       int    `json:"timeout,omitempty"`       // Seconds, default 10
	StatusMessage string `json:"statusMessage,omitempty"` // Spinner text while running
	Once          bool   `json:"once,omitempty"`          // Remove after first execution
	Async         bool   `json:"async,omitempty"`         // Run in background, don't block
}

// MatcherGroup pairs an optional tool-name matcher with one or more hooks.
type MatcherGroup struct {
	Matcher string    `json:"matcher,omitempty"` // Glob pattern for tool names (e.g. "Write", "Bash")
	Hooks   []HookDef `json:"hooks"`
}

// Config is the top-level hook configuration.
// The key is an event name (e.g. "PreToolUse"), the value is a list of matcher groups.
//
// Example:
//
//	{
//	  "PreToolUse": [
//	    { "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo $HOOK_INPUT" }] }
//	  ]
//	}
type Config struct {
	// Hooks maps event names to matcher groups.
	Hooks map[string][]MatcherGroup `json:"hooks,omitempty"`

	// Legacy flat array for backward compat with the original .claude/hooks.json format.
	LegacyHooks []LegacyHookConfig `json:"legacyHooks,omitempty"`
}

// LegacyHookConfig is the original flat format (command + events list).
// Kept for backward compatibility with existing .claude/hooks.json files.
type LegacyHookConfig struct {
	Command string   `json:"command"`
	Timeout int      `json:"timeout"` // seconds, default 10
	Events  []string `json:"events"`
}

// MergeConfigs combines multiple configs (e.g. from settings + file).
// Hooks from all configs are accumulated — later configs add to earlier ones,
// they do not override. All hooks for a given event will fire in order.
func MergeConfigs(configs ...Config) Config {
	merged := Config{
		Hooks: make(map[string][]MatcherGroup),
	}
	for _, c := range configs {
		for event, groups := range c.Hooks {
			merged.Hooks[event] = append(merged.Hooks[event], groups...)
		}
		merged.LegacyHooks = append(merged.LegacyHooks, c.LegacyHooks...)
	}
	return merged
}

// ParseConfig parses a hooks.json file that may be in the new or legacy format.
// New format: { "PreToolUse": [...], "PostToolUse": [...] }
// Legacy format: { "hooks": [ { "command": "...", "events": [...] } ] }
func ParseConfig(data []byte) Config {
	// Try new format first: top-level map of event → matcher groups
	var newFmt map[string][]MatcherGroup
	if err := json.Unmarshal(data, &newFmt); err == nil {
		// Validate that keys are known events
		valid := make(map[string][]MatcherGroup)
		for k, v := range newFmt {
			if isKnownEvent(k) {
				valid[k] = v
			}
		}
		if len(valid) > 0 {
			return Config{Hooks: valid}
		}
	}

	// Try legacy format: { "hooks": [...] }
	var legacyFmt struct {
		Hooks []LegacyHookConfig `json:"hooks"`
	}
	if err := json.Unmarshal(data, &legacyFmt); err == nil && len(legacyFmt.Hooks) > 0 {
		return Config{LegacyHooks: legacyFmt.Hooks}
	}

	return Config{}
}

func isKnownEvent(name string) bool {
	for _, e := range AllEvents {
		if e == name {
			return true
		}
	}
	return false
}
