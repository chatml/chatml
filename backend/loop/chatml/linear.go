package chatml

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/chatml/chatml-core/tool"
)

// --- get_linear_context ---

type getLinearContextTool struct {
	linear *LinearIssueState
}

func (t *getLinearContextTool) Name() string           { return "mcp__chatml__get_linear_context" }
func (t *getLinearContextTool) IsConcurrentSafe() bool { return true }
func (t *getLinearContextTool) DeferLoading() bool     { return true }
func (t *getLinearContextTool) Description() string {
	return "Get details about the current Linear issue being worked on."
}
func (t *getLinearContextTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{"type": "object", "properties": {}}`)
}

func (t *getLinearContextTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	issue := t.linear.Get()
	if issue == nil {
		return &tool.Result{Content: "No Linear issue is currently associated with this session."}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Issue: %s — %s\n", issue.Identifier, issue.Title))
	sb.WriteString(fmt.Sprintf("State: %s\n", issue.State))
	if issue.Description != "" {
		sb.WriteString(fmt.Sprintf("Description: %s\n", issue.Description))
	}
	if len(issue.Labels) > 0 {
		sb.WriteString(fmt.Sprintf("Labels: %s\n", strings.Join(issue.Labels, ", ")))
	}
	if issue.Assignee != "" {
		sb.WriteString(fmt.Sprintf("Assignee: %s\n", issue.Assignee))
	}
	if issue.Project != "" {
		sb.WriteString(fmt.Sprintf("Project: %s\n", issue.Project))
	}

	return &tool.Result{Content: sb.String()}, nil
}

// --- start_linear_issue ---

type startLinearIssueTool struct {
	linear *LinearIssueState
	ctx    *ToolContext
}

func (t *startLinearIssueTool) Name() string           { return "mcp__chatml__start_linear_issue" }
func (t *startLinearIssueTool) IsConcurrentSafe() bool { return true }
func (t *startLinearIssueTool) DeferLoading() bool     { return true }
func (t *startLinearIssueTool) Description() string {
	return "Start working on a Linear issue. Creates a git branch and associates the issue with the session."
}
func (t *startLinearIssueTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"issueId": {"type": "string", "description": "Issue identifier like 'LIN-123'"}
		},
		"required": ["issueId"]
	}`)
}

func (t *startLinearIssueTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var params struct {
		IssueID string `json:"issueId"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return tool.ErrorResult(fmt.Sprintf("invalid input: %v", err)), nil
	}
	if params.IssueID == "" {
		return tool.ErrorResult("issueId is required"), nil
	}

	// ChatML sessions run in isolated git worktrees locked to a specific branch.
	// Switching branches (git checkout) would corrupt the session state.
	// Instead, associate the issue without changing branches.
	t.linear.Set(&LinearIssue{
		Identifier: params.IssueID,
	})

	return &tool.Result{Content: fmt.Sprintf("Linear issue %s associated with this session. Note: branch switching is disabled in worktree sessions — the current branch is preserved.", params.IssueID)}, nil
}

// --- clear_linear_issue ---

type clearLinearIssueTool struct {
	linear *LinearIssueState
}

func (t *clearLinearIssueTool) Name() string           { return "mcp__chatml__clear_linear_issue" }
func (t *clearLinearIssueTool) IsConcurrentSafe() bool { return true }
func (t *clearLinearIssueTool) DeferLoading() bool     { return true }
func (t *clearLinearIssueTool) Description() string {
	return "Clear the Linear issue association from this session."
}
func (t *clearLinearIssueTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{"type": "object", "properties": {}}`)
}

func (t *clearLinearIssueTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	t.linear.Clear()
	return &tool.Result{Content: "Linear issue cleared from session."}, nil
}

// --- update_linear_status ---

type updateLinearStatusTool struct {
	linear *LinearIssueState
}

func (t *updateLinearStatusTool) Name() string           { return "mcp__chatml__update_linear_status" }
func (t *updateLinearStatusTool) IsConcurrentSafe() bool { return true }
func (t *updateLinearStatusTool) DeferLoading() bool     { return true }
func (t *updateLinearStatusTool) Description() string {
	return "Update the status of the current Linear issue in the local context."
}
func (t *updateLinearStatusTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"state": {"type": "string", "description": "New state (e.g., 'In Progress', 'In Review', 'Done')"}
		},
		"required": ["state"]
	}`)
}

func (t *updateLinearStatusTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var params struct {
		State string `json:"state"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return tool.ErrorResult(fmt.Sprintf("invalid input: %v", err)), nil
	}

	issue := t.linear.Get()
	if issue == nil {
		return tool.ErrorResult("no Linear issue is currently associated with this session"), nil
	}

	// Update the state in the local copy
	updated := *issue
	updated.State = params.State
	t.linear.Set(&updated)

	return &tool.Result{Content: fmt.Sprintf("Linear issue %s status updated to: %s", issue.Identifier, params.State)}, nil
}
