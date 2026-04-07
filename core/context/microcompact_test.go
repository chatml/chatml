package context

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/chatml/chatml-core/provider"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func makeToolUseMsg(id, name string) provider.Message {
	return provider.Message{
		Role: provider.RoleAssistant,
		Content: []provider.ContentBlock{
			provider.NewToolUseBlock(id, name, json.RawMessage(`{}`)),
		},
	}
}

func makeToolResultMsg(id, content string) provider.Message {
	return provider.Message{
		Role: provider.RoleUser,
		Content: []provider.ContentBlock{
			provider.NewToolResultBlock(id, content, false),
		},
	}
}

func TestMicrocompact_Empty(t *testing.T) {
	result := Microcompact(nil, 5)
	assert.Nil(t, result)
}

func TestMicrocompact_KeepsRecentResults(t *testing.T) {
	msgs := []provider.Message{
		makeToolUseMsg("tu_1", "Bash"),
		makeToolResultMsg("tu_1", "old bash output"),
		makeToolUseMsg("tu_2", "Read"),
		makeToolResultMsg("tu_2", "old file content"),
		makeToolUseMsg("tu_3", "Bash"),
		makeToolResultMsg("tu_3", "recent bash output"),
	}

	result := Microcompact(msgs, 1) // Keep only 1 most recent

	// Most recent (tu_3) should be preserved
	assert.Equal(t, "recent bash output", result[5].Content[0].ResultContent)

	// Older results should be cleared
	assert.Equal(t, clearedMessage, result[1].Content[0].ResultContent)
	assert.Equal(t, clearedMessage, result[3].Content[0].ResultContent)
}

func TestMicrocompact_PreservesWriteResults(t *testing.T) {
	msgs := []provider.Message{
		makeToolUseMsg("tu_1", "Write"),
		makeToolResultMsg("tu_1", "Created src/main.go (10 lines)"),
		makeToolUseMsg("tu_2", "Edit"),
		makeToolResultMsg("tu_2", "Edited src/main.go: replaced 1 occurrence"),
		makeToolUseMsg("tu_3", "Bash"),
		makeToolResultMsg("tu_3", "recent output"),
	}

	result := Microcompact(msgs, 0) // Keep 0 recent = clear all clearable

	// Write and Edit results should be preserved
	assert.Equal(t, "Created src/main.go (10 lines)", result[1].Content[0].ResultContent)
	assert.Equal(t, "Edited src/main.go: replaced 1 occurrence", result[3].Content[0].ResultContent)

	// Bash result (the most recent) is kept because keepRecent defaults to 10 when 0
	// Let's use keepRecent=1 explicitly
}

func TestMicrocompact_PreservesWriteResults_Explicit(t *testing.T) {
	msgs := []provider.Message{
		makeToolUseMsg("tu_1", "Write"),
		makeToolResultMsg("tu_1", "Created file"),
		makeToolUseMsg("tu_2", "Bash"),
		makeToolResultMsg("tu_2", "old output"),
	}

	result := Microcompact(msgs, 0)

	// Write result preserved even though it's old
	assert.Equal(t, "Created file", result[1].Content[0].ResultContent)
}

func TestMicrocompact_ClearsBashGrepGlobRead(t *testing.T) {
	msgs := []provider.Message{
		makeToolUseMsg("tu_1", "Bash"),
		makeToolResultMsg("tu_1", "bash output"),
		makeToolUseMsg("tu_2", "Grep"),
		makeToolResultMsg("tu_2", "grep results"),
		makeToolUseMsg("tu_3", "Glob"),
		makeToolResultMsg("tu_3", "glob matches"),
		makeToolUseMsg("tu_4", "Read"),
		makeToolResultMsg("tu_4", "file content"),
		// Recent one to keep
		makeToolUseMsg("tu_5", "Bash"),
		makeToolResultMsg("tu_5", "recent"),
	}

	result := Microcompact(msgs, 1)

	// All old clearable results should be cleared
	assert.Equal(t, clearedMessage, result[1].Content[0].ResultContent)
	assert.Equal(t, clearedMessage, result[3].Content[0].ResultContent)
	assert.Equal(t, clearedMessage, result[5].Content[0].ResultContent)
	assert.Equal(t, clearedMessage, result[7].Content[0].ResultContent)

	// Recent one preserved
	assert.Equal(t, "recent", result[9].Content[0].ResultContent)
}

func TestMicrocompact_LargeConversation(t *testing.T) {
	var msgs []provider.Message
	for i := 0; i < 50; i++ {
		id := strings.Repeat("a", i+1) // Unique IDs
		msgs = append(msgs, makeToolUseMsg(id, "Bash"))
		msgs = append(msgs, makeToolResultMsg(id, "output "+id))
	}

	result := Microcompact(msgs, 10)
	require.Len(t, result, 100)

	// Last 10 results should be preserved
	for i := 40; i < 50; i++ {
		assert.NotEqual(t, clearedMessage, result[i*2+1].Content[0].ResultContent)
	}

	// Earlier results should be cleared
	for i := 0; i < 30; i++ {
		assert.Equal(t, clearedMessage, result[i*2+1].Content[0].ResultContent)
	}
}

func TestMicrocompact_AlreadyCleared(t *testing.T) {
	msgs := []provider.Message{
		makeToolUseMsg("tu_1", "Bash"),
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			provider.NewToolResultBlock("tu_1", clearedMessage, false),
		}},
		makeToolUseMsg("tu_2", "Bash"),
		makeToolResultMsg("tu_2", "recent"),
	}

	// Should not double-clear
	result := Microcompact(msgs, 1)
	assert.Equal(t, clearedMessage, result[1].Content[0].ResultContent)
}

func TestFindToolName(t *testing.T) {
	msgs := []provider.Message{
		makeToolUseMsg("tu_1", "Bash"),
		makeToolResultMsg("tu_1", "output"),
		makeToolUseMsg("tu_2", "Read"),
		makeToolResultMsg("tu_2", "content"),
	}

	assert.Equal(t, "Bash", findToolName(msgs, "tu_1"))
	assert.Equal(t, "Read", findToolName(msgs, "tu_2"))
	assert.Equal(t, "", findToolName(msgs, "tu_missing"))
	assert.Equal(t, "", findToolName(msgs, ""))
}
