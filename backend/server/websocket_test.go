package server

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================================
// Hub Creation Tests
// ============================================================================

func TestNewHub(t *testing.T) {
	hub := NewHub()

	assert.NotNil(t, hub)
	assert.NotNil(t, hub.clients)
	assert.NotNil(t, hub.broadcast)
	assert.NotNil(t, hub.register)
	assert.NotNil(t, hub.unregister)
}

func TestNewHub_ChannelsInitialized(t *testing.T) {
	hub := NewHub()

	// Verify broadcast channel has buffer of 256
	// We can verify this by sending 256 messages without blocking
	for i := 0; i < 256; i++ {
		select {
		case hub.broadcast <- Event{Type: "test"}:
			// OK - channel accepted the message
		default:
			t.Fatalf("Channel blocked after %d messages, expected buffer of 256", i)
		}
	}
}

// ============================================================================
// Broadcast Tests
// ============================================================================

func TestHub_Broadcast_Success(t *testing.T) {
	hub := NewHub()

	event := Event{
		Type:           "test_event",
		ConversationID: "conv-1",
		Payload:        map[string]string{"key": "value"},
	}

	// Broadcast should not block
	done := make(chan bool)
	go func() {
		hub.Broadcast(event)
		done <- true
	}()

	select {
	case <-done:
		// Success - broadcast returned
	case <-time.After(100 * time.Millisecond):
		t.Fatal("Broadcast blocked unexpectedly")
	}
}

func TestHub_Broadcast_ChannelFull(t *testing.T) {
	hub := NewHub()

	// Fill the channel to capacity (256)
	for i := 0; i < 256; i++ {
		hub.broadcast <- Event{Type: "filler"}
	}

	// Now broadcast should drop the event (non-blocking)
	done := make(chan bool)
	go func() {
		hub.Broadcast(Event{Type: "dropped"})
		done <- true
	}()

	select {
	case <-done:
		// Success - broadcast didn't block even with full channel
	case <-time.After(100 * time.Millisecond):
		t.Fatal("Broadcast blocked when channel was full")
	}
}

func TestHub_Broadcast_MultipleEvents(t *testing.T) {
	hub := NewHub()

	events := []Event{
		{Type: "event1", ConversationID: "conv-1"},
		{Type: "event2", ConversationID: "conv-2"},
		{Type: "event3", AgentID: "agent-1"},
	}

	for _, event := range events {
		hub.Broadcast(event)
	}

	// Verify all events are in the channel
	for i, expected := range events {
		select {
		case actual := <-hub.broadcast:
			assert.Equal(t, expected.Type, actual.Type, "Event %d type mismatch", i)
		default:
			t.Fatalf("Missing event %d in broadcast channel", i)
		}
	}
}

// ============================================================================
// Event Struct Tests
// ============================================================================

func TestEvent_Fields(t *testing.T) {
	event := Event{
		Type:           "assistant_text",
		AgentID:        "agent-123",
		ConversationID: "conv-456",
		Payload:        "Hello, world!",
	}

	assert.Equal(t, "assistant_text", event.Type)
	assert.Equal(t, "agent-123", event.AgentID)
	assert.Equal(t, "conv-456", event.ConversationID)
	assert.Equal(t, "Hello, world!", event.Payload)
}

func TestEvent_EmptyFields(t *testing.T) {
	event := Event{
		Type: "simple_event",
	}

	assert.Equal(t, "simple_event", event.Type)
	assert.Empty(t, event.AgentID)
	assert.Empty(t, event.ConversationID)
	assert.Nil(t, event.Payload)
}

func TestEvent_ComplexPayload(t *testing.T) {
	payload := map[string]interface{}{
		"content": "Test message",
		"tokens":  150,
		"nested": map[string]string{
			"key": "value",
		},
	}

	event := Event{
		Type:    "complex",
		Payload: payload,
	}

	// Verify payload is stored correctly
	payloadMap, ok := event.Payload.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "Test message", payloadMap["content"])
	assert.Equal(t, 150, payloadMap["tokens"])
}

// ============================================================================
// Hub Run Loop Tests (with goroutines)
// ============================================================================

func TestHub_Run_RegisterClient(t *testing.T) {
	hub := NewHub()

	// Start the hub
	go hub.Run()

	// Give hub time to start
	time.Sleep(10 * time.Millisecond)

	// Verify no clients initially
	hub.mu.RLock()
	initialCount := len(hub.clients)
	hub.mu.RUnlock()
	assert.Equal(t, 0, initialCount)
}

func TestHub_Run_ConcurrentBroadcasts(t *testing.T) {
	hub := NewHub()

	// Start the hub
	go hub.Run()
	time.Sleep(10 * time.Millisecond)

	// Send concurrent broadcasts
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			hub.Broadcast(Event{Type: "concurrent", Payload: n})
		}(i)
	}

	// Wait for all broadcasts to complete
	done := make(chan bool)
	go func() {
		wg.Wait()
		done <- true
	}()

	select {
	case <-done:
		// All broadcasts completed without deadlock
	case <-time.After(time.Second):
		t.Fatal("Concurrent broadcasts deadlocked")
	}
}

// ============================================================================
// Edge Cases
// ============================================================================

func TestHub_EmptyClients(t *testing.T) {
	hub := NewHub()

	// Verify empty clients map
	hub.mu.RLock()
	count := len(hub.clients)
	hub.mu.RUnlock()

	assert.Equal(t, 0, count)
}

func TestHub_BroadcastToEmptyHub(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	time.Sleep(10 * time.Millisecond)

	// Should not panic or block with no clients
	hub.Broadcast(Event{Type: "test"})

	// Give the broadcast time to process
	time.Sleep(10 * time.Millisecond)
}
