package chatml

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/chatml/chatml-core/tool"
)

// --- request_user_browser_action ---

type requestUserBrowserActionTool struct {
	ctx *ToolContext
}

func (t *requestUserBrowserActionTool) Name() string           { return "mcp__chatml__request_user_browser_action" }
func (t *requestUserBrowserActionTool) IsConcurrentSafe() bool { return true }
func (t *requestUserBrowserActionTool) DeferLoading() bool     { return true }
func (t *requestUserBrowserActionTool) Description() string {
	return "Request the user to perform an action in a browser that requires human interaction (e.g., login, OAuth, CAPTCHA)."
}
func (t *requestUserBrowserActionTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"url": {"type": "string", "description": "The URL the user should navigate to"},
			"instructions": {"type": "string", "description": "Clear instructions for what the user needs to do"},
			"testCase": {"type": "string", "description": "The test case context"}
		},
		"required": ["url", "instructions"]
	}`)
}

func (t *requestUserBrowserActionTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var params struct {
		URL          string `json:"url"`
		Instructions string `json:"instructions"`
		TestCase     string `json:"testCase"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return tool.ErrorResult(fmt.Sprintf("invalid input: %v", err)), nil
	}

	// V1: Return instruction text for the agent to present to the user.
	// Full implementation with WebSocket pause/resume is deferred.
	var content string
	if params.TestCase != "" {
		content = fmt.Sprintf("Please perform the following browser action:\n\nURL: %s\nInstructions: %s\nTest case: %s\n\nPlease complete this action and let me know when you're done.", params.URL, params.Instructions, params.TestCase)
	} else {
		content = fmt.Sprintf("Please perform the following browser action:\n\nURL: %s\nInstructions: %s\n\nPlease complete this action and let me know when you're done.", params.URL, params.Instructions)
	}

	return &tool.Result{Content: content}, nil
}
