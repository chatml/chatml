package context

import (
	"context"
	"fmt"
	"strings"

	"github.com/chatml/chatml-backend/provider"
)

// CompactResult holds the result of an auto-compaction.
type CompactResult struct {
	Messages       []provider.Message // Compacted message history
	Summary        string             // Generated summary text
	OriginalTokens int                // Tokens before compaction
}

// summarySystemPrompt is the system prompt for the summarization LLM call.
const summarySystemPrompt = `You are a conversation summarizer. Your task is to create a detailed summary of a coding conversation that preserves all critical context needed to continue the work.

Your summary MUST include:
1. The user's primary request and intent
2. Key technical decisions made
3. Files created, modified, or discussed (with paths)
4. Current state of the work (what's done, what's pending)
5. Any errors encountered and how they were resolved
6. Important context the user provided

Output your summary in a structured format. Be thorough but concise.`

// Compact summarizes the conversation via an LLM call and replaces the message
// history with a compact representation: [summary message] + [recent messages].
//
// The keepRecentCount parameter controls how many recent messages to preserve
// verbatim after the summary (typically 4-6 for context continuity).
func Compact(
	ctx context.Context,
	prov provider.Provider,
	messages []provider.Message,
	keepRecentCount int,
) (*CompactResult, error) {
	if len(messages) <= keepRecentCount {
		return nil, fmt.Errorf("not enough messages to compact (have %d, keep %d)", len(messages), keepRecentCount)
	}

	if keepRecentCount <= 0 {
		keepRecentCount = 4
	}

	// Split messages: older messages to summarize + recent messages to keep
	splitIdx := len(messages) - keepRecentCount
	toSummarize := messages[:splitIdx]
	recentMessages := messages[splitIdx:]

	// Build the transcript for summarization
	transcript := buildTranscript(toSummarize)

	// Call the LLM to generate a summary
	summaryReq := provider.ChatRequest{
		Model:        "", // Use default/cheap model
		SystemPrompt: summarySystemPrompt,
		Messages: []provider.Message{
			{
				Role: provider.RoleUser,
				Content: []provider.ContentBlock{
					provider.NewTextBlock(fmt.Sprintf(
						"Please summarize the following coding conversation. Preserve all technical details needed to continue the work.\n\n%s",
						transcript,
					)),
				},
			},
		},
		MaxTokens: MaxOutputForSummary,
	}

	stream, err := prov.StreamChat(ctx, summaryReq)
	if err != nil {
		return nil, fmt.Errorf("compact: LLM call failed: %w", err)
	}

	// Collect the full summary text from the stream
	var summaryText strings.Builder
	for event := range stream {
		if event.Type == provider.EventTextDelta {
			summaryText.WriteString(event.Text)
		}
		if event.Type == provider.EventError && event.Error != nil {
			return nil, fmt.Errorf("compact: LLM stream error: %w", event.Error)
		}
	}

	summary := summaryText.String()
	if summary == "" {
		return nil, fmt.Errorf("compact: LLM returned empty summary")
	}

	// Build compacted message history:
	// 1. A user message containing the summary (so the LLM sees it as context)
	// 2. An assistant ack
	// 3. The recent messages preserved verbatim
	compacted := []provider.Message{
		{
			Role: provider.RoleUser,
			Content: []provider.ContentBlock{
				provider.NewTextBlock(fmt.Sprintf(
					"[This conversation was automatically summarized to save context. Summary of previous conversation:]\n\n%s",
					summary,
				)),
			},
		},
		{
			Role: provider.RoleAssistant,
			Content: []provider.ContentBlock{
				provider.NewTextBlock("I understand the context from the summary. I'll continue from where we left off."),
			},
		},
	}
	compacted = append(compacted, recentMessages...)

	return &CompactResult{
		Messages:       compacted,
		Summary:        summary,
		OriginalTokens: EstimateTokens(messages),
	}, nil
}

// buildTranscript converts messages into a readable text transcript for summarization.
func buildTranscript(messages []provider.Message) string {
	var sb strings.Builder

	for _, msg := range messages {
		role := "User"
		if msg.Role == provider.RoleAssistant {
			role = "Assistant"
		}

		for _, block := range msg.Content {
			switch block.Type {
			case provider.BlockText:
				if block.Text != "" {
					fmt.Fprintf(&sb, "[%s]: %s\n\n", role, block.Text)
				}
			case provider.BlockToolUse:
				fmt.Fprintf(&sb, "[%s used tool %s]: %s\n\n", role, block.ToolName, string(block.Input))
			case provider.BlockToolResult:
				content := block.ResultContent
				if len(content) > 500 {
					content = content[:500] + "... (truncated)"
				}
				prefix := "[Tool result]"
				if block.IsError {
					prefix = "[Tool error]"
				}
				fmt.Fprintf(&sb, "%s: %s\n\n", prefix, content)
			}
		}
	}

	return sb.String()
}
