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
	assert.NotNil(t, hub.metrics)
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
		result := hub.Broadcast(event)
		assert.True(t, result.Delivered, "Event should be delivered")
		assert.False(t, result.Backpressure, "Should not signal backpressure")
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
		result := hub.Broadcast(Event{Type: "dropped"})
		assert.False(t, result.Delivered, "Event should not be delivered when channel full")
		done <- true
	}()

	select {
	case <-done:
		// Success - broadcast didn't block even with full channel
	case <-time.After(100 * time.Millisecond):
		t.Fatal("Broadcast blocked when channel was full")
	}

	// Verify dropped message was recorded in metrics
	assert.Equal(t, uint64(1), hub.metrics.messagesDropped.Load())
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

func TestHub_Broadcast_Backpressure(t *testing.T) {
	hub := NewHub()

	// Fill channel to >75% capacity (193 messages, which is > 192 = 256*3/4) to trigger backpressure
	for i := 0; i < 193; i++ {
		hub.broadcast <- Event{Type: "filler"}
	}

	// Next broadcast should signal backpressure
	result := hub.Broadcast(Event{Type: "test"})
	assert.True(t, result.Delivered, "Event should still be delivered")
	assert.True(t, result.Backpressure, "Should signal backpressure at >75% capacity")
	assert.Equal(t, uint64(1), hub.metrics.broadcastBackpressure.Load())
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

// ============================================================================
// Metrics Tests
// ============================================================================

func TestHub_Metrics_Tracking(t *testing.T) {
	hub := NewHub()

	// Initial state
	assert.Equal(t, uint64(0), hub.metrics.messagesDelivered.Load())
	assert.Equal(t, uint64(0), hub.metrics.messagesDropped.Load())
	assert.Equal(t, uint64(0), hub.metrics.clientsDropped.Load())
	assert.Equal(t, int64(0), hub.metrics.currentClients.Load())
	assert.Equal(t, int64(0), hub.metrics.peakClients.Load())

	// Record some metrics
	hub.metrics.recordDelivered()
	hub.metrics.recordDelivered()
	hub.metrics.recordDropped()
	hub.metrics.recordClientDropped()
	hub.metrics.recordBackpressure()
	hub.metrics.recordClientConnect(5)
	hub.metrics.recordClientConnect(10)
	hub.metrics.recordClientDisconnect(8)

	assert.Equal(t, uint64(2), hub.metrics.messagesDelivered.Load())
	assert.Equal(t, uint64(1), hub.metrics.messagesDropped.Load())
	assert.Equal(t, uint64(1), hub.metrics.clientsDropped.Load())
	assert.Equal(t, uint64(1), hub.metrics.broadcastBackpressure.Load())
	assert.Equal(t, int64(8), hub.metrics.currentClients.Load())
	assert.Equal(t, int64(10), hub.metrics.peakClients.Load())
}

func TestHub_GetStats(t *testing.T) {
	hub := NewHub()

	// Add some metrics
	hub.metrics.recordDelivered()
	hub.metrics.recordDropped()
	hub.metrics.recordClientConnect(3)

	stats := hub.GetStats()

	assert.Equal(t, uint64(1), stats["messagesDelivered"])
	assert.Equal(t, uint64(1), stats["messagesDropped"])
	assert.Equal(t, int64(3), stats["currentClients"])
	assert.Equal(t, int64(3), stats["peakClients"])
	assert.Equal(t, 256, stats["broadcastBufferCapacity"])
}

// ============================================================================
// Per-Client Buffer Tests
// ============================================================================

func TestHub_PerClientBuffer_SlowClientDisconnected(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	time.Sleep(10 * time.Millisecond)

	// Create a mock slow client with a tiny buffer that we fill immediately.
	// Note: conn is intentionally nil - this test only exercises hub registration
	// and buffer overflow logic, not the writePump which would use the connection.
	slowClient := &Client{
		send: make(chan []byte, 1), // Very small buffer
		hub:  hub,
	}

	// Register the client
	hub.register <- slowClient
	time.Sleep(10 * time.Millisecond)

	// Fill the client's buffer
	slowClient.send <- []byte("filler")

	// Broadcast multiple events - should trigger slow client disconnect
	for i := 0; i < 5; i++ {
		hub.Broadcast(Event{Type: "test"})
	}

	// Wait for hub to process and disconnect slow client
	time.Sleep(50 * time.Millisecond)

	// Verify client was dropped
	hub.mu.RLock()
	_, exists := hub.clients[slowClient]
	hub.mu.RUnlock()

	assert.False(t, exists, "Slow client should have been disconnected")
	assert.GreaterOrEqual(t, hub.metrics.clientsDropped.Load(), uint64(1), "At least one client drop should be recorded")
}

func TestHub_PerClientBuffer_IsolatesSlowClients(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	time.Sleep(10 * time.Millisecond)

	// Create a fast client with normal buffer.
	// Note: conn is intentionally nil - this test only exercises hub registration
	// and buffer overflow logic, not the writePump which would use the connection.
	fastClient := &Client{
		send: make(chan []byte, clientBufferSize),
		hub:  hub,
	}

	// Create a slow client that will be disconnected (also with nil conn)
	slowClient := &Client{
		send: make(chan []byte, 1), // Very small buffer
		hub:  hub,
	}

	// Register both clients
	hub.register <- fastClient
	hub.register <- slowClient
	time.Sleep(10 * time.Millisecond)

	// Fill slow client's buffer
	slowClient.send <- []byte("filler")

	// Broadcast events
	for i := 0; i < 10; i++ {
		hub.Broadcast(Event{Type: "test"})
	}

	// Wait for processing
	time.Sleep(50 * time.Millisecond)

	// Fast client should still be connected
	hub.mu.RLock()
	fastExists := hub.clients[fastClient]
	slowExists := hub.clients[slowClient]
	hub.mu.RUnlock()

	assert.True(t, fastExists, "Fast client should still be connected")
	assert.False(t, slowExists, "Slow client should have been disconnected")

	// Fast client should have received messages
	assert.Greater(t, len(fastClient.send), 0, "Fast client should have messages in buffer")
}

// ============================================================================
// BroadcastResult Tests
// ============================================================================

func TestBroadcastResult_DefaultValues(t *testing.T) {
	result := BroadcastResult{}
	assert.False(t, result.Delivered)
	assert.False(t, result.Backpressure)
}

func TestBroadcastResult_SuccessfulDelivery(t *testing.T) {
	hub := NewHub()
	result := hub.Broadcast(Event{Type: "test"})

	assert.True(t, result.Delivered)
	assert.False(t, result.Backpressure)
}
