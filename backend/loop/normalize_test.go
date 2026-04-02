package loop

import (
	"strings"
	"testing"

	"github.com/chatml/chatml-backend/provider"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- normalizeMessages tests ---

func TestNormalize_Empty(t *testing.T) {
	result := normalizeMessages(nil)
	assert.Nil(t, result)
}

func TestNormalize_SingleMessage(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("hello")}},
	}
	result := normalizeMessages(msgs)
	require.Len(t, result, 1)
	assert.Equal(t, provider.RoleUser, result[0].Role)
}

func TestNormalize_MergesConsecutiveUserMessages(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("msg1")}},
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("msg2")}},
	}
	result := normalizeMessages(msgs)
	require.Len(t, result, 1)
	assert.Len(t, result[0].Content, 2)
	assert.Equal(t, "msg1", result[0].Content[0].Text)
	assert.Equal(t, "msg2", result[0].Content[1].Text)
}

func TestNormalize_MergesConsecutiveAssistantMessages(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{provider.NewTextBlock("part1")}},
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{provider.NewTextBlock("part2")}},
	}
	result := normalizeMessages(msgs)
	require.Len(t, result, 1)
	assert.Len(t, result[0].Content, 2)
}

func TestNormalize_PreservesAlternatingRoles(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("q")}},
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{provider.NewTextBlock("a")}},
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("q2")}},
	}
	result := normalizeMessages(msgs)
	require.Len(t, result, 3)
}

func TestNormalize_RemovesEmptyMessages(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("hello")}},
		{Role: provider.RoleAssistant, Content: nil}, // Empty
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{provider.NewTextBlock("hi")}},
	}
	result := normalizeMessages(msgs)
	require.Len(t, result, 2)
	assert.Equal(t, provider.RoleUser, result[0].Role)
	assert.Equal(t, provider.RoleAssistant, result[1].Role)
}

func TestNormalize_ThinkingNotLast(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewThinkingBlock("thinking..."),
		}},
	}
	result := normalizeMessages(msgs)
	require.Len(t, result, 1)
	// Should have appended an empty text block after thinking
	assert.Greater(t, len(result[0].Content), 1)
	assert.Equal(t, provider.BlockText, result[0].Content[len(result[0].Content)-1].Type)
}

func TestNormalize_ThinkingWithTextIsOK(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewThinkingBlock("thinking..."),
			provider.NewTextBlock("response"),
		}},
	}
	result := normalizeMessages(msgs)
	require.Len(t, result, 1)
	// Text is already after thinking — no extra block needed
	assert.Len(t, result[0].Content, 2)
}

func TestNormalize_ComplexMerge(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("a")}},
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("b")}},
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{provider.NewTextBlock("c")}},
		{Role: provider.RoleUser, Content: nil}, // Empty — removed
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("d")}},
	}
	result := normalizeMessages(msgs)
	require.Len(t, result, 3)
	// First: merged user a+b
	assert.Len(t, result[0].Content, 2)
	// Second: assistant c
	assert.Equal(t, "c", result[1].Content[0].Text)
	// Third: user d
	assert.Equal(t, "d", result[2].Content[0].Text)
}

// --- applyToolResultBudget tests ---

func TestToolResultBudget_NoTruncation(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			provider.NewToolResultBlock("tu_1", "short result", false),
		}},
	}
	result := applyToolResultBudget(msgs, 50*1024)
	assert.Equal(t, "short result", result[0].Content[0].ResultContent)
}

func TestToolResultBudget_Truncates(t *testing.T) {
	bigResult := strings.Repeat("x", 60*1024) // 60KB
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			provider.NewToolResultBlock("tu_1", bigResult, false),
		}},
	}
	result := applyToolResultBudget(msgs, 50*1024)
	assert.LessOrEqual(t, len(result[0].Content[0].ResultContent), 55*1024) // 50KB + suffix
	assert.Contains(t, result[0].Content[0].ResultContent, "output truncated")
	assert.Contains(t, result[0].Content[0].ResultContent, "61440 bytes total")
}

func TestToolResultBudget_OnlyAffectsToolResults(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			provider.NewTextBlock(strings.Repeat("x", 100*1024)),
		}},
	}
	result := applyToolResultBudget(msgs, 50*1024)
	// Text blocks should not be truncated
	assert.Equal(t, 100*1024, len(result[0].Content[0].Text))
}

func TestToolResultBudget_DefaultLimit(t *testing.T) {
	bigResult := strings.Repeat("x", 60*1024)
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			provider.NewToolResultBlock("tu_1", bigResult, false),
		}},
	}
	result := applyToolResultBudget(msgs, 0) // Uses default
	assert.Contains(t, result[0].Content[0].ResultContent, "output truncated")
}

func TestToolResultBudget_MultiplResults(t *testing.T) {
	small := "ok"
	big := strings.Repeat("x", 60*1024)
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			provider.NewToolResultBlock("tu_1", small, false),
			provider.NewToolResultBlock("tu_2", big, false),
		}},
	}
	result := applyToolResultBudget(msgs, 50*1024)
	assert.Equal(t, "ok", result[0].Content[0].ResultContent)                    // Not truncated
	assert.Contains(t, result[0].Content[1].ResultContent, "output truncated") // Truncated
}
