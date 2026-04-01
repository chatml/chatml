package permission

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- WildcardMatch tests ---

func TestWildcardMatch_ExactMatch(t *testing.T) {
	assert.True(t, WildcardMatch("npm run build", "npm run build"))
}

func TestWildcardMatch_NoWildcard_Mismatch(t *testing.T) {
	assert.False(t, WildcardMatch("npm run build", "npm run test"))
}

func TestWildcardMatch_TrailingStar(t *testing.T) {
	assert.True(t, WildcardMatch("npm run *", "npm run build"))
	assert.True(t, WildcardMatch("npm run *", "npm run test"))
	assert.True(t, WildcardMatch("npm run *", "npm run "))
}

func TestWildcardMatch_LeadingStar(t *testing.T) {
	assert.True(t, WildcardMatch("*.go", "main.go"))
	assert.True(t, WildcardMatch("*.go", ".go"))
	assert.False(t, WildcardMatch("*.go", "main.rs"))
}

func TestWildcardMatch_MiddleStar(t *testing.T) {
	assert.True(t, WildcardMatch("src/*.go", "src/main.go"))
	assert.False(t, WildcardMatch("src/*.go", "lib/main.go"))
}

func TestWildcardMatch_MultipleStar(t *testing.T) {
	assert.True(t, WildcardMatch("*/*", "src/main"))
	assert.True(t, WildcardMatch("*.*.go", "main.test.go"))
}

func TestWildcardMatch_StarMatchesEmpty(t *testing.T) {
	assert.True(t, WildcardMatch("*", ""))
	assert.True(t, WildcardMatch("*", "anything"))
}

func TestWildcardMatch_OnlyStar(t *testing.T) {
	assert.True(t, WildcardMatch("*", "npm run build"))
}

func TestWildcardMatch_EmptyPattern(t *testing.T) {
	assert.True(t, WildcardMatch("", ""))
	assert.False(t, WildcardMatch("", "notempty"))
}

func TestWildcardMatch_EmptyValue(t *testing.T) {
	assert.True(t, WildcardMatch("", ""))
	assert.True(t, WildcardMatch("*", ""))
	assert.False(t, WildcardMatch("a*", ""))
}

func TestWildcardMatch_ComplexPattern(t *testing.T) {
	assert.True(t, WildcardMatch("rm -rf *", "rm -rf /tmp/test"))
	assert.False(t, WildcardMatch("rm -rf *", "rm -f /tmp/test"))
}

// --- RuleSet tests ---

func TestRuleSet_Empty(t *testing.T) {
	rs := NewRuleSet(nil)
	assert.Equal(t, "", rs.Evaluate("Bash", "ls"))
	assert.Equal(t, 0, rs.Count())
}

func TestRuleSet_AllowRule(t *testing.T) {
	rs := NewRuleSet([]Rule{
		{Tool: "Bash", Specifier: "npm run *", Action: "allow"},
	})
	assert.Equal(t, "allow", rs.Evaluate("Bash", "npm run build"))
	assert.Equal(t, "", rs.Evaluate("Bash", "rm -rf /"))
}

func TestRuleSet_DenyRule(t *testing.T) {
	rs := NewRuleSet([]Rule{
		{Tool: "Bash", Specifier: "rm -rf *", Action: "deny"},
	})
	assert.Equal(t, "deny", rs.Evaluate("Bash", "rm -rf /"))
	assert.Equal(t, "", rs.Evaluate("Bash", "ls"))
}

func TestRuleSet_DenyOverridesAllow(t *testing.T) {
	rs := NewRuleSet([]Rule{
		{Tool: "Bash", Specifier: "*", Action: "allow"},
		{Tool: "Bash", Specifier: "rm *", Action: "deny"},
	})
	// Deny should take priority over allow
	assert.Equal(t, "deny", rs.Evaluate("Bash", "rm -rf /"))
	// Non-denied commands should still be allowed
	assert.Equal(t, "allow", rs.Evaluate("Bash", "ls"))
}

func TestRuleSet_AskRule(t *testing.T) {
	rs := NewRuleSet([]Rule{
		{Tool: "Bash", Specifier: "git push *", Action: "ask"},
	})
	assert.Equal(t, "ask", rs.Evaluate("Bash", "git push origin main"))
	assert.Equal(t, "", rs.Evaluate("Bash", "git status"))
}

func TestRuleSet_AskOverridesAllow(t *testing.T) {
	rs := NewRuleSet([]Rule{
		{Tool: "Bash", Specifier: "*", Action: "allow"},
		{Tool: "Bash", Specifier: "git push *", Action: "ask"},
	})
	assert.Equal(t, "ask", rs.Evaluate("Bash", "git push origin"))
	assert.Equal(t, "allow", rs.Evaluate("Bash", "ls"))
}

func TestRuleSet_ToolWideRule(t *testing.T) {
	rs := NewRuleSet([]Rule{
		{Tool: "Write", Action: "allow"},
	})
	assert.Equal(t, "allow", rs.Evaluate("Write", "/any/path"))
	assert.Equal(t, "allow", rs.Evaluate("Write", ""))
}

func TestRuleSet_NoSpecifierFromCall(t *testing.T) {
	rs := NewRuleSet([]Rule{
		{Tool: "Bash", Specifier: "npm *", Action: "allow"},
	})
	// No specifier from tool call — specifier-based rule should NOT match
	assert.Equal(t, "", rs.Evaluate("Bash", ""))
}

func TestRuleSet_DifferentTool(t *testing.T) {
	rs := NewRuleSet([]Rule{
		{Tool: "Bash", Action: "allow"},
	})
	assert.Equal(t, "", rs.Evaluate("Write", "/some/file"))
}

// --- LoadRulesFromFile tests ---

func TestLoadRulesFromFile_NonExistent(t *testing.T) {
	rs, err := LoadRulesFromFile("/nonexistent/path/rules.json")
	require.NoError(t, err)
	assert.Equal(t, 0, rs.Count())
}

func TestLoadRulesFromFile_Valid(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "rules.json")

	rules := []Rule{
		{Tool: "Bash", Specifier: "npm *", Action: "allow"},
		{Tool: "Write", Specifier: ".env", Action: "deny"},
	}
	data, _ := json.Marshal(rules)
	os.WriteFile(path, data, 0644)

	rs, err := LoadRulesFromFile(path)
	require.NoError(t, err)
	assert.Equal(t, 2, rs.Count())
	assert.Equal(t, "allow", rs.Evaluate("Bash", "npm install"))
	assert.Equal(t, "deny", rs.Evaluate("Write", ".env"))
}

func TestLoadRulesFromFile_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "rules.json")
	os.WriteFile(path, []byte(`{bad json`), 0644)

	_, err := LoadRulesFromFile(path)
	assert.Error(t, err)
}
