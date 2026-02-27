package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/chatml/chatml-backend/logger"
)

// AgentDef represents a programmatic agent definition passed to the SDK.
// See https://platform.claude.com/docs/en/agent-sdk/subagents
type AgentDef struct {
	Description string   `json:"description"`
	Tools       []string `json:"tools,omitempty"`
	McpServers  []string `json:"mcpServers,omitempty"`
	Model       string   `json:"model,omitempty"`
	MaxTurns    int      `json:"maxTurns,omitempty"`
	Prompt      string   `json:"prompt"`
}

// AvailableAgent describes a built-in agent for the settings UI.
type AvailableAgent struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Model          string   `json:"model"`
	Tools          []string `json:"tools"`
	EnabledDefault bool     `json:"enabledDefault"`
}

// DefaultEnabledAgents is the set of agents enabled by default for new workspaces.
var DefaultEnabledAgents = []string{"explore", "test-runner", "self-review", "pr-prep", "commit-prep"}

// AvailableAgents returns metadata about all built-in agents for the settings UI.
func AvailableAgents() []AvailableAgent {
	defaultSet := make(map[string]bool, len(DefaultEnabledAgents))
	for _, name := range DefaultEnabledAgents {
		defaultSet[name] = true
	}

	var agents []AvailableAgent
	for _, name := range agentOrder {
		def := builtinAgentTemplates[name]
		agents = append(agents, AvailableAgent{
			Name:           name,
			Description:    def.Description,
			Model:          def.Model,
			Tools:          def.Tools,
			EnabledDefault: defaultSet[name],
		})
	}
	return agents
}

// agentOrder defines the display order for agents in the settings UI.
var agentOrder = []string{"explore", "test-runner", "self-review", "security-audit", "pr-prep", "commit-prep"}

// builtinAgentTemplates contains all built-in agent definitions.
// Prompts use %TARGET_BRANCH% as a placeholder for the session's target branch.
var builtinAgentTemplates = map[string]AgentDef{
	"explore": {
		Description: "Fast codebase exploration agent for understanding code structure, finding files, and answering questions about the codebase. Use this for quick searches and initial orientation.",
		Tools:       []string{"Read", "Glob", "Grep"},
		Model:       "haiku",
		MaxTurns:    15,
		Prompt:      "You are a fast codebase explorer. Find files, read code, and answer questions about the codebase structure. Be concise and direct. Return specific file paths and line numbers.",
	},
	"test-runner": {
		Description: "Test runner agent. Use after making code changes to run the project's test suite, analyze any failures, and fix them. Delegates the run-fix-rerun cycle to a focused agent.",
		Tools:       []string{"Read", "Glob", "Grep", "Bash", "Edit"},
		Model:       "sonnet",
		MaxTurns:    30,
		Prompt: `You are a test execution specialist. Your job is to run tests and fix failures.

Steps:
1. Identify the project's test command (look for package.json scripts, Makefile targets, pytest, go test, etc.)
2. Run the full test suite
3. If tests pass, report success with a summary
4. If tests fail, analyze each failure:
   - Read the failing test to understand what it expects
   - Read the implementation code to find the bug
   - Fix the implementation (prefer fixing code over fixing tests unless the test is wrong)
   - Re-run the specific failing test to verify the fix
5. Once all tests pass, report the final summary

Never skip or disable failing tests. Fix the root cause.`,
	},
	"self-review": {
		Description: "Code review agent. Use after completing implementation to review all changes before creating a PR. Leaves inline review comments visible in the ChatML UI.",
		Tools:       []string{"Read", "Glob", "Grep", "WebSearch"},
		McpServers:  []string{"chatml"},
		Model:       "opus",
		Prompt: `You are a senior code reviewer. Review all changes in this session's branch compared to the target branch (%TARGET_BRANCH%).

Use mcp__chatml__get_workspace_diff with detailed: true to see all changes.

For each file changed, check for:
- Bugs, logic errors, unhandled edge cases
- Security vulnerabilities (injection, auth bypass, data exposure)
- Missing error handling at system boundaries
- Performance issues (N+1 queries, unbounded loops, memory leaks)
- Code style inconsistencies with the rest of the codebase
- Leftover debug code (console.log, TODO, FIXME, debugger)

Use mcp__chatml__add_review_comment to leave inline comments on specific lines with appropriate severity (error, warning, suggestion, info).

At the end, provide a summary: what looks good, what needs attention, and whether this is ready for PR.`,
	},
	"security-audit": {
		Description: "Security audit agent. Use to perform a security-focused review of code changes, checking for OWASP Top 10 vulnerabilities, injection flaws, authentication issues, and data exposure risks.",
		Tools:       []string{"Read", "Glob", "Grep"},
		McpServers:  []string{"chatml"},
		Model:       "opus",
		MaxTurns:    20,
		Prompt: `You are a security auditor. Perform a thorough security review of all changes in this session.

Use mcp__chatml__get_workspace_diff with detailed: true to see all changes.

Check for OWASP Top 10 and common vulnerabilities:
- Injection (SQL, command, XSS, template)
- Broken authentication / authorization
- Sensitive data exposure (API keys, tokens, PII in logs)
- Security misconfiguration (permissive CORS, debug mode, default credentials)
- Insecure deserialization
- Insufficient input validation at system boundaries
- Dependency vulnerabilities (check for known CVEs in new dependencies)
- Path traversal and file inclusion
- Race conditions and TOCTOU bugs

Use mcp__chatml__add_review_comment with severity "error" for critical security issues and "warning" for potential risks.

Provide a security summary with risk assessment: critical/high/medium/low findings.`,
	},
	"pr-prep": {
		Description: "PR preparation agent. Use when implementation is complete and reviewed to create a well-documented pull request. Runs tests, checks for issues, and creates the PR with a comprehensive description.",
		Tools:       []string{"Read", "Glob", "Grep", "Bash", "WebSearch"},
		McpServers:  []string{"chatml"},
		Model:       "sonnet",
		Prompt: `You are a PR preparation specialist. Your job is to create a high-quality pull request targeting %TARGET_BRANCH%.

Steps:
1. Use mcp__chatml__get_workspace_diff to understand all changes
2. Run the project's test suite — if tests fail, report failures and STOP (do not create the PR)
3. Check for leftover debug code (console.log, print, debugger, TODO, FIXME, commented-out code)
4. Ensure all changes are committed with clear messages
5. Create the PR using gh pr create with --base %TARGET_BRANCH% and:
   - A concise title (under 70 chars) that describes the change
   - A thorough body with: Summary (what and why), Key Changes (bullet points), Test Plan
6. After creating the PR, ALWAYS call mcp__chatml__report_pr_created with the PR number and URL

If tests fail, report the failures and stop. Do not create a PR with failing tests.`,
	},
	"commit-prep": {
		Description: "Commit preparation agent. Use to review staged and unstaged changes and create clean, atomic commits with conventional commit messages (feat:, fix:, refactor:, etc.).",
		Tools:       []string{"Read", "Glob", "Grep", "Bash"},
		Model:       "haiku",
		MaxTurns:    10,
		Prompt: `You are a commit preparation specialist. Create clean, atomic commits.

Steps:
1. Run git status and git diff to see all changes
2. Group related changes into logical commits
3. For each commit:
   - Stage only the related files (git add specific files, never git add -A)
   - Write a conventional commit message: type(scope): description
   - Types: feat, fix, refactor, docs, test, chore, style, perf
   - Keep the subject line under 72 characters
   - Add a body if the change needs explanation
4. Verify with git log --oneline -5

Never commit .env files, credentials, or large binaries. Warn if you see them.`,
	},
}

// BuildAgentDefinitions builds the JSON agent definitions for a session,
// filtered by the workspace's enabled agents setting.
func BuildAgentDefinitions(ctx context.Context, getSetting func(ctx context.Context, key string) (string, bool, error), workspaceID, targetBranch string) string {
	// Load enabled agents from settings
	enabled := loadEnabledAgents(ctx, getSetting, workspaceID)
	if len(enabled) == 0 {
		return ""
	}

	// Fall back to origin/main if no target branch is configured
	if targetBranch == "" {
		targetBranch = "origin/main"
	}

	// Build definitions with session context injected
	agents := make(map[string]AgentDef, len(enabled))
	for _, name := range enabled {
		tmpl, ok := builtinAgentTemplates[name]
		if !ok {
			continue
		}
		// Inject session context into prompts
		def := tmpl
		def.Prompt = strings.ReplaceAll(def.Prompt, "%TARGET_BRANCH%", targetBranch)
		agents[name] = def
	}

	if len(agents) == 0 {
		return ""
	}

	data, err := json.Marshal(agents)
	if err != nil {
		logger.Manager.Errorf("Failed to marshal agent definitions: %v", err)
		return ""
	}
	return string(data)
}

// loadEnabledAgents reads the enabled agents list from workspace settings.
// Falls back to DefaultEnabledAgents if no setting exists.
func loadEnabledAgents(ctx context.Context, getSetting func(ctx context.Context, key string) (string, bool, error), workspaceID string) []string {
	key := fmt.Sprintf("enabled-agents:%s", workspaceID)
	value, found, err := getSetting(ctx, key)
	if err != nil || !found || value == "" {
		return DefaultEnabledAgents
	}

	var agents []string
	if err := json.Unmarshal([]byte(value), &agents); err != nil {
		logger.Manager.Errorf("Failed to parse enabled-agents setting: %v", err)
		return DefaultEnabledAgents
	}
	return agents
}
