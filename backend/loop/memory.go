package loop

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/provider"
)

// MemoryExtractor runs in the background and periodically analyzes the conversation
// to extract memories (user preferences, project facts, feedback) into workspace
// memory files. This matches Claude Code's auto-memory system.
type MemoryExtractor struct {
	provider  provider.Provider
	workdir   string
	interval  time.Duration
	mu        sync.Mutex
	lastRun   time.Time
	turnCount int
}

// NewMemoryExtractor creates a memory extractor that runs every `interval` or
// after `turnsThreshold` turns, whichever comes first.
func NewMemoryExtractor(prov provider.Provider, workdir string, interval time.Duration) *MemoryExtractor {
	return &MemoryExtractor{
		provider: prov,
		workdir:  workdir,
		interval: interval,
		lastRun:  time.Now(),
	}
}

// IncrementTurn records that a turn has completed.
func (me *MemoryExtractor) IncrementTurn() {
	me.mu.Lock()
	me.turnCount++
	me.mu.Unlock()
}

// ShouldExtract returns true if enough time or turns have passed to trigger extraction.
func (me *MemoryExtractor) ShouldExtract() bool {
	me.mu.Lock()
	defer me.mu.Unlock()

	if me.turnCount < 5 {
		return false // Need at least 5 turns of context
	}

	return time.Since(me.lastRun) >= me.interval
}

// Extract analyzes the conversation and saves any extracted memories.
// This is meant to be called in a background goroutine.
func (me *MemoryExtractor) Extract(ctx context.Context, messages []provider.Message) error {
	me.mu.Lock()
	me.lastRun = time.Now()
	me.turnCount = 0
	me.mu.Unlock()

	if me.provider == nil {
		return nil
	}

	// Build a transcript of the conversation for analysis
	transcript := buildMemoryTranscript(messages)
	if transcript == "" {
		return nil
	}

	extractReq := provider.ChatRequest{
		SystemPrompt: memoryExtractionPrompt,
		Messages: []provider.Message{
			{
				Role: provider.RoleUser,
				Content: []provider.ContentBlock{
					provider.NewTextBlock(fmt.Sprintf(
						"Analyze this conversation and extract any memories worth saving:\n\n%s",
						transcript,
					)),
				},
			},
		},
		MaxTokens: 2000,
	}

	stream, err := me.provider.StreamChat(ctx, extractReq)
	if err != nil {
		return fmt.Errorf("memory extraction LLM call failed: %w", err)
	}

	var result strings.Builder
	for event := range stream {
		if event.Type == provider.EventTextDelta {
			result.WriteString(event.Text)
		}
		if event.Type == provider.EventError && event.Error != nil {
			return fmt.Errorf("memory extraction stream error: %w", event.Error)
		}
	}

	extracted := strings.TrimSpace(result.String())
	if extracted == "" || extracted == "NONE" {
		return nil // No memories to save
	}

	// Save to workspace memory directory
	return me.saveMemory(extracted)
}

func (me *MemoryExtractor) saveMemory(content string) error {
	memDir := filepath.Join(me.workdir, ".claude", "memory")
	if err := os.MkdirAll(memDir, 0755); err != nil {
		return fmt.Errorf("create memory dir: %w", err)
	}

	// Save as timestamped file
	filename := fmt.Sprintf("auto_%s.md", time.Now().Format("20060102_150405"))
	path := filepath.Join(memDir, filename)

	return os.WriteFile(path, []byte(content), 0644)
}

const memoryExtractionPrompt = `You are a memory extraction system. Analyze the conversation and identify information worth remembering for future conversations.

Extract ONLY information that is:
- User preferences or corrections ("don't do X", "always use Y")
- Project facts not derivable from code (deadlines, external dependencies, team context)
- Role/expertise information about the user

Output each memory as a markdown block with frontmatter:
---
name: short_name
description: one-line description
type: user|feedback|project|reference
---
Content here.

If there are no memories worth extracting, output exactly: NONE`

// buildMemoryTranscript creates a condensed transcript for memory analysis.
func buildMemoryTranscript(messages []provider.Message) string {
	var sb strings.Builder
	for _, msg := range messages {
		role := "User"
		if msg.Role == provider.RoleAssistant {
			role = "Assistant"
		}
		for _, block := range msg.Content {
			if block.Type == provider.BlockText && block.Text != "" {
				text := block.Text
				if len(text) > 500 {
					text = text[:500] + "..."
				}
				fmt.Fprintf(&sb, "[%s]: %s\n", role, text)
			}
		}
	}
	return sb.String()
}

// SessionNotes extracts a running summary of what's been accomplished in the session.
// Unlike auto-memory (which extracts persistent facts), session notes capture
// the current state of work for session resume.
type SessionNotes struct {
	provider provider.Provider
}

// NewSessionNotes creates a session notes extractor.
func NewSessionNotes(prov provider.Provider) *SessionNotes {
	return &SessionNotes{provider: prov}
}

// GenerateNotes creates a summary of the conversation for session resume.
func (sn *SessionNotes) GenerateNotes(ctx context.Context, messages []provider.Message) (string, error) {
	if sn.provider == nil {
		return "", nil
	}

	transcript := buildMemoryTranscript(messages)
	if transcript == "" {
		return "", nil
	}

	req := provider.ChatRequest{
		SystemPrompt: sessionNotesPrompt,
		Messages: []provider.Message{
			{
				Role: provider.RoleUser,
				Content: []provider.ContentBlock{
					provider.NewTextBlock(fmt.Sprintf(
						"Generate session notes for this conversation:\n\n%s",
						transcript,
					)),
				},
			},
		},
		MaxTokens: 4000,
	}

	stream, err := sn.provider.StreamChat(ctx, req)
	if err != nil {
		return "", fmt.Errorf("session notes LLM call failed: %w", err)
	}

	var result strings.Builder
	for event := range stream {
		if event.Type == provider.EventTextDelta {
			result.WriteString(event.Text)
		}
	}

	return strings.TrimSpace(result.String()), nil
}

const sessionNotesPrompt = `You are a session note-taker. Create a concise summary of this coding conversation that captures:

1. What the user asked for
2. What was accomplished (files created/modified, features implemented)
3. Current state (what's done, what's in progress, what's pending)
4. Any decisions made or problems encountered

Keep it under 500 words. Use bullet points. This will be used to resume the session later.`
