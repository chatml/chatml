package loop

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-core/paths"
	"github.com/chatml/chatml-core/provider"
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

	// Pre-load existing memory manifest so extraction can avoid duplicates
	manifest := me.buildManifest()

	userContent := fmt.Sprintf("Analyze this conversation and extract any memories worth saving:\n\n%s", transcript)
	if manifest != "" {
		userContent = fmt.Sprintf("## Existing memories\n\n%s\n\n## Conversation to analyze\n\n%s", manifest, transcript)
	}

	extractReq := provider.ChatRequest{
		SystemPrompt: memoryExtractionPrompt,
		Messages: []provider.Message{
			{
				Role: provider.RoleUser,
				Content: []provider.ContentBlock{
					provider.NewTextBlock(userContent),
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
	memDir, err := me.memoryDir()
	if err != nil {
		return fmt.Errorf("resolve memory dir: %w", err)
	}
	if err := os.MkdirAll(memDir, 0755); err != nil {
		return fmt.Errorf("create memory dir: %w", err)
	}

	// Save as timestamped file
	filename := fmt.Sprintf("auto_%s.md", time.Now().Format("20060102_150405"))
	path := filepath.Join(memDir, filename)

	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return err
	}

	// Step 2: Update MEMORY.md index with a pointer to the new file.
	// Parse frontmatter to extract name and description for the index entry.
	name, description := parseFrontmatterFields(content)
	if name == "" {
		name = filename
	}
	if description == "" {
		// Use first non-frontmatter line as description
		description = firstContentLine(content)
	}

	indexEntry := fmt.Sprintf("- [%s](%s) — %s\n", name, filename, truncateString(description, 120))
	indexPath := filepath.Join(memDir, "MEMORY.md")

	// Append to MEMORY.md (create if doesn't exist)
	f, err := os.OpenFile(indexPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("open MEMORY.md for append: %w", err)
	}
	defer f.Close()
	_, err = f.WriteString(indexEntry)
	return err
}

// memoryDir returns the primary (.chatml) memory directory path for writing.
func (me *MemoryExtractor) memoryDir() (string, error) {
	return paths.MemoryDir(me.workdir), nil
}

// parseFrontmatterFields extracts name and description from YAML frontmatter.
func parseFrontmatterFields(content string) (name, description string) {
	if !strings.HasPrefix(content, "---\n") {
		return "", ""
	}
	end := strings.Index(content[4:], "\n---")
	if end < 0 {
		return "", ""
	}
	frontmatter := content[4 : 4+end]
	for _, line := range strings.Split(frontmatter, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "name:") {
			name = strings.TrimSpace(strings.TrimPrefix(line, "name:"))
		} else if strings.HasPrefix(line, "description:") {
			description = strings.TrimSpace(strings.TrimPrefix(line, "description:"))
		}
	}
	return name, description
}

// firstContentLine returns the first non-empty line after frontmatter.
func firstContentLine(content string) string {
	// Skip frontmatter
	if strings.HasPrefix(content, "---\n") {
		if end := strings.Index(content[4:], "\n---"); end >= 0 {
			content = content[4+end+4:]
		}
	}
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			return line
		}
	}
	return "auto-extracted memory"
}

// truncateString truncates s to maxLen characters, adding "..." if truncated.
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}

// buildManifest scans the memory directory and builds a summary of existing memories.
// This helps the extraction agent avoid creating duplicates.
func (me *MemoryExtractor) buildManifest() string {
	memDir, err := me.memoryDir()
	if err != nil {
		return ""
	}

	entries, err := os.ReadDir(memDir)
	if err != nil {
		return ""
	}

	var lines []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") || entry.Name() == "MEMORY.md" {
			continue
		}
		// Read first few lines to get frontmatter description
		data, err := os.ReadFile(filepath.Join(memDir, entry.Name()))
		if err != nil {
			continue
		}
		name, desc := parseFrontmatterFields(string(data))
		if name == "" {
			name = entry.Name()
		}
		if desc == "" {
			desc = firstContentLine(string(data))
		}
		lines = append(lines, fmt.Sprintf("- %s: %s", name, truncateString(desc, 100)))
	}

	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n")
}

const memoryExtractionPrompt = `You are a memory extraction system. Analyze the conversation and identify information worth remembering for future conversations.

Extract ONLY information that is:
- User preferences or corrections ("don't do X", "always use Y")
- Project facts not derivable from code (deadlines, external dependencies, team context)
- Role/expertise information about the user
- Pointers to external resources the user mentioned (Linear projects, Grafana dashboards, etc.)

Do NOT extract:
- Code patterns, architecture, or file paths (derivable from code)
- Git history or recent changes (use git log)
- Debugging solutions (the fix is in the code)
- Anything already in CLAUDE.md files
- Ephemeral task details or current conversation state

If existing memories are provided, do NOT duplicate them. Update an existing memory only if new information changes it significantly.

Output each memory as a markdown block with frontmatter:
---
name: short_name
description: one-line description used to decide relevance in future conversations
type: user|feedback|project|reference
---
Content here. For feedback/project types, include a **Why:** line and a **How to apply:** line.

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
