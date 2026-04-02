package loop

import (
	"testing"
	"time"

	"github.com/chatml/chatml-backend/provider"
	"github.com/stretchr/testify/assert"
)

func TestMemoryExtractor_ShouldExtract_NotEnoughTurns(t *testing.T) {
	me := NewMemoryExtractor(nil, "/tmp", 5*time.Minute)
	me.IncrementTurn()
	me.IncrementTurn()
	// Only 2 turns — need at least 5
	assert.False(t, me.ShouldExtract())
}

func TestMemoryExtractor_ShouldExtract_EnoughTurnsAndTime(t *testing.T) {
	me := NewMemoryExtractor(nil, "/tmp", 1*time.Millisecond)
	for i := 0; i < 6; i++ {
		me.IncrementTurn()
	}
	time.Sleep(2 * time.Millisecond)
	assert.True(t, me.ShouldExtract())
}

func TestMemoryExtractor_ShouldExtract_ResetAfterExtract(t *testing.T) {
	me := NewMemoryExtractor(nil, "/tmp", 1*time.Millisecond)
	for i := 0; i < 6; i++ {
		me.IncrementTurn()
	}
	time.Sleep(2 * time.Millisecond)
	assert.True(t, me.ShouldExtract())

	// Extract resets counters (using nil provider — no LLM call)
	me.Extract(nil, nil)
	assert.False(t, me.ShouldExtract())
}

func TestBuildMemoryTranscript_Empty(t *testing.T) {
	assert.Equal(t, "", buildMemoryTranscript(nil))
}

func TestBuildMemoryTranscript_Messages(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock("Hello")}},
		{Role: provider.RoleAssistant, Content: []provider.ContentBlock{provider.NewTextBlock("Hi there")}},
	}
	transcript := buildMemoryTranscript(msgs)
	assert.Contains(t, transcript, "[User]: Hello")
	assert.Contains(t, transcript, "[Assistant]: Hi there")
}

func TestBuildMemoryTranscript_TruncatesLongText(t *testing.T) {
	longText := ""
	for i := 0; i < 1000; i++ {
		longText += "word "
	}
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{provider.NewTextBlock(longText)}},
	}
	transcript := buildMemoryTranscript(msgs)
	assert.Less(t, len(transcript), 600) // Truncated to ~500 chars
	assert.Contains(t, transcript, "...")
}

func TestBuildMemoryTranscript_SkipsToolBlocks(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleUser, Content: []provider.ContentBlock{
			provider.NewToolResultBlock("tu_1", "tool output", false),
		}},
	}
	transcript := buildMemoryTranscript(msgs)
	assert.Equal(t, "", transcript) // Tool results are not included
}

func TestSessionNotes_NilProvider(t *testing.T) {
	sn := NewSessionNotes(nil)
	notes, err := sn.GenerateNotes(nil, nil)
	assert.NoError(t, err)
	assert.Equal(t, "", notes)
}

func TestSessionNotes_EmptyMessages(t *testing.T) {
	sn := NewSessionNotes(nil)
	notes, err := sn.GenerateNotes(nil, []provider.Message{})
	assert.NoError(t, err)
	assert.Equal(t, "", notes)
}
