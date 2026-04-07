package permission

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// saveRuleMu serializes writes to the settings file to prevent TOCTOU races
// when multiple goroutines call SaveRule concurrently (e.g., from RecordApproval).
var saveRuleMu sync.Mutex

// RuleSource identifies where a permission rule originates.
// Higher-priority sources override lower-priority ones.
type RuleSource int

const (
	SourcePolicy  RuleSource = iota // Organization/MDM policy (highest priority)
	SourceUser                      // User-level settings (~/.claude/settings.json)
	SourceProject                   // Project-level settings (.claude/settings.json)
	SourceLocal                     // Local settings (.claude/settings.local.json)
	SourceFlag                      // CLI flag (--allow, --deny)
	SourceCLIArg                    // CLI argument
	SourceSession                   // Runtime session rule
)

// Rule represents a persistent permission rule loaded from configuration.
type Rule struct {
	Tool      string     `json:"tool"`               // Tool name (e.g., "Bash", "Write")
	Specifier string     `json:"specifier,omitempty"` // Optional content pattern (e.g., "npm run *")
	Content   string     `json:"content,omitempty"`   // Optional substring match on tool input content
	Action    string     `json:"action"`              // "allow", "deny", or "ask"
	Source    RuleSource `json:"source,omitempty"`     // Where this rule came from
}

// ParsePermissionRule parses Claude Code's permission rule syntax.
// Format: "ToolName" or "ToolName(pattern)" e.g. "Bash(git *)", "Write(*.ts)"
func ParsePermissionRule(ruleStr string) Rule {
	ruleStr = strings.TrimSpace(ruleStr)
	if ruleStr == "" {
		return Rule{}
	}

	parenIdx := strings.Index(ruleStr, "(")
	if parenIdx < 0 {
		return Rule{Tool: ruleStr}
	}

	toolName := ruleStr[:parenIdx]
	// Extract pattern between parens
	closeIdx := strings.LastIndex(ruleStr, ")")
	if closeIdx <= parenIdx {
		return Rule{Tool: toolName}
	}
	pattern := ruleStr[parenIdx+1 : closeIdx]

	return Rule{
		Tool:      toolName,
		Specifier: pattern,
	}
}

// RuleSet holds persistent rules and provides evaluation.
type RuleSet struct {
	mu    sync.RWMutex
	rules []Rule
}

// NewRuleSet creates a RuleSet from a slice of rules.
func NewRuleSet(rules []Rule) *RuleSet {
	if rules == nil {
		rules = []Rule{}
	}
	return &RuleSet{rules: rules}
}

// AddRule appends a rule to the set. Thread-safe.
func (rs *RuleSet) AddRule(r Rule) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	rs.rules = append(rs.rules, r)
}

// AddRules appends multiple rules. Thread-safe.
func (rs *RuleSet) AddRules(rules []Rule) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	rs.rules = append(rs.rules, rules...)
}

// LoadRulesFromFile loads rules from a JSON file.
// Returns an empty RuleSet (no error) if the file does not exist.
func LoadRulesFromFile(path string) (*RuleSet, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return NewRuleSet(nil), nil
		}
		return nil, err
	}

	var rules []Rule
	if err := json.Unmarshal(data, &rules); err != nil {
		return nil, err
	}

	return NewRuleSet(rules), nil
}

// LoadRulesFromSettings loads allow/deny/ask rules from a Claude Code-style settings file.
// Settings format: { "permissions": { "allow": ["Bash(git *)"], "deny": ["Write(*.env)"], "ask": [...] } }
func LoadRulesFromSettings(path string, source RuleSource) (*RuleSet, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return NewRuleSet(nil), nil
		}
		return nil, err
	}

	var settings struct {
		Permissions struct {
			Allow []string `json:"allow"`
			Deny  []string `json:"deny"`
			Ask   []string `json:"ask"`
		} `json:"permissions"`
	}
	if err := json.Unmarshal(data, &settings); err != nil {
		log.Printf("permission: invalid JSON in %s, ignoring rules: %v", path, err)
		return NewRuleSet(nil), nil
	}

	var rules []Rule
	for _, ruleStr := range settings.Permissions.Allow {
		r := ParsePermissionRule(ruleStr)
		r.Action = "allow"
		r.Source = source
		rules = append(rules, r)
	}
	for _, ruleStr := range settings.Permissions.Deny {
		r := ParsePermissionRule(ruleStr)
		r.Action = "deny"
		r.Source = source
		rules = append(rules, r)
	}
	for _, ruleStr := range settings.Permissions.Ask {
		r := ParsePermissionRule(ruleStr)
		r.Action = "ask"
		r.Source = source
		rules = append(rules, r)
	}

	return NewRuleSet(rules), nil
}

// LoadMultiSourceRules loads rules from all standard locations and merges them.
// Priority (highest first): policy > user > project > local
func LoadMultiSourceRules(workdir string) *RuleSet {
	merged := NewRuleSet(nil)

	// 1. Policy rules (managed settings, highest priority)
	// Platform-specific: /Library/Application Support/ClaudeCode/managed-settings.json (macOS)
	// /etc/claude-code/managed-settings.json (Linux)
	// Skipped for now — enterprise feature (P2.4)

	// 2. User-level rules (~/.claude/settings.json)
	if home, err := os.UserHomeDir(); err == nil {
		userSettings := filepath.Join(home, ".claude", "settings.json")
		if rs, err := LoadRulesFromSettings(userSettings, SourceUser); err == nil {
			merged.AddRules(rs.rules)
		}
	}

	// 3. Project-level rules (.claude/settings.json)
	if workdir != "" {
		projectSettings := filepath.Join(workdir, ".claude", "settings.json")
		if rs, err := LoadRulesFromSettings(projectSettings, SourceProject); err == nil {
			merged.AddRules(rs.rules)
		}
	}

	// 4. Local rules (.claude/settings.local.json)
	if workdir != "" {
		localSettings := filepath.Join(workdir, ".claude", "settings.local.json")
		if rs, err := LoadRulesFromSettings(localSettings, SourceLocal); err == nil {
			merged.AddRules(rs.rules)
		}
	}

	return merged
}

// SaveRule persists a single rule to the user's settings file (for allow_always/deny_always).
// Serialized by saveRuleMu to prevent concurrent read-modify-write races.
func SaveRule(rule Rule) error {
	saveRuleMu.Lock()
	defer saveRuleMu.Unlock()

	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	settingsPath := filepath.Join(home, ".claude", "settings.json")

	// Read existing settings
	var settings map[string]interface{}
	if data, err := os.ReadFile(settingsPath); err == nil {
		json.Unmarshal(data, &settings) //nolint:errcheck
	}
	if settings == nil {
		settings = make(map[string]interface{})
	}

	// Get or create permissions section
	permsRaw, ok := settings["permissions"]
	if !ok {
		permsRaw = map[string]interface{}{}
	}
	perms, ok := permsRaw.(map[string]interface{})
	if !ok {
		perms = map[string]interface{}{}
	}

	// Build rule string in Claude Code format: "ToolName(pattern)" or "ToolName"
	ruleStr := rule.Tool
	if rule.Specifier != "" {
		ruleStr = rule.Tool + "(" + rule.Specifier + ")"
	}

	// Add to appropriate list
	listKey := rule.Action // "allow", "deny", or "ask"
	var existing []string
	if raw, ok := perms[listKey]; ok {
		if arr, ok := raw.([]interface{}); ok {
			for _, v := range arr {
				if s, ok := v.(string); ok {
					existing = append(existing, s)
				}
			}
		}
	}

	// Check for duplicates
	for _, s := range existing {
		if s == ruleStr {
			return nil // Already exists
		}
	}
	existing = append(existing, ruleStr)
	perms[listKey] = existing

	// Remove contradicting rules from the opposing action list.
	// e.g., when adding to "allow", remove matching entries from "deny" and vice versa.
	opposingKeys := []string{"allow", "deny", "ask"}
	for _, oppKey := range opposingKeys {
		if oppKey == listKey {
			continue
		}
		if raw, ok := perms[oppKey]; ok {
			if arr, ok := raw.([]interface{}); ok {
				filtered := make([]interface{}, 0, len(arr))
				for _, v := range arr {
					if s, ok := v.(string); ok && s == ruleStr {
						continue // Remove the contradicting rule
					}
					filtered = append(filtered, v)
				}
				if len(filtered) != len(arr) {
					perms[oppKey] = filtered
				}
			}
		}
	}

	settings["permissions"] = perms

	// Ensure directory exists
	os.MkdirAll(filepath.Dir(settingsPath), 0755) //nolint:errcheck

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(settingsPath, data, 0644)
}

// Evaluate checks all rules against a tool invocation.
// Evaluation order: deny rules first, then ask rules, then allow rules.
// First match within each tier wins. Returns "allow", "deny", "ask", or "" if no match.
func (rs *RuleSet) Evaluate(toolName, specifier string) string {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	// Evaluation checks deny before ask before allow (action-tier priority).
	// Within each tier, first match wins. Since LoadMultiSourceRules inserts
	// rules in user → project → local order, user rules take precedence
	// within the same action tier. Note: a project-level deny rule CAN
	// override a user-level allow rule because deny is checked first.
	// This is intentional: deny rules are always conservative.

	// Phase 1: Check deny rules
	for _, r := range rs.rules {
		if r.Action == "deny" && matchesRule(r, toolName, specifier) {
			return "deny"
		}
	}

	// Phase 2: Check ask rules
	for _, r := range rs.rules {
		if r.Action == "ask" && matchesRule(r, toolName, specifier) {
			return "ask"
		}
	}

	// Phase 3: Check allow rules
	for _, r := range rs.rules {
		if r.Action == "allow" && matchesRule(r, toolName, specifier) {
			return "allow"
		}
	}

	return ""
}

// Count returns the number of rules in the set.
func (rs *RuleSet) Count() int {
	rs.mu.RLock()
	defer rs.mu.RUnlock()
	return len(rs.rules)
}

// matchesRule checks whether a rule matches a given tool name and specifier.
func matchesRule(rule Rule, toolName, specifier string) bool {
	// Tool name must match exactly
	if rule.Tool != toolName {
		return false
	}

	// If the rule has a specifier, the specifier must match
	if rule.Specifier != "" {
		if specifier == "" {
			return false
		}
		if !WildcardMatch(rule.Specifier, specifier) {
			return false
		}
	}

	// If the rule has a content pattern, it must appear as a word boundary match
	// in the specifier — not a raw substring. This prevents "rm" from matching
	// "format", "firmware", etc. We check for the content surrounded by word
	// boundaries (start/end of string, space, or common shell separators).
	if rule.Content != "" {
		if specifier == "" {
			return false
		}
		if !containsWord(specifier, rule.Content) {
			return false
		}
	}

	return true
}

// containsWord checks if `word` appears in `s` as a whole word,
// bounded by start/end of string, spaces, or shell separators (|;&).
func containsWord(s, word string) bool {
	idx := 0
	for {
		pos := strings.Index(s[idx:], word)
		if pos < 0 {
			return false
		}
		pos += idx
		start := pos
		end := pos + len(word)

		startOk := start == 0 || isWordBoundary(s[start-1])
		endOk := end == len(s) || isWordBoundary(s[end])

		if startOk && endOk {
			return true
		}
		idx = pos + 1
		if idx >= len(s) {
			return false
		}
	}
}

func isWordBoundary(c byte) bool {
	return c == ' ' || c == '\t' || c == '|' || c == ';' || c == '&' || c == '/' || c == '\n'
}

// WildcardMatch performs glob-style matching with * wildcards.
// Uses a two-pointer backtracking algorithm (ReDoS-safe, O(n*m) worst case).
// A space before * acts as a word boundary — it prevents matching within a word.
// Ported from agent-runner/src/rules.ts wildcardMatch().
func WildcardMatch(pattern, value string) bool {
	// Exact match fast path
	if pattern == value {
		return true
	}

	// No wildcards — must be exact
	if !strings.Contains(pattern, "*") {
		return pattern == value
	}

	pi := 0 // pattern index
	vi := 0 // value index
	starPI := -1
	starVI := -1

	for vi < len(value) {
		if pi < len(pattern) && pattern[pi] == '*' {
			// Record star position for backtracking
			starPI = pi
			starVI = vi
			pi++
			continue
		}

		if pi < len(pattern) && (pattern[pi] == value[vi] || pattern[pi] == '?') {
			pi++
			vi++
			continue
		}

		// Mismatch — backtrack to last star
		if starPI >= 0 {
			// Check word boundary: if there's a space before the star in the pattern,
			// the star should not match within a word (space acts as boundary)
			pi = starPI + 1
			starVI++
			vi = starVI
			continue
		}

		// No star to backtrack to — mismatch
		return false
	}

	// Consume trailing stars in pattern
	for pi < len(pattern) && pattern[pi] == '*' {
		pi++
	}

	return pi == len(pattern)
}
