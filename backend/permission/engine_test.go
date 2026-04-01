package permission

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
)

func bashInput(cmd string) json.RawMessage {
	return json.RawMessage(`{"command":"` + cmd + `"}`)
}

func fileInput(path string) json.RawMessage {
	return json.RawMessage(`{"file_path":"` + path + `"}`)
}

// --- Mode tests ---

func TestEngine_BypassMode_AllowsEverything(t *testing.T) {
	e := NewEngine(ModeBypassPermissions, nil)
	result := e.Check("Bash", bashInput("rm -rf /"))
	assert.Equal(t, Allow, result.Decision)
}

func TestEngine_DefaultMode_ReadOnlyToolsAllowed(t *testing.T) {
	e := NewEngine(ModeDefault, nil)

	for _, tool := range []string{"Read", "Glob", "Grep", "TodoWrite", "AskUserQuestion", "ExitPlanMode", "EnterPlanMode"} {
		result := e.Check(tool, json.RawMessage(`{}`))
		assert.Equal(t, Allow, result.Decision, "expected %s to be allowed in default mode", tool)
	}
}

func TestEngine_DefaultMode_WriteToolNeedsApproval(t *testing.T) {
	e := NewEngine(ModeDefault, nil)
	result := e.Check("Write", fileInput("/src/main.go"))
	assert.Equal(t, NeedApproval, result.Decision)
}

func TestEngine_DefaultMode_BashNeedsApproval(t *testing.T) {
	e := NewEngine(ModeDefault, nil)
	result := e.Check("Bash", bashInput("ls"))
	assert.Equal(t, NeedApproval, result.Decision)
}

func TestEngine_DefaultMode_EditNeedsApproval(t *testing.T) {
	e := NewEngine(ModeDefault, nil)
	result := e.Check("Edit", fileInput("main.go"))
	assert.Equal(t, NeedApproval, result.Decision)
}

// --- Plan mode tests ---

func TestEngine_PlanMode_DeniesWriteTools(t *testing.T) {
	e := NewEngine(ModePlan, nil)
	e.prePlanMode = ModeDefault

	for _, tool := range []string{"Write", "Edit", "Bash", "NotebookEdit"} {
		result := e.Check(tool, json.RawMessage(`{}`))
		assert.Equal(t, Deny, result.Decision, "expected %s to be denied in plan mode", tool)
		assert.Contains(t, result.DenyMessage, "plan mode")
	}
}

func TestEngine_PlanMode_AllowsReadOnlyTools(t *testing.T) {
	e := NewEngine(ModePlan, nil)
	e.prePlanMode = ModeDefault

	result := e.Check("Read", json.RawMessage(`{"file_path":"main.go"}`))
	assert.Equal(t, Allow, result.Decision)
}

func TestEngine_PlanMode_UsesPrePlanModeForOtherChecks(t *testing.T) {
	e := NewEngine(ModePlan, nil)
	e.prePlanMode = ModeBypassPermissions

	// A non-plan-denied, non-read-only tool should use pre-plan mode
	result := e.Check("WebSearch", json.RawMessage(`{"query":"test"}`))
	assert.Equal(t, Allow, result.Decision) // bypass mode allows everything
}

func TestEngine_SetMode_SavesPrePlanMode(t *testing.T) {
	e := NewEngine(ModeDefault, nil)
	e.SetMode(ModePlan)
	assert.Equal(t, ModePlan, e.Mode())
	assert.Equal(t, ModeDefault, e.PrePlanMode())
}

func TestEngine_SetMode_DoesNotOverwritePrePlanIfAlreadyInPlan(t *testing.T) {
	e := NewEngine(ModeDefault, nil)
	e.SetMode(ModePlan)
	// Setting plan again should not overwrite prePlanMode
	e.SetMode(ModePlan)
	assert.Equal(t, ModeDefault, e.PrePlanMode())
}

// --- acceptEdits mode tests ---

func TestEngine_AcceptEdits_AllowsWriteEdit(t *testing.T) {
	e := NewEngine(ModeAcceptEdits, nil)

	for _, tool := range []string{"Write", "Edit", "NotebookEdit"} {
		result := e.Check(tool, json.RawMessage(`{}`))
		assert.Equal(t, Allow, result.Decision, "expected %s to be allowed in acceptEdits mode", tool)
	}
}

func TestEngine_AcceptEdits_BashNeedsApproval(t *testing.T) {
	e := NewEngine(ModeAcceptEdits, nil)
	result := e.Check("Bash", bashInput("ls"))
	assert.Equal(t, NeedApproval, result.Decision)
}

// --- dontAsk mode tests ---

func TestEngine_DontAsk_DeniesUnapproved(t *testing.T) {
	e := NewEngine(ModeDontAsk, nil)
	result := e.Check("Bash", bashInput("ls"))
	assert.Equal(t, Deny, result.Decision)
	assert.Contains(t, result.DenyMessage, "dontAsk")
}

func TestEngine_DontAsk_AllowsReadOnly(t *testing.T) {
	e := NewEngine(ModeDontAsk, nil)
	result := e.Check("Read", json.RawMessage(`{"file_path":"main.go"}`))
	assert.Equal(t, Allow, result.Decision)
}

func TestEngine_DontAsk_AllowsByRule(t *testing.T) {
	rules := NewRuleSet([]Rule{
		{Tool: "Bash", Specifier: "npm *", Action: "allow"},
	})
	e := NewEngine(ModeDontAsk, rules)
	result := e.Check("Bash", bashInput("npm install"))
	assert.Equal(t, Allow, result.Decision)
}

func TestEngine_DontAsk_DeniesNotInRule(t *testing.T) {
	rules := NewRuleSet([]Rule{
		{Tool: "Bash", Specifier: "npm *", Action: "allow"},
	})
	e := NewEngine(ModeDontAsk, rules)
	result := e.Check("Bash", bashInput("rm -rf /"))
	assert.Equal(t, Deny, result.Decision)
}

// --- First-party MCP tests ---

func TestEngine_FirstPartyMCP_AlwaysAllowed(t *testing.T) {
	e := NewEngine(ModeDefault, nil)
	result := e.Check("mcp__chatml__get_status", json.RawMessage(`{}`))
	assert.Equal(t, Allow, result.Decision)
}

func TestEngine_ThirdPartyMCP_NeedsApproval(t *testing.T) {
	e := NewEngine(ModeDefault, nil)
	result := e.Check("mcp__external__tool", json.RawMessage(`{}`))
	assert.Equal(t, NeedApproval, result.Decision)
}

// --- Session approvals tests ---

func TestEngine_SessionApproval_Allow(t *testing.T) {
	e := NewEngine(ModeDefault, nil)

	// First check — needs approval
	result := e.Check("Bash", bashInput("ls"))
	assert.Equal(t, NeedApproval, result.Decision)

	// Record session approval
	e.RecordApproval(result.RuleKey, ApprovalResponse{Action: "allow_session"})

	// Second check — now allowed from session cache
	result = e.Check("Bash", bashInput("ls"))
	assert.Equal(t, Allow, result.Decision)
}

func TestEngine_SessionApproval_Deny(t *testing.T) {
	e := NewEngine(ModeDefault, nil)

	result := e.Check("Bash", bashInput("rm -rf /"))
	e.RecordApproval(result.RuleKey, ApprovalResponse{Action: "deny_always"})

	result = e.Check("Bash", bashInput("rm -rf /"))
	assert.Equal(t, Deny, result.Decision)
}

func TestEngine_SessionApproval_AllowOnceNotCached(t *testing.T) {
	e := NewEngine(ModeDefault, nil)

	result := e.Check("Bash", bashInput("ls"))
	e.RecordApproval(result.RuleKey, ApprovalResponse{Action: "allow_once"})

	// allow_once is not cached — should still need approval
	result = e.Check("Bash", bashInput("ls"))
	assert.Equal(t, NeedApproval, result.Decision)
}

func TestEngine_SessionApproval_ToolWide(t *testing.T) {
	e := NewEngine(ModeDefault, nil)

	// Approve "Bash" tool-wide (no specifier in key)
	e.RecordApproval("Bash", ApprovalResponse{Action: "allow_session"})

	// Any Bash command should now be allowed via tool-wide session approval
	result := e.Check("Bash", bashInput("npm test"))
	assert.Equal(t, Allow, result.Decision)
}

func TestEngine_ClearSession(t *testing.T) {
	e := NewEngine(ModeDefault, nil)

	result := e.Check("Bash", bashInput("ls"))
	e.RecordApproval(result.RuleKey, ApprovalResponse{Action: "allow_session"})

	// Verify cached
	result = e.Check("Bash", bashInput("ls"))
	assert.Equal(t, Allow, result.Decision)

	// Clear session
	e.ClearSession()

	// Should need approval again
	result = e.Check("Bash", bashInput("ls"))
	assert.Equal(t, NeedApproval, result.Decision)
}

// --- Persistent rules tests ---

func TestEngine_PersistentRuleDeny(t *testing.T) {
	rules := NewRuleSet([]Rule{
		{Tool: "Write", Specifier: ".env", Action: "deny"},
	})
	e := NewEngine(ModeDefault, rules)
	result := e.Check("Write", fileInput(".env"))
	assert.Equal(t, Deny, result.Decision)
}

func TestEngine_PersistentRuleAllow(t *testing.T) {
	rules := NewRuleSet([]Rule{
		{Tool: "Bash", Specifier: "npm *", Action: "allow"},
	})
	e := NewEngine(ModeDefault, rules)
	result := e.Check("Bash", bashInput("npm install"))
	assert.Equal(t, Allow, result.Decision)
}

func TestEngine_PersistentRuleDenyOverridesAllow(t *testing.T) {
	rules := NewRuleSet([]Rule{
		{Tool: "Bash", Action: "allow"},
		{Tool: "Bash", Specifier: "rm *", Action: "deny"},
	})
	e := NewEngine(ModeDefault, rules)

	result := e.Check("Bash", bashInput("rm -rf /"))
	assert.Equal(t, Deny, result.Decision)

	result = e.Check("Bash", bashInput("ls"))
	assert.Equal(t, Allow, result.Decision)
}

// --- Specifier + RuleKey tests ---

func TestEngine_CheckResult_Specifier(t *testing.T) {
	e := NewEngine(ModeDefault, nil)
	result := e.Check("Bash", bashInput("npm run build"))
	assert.Equal(t, "npm run build", result.Specifier)
	assert.Equal(t, "Bash:npm run build", result.RuleKey)
}

func TestEngine_CheckResult_NoSpecifier(t *testing.T) {
	e := NewEngine(ModeDefault, nil)
	result := e.Check("UnknownTool", json.RawMessage(`{}`))
	assert.Equal(t, "", result.Specifier)
	assert.Equal(t, "UnknownTool", result.RuleKey)
}

// --- Default mode constructor ---

func TestEngine_DefaultsToBypass(t *testing.T) {
	e := NewEngine("", nil)
	assert.Equal(t, ModeBypassPermissions, e.Mode())
}

func TestEngine_NilRulesOK(t *testing.T) {
	e := NewEngine(ModeDefault, nil)
	// Should not panic
	result := e.Check("Bash", bashInput("ls"))
	assert.Equal(t, NeedApproval, result.Decision)
}
