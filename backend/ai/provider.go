package ai

import "context"

// Provider defines the interface for AI model providers used for lightweight tasks
// (PR generation, summarization, suggestions). The heavy agentic work is handled
// by the agent-runner process, which is provider-specific.
//
// For the initial release, only the Anthropic implementation (Client) exists.
// Community contributors can implement this interface for other providers.
type Provider interface {
	// GeneratePRDescription generates a PR title and body from commit context.
	GeneratePRDescription(ctx context.Context, req GeneratePRRequest) (*GeneratePRResponse, error)

	// GenerateConversationSummary summarizes a conversation.
	GenerateConversationSummary(ctx context.Context, req GenerateSummaryRequest) (string, error)

	// GenerateSessionTitle generates a short title from a user message.
	GenerateSessionTitle(ctx context.Context, userMessage string) (string, error)

	// GenerateSessionSummary summarizes an entire session across all conversations.
	GenerateSessionSummary(ctx context.Context, req GenerateSessionSummaryRequest) (string, error)

	// GenerateInputSuggestion generates suggested next prompts.
	GenerateInputSuggestion(ctx context.Context, req SuggestionRequest) (*SuggestionResponse, error)

	// Name returns the provider name (e.g., "anthropic", "openai").
	Name() string
}

// Ensure Client implements Provider at compile time.
var _ Provider = (*Client)(nil)
