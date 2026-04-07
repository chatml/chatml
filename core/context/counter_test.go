package context

import (
	"encoding/json"
	"testing"

	"github.com/chatml/chatml-core/provider"
	"github.com/stretchr/testify/assert"
)

func TestEstimateTokens_Empty(t *testing.T) {
	assert.Equal(t, 0, EstimateTokens(nil))
}

func TestEstimateTokens_TextMessage(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			provider.NewTextBlock("Hello, world!"), // 13 chars
		}},
	}
	tokens := EstimateTokens(msgs)
	// raw: 13/4 + 1*4 = 7, with 33% padding: 7*4/3 = 9
	assert.Equal(t, 9, tokens)
}

func TestEstimateTokens_ToolUse(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewToolUseBlock("tu_1", "Bash", json.RawMessage(`{"command":"ls -la"}`)),
		}},
	}
	tokens := EstimateTokens(msgs)
	assert.Greater(t, tokens, 0)
}

func TestEstimateTokens_ToolResult(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			provider.NewToolResultBlock("tu_1", "file1.go\nfile2.go", false),
		}},
	}
	tokens := EstimateTokens(msgs)
	assert.Greater(t, tokens, 0)
}

func TestEstimateTokens_MultipleMessages(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("Hello")}},
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{provider.NewTextBlock("Hi there")}},
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("Thanks")}},
	}
	tokens := EstimateTokens(msgs)
	// Should include message overhead
	assert.Greater(t, tokens, 3*4) // At least 3 messages * 4 overhead
}

func TestTokensFromUsage_Nil(t *testing.T) {
	assert.Equal(t, 0, TokensFromUsage(nil))
}

func TestTokensFromUsage_Normal(t *testing.T) {
	usage := &provider.Usage{InputTokens: 100, OutputTokens: 50}
	assert.Equal(t, 150, TokensFromUsage(usage))
}

func TestContextTokensFromUsage(t *testing.T) {
	usage := &provider.Usage{
		InputTokens:             1000,
		OutputTokens:            200,
		CacheReadInputTokens:    500,
		CacheCreationInputTokens: 100,
	}
	// Context tokens = input + output (cache tokens already included in input)
	assert.Equal(t, 1200, ContextTokensFromUsage(usage))
}
