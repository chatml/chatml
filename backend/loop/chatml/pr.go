package chatml

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"

	"github.com/chatml/chatml-core/tool"
)

var prURLPattern = regexp.MustCompile(`^https://github\.com/[^/]+/[^/]+/pull/\d+$`)

// --- report_pr_created ---

type reportPRCreatedTool struct {
	svc *Services
	ctx *ToolContext
}

func (t *reportPRCreatedTool) Name() string           { return "mcp__chatml__report_pr_created" }
func (t *reportPRCreatedTool) IsConcurrentSafe() bool { return true }
func (t *reportPRCreatedTool) DeferLoading() bool     { return true }
func (t *reportPRCreatedTool) Description() string {
	return "Report that a pull request was created for this session. Call after successfully creating a PR."
}
func (t *reportPRCreatedTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"prNumber": {"type": "number", "description": "The PR number"},
			"prUrl": {"type": "string", "description": "The full PR URL (https://github.com/owner/repo/pull/NNN)"}
		},
		"required": ["prNumber", "prUrl"]
	}`)
}

func (t *reportPRCreatedTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var params struct {
		PRNumber int    `json:"prNumber"`
		PRURL    string `json:"prUrl"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return tool.ErrorResult(fmt.Sprintf("invalid input: %v", err)), nil
	}
	if params.PRNumber <= 0 || params.PRURL == "" {
		return tool.ErrorResult("prNumber and prUrl are required"), nil
	}
	if !prURLPattern.MatchString(params.PRURL) {
		return tool.ErrorResult("prUrl must match https://github.com/owner/repo/pull/NNN"), nil
	}

	if t.svc.PRWatcher == nil {
		return tool.ErrorResult("PR tracking not yet initialized — please retry in a moment"), nil
	}
	t.svc.PRWatcher.RegisterPRFromAgent(t.ctx.SessionID, params.PRNumber, params.PRURL)

	return &tool.Result{Content: fmt.Sprintf("PR #%d reported and tracked: %s", params.PRNumber, params.PRURL)}, nil
}

// --- report_pr_merged ---

type reportPRMergedTool struct {
	svc *Services
	ctx *ToolContext
}

func (t *reportPRMergedTool) Name() string           { return "mcp__chatml__report_pr_merged" }
func (t *reportPRMergedTool) IsConcurrentSafe() bool { return true }
func (t *reportPRMergedTool) DeferLoading() bool     { return true }
func (t *reportPRMergedTool) Description() string {
	return "Report that a pull request was merged for this session."
}
func (t *reportPRMergedTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"prNumber": {"type": "number", "description": "The PR number that was merged (optional)"}
		}
	}`)
}

func (t *reportPRMergedTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	if t.svc.PRWatcher == nil {
		return tool.ErrorResult("PR tracking not yet initialized — please retry in a moment"), nil
	}
	t.svc.PRWatcher.ForceCheckSession(t.ctx.SessionID)
	return &tool.Result{Content: "PR merge reported. Session status will be updated."}, nil
}

// --- clear_pr_link ---

type clearPRLinkTool struct {
	svc *Services
	ctx *ToolContext
}

func (t *clearPRLinkTool) Name() string           { return "mcp__chatml__clear_pr_link" }
func (t *clearPRLinkTool) IsConcurrentSafe() bool { return true }
func (t *clearPRLinkTool) DeferLoading() bool     { return true }
func (t *clearPRLinkTool) Description() string {
	return "Clear the pull request link from this session."
}
func (t *clearPRLinkTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{"type": "object", "properties": {}}`)
}

func (t *clearPRLinkTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	if t.svc.PRWatcher == nil {
		return tool.ErrorResult("PR tracking not yet initialized — please retry in a moment"), nil
	}
	t.svc.PRWatcher.UnlinkPR(t.ctx.SessionID)
	return &tool.Result{Content: "PR link cleared from session."}, nil
}
