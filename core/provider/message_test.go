package provider

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNewTextBlock(t *testing.T) {
	b := NewTextBlock("hello world")
	assert.Equal(t, BlockText, b.Type)
	assert.Equal(t, "hello world", b.Text)
	assert.Empty(t, b.ToolUseID)
	assert.Empty(t, b.ToolName)
}

func TestNewToolUseBlock(t *testing.T) {
	input := json.RawMessage(`{"command":"ls"}`)
	b := NewToolUseBlock("tu_123", "Bash", input)
	assert.Equal(t, BlockToolUse, b.Type)
	assert.Equal(t, "tu_123", b.ToolUseID)
	assert.Equal(t, "Bash", b.ToolName)
	assert.JSONEq(t, `{"command":"ls"}`, string(b.Input))
}

func TestNewToolResultBlock(t *testing.T) {
	b := NewToolResultBlock("tu_123", "file1.go\nfile2.go", false)
	assert.Equal(t, BlockToolResult, b.Type)
	assert.Equal(t, "tu_123", b.ForToolUseID)
	assert.Equal(t, "file1.go\nfile2.go", b.ResultContent)
	assert.False(t, b.IsError)
}

func TestNewToolResultBlock_Error(t *testing.T) {
	b := NewToolResultBlock("tu_456", "file not found", true)
	assert.Equal(t, BlockToolResult, b.Type)
	assert.True(t, b.IsError)
}

func TestNewThinkingBlock(t *testing.T) {
	b := NewThinkingBlock("Let me think about this...")
	assert.Equal(t, BlockThinking, b.Type)
	assert.Equal(t, "Let me think about this...", b.Thinking)
}

func TestMessage_TextContent(t *testing.T) {
	msg := Message{
		Role: RoleAssistant,
		Content: []ContentBlock{
			NewThinkingBlock("thinking..."),
			NewTextBlock("Hello "),
			NewToolUseBlock("tu_1", "Bash", json.RawMessage(`{}`)),
			NewTextBlock("world"),
		},
	}
	assert.Equal(t, "Hello world", msg.TextContent())
}

func TestMessage_TextContent_Empty(t *testing.T) {
	msg := Message{
		Role:    RoleAssistant,
		Content: []ContentBlock{},
	}
	assert.Equal(t, "", msg.TextContent())
}

func TestMessage_ToolUseBlocks(t *testing.T) {
	msg := Message{
		Role: RoleAssistant,
		Content: []ContentBlock{
			NewTextBlock("I'll read the file"),
			NewToolUseBlock("tu_1", "Read", json.RawMessage(`{"file_path":"/tmp/a.go"}`)),
			NewToolUseBlock("tu_2", "Grep", json.RawMessage(`{"pattern":"foo"}`)),
			NewTextBlock("Done"),
		},
	}

	blocks := msg.ToolUseBlocks()
	assert.Len(t, blocks, 2)
	assert.Equal(t, "Read", blocks[0].ToolName)
	assert.Equal(t, "Grep", blocks[1].ToolName)
}

func TestMessage_ToolUseBlocks_None(t *testing.T) {
	msg := Message{
		Role: RoleAssistant,
		Content: []ContentBlock{
			NewTextBlock("Just text"),
		},
	}
	assert.Nil(t, msg.ToolUseBlocks())
}

func TestContentBlock_JSONRoundTrip(t *testing.T) {
	original := NewToolUseBlock("tu_99", "Edit", json.RawMessage(`{"file_path":"/x.go","old_string":"a","new_string":"b"}`))

	data, err := json.Marshal(original)
	assert.NoError(t, err)

	var decoded ContentBlock
	err = json.Unmarshal(data, &decoded)
	assert.NoError(t, err)

	assert.Equal(t, original.Type, decoded.Type)
	assert.Equal(t, original.ToolUseID, decoded.ToolUseID)
	assert.Equal(t, original.ToolName, decoded.ToolName)
	assert.JSONEq(t, string(original.Input), string(decoded.Input))
}

func TestMessage_JSONRoundTrip(t *testing.T) {
	original := Message{
		Role: RoleUser,
		Content: []ContentBlock{
			NewTextBlock("Fix the bug"),
			{
				Type:      BlockImage,
				MediaType: "image/png",
				Base64Data: "iVBORw0KGgo=",
			},
		},
	}

	data, err := json.Marshal(original)
	assert.NoError(t, err)

	var decoded Message
	err = json.Unmarshal(data, &decoded)
	assert.NoError(t, err)

	assert.Equal(t, RoleUser, decoded.Role)
	assert.Len(t, decoded.Content, 2)
	assert.Equal(t, "Fix the bug", decoded.Content[0].Text)
	assert.Equal(t, "image/png", decoded.Content[1].MediaType)
}
