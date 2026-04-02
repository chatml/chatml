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

// Prompt implements tool.PromptProvider.
func (t *WebSearchTool) Prompt() string {
	return `- Allows Claude to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond Claude's knowledge cutoff
- Searches are performed automatically within a single API call

CRITICAL REQUIREMENT - You MUST follow this:
  - After answering the user's question, you MUST include a "Sources:" section at the end of your response
  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
  - This is MANDATORY - never skip including sources in your response
  - Example format: [Your answer here] Sources: - [Source Title 1](https://example.com/1)

Usage notes:
  - Domain filtering is supported to include or block specific websites
  - Web search is only available in the US

IMPORTANT - Use the correct year in search queries:
  - You MUST use the current year when searching for recent information, documentation, or current events.
  - Example: If the user asks for "latest React docs", search for "React documentation" with the current year, NOT last year`
}

var _ tool.Tool = (*WebSearchTool)(nil)
var _ tool.PromptProvider = (*WebSearchTool)(nil)
