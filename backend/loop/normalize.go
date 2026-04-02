package loop

import (
	"fmt"

	"github.com/chatml/chatml-backend/provider"
)

const (
	// defaultMaxToolResultBytes is the maximum size of a single tool result content.
	// Results exceeding this are truncated with a suffix message.
	defaultMaxToolResultBytes = 50 * 1024 // 50KB
)

// normalizeMessages prepares messages for the API by:
// 1. Merging consecutive messages with the same role (required for Bedrock, harmless for Claude)
// 2. Removing empty messages
// 3. Ensuring thinking blocks are not the last block in assistant messages
func normalizeMessages(messages []provider.Message) []provider.Message {
	if len(messages) == 0 {
		return messages
	}

	var result []provider.Message

	for _, msg := range messages {
		// Skip empty messages
		if len(msg.Content) == 0 {
			continue
		}

		// Merge with previous message if same role
		if len(result) > 0 && result[len(result)-1].Role == msg.Role {
			last := &result[len(result)-1]
			last.Content = append(last.Content, msg.Content...)
			continue
		}

		result = append(result, msg)
	}

	// Ensure thinking blocks are not the last block in assistant messages
	for i := range result {
		if result[i].Role == provider.RoleAssistant {
			result[i].Content = fixThinkingBlockOrder(result[i].Content)
		}
	}

	return result
}

// fixThinkingBlockOrder ensures thinking blocks are never the last block
// in an assistant message. If thinking is last, append an empty text block.
func fixThinkingBlockOrder(blocks []provider.ContentBlock) []provider.ContentBlock {
	if len(blocks) == 0 {
		return blocks
	}

	last := blocks[len(blocks)-1]
	if last.Type == provider.BlockThinking {
		blocks = append(blocks, provider.NewTextBlock(""))
	}

	return blocks
}

// applyToolResultBudget truncates tool result contents that exceed maxBytes.
// This prevents large tool outputs from consuming the entire context window.
func applyToolResultBudget(messages []provider.Message, maxBytes int) []provider.Message {
	if maxBytes <= 0 {
		maxBytes = defaultMaxToolResultBytes
	}

	for i := range messages {
		for j := range messages[i].Content {
			block := &messages[i].Content[j]
			if block.Type == provider.BlockToolResult && len(block.ResultContent) > maxBytes {
				totalBytes := len(block.ResultContent)
				block.ResultContent = block.ResultContent[:maxBytes] +
					fmt.Sprintf("\n... (output truncated, %d bytes total)", totalBytes)
			}
		}
	}

	return messages
}
