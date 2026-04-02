// Package provider defines the multi-model LLM provider abstraction for the
// native Go agentic loop. Each LLM (Anthropic, OpenAI, Bedrock, etc.) implements
// the Provider interface, translating between its native API format and the
// unified message/event types defined here.
package provider

import (
	"context"
)

// Provider is the interface that all LLM providers must implement.
// It handles streaming chat completions with tool support.
type Provider interface {
	// StreamChat sends a chat completion request and returns a channel of stream events.
	// The provider MUST close the channel when the response is complete or on error.
	// Cancellation is handled via ctx.
	StreamChat(ctx context.Context, req ChatRequest) (<-chan StreamEvent, error)

	// CountTokens estimates the token count for the given messages.
	// Used by the context manager to decide when to compact.
	CountTokens(ctx context.Context, messages []Message) (int, error)

	// Name returns the provider identifier (e.g., "anthropic", "openai", "bedrock").
	Name() string

	// MaxContextWindow returns the maximum context window in tokens for the
	// configured model.
	MaxContextWindow() int

	// Capabilities returns what features this provider supports.
	Capabilities() Capabilities
}

// ChatRequest contains everything needed for a streaming API call.
type ChatRequest struct {
	Model          string     `json:"model"`
	Messages       []Message  `json:"messages"`
	SystemPrompt   string     `json:"system_prompt,omitempty"`
	Tools          []ToolDef  `json:"tools,omitempty"`
	MaxTokens      int        `json:"max_tokens,omitempty"`
	Temperature    *float64   `json:"temperature,omitempty"`
	ThinkingBudget int        `json:"thinking_budget,omitempty"` // 0 = disabled
	StopSequences  []string   `json:"stop_sequences,omitempty"`
	CacheControl   bool       `json:"cache_control,omitempty"`  // Enable prompt caching (Anthropic)
}

// Capabilities describes what features a provider supports.
type Capabilities struct {
	SupportsThinking  bool
	SupportsImages    bool
	SupportsDocuments bool
	SupportsCaching   bool // Prompt caching (Anthropic-specific)
	SupportsStreaming  bool // Should always be true
}
