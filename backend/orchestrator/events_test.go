package orchestrator

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewEventBus(t *testing.T) {
	eb := NewEventBus()

	assert.NotNil(t, eb)
	assert.NotNil(t, eb.handlers)
	assert.Empty(t, eb.handlers)
}

func TestEventBus_Subscribe(t *testing.T) {
	eb := NewEventBus()

	handler1 := func(event Event) {}
	handler2 := func(event Event) {}

	eb.Subscribe(handler1)
	assert.Len(t, eb.handlers, 1)

	eb.Subscribe(handler2)
	assert.Len(t, eb.handlers, 2)
}

func TestEventBus_Publish(t *testing.T) {
	eb := NewEventBus()

	var received atomic.Bool
	var receivedEvent Event

	var mu sync.Mutex
	handler := func(event Event) {
		mu.Lock()
		receivedEvent = event
		mu.Unlock()
		received.Store(true)
	}

	eb.Subscribe(handler)

	event := Event{
		Type:      "test.event",
		AgentID:   "agent-1",
		Timestamp: time.Now(),
		Data:      "test data",
	}

	eb.Publish(event)

	// Wait for async handler
	require.Eventually(t, func() bool {
		return received.Load()
	}, 100*time.Millisecond, 10*time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, "test.event", receivedEvent.Type)
	assert.Equal(t, "agent-1", receivedEvent.AgentID)
	assert.Equal(t, "test data", receivedEvent.Data)
}

func TestEventBus_PublishMultipleHandlers(t *testing.T) {
	eb := NewEventBus()

	var count atomic.Int32

	for i := 0; i < 3; i++ {
		eb.Subscribe(func(event Event) {
			count.Add(1)
		})
	}

	eb.Publish(Event{Type: "test"})

	require.Eventually(t, func() bool {
		return count.Load() == 3
	}, 100*time.Millisecond, 10*time.Millisecond)
}

func TestEventBus_PublishNoHandlers(t *testing.T) {
	eb := NewEventBus()

	// Should not panic with no handlers
	eb.Publish(Event{Type: "test"})
}

func TestEventBus_PublishAgentStateChanged(t *testing.T) {
	eb := NewEventBus()

	var receivedEvent Event
	var mu sync.Mutex
	var received atomic.Bool

	eb.Subscribe(func(event Event) {
		mu.Lock()
		receivedEvent = event
		mu.Unlock()
		received.Store(true)
	})

	eb.PublishAgentStateChanged("agent-1", true, "some error")

	require.Eventually(t, func() bool {
		return received.Load()
	}, 100*time.Millisecond, 10*time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	assert.Equal(t, EventAgentStateChanged, receivedEvent.Type)
	assert.Equal(t, "agent-1", receivedEvent.AgentID)
	assert.NotZero(t, receivedEvent.Timestamp)

	data, ok := receivedEvent.Data.(AgentStateChangedData)
	require.True(t, ok)
	assert.True(t, data.Enabled)
	assert.Equal(t, "some error", data.LastError)
}

func TestEventBus_PublishAgentRunStarted(t *testing.T) {
	eb := NewEventBus()

	var receivedEvent Event
	var mu sync.Mutex
	var received atomic.Bool

	eb.Subscribe(func(event Event) {
		mu.Lock()
		receivedEvent = event
		mu.Unlock()
		received.Store(true)
	})

	eb.PublishAgentRunStarted("agent-1", "run-123", "manual")

	require.Eventually(t, func() bool {
		return received.Load()
	}, 100*time.Millisecond, 10*time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	assert.Equal(t, EventAgentRunStarted, receivedEvent.Type)
	assert.Equal(t, "agent-1", receivedEvent.AgentID)

	data, ok := receivedEvent.Data.(AgentRunStartedData)
	require.True(t, ok)
	assert.Equal(t, "run-123", data.RunID)
	assert.Equal(t, "manual", data.Trigger)
}

func TestEventBus_PublishAgentRunProgress(t *testing.T) {
	eb := NewEventBus()

	var receivedEvent Event
	var mu sync.Mutex
	var received atomic.Bool

	eb.Subscribe(func(event Event) {
		mu.Lock()
		receivedEvent = event
		mu.Unlock()
		received.Store(true)
	})

	eb.PublishAgentRunProgress("agent-1", "run-123", "Processing items...")

	require.Eventually(t, func() bool {
		return received.Load()
	}, 100*time.Millisecond, 10*time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	assert.Equal(t, EventAgentRunProgress, receivedEvent.Type)
	assert.Equal(t, "agent-1", receivedEvent.AgentID)

	data, ok := receivedEvent.Data.(AgentRunProgressData)
	require.True(t, ok)
	assert.Equal(t, "run-123", data.RunID)
	assert.Equal(t, "Processing items...", data.Message)
}

func TestEventBus_PublishAgentRunCompleted(t *testing.T) {
	eb := NewEventBus()

	var receivedEvent Event
	var mu sync.Mutex
	var received atomic.Bool

	eb.Subscribe(func(event Event) {
		mu.Lock()
		receivedEvent = event
		mu.Unlock()
		received.Store(true)
	})

	run := &models.AgentRun{
		ID:              "run-123",
		AgentID:         "agent-1",
		Status:          "completed",
		ResultSummary:   "Found 5 items",
		SessionsCreated: []string{"session-1", "session-2"},
		Cost:            0.05,
	}

	eb.PublishAgentRunCompleted("agent-1", run, 5000)

	require.Eventually(t, func() bool {
		return received.Load()
	}, 100*time.Millisecond, 10*time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	assert.Equal(t, EventAgentRunCompleted, receivedEvent.Type)
	assert.Equal(t, "agent-1", receivedEvent.AgentID)

	data, ok := receivedEvent.Data.(AgentRunCompletedData)
	require.True(t, ok)
	assert.Equal(t, "run-123", data.RunID)
	assert.Equal(t, "completed", data.Status)
	assert.Equal(t, "Found 5 items", data.ResultSummary)
	assert.Equal(t, []string{"session-1", "session-2"}, data.SessionsCreated)
	assert.Equal(t, 0.05, data.Cost)
	assert.Equal(t, int64(5000), data.DurationMs)
}

func TestEventBus_PublishAgentSessionCreated(t *testing.T) {
	eb := NewEventBus()

	var receivedEvent Event
	var mu sync.Mutex
	var received atomic.Bool

	eb.Subscribe(func(event Event) {
		mu.Lock()
		receivedEvent = event
		mu.Unlock()
		received.Store(true)
	})

	eb.PublishAgentSessionCreated("agent-1", "run-123", "session-456")

	require.Eventually(t, func() bool {
		return received.Load()
	}, 100*time.Millisecond, 10*time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	assert.Equal(t, EventAgentSessionCreated, receivedEvent.Type)
	assert.Equal(t, "agent-1", receivedEvent.AgentID)

	data, ok := receivedEvent.Data.(AgentSessionCreatedData)
	require.True(t, ok)
	assert.Equal(t, "run-123", data.RunID)
	assert.Equal(t, "session-456", data.SessionID)
}

func TestEventBus_ConcurrentSubscribeAndPublish(t *testing.T) {
	eb := NewEventBus()

	var count atomic.Int32
	var wg sync.WaitGroup

	// Concurrent subscribes
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			eb.Subscribe(func(event Event) {
				count.Add(1)
			})
		}()
	}

	// Concurrent publishes
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			eb.Publish(Event{Type: "test"})
		}()
	}

	wg.Wait()

	// Wait for at least some handlers to be called
	require.Eventually(t, func() bool {
		return count.Load() > 0
	}, 500*time.Millisecond, 10*time.Millisecond, "at least one handler should be called")
}

func TestEventConstants(t *testing.T) {
	// Verify event type constants are defined correctly
	assert.Equal(t, "agent.state.changed", EventAgentStateChanged)
	assert.Equal(t, "agent.run.started", EventAgentRunStarted)
	assert.Equal(t, "agent.run.progress", EventAgentRunProgress)
	assert.Equal(t, "agent.run.completed", EventAgentRunCompleted)
	assert.Equal(t, "agent.session.created", EventAgentSessionCreated)
}
