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
// Ported from Claude Code's compact/prompt.ts with 9 required sections.
const summarySystemPrompt = `You are a conversation summarizer. Your task is to create a detailed summary that preserves ALL critical context needed to continue the work.

RESPOND WITH TEXT ONLY. Do NOT call any tools. Do NOT generate tool_use blocks.

Your summary MUST include these 9 sections:

1. **Primary request and intent**: What did the user ask for? What is the high-level goal?
2. **Key technical concepts**: Architecture decisions, design patterns, libraries, APIs involved.
3. **Files and code sections**: List every file path created, modified, or discussed. Include brief code snippets for critical sections (e.g., function signatures, key logic).
4. **Errors and fixes**: Every error encountered, what caused it, and how it was resolved.
5. **Problem solving**: How were ambiguities resolved? What alternatives were considered and rejected?
6. **All user messages**: Summarize every non-tool user message. Preserve exact quotes for specific instructions.
7. **Pending tasks**: What remains to be done? Any blocked items?
8. **Current work**: What was the most recent thing being worked on? Include file names and code snippets.
9. **Optional next step**: If the conversation ended mid-task, what would the logical next action be?

Be thorough — this summary replaces the full conversation. Missing details cannot be recovered.`

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

	// Retry loop: if the summary prompt itself exceeds context (prompt-too-long),
	// truncate the oldest 20% of messages and retry up to 3 times.
	// Matches Claude Code's truncateHeadForPTLRetry() behavior.
	const maxPTLRetries = 3
	var summary string

	for attempt := 0; attempt <= maxPTLRetries; attempt++ {
		transcript := buildTranscript(toSummarize)

		summaryReq := provider.ChatRequest{
			Model:        "",
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
			// Check if this is a prompt-too-long error
			if isPromptTooLong(err) && attempt < maxPTLRetries && len(toSummarize) > 2 {
				// Truncate oldest 20% of messages and retry
				dropCount := len(toSummarize) / 5
				if dropCount < 1 {
					dropCount = 1
				}
				toSummarize = toSummarize[dropCount:]
				continue
			}
			return nil, fmt.Errorf("compact: LLM call failed: %w", err)
		}

		var summaryText strings.Builder
		for event := range stream {
			if event.Type == provider.EventTextDelta {
				summaryText.WriteString(event.Text)
			}
			if event.Type == provider.EventError && event.Error != nil {
				return nil, fmt.Errorf("compact: LLM stream error: %w", event.Error)
			}
		}

		summary = summaryText.String()
		break // Success
	}

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

// isPromptTooLong returns true if the error indicates the prompt exceeded the context window.
func isPromptTooLong(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "prompt") && strings.Contains(msg, "too long") ||
		strings.Contains(msg, "context") && strings.Contains(msg, "exceed") ||
		strings.Contains(msg, "token") && strings.Contains(msg, "limit")
}
