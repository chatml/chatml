package loop

import (
	"strings"
	"testing"

	"github.com/chatml/chatml-backend/provider"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- normalizeMessages pipeline tests ---

func TestNormalize_Empty(t *testing.T) {
	result := normalizeMessages(nil)
	assert.Empty(t, result)
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
		{Role: provider.RoleAssistant, Content: nil}, // Empty — removed by ensureNonEmpty
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{provider.NewTextBlock("hi")}},
	}
	result := normalizeMessages(msgs)
	require.Len(t, result, 2)
	assert.Equal(t, provider.RoleUser, result[0].Role)
	assert.Equal(t, provider.RoleAssistant, result[1].Role)
}

func TestNormalize_ThinkingStrippedFromLastAssistant(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewThinkingBlock("thinking..."),
			provider.NewTextBlock("response"),
		}},
	}
	result := normalizeMessages(msgs)
	require.Len(t, result, 1)
	// Thinking stripped from last assistant, only text remains
	assert.Len(t, result[0].Content, 1)
	assert.Equal(t, "response", result[0].Content[0].Text)
}

func TestNormalize_ThinkingStrippedFromLastAssistantEvenIfNotLast(t *testing.T) {
	// filterTrailingThinking finds the last ASSISTANT message and strips its thinking.
	// This is correct — thinking blocks are ephemeral and shouldn't be replayed.
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewThinkingBlock("thinking..."),
			provider.NewTextBlock("response"),
		}},
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("follow-up")}},
	}
	result := normalizeMessages(msgs)
	require.Len(t, result, 2)
	// Thinking stripped from the last assistant message (which is the first msg)
	assert.Len(t, result[0].Content, 1)
	assert.Equal(t, "response", result[0].Content[0].Text)
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
	assert.Len(t, result[0].Content, 2)           // merged a+b
	assert.Equal(t, "c", result[1].Content[0].Text) // assistant c
	assert.Equal(t, "d", result[2].Content[0].Text) // user d
}

// --- filterOrphanedThinkingMessages tests ---

func TestFilterOrphanedThinking_RemovesThinkingOnly(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("q")}},
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewThinkingBlock("just thinking"),
		}},
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("q2")}},
	}
	result := filterOrphanedThinkingMessages(msgs)
	require.Len(t, result, 2)
	assert.Equal(t, provider.RoleUser, result[0].Role)
	assert.Equal(t, provider.RoleUser, result[1].Role)
}

func TestFilterOrphanedThinking_KeepsThinkingWithText(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewThinkingBlock("thinking"),
			provider.NewTextBlock("text"),
		}},
	}
	result := filterOrphanedThinkingMessages(msgs)
	require.Len(t, result, 1)
}

func TestFilterOrphanedThinking_KeepsUserMessages(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("q")}},
	}
	result := filterOrphanedThinkingMessages(msgs)
	require.Len(t, result, 1)
}

func TestFilterOrphanedThinking_EmptyMessages(t *testing.T) {
	result := filterOrphanedThinkingMessages(nil)
	assert.Empty(t, result)
}

// --- filterWhitespaceAssistant tests ---

func TestFilterWhitespace_RemovesWhitespaceOnly(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewTextBlock("  \n  "),
		}},
	}
	result := filterWhitespaceAssistant(msgs)
	assert.Empty(t, result)
}

func TestFilterWhitespace_KeepsToolUse(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewTextBlock("  "),
			provider.NewToolUseBlock("id1", "Read", nil),
		}},
	}
	result := filterWhitespaceAssistant(msgs)
	require.Len(t, result, 1)
}

func TestFilterWhitespace_KeepsNonWhitespace(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewTextBlock("real content"),
		}},
	}
	result := filterWhitespaceAssistant(msgs)
	require.Len(t, result, 1)
}

// --- filterTrailingThinking tests ---

func TestFilterTrailing_RemovesFromLastAssistant(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("q")}},
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewTextBlock("answer"),
			provider.NewThinkingBlock("trailing thought"),
		}},
	}
	result := filterTrailingThinking(msgs)
	require.Len(t, result, 2)
	// Last assistant should have thinking stripped
	assert.Len(t, result[1].Content, 1)
	assert.Equal(t, provider.BlockText, result[1].Content[0].Type)
}

func TestFilterTrailing_PreservesNonLastAssistant(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewThinkingBlock("thinking"),
			provider.NewTextBlock("answer"),
		}},
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("ok")}},
	}
	result := filterTrailingThinking(msgs)
	// Last assistant is the first message, but last message overall is user.
	// filterTrailingThinking finds the last ASSISTANT message and strips thinking.
	require.Len(t, result, 2)
	assert.Len(t, result[0].Content, 1) // thinking stripped
	assert.Equal(t, "answer", result[0].Content[0].Text)
}

func TestFilterTrailing_NoAssistant(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("q")}},
	}
	result := filterTrailingThinking(msgs)
	require.Len(t, result, 1)
}

// --- ensureNonEmptyAssistant tests ---

func TestEnsureNonEmpty_RemovesEmptyAssistant(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("q")}},
		{Role: provider.RoleAssistant, Content: nil},
	}
	result := ensureNonEmptyAssistant(msgs)
	require.Len(t, result, 1)
	assert.Equal(t, provider.RoleUser, result[0].Role)
}

func TestEnsureNonEmpty_KeepsNonEmpty(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{provider.NewTextBlock("hi")}},
	}
	result := ensureNonEmptyAssistant(msgs)
	require.Len(t, result, 1)
}

// --- sanitizeErrorToolResults tests ---

func TestSanitizeError_TrimsWhitespace(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			{Type: provider.BlockToolResult, ToolUseID: "tu_1", ResultContent: "  error message  ", IsError: true},
		}},
	}
	result := sanitizeErrorToolResults(msgs)
	assert.Equal(t, "error message", result[0].Content[0].ResultContent)
}

func TestSanitizeError_SkipsNonError(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			{Type: provider.BlockToolResult, ToolUseID: "tu_1", ResultContent: "  result  ", IsError: false},
		}},
	}
	result := sanitizeErrorToolResults(msgs)
	assert.Equal(t, "  result  ", result[0].Content[0].ResultContent) // Not trimmed
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
	assert.LessOrEqual(t, len(result[0].Content[0].ResultContent), 55*1024)
	assert.Contains(t, result[0].Content[0].ResultContent, "output truncated")
}

func TestToolResultBudget_OnlyAffectsToolResults(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			provider.NewTextBlock(strings.Repeat("x", 100*1024)),
		}},
	}
	result := applyToolResultBudget(msgs, 50*1024)
	assert.Equal(t, 100*1024, len(result[0].Content[0].Text))
}

func TestToolResultBudget_DefaultLimit(t *testing.T) {
	bigResult := strings.Repeat("x", 60*1024)
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			provider.NewToolResultBlock("tu_1", bigResult, false),
		}},
	}
	result := applyToolResultBudget(msgs, 0)
	assert.Contains(t, result[0].Content[0].ResultContent, "output truncated")
}

func TestToolResultBudget_MultipleResults(t *testing.T) {
	small := "ok"
	big := strings.Repeat("x", 60*1024)
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			provider.NewToolResultBlock("tu_1", small, false),
			provider.NewToolResultBlock("tu_2", big, false),
		}},
	}
	result := applyToolResultBudget(msgs, 50*1024)
	assert.Equal(t, "ok", result[0].Content[0].ResultContent)
	assert.Contains(t, result[0].Content[1].ResultContent, "output truncated")
}

// --- stripOversizedContent tests ---

func TestStripOversized_Images(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			{Type: provider.BlockImage, MediaType: "image/png"},
			provider.NewTextBlock("text"),
		}},
	}
	result := stripOversizedContent(msgs, "image is too large for the API")
	require.Len(t, result[0].Content, 2)
	assert.Equal(t, provider.BlockText, result[0].Content[0].Type)
	assert.Contains(t, result[0].Content[0].Text, "Image removed")
}

func TestStripOversized_NoMatchingError(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			{Type: provider.BlockImage, MediaType: "image/png"},
		}},
	}
	result := stripOversizedContent(msgs, "rate limit exceeded")
	assert.Equal(t, provider.BlockImage, result[0].Content[0].Type) // Unchanged
}

// --- normalizeForRetry tests ---

func TestNormalizeForRetry_CombinesPipeline(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			{Type: provider.BlockImage, MediaType: "image/png"},
		}},
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewThinkingBlock("orphaned"),
		}},
	}
	result := normalizeForRetry(msgs, "image too large")
	// Image should be replaced, orphaned thinking should be removed
	require.Len(t, result, 1) // Only user message remains
	assert.Contains(t, result[0].Content[0].Text, "Image removed")
}

// --- Integration: full pipeline ---

func TestNormalize_FullPipeline(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("q1")}},
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewThinkingBlock("only thinking"), // Orphaned — removed
		}},
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("q2")}},
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewTextBlock("  \t  "), // Whitespace-only — removed
		}},
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("q3")}},
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{
			provider.NewTextBlock("good answer"),
			provider.NewThinkingBlock("trailing"), // If this is the last assistant, stripped
		}},
	}
	result := normalizeMessages(msgs)

	// After removing orphaned thinking + whitespace assistant:
	// All three user messages become consecutive → merged into one.
	// Result: user(q1+q2+q3), assistant(good answer)
	require.Len(t, result, 2)
	assert.Equal(t, provider.RoleUser, result[0].Role)
	assert.Len(t, result[0].Content, 3) // q1 + q2 + q3 merged
	assert.Equal(t, provider.RoleAssistant, result[1].Role)
	// Trailing thinking stripped from last assistant
	assert.Len(t, result[1].Content, 1)
	assert.Equal(t, "good answer", result[1].Content[0].Text)
}
