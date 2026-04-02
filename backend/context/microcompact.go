package context

import (
	"github.com/chatml/chatml-backend/provider"
)

// Tools whose results can be cleared during microcompaction.
// These are read-only or output-heavy tools — their results become stale quickly.
var clearableTools = map[string]bool{
	"Bash":      true,
	"Grep":      true,
	"Glob":      true,
	"Read":      true,
	"WebFetch":  true,
	"WebSearch": true,
}

// Tools whose results should NEVER be cleared — they show what was changed.
var preserveTools = map[string]bool{
	"Write":        true,
	"Edit":         true,
	"NotebookEdit": true,
	"TodoWrite":    true,
}

const clearedMessage = "[Tool result cleared to save context]"

// Microcompact clears old tool result contents to free context space.
// It replaces the content of clearable tool results with a placeholder,
// preserving only the most recent `keepRecent` tool results.
//
// This is a cheap, fast operation that doesn't require an LLM call.
func Microcompact(messages []provider.Message, keepRecent int) []provider.Message {
	if keepRecent <= 0 {
		keepRecent = 10
	}

	// Count total tool results from the end to determine which ones to keep
	toolResultCount := 0
	// Walk backward to find tool result positions
	type resultPos struct {
		msgIdx   int
		blockIdx int
		toolName string
	}
	var positions []resultPos

	for i := len(messages) - 1; i >= 0; i-- {
		for j := len(messages[i].Content) - 1; j >= 0; j-- {
			block := messages[i].Content[j]
			if block.Type == provider.BlockToolResult {
				// Find the tool name from the corresponding tool_use
				toolName := findToolName(messages, block.ForToolUseID)
				positions = append(positions, resultPos{i, j, toolName})
				toolResultCount++
			}
		}
	}

	// Clear old results (skip the most recent `keepRecent`)
	for idx, pos := range positions {
		if idx < keepRecent {
			continue // Keep the most recent results intact
		}

		// Don't clear preserved tools
		if preserveTools[pos.toolName] {
			continue
		}

		// Only clear if the tool is in the clearable set
		if !clearableTools[pos.toolName] {
			continue
		}

		block := &messages[pos.msgIdx].Content[pos.blockIdx]
		if block.ResultContent != clearedMessage {
			block.ResultContent = clearedMessage
		}
	}

	return messages
}

// findToolName looks up the tool name for a given tool_use ID by searching
// backward through the message history.
func findToolName(messages []provider.Message, toolUseID string) string {
	if toolUseID == "" {
		return ""
	}
	for i := len(messages) - 1; i >= 0; i-- {
		for _, block := range messages[i].Content {
			if block.Type == provider.BlockToolUse && block.ToolUseID == toolUseID {
				return block.ToolName
			}
		}
	}
	return ""
}
