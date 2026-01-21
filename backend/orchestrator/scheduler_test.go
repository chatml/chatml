package orchestrator

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewScheduler(t *testing.T) {
	callback := func(agentID string) {}
	s := NewScheduler(callback)

	assert.NotNil(t, s)
	assert.NotNil(t, s.tickers)
	assert.NotNil(t, s.callback)
	assert.NotNil(t, s.ctx)
	assert.NotNil(t, s.cancel)

	s.Stop()
}

func TestScheduler_Schedule(t *testing.T) {
	callback := func(agentID string) {}
	s := NewScheduler(callback)
	defer s.Stop()

	s.Schedule("agent-1", 1000)

	assert.True(t, s.IsScheduled("agent-1"))
	assert.Equal(t, time.Duration(1000)*time.Millisecond, s.GetInterval("agent-1"))
}

func TestScheduler_Schedule_ZeroInterval(t *testing.T) {
	callback := func(agentID string) {}
	s := NewScheduler(callback)
	defer s.Stop()

	s.Schedule("agent-1", 0)

	assert.False(t, s.IsScheduled("agent-1"))
}

func TestScheduler_Schedule_NegativeInterval(t *testing.T) {
	callback := func(agentID string) {}
	s := NewScheduler(callback)
	defer s.Stop()

	s.Schedule("agent-1", -100)

	assert.False(t, s.IsScheduled("agent-1"))
}

func TestScheduler_Schedule_ReplacesExisting(t *testing.T) {
	callback := func(agentID string) {}
	s := NewScheduler(callback)
	defer s.Stop()

	s.Schedule("agent-1", 1000)
	assert.Equal(t, time.Duration(1000)*time.Millisecond, s.GetInterval("agent-1"))

	s.Schedule("agent-1", 2000)
	assert.Equal(t, time.Duration(2000)*time.Millisecond, s.GetInterval("agent-1"))
}

func TestScheduler_Unschedule(t *testing.T) {
	callback := func(agentID string) {}
	s := NewScheduler(callback)
	defer s.Stop()

	s.Schedule("agent-1", 1000)
	assert.True(t, s.IsScheduled("agent-1"))

	s.Unschedule("agent-1")
	assert.False(t, s.IsScheduled("agent-1"))
}

func TestScheduler_Unschedule_NotScheduled(t *testing.T) {
	callback := func(agentID string) {}
	s := NewScheduler(callback)
	defer s.Stop()

	// Should not panic when unscheduling non-existent agent
	s.Unschedule("non-existent")
	assert.False(t, s.IsScheduled("non-existent"))
}

func TestScheduler_UpdateInterval(t *testing.T) {
	callback := func(agentID string) {}
	s := NewScheduler(callback)
	defer s.Stop()

	s.Schedule("agent-1", 1000)
	assert.Equal(t, time.Duration(1000)*time.Millisecond, s.GetInterval("agent-1"))

	s.UpdateInterval("agent-1", 500)
	assert.Equal(t, time.Duration(500)*time.Millisecond, s.GetInterval("agent-1"))
}

func TestScheduler_TriggerNow(t *testing.T) {
	var triggered atomic.Bool
	callback := func(agentID string) {
		if agentID == "agent-1" {
			triggered.Store(true)
		}
	}
	s := NewScheduler(callback)
	defer s.Stop()

	s.TriggerNow("agent-1")

	// Wait a bit for the goroutine to execute
	time.Sleep(50 * time.Millisecond)
	assert.True(t, triggered.Load())
}

func TestScheduler_TriggerNow_NilCallback(t *testing.T) {
	s := NewScheduler(nil)
	defer s.Stop()

	// Should not panic with nil callback
	s.TriggerNow("agent-1")
}

func TestScheduler_IsScheduled(t *testing.T) {
	callback := func(agentID string) {}
	s := NewScheduler(callback)
	defer s.Stop()

	assert.False(t, s.IsScheduled("agent-1"))

	s.Schedule("agent-1", 1000)
	assert.True(t, s.IsScheduled("agent-1"))

	s.Unschedule("agent-1")
	assert.False(t, s.IsScheduled("agent-1"))
}

func TestScheduler_GetInterval(t *testing.T) {
	callback := func(agentID string) {}
	s := NewScheduler(callback)
	defer s.Stop()

	// Non-existent agent returns 0
	assert.Equal(t, time.Duration(0), s.GetInterval("non-existent"))

	s.Schedule("agent-1", 1000)
	assert.Equal(t, time.Duration(1000)*time.Millisecond, s.GetInterval("agent-1"))
}

func TestScheduler_ListScheduled(t *testing.T) {
	callback := func(agentID string) {}
	s := NewScheduler(callback)
	defer s.Stop()

	// Empty list initially
	assert.Empty(t, s.ListScheduled())

	s.Schedule("agent-1", 1000)
	s.Schedule("agent-2", 2000)
	s.Schedule("agent-3", 3000)

	scheduled := s.ListScheduled()
	assert.Len(t, scheduled, 3)
	assert.Contains(t, scheduled, "agent-1")
	assert.Contains(t, scheduled, "agent-2")
	assert.Contains(t, scheduled, "agent-3")
}

func TestScheduler_Stop(t *testing.T) {
	callback := func(agentID string) {}
	s := NewScheduler(callback)

	s.Schedule("agent-1", 1000)
	s.Schedule("agent-2", 2000)

	s.Stop()

	assert.Empty(t, s.ListScheduled())
}

func TestScheduler_CallbackInvoked(t *testing.T) {
	var mu sync.Mutex
	invocations := make([]string, 0)

	callback := func(agentID string) {
		mu.Lock()
		invocations = append(invocations, agentID)
		mu.Unlock()
	}

	s := NewScheduler(callback)
	defer s.Stop()

	// Schedule with very short interval
	s.Schedule("agent-1", 10)

	// Wait for at least one tick
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	count := len(invocations)
	mu.Unlock()

	require.Greater(t, count, 0, "Callback should have been invoked at least once")

	mu.Lock()
	for _, id := range invocations {
		assert.Equal(t, "agent-1", id)
	}
	mu.Unlock()
}

func TestScheduler_MultipleAgents(t *testing.T) {
	var mu sync.Mutex
	invocations := make(map[string]int)

	callback := func(agentID string) {
		mu.Lock()
		invocations[agentID]++
		mu.Unlock()
	}

	s := NewScheduler(callback)
	defer s.Stop()

	s.Schedule("agent-1", 10)
	s.Schedule("agent-2", 10)

	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	assert.Greater(t, invocations["agent-1"], 0)
	assert.Greater(t, invocations["agent-2"], 0)
}

func TestScheduler_ConcurrentOperations(t *testing.T) {
	callback := func(agentID string) {}
	s := NewScheduler(callback)
	defer s.Stop()

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			agentID := string(rune('a' + id%26))
			s.Schedule(agentID, 100)
			s.IsScheduled(agentID)
			s.GetInterval(agentID)
			s.ListScheduled()
		}(i)
	}
	wg.Wait()
}
