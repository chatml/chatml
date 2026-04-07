// Package openai implements the provider.Provider interface for OpenAI-compatible APIs.
// This supports OpenAI (GPT-4, GPT-4o, o1, o3), Azure OpenAI, and any OpenAI-compatible
// endpoint (Ollama, vLLM, Together, Groq, etc.) via configurable base URL.
package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/chatml/chatml-core/provider"
)

const (
	defaultAPIURL  = "https://api.openai.com/v1/chat/completions"
	defaultModel   = "gpt-4o"
	defaultTimeout = 10 * time.Minute
)

// Model context windows for known OpenAI models.
var modelContextWindows = map[string]int{
	"gpt-4o":            128000,
	"gpt-4o-mini":       128000,
	"gpt-4-turbo":       128000,
	"gpt-4":             8192,
	"gpt-3.5-turbo":     16385,
	"o1":                200000,
	"o1-mini":           128000,
	"o1-preview":        128000,
	"o3":                200000,
	"o3-mini":           200000,
	"o4-mini":           200000,
}

const defaultContextWindow = 128000

// Client implements provider.Provider for OpenAI-compatible APIs.
type Client struct {
	apiURL     string
	apiKey     string
	model      string
	httpClient *http.Client
}

// Config holds configuration for creating an OpenAI client.
type Config struct {
	APIKey     string // Required
	Model      string // e.g., "gpt-4o" (default)
	APIURL     string // Override for testing or compatible APIs
	HTTPClient *http.Client
}

// New creates a new OpenAI provider client.
func New(cfg Config) (*Client, error) {
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("openai: API key is required")
	}

	c := &Client{
		apiKey: cfg.APIKey,
		model:  cfg.Model,
		apiURL: cfg.APIURL,
	}

	if c.model == "" {
		c.model = defaultModel
	}
	if c.apiURL == "" {
		c.apiURL = defaultAPIURL
	}
	if cfg.HTTPClient != nil {
		c.httpClient = cfg.HTTPClient
	} else {
		c.httpClient = &http.Client{Timeout: defaultTimeout}
	}

	return c, nil
}

func (c *Client) Name() string { return "openai" }

func (c *Client) MaxContextWindow() int {
	if w, ok := modelContextWindows[c.model]; ok {
		return w
	}
	return defaultContextWindow
}

func (c *Client) Capabilities() provider.Capabilities {
	return provider.Capabilities{
		SupportsThinking:  false, // OpenAI doesn't have thinking blocks
		SupportsImages:    true,
		SupportsDocuments: false,
		SupportsCaching:   false,
		SupportsStreaming:  true,
	}
}

// PrewarmConnection is a no-op for OpenAI — the default transport handles pooling.
func (c *Client) PrewarmConnection() {}

func (c *Client) CountTokens(ctx context.Context, messages []provider.Message) (int, error) {
	// OpenAI doesn't have a public count_tokens endpoint.
	// Use estimation based on message content.
	return estimateTokens(messages), nil
}

// StreamChat sends a streaming chat request to the OpenAI API.
func (c *Client) StreamChat(ctx context.Context, req provider.ChatRequest) (<-chan provider.StreamEvent, error) {
	body := c.buildRequestBody(req)

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("openai: marshal request: %w", err)
	}

	var resp *http.Response
	retryErr := provider.WithRetry(ctx, provider.DefaultRetryConfig(), func() error {
		httpReq, err := http.NewRequestWithContext(ctx, "POST", c.apiURL, bytes.NewReader(jsonBody))
		if err != nil {
			return fmt.Errorf("openai: create request: %w", err)
		}
		httpReq.Header.Set("Content-Type", "application/json")
		// NOTE: API key appears in headers. If HTTP debug logging is ever added,
		// ensure header values are redacted.
		httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

		r, err := c.httpClient.Do(httpReq)
		if err != nil {
			return err
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
		return nil, fmt.Errorf("openai: %w", retryErr)
	}

	ch := make(chan provider.StreamEvent, 64)
	go processStream(ctx, resp.Body, ch)
	return ch, nil
}

// buildRequestBody constructs the OpenAI chat completions request.
func (c *Client) buildRequestBody(req provider.ChatRequest) map[string]interface{} {
	model := req.Model
	if model == "" {
		model = c.model
	}

	body := map[string]interface{}{
		"model":  model,
		"stream": true,
		// Enable streaming options to get usage stats
		"stream_options": map[string]interface{}{
			"include_usage": true,
		},
	}

	// System prompt → system message
	messages := []map[string]interface{}{}
	if req.SystemPrompt != "" {
		messages = append(messages, map[string]interface{}{
			"role":    "system",
			"content": req.SystemPrompt,
		})
	}

	// Convert messages (tool result messages may expand to multiple OpenAI messages)
	for _, msg := range req.Messages {
		messages = append(messages, convertMessages(msg)...)
	}
	body["messages"] = messages

	// Tools
	if len(req.Tools) > 0 {
		body["tools"] = convertTools(req.Tools)
	}

	// Max tokens
	if req.MaxTokens > 0 {
		body["max_tokens"] = req.MaxTokens
	}

	// Temperature
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}

	return body
}

// convertMessages converts a unified provider.Message to one or more OpenAI format messages.
// Tool result messages with multiple blocks produce one message per tool result (OpenAI
// requires each tool result as a separate message with role "tool").
func convertMessages(msg provider.Message) []map[string]interface{} {
	var textParts []string
	var toolCalls []map[string]interface{}
	var toolResults []map[string]interface{}

	for _, block := range msg.Content {
		switch block.Type {
		case provider.BlockText:
			textParts = append(textParts, block.Text)

		case provider.BlockToolUse:
			toolCalls = append(toolCalls, map[string]interface{}{
				"id":   block.ToolUseID,
				"type": "function",
				"function": map[string]interface{}{
					"name":      block.ToolName,
					"arguments": string(block.Input),
				},
			})

		case provider.BlockToolResult:
			toolResults = append(toolResults, map[string]interface{}{
				"role":         "tool",
				"tool_call_id": block.ForToolUseID,
				"content":      block.ResultContent,
			})

		case provider.BlockImage:
			textParts = append(textParts, "[Image attached]")
		}
	}

	// Multiple tool results → one message per result.
	// NOTE: Any text blocks in the same message are discarded since OpenAI's
	// tool role messages don't support mixed content. The unified format should
	// not mix tool_result + text in one message, but if it does, text is lost.
	if len(toolResults) > 0 {
		if len(textParts) > 0 {
			log.Printf("warning: openai convertMessages: dropping %d text block(s) from message with %d tool results (OpenAI tool role doesn't support mixed content)", len(textParts), len(toolResults))
		}
		return toolResults
	}

	m := map[string]interface{}{
		"role": string(msg.Role),
	}

	if len(toolCalls) > 0 {
		m["tool_calls"] = toolCalls
		if len(textParts) > 0 {
			m["content"] = joinStrings(textParts)
		}
		return []map[string]interface{}{m}
	}

	m["content"] = joinStrings(textParts)
	return []map[string]interface{}{m}
}

// convertTools converts unified tool defs to OpenAI function calling format.
func convertTools(tools []provider.ToolDef) []map[string]interface{} {
	result := make([]map[string]interface{}, len(tools))
	for i, t := range tools {
		var schema interface{}
		json.Unmarshal(t.InputSchema, &schema)

		result[i] = map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name":        t.Name,
				"description": t.Description,
				"parameters":  schema,
			},
		}
	}
	return result
}

func joinStrings(parts []string) string {
	if len(parts) == 0 {
		return ""
	}
	result := parts[0]
	for _, p := range parts[1:] {
		result += "\n" + p
	}
	return result
}

func estimateTokens(messages []provider.Message) int {
	totalChars := 0
	for _, msg := range messages {
		for _, block := range msg.Content {
			switch block.Type {
			case provider.BlockText:
				totalChars += len(block.Text)
			case provider.BlockToolUse:
				totalChars += len(block.ToolName) + len(block.Input)
			case provider.BlockToolResult:
				totalChars += len(block.ResultContent)
			}
		}
	}
	return totalChars/4 + len(messages)*4
}

var _ provider.Provider = (*Client)(nil)
