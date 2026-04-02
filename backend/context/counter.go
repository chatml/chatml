// Package context manages context window budgets, token counting, and
// conversation compaction for the native Go agentic loop.
package context

import (
	"github.com/chatml/chatml-backend/provider"
)

// EstimateTokens provides a rough token estimate for a slice of messages.
// Uses the heuristic of ~4 characters per token, which is a reasonable
// approximation for English text across most LLM tokenizers.
func EstimateTokens(messages []provider.Message) int {
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
			case provider.BlockThinking:
				totalChars += len(block.Thinking)
			}
		}
	}
	// ~4 characters per token, plus overhead per message (~4 tokens)
	return totalChars/4 + len(messages)*4
}

// TokensFromUsage extracts the total token count from an API usage response.
// This is the authoritative count from the provider, used to calibrate estimates.
func TokensFromUsage(usage *provider.Usage) int {
	if usage == nil {
		return 0
	}
	return usage.InputTokens + usage.OutputTokens
}

// ContextTokensFromUsage returns the number of context tokens consumed,
// matching Claude Code's finalContextTokensFromLastResponse().
// This is input + output (excluding cache tokens, which are already counted in input).
func ContextTokensFromUsage(usage *provider.Usage) int {
	if usage == nil {
		return 0
	}
	return usage.InputTokens + usage.OutputTokens
}

// CacheBreakdown returns separate cache token counts for cost analysis.
// CacheReadInputTokens are tokens served from cache (cheaper).
// CacheCreationInputTokens are tokens written to cache (one-time cost).
func CacheBreakdown(usage *provider.Usage) (cacheRead, cacheCreation int) {
	if usage == nil {
		return 0, 0
	}
	return usage.CacheReadInputTokens, usage.CacheCreationInputTokens
}
