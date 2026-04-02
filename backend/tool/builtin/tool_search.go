package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/chatml/chatml-backend/tool"
)

// ToolSearchTool fetches full schema definitions for deferred tools so they can be called.
// Deferred tools appear by name in system-reminder messages. Until fetched, only the name
// is known — there is no parameter schema, so the tool cannot be invoked.
type ToolSearchTool struct {
	registry *tool.Registry
}

// NewToolSearchTool creates a ToolSearch tool backed by the given registry.
func NewToolSearchTool(registry *tool.Registry) *ToolSearchTool {
	return &ToolSearchTool{registry: registry}
}

func (t *ToolSearchTool) Name() string { return "ToolSearch" }

func (t *ToolSearchTool) Description() string {
	return `Fetches full schema definitions for deferred tools so they can be called. Use "select:Read,Edit,Grep" for exact lookup, or keywords to search.`
}

func (t *ToolSearchTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"query": {
				"type": "string",
				"description": "Query to find deferred tools. Use \"select:<tool_name>\" for direct selection, or keywords to search."
			},
			"max_results": {
				"type": "number",
				"description": "Maximum number of results to return (default: 5)"
			}
		},
		"required": ["query"]
	}`)
}

func (t *ToolSearchTool) IsConcurrentSafe() bool { return true }

type toolSearchInput struct {
	Query      string `json:"query"`
	MaxResults int    `json:"max_results"`
}

func (t *ToolSearchTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in toolSearchInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	if in.Query == "" {
		return tool.ErrorResult("query is required"), nil
	}

	maxResults := in.MaxResults
	if maxResults <= 0 {
		maxResults = 5
	}

	matches := t.registry.SearchTools(in.Query, maxResults)

	if len(matches) == 0 {
		return tool.TextResult("No matching tools found."), nil
	}

	// Format as a functions block matching the system prompt format
	var sb strings.Builder
	sb.WriteString("<functions>\n")
	for _, def := range matches {
		toolJSON, err := json.Marshal(map[string]interface{}{
			"description":  def.Description,
			"name":         def.Name,
			"parameters":   json.RawMessage(def.InputSchema),
		})
		if err != nil {
			continue
		}
		fmt.Fprintf(&sb, "<function>%s</function>\n", string(toolJSON))
	}
	sb.WriteString("</functions>")

	return tool.TextResult(sb.String()), nil
}

// Prompt implements tool.PromptProvider.
func (t *ToolSearchTool) Prompt() string {
	if t.registry == nil {
		return ""
	}

	summaries := t.registry.DeferredSummaries()
	if len(summaries) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("The following deferred tools are available via ToolSearch:\n")
	for _, s := range summaries {
		fmt.Fprintf(&sb, "%s\n", s.Name)
	}
	return sb.String()
}

var _ tool.Tool = (*ToolSearchTool)(nil)
var _ tool.PromptProvider = (*ToolSearchTool)(nil)
