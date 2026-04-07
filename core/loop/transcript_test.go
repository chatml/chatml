package loop

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chatml/chatml-core/provider"
)

func TestTranscriptWriteAndRead(t *testing.T) {
	dir := t.TempDir()
	sessionID := "test-session-123"

	// Write a transcript
	tw, err := NewTranscriptWriter(dir, sessionID, "")
	if err != nil {
		t.Fatalf("failed to create writer: %v", err)
	}

	// Write metadata
	err = tw.WriteMetadata(TranscriptMeta{
		Model:     "claude-opus-4-6",
		CreatedAt: time.Now(),
		Title:     "Test session",
	})
	if err != nil {
		t.Fatalf("failed to write metadata: %v", err)
	}

	// Write messages
	userMsg := provider.Message{
		Role:    provider.RoleUser,
		Content: []provider.ContentBlock{provider.NewTextBlock("Hello")},
	}
	err = tw.WriteMessage(userMsg)
	if err != nil {
		t.Fatalf("failed to write user message: %v", err)
	}

	assistantMsg := provider.Message{
		Role:    provider.RoleAssistant,
		Content: []provider.ContentBlock{provider.NewTextBlock("Hi there!")},
	}
	err = tw.WriteMessage(assistantMsg)
	if err != nil {
		t.Fatalf("failed to write assistant message: %v", err)
	}

	tw.Close()

	// Read the transcript back
	path := filepath.Join(dir, sessionID+".jsonl")
	messages, meta, err := ReadTranscript(path)
	if err != nil {
		t.Fatalf("failed to read transcript: %v", err)
	}

	if meta == nil {
		t.Fatal("expected metadata, got nil")
	}
	if meta.Model != "claude-opus-4-6" {
		t.Errorf("expected model 'claude-opus-4-6', got %q", meta.Model)
	}
	if meta.Title != "Test session" {
		t.Errorf("expected title 'Test session', got %q", meta.Title)
	}

	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(messages))
	}
	if messages[0].Role != provider.RoleUser {
		t.Errorf("expected first message role 'user', got %q", messages[0].Role)
	}
	if messages[1].Role != provider.RoleAssistant {
		t.Errorf("expected second message role 'assistant', got %q", messages[1].Role)
	}
}

func TestFindTranscript(t *testing.T) {
	dir := t.TempDir()
	sessionID := "find-test-123"

	// Not found initially
	if path := FindTranscript(dir, sessionID); path != "" {
		t.Errorf("expected empty path, got %q", path)
	}

	// Create a transcript
	tw, _ := NewTranscriptWriter(dir, sessionID, "")
	tw.WriteMessage(provider.Message{ //nolint:errcheck
		Role:    provider.RoleUser,
		Content: []provider.ContentBlock{provider.NewTextBlock("test")},
	})
	tw.Close()

	// Now found
	path := FindTranscript(dir, sessionID)
	if path == "" {
		t.Error("expected to find transcript")
	}
}

func TestListTranscripts(t *testing.T) {
	dir := t.TempDir()

	// Create two transcripts
	for _, id := range []string{"session-1", "session-2"} {
		tw, _ := NewTranscriptWriter(dir, id, "")
		tw.WriteMetadata(TranscriptMeta{Model: "claude-opus-4-6", CreatedAt: time.Now()}) //nolint:errcheck
		tw.WriteMessage(provider.Message{                                                   //nolint:errcheck
			Role:    provider.RoleUser,
			Content: []provider.ContentBlock{provider.NewTextBlock("hello " + id)},
		})
		tw.Close()
	}

	summaries, err := ListTranscripts(dir)
	if err != nil {
		t.Fatalf("failed to list: %v", err)
	}
	if len(summaries) != 2 {
		t.Fatalf("expected 2 transcripts, got %d", len(summaries))
	}
}

func TestTranscriptSubAgent(t *testing.T) {
	dir := t.TempDir()
	parentID := "parent-session"
	childID := "child-session"

	tw, err := NewTranscriptWriter(dir, childID, parentID)
	if err != nil {
		t.Fatalf("failed to create writer: %v", err)
	}

	tw.WriteMessage(provider.Message{ //nolint:errcheck
		Role:    provider.RoleUser,
		Content: []provider.ContentBlock{provider.NewTextBlock("sub-agent prompt")},
	})
	tw.Close()

	messages, _, err := ReadTranscript(filepath.Join(dir, childID+".jsonl"))
	if err != nil {
		t.Fatalf("failed to read: %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(messages))
	}
}

func TestTranscriptDir(t *testing.T) {
	dir := TranscriptDir("/home/user/project")
	// TranscriptDir now uses ~/.chatml/transcripts/ (home-based, not workdir-based)
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home dir")
	}
	expected := filepath.Join(home, ".chatml", "transcripts")
	if dir != expected {
		t.Errorf("expected %q, got %q", expected, dir)
	}
}
