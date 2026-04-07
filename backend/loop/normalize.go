package loop

import (
	"fmt"
	"strings"

	"github.com/chatml/chatml-core/provider"
)

const (
	// defaultMaxToolResultBytes is the maximum size of a single tool result content.
	// Results exceeding this are truncated with a suffix message.
	defaultMaxToolResultBytes = 50 * 1024 // 50KB

	// defaultMaxAggregateResultBytes is the maximum aggregate size of all tool results
	// in a single message group (user message containing tool_result blocks).
	defaultMaxAggregateResultBytes = 200 * 1024 // 200KB
)

// cloneMessages creates a deep copy of the message slice so that normalizers
// can modify Content blocks without aliasing the caller's backing array.
func cloneMessages(messages []provider.Message) []provider.Message {
	cloned := make([]provider.Message, len(messages))
	for i, msg := range messages {
		cloned[i] = provider.Message{Role: msg.Role}
		if len(msg.Content) > 0 {
			cloned[i].Content = make([]provider.ContentBlock, len(msg.Content))
			copy(cloned[i].Content, msg.Content)
		}
	}
	return cloned
}

// normalizeMessages prepares messages for the API by running a pipeline of
// normalization passes. The order matters — see inline comments.
// Ported from Claude Code's normalizeMessagesForAPI() in messages.ts.
// The input slice is deep-copied first so in-place passes do not mutate the caller's data.
func normalizeMessages(messages []provider.Message) []provider.Message {
	if len(messages) == 0 {
		return messages
	}

	// Deep-copy so that in-place mutations (filterTrailingThinking, sanitizeErrorToolResults,
	// hoistToolResults) do not affect the caller's live conversation history.
	messages = cloneMessages(messages)

	// 1. Remove assistant messages that contain ONLY thinking blocks (no text/tool_use).
	//    These cause API 400 errors. Must happen BEFORE merging.
	messages = filterOrphanedThinkingMessages(messages)

	// 2. Remove assistant messages where all text is whitespace and no tool_use blocks.
	messages = filterWhitespaceAssistant(messages)

	// 3. Merge consecutive same-role messages (required for Bedrock, harmless for Claude).
	messages = mergeConsecutiveSameRole(messages)

	// 3.5. Ensure every tool_use has a matching tool_result.
	//       Missing pairs cause API 400 errors. Must happen AFTER merge.
	messages = ensureToolResultPairing(messages)

	// 3.6. Hoist tool_result blocks to the start of user message content.
	//       The API requires tool_result blocks before text blocks.
	messages = hoistToolResults(messages)

	// 4. Strip trailing thinking blocks from the LAST assistant message.
	//    Must happen AFTER merging since merge can change which message is last.
	messages = filterTrailingThinking(messages)

	// 5. Ensure all assistant messages have at least one content block.
	messages = ensureNonEmptyAssistant(messages)

	// 6. Remove image/document blocks from error tool results.
	messages = sanitizeErrorToolResults(messages)

	// 7. Ensure the first message is role=user (API requirement).
	messages = ensureFirstMessageIsUser(messages)

	return messages
}

// filterOrphanedThinkingMessages removes assistant messages that contain ONLY
// thinking blocks (no text, no tool_use). These cause API 400 errors because
// the API requires assistant messages to have at least one non-thinking block
// when thinking blocks are present.
func filterOrphanedThinkingMessages(messages []provider.Message) []provider.Message {
	result := make([]provider.Message, 0, len(messages))
	for _, msg := range messages {
		if msg.Role == provider.RoleAssistant && isThinkingOnly(msg.Content) {
			continue // Drop this message
		}
		result = append(result, msg)
	}
	return result
}

// isThinkingOnly returns true if the content blocks consist entirely of
// thinking blocks with no text or tool_use blocks.
func isThinkingOnly(blocks []provider.ContentBlock) bool {
	if len(blocks) == 0 {
		return false // Empty is not "thinking only"
	}
	for _, b := range blocks {
		if b.Type != provider.BlockThinking {
			return false
		}
	}
	return true
}

// filterWhitespaceAssistant removes assistant messages where all text blocks
// are whitespace-only and there are no tool_use blocks. These add noise without
// information.
func filterWhitespaceAssistant(messages []provider.Message) []provider.Message {
	result := make([]provider.Message, 0, len(messages))
	for _, msg := range messages {
		if msg.Role == provider.RoleAssistant && isWhitespaceOnly(msg.Content) {
			continue
		}
		result = append(result, msg)
	}
	return result
}

// isWhitespaceOnly returns true if the message has no tool_use blocks and
// all text blocks contain only whitespace.
func isWhitespaceOnly(blocks []provider.ContentBlock) bool {
	if len(blocks) == 0 {
		return true
	}
	for _, b := range blocks {
		switch b.Type {
		case provider.BlockToolUse:
			return false // Has tool use — not whitespace-only
		case provider.BlockToolResult:
			return false
		case provider.BlockText:
			if strings.TrimSpace(b.Text) != "" {
				return false
			}
		case provider.BlockThinking:
			// Thinking blocks alone don't count as content
			continue
		case provider.BlockImage:
			return false
		default:
			return false
		}
	}
	return true
}

// mergeConsecutiveSameRole merges adjacent messages with the same role.
// This is required for Bedrock and harmless for direct Anthropic API calls.
func mergeConsecutiveSameRole(messages []provider.Message) []provider.Message {
	if len(messages) == 0 {
		return messages
	}

	result := make([]provider.Message, 0, len(messages))
	for _, msg := range messages {
		if len(msg.Content) == 0 {
			continue
		}
		if len(result) > 0 && result[len(result)-1].Role == msg.Role {
			last := &result[len(result)-1]
			last.Content = append(last.Content, msg.Content...)
			continue
		}
		result = append(result, msg)
	}

	// Fix thinking block ordering for all assistant messages
	for i := range result {
		if result[i].Role == provider.RoleAssistant {
			result[i].Content = fixThinkingBlockOrder(result[i].Content)
		}
	}

	return result
}

// filterTrailingThinking strips thinking blocks from the LAST assistant message.
// The API rejects responses that end with thinking content. Unlike fixThinkingBlockOrder
// which adds an empty text block, this actually removes the thinking to prevent
// replaying stale thinking in the next API call.
func filterTrailingThinking(messages []provider.Message) []provider.Message {
	if len(messages) == 0 {
		return messages
	}

	// Find the last assistant message
	lastIdx := -1
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == provider.RoleAssistant {
			lastIdx = i
			break
		}
	}

	if lastIdx < 0 {
		return messages
	}

	// Strip thinking blocks from the last assistant message entirely.
	// The API rejects thinking blocks when they're sent back as conversation
	// history (thinking is ephemeral to the response that generated it).
	// We replace the entire Message struct (not just Content) to avoid aliasing
	// the original slice's backing data if the pipeline is ever restructured.
	var filtered []provider.ContentBlock
	for _, b := range messages[lastIdx].Content {
		if b.Type == provider.BlockThinking {
			continue
		}
		// Also skip empty text blocks that were added by fixThinkingBlockOrder
		if b.Type == provider.BlockText && b.Text == "" {
			continue
		}
		filtered = append(filtered, b)
	}
	messages[lastIdx] = provider.Message{Role: messages[lastIdx].Role, Content: filtered}

	return messages
}

// ensureNonEmptyAssistant ensures all assistant messages have at least one
// content block. Empty assistant messages cause API errors.
func ensureNonEmptyAssistant(messages []provider.Message) []provider.Message {
	result := make([]provider.Message, 0, len(messages))
	for _, msg := range messages {
		if msg.Role == provider.RoleAssistant && len(msg.Content) == 0 {
			// Skip truly empty assistant messages rather than inject placeholder
			continue
		}
		result = append(result, msg)
	}
	return result
}

// sanitizeErrorToolResults removes image and document blocks from tool_result
// blocks that are marked as errors. The API rejects rich content in error results,
// and retrying with them causes infinite loops.
func sanitizeErrorToolResults(messages []provider.Message) []provider.Message {
	for i := range messages {
		for j := range messages[i].Content {
			block := &messages[i].Content[j]
			if block.Type == provider.BlockToolResult && block.IsError {
				// Strip any non-text content from error results
				block.ResultContent = strings.TrimSpace(block.ResultContent)
			}
		}
	}
	return messages
}

// ensureToolResultPairing validates that every tool_use block in an assistant
// message has a matching tool_result block in the subsequent user message.
// Inserts synthetic tool_result blocks for any orphaned tool_use IDs.
// Builds a new result slice rather than mutating in place to avoid index
// arithmetic errors when insertions change the slice length mid-iteration.
func ensureToolResultPairing(messages []provider.Message) []provider.Message {
	result := make([]provider.Message, 0, len(messages)+4)

	for i := 0; i < len(messages); i++ {
		result = append(result, messages[i])

		if messages[i].Role != provider.RoleAssistant {
			continue
		}

		// Collect all tool_use IDs from this assistant message
		toolUseIDs := make(map[string]bool)
		for _, b := range messages[i].Content {
			if b.Type == provider.BlockToolUse && b.ToolUseID != "" {
				toolUseIDs[b.ToolUseID] = true
			}
		}
		if len(toolUseIDs) == 0 {
			continue
		}

		// Find the next user message in the original slice
		nextUserIdx := -1
		for j := i + 1; j < len(messages); j++ {
			if messages[j].Role == provider.RoleUser {
				nextUserIdx = j
				break
			}
		}

		if nextUserIdx < 0 {
			// No user message follows — insert a synthetic one with tool results
			var resultBlocks []provider.ContentBlock
			for id := range toolUseIDs {
				resultBlocks = append(resultBlocks, provider.NewToolResultBlock(id, "[Tool result not available]", false))
			}
			result = append(result, provider.Message{Role: provider.RoleUser, Content: resultBlocks})
			continue
		}

		// Check which tool_use IDs have matching tool_result blocks
		for _, b := range messages[nextUserIdx].Content {
			if b.Type == provider.BlockToolResult {
				delete(toolUseIDs, b.ForToolUseID) // ForToolUseID, not ToolUseID
			}
		}

		// Add synthetic tool_result blocks for any unmatched IDs.
		// We modify the Content of the message that will be appended when
		// we reach nextUserIdx in the outer loop. Clone the content to avoid
		// mutating the original.
		if len(toolUseIDs) > 0 {
			newContent := make([]provider.ContentBlock, len(messages[nextUserIdx].Content))
			copy(newContent, messages[nextUserIdx].Content)
			for id := range toolUseIDs {
				newContent = append(newContent, provider.NewToolResultBlock(id, "[Tool result not available]", false))
			}
			messages[nextUserIdx].Content = newContent
		}
	}
	return result
}

// hoistToolResults reorders content blocks within each user message so that
// tool_result blocks appear before text blocks. The API requires this ordering.
func hoistToolResults(messages []provider.Message) []provider.Message {
	for i := range messages {
		if messages[i].Role != provider.RoleUser {
			continue
		}
		blocks := messages[i].Content
		if len(blocks) <= 1 {
			continue
		}

		// Partition: tool_results first, then everything else
		var toolResults, others []provider.ContentBlock
		for _, b := range blocks {
			if b.Type == provider.BlockToolResult {
				toolResults = append(toolResults, b)
			} else {
				others = append(others, b)
			}
		}

		// Only rearrange if there are both types
		if len(toolResults) > 0 && len(others) > 0 {
			messages[i].Content = append(toolResults, others...)
		}
	}
	return messages
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
// Also enforces an aggregate per-message budget. Note: the aggregate limit
// (defaultMaxAggregateResultBytes) is applied independently per message, not
// globally across all messages. This is intentional — each tool result message
// is self-contained, and a global limit would require a two-pass approach.
func applyToolResultBudget(messages []provider.Message, maxBytes int) []provider.Message {
	if maxBytes <= 0 {
		maxBytes = defaultMaxToolResultBytes
	}

	for i := range messages {
		aggregateSize := 0

		for j := range messages[i].Content {
			block := &messages[i].Content[j]
			if block.Type != provider.BlockToolResult {
				continue
			}

			contentLen := len(block.ResultContent)

			// Per-result budget
			if contentLen > maxBytes {
				totalBytes := contentLen
				block.ResultContent = block.ResultContent[:maxBytes] +
					fmt.Sprintf("\n... (output truncated, %d bytes total)", totalBytes)
				contentLen = len(block.ResultContent)
			}

			aggregateSize += contentLen

			// Aggregate budget: if this message group exceeds the limit,
			// truncate the current result aggressively
			if aggregateSize > defaultMaxAggregateResultBytes {
				overBy := aggregateSize - defaultMaxAggregateResultBytes
				targetLen := contentLen - overBy
				if targetLen < 200 {
					targetLen = 200 // Keep at least a small preview
				}
				if targetLen < contentLen {
					block.ResultContent = block.ResultContent[:targetLen] +
						fmt.Sprintf("\n... (output truncated to fit aggregate budget, %d bytes total)", contentLen)
				}
			}
		}
	}

	return messages
}

// normalizeForRetry applies both error-based content stripping and the full
// normalization pipeline. Used when retrying after API errors.
func normalizeForRetry(messages []provider.Message, errMsg string) []provider.Message {
	messages = stripOversizedContent(messages, errMsg)
	messages = normalizeMessages(messages)
	return messages
}

// stripOversizedContent removes image and large content blocks from messages
// after an API error indicates content was too large. This prevents retry loops
// where the same oversized content is sent repeatedly.
func stripOversizedContent(messages []provider.Message, errMsg string) []provider.Message {
	errLower := strings.ToLower(errMsg)
	stripImages := strings.Contains(errLower, "image") && (strings.Contains(errLower, "too large") || strings.Contains(errLower, "exceeds"))
	stripDocs := strings.Contains(errLower, "document") || strings.Contains(errLower, "pdf")

	if !stripImages && !stripDocs {
		return messages // Error not related to content size
	}

	for i := range messages {
		var filtered []provider.ContentBlock
		for _, block := range messages[i].Content {
			if stripImages && block.Type == provider.BlockImage {
				filtered = append(filtered, provider.NewTextBlock("[Image removed — too large for API]"))
				continue
			}
			filtered = append(filtered, block)
		}
		messages[i].Content = filtered
	}

	return messages
}

// ensureFirstMessageIsUser ensures the first message is role=user.
// The Anthropic API requires conversations to start with a user message.
// If the first message is assistant, prepend a synthetic user message.
func ensureFirstMessageIsUser(messages []provider.Message) []provider.Message {
	if len(messages) == 0 {
		return messages
	}
	if messages[0].Role == provider.RoleUser {
		return messages // Already starts with user
	}

	// Prepend a synthetic user message
	synthetic := provider.Message{
		Role:    provider.RoleUser,
		Content: []provider.ContentBlock{provider.NewTextBlock("[Conversation continued]")},
	}
	return append([]provider.Message{synthetic}, messages...)
}
