package provider

import "encoding/json"

// Role represents a message role in the conversation.
type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

// Message represents a single conversation message with typed content blocks.
type Message struct {
	Role    Role           `json:"role"`
	Content []ContentBlock `json:"content"`
}

// ContentBlockType identifies the kind of content block.
type ContentBlockType string

const (
	BlockText       ContentBlockType = "text"
	BlockToolUse    ContentBlockType = "tool_use"
	BlockToolResult ContentBlockType = "tool_result"
	BlockThinking   ContentBlockType = "thinking"
	BlockImage      ContentBlockType = "image"
)

// ContentBlock is a union-style struct. Only fields relevant to Type are populated.
// This mirrors the Anthropic Messages API content block format and is translated
// to/from other provider formats internally.
type ContentBlock struct {
	Type ContentBlockType `json:"type"`

	// Text block fields
	Text string `json:"text,omitempty"`

	// ToolUse block fields
	ToolUseID string          `json:"id,omitempty"`
	ToolName  string          `json:"name,omitempty"`
	Input     json.RawMessage `json:"input,omitempty"`

	// ToolResult block fields
	ForToolUseID string `json:"tool_use_id,omitempty"`
	ResultContent string `json:"content,omitempty"` // Tool output text
	IsError      bool   `json:"is_error,omitempty"`

	// Thinking block fields
	Thinking string `json:"thinking,omitempty"`

	// Image block fields
	MediaType  string `json:"media_type,omitempty"`
	Base64Data string `json:"data,omitempty"`
}

// ToolDef is the tool definition passed to the LLM in the API request.
type ToolDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"` // JSON Schema
}

// StreamEventType identifies the kind of streaming event.
type StreamEventType int

const (
	// EventTextDelta is a partial text content delta.
	EventTextDelta StreamEventType = iota

	// EventThinkingDelta is a partial thinking content delta.
	EventThinkingDelta

	// EventToolUseStart signals the beginning of a tool_use block.
	EventToolUseStart

	// EventToolUseInputDelta is a partial JSON input delta for a tool_use block.
	EventToolUseInputDelta

	// EventToolUseEnd signals the end of a tool_use block (input is complete).
	EventToolUseEnd

	// EventContentBlockStop signals the end of any content block.
	EventContentBlockStop

	// EventMessageStart signals the beginning of the assistant message.
	EventMessageStart

	// EventMessageDelta contains message-level metadata (stop_reason, usage).
	EventMessageDelta

	// EventMessageStop signals the end of the entire message.
	EventMessageStop

	// EventError signals an error during streaming.
	EventError
)

// StreamEvent represents a single event from the streaming LLM response.
type StreamEvent struct {
	Type StreamEventType

	// For EventTextDelta
	Text string

	// For EventThinkingDelta
	Thinking string

	// For EventToolUseStart — the tool block with name and ID (input not yet complete)
	ToolUse *ToolUseBlock

	// For EventToolUseInputDelta — partial JSON input string
	InputDelta string

	// For EventMessageDelta
	StopReason string
	Usage      *Usage

	// For EventError
	Error error
}

// ToolUseBlock represents a complete or partial tool use from the assistant.
type ToolUseBlock struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"` // Complete JSON input (populated after all deltas)
}

// Usage contains token usage information for a response.
type Usage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens,omitempty"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens,omitempty"`
}

// NewTextBlock creates a text content block.
func NewTextBlock(text string) ContentBlock {
	return ContentBlock{Type: BlockText, Text: text}
}

// NewToolUseBlock creates a tool_use content block.
func NewToolUseBlock(id, name string, input json.RawMessage) ContentBlock {
	return ContentBlock{Type: BlockToolUse, ToolUseID: id, ToolName: name, Input: input}
}

// NewToolResultBlock creates a tool_result content block.
func NewToolResultBlock(toolUseID, content string, isError bool) ContentBlock {
	return ContentBlock{Type: BlockToolResult, ForToolUseID: toolUseID, ResultContent: content, IsError: isError}
}

// NewThinkingBlock creates a thinking content block.
func NewThinkingBlock(thinking string) ContentBlock {
	return ContentBlock{Type: BlockThinking, Thinking: thinking}
}

// TextContent extracts all text from a message's content blocks, concatenated.
func (m *Message) TextContent() string {
	var result string
	for _, b := range m.Content {
		if b.Type == BlockText {
			result += b.Text
		}
	}
	return result
}

// ToolUseBlocks extracts all tool_use blocks from a message.
func (m *Message) ToolUseBlocks() []ContentBlock {
	var blocks []ContentBlock
	for _, b := range m.Content {
		if b.Type == BlockToolUse {
			blocks = append(blocks, b)
		}
	}
	return blocks
}
