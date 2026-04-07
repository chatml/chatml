package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/chatml/chatml-core/tool"
)

// WebSearchTool performs web searches via the Brave Search API.
type WebSearchTool struct {
	apiKey string
}

// NewWebSearchTool creates a new WebSearchTool with the given Brave Search API key.
func NewWebSearchTool(apiKey string) *WebSearchTool {
	return &WebSearchTool{apiKey: apiKey}
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
			"allowed_domains": {
				"type": "array",
				"items": {"type": "string"},
				"description": "Optional list of domains to restrict results to"
			},
			"blocked_domains": {
				"type": "array",
				"items": {"type": "string"},
				"description": "Optional list of domains to exclude from results"
			}
		},
		"required": ["query"]
	}`)
}

func (t *WebSearchTool) IsConcurrentSafe() bool { return true }

type webSearchInput struct {
	Query          string   `json:"query"`
	AllowedDomains []string `json:"allowed_domains"`
	BlockedDomains []string `json:"blocked_domains"`
}

// braveSearchResponse represents the relevant parts of the Brave Search API response.
type braveSearchResponse struct {
	Web struct {
		Results []struct {
			Title       string `json:"title"`
			URL         string `json:"url"`
			Description string `json:"description"`
		} `json:"results"`
	} `json:"web"`
}

func (t *WebSearchTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	if t.apiKey == "" {
		return tool.ErrorResult("WebSearch requires BRAVE_SEARCH_API_KEY environment variable"), nil
	}

	var in webSearchInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	if in.Query == "" {
		return tool.ErrorResult("query is required"), nil
	}

	// Build query with domain filters
	query := in.Query
	for _, domain := range in.AllowedDomains {
		query += " site:" + domain
	}
	for _, domain := range in.BlockedDomains {
		query += " -site:" + domain
	}

	// Build URL
	searchURL := fmt.Sprintf("https://api.search.brave.com/res/v1/web/search?q=%s&count=5", url.QueryEscape(query))

	// Create HTTP request with timeout
	httpCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(httpCtx, http.MethodGet, searchURL, nil)
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("Failed to create request: %v", err)), nil
	}
	req.Header.Set("X-Subscription-Token", t.apiKey)
	req.Header.Set("Accept", "application/json")

	httpClient := &http.Client{Timeout: 15 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("Search request failed: %v", err)), nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1*1024*1024)) // 1MB limit
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("Failed to read response: %v", err)), nil
	}

	if resp.StatusCode != http.StatusOK {
		return tool.ErrorResult(fmt.Sprintf("Brave Search API error (HTTP %d): %s", resp.StatusCode, string(body))), nil
	}

	var searchResp braveSearchResponse
	if err := json.Unmarshal(body, &searchResp); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Failed to parse search response: %v", err)), nil
	}

	if len(searchResp.Web.Results) == 0 {
		return tool.TextResult(fmt.Sprintf("Web search results for: %q\n\nNo results found.", in.Query)), nil
	}

	// Format results
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Web search results for: %q\n", in.Query))
	for i, result := range searchResp.Web.Results {
		sb.WriteString(fmt.Sprintf("\n[%d] %s\nURL: %s\n%s\n", i+1, result.Title, result.URL, result.Description))
	}

	return tool.TextResult(sb.String()), nil
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
