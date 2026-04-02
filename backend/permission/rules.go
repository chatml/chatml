package permission

import (
	"encoding/json"
	"os"
	"strings"
)

// Rule represents a persistent permission rule loaded from configuration.
type Rule struct {
	Tool      string `json:"tool"`               // Tool name (e.g., "Bash", "Write")
	Specifier string `json:"specifier,omitempty"` // Optional content pattern (e.g., "npm run *")
	Content   string `json:"content,omitempty"`   // Optional substring match on tool input content
	Action    string `json:"action"`              // "allow", "deny", or "ask"
}

// RuleSet holds persistent rules and provides evaluation.
type RuleSet struct {
	rules []Rule
}

// NewRuleSet creates a RuleSet from a slice of rules.
func NewRuleSet(rules []Rule) *RuleSet {
	if rules == nil {
		rules = []Rule{}
	}
	return &RuleSet{rules: rules}
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

// Evaluate checks all rules against a tool invocation.
// Evaluation order: deny rules first, then ask rules, then allow rules.
// First match within each tier wins. Returns "allow", "deny", "ask", or "" if no match.
func (rs *RuleSet) Evaluate(toolName, specifier string) string {
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

	// If the rule has a content pattern, the specifier must contain it as a substring
	if rule.Content != "" {
		if specifier == "" {
			return false
		}
		if !strings.Contains(specifier, rule.Content) {
			return false
		}
	}

	return true
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
