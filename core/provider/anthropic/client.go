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
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-core/provider"
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
	"claude-opus-4-7":            1000000,
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
	transport  *http.Transport // Shared transport for connection pooling + pre-warming
	model      string
	apiURL     string
	isOAuth    bool

	// Pre-warm state: track inflight warm-up to avoid duplicate dials
	prewarmMu  sync.Mutex
	prewarming bool
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
	if cfg.APIKey != "" && cfg.OAuthToken != "" {
		return nil, fmt.Errorf("anthropic: APIKey and OAuthToken are mutually exclusive")
	}

	c := &Client{
		model:  stripContextWindowSuffix(cfg.Model),
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
		// Try to extract transport for pre-warming
		if t, ok := cfg.HTTPClient.Transport.(*http.Transport); ok {
			c.transport = t
		}
	} else {
		// Create a dedicated transport with aggressive keep-alive settings
		// so pre-warmed connections persist between API calls.
		c.transport = &http.Transport{
			MaxIdleConns:        4,
			MaxIdleConnsPerHost: 4,
			IdleConnTimeout:     120 * time.Second,
			TLSHandshakeTimeout: 10 * time.Second,
			// DisableKeepAlives must be false (default) for pooling to work
		}
		c.httpClient = &http.Client{
			Timeout:   defaultTimeout,
			Transport: c.transport,
		}
	}

	return c, nil
}

// PrewarmConnection initiates a TCP+TLS handshake to the API endpoint in the
// background by making a lightweight HEAD request. The established connection
// enters the transport's idle pool, so the next StreamChat call reuses it
// and skips the handshake (~50-150ms savings per round-trip).
func (c *Client) PrewarmConnection() {
	if c.transport == nil {
		return
	}

	c.prewarmMu.Lock()
	if c.prewarming {
		c.prewarmMu.Unlock()
		return // Already prewarming
	}
	c.prewarming = true
	c.prewarmMu.Unlock()

	go func() {
		defer func() {
			c.prewarmMu.Lock()
			c.prewarming = false
			c.prewarmMu.Unlock()
		}()

		// Make a lightweight HEAD request to the API host. The response status
		// doesn't matter — we just need the transport to establish and pool the
		// TCP+TLS connection to api.anthropic.com:443.
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		req, err := http.NewRequestWithContext(ctx, http.MethodHead, c.apiURL, nil)
		if err != nil {
			return
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return // Silently ignore — worst case we do a normal handshake later
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		// Connection is now in the transport's idle pool, ready for reuse.
	}()
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
		SupportsThinking:      true,
		SupportsImages:        true,
		SupportsDocuments:     true,
		SupportsCaching:       true,
		SupportsStreaming:      true,
		SupportsNativeSearch:  true,
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

	// Derive count_tokens URL from the configured API URL to respect custom endpoints/proxies
	countURL := strings.TrimSuffix(c.apiURL, "/messages") + "/messages/count_tokens"
	req, err := http.NewRequestWithContext(ctx, "POST", countURL, bytes.NewReader(jsonBody))
	if err != nil {
		return 0, fmt.Errorf("anthropic: create count_tokens request: %w", err)
	}
	c.setHeaders(req, nil)

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
		c.setHeaders(httpReq, &req)

		r, err := c.httpClient.Do(httpReq)
		if err != nil {
			return err // May be a network error — WithRetry checks isNetworkError
		}

		if r.StatusCode != http.StatusOK {
			defer r.Body.Close()
			respBody, _ := io.ReadAll(io.LimitReader(r.Body, 64*1024)) // Cap error body at 64KB
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
// chatReq is optional — when provided, beta headers are added based on features used.
func (c *Client) setHeaders(httpReq *http.Request, chatReq *provider.ChatRequest) {
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set(c.authHeader, c.authValue)
	httpReq.Header.Set("anthropic-version", apiVersion)

	// Build beta headers list
	var betas []string
	if c.isOAuth {
		betas = append(betas, oauthBetaHeader)
	}
	if chatReq != nil {
		if chatReq.Effort != "" {
			betas = append(betas, "effort-2025-11-24")
		}
		if chatReq.OutputFormat != "" {
			betas = append(betas, "structured-outputs-2025-12-15")
		}
		if chatReq.FastMode {
			betas = append(betas, "fast-mode-2026-02-01")
		}
		if len(chatReq.ServerTools) > 0 {
			betas = append(betas, "web-search-2025-03-05")
		}
	}
	if len(betas) > 0 {
		httpReq.Header.Set("anthropic-beta", joinBetas(betas))
	}
}

// stripContextWindowSuffix removes the "[1m]" context-window suffix that is
// used for internal tracking but is not a valid API model ID.
func stripContextWindowSuffix(model string) string {
	return strings.TrimSuffix(model, "[1m]")
}

// joinBetas joins beta header values with commas.
func joinBetas(betas []string) string {
	result := ""
	for i, b := range betas {
		if i > 0 {
			result += ","
		}
		result += b
	}
	return result
}

// buildRequestBody constructs the Anthropic Messages API request body.
func (c *Client) buildRequestBody(req provider.ChatRequest) map[string]interface{} {
	model := req.Model
	if model == "" {
		model = c.model
	}
	model = stripContextWindowSuffix(model)

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

	// Convert tools once, then merge with server tools if needed
	if len(req.Tools) > 0 || len(req.ServerTools) > 0 {
		converted := convertTools(req.Tools)

		if len(req.ServerTools) == 0 {
			body["tools"] = converted
		} else {
			tools := make([]interface{}, 0, len(converted)+len(req.ServerTools))
		for _, t := range converted {
			tools = append(tools, t)
		}
		for _, st := range req.ServerTools {
			stMap := map[string]interface{}{
				"type": st.Type,
				"name": st.Name,
			}
			if st.MaxUses > 0 {
				stMap["max_uses"] = st.MaxUses
			}
			if len(st.AllowedDomains) > 0 {
				stMap["allowed_domains"] = st.AllowedDomains
			}
			if len(st.BlockedDomains) > 0 {
				stMap["blocked_domains"] = st.BlockedDomains
			}
			tools = append(tools, stMap)
		}
		body["tools"] = tools
		}
	}

	// Tool choice: "auto" (default), "any" (must use a tool), "none", or specific tool name
	if req.ToolChoice != "" {
		switch req.ToolChoice {
		case "auto", "any", "none":
			body["tool_choice"] = map[string]string{"type": req.ToolChoice}
		default:
			body["tool_choice"] = map[string]interface{}{
				"type": "tool",
				"name": req.ToolChoice,
			}
		}
	}

	// Thinking configuration: prefer adaptive when supported, fall back to budget-constrained.
	// Adaptive thinking lets the model decide how much to think (better quality).
	thinkingEnabled := false
	if req.AdaptiveThinking && modelSupportsAdaptiveThinking(model) {
		body["thinking"] = map[string]interface{}{
			"type": "adaptive",
		}
		thinkingEnabled = true
	} else if req.ThinkingBudget > 0 {
		body["thinking"] = map[string]interface{}{
			"type":          "enabled",
			"budget_tokens": req.ThinkingBudget,
		}
		thinkingEnabled = true
	}

	// Temperature: Anthropic API rejects temperature when thinking is enabled.
	// Only send it when thinking is OFF (matches Claude Code behavior).
	if req.Temperature != nil && !thinkingEnabled {
		body["temperature"] = *req.Temperature
	}

	if len(req.StopSequences) > 0 {
		body["stop_sequences"] = req.StopSequences
	}

	// Effort level (beta: effort-2025-11-24)
	if req.Effort != "" {
		body["effort"] = req.Effort
	}

	// Structured output format (beta: structured-outputs-2025-12-15)
	if req.OutputFormat != "" {
		var outputFmt interface{}
		if err := json.Unmarshal([]byte(req.OutputFormat), &outputFmt); err != nil {
			log.Printf("anthropic: invalid OutputFormat JSON, ignoring structured output: %v", err)
		} else {
			body["output_format"] = outputFmt
		}
	}

	// Fast mode: send speed parameter in body (beta header also required)
	if req.FastMode {
		body["speed"] = "fast"
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
					if err := json.Unmarshal(block.Input, &input); err != nil {
						log.Printf("anthropic: invalid tool input JSON for %s: %v", block.ToolName, err)
					}
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
			case provider.BlockServerToolUse:
				content = append(content, map[string]interface{}{
					"type": "server_tool_use",
					"id":   block.ServerToolUseID,
					"name": block.ServerToolName,
				})
			case provider.BlockWebSearchResult:
				resultBlock := map[string]interface{}{
					"type":        "web_search_tool_result",
					"tool_use_id": block.ForToolUseID,
				}
				if block.WebSearchError != "" {
					resultBlock["content"] = map[string]interface{}{
						"type":       "web_search_result_error",
						"error_code": block.WebSearchError,
					}
				} else {
					var hits []map[string]interface{}
					for _, h := range block.WebSearchResults {
						hits = append(hits, map[string]interface{}{
							"type":  "web_search_result",
							"url":   h.URL,
							"title": h.Title,
						})
					}
					resultBlock["content"] = hits
				}
				content = append(content, resultBlock)
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

// modelSupportsAdaptiveThinking returns true if the model supports adaptive
// thinking (type: "adaptive" instead of budget-constrained).
func modelSupportsAdaptiveThinking(model string) bool {
	// Opus and Sonnet 4.6+ support adaptive thinking
	return strings.Contains(model, "opus-4") ||
		strings.Contains(model, "sonnet-4-6") ||
		strings.Contains(model, "sonnet-4-5")
}

// Ensure Client implements provider.Provider at compile time.
var _ provider.Provider = (*Client)(nil)
