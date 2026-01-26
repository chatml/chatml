package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
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

	// Verify broadcast channel has buffer of 1024
	// We can verify this by sending 1024 pre-serialized messages without blocking
	testData, _ := json.Marshal(Event{Type: "test"})
	for i := 0; i < 1024; i++ {
		select {
		case hub.broadcast <- testData:
			// OK - channel accepted the message
		default:
			t.Fatalf("Channel blocked after %d messages, expected buffer of 1024", i)
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

	// Fill the channel to capacity (1024)
	fillerData, _ := json.Marshal(Event{Type: "filler"})
	for i := 0; i < 1024; i++ {
		hub.broadcast <- fillerData
	}

	// Now broadcast should timeout and drop the event after 2 seconds
	done := make(chan bool)
	go func() {
		result := hub.Broadcast(Event{Type: "dropped"})
		assert.False(t, result.Delivered, "Event should not be delivered when channel full")
		done <- true
	}()

	select {
	case <-done:
		// Success - broadcast returned (after timeout)
	case <-time.After(3 * time.Second):
		t.Fatal("Broadcast did not timeout after 2 seconds")
	}

	// Verify timed out message was recorded in metrics
	assert.Equal(t, uint64(1), hub.metrics.messagesTimedOut.Load())
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

	// Verify all events are in the channel (now as pre-serialized JSON)
	for i, expected := range events {
		select {
		case data := <-hub.broadcast:
			var actual Event
			err := json.Unmarshal(data, &actual)
			require.NoError(t, err, "Failed to unmarshal event %d", i)
			assert.Equal(t, expected.Type, actual.Type, "Event %d type mismatch", i)
		default:
			t.Fatalf("Missing event %d in broadcast channel", i)
		}
	}
}

func TestHub_Broadcast_Backpressure(t *testing.T) {
	hub := NewHub()

	// Fill channel to >75% capacity (769 messages, which is > 768 = 1024*3/4) to trigger backpressure
	fillerData, _ := json.Marshal(Event{Type: "filler"})
	for i := 0; i < 769; i++ {
		hub.broadcast <- fillerData
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
	assert.Equal(t, 1024, stats["broadcastBufferCapacity"])
}

// ============================================================================
// Client Buffer Tests
// ============================================================================

func TestClient_SendBufferSize(t *testing.T) {
	hub := NewHub()

	// Create a client with the standard buffer size
	client := &Client{
		hub:  hub,
		conn: nil, // We don't need a real connection for this test
		send: make(chan []byte, clientSendBufferSize),
	}

	// Verify we can queue clientSendBufferSize messages
	testData := []byte(`{"type":"test"}`)
	for i := 0; i < clientSendBufferSize; i++ {
		select {
		case client.send <- testData:
			// OK
		default:
			t.Fatalf("Client send buffer blocked after %d messages, expected %d", i, clientSendBufferSize)
		}
	}

	// Buffer should now be full
	select {
	case client.send <- testData:
		t.Fatal("Client send buffer should be full but accepted another message")
	default:
		// Expected - buffer is full
	}
}

func TestHub_SlowClientEviction(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	time.Sleep(10 * time.Millisecond)

	// Create a mock client with a very small buffer that will fill up
	client := &Client{
		hub:  hub,
		conn: nil,
		send: make(chan []byte, 1), // Tiny buffer
	}

	// Register the client
	hub.register <- client
	time.Sleep(10 * time.Millisecond)

	// Verify client is registered
	hub.mu.RLock()
	clientCount := len(hub.clients)
	hub.mu.RUnlock()
	assert.Equal(t, 1, clientCount, "Client should be registered")

	// Fill the client's buffer
	client.send <- []byte(`{"type":"fill"}`)

	// Now broadcast more - this should trigger eviction
	hub.Broadcast(Event{Type: "overflow1"})
	hub.Broadcast(Event{Type: "overflow2"})

	// Give time for eviction to happen
	time.Sleep(50 * time.Millisecond)

	// Client should be evicted
	hub.mu.RLock()
	clientCount = len(hub.clients)
	hub.mu.RUnlock()
	assert.Equal(t, 0, clientCount, "Slow client should be evicted")

	// Verify client drop was recorded in metrics
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
		hub:  hub,
		send: make(chan []byte, clientSendBufferSize),
	}

	// Create a slow client that will be disconnected (also with nil conn)
	slowClient := &Client{
		hub:  hub,
		send: make(chan []byte, 1), // Very small buffer
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

// ============================================================================
// Timeout Behavior Tests
// ============================================================================

func TestHub_Broadcast_TimeoutBehavior(t *testing.T) {
	hub := NewHub()

	// Fill the channel to capacity (1024)
	fillerData, _ := json.Marshal(Event{Type: "filler"})
	for i := 0; i < 1024; i++ {
		hub.broadcast <- fillerData
	}

	// Measure how long broadcast takes when channel is full
	start := time.Now()
	result := hub.Broadcast(Event{Type: "timed_out"})
	elapsed := time.Since(start)

	// Should take approximately 2 seconds (the timeout duration)
	assert.False(t, result.Delivered, "Event should not be delivered when channel full")
	assert.GreaterOrEqual(t, elapsed, 2*time.Second, "Should wait at least 2 seconds before timing out")
	assert.Less(t, elapsed, 3*time.Second, "Should not wait much longer than 2 seconds")

	// Verify timeout metric was recorded
	assert.Equal(t, uint64(1), hub.metrics.messagesTimedOut.Load())
}

func TestHub_Metrics_TimedOut(t *testing.T) {
	hub := NewHub()

	// Initial state should be zero
	assert.Equal(t, uint64(0), hub.metrics.messagesTimedOut.Load())

	// Record a timeout
	hub.metrics.recordTimedOut()
	assert.Equal(t, uint64(1), hub.metrics.messagesTimedOut.Load())

	// Record another
	hub.metrics.recordTimedOut()
	assert.Equal(t, uint64(2), hub.metrics.messagesTimedOut.Load())
}

func TestHub_GetStats_IncludesTimedOut(t *testing.T) {
	hub := NewHub()

	// Record a timeout
	hub.metrics.recordTimedOut()

	stats := hub.GetStats()

	// Verify messagesTimedOut is included in stats
	timedOut, exists := stats["messagesTimedOut"]
	assert.True(t, exists, "messagesTimedOut should be in stats")
	assert.Equal(t, uint64(1), timedOut)
}

// ============================================================================
// WebSocket Token Validation Tests
// ============================================================================

func TestHandleWebSocket_NoTokenConfigured(t *testing.T) {
	// Ensure no token is set (dev mode)
	os.Unsetenv("CHATML_AUTH_TOKEN")

	hub := NewHub()
	go hub.Run()
	defer func() { time.Sleep(10 * time.Millisecond) }()

	// Create test server
	server := httptest.NewServer(http.HandlerFunc(hub.HandleWebSocket))
	defer server.Close()

	// Convert http URL to ws URL
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	// Set allowed origin for the test
	AllowedOriginsMap[""] = true
	defer delete(AllowedOriginsMap, "")

	// Connect without token - should succeed
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Expected connection to succeed without token in dev mode, got error: %v", err)
	}
	defer conn.Close()

	assert.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
}

func TestHandleWebSocket_ValidToken(t *testing.T) {
	// Set expected token
	testToken := "test-secret-token-12345"
	os.Setenv("CHATML_AUTH_TOKEN", testToken)
	defer os.Unsetenv("CHATML_AUTH_TOKEN")

	hub := NewHub()
	go hub.Run()
	defer func() { time.Sleep(10 * time.Millisecond) }()

	// Create test server
	server := httptest.NewServer(http.HandlerFunc(hub.HandleWebSocket))
	defer server.Close()

	// Convert http URL to ws URL with token query param
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "?token=" + testToken

	// Set allowed origin for the test
	AllowedOriginsMap[""] = true
	defer delete(AllowedOriginsMap, "")

	// Connect with valid token - should succeed
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Expected connection to succeed with valid token, got error: %v", err)
	}
	defer conn.Close()

	assert.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
}

func TestHandleWebSocket_InvalidToken(t *testing.T) {
	// Set expected token
	testToken := "test-secret-token-12345"
	os.Setenv("CHATML_AUTH_TOKEN", testToken)
	defer os.Unsetenv("CHATML_AUTH_TOKEN")

	hub := NewHub()
	go hub.Run()
	defer func() { time.Sleep(10 * time.Millisecond) }()

	// Create test server
	server := httptest.NewServer(http.HandlerFunc(hub.HandleWebSocket))
	defer server.Close()

	// Convert http URL to ws URL with wrong token
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "?token=wrong-token"

	// Set allowed origin for the test
	AllowedOriginsMap[""] = true
	defer delete(AllowedOriginsMap, "")

	// Connect with invalid token - should fail with 401
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.Error(t, err, "Expected connection to fail with invalid token")
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

func TestHandleWebSocket_MissingToken(t *testing.T) {
	// Set expected token
	testToken := "test-secret-token-12345"
	os.Setenv("CHATML_AUTH_TOKEN", testToken)
	defer os.Unsetenv("CHATML_AUTH_TOKEN")

	hub := NewHub()
	go hub.Run()
	defer func() { time.Sleep(10 * time.Millisecond) }()

	// Create test server
	server := httptest.NewServer(http.HandlerFunc(hub.HandleWebSocket))
	defer server.Close()

	// Convert http URL to ws URL without token
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	// Set allowed origin for the test
	AllowedOriginsMap[""] = true
	defer delete(AllowedOriginsMap, "")

	// Connect without token when one is required - should fail with 401
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.Error(t, err, "Expected connection to fail when token is missing")
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

func TestHandleWebSocket_EmptyToken(t *testing.T) {
	// Set expected token
	testToken := "test-secret-token-12345"
	os.Setenv("CHATML_AUTH_TOKEN", testToken)
	defer os.Unsetenv("CHATML_AUTH_TOKEN")

	hub := NewHub()
	go hub.Run()
	defer func() { time.Sleep(10 * time.Millisecond) }()

	// Create test server
	server := httptest.NewServer(http.HandlerFunc(hub.HandleWebSocket))
	defer server.Close()

	// Convert http URL to ws URL with empty token
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "?token="

	// Set allowed origin for the test
	AllowedOriginsMap[""] = true
	defer delete(AllowedOriginsMap, "")

	// Connect with empty token when one is required - should fail with 401
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.Error(t, err, "Expected connection to fail with empty token")
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

func TestHandleWebSocket_TokenWithSpecialChars(t *testing.T) {
	// Test with a base64-like token with special chars (like our actual tokens)
	testToken := "abc123XYZ_-=="
	os.Setenv("CHATML_AUTH_TOKEN", testToken)
	defer os.Unsetenv("CHATML_AUTH_TOKEN")

	hub := NewHub()
	go hub.Run()
	defer func() { time.Sleep(10 * time.Millisecond) }()

	// Create test server
	server := httptest.NewServer(http.HandlerFunc(hub.HandleWebSocket))
	defer server.Close()

	// URL-encode the token as the frontend would
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "?token=" + url.QueryEscape(testToken)

	// Set allowed origin for the test
	AllowedOriginsMap[""] = true
	defer delete(AllowedOriginsMap, "")

	// Connect with properly encoded token - should succeed
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Expected connection to succeed with valid encoded token, got error: %v", err)
	}
	defer conn.Close()

	assert.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
}

// ============================================================================
// Streaming Warning Tests
// ============================================================================

func TestHub_Broadcast_EmitsWarningOnTimeout(t *testing.T) {
	hub := NewHub()

	// Fill channel to capacity
	fillerData, _ := json.Marshal(Event{Type: "filler"})
	for i := 0; i < 1024; i++ {
		hub.broadcast <- fillerData
	}

	// Broadcast should timeout, then emit warning
	result := hub.Broadcast(Event{Type: "dropped"})
	assert.False(t, result.Delivered)

	// Verify warning was attempted (rate-limited check)
	// lastWarningTime should have been updated
	assert.Greater(t, hub.lastWarningTime.Load(), int64(0))
}

func TestHub_Broadcast_WarningRateLimited(t *testing.T) {
	hub := NewHub()

	// Set last warning time to recent past (within rate limit window)
	hub.lastWarningTime.Store(time.Now().UnixMilli())

	// Fill channel
	fillerData, _ := json.Marshal(Event{Type: "filler"})
	for i := 0; i < 1024; i++ {
		hub.broadcast <- fillerData
	}

	// Broadcast should timeout but NOT emit warning (rate limited)
	initialTime := hub.lastWarningTime.Load()
	hub.Broadcast(Event{Type: "dropped"})

	// lastWarningTime should NOT have changed (rate limited)
	assert.Equal(t, initialTime, hub.lastWarningTime.Load())
}

func TestHub_Broadcast_WarningAfterRateLimitExpires(t *testing.T) {
	hub := NewHub()

	// Set last warning time to 6 seconds ago (past 5s rate limit)
	hub.lastWarningTime.Store(time.Now().Add(-6 * time.Second).UnixMilli())

	// Fill channel
	fillerData, _ := json.Marshal(Event{Type: "filler"})
	for i := 0; i < 1024; i++ {
		hub.broadcast <- fillerData
	}

	// Broadcast should timeout AND emit warning
	oldTime := hub.lastWarningTime.Load()
	hub.Broadcast(Event{Type: "dropped"})

	// lastWarningTime should have been updated
	assert.Greater(t, hub.lastWarningTime.Load(), oldTime)
}
