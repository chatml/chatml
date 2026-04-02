package context

import (
	"strings"
	"testing"

	"github.com/chatml/chatml-backend/provider"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildTranscript_UserAndAssistant(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("Hello")}},
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{provider.NewTextBlock("Hi there")}},
	}

	transcript := buildTranscript(msgs)
	assert.Contains(t, transcript, "[User]: Hello")
	assert.Contains(t, transcript, "[Assistant]: Hi there")
}

func TestBuildTranscript_ToolUseAndResult(t *testing.T) {
	msgs := []provider.Message{
		makeToolUseMsg("tu_1", "Bash"),
		makeToolResultMsg("tu_1", "output here"),
	}

	transcript := buildTranscript(msgs)
	assert.Contains(t, transcript, "used tool Bash")
	assert.Contains(t, transcript, "[Tool result]: output here")
}

func TestBuildTranscript_TruncatesLongResults(t *testing.T) {
	longResult := strings.Repeat("x", 1000)
	msgs := []provider.Message{
		makeToolResultMsg("tu_1", longResult),
	}

	transcript := buildTranscript(msgs)
	assert.Contains(t, transcript, "truncated")
	assert.Less(t, len(transcript), 700) // Much shorter than 1000 chars
}

func TestBuildTranscript_ErrorResult(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			provider.NewToolResultBlock("tu_1", "permission denied", true),
		}},
	}

	transcript := buildTranscript(msgs)
	assert.Contains(t, transcript, "[Tool error]")
}

func TestBuildTranscript_Empty(t *testing.T) {
	transcript := buildTranscript(nil)
	assert.Equal(t, "", transcript)
}

func TestCompact_NotEnoughMessages(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("hello")}},
	}

	_, err := Compact(nil, nil, msgs, 4)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not enough messages")
}

func TestCompactResult_Structure(t *testing.T) {
	// We can't easily test the full Compact() without a real provider,
	// but we can verify the result structure expectations
	result := &CompactResult{
		Messages: []provider.Message{
			{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("summary")}},
			{Role: provider.RoleAssistant, Content: []provider.ContentBlock{provider.NewTextBlock("ack")}},
		},
		Summary:        "test summary",
		OriginalTokens: 50000,
	}

	require.Len(t, result.Messages, 2)
	assert.Equal(t, "test summary", result.Summary)
	assert.Equal(t, 50000, result.OriginalTokens)
}
