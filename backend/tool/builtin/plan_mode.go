package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/chatml/chatml-backend/tool"
)

// Note: Claude Code waits INDEFINITELY for plan approval (no timeout).
// We match this — cancellation only via context (runner stop/interrupt).

// PlanModeCallback is the interface for plan mode tools to interact with the runner.
type PlanModeCallback interface {
	// EmitPlanApprovalRequest sends a plan_approval_request event and returns
	// a channel that will receive the user's approval decision.
	EmitPlanApprovalRequest(requestID string, planContent string) <-chan PlanApprovalResult

	// SetPermissionModeDirect changes the permission mode directly (for EnterPlanMode).
	SetPermissionModeDirect(mode string)
}

// PlanApprovalResult contains the user's response to a plan approval request.
type PlanApprovalResult struct {
	Approved bool
	Reason   string
}

// --- ExitPlanMode ---

// ExitPlanModeTool requests user approval for a plan before exiting plan mode.
type ExitPlanModeTool struct {
	callback PlanModeCallback
}

func NewExitPlanModeTool(callback PlanModeCallback) *ExitPlanModeTool {
	return &ExitPlanModeTool{callback: callback}
}

func (t *ExitPlanModeTool) Name() string { return "ExitPlanMode" }

func (t *ExitPlanModeTool) Description() string {
	return `Use this tool when you are in plan mode and have finished writing your plan. This signals that you're done planning and ready for user review and approval.`
}

func (t *ExitPlanModeTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {},
		"additionalProperties": true
	}`)
}

func (t *ExitPlanModeTool) IsConcurrentSafe() bool { return false }

func (t *ExitPlanModeTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	if t.callback == nil {
		return tool.ErrorResult("ExitPlanMode is not available (no callback configured)"), nil
	}

	requestID := fmt.Sprintf("pa-%d", time.Now().UnixMilli())

	// Emit plan approval request
	respCh := t.callback.EmitPlanApprovalRequest(requestID, "")

	// Wait indefinitely for user response (matches Claude Code behavior).
	select {
	case result := <-respCh:
		if result.Approved {
			return tool.TextResult("Plan approved by user. You can now proceed with implementation."), nil
		}
		if result.Reason != "" {
			return tool.TextResult(fmt.Sprintf("Plan not approved. User feedback: %s", result.Reason)), nil
		}
		return tool.TextResult("Plan not approved by user."), nil

	case <-ctx.Done():
		return tool.ErrorResult("Plan approval cancelled"), nil
	}
}

var _ tool.Tool = (*ExitPlanModeTool)(nil)

// --- EnterPlanMode ---

// EnterPlanModeTool switches the conversation into plan mode.
type EnterPlanModeTool struct {
	callback PlanModeCallback
}

func NewEnterPlanModeTool(callback PlanModeCallback) *EnterPlanModeTool {
	return &EnterPlanModeTool{callback: callback}
}

func (t *EnterPlanModeTool) Name() string { return "EnterPlanMode" }

func (t *EnterPlanModeTool) Description() string {
	return `Switches to plan mode where you can design and present a plan before implementing it. In plan mode, write/edit/bash tools are restricted.`
}

func (t *EnterPlanModeTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {},
		"additionalProperties": true
	}`)
}

func (t *EnterPlanModeTool) IsConcurrentSafe() bool { return false }

func (t *EnterPlanModeTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	if t.callback == nil {
		return tool.ErrorResult("EnterPlanMode is not available (no callback configured)"), nil
	}

	t.callback.SetPermissionModeDirect("plan")
	return tool.TextResult("Entered plan mode. Write/Edit/Bash tools are now restricted. Use ExitPlanMode when your plan is ready for review."), nil
}

var _ tool.Tool = (*EnterPlanModeTool)(nil)
