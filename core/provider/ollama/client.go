// Package ollama implements the provider.Provider interface for Ollama's local
// inference API. This provider communicates with a managed Ollama server via
// its native HTTP API (not the OpenAI-compatible endpoint), which gives us
// direct access to Ollama's streaming, tool calling, and model management.
package ollama

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/chatml/chatml-core/provider"
)

const defaultContextWindow = 128000

// Client implements provider.Provider for Ollama's native API.
type Client struct {
	endpoint   string // e.g., "http://127.0.0.1:39421"
	model      string // Ollama model name, e.g., "gemma4:27b"
	httpClient *http.Client
}

// Config holds configuration for creating an Ollama client.
type Config struct {
	Model      string       // Ollama model tag, e.g., "gemma4:27b"
	Endpoint   string       // Ollama server endpoint, e.g., "http://127.0.0.1:11434"
	HTTPClient *http.Client // Optional custom HTTP client
}

// New creates a new Ollama provider client.
func New(cfg Config) (*Client, error) {
	if cfg.Endpoint == "" {
		return nil, fmt.Errorf("ollama: endpoint is required")
	}
	if cfg.Model == "" {
		return nil, fmt.Errorf("ollama: model is required")
	}

	c := &Client{
		endpoint: strings.TrimRight(cfg.Endpoint, "/"),
		model:    cfg.Model,
	}

	if cfg.HTTPClient != nil {
		c.httpClient = cfg.HTTPClient
	} else {
		// Use transport-level timeouts only — no overall http.Client.Timeout.
		// Streaming responses from local inference can be long-lived; the
		// stream idle timeout in processStream handles liveness instead.
		c.httpClient = &http.Client{
			Transport: &http.Transport{
				DialContext:           (&net.Dialer{Timeout: 30 * time.Second}).DialContext,
				TLSHandshakeTimeout:   10 * time.Second,
				ResponseHeaderTimeout: 5 * time.Minute, // model loading can be slow
			},
		}
	}

	return c, nil
}

func (c *Client) Name() string { return "ollama" }

func (c *Client) MaxContextWindow() int {
	if w, ok := ContextWindowForOllamaModel(c.model); ok {
		return w
	}
	return defaultContextWindow
}

func (c *Client) Capabilities() provider.Capabilities {
	return provider.Capabilities{
		SupportsThinking:     false,
		SupportsImages:       true,
		SupportsDocuments:    false,
		SupportsCaching:      false,
		SupportsStreaming:     true,
		SupportsNativeSearch: false,
	}
}

// PrewarmConnection is a no-op for local inference.
func (c *Client) PrewarmConnection() {}

func (c *Client) CountTokens(ctx context.Context, messages []provider.Message) (int, error) {
	return estimateTokens(messages), nil
}

// StreamChat sends a streaming chat request to the Ollama API.
func (c *Client) StreamChat(ctx context.Context, req provider.ChatRequest) (<-chan provider.StreamEvent, error) {
	body := c.buildRequestBody(req)

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("ollama: marshal request: %w", err)
	}

	url := c.endpoint + "/api/chat"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("ollama: create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ollama: request failed: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4*1024))
		return nil, &provider.APIError{
			StatusCode: resp.StatusCode,
			Message:    string(respBody),
		}
	}

	ch := make(chan provider.StreamEvent, 64)
	go processStream(ctx, resp.Body, ch)
	return ch, nil
}

// buildRequestBody constructs the Ollama /api/chat request.
func (c *Client) buildRequestBody(req provider.ChatRequest) map[string]interface{} {
	model := req.Model
	if model == "" {
		model = c.model
	}

	body := map[string]interface{}{
		"model":  model,
		"stream": true,
	}

	// Build messages array
	messages := []map[string]interface{}{}

	// System prompt
	if req.SystemPrompt != "" {
		messages = append(messages, map[string]interface{}{
			"role":    "system",
			"content": req.SystemPrompt,
		})
	}

	// Convert conversation messages
	for _, msg := range req.Messages {
		messages = append(messages, convertMessages(msg)...)
	}
	body["messages"] = messages

	// Tools (Ollama uses the same format as OpenAI for function calling)
	if len(req.Tools) > 0 {
		body["tools"] = convertTools(req.Tools)
	}

	// Options
	options := map[string]interface{}{}
	if req.Temperature != nil {
		options["temperature"] = *req.Temperature
	}
	// Set context window dynamically: use estimated input size + headroom for output,
	// capped at the model's max. Avoids allocating a full 128K-256K KV cache for
	// short conversations, which would waste memory and slow down inference.
	// Quantized to fixed tiers to avoid Ollama reloading the model on every turn
	// when the exact num_ctx value changes (Ollama reloads if num_ctx differs).
	// Minimum tier is 16384 to avoid a reload when short conversations grow past
	// the first few turns — the memory cost (~200MB for 27B Q4) is worthwhile to
	// prevent multi-second pauses from KV cache reallocation.
	inputTokens := estimateTokens(req.Messages) + len(req.SystemPrompt)/4
	const outputHeadroom = 8192
	needed := inputTokens + outputHeadroom
	maxCtx := c.MaxContextWindow()
	tiers := []int{16384, 65536, maxCtx}
	quantized := maxCtx
	for _, t := range tiers {
		if needed <= t {
			quantized = t
			break
		}
	}
	if needed > maxCtx {
		fmt.Printf("ollama: warning: estimated input (%d tokens) exceeds model context window (%d) — conversation may be truncated\n", needed, maxCtx)
	}
	options["num_ctx"] = quantized
	if len(options) > 0 {
		body["options"] = options
	}

	return body
}

// convertMessages converts a unified provider.Message to Ollama format messages.
func convertMessages(msg provider.Message) []map[string]interface{} {
	var textParts []string
	var toolCalls []map[string]interface{}
	var toolResults []map[string]interface{}
	var images []string

	for _, block := range msg.Content {
		switch block.Type {
		case provider.BlockText:
			textParts = append(textParts, block.Text)

		case provider.BlockToolUse:
			var args interface{}
			if len(block.Input) > 0 {
				if err := json.Unmarshal(block.Input, &args); err != nil {
					args = map[string]interface{}{}
				}
			}
			toolCalls = append(toolCalls, map[string]interface{}{
				"id":   block.ToolUseID,
				"type": "function",
				"function": map[string]interface{}{
					"name":      block.ToolName,
					"arguments": args,
				},
			})

		case provider.BlockToolResult:
			toolResults = append(toolResults, map[string]interface{}{
				"role":    "tool",
				"content": block.ResultContent,
			})

		case provider.BlockImage:
			if block.Base64Data != "" {
				images = append(images, block.Base64Data)
			}
		}
	}

	// Tool results → one message per result
	if len(toolResults) > 0 {
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

	// Ollama supports images as base64 in the "images" field
	if len(images) > 0 {
		m["images"] = images
	}

	return []map[string]interface{}{m}
}

// convertTools converts unified tool defs to Ollama/OpenAI function calling format.
func convertTools(tools []provider.ToolDef) []map[string]interface{} {
	result := make([]map[string]interface{}, len(tools))
	for i, t := range tools {
		var schema interface{}
		if err := json.Unmarshal(t.InputSchema, &schema); err != nil {
			schema = map[string]interface{}{}
		}

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
