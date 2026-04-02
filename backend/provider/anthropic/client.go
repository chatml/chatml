// Package anthropic implements the provider.Provider interface for the Anthropic
// Messages API. It handles streaming chat completions with tool support, translating
// between the Anthropic-specific SSE format and the unified provider types.
package anthropic

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/chatml/chatml-backend/provider"
)

const (
	defaultAPIURL   = "https://api.anthropic.com/v1/messages"
	countTokensURL  = "https://api.anthropic.com/v1/messages/count_tokens"
	apiVersion      = "2023-06-01"
	oauthBetaHeader = "oauth-2025-04-20"
	defaultTimeout  = 10 * time.Minute // Matches Claude Code's API_TIMEOUT_MS (600s)
)

// modelContextWindows maps model IDs to their context window sizes.
var modelContextWindows = map[string]int{
	"claude-opus-4-6":            1000000,
	"claude-sonnet-4-6":          200000,
	"claude-haiku-4-5-20251001":  200000,
	"claude-sonnet-4-5-20250514": 200000,
}

// Client implements provider.Provider for the Anthropic Messages API.
type Client struct {
	authHeader string
	authValue  string
	httpClient *http.Client
	model      string
	apiURL     string
	isOAuth    bool
}

// Config holds configuration for creating a new Anthropic client.
type Config struct {
	APIKey      string // Mutually exclusive with OAuthToken
	OAuthToken  string // Mutually exclusive with APIKey
	Model       string // e.g., "claude-opus-4-6"
	APIURL      string // Override for testing; defaults to Anthropic production
	HTTPClient  *http.Client
}

// New creates a new Anthropic provider client.
func New(cfg Config) (*Client, error) {
	if cfg.APIKey == "" && cfg.OAuthToken == "" {
		return nil, fmt.Errorf("anthropic: either APIKey or OAuthToken must be provided")
	}

	c := &Client{
		model:  cfg.Model,
		apiURL: cfg.APIURL,
	}

	if c.model == "" {
		c.model = "claude-sonnet-4-6"
	}
	if c.apiURL == "" {
		c.apiURL = defaultAPIURL
	}

	if cfg.OAuthToken != "" {
		c.authHeader = "Authorization"
		c.authValue = "Bearer " + cfg.OAuthToken
		c.isOAuth = true
	} else {
		c.authHeader = "x-api-key"
		c.authValue = cfg.APIKey
	}

	if cfg.HTTPClient != nil {
		c.httpClient = cfg.HTTPClient
	} else {
		c.httpClient = &http.Client{Timeout: defaultTimeout}
	}

	return c, nil
}

// Name returns the provider identifier.
func (c *Client) Name() string { return "anthropic" }

// MaxContextWindow returns the context window for the configured model.
func (c *Client) MaxContextWindow() int {
	if w, ok := modelContextWindows[c.model]; ok {
		return w
	}
	return 200000 // Safe default
}

// Capabilities returns Anthropic-specific capability flags.
func (c *Client) Capabilities() provider.Capabilities {
	return provider.Capabilities{
		SupportsThinking:  true,
		SupportsImages:    true,
		SupportsDocuments: true,
		SupportsCaching:   true,
		SupportsStreaming:  true,
	}
}

// CountTokens estimates the token count for the given messages using the
// Anthropic count_tokens endpoint.
func (c *Client) CountTokens(ctx context.Context, messages []provider.Message) (int, error) {
	body := map[string]interface{}{
		"model":    c.model,
		"messages": convertMessages(messages),
	}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return 0, fmt.Errorf("anthropic: marshal count_tokens request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", countTokensURL, bytes.NewReader(jsonBody))
	if err != nil {
		return 0, fmt.Errorf("anthropic: create count_tokens request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("anthropic: count_tokens request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("anthropic: count_tokens returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		InputTokens int `json:"input_tokens"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, fmt.Errorf("anthropic: decode count_tokens response: %w", err)
	}
	return result.InputTokens, nil
}

// StreamChat sends a streaming chat request to the Anthropic Messages API
// and returns a channel of unified StreamEvents. Transient errors (429, 529,
// network resets) are automatically retried with exponential backoff.
func (c *Client) StreamChat(ctx context.Context, req provider.ChatRequest) (<-chan provider.StreamEvent, error) {
	// Build the Anthropic request body
	body := c.buildRequestBody(req)

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("anthropic: marshal request: %w", err)
	}

	var resp *http.Response

	retryErr := provider.WithRetry(ctx, provider.DefaultRetryConfig(), func() error {
		httpReq, err := http.NewRequestWithContext(ctx, "POST", c.apiURL, bytes.NewReader(jsonBody))
		if err != nil {
			return fmt.Errorf("anthropic: create request: %w", err)
		}
		c.setHeaders(httpReq)

		r, err := c.httpClient.Do(httpReq)
		if err != nil {
			return err // May be a network error — WithRetry checks isNetworkError
		}

		if r.StatusCode != http.StatusOK {
			defer r.Body.Close()
			respBody, _ := io.ReadAll(r.Body)
			apiErr := &provider.APIError{
				StatusCode: r.StatusCode,
				Message:    string(respBody),
			}
			if ra := r.Header.Get("Retry-After"); ra != "" {
				apiErr.RetryAfter = provider.ParseRetryAfter(ra)
			}
			return apiErr
		}

		resp = r
		return nil
	})

	if retryErr != nil {
		return nil, fmt.Errorf("anthropic: %w", retryErr)
	}

	// Parse SSE stream in a goroutine, emit unified events
	ch := make(chan provider.StreamEvent, 64)
	go c.processStream(ctx, resp.Body, ch)
	return ch, nil
}

// setHeaders sets the standard Anthropic headers on an HTTP request.
func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(c.authHeader, c.authValue)
	req.Header.Set("anthropic-version", apiVersion)
	if c.isOAuth {
		req.Header.Set("anthropic-beta", oauthBetaHeader)
	}
}

// buildRequestBody constructs the Anthropic Messages API request body.
func (c *Client) buildRequestBody(req provider.ChatRequest) map[string]interface{} {
	model := req.Model
	if model == "" {
		model = c.model
	}

	body := map[string]interface{}{
		"model":    model,
		"messages": convertMessages(req.Messages),
		"stream":   true,
	}

	if req.MaxTokens > 0 {
		body["max_tokens"] = req.MaxTokens
	} else {
		body["max_tokens"] = 16384 // Default
	}

	if req.SystemPrompt != "" {
		if req.CacheControl {
			// With caching: system prompt as array with cache_control breakpoint
			body["system"] = []map[string]interface{}{
				{
					"type": "text",
					"text": req.SystemPrompt,
					"cache_control": map[string]string{"type": "ephemeral"},
				},
			}
		} else {
			body["system"] = req.SystemPrompt
		}
	}

	if len(req.Tools) > 0 {
		body["tools"] = convertTools(req.Tools)
	}

	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}

	if req.ThinkingBudget > 0 {
		body["thinking"] = map[string]interface{}{
			"type":         "enabled",
			"budget_tokens": req.ThinkingBudget,
		}
	}

	if len(req.StopSequences) > 0 {
		body["stop_sequences"] = req.StopSequences
	}

	return body
}

// convertMessages translates provider.Message types to the Anthropic API format.
func convertMessages(messages []provider.Message) []map[string]interface{} {
	result := make([]map[string]interface{}, 0, len(messages))
	for _, msg := range messages {
		apiMsg := map[string]interface{}{
			"role": string(msg.Role),
		}

		content := make([]map[string]interface{}, 0, len(msg.Content))
		for _, block := range msg.Content {
			switch block.Type {
			case provider.BlockText:
				content = append(content, map[string]interface{}{
					"type": "text",
					"text": block.Text,
				})
			case provider.BlockToolUse:
				var input interface{}
				if len(block.Input) > 0 {
					_ = json.Unmarshal(block.Input, &input)
				}
				content = append(content, map[string]interface{}{
					"type":  "tool_use",
					"id":    block.ToolUseID,
					"name":  block.ToolName,
					"input": input,
				})
			case provider.BlockToolResult:
				entry := map[string]interface{}{
					"type":        "tool_result",
					"tool_use_id": block.ForToolUseID,
					"content":     block.ResultContent,
				}
				if block.IsError {
					entry["is_error"] = true
				}
				content = append(content, entry)
			case provider.BlockThinking:
				content = append(content, map[string]interface{}{
					"type":     "thinking",
					"thinking": block.Thinking,
				})
			case provider.BlockImage:
				content = append(content, map[string]interface{}{
					"type": "image",
					"source": map[string]interface{}{
						"type":       "base64",
						"media_type": block.MediaType,
						"data":       block.Base64Data,
					},
				})
			}
		}

		apiMsg["content"] = content
		result = append(result, apiMsg)
	}
	return result
}

// convertTools translates provider.ToolDef types to the Anthropic API format.
func convertTools(tools []provider.ToolDef) []map[string]interface{} {
	result := make([]map[string]interface{}, 0, len(tools))
	for _, t := range tools {
		var schema interface{}
		if len(t.InputSchema) > 0 {
			_ = json.Unmarshal(t.InputSchema, &schema)
		}
		result = append(result, map[string]interface{}{
			"name":         t.Name,
			"description":  t.Description,
			"input_schema": schema,
		})
	}
	return result
}

// Ensure Client implements provider.Provider at compile time.
var _ provider.Provider = (*Client)(nil)
