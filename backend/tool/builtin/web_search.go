package builtin

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/chatml/chatml-backend/tool"
)

// WebSearchTool performs web searches.
// Currently returns a placeholder result indicating that a search backend
// needs to be configured. Integration with Brave/Tavily/SearXNG is planned.
type WebSearchTool struct{}

func NewWebSearchTool() *WebSearchTool {
	return &WebSearchTool{}
}

func (t *WebSearchTool) Name() string { return "WebSearch" }

func (t *WebSearchTool) Description() string {
	return `Searches the web for information. Returns a list of results with titles, URLs, and snippets.`
}

func (t *WebSearchTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"query": {
				"type": "string",
				"description": "The search query"
			},
			"num_results": {
				"type": "number",
				"description": "Number of results to return (default 5, max 10)"
			}
		},
		"required": ["query"]
	}`)
}

func (t *WebSearchTool) IsConcurrentSafe() bool { return true }

type webSearchInput struct {
	Query      string `json:"query"`
	NumResults int    `json:"num_results"`
}

func (t *WebSearchTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in webSearchInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	if in.Query == "" {
		return tool.ErrorResult("query is required"), nil
	}

	// TODO: Integrate with a search backend (Brave, Tavily, SearXNG)
	return tool.ErrorResult("Web search is not yet configured. Please set up a search provider in settings."), nil
}

var _ tool.Tool = (*WebSearchTool)(nil)
